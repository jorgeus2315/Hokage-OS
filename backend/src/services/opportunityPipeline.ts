import { run, get, all } from '../db/init.js';
import type { Opportunity, BusinessProposal, ValidationStatus, OpportunityStatus } from '../types/index.js';
import { callAIJson } from './aiService.js';
import { modelFor } from './roleService.js';
import { createDecision } from './decisionService.js';
import { ventureOverRealBudget } from './ventureBudget.js';
import { recordAudit } from './auditService.js';
import {
  sanitizeEvidenceRow, evaluateValidation, readJudgeSignals, sanitizeProposal, capBudget,
  type EvidenceCounts,
} from '../config/f11Policy.js';

// ═══════════════════════════════════════════════════════════════════════════
// opportunityPipeline — capa de autonomía empresarial (Fase 11).
// ═══════════════════════════════════════════════════════════════════════════
//
// Reutiliza F5 (investigación = un hokage_command), F7 (presupuesto de la venture de
// financiación), F8 (memoria aislada), F9 (auditoría), F10 (auth). NO crea un segundo
// orquestador ni una segunda verdad económica. La progresión es AUTOMÁTICA pero ACOTADA y se
// DETIENE en el gate humano (awaiting_approval): la creación de venture exige aprobación humana
// (una Decision con entity_type='business_proposal', que nunca se auto-aprueba). El LLM propone
// datos; el código (f11Policy) decide. Toda llamada IA de F11 pasa por callAIJson(costCtx) →
// agent_costs, y se bloquea si la venture de financiación superó su presupuesto real (F7).

const TERMINAL_CMD = new Set(['completed', 'partial', 'failed', 'cancelled']);

const OPP_SELECT = 'SELECT id, funding_venture_id, title, status, research_command_id, validation_status, validation_notes, created_at, updated_at FROM opportunities';
const PROP_SELECT = 'SELECT id, opportunity_id, content, proposed_budget_usd, proposed_name, proposed_type, status, decision_id, created_venture_id, created_at, updated_at FROM business_proposals';

async function getOpp(id: number): Promise<Opportunity | undefined> {
  return get<Opportunity>(`${OPP_SELECT} WHERE id = ?`, [id]);
}
async function ceoAgentId(): Promise<number | null> {
  const a = await get<{ id: number }>("SELECT id FROM agents WHERE role = 'ceo' AND venture_id IS NULL LIMIT 1");
  return a?.id ?? null;
}
// Transición atómica de estado (compare-and-swap): solo un llamador gana cada avance → seguro
// ante concurrencia (hook de finalizeCommand + /advance). Devuelve true si esta llamada transicionó.
async function cas(oppId: number, from: OpportunityStatus, to: OpportunityStatus): Promise<boolean> {
  const r = await run(`UPDATE opportunities SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?`, [to, oppId, from]);
  return r.changes === 1;
}
async function setValidation(oppId: number, vs: ValidationStatus, notes?: string): Promise<void> {
  await run(`UPDATE opportunities SET validation_status = ?, validation_notes = ?, updated_at = datetime('now') WHERE id = ?`, [vs, notes ?? null, oppId]);
}

// ── LLM inyectable (tests deterministas, mismo patrón que decomposeFn en F5) ──
export type ExtractFn = (title: string, taskResults: string) => Promise<unknown[] | null>;
export type JudgeFn = (title: string, evidenceText: string) => Promise<unknown>;
export type MonetizeFn = (title: string, evidenceText: string) => Promise<unknown>;
export interface PipelineFns { extract?: ExtractFn; judge?: JudgeFn; monetize?: MonetizeFn; }

