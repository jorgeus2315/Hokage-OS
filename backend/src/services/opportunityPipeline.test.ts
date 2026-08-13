import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get, all } from '../db/init.js';
import {
  createOpportunity, beginResearch, progressOpportunity,
  createVentureFromProposal, getOpportunityDetail, getOpportunity,
  type PipelineFns,
} from './opportunityPipeline.js';
import { approveDecision, rejectDecision } from './decisionService.js';
import { resolveDecisionApproval, resolveDecisionRejection } from './decisionResolvers.js';
import { listAuditEvents } from './auditService.js';

// ═══ Tests de integración F11 — pipeline de oportunidad → venture. BD aislada. ═══
// El LLM se inyecta (extract/judge/monetize) para tests deterministas sin red, igual que
// decomposeFn en F5. Verifican: reglas de validación, gate humano, idempotencia y seguridad
// (el LLM no puede auto-aprobarse ni superar el tope de presupuesto).

let V = 0; // venture de financiación sin tope (budget_allocated_usd = 0)

// Crea un command de investigación ya terminado con resultados, como si F5 lo hubiera corrido.
async function fakeResearch(status: 'completed' | 'failed', results: string[] = ['hallazgo']): Promise<number> {
  const c = await run(`INSERT INTO hokage_commands (venture_id, text, status) VALUES (?, 'investiga', ?)`, [V, status]);
  for (const r of results) {
    await run(
      `INSERT INTO hokage_tasks (command_id, phase, role, title, prompt, status, result) VALUES (?, 0, 'investigador', 'T', 'p', 'completed', ?)`,
      [c.lastID, r]
    );
  }
  return c.lastID;
}

// Lleva una oportunidad nueva hasta enlazar su investigación terminada.
async function oppWithResearch(title: string, status: 'completed' | 'failed' = 'completed'): Promise<number> {
  const opp = await createOpportunity({ title, fundingVentureId: V });
  const cmd = await fakeResearch(status);
  await beginResearch(opp.id, cmd);
  return opp.id;
}

// Evidencia suficiente y sana: 4 filas, 2 hechos con fuente, confianza media ~65.
const extractOK: PipelineFns['extract'] = async () => [
  { kind: 'fact', claim: '10k búsquedas/mes', source: 'https://trends.example', confidence: 80 },
  { kind: 'inference', claim: 'mercado creciente', confidence: 60 },
  { kind: 'hypothesis', claim: 'pagarían 20€', confidence: 50 },
  { kind: 'fact', claim: 'competencia baja', source: 'https://x.example', confidence: 70 },
];
const judgeOK: PipelineFns['judge'] = async () => ({ complete: true, evidence_sufficient: true, sources_ok: true, recommendation: 'validated' });
// El LLM intenta colar autoridad (approved/can_create/is_admin) y un presupuesto enorme.
const monetizeGreedy: PipelineFns['monetize'] = async () => ({
  proposed_name: 'Gatos Minimal', proposed_type: 'store', target_customer: 'amantes de gatos',
  proposed_budget_usd: 100000, approved: true, human_approved: true, can_create: true, is_admin: true, autonomy: 3, tools: ['system.exec'],
});
const FNS_OK: PipelineFns = { extract: extractOK, judge: judgeOK, monetize: monetizeGreedy };

before(async () => {
  await initSchema();
  V = (await run(`INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES ('F11 Fund', 'store', 'active', 0)`)).lastID;
});

test('createOpportunity: exige venture de financiación existente', async () => {
  await assert.rejects(() => createOpportunity({ title: 'x', fundingVentureId: 999999 }));
  const opp = await createOpportunity({ title: 'Nicho válido', fundingVentureId: V });
  assert.equal(opp.status, 'draft');
  assert.equal(opp.funding_venture_id, V);
});

