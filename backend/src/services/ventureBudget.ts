import { run, get } from '../db/init.js';

// ═══════════════════════════════════════════════════════════════════════════
// ventureBudget — techo económico DURO por venture (Fase 7).
// ═══════════════════════════════════════════════════════════════════════════
//
// Reutiliza fuentes existentes, sin segunda verdad:
//   - allocated = ventures.budget_allocated_usd (0 = SIN tope → comportamiento previo intacto).
//   - real      = SUM(agent_costs.llm_cost_usd + tool_cost_usd) WHERE venture_id = V  (coste real).
//   - reserved  = ventures.budget_spent_usd (comprometido en vuelo; antes sin uso).
//   - available = allocated - real - reserved  (solo si allocated > 0).
//
// El guard es duro bajo concurrencia porque la reserva es UN ÚNICO UPDATE condicional: SQLite
// serializa las escrituras, así que dos reservas simultáneas de la misma venture no pueden
// ambas superar el tope — cada una ve el efecto de la anterior. No hay locks globales.
// No modifica agent_budgets (el límite por-rol de 20 USD/mes sigue vigente aparte).

export interface VentureBudget {
  ventureId: number;
  allocated: number;   // 1 · asignado
  reserved: number;    // 2a · comprometido/reservado en vuelo
  real: number;        // 2b · coste real registrado
  available: number;   // 3 · saldo disponible (Infinity si no hay tope)
  capped: boolean;     // allocated > 0
}

async function realSpent(ventureId: number): Promise<number> {
  const row = await get<{ c: number }>(
    'SELECT COALESCE(SUM(llm_cost_usd + tool_cost_usd), 0) as c FROM agent_costs WHERE venture_id = ?',
    [ventureId]
  );
  return row?.c ?? 0;
}

export async function getVentureBudget(ventureId: number): Promise<VentureBudget | null> {
  const v = await get<{ budget_allocated_usd: number; budget_spent_usd: number }>(
    'SELECT budget_allocated_usd, budget_spent_usd FROM ventures WHERE id = ?',
    [ventureId]
  );
  if (!v) return null;
  const real = await realSpent(ventureId);
  const capped = v.budget_allocated_usd > 0;
  return {
    ventureId,
    allocated: v.budget_allocated_usd,
    reserved: v.budget_spent_usd,
    real,
    available: capped ? v.budget_allocated_usd - real - v.budget_spent_usd : Infinity,
    capped,
  };
}

// ¿La venture ya consumió (REAL) su presupuesto? Defensa en profundidad en askAgent: ninguna
// llamada a IA si el coste real ya alcanzó el tope, aunque una reserva se hubiera quedado corta.
export async function ventureOverRealBudget(ventureId: number | null | undefined): Promise<boolean> {
  if (ventureId == null) return false;
  const b = await getVentureBudget(ventureId);
  if (!b || !b.capped) return false;
  return b.real >= b.allocated;
}

// Reserva atómica. Devuelve el importe reservado (>0 comprometido; 0 = venture sin tope, se
// permite) o null (BLOQUEADO por presupuesto). Concurrency-safe: un solo UPDATE condicional.
export async function reserveVentureBudget(ventureId: number | null | undefined, estimate: number): Promise<number | null> {
  if (ventureId == null) return 0; // sin venture → sin tope
  const est = Math.max(0, estimate);
  const r = await run(
    `UPDATE ventures SET budget_spent_usd = budget_spent_usd + ?
     WHERE id = ? AND budget_allocated_usd > 0
       AND (COALESCE((SELECT SUM(llm_cost_usd + tool_cost_usd) FROM agent_costs WHERE venture_id = ?), 0)
            + budget_spent_usd + ?) <= budget_allocated_usd`,
    [est, ventureId, ventureId, est]
  );
  if (r.changes === 1) return est; // reservado
  // No se reservó: distinguir "sin tope" (allocated <= 0 → permitido) de "sobre presupuesto".
  const v = await get<{ a: number }>('SELECT budget_allocated_usd as a FROM ventures WHERE id = ?', [ventureId]);
  if (!v || v.a <= 0) return 0; // sin tope → permitido, sin reservar
  return null; // bloqueado por presupuesto
}

// Libera una reserva (al terminar/cancelar la tarea). Idempotente por el llamador (que
// primero pone a 0 el reserved_usd de la tarea y solo entonces libera este importe).
export async function releaseVentureBudget(ventureId: number | null | undefined, amount: number): Promise<void> {
  if (ventureId == null || amount <= 0) return;
  await run('UPDATE ventures SET budget_spent_usd = max(0, budget_spent_usd - ?) WHERE id = ?', [amount, ventureId]);
}
