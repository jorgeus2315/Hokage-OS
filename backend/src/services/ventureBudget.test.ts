import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get } from '../db/init.js';
import { getRoleDefinition } from './roleService.js';
import { estimateTaskCostUsd } from './aiService.js';
import {
  getVentureBudget, ventureOverRealBudget, reserveVentureBudget, releaseVentureBudget, agentMonthlySpent,
} from './ventureBudget.js';
import { createCommand, getCommand, onHokageTaskCompleted, attemptReplan } from './hokageOrchestrator.js';
import type { RawPlanForTest } from './hokageOrchestrator.js';

// ═══ Tests de presupuesto por venture (Fase 7). BD aislada vía HOKAGE_DB_PATH. ═══

const plan = (phases: Array<{ tasks: Array<{ role: string; title: string; task: string }> }>) =>
  async (): Promise<RawPlanForTest> => ({ phases });

let EST = 0; // coste estimado por tarea del rol 'finanzas'

async function mkVenture(name: string, allocated: number): Promise<number> {
  const r = await run(
    `INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES (?, 'store', 'active', ?)`,
    [name, allocated]
  );
  return r.lastID;
}
async function addRealCost(ventureId: number, usd: number): Promise<void> {
  // Simula coste real registrado (lo que askAgent escribiría). agent_id 1 = Hokage sembrado.
  await run('INSERT INTO agent_costs (agent_id, venture_id, tokens_in, tokens_out, llm_cost_usd) VALUES (1, ?, 0, 0, ?)', [ventureId, usd]);
}

before(async () => {
  await initSchema();
  const def = await getRoleDefinition('finanzas');
  EST = estimateTaskCostUsd(def!.model);
  assert.ok(EST > 0, 'estimación de coste debe ser > 0');
});

test('sin tope (budget 0) no bloquea y no reserva — comportamiento previo intacto', async () => {
  const v = await mkVenture('Sin tope', 0);
  const { tasks } = await createCommand({ text: 'trabajo', ventureId: v }, plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]));
  assert.equal(tasks[0].status, 'dispatched');
  assert.equal(tasks[0].reserved_usd, 0);
  const b = await getVentureBudget(v);
  assert.equal(b!.capped, false);
  assert.equal(b!.available, Infinity);
});

test('presupuesto suficiente → ejecuta y reserva el estimado', async () => {
  const v = await mkVenture('Holgada', 10 * EST);
  const { tasks } = await createCommand({ text: 'trabajo', ventureId: v }, plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]));
  assert.equal(tasks[0].status, 'dispatched');
  assert.ok(Math.abs(tasks[0].reserved_usd - EST) < 1e-9);
  const b = await getVentureBudget(v);
  assert.ok(Math.abs(b!.reserved - EST) < 1e-9);
  assert.ok(Math.abs(b!.available - (10 * EST - EST)) < 1e-9);
});

test('en el límite → permitido exactamente hasta el tope; el siguiente gasto se bloquea', async () => {
  const v = await mkVenture('Ajustada', 2 * EST); // caben exactamente 2 tareas
  const { tasks } = await createCommand(
    { text: 'tres tareas', ventureId: v },
    plan([{ tasks: [
      { role: 'finanzas', title: 'A', task: 'a' },
      { role: 'finanzas', title: 'B', task: 'b' },
      { role: 'finanzas', title: 'C', task: 'c' },
    ] }])
  );
  const dispatched = tasks.filter((t) => t.status === 'dispatched');
  const blocked = tasks.filter((t) => t.status === 'blocked');
  assert.equal(dispatched.length, 2, 'exactamente 2 caben en el presupuesto');
  assert.equal(blocked.length, 1, 'la 3ª se bloquea');
  assert.match(blocked[0].error ?? '', /presupuesto de la venture/);
});

test('concurrencia: dos reservas simultáneas no pueden superar el tope', async () => {
  const v = await mkVenture('Carrera', EST); // solo cabe UNA
  const [r1, r2] = await Promise.all([
    reserveVentureBudget(v, EST),
    reserveVentureBudget(v, EST),
  ]);
  const ok = [r1, r2].filter((r) => r !== null);
  const blocked = [r1, r2].filter((r) => r === null);
  assert.equal(ok.length, 1, 'solo una reserva concurrente cabe');
  assert.equal(blocked.length, 1, 'la otra se bloquea');
  const b = await getVentureBudget(v);
  assert.ok(b!.reserved <= EST + 1e-9, 'el comprometido nunca supera el tope');
});

