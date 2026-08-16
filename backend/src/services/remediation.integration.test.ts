import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get, all } from '../db/init.js';
import { createCommand, onHokageTaskCompleted, remediateTask } from './hokageOrchestrator.js';
import { createAgent } from './agentService.js';
import type { HokageTask, TaskEvaluation, TaskVerdict, DiagnosisCategory } from '../types/index.js';
import type { RawPlanForTest } from './hokageOrchestrator.js';

// ═══ ADR-014 Slice B3 — integración de remediación en el flujo real de completion. ═══
// El engine (planRemediation) ya está probado como PURO en remediationEngine.test.ts. Aquí se
// prueba la EJECUCIÓN: onHokageTaskCompleted evalúa y remedia; remediateTask ejecuta cada acción.

const plan = (phases: Array<{ tasks: Array<{ role: string; title: string; task: string }> }>) =>
  async (): Promise<RawPlanForTest> => ({ phases });

before(async () => {
  await initSchema();
});

function makeEval(verdict: TaskVerdict, category?: DiagnosisCategory, retryable = true): TaskEvaluation {
  return {
    workItemId: 0,
    taskId: null,
    verdict,
    confidence: 50,
    evidence: [],
    diagnosis: category
      ? { category, rootCause: `causa de prueba: ${category}`, suggestedRemediation: 'retry_immediate', retryable, context: {} }
      : null,
    evaluator: 'automated',
    model: null,
    costUsd: 0,
    createdAt: new Date().toISOString(),
  };
}

let seq = 0;
async function oneDispatchedTask(role = 'investigador'): Promise<HokageTask> {
  seq++;
  const { tasks } = await createCommand(
    { text: `orden remediación #${seq}`, ventureId: 1 },
    plan([{ tasks: [{ role, title: `T${seq}`, task: 'haz la tarea' }] }])
  );
  assert.equal(tasks[0].status, 'dispatched');
  return (await get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [tasks[0].id]))!;
}

const fullTask = (id: number) => get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [id]) as Promise<HokageTask>;
const countWorkItems = async () => (await get<{ n: number }>('SELECT COUNT(*) as n FROM work_items'))!.n;
const evalsFor = async (wi: number) => (await get<{ n: number }>('SELECT COUNT(*) as n FROM task_evaluations WHERE work_item_id = ?', [wi]))!.n;

// 1. PASS → sin remediación → flujo normal (tarea completada, contadores intactos).
test('B3 #1 pass: sin remediación, la tarea se completa por el camino normal', async () => {
  const t = await oneDispatchedTask();
  await onHokageTaskCompleted(t.work_item_id!, true, 'un resultado válido, completo y sin errores');
  const after = await fullTask(t.id);
  assert.equal(after.status, 'completed');
  assert.equal(after.retry_count, 0);
  assert.equal(after.remediation_count, 0);
  assert.equal(await evalsFor(t.work_item_id!), 1); // se persistió la evaluación (verdict pass)
});

// 2/3/10/13. output_invalid → retry_with_feedback: re-despacho por el dispatcher, +1 remediation,
// feedback inyectado, y UN SOLO dispatch nuevo (sin doble dispatch).
test('B3 #2/#3 output_invalid → retry_with_feedback (re-despacho + feedback + un solo dispatch)', async () => {
  const t = await oneDispatchedTask();
  await run(`UPDATE hokage_tasks SET output_schema = ? WHERE id = ?`, ['{"required":["keywords"]}', t.id]);
  const oldWi = t.work_item_id!;

  const before = await countWorkItems();
  await onHokageTaskCompleted(oldWi, true, '{"foo":"bar"}'); // falta "keywords" → fail/output_invalid
  const after = await fullTask(t.id);

  assert.equal(after.status, 'dispatched');               // re-abierta y re-despachada
  assert.notEqual(after.work_item_id, oldWi);             // nuevo work_item
  assert.equal(after.remediation_count, 1);              // #9 contador de remediación
  assert.equal(after.retry_count, 0);
  assert.equal((await countWorkItems()) - before, 1);    // #13 exactamente UN dispatch nuevo

  const newWi = await get<{ type: string; context: string }>('SELECT type, context FROM work_items WHERE id = ?', [after.work_item_id]);
  assert.equal(newWi!.type, 'hokage_task');               // #10 vuelve por el dispatcher existente
  assert.match(newWi!.context, /REMEDIACIÓN/);            // feedback inyectado en el prompt
});