async function realExtract(fundingVentureId: number, title: string, taskResults: string): Promise<unknown[] | null> {
  const model = await modelFor('ceo');
  const sys = 'Eres el analista de investigación de HOKAGE OS. Extrae evidencia estructurada de los resultados. Devuelve ÚNICAMENTE JSON: {"evidence":[{"kind":"fact|inference|hypothesis|unknown","claim":"...","source":"url/ref o null","confidence":0-100,"conflicts_with_index":null}]}. Marca como "fact" SOLO si hay fuente verificable; sin fuente usa "inference" o "hypothesis". Si dos afirmaciones se contradicen, apunta conflicts_with_index.';
  const raw = await callAIJson<{ evidence?: unknown[] }>(sys, `Oportunidad: "${title}"\n\nResultados de la investigación:\n${taskResults.slice(0, 6000)}`, model, { ventureId: fundingVentureId, agentId: (await ceoAgentId()) ?? 0 });
  return Array.isArray(raw?.evidence) ? raw!.evidence : null;
}
async function realJudge(fundingVentureId: number, title: string, evidenceText: string): Promise<unknown> {
  const model = await modelFor('ceo');
  const sys = 'Eres el juez de calidad de HOKAGE OS. Evalúa si la investigación es suficiente para decidir. Devuelve ÚNICAMENTE JSON: {"complete":bool,"evidence_sufficient":bool,"sources_ok":bool,"recommendation":"validated|insufficient|rejected|review"}. No decides tú la validación final; solo informas.';
  return callAIJson(sys, `Oportunidad: "${title}"\n\nEvidencia:\n${evidenceText.slice(0, 6000)}`, model, { ventureId: fundingVentureId, agentId: (await ceoAgentId()) ?? 0 });
}
async function realMonetize(fundingVentureId: number, title: string, evidenceText: string): Promise<unknown> {
  const model = await modelFor('ceo');
  const sys = 'Eres el estratega de monetización de HOKAGE OS. Devuelve ÚNICAMENTE JSON con: proposed_name, proposed_type (store|saas|content|fund|agency|community|other), target_customer, problem, value_proposition, acquisition, delivery, revenue_model, costs, price_hypothesis, risks, key_assumptions (array), confidence (0-100), proposed_budget_usd (número). Distingue dato observado, estimación e hipótesis. No inventes cifras como si fueran reales.';
  return callAIJson(sys, `Oportunidad: "${title}"\n\nEvidencia validada:\n${evidenceText.slice(0, 6000)}`, model, { ventureId: fundingVentureId, agentId: (await ceoAgentId()) ?? 0 });
}

// ── Investigación ─────────────────────────────────────────────────────────────
export function researchPromptFor(title: string): string {
  return `Investiga a fondo esta oportunidad de negocio: "${title}". Reparte el trabajo entre especialistas para cubrir: problema real, tamaño y demanda del mercado, competencia, canales de adquisición, clientes potenciales, tendencias, riesgos, restricciones y viabilidad inicial. Cada especialista debe aportar hallazgos concretos con su fuente cuando exista.`;
}

export async function createOpportunity(input: { title: string; fundingVentureId: number }): Promise<Opportunity> {
  const title = (input.title || '').trim();
  if (!title) throw new Error('La oportunidad necesita un título/hipótesis.');
  const v = await get<{ id: number }>('SELECT id FROM ventures WHERE id = ?', [input.fundingVentureId]);
  if (!v) throw new Error(`Venture de financiación inexistente: ${input.fundingVentureId}`);
  const r = await run(`INSERT INTO opportunities (funding_venture_id, title, status) VALUES (?, ?, 'draft')`, [input.fundingVentureId, title]);
  await recordAudit({ type: 'opportunity.created', ventureId: input.fundingVentureId, meta: { opportunityId: r.lastID } });
  return (await getOpp(r.lastID))!;
}