test('aislamiento: costes y reservas de una venture no afectan a otra', async () => {
  const a = await mkVenture('A', 100 * EST);
  const b = await mkVenture('B', 100 * EST);
  await reserveVentureBudget(a, 5 * EST);
  await addRealCost(a, 3 * EST);
  await addRealCost(b, 7 * EST);
  const ba = await getVentureBudget(a);
  const bb = await getVentureBudget(b);
  assert.ok(Math.abs(ba!.reserved - 5 * EST) < 1e-9);
  assert.ok(Math.abs(ba!.real - 3 * EST) < 1e-9);
  assert.equal(bb!.reserved, 0, 'B no tiene reservas de A');
  assert.ok(Math.abs(bb!.real - 7 * EST) < 1e-9, 'el coste real de B es solo el suyo');
});

test('planner: si la venture ya superó su presupuesto real, NO se planifica (no se gasta)', async () => {
  const v = await mkVenture('Agotada', 2 * EST);
  await addRealCost(v, 2 * EST); // real == allocated → over budget
  assert.equal(await ventureOverRealBudget(v), true);
  const { command, tasks } = await createCommand({ text: 'no debería planificar', ventureId: v }, plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]));
  assert.equal(command.status, 'failed');
  assert.equal(tasks.length, 0, 'no se generó ninguna tarea (no se llamó al planner)');
  assert.match(command.plan_summary ?? '', /budget.*exhausted/);
});

test('replan no puede eludir el presupuesto', async () => {
  const v = await mkVenture('ReplanAgotada', 2 * EST);
  await addRealCost(v, 2 * EST);
  const c = await run(`INSERT INTO hokage_commands (venture_id, text, status) VALUES (?, 'x', 'active')`, [v]);
  await run(`INSERT INTO hokage_tasks (command_id, phase, role, title, prompt, status) VALUES (?, 0, 'finanzas', 'F', 'x', 'failed')`, [c.lastID]);
  const ok = await attemptReplan(c.lastID, plan([{ tasks: [{ role: 'contenido', title: 'Nueva', task: 'y' }] }]));
  assert.equal(ok, false, 'el replan se rechaza por presupuesto');
});

test('liberación: al terminar una tarea se libera su reserva (idempotente, sin negativos)', async () => {
  const v = await mkVenture('Libera', 10 * EST);
  const { tasks } = await createCommand({ text: 'una tarea', ventureId: v }, plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]));
  const wi = tasks[0].work_item_id!;
  const before = await getVentureBudget(v);
  assert.ok(before!.reserved > 0);

  await onHokageTaskCompleted(wi, true, 'hecho'); // libera
  await onHokageTaskCompleted(wi, true, 'otra vez'); // idempotente: no doble-libera
  const after = await getVentureBudget(v);
  assert.equal(after!.reserved, 0, 'reserva liberada exactamente una vez');
  assert.ok(after!.reserved >= 0, 'nunca negativo');
});

test('idempotencia de comando: misma clave no duplica reservas', async () => {
  const v = await mkVenture('Idem', 10 * EST);
  const p = plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]);
  const first = await createCommand({ text: 'idem', ventureId: v, idempotencyKey: 'k7' }, p);
  const second = await createCommand({ text: 'idem', ventureId: v, idempotencyKey: 'k7' }, p);
  assert.equal(second.command.id, first.command.id);
  const b = await getVentureBudget(v);
  assert.ok(Math.abs(b!.reserved - EST) < 1e-9, 'solo una reserva, no dos');
});

test('ventureOverRealBudget: true en/ sobre tope, false por debajo o sin tope', async () => {
  const capped = await mkVenture('Cap', 2 * EST);
  assert.equal(await ventureOverRealBudget(capped), false);
  await addRealCost(capped, 2 * EST);
  assert.equal(await ventureOverRealBudget(capped), true);
  const uncapped = await mkVenture('NoCap', 0);
  await addRealCost(uncapped, 999);
  assert.equal(await ventureOverRealBudget(uncapped), false, 'sin tope nunca está "sobre presupuesto"');
  assert.equal(await ventureOverRealBudget(null), false);
});

