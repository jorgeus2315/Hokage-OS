import { run, get, all } from '../db/init.js';
import { createDecision } from './decisionService.js';

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
//
// Fase 2: budgets son por venture/business (agent_budgets.venture_id). Umbrales:
//   <80% → normal
//   >=80% → warning
//   >=100% → bloqueo + Decision `budget_request`

export interface VentureBudget {
  ventureId: number;
  allocated: number;   // 1 · asignado
  reserved: number;    // 2a · comprometido/reservado en vuelo
  real: number;        // 2b · coste real registrado
  available: number;   // 3 · saldo disponible (Infinity si no hay tope)
  capped: boolean;     // allocated > 0
  pctUsed: number;     // porcentaje usado (real + reserved) / allocated
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
  const used = real + v.budget_spent_usd;
  const pctUsed = capped && v.budget_allocated_usd > 0 ? used / v.budget_allocated_usd : 0;
  return {
    ventureId,
    allocated: v.budget_allocated_usd,
    reserved: v.budget_spent_usd,
    real,
    available: capped ? v.budget_allocated_usd - used : Infinity,
    capped,
    pctUsed,
  };
}

// Gasto REAL del MES EN CURSO de un agente en un ámbito de venture, derivado EXCLUSIVAMENTE de
// agent_costs (fuente única de verdad del coste — ADR-015). Reemplaza al acumulador almacenado
// agent_budgets.current_month_usd (que se retira en un paso posterior; aquí NO se toca todavía).
//   - mes natural en curso (por created_at, comparación lexicográfica ISO — created_at es
//     'YYYY-MM-DD HH:MM:SS'); los meses anteriores quedan fuera de la ventana.
//   - agent_id aislado; venture_id aislado; venture_id NULL es su PROPIO ámbito (global/sin
//     venture), tratado NULL-safe con `IS` (mismo patrón que stage2). No mezcla ámbitos.
export async function agentMonthlySpent(agentId: number, ventureId: number | null): Promise<number> {
  const row = await get<{ c: number }>(
    `SELECT COALESCE(SUM(llm_cost_usd + tool_cost_usd), 0) AS c
       FROM agent_costs
      WHERE agent_id = ?
        AND venture_id IS ?
        AND created_at >= strftime('%Y-%m-01 00:00:00','now')
        AND created_at <  strftime('%Y-%m-01 00:00:00','now','+1 month')`,
    [agentId, ventureId]
  );
  return row?.c ?? 0;
}

// ¿La venture ya consumió (REAL) su presupuesto? Defensa en profundidad en askAgent: ninguna
// llamada a IA si el coste real ya alcanzó el tope, aunque una reserva se hubiera quedado corta.
export async function ventureOverRealBudget(ventureId: number | null | undefined): Promise<boolean> {
  if (ventureId == null) return false;
  const b = await getVentureBudget(ventureId);
  if (!b || !b.capped) return false;
  return b.real >= b.allocated;
}

// Umbrales de alerta por venture (Fase 2)
export interface BudgetAlert {
  ventureId: number;
  pctUsed: number;
  level: 'normal' | 'warning' | 'critical';
  blocked: boolean;
}

export async function checkVentureBudgetAlert(ventureId: number | null | undefined): Promise<BudgetAlert | null> {
  if (ventureId == null) return null;
  const b = await getVentureBudget(ventureId);
  if (!b || !b.capped) return { ventureId, pctUsed: 0, level: 'normal', blocked: false };

  if (b.pctUsed >= 1.0) return { ventureId, pctUsed: b.pctUsed, level: 'critical', blocked: true };
  if (b.pctUsed >= 0.8) return { ventureId, pctUsed: b.pctUsed, level: 'warning', blocked: false };
  return { ventureId, pctUsed: b.pctUsed, level: 'normal', blocked: false };
}

// Crea Decision `budget_request` cuando venture alcanza >=100% (bloqueo)
export async function createBudgetRequestDecision(ventureId: number, agentId: number | null): Promise<void> {
  const b = await getVentureBudget(ventureId);
  console.log('[DEBUG createBudgetRequestDecision] ventureId:', ventureId, 'agentId:', agentId, 'budget:', b);
  if (!b || !b.capped) return;

  // Debug: check ALL decisions for this venture
  const allDecisions = await all<{ id: number; title: string; category: string; status: string }>(
    `SELECT id, title, category, status FROM decisions WHERE venture_id = ?`,
    [ventureId]
  );
  console.log('[DEBUG createBudgetRequestDecision] ALL decisions for venture:', allDecisions);

  // Evitar duplicados recientes (misma venture, misma categoría, proposed)
  const existing = await get<{ id: number }>(
    `SELECT id FROM decisions
     WHERE venture_id = ? AND category = 'FINANCIAL' AND status = 'proposed'
     AND title LIKE '%Presupuesto venture%' LIMIT 1`,
    [ventureId]
  );
  console.log('[DEBUG createBudgetRequestDecision] existing:', existing);
  if (existing) return;

  const allocated = b.allocated;
  const used = b.real + b.reserved;
  const pct = (b.pctUsed * 100).toFixed(0);

  await createDecision({
    agent_id: agentId,
    venture_id: ventureId,
    title: `Presupuesto venture agotado (${pct}% usado)`,
    description: `La venture ha consumido ${used.toFixed(4)} USD de ${allocated} USD asignados. Se requiere ampliar el presupuesto para continuar operaciones.`,
    reasoning: 'Bloqueo automático por alcanzar el 100% del presupuesto asignado a la venture.',
    risk_level: 'high',
    amount: allocated * 0.5, // sugerencia: +50%
  });
  console.log('[DEBUG createBudgetRequestDecision] decision created');
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
