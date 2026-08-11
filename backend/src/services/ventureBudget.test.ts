import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get } from '../db/init.js';
import { getRoleDefinition } from './roleService.js';
import { estimateTaskCostUsd } from './aiService.js';
import {
  getVentureBudget, ventureOverRealBudget, reserveVentureBudget, releaseVentureBudget,
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