// El servidor crea el hokage_command (F5) y luego enlaza aquí (evita ciclo de imports con el
// orquestador). Idempotente: solo desde 'draft'.
export async function beginResearch(oppId: number, commandId: number): Promise<Opportunity | null> {
  const opp = await getOpp(oppId);
  if (!opp) return null;
  if (opp.status !== 'draft') return opp; // idempotente
  await run(`UPDATE opportunities SET research_command_id = ?, status = 'researching', updated_at = datetime('now') WHERE id = ? AND status = 'draft'`, [commandId, oppId]);
  await recordAudit({ type: 'research.started', ventureId: opp.funding_venture_id, commandId, meta: { opportunityId: oppId } });
  return getOpp(oppId).then((o) => o ?? null);
}

// ── Evidencia ─────────────────────────────────────────────────────────────────
async function evidenceCount(oppId: number): Promise<number> {
  return (await get<{ c: number }>('SELECT COUNT(*) as c FROM evidence WHERE opportunity_id = ?', [oppId]))?.c ?? 0;
}
async function extractEvidence(opp: Opportunity, extract: ExtractFn): Promise<void> {
  if ((await evidenceCount(opp.id)) > 0) return; // ya extraída (idempotente/defensa concurrencia)
  const tasks = await all<{ role: string; title: string; result: string | null; id: number }>(
    "SELECT id, role, title, result FROM hokage_tasks WHERE command_id = ? AND status = 'completed'",
    [opp.research_command_id]
  );
  const taskText = tasks.map((t) => `[${t.role}] ${t.title}: ${(t.result ?? '').slice(0, 800)}`).join('\n');
  const raw = await extract(opp.title, taskText);
  const rows = Array.isArray(raw) ? raw : [];
  const insertedIds: number[] = [];
  const conflictIdx: Array<number | null> = [];
  for (const rr of rows.slice(0, 40)) {
    const clean = sanitizeEvidenceRow(rr);
    if (!clean) continue;
    const ci = (rr as Record<string, unknown>).conflicts_with_index;
    const r = await run(
      `INSERT INTO evidence (opportunity_id, kind, claim, source, confidence, agent_id, task_id) VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
      [opp.id, clean.kind, clean.claim, clean.source, clean.confidence]
    );
    insertedIds.push(r.lastID);
    conflictIdx.push(typeof ci === 'number' && ci >= 0 ? ci : null);
  }
  // Segunda pasada: resolver contradicciones (índice del batch → id de evidencia). §9: se conservan.
  for (let i = 0; i < insertedIds.length; i++) {
    const idx = conflictIdx[i];
    if (idx != null && idx < insertedIds.length && idx !== i) {
      await run(`UPDATE evidence SET conflicts_with = ? WHERE id = ?`, [insertedIds[idx], insertedIds[i]]);
    }
  }
}

async function countsFor(oppId: number): Promise<EvidenceCounts> {
  const row = await get<{ total: number; facts: number; contradictions: number; avgc: number }>(
    `SELECT COUNT(*) as total,
            COALESCE(SUM(CASE WHEN kind='fact' THEN 1 ELSE 0 END),0) as facts,
            COALESCE(SUM(CASE WHEN conflicts_with IS NOT NULL THEN 1 ELSE 0 END),0) as contradictions,
            COALESCE(AVG(confidence),0) as avgc
     FROM evidence WHERE opportunity_id = ?`,
    [oppId]
  );
  return { total: row?.total ?? 0, facts: row?.facts ?? 0, contradictions: row?.contradictions ?? 0, avgConfidence: Math.round(row?.avgc ?? 0) };
}

// ── Validación (reglas deterministas + juez como dato) ────────────────────────
export async function validateOpportunity(opp: Opportunity, judge: JudgeFn): Promise<ValidationStatus> {
  const evidence = await all<{ kind: string; claim: string; source: string | null; confidence: number }>(
    'SELECT kind, claim, source, confidence FROM evidence WHERE opportunity_id = ?', [opp.id]
  );
  const counts = await countsFor(opp.id);
  const evidenceText = evidence.map((e) => `(${e.kind}, ${e.confidence}) ${e.claim}${e.source ? ` [${e.source}]` : ''}`).join('\n');
  const rawJudge = await judge(opp.title, evidenceText);
  const signals = readJudgeSignals(rawJudge);
  const result = evaluateValidation(counts, signals);
  await setValidation(opp.id, result, `evid=${counts.total} facts=${counts.facts} contra=${counts.contradictions} avgConf=${counts.avgConfidence} rec=${signals?.recommendation ?? 'n/a'}`);
  return result;
}

// ── Monetización → propuesta (presupuesto capado por código) ──────────────────
async function proposalOf(oppId: number): Promise<BusinessProposal | undefined> {
  return get<BusinessProposal>(`${PROP_SELECT} WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1`, [oppId]);
}
async function monetize(opp: Opportunity, monetizeFn: MonetizeFn): Promise<boolean> {
  const existing = await proposalOf(opp.id);
  if (existing) return true; // idempotente
  const evidence = await all<{ kind: string; claim: string; confidence: number }>(
    'SELECT kind, claim, confidence FROM evidence WHERE opportunity_id = ?', [opp.id]
  );
  const evidenceText = evidence.map((e) => `(${e.kind}, ${e.confidence}) ${e.claim}`).join('\n');
  const raw = await monetizeFn(opp.title, evidenceText);
  const clean = sanitizeProposal(raw);
  if (!clean) return false;
  await run(
    `INSERT INTO business_proposals (opportunity_id, content, proposed_budget_usd, proposed_name, proposed_type, status) VALUES (?, ?, ?, ?, ?, 'proposed')`,
    [opp.id, JSON.stringify(clean.content), clean.proposedBudget, clean.name, clean.type]
  );
  return true;
}

// ── Gate de aprobación humana (reutiliza decisions + decisionResolvers) ───────
export async function requestApproval(oppId: number): Promise<void> {
  const opp = await getOpp(oppId);
  if (!opp) return;
  const proposal = await proposalOf(oppId);
  if (!proposal || proposal.decision_id) return; // idempotente
  const decision = await createDecision({
    agent_id: null,
    entity_type: 'business_proposal',
    entity_id: proposal.id,
    venture_id: opp.funding_venture_id,
    title: `Crear venture: ${proposal.proposed_name}`.slice(0, 100),
    description: `Presupuesto propuesto: ${proposal.proposed_budget_usd} USD. Requiere aprobación humana para crear la venture.`,
    reasoning: 'Propuesta de negocio generada por el pipeline de F11 tras investigación y validación.',
    risk_level: proposal.proposed_budget_usd > 0 ? 'medium' : 'low',
  });
  await run(`UPDATE business_proposals SET decision_id = ?, status = 'awaiting_approval', updated_at = datetime('now') WHERE id = ?`, [decision.id, proposal.id]);
  await recordAudit({ type: 'business.approval_requested', ventureId: opp.funding_venture_id, meta: { opportunityId: oppId, proposalId: proposal.id, decisionId: decision.id } });
}

// ── Creación de venture (SOLO vía resolver, es decir, aprobación humana; idempotente) ──
export async function createVentureFromProposal(proposalId: number): Promise<void> {
  const p = await get<BusinessProposal>(`${PROP_SELECT} WHERE id = ?`, [proposalId]);
  if (!p) return;
  if (p.created_venture_id) return; // idempotente (doble-click / retry secuencial)
  const opp = await getOpp(p.opportunity_id);
  // El humano acaba de aprobar la Decision → registra la aprobación y pasa a 'creating'.
  if (opp && opp.status === 'awaiting_approval') {
    await run(`UPDATE opportunities SET status = 'approved', updated_at = datetime('now') WHERE id = ? AND status = 'awaiting_approval'`, [opp.id]);
    await recordAudit({ type: 'business.approved', ventureId: opp.funding_venture_id, meta: { proposalId, opportunityId: opp.id, decisionId: p.decision_id } });
  }
  await recordAudit({ type: 'venture.creation_requested', ventureId: opp?.funding_venture_id ?? null, meta: { proposalId, opportunityId: p.opportunity_id } });
  const budget = capBudget(p.proposed_budget_usd); // defensa: el código aplica el tope, no el LLM
  if (opp) await run(`UPDATE opportunities SET status = 'creating', updated_at = datetime('now') WHERE id = ? AND status = 'approved'`, [opp.id]);

  let ventureId: number;
  const existing = await get<{ id: number }>('SELECT id FROM ventures WHERE source_proposal_id = ?', [proposalId]);
  if (existing) {
    ventureId = existing.id;
  } else {
    try {
      const r = await run(
        `INSERT INTO ventures (name, type, status, goal, budget_allocated_usd, source_proposal_id) VALUES (?, ?, 'active', ?, ?, ?)`,
        [p.proposed_name, p.proposed_type, `Creada desde propuesta #${proposalId}`, budget, proposalId]
      );
      ventureId = r.lastID;
    } catch {
      // Carrera: otra ejecución insertó primero (UNIQUE source_proposal_id) → reutilizar.
      const again = await get<{ id: number }>('SELECT id FROM ventures WHERE source_proposal_id = ?', [proposalId]);
      if (!again) { await recordAudit({ type: 'venture.creation_failed', ventureId: opp?.funding_venture_id ?? null, meta: { proposalId } }); return; }
      ventureId = again.id;
    }
  }
  await run(`UPDATE business_proposals SET status = 'created', created_venture_id = ?, updated_at = datetime('now') WHERE id = ? AND created_venture_id IS NULL`, [ventureId, proposalId]);
  if (opp) await run(`UPDATE opportunities SET status = 'created', updated_at = datetime('now') WHERE id = ?`, [opp.id]);
  await recordAudit({ type: 'venture.created', ventureId: opp?.funding_venture_id ?? null, meta: { proposalId, ventureId, budget } });
}