// 4/8. transient → retry_immediate: +1 retry_count (exactamente una vez), sin feedback.
test('B3 #4/#8 transient → retry_immediate (retry_count +1 exacto, sin feedback)', async () => {
  const t = await oneDispatchedTask();
  const oldWi = t.work_item_id!;
  const handled = await remediateTask(t, makeEval('fail', 'transient', true));
  assert.equal(handled, true);

  const after = await fullTask(t.id);
  assert.equal(after.status, 'dispatched');
  assert.notEqual(after.work_item_id, oldWi);
  assert.equal(after.retry_count, 1);        // #8 exactamente una vez
  assert.equal(after.remediation_count, 0);  // retry_immediate NO cuenta como remediación de calidad

  const newWi = await get<{ context: string }>('SELECT context FROM work_items WHERE id = ?', [after.work_item_id]);
  assert.doesNotMatch(newWi!.context, /REMEDIACIÓN/); // retry_immediate = mismo prompt, sin feedback
});

// 5/11. missing_capability → reassign_agent: excluye al agente anterior.
test('B3 #5/#11 missing_capability → reassign_agent (excluye al agente anterior)', async () => {
  const t = await oneDispatchedTask();
  const prevAgent = t.agent_id!;
  await createAgent({ name: `Investigador alt #${seq}`, role: 'investigador', venture_id: 1 }); // candidato alternativo

  const handled = await remediateTask(t, makeEval('fail', 'missing_capability', true));
  assert.equal(handled, true);

  const after = await fullTask(t.id);
  assert.equal(after.status, 'dispatched');
  assert.equal(after.remediation_count, 1);
  const newWi = await get<{ agent_id: number }>('SELECT agent_id FROM work_items WHERE id = ?', [after.work_item_id]);
  assert.notEqual(newWi!.agent_id, prevAgent); // agente anterior excluido del re-despacho
});

// 6. budget_exceeded → replan_task → terminal seguro (Decision + tarea failed, sin contador).
test('B3 #6 budget_exceeded → replan_task → terminal humano seguro', async () => {
  const t = await oneDispatchedTask();
  const handled = await remediateTask(t, makeEval('fail', 'budget_exceeded', false));
  assert.equal(handled, true);

  const after = await fullTask(t.id);
  assert.equal(after.status, 'failed');       // terminal (replan_task no automatizado)
  assert.equal(after.remediation_count, 0);   // #9 no cuenta acciones no ejecutadas
  const dec = await get<{ id: number }>('SELECT id FROM decisions WHERE entity_type = ? AND entity_id = ?', ['hokage_task', t.id]);
  assert.ok(dec, 'esperaba una Decision para intervención humana');
});

// 7. límite global de remediaciones agotado → human_intervention (terminal seguro, sin bucle).
test('B3 #7 remediation limit agotado → human_intervention', async () => {
  const t = await oneDispatchedTask();
  const full = JSON.stringify([
    { action: 'retry_immediate', workItemId: 1, createdAt: 'x' },
    { action: 'retry_immediate', workItemId: 1, createdAt: 'x' },
    { action: 'retry_with_feedback', workItemId: 1, createdAt: 'x' },
    { action: 'retry_with_feedback', workItemId: 1, createdAt: 'x' },
  ]); // 4 == maxRemediations por defecto
  await run(`UPDATE hokage_tasks SET remediation_history = ? WHERE id = ?`, [full, t.id]);

  const fresh = await fullTask(t.id);
  const handled = await remediateTask(fresh, makeEval('fail', 'transient', true));
  assert.equal(handled, true);
  const after = await fullTask(t.id);
  assert.equal(after.status, 'failed');
  const dec = await get<{ id: number }>('SELECT id FROM decisions WHERE entity_type = ? AND entity_id = ?', ['hokage_task', t.id]);
  assert.ok(dec, 'esperaba Decision de intervención humana tras agotar remediaciones');
});

