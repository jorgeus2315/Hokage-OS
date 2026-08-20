import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get, all } from '../db/init.js';
import { createCommand, approveCommand, cancelCommand } from './hokageOrchestrator.js';
import type { HokageCommand, HokageTask } from '../types/index.js';

// ═══ C5-C.1 — Gate de aprobación del plan (backend). ═══
// requireApproval planifica sin despachar (0 work_items, 0 reserva); approveCommand despacha
// y pasa a active; doble aprobación idempotente; cancel de awaiting_approval limpio; y sin el
// flag el auto-dispatch actual se mantiene. Planner inyectado → sin LLM real.

before(async () => { await initSchema(); });

// Una tarea válida (mismo contrato que decompose: (text, ventureId) => RawPlan | null).
const onePlan = (async () => ({ phases: [{ tasks: [{ role: 'investigador', title: 'T', task: 'investiga algo' }] }] })) as never;

let seq = 0;
async function uncappedVenture(): Promise<number> {
  // budget_allocated_usd = 0 → sin tope → reserveVentureBudget nunca bloquea el dispatch.
  const r = await run(
    `INSERT INTO ventures (name, type, status, goal, revenue_target_usd, budget_allocated_usd) VALUES (?, 'store', 'active', 'g', 100, 0)`,
    [`VT-gate-${++seq}-${Math.random()}`]
  );
  return r.lastID;
}
const cmdRow = (id: number) => get<HokageCommand>('SELECT * FROM hokage_commands WHERE id = ?', [id]) as Promise<HokageCommand>;
const tasksOfCmd = (id: number) => all<HokageTask>('SELECT * FROM hokage_tasks WHERE command_id = ?', [id]);
const countWorkItems = async () => (await get<{ n: number }>('SELECT COUNT(*) as n FROM work_items'))!.n;
const uniqueText = () => `orden gate ${++seq}-${Math.random()}`;

// Test 1 — el gate retiene: plan persistido, nada despachado/reservado.
test('#1 requireApproval=true → awaiting_approval, plan persistido, 0 work_items, 0 dispatch, 0 reserva', async () => {
  const v = await uncappedVenture();
  const beforeWi = await countWorkItems();
  const { command, tasks } = await createCommand({ text: uniqueText(), ventureId: v, requireApproval: true }, onePlan);

  assert.equal(command.status, 'awaiting_approval');   // gated, no active
  assert.equal(tasks.length, 1);                        // plan persistido
  assert.equal(tasks[0].status, 'pending');            // NO despachada
  assert.equal(tasks[0].work_item_id, null);           // sin work_item
  assert.equal(tasks[0].reserved_usd, 0);              // 0 reserva de presupuesto
  assert.equal(await countWorkItems(), beforeWi);      // 0 work_items creados
});

// Test 2 — aprobar reanuda el dispatch inicial y pasa a active.
test('#2 approveCommand → despacha y pasa a active', async () => {
  const v = await uncappedVenture();
  const beforeWi = await countWorkItems();
  const { command } = await createCommand({ text: uniqueText(), ventureId: v, requireApproval: true }, onePlan);
  assert.equal(command.status, 'awaiting_approval');

  const approved = await approveCommand(command.id);
  assert.ok(approved);
  assert.equal(approved!.command.status, 'active');
  const t = (await tasksOfCmd(command.id))[0];
  assert.equal(t.status, 'dispatched');                // tarea despachada
  assert.ok(t.work_item_id != null);                  // work_item creado
  assert.equal(await countWorkItems(), beforeWi + 1); // exactamente 1
});

// Test 3 — doble aprobación: idempotente, sin segundo dispatch (guard atómico).
test('#3 doble aprobación → idempotente, sin segundo dispatch', async () => {
  const v = await uncappedVenture();
  const { command } = await createCommand({ text: uniqueText(), ventureId: v, requireApproval: true }, onePlan);
  await approveCommand(command.id);
  const wiAfterFirst = await countWorkItems();

  const second = await approveCommand(command.id);
  assert.equal(second!.command.status, 'active');            // sigue active
  assert.equal(await countWorkItems(), wiAfterFirst);        // sin nuevo work_item
  assert.equal((await tasksOfCmd(command.id)).length, 1);    // sin tareas duplicadas
});

// Test 4 — rechazo = cancelCommand sobre awaiting_approval: limpio (nunca hubo ejecución).
test('#4 cancel/rechazo de awaiting_approval → cancelled limpio', async () => {
  const v = await uncappedVenture();
  const beforeWi = await countWorkItems();
  const { command } = await createCommand({ text: uniqueText(), ventureId: v, requireApproval: true }, onePlan);

  const cancelled = await cancelCommand(command.id);
  assert.equal(cancelled!.command.status, 'cancelled');
  assert.equal((await tasksOfCmd(command.id))[0].status, 'cancelled');
  assert.equal(await countWorkItems(), beforeWi);           // nunca se creó work_item

  // approve tras cancel → no-op (el claim atómico exige awaiting_approval): sigue cancelled.
  const afterApprove = await approveCommand(command.id);
  assert.equal(afterApprove!.command.status, 'cancelled');
  assert.equal(await countWorkItems(), beforeWi);
});

// Test 5 — regresión: sin el flag, el auto-dispatch actual se mantiene.
test('#5 createCommand SIN requireApproval → auto-dispatch (comportamiento actual)', async () => {
  const v = await uncappedVenture();
  const beforeWi = await countWorkItems();
  const { command, tasks } = await createCommand({ text: uniqueText(), ventureId: v }, onePlan);

  assert.equal(command.status, 'active');              // auto-despachado
  assert.equal(tasks[0].status, 'dispatched');
  assert.ok(tasks[0].work_item_id != null);
  assert.equal(await countWorkItems(), beforeWi + 1);
  await cmdRow(command.id);                            // smoke: fila legible
});