export async function rejectProposal(proposalId: number): Promise<void> {
  const p = await get<BusinessProposal>(`${PROP_SELECT} WHERE id = ?`, [proposalId]);
  if (!p) return;
  await run(`UPDATE business_proposals SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`, [proposalId]);
  await run(`UPDATE opportunities SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`, [p.opportunity_id]);
  await recordAudit({ type: 'business.rejected', meta: { proposalId, opportunityId: p.opportunity_id } });
}

// ── Progresión acotada: research → … → proposed → awaiting_approval (HALT humano) ──
async function advanceOneStage(oppId: number, fns: Required<PipelineFns>): Promise<boolean> {
  const opp = await getOpp(oppId);
  if (!opp) return false;
  const V = opp.funding_venture_id;

  if (opp.status === 'researching') {
    const cmd = await get<{ status: string }>('SELECT status FROM hokage_commands WHERE id = ?', [opp.research_command_id]);
    if (!cmd || !TERMINAL_CMD.has(cmd.status)) return false; // aún investigando
    if (!(await cas(oppId, 'researching', 'validating'))) return false; // otro llamador lo reclamó
    await recordAudit({ type: 'research.completed', ventureId: V, commandId: opp.research_command_id, meta: { opportunityId: oppId, commandStatus: cmd.status } });
    if (cmd.status === 'failed') { await run(`UPDATE opportunities SET status='failed', updated_at=datetime('now') WHERE id=?`, [oppId]); return false; }
    if (await ventureOverRealBudget(V)) { await setValidation(oppId, 'insufficient_evidence', 'presupuesto de la venture de financiación agotado'); await run(`UPDATE opportunities SET status='insufficient_evidence', updated_at=datetime('now') WHERE id=?`, [oppId]); return false; }
    await recordAudit({ type: 'validation.started', ventureId: V, meta: { opportunityId: oppId } });
    await extractEvidence({ ...opp, status: 'validating' }, fns.extract);
    return true; // ahora 'validating'
  }

  if (opp.status === 'validating') {
    const result = await validateOpportunity(opp, fns.judge);
    await recordAudit({ type: 'validation.completed', ventureId: V, meta: { opportunityId: oppId, result } });
    if (result === 'validated') { await cas(oppId, 'validating', 'monetization'); return true; }
    if (result === 'rejected') await run(`UPDATE opportunities SET status='rejected', updated_at=datetime('now') WHERE id=?`, [oppId]);
    else if (result === 'insufficient_evidence') await run(`UPDATE opportunities SET status='insufficient_evidence', updated_at=datetime('now') WHERE id=?`, [oppId]);
    // needs_human_review: se queda en 'validating' con validation_status marcado
    return false; // parada
  }

  if (opp.status === 'monetization') {
    if (await ventureOverRealBudget(V)) { await run(`UPDATE opportunities SET status='failed', updated_at=datetime('now') WHERE id=?`, [oppId]); return false; }
    await recordAudit({ type: 'monetization.started', ventureId: V, meta: { opportunityId: oppId } });
    const ok = await monetize(opp, fns.monetize);
    await recordAudit({ type: 'monetization.completed', ventureId: V, meta: { opportunityId: oppId, ok } });
    if (!ok) { await run(`UPDATE opportunities SET status='failed', updated_at=datetime('now') WHERE id=?`, [oppId]); return false; }
    if (await cas(oppId, 'monetization', 'proposed')) {
      const proposal = await proposalOf(oppId);
      await recordAudit({ type: 'business.proposed', ventureId: V, meta: { opportunityId: oppId, proposalId: proposal?.id, budget: proposal?.proposed_budget_usd } });
    }
    return true;
  }

  if (opp.status === 'proposed') {
    await requestApproval(oppId);
    await cas(oppId, 'proposed', 'awaiting_approval');
    return false; // HALT en el gate humano
  }

  return false; // awaiting_approval / approved / creating / created / terminal → nada automático
}

