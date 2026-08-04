import { get, run } from '../db/init.js';
import bus from '../config/eventBus.js';
import { createDecision } from './decisionService.js';
import { OWNER_NAME } from '../config/env.js';

// Objetivos cuyo success_criteria depende de ingresos reales — HOKAGE OS no
// tiene todavia ninguna integracion de ventas (Etsy/Shopify), asi que no puede
// verificar esto automaticamente. Completar los milestones no es prueba de que
// haya entrado dinero de verdad.
const REVENUE_PATTERN = /€|\$|ingres|revenue|venta|facturaci[oó]n|euros?\b/i;

function isRevenueObjective(title: string, successCriteria: string | null): boolean {
  return REVENUE_PATTERN.test(`${title} ${successCriteria ?? ''}`);
}

// Cierra un milestone tras la ejecucion de su work_item y, si era el ultimo
// del plan, decide si el objetivo puede marcarse 'achieved' automaticamente.
export async function closeMilestoneOnResult(milestoneId: number, ok: boolean): Promise<void> {
  await run(
    `UPDATE obj_milestones SET status = ?, completed_at = ? WHERE id = ?`,
    [ok ? 'done' : 'blocked', ok ? new Date().toISOString() : null, milestoneId]
  );

  const milestone = await get<{ plan_id: number; objective_id: number }>(
    'SELECT plan_id, objective_id FROM obj_milestones WHERE id = ?', [milestoneId]
  );
  if (!milestone) return;

  const remaining = await get<{ count: number }>(
    `SELECT COUNT(*) as count FROM obj_milestones WHERE plan_id = ? AND status NOT IN ('done','skipped')`,
    [milestone.plan_id]
  );
  if (!remaining || remaining.count > 0) return;

  await run(`UPDATE obj_plans SET status = 'completed' WHERE id = ?`, [milestone.plan_id]);

  const objective = await get<{ title: string; success_criteria: string | null }>(
    'SELECT title, success_criteria FROM objectives WHERE id = ?', [milestone.objective_id]
  );

  if (objective && isRevenueObjective(objective.title, objective.success_criteria)) {
    // Milestones completados, pero el objetivo depende de ingresos reales que
    // el sistema no puede verificar todavia — pedir confirmacion humana en
    // vez de marcarlo 'achieved' automaticamente.
    await run(`UPDATE objectives SET status = 'pending_review' WHERE id = ?`, [milestone.objective_id]);
    await createDecision({
      entity_type: 'objective',
      entity_id: milestone.objective_id,
      title: `Confirmar objetivo alcanzado — ${objective.title}`,
      description: 'Todos los milestones del plan se completaron, pero este objetivo depende de ingresos reales que HOKAGE OS todavía no puede verificar automáticamente (sin integración de ventas). Confirma manualmente si se alcanzó de verdad.',
      reasoning: 'Los milestones completados por los agentes no garantizan ingresos reales — verificación humana requerida antes de cerrar el objetivo.',
      risk_level: 'low',
    });
    console.log(`[GOAL] Objetivo ${milestone.objective_id} pendiente de confirmación (depende de ingresos reales)`);
    return;
  }

  await run(`UPDATE objectives SET status = 'achieved' WHERE id = ?`, [milestone.objective_id]);
  bus.publish({ type: 'objective.achieved', from: 'Hokage', payload: { objectiveId: milestone.objective_id } });
  console.log(`[GOAL] Objetivo ${milestone.objective_id} COMPLETADO`);
}

// Cierra el objetivo cuando el dueño aprueba la decision de confirmacion (ver arriba).
export async function markObjectiveAchieved(objectiveId: number): Promise<void> {
  await run(`UPDATE objectives SET status = 'achieved' WHERE id = ?`, [objectiveId]);
  bus.publish({ type: 'objective.achieved', from: OWNER_NAME, payload: { objectiveId } });
  console.log(`[GOAL] Objetivo ${objectiveId} confirmado por ${OWNER_NAME}`);
}