test('pipeline completo se DETIENE en awaiting_approval y NO crea venture sin humano', async () => {
  const id = await oppWithResearch('Nicho gatos minimal');
  await progressOpportunity(id, FNS_OK);

  const detail = await getOpportunityDetail(id) as any;
  assert.equal(detail.opportunity.status, 'awaiting_approval');
  assert.equal(detail.evidence.length, 4);
  assert.ok(detail.proposal, 'debe existir propuesta');
  assert.equal(detail.proposal.status, 'awaiting_approval');
  // Seguridad: el presupuesto lo capa el código, no el LLM (pidió 100000).
  assert.equal(detail.proposal.proposed_budget_usd, 50);
  // Seguridad: los campos de autoridad del LLM no sobreviven en el contenido.
  const content = JSON.parse(detail.proposal.content);
  assert.equal(content.approved, undefined);
  assert.equal(content.can_create, undefined);
  assert.equal(content.is_admin, undefined);
  assert.equal(content.tools, undefined);

  // Existe una Decision de aprobación, pero NO está aprobada.
  const decision = await get<any>('SELECT id, status FROM decisions WHERE entity_type = ? AND entity_id = ?', ['business_proposal', detail.proposal.id]);
  assert.ok(decision);
  assert.equal(decision.status, 'proposed');
  // Sin aprobación humana → NO hay venture.
  const v = await get('SELECT id FROM ventures WHERE source_proposal_id = ?', [detail.proposal.id]);
  assert.equal(v, undefined);
});

test('aprobación HUMANA crea la venture (presupuesto capado) y es idempotente', async () => {
  const id = await oppWithResearch('Nicho aprobable');
  await progressOpportunity(id, FNS_OK);
  const detail = await getOpportunityDetail(id) as any;
  const decision = await get<any>('SELECT id FROM decisions WHERE entity_type = ? AND entity_id = ?', ['business_proposal', detail.proposal.id]);

  // Flujo real de la ruta HTTP: approveDecision + resolveDecisionApproval.
  const approved = await approveDecision(decision.id, 'Jorge');
  await resolveDecisionApproval(approved);

  const venture = await get<any>('SELECT id, budget_allocated_usd FROM ventures WHERE source_proposal_id = ?', [detail.proposal.id]);
  assert.ok(venture, 'debe crearse la venture');
  assert.equal(venture.budget_allocated_usd, 50); // capado por el código
  assert.equal((await getOpportunity(id))!.status, 'created');

  // Idempotencia: re-resolver o re-crear no duplica.
  await resolveDecisionApproval(approved);
  await createVentureFromProposal(detail.proposal.id);
  const count = await get<{ c: number }>('SELECT COUNT(*) as c FROM ventures WHERE source_proposal_id = ?', [detail.proposal.id]);
  assert.equal(count!.c, 1);
});

test('rechazo HUMANO no crea venture y marca propuesta/oportunidad rechazadas', async () => {
  const id = await oppWithResearch('Nicho rechazable');
  await progressOpportunity(id, FNS_OK);
  const detail = await getOpportunityDetail(id) as any;
  const decision = await get<any>('SELECT id FROM decisions WHERE entity_type = ? AND entity_id = ?', ['business_proposal', detail.proposal.id]);

  const rejected = await rejectDecision(decision.id, 'Jorge');
  await resolveDecisionRejection(rejected);

  assert.equal((await getOpportunity(id))!.status, 'rejected');
  const prop = await get<any>('SELECT status FROM business_proposals WHERE id = ?', [detail.proposal.id]);
  assert.equal(prop.status, 'rejected');
  const v = await get('SELECT id FROM ventures WHERE source_proposal_id = ?', [detail.proposal.id]);
  assert.equal(v, undefined);
});

test('evidencia insuficiente (< MIN_EVIDENCE) → insufficient_evidence, sin propuesta', async () => {
  const id = await oppWithResearch('Nicho flojo');
  const pocas: PipelineFns['extract'] = async () => [
    { kind: 'inference', claim: 'quizás', confidence: 30 },
    { kind: 'hypothesis', claim: 'tal vez', confidence: 20 },
  ];
  await progressOpportunity(id, { extract: pocas, judge: judgeOK, monetize: monetizeGreedy });

  assert.equal((await getOpportunity(id))!.status, 'insufficient_evidence');
  const detail = await getOpportunityDetail(id) as any;
  assert.equal(detail.proposal, null);
});