test('releaseVentureBudget no deja el comprometido en negativo', async () => {
  const v = await mkVenture('NoNeg', 10 * EST);
  await reserveVentureBudget(v, EST);
  await releaseVentureBudget(v, 5 * EST); // libera más de lo reservado
  const b = await getVentureBudget(v);
  assert.equal(b!.reserved, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Paso 2 (ADR-015) — cobertura adicional del contrato de presupuesto/costes.
// UNIT, determinista: sin OpenRouter/red/proveedor — agent_costs se siembra por SQL.
// ═══════════════════════════════════════════════════════════════════════════

// Crea un agente aislado para tests de gasto por agente (FK agent_costs.agent_id → agents).
async function mkAgent(name: string): Promise<number> {
  const r = await run(`INSERT INTO agents (name, role, status) VALUES (?, 'finanzas', 'idle')`, [name]);
  return r.lastID;
}

// Inserta una fila de coste real controlando agente, venture, importe y antigüedad.
// previousMonth=true → mediados del mes anterior (usa 'start of month' para evitar el clamping
// de día de SQLite, p. ej. "31 - 1 mes"). Por defecto → mes en curso (datetime('now')).
async function addCostRow(agentId: number, ventureId: number | null, usd: number, opts: { previousMonth?: boolean } = {}): Promise<void> {
  const when = opts.previousMonth ? `datetime('now','start of month','-15 days')` : `datetime('now')`;
  await run(
    `INSERT INTO agent_costs (agent_id, venture_id, model, tokens_in, tokens_out, llm_cost_usd, tool_cost_usd, created_at)
     VALUES (?, ?, 'test-model', 0, 0, ?, 0, ${when})`,
    [agentId, ventureId, usd]
  );
}

// ORÁCULO del contrato agentMonthlySpent (Paso 3 — aún NO en producción). Gasto del MES EN CURSO
// de un agente en una venture, derivado de agent_costs: mes natural por created_at, venture_id
// NULL-safe con IS (mismo patrón que stage2). La función de producción del Paso 3 DEBE igualar
// este oráculo. Se define aquí como contrato ejecutable, sin tocar producción.
async function monthlySpentOracle(agentId: number, ventureId: number | null): Promise<number> {
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

// ── reserve / get / release: casos que faltaban ──────────────────────────────

test('reserve: presupuesto disponible → reserva el importe pedido y baja el disponible', async () => {
  const v = await mkVenture('Disp', 10 * EST);
  const r = await reserveVentureBudget(v, 3 * EST);
  assert.ok(r !== null && Math.abs(r - 3 * EST) < 1e-9, 'devuelve el importe reservado');
  const b = await getVentureBudget(v);
  assert.ok(Math.abs(b!.available - 7 * EST) < 1e-9);
});

test('reserve: límite EXACTO → permitido justo hasta el tope; el siguiente µ-gasto se bloquea', async () => {
  const v = await mkVenture('Exacta', 2 * EST);
  assert.ok(await reserveVentureBudget(v, EST) !== null, '1ª reserva cabe');
  assert.ok(await reserveVentureBudget(v, EST) !== null, '2ª reserva llena el tope exacto');
  const b = await getVentureBudget(v);
  assert.ok(Math.abs(b!.reserved - 2 * EST) < 1e-9, 'reservado == tope');
  assert.equal(await reserveVentureBudget(v, 1e-6), null, 'un céntimo por encima del tope se bloquea');
});

test('reserve: presupuesto excedido (real ya en el tope) → bloquea la reserva', async () => {
  const v = await mkVenture('Excedida', 2 * EST);
  await addRealCost(v, 2 * EST); // real == allocated
  assert.equal(await reserveVentureBudget(v, 1e-6), null);
});

test('release: devuelve exactamente lo reservado y restaura el disponible', async () => {
  const v = await mkVenture('Rel', 10 * EST);
  await reserveVentureBudget(v, 4 * EST);
  await releaseVentureBudget(v, 4 * EST);
  const b = await getVentureBudget(v);
  assert.equal(b!.reserved, 0);
  assert.ok(Math.abs(b!.available - 10 * EST) < 1e-9, 'disponible restaurado al total');
});

test('getVentureBudget: múltiples filas de agent_costs se suman en real', async () => {
  const v = await mkVenture('Suma', 100 * EST);
  await addRealCost(v, EST);
  await addRealCost(v, 2 * EST);
  await addRealCost(v, 3 * EST);
  const b = await getVentureBudget(v);
  assert.ok(Math.abs(b!.real - 6 * EST) < 1e-9, 'real = suma de las 3 filas');
});

test('venture_id = NULL: no cuenta en el presupuesto de ninguna venture y reserve(null)=0', async () => {
  const v = await mkVenture('ConTope', 10 * EST);
  const a = await mkAgent('null-cost');
  await addCostRow(a, null, 5 * EST); // coste GLOBAL, sin venture
  const b = await getVentureBudget(v);
  assert.equal(b!.real, 0, 'el coste con venture_id NULL no afecta a la venture con tope');
  assert.equal(await reserveVentureBudget(null, 5 * EST), 0, 'reserve sin venture → 0 (sin tope): ni bloquea ni reserva');
});

// ── agentMonthlySpent: contrato del gasto mensual DERIVADO (vía oráculo) ──────

test('mensual (contrato): múltiples filas del mes en curso se suman', async () => {
  const v = await mkVenture('MesSuma', 0);
  const a = await mkAgent('mes-suma');
  await addCostRow(a, v, 0.01);
  await addCostRow(a, v, 0.02);
  assert.ok(Math.abs(await monthlySpentOracle(a, v) - 0.03) < 1e-9);
});

test('mensual (contrato): costes de meses anteriores NO cuentan en el mes actual', async () => {
  const v = await mkVenture('MesPrev', 0);
  const a = await mkAgent('mes-prev');
  await addCostRow(a, v, 0.05, { previousMonth: true }); // mes pasado → excluido
  await addCostRow(a, v, 0.02);                          // mes actual
  assert.ok(Math.abs(await monthlySpentOracle(a, v) - 0.02) < 1e-9, 'solo el gasto del mes en curso');
});

test('mensual (contrato): aislamiento entre agentes en la misma venture', async () => {
  const v = await mkVenture('MesAgentes', 0);
  const a1 = await mkAgent('mes-a1');
  const a2 = await mkAgent('mes-a2');
  await addCostRow(a1, v, 0.01);
  await addCostRow(a2, v, 0.09);
  assert.ok(Math.abs(await monthlySpentOracle(a1, v) - 0.01) < 1e-9);
  assert.ok(Math.abs(await monthlySpentOracle(a2, v) - 0.09) < 1e-9);
});

test('mensual (contrato): aislamiento entre ventures del mismo agente', async () => {
  const v1 = await mkVenture('MesV1', 0);
  const v2 = await mkVenture('MesV2', 0);
  const a = await mkAgent('mes-ventures');
  await addCostRow(a, v1, 0.01);
  await addCostRow(a, v2, 0.02);
  assert.ok(Math.abs(await monthlySpentOracle(a, v1) - 0.01) < 1e-9);
  assert.ok(Math.abs(await monthlySpentOracle(a, v2) - 0.02) < 1e-9);
});

test('mensual (contrato): venture_id = NULL es su propio cubo global, aislado de las ventures', async () => {
  const v = await mkVenture('MesNull', 0);
  const a = await mkAgent('mes-null');
  await addCostRow(a, v, 0.02);
  await addCostRow(a, null, 0.03);
  assert.ok(Math.abs(await monthlySpentOracle(a, v) - 0.02) < 1e-9, 'la venture no ve el gasto global');
  assert.ok(Math.abs(await monthlySpentOracle(a, null) - 0.03) < 1e-9, 'el cubo global tiene su propio gasto');
});

// ── CONTRATO (Paso 3): agentMonthlySpent ya en producción. Debe igualar monthlySpentOracle() y
// respetar la semántica: mes en curso, agente/venture aislados, venture_id NULL como ámbito propio,
// meses anteriores excluidos. Verifica valores concretos Y la igualdad con el oráculo. ────────────
test('CONTRATO agentMonthlySpent(agentId, ventureId) === monthlySpentOracle (producción)', async () => {
  const v = await mkVenture('ContratoMensual', 0);
  const a = await mkAgent('contrato-mensual');
  await addCostRow(a, v, 0.01);                          // mes actual, venture v
  await addCostRow(a, v, 0.02, { previousMonth: true }); // mes anterior → NO cuenta
  await addCostRow(a, null, 0.05);                       // ámbito global (venture_id NULL)

  // Valores concretos del contrato
  assert.ok(Math.abs(await agentMonthlySpent(a, v) - 0.01) < 1e-9, 'venture: solo el gasto del mes en curso');
  assert.ok(Math.abs(await agentMonthlySpent(a, null) - 0.05) < 1e-9, 'NULL: su propio ámbito global, aislado');

  // Igualdad exacta con el oráculo del Paso 2 (la implementación no debe divergir del contrato)
  assert.equal(await agentMonthlySpent(a, v), await monthlySpentOracle(a, v));
  assert.equal(await agentMonthlySpent(a, null), await monthlySpentOracle(a, null));
});
