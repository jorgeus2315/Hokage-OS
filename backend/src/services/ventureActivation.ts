import { run, get } from '../db/init.js';
import { recordAudit } from './auditService.js';
import { createCommand, type RawPlanForTest } from './hokageOrchestrator.js';

// ═══════════════════════════════════════════════════════════════════════════
// ventureActivation — cierre del lazo F11 → operación (Fase 12).
// ═══════════════════════════════════════════════════════════════════════════
//
// Una venture aprobada por el gate humano de F11 nace con presupuesto pero INERTE. Aquí, EXACTAMENTE
// UNA VEZ por venture, se le compone un brief DETERMINISTA desde su propuesta y se arranca trabajo
// real por el orquestador F5 (createCommand), con el hilo venture_id intacto (F7 presupuesto,
// F8 memoria, F9 auditoría). No hay segundo orquestador ni segundo presupuesto. La activación NO
// crea agentes ni departamentos (ADR-006): asigna contexto y despacha trabajo.
//
// Idempotencia en dos capas (el orden importa): (1) createCommand deduplica por idempotency_key
// → un único command aunque haya concurrencia o retry (garantía primaria); (2) el CAS sobre
// activated_at elige un único ganador que sella el marcador y emite el audit. activated_at se fija
// DESPUÉS de crear el command, así un crash entre ambos deja activated_at NULL → reintentable,
// reusando la misma key (sin command zombi ni doble trabajo).

export type DecomposeFn = (text: string, ventureId: number | null) => Promise<RawPlanForTest | null>;

export interface ActivationResult {
  activated: boolean;
  commandId?: number;
  reason?: 'no_budget' | 'already_activated' | 'no_venture';
}

interface VentureRow {
  id: number; name: string; goal: string | null; type: string;
  budget_allocated_usd: number; activated_at: string | null; source_proposal_id: number | null;
}

const idempotencyKeyFor = (ventureId: number) => `venture-activation-${ventureId}`;

// Brief DETERMINISTA (decisión 7.3): compuesto por CÓDIGO desde la propuesta ya aprobada y
// sanitizada en F11. Las claves de content las puso el LLM y NO están garantizadas → lectura
// defensiva: cada línea solo si la clave existe y no está vacía. Cero llamadas IA aquí; el trabajo
// inteligente entra por el decompose de F5.
function composeBrief(v: VentureRow, content: Record<string, unknown>): string {
  const lines: string[] = [
    `Arranca la operación de la venture «${v.name}» (tipo: ${v.type}). Presupuesto disponible: ${v.budget_allocated_usd} USD.`,
  ];
  const push = (label: string, k: string) => {
    const val = content[k];
    if (typeof val === 'string' && val.trim()) lines.push(`${label}: ${val.trim()}`);
  };
  push('Cliente objetivo', 'target_customer');
  push('Problema', 'problem');
  push('Propuesta de valor', 'value_proposition');
  push('Modelo de ingresos', 'revenue_model');
  push('Hipótesis de precio', 'price_hypothesis');
  const assumptions = content.key_assumptions;
  if (Array.isArray(assumptions) && assumptions.length) {
    lines.push(`Supuestos clave a validar primero: ${assumptions.map(String).slice(0, 10).join('; ')}`);
  }
  lines.push('Define y ejecuta los primeros pasos concretos para poner en marcha esta venture, repartiendo el trabajo entre los especialistas adecuados. Prioriza validar los supuestos de mayor riesgo antes de comprometer presupuesto.');
  return lines.join('\n');
}

// goal derivado: propuesta de valor si existe, si no un objetivo genérico. Reemplaza el placeholder
// "Creada desde propuesta #N" de F11.
function deriveGoal(v: VentureRow, content: Record<string, unknown>): string {
  const vp = content.value_proposition;
  if (typeof vp === 'string' && vp.trim()) return vp.trim().slice(0, 200);
  return `Operar y validar la venture ${v.name}`;
}

// Idempotente. source distingue el disparador (aprobación humana F11 vs. endpoint de retry).
// decomposeFn solo se inyecta en tests (evita la IA); en producción createCommand usa el real.
export async function activateVenture(
  ventureId: number,
  source: 'approval' | 'endpoint' = 'endpoint',
  decomposeFn?: DecomposeFn
): Promise<ActivationResult> {
  const v = await get<VentureRow>(
    'SELECT id, name, goal, type, budget_allocated_usd, activated_at, source_proposal_id FROM ventures WHERE id = ?',
    [ventureId]
  );
  if (!v) return { activated: false, reason: 'no_venture' };
  if (v.activated_at != null) { // fast-path idempotente
    await recordAudit({ type: 'venture.activation_skipped', ventureId, meta: { reason: 'already_activated' } });
    return { activated: false, reason: 'already_activated' };
  }
  if (v.budget_allocated_usd <= 0) { // DECISIÓN 7.1: sin presupuesto explícito no se auto-activa
    await recordAudit({ type: 'venture.activation_skipped', ventureId, meta: { reason: 'no_budget' } });
    return { activated: false, reason: 'no_budget' };
  }

  await recordAudit({ type: 'venture.activation_requested', ventureId, meta: { source } });

  try {
    const proposal = v.source_proposal_id != null
      ? await get<{ content: string }>('SELECT content FROM business_proposals WHERE id = ?', [v.source_proposal_id])
      : undefined;
    let content: Record<string, unknown> = {};
    try { content = proposal?.content ? JSON.parse(proposal.content) : {}; } catch { content = {}; }

    const brief = composeBrief(v, content);
    // F5 orquesta + auto-despacha; idempotency_key deduplica ante concurrencia/retry (garantía primaria).
    const cmd = await createCommand({ text: brief, ventureId, idempotencyKey: idempotencyKeyFor(ventureId) }, decomposeFn);

    // CAS: sella activated_at DESPUÉS de existir el command → un único ganador emite el audit y fija goal.
    const r = await run(
      `UPDATE ventures SET goal = ?, activated_at = datetime('now') WHERE id = ? AND activated_at IS NULL`,
      [deriveGoal(v, content), ventureId]
    );
    if (r.changes === 1) {
      await recordAudit({ type: 'venture.activated', ventureId, commandId: cmd.command.id, meta: { proposalId: v.source_proposal_id ?? null } });
    }
    return { activated: r.changes === 1, commandId: cmd.command.id };
  } catch (err) {
    // Corrección de consistencia: registra el fallo (solo el mensaje, sin secretos) y propaga → retry.
    await recordAudit({ type: 'venture.activation_failed', ventureId, meta: { error: (err as Error).message } });
    throw err;
  }
}