test('contradicción en la evidencia → needs_human_review (no se oculta, no avanza)', async () => {
  const id = await oppWithResearch('Nicho contradictorio');
  const conflictiva: PipelineFns['extract'] = async () => [
    { kind: 'fact', claim: 'demanda alta', source: 'https://a.example', confidence: 80 },
    { kind: 'fact', claim: 'demanda nula', source: 'https://b.example', confidence: 75, conflicts_with_index: 0 },
    { kind: 'inference', claim: 'incierto', confidence: 50 },
    { kind: 'fact', claim: 'competencia baja', source: 'https://c.example', confidence: 60 },
  ];
  await progressOpportunity(id, { extract: conflictiva, judge: judgeOK, monetize: monetizeGreedy });

  const opp = (await getOpportunity(id))!;
  assert.equal(opp.status, 'validating'); // se queda en el gate de validación
  assert.equal(opp.validation_status, 'needs_human_review');
  const detail = await getOpportunityDetail(id) as any;
  assert.equal(detail.proposal, null);
});

test('investigación fallida → oportunidad failed, sin evidencia ni propuesta', async () => {
  const id = await oppWithResearch('Nicho fallido', 'failed');
  await progressOpportunity(id, FNS_OK);
  const detail = await getOpportunityDetail(id) as any;
  assert.equal(detail.opportunity.status, 'failed');
  assert.equal(detail.evidence.length, 0);
  assert.equal(detail.proposal, null);
});

test('defensa en creación: capBudget aplica aunque la propuesta traiga 1000 USD', async () => {
  // Propuesta insertada directamente con presupuesto fuera de rango (simula bypass del monetize).
  const opp = await createOpportunity({ title: 'Presupuesto abusivo', fundingVentureId: V });
  const p = await run(
    `INSERT INTO business_proposals (opportunity_id, content, proposed_budget_usd, proposed_name, proposed_type, status) VALUES (?, '{}', 1000, 'Abuso', 'store', 'awaiting_approval')`,
    [opp.id]
  );
  await run(`UPDATE opportunities SET status = 'awaiting_approval' WHERE id = ?`, [opp.id]);
  await createVentureFromProposal(p.lastID);
  const venture = await get<any>('SELECT budget_allocated_usd FROM ventures WHERE source_proposal_id = ?', [p.lastID]);
  assert.equal(venture.budget_allocated_usd, 50); // tope duro, no 1000
});

test('auditoría: cadena de eventos F11 correlacionada y SIN filtrar claims de evidencia', async () => {
  const SECRETO = 'CLAIM_SENTINELA_NO_DEBE_APARECER_EN_AUDIT';
  const id = await oppWithResearch('Nicho auditado');
  const conSecreto: PipelineFns['extract'] = async () => [
    { kind: 'fact', claim: SECRETO, source: 'https://s.example', confidence: 80 },
    { kind: 'inference', claim: 'otra', confidence: 60 },
    { kind: 'hypothesis', claim: 'más', confidence: 50 },
    { kind: 'fact', claim: 'cuarta', source: 'https://d.example', confidence: 70 },
  ];
  await progressOpportunity(id, { extract: conSecreto, judge: judgeOK, monetize: monetizeGreedy });

  const types = (await listAuditEvents({ ventureId: V })).map((e) => e.type);
  for (const t of ['opportunity.created', 'research.started', 'research.completed', 'validation.completed', 'monetization.completed', 'business.proposed', 'business.approval_requested']) {
    assert.ok(types.includes(t), `falta evento ${t}`);
  }
  // La auditoría guarda ids y contadores, nunca el texto de la evidencia.
  const metas = await all<{ payload: string | null }>('SELECT payload FROM event_log');
  assert.ok(metas.every((m) => !(m.payload ?? '').includes(SECRETO)), 'la evidencia NO debe filtrarse a la auditoría');
});