// Bucle ACOTADO (nº finito de etapas, nunca un loop de LLM). Se detiene solo en awaiting_approval.
export async function progressOpportunity(oppId: number, fns?: PipelineFns): Promise<void> {
  const funding = (await getOpp(oppId))?.funding_venture_id ?? 0;
  const full: Required<PipelineFns> = {
    extract: fns?.extract ?? ((t, r) => realExtract(funding, t, r)),
    judge: fns?.judge ?? ((t, e) => realJudge(funding, t, e)),
    monetize: fns?.monetize ?? ((t, e) => realMonetize(funding, t, e)),
  };
  for (let i = 0; i < 6; i++) {
    if (!(await advanceOneStage(oppId, full))) break;
  }
}

// Hook desde finalizeCommand (F5): si el command que terminó es la investigación de una
// oportunidad, la hace avanzar. No-op si no hay oportunidad enlazada.
export async function onResearchCommandFinalized(commandId: number): Promise<void> {
  const opp = await get<{ id: number }>("SELECT id FROM opportunities WHERE research_command_id = ? AND status = 'researching'", [commandId]);
  if (opp) await progressOpportunity(opp.id);
}

// ── Lectura ───────────────────────────────────────────────────────────────────
export async function listOpportunities(): Promise<Opportunity[]> {
  return all<Opportunity>(`${OPP_SELECT} ORDER BY id DESC LIMIT 100`);
}
export async function getOpportunityDetail(oppId: number): Promise<Record<string, unknown> | null> {
  const opportunity = await getOpp(oppId);
  if (!opportunity) return null;
  const evidence = await all(`SELECT id, kind, claim, source, confidence, conflicts_with, created_at FROM evidence WHERE opportunity_id = ? ORDER BY id ASC`, [oppId]);
  const proposal = await proposalOf(oppId);
  return { opportunity, evidence, proposal: proposal ?? null };
}
export { getOpp as getOpportunity };