// 12. review cycles agotados (ADR-012) → replan_task terminal, sin re-abrir el ciclo (sin bucle).
test('B3 #12 review cycles agotados respeta ADR-012 (terminal, sin loop)', async () => {
  const t = await oneDispatchedTask();
  await run(`UPDATE hokage_tasks SET review_cycles = 2, review_verdict = 'fail' WHERE id = ?`, [t.id]); // >= max_review_cycles (2)
  const before = await countWorkItems();

  const fresh = await fullTask(t.id);
  const handled = await remediateTask(fresh, makeEval('fail', 'quality_below_floor', true));
  assert.equal(handled, true);

  const after = await fullTask(t.id);
  assert.equal(after.status, 'failed');                 // review agotado → replan_task → terminal
  assert.equal(await countWorkItems(), before);         // NO re-despacho → sin bucle
});

// 14. work items que NO son hokage_task no pasan por la remediación de Hokage.
test('B3 #14 work item no-hokage_task: onHokageTaskCompleted es no-op', async () => {
  const agent = await createAgent({ name: `Suelto #${seq}`, role: 'investigador', venture_id: 1 });
  const wi = await run(
    `INSERT INTO work_items (agent_id, venture_id, type, priority, status, context) VALUES (?, 1, 'report', 5, 'done', 'x')`,
    [agent.id]
  );
  await onHokageTaskCompleted(wi.lastID, true, 'sin tarea Hokage detrás'); // no hay hokage_task → sale temprano
  assert.equal(await evalsFor(wi.lastID), 0); // no se evaluó ni remedió
});

// 15. fallo/obstrucción durante la remediación → salida segura: nunca rompe el flujo principal.
test('B3 #15 remediación obstruida → salida terminal segura, sin propagar el error', async () => {
  // El rol se desactiva justo antes de re-despachar: la remediación re-abre la tarea pero el
  // dispatcher no puede colocarla → estado terminal seguro ('blocked'), sin excepción propagada.
  const t = await oneDispatchedTask('trafico');
  await run(`UPDATE hokage_tasks SET output_schema = ? WHERE id = ?`, ['{"required":["keywords"]}', t.id]);
  await run(`UPDATE role_definitions SET status = 'disabled' WHERE key = 'trafico'`);
  try {
    // No debe lanzar (await resuelve) y la tarea debe quedar en un terminal observable, sin bucle.
    await onHokageTaskCompleted(t.work_item_id!, true, '{"foo":"bar"}');
    const after = await fullTask(t.id);
    assert.ok(after.status === 'blocked' || after.status === 'failed', `terminal seguro, no ${after.status}`);
  } finally {
    await run(`UPDATE role_definitions SET status = 'active' WHERE key = 'trafico'`);
  }
});

// 16. completion duplicada es idempotente (sin doble evaluación ni doble dispatch).
test('B3 #16 completion duplicada: idempotente', async () => {
  const t = await oneDispatchedTask();
  const wi = t.work_item_id!;
  await onHokageTaskCompleted(wi, true, 'ok');
  await onHokageTaskCompleted(wi, true, 'otra vez'); // guard status!==dispatched → no-op
  const after = await fullTask(t.id);
  assert.equal(after.status, 'completed');
  assert.equal(after.result, 'ok');           // no se sobrescribió
  assert.equal(await evalsFor(wi), 1);         // sin doble evaluación

  // Tras un re-despacho, completar el work_item ANTIGUO también es no-op (work_item_id ya cambió).
  const t2 = await oneDispatchedTask();
  await run(`UPDATE hokage_tasks SET output_schema = ? WHERE id = ?`, ['{"required":["keywords"]}', t2.id]);
  const oldWi = t2.work_item_id!;
  await onHokageTaskCompleted(oldWi, true, '{}'); // → retry_with_feedback, nuevo work_item
  const reopened = await fullTask(t2.id);
  assert.notEqual(reopened.work_item_id, oldWi);
  await onHokageTaskCompleted(oldWi, true, 'tarde'); // el work_item viejo ya no mapea a la tarea
  const stable = await fullTask(t2.id);
  assert.equal(stable.work_item_id, reopened.work_item_id); // sin cambios: no-op
});
