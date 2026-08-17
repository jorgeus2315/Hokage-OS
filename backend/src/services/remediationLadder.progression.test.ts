import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get } from '../db/init.js';
import { createCommand, onHokageTaskCompleted, remediateTask } from './hokageOrchestrator.js';
import { createAgent } from './agentService.js';
import type { HokageTask, TaskEvaluation, TaskVerdict, DiagnosisCategory, RemediationPolicy } from '../types/index.js';
import type { RawPlanForTest } from './hokageOrchestrator.js';

// ═══ ADR-014 — Progresión MULTI-PASO real de la escalera + bordes de límite. ═══
// A diferencia de los tests previos (un paso, o history pre-sembrada), aquí se recorre el bucle
// real: completar-mal → re-despachar → re-completar-mal → leer la history APPENDida → avanzar.
// Solo tests: no toca código de producción ni superficies prohibidas.

const plan = (phases: Array<{ tasks: Array<{ role: string; title: string; task: string }> }>) =>
  async (): Promise<RawPlanForTest> => ({ phases });

before(async () => { await initSchema(); });

function makeEval(verdict: TaskVerdict, category?: DiagnosisCategory, retryable = true): TaskEvaluation {
  return {
    workItemId: 0, taskId: null, verdict, confidence: 50, evidence: [],
    diagnosis: category ? { category, rootCause: `causa ${category}`, suggestedRemediation: 'retry_immediate', retryable, context: {} } : null,
    evaluator: 'automated', model: null, costUsd: 0, createdAt: new Date().toISOString(),
  };
}

let seq = 0;
async function oneDispatchedTask(): Promise<HokageTask> {
  seq++;
  const { tasks } = await createCommand(
    { text: `orden progresión #${seq}-${Math.random()}`, ventureId: 1 },
    plan([{ tasks: [{ role: 'investigador', title: `LP${seq}`, task: 'haz la tarea' }] }])
  );
  assert.equal(tasks[0].status, 'dispatched');
  return (await get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [tasks[0].id]))!;
}

const fullTask = (id: number) => get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [id]) as Promise<HokageTask>;
const histActions = (t: HokageTask): string[] =>
  (JSON.parse(String((t as unknown as { remediation_history?: unknown }).remediation_history ?? '[]')) as Array<{ action: string }>).map((a) => a.action);
const hasDecision = async (taskId: number) =>
  !!(await get<{ id: number }>('SELECT id FROM decisions WHERE entity_type = ? AND entity_id = ?', ['hokage_task', taskId]));
const setPolicy = (taskId: number, p: RemediationPolicy) =>
  run('UPDATE hokage_tasks SET remediation_policy = ? WHERE id = ?', [JSON.stringify(p), taskId]);

const FULL_PATH: RemediationPolicy['escalationPath'] =
  ['retry_immediate', 'retry_with_feedback', 'reassign_agent', 'replan_task', 'human_intervention'];

// 1 + 5. output_invalid ×2 → human_intervention (bucle REAL vía onHokageTaskCompleted) +
// remediation_history refleja exactamente la secuencia ejecutada, en orden.
test('LP #1 output_invalid ×2 → human (progresión real + history exacta)', async () => {
  const t = await oneDispatchedTask();
  await run(`UPDATE hokage_tasks SET output_schema = ? WHERE id = ?`, ['{"required":["k"]}', t.id]);

  // Paso 1
  await onHokageTaskCompleted(t.work_item_id!, true, '{}'); // output_invalid → retry_with_feedback
  const s1 = await fullTask(t.id);
  assert.equal(s1.status, 'dispatched');
  assert.equal(s1.remediation_count, 1);
  assert.equal(s1.retry_count, 0);
  assert.deepEqual(histActions(s1), ['retry_with_feedback']);
  assert.equal(histActions(s1).length, s1.retry_count + s1.remediation_count); // invariante history↔counters

  // Paso 2 (re-completar el NUEVO work_item, sigue inválido)
  await onHokageTaskCompleted(s1.work_item_id!, true, '{}');
  const s2 = await fullTask(t.id);
  assert.equal(s2.status, 'dispatched');
  assert.equal(s2.remediation_count, 2);
  assert.deepEqual(histActions(s2), ['retry_with_feedback', 'retry_with_feedback']);
  assert.notEqual(s2.work_item_id, s1.work_item_id);

  // Paso 3 → tope maxRetries=2 agotado → sin más peldaños en default path → human_intervention
  await onHokageTaskCompleted(s2.work_item_id!, true, '{}');
  const s3 = await fullTask(t.id);
  assert.equal(s3.status, 'failed');                 // terminal
  assert.equal(s3.remediation_count, 2);             // human_intervention NO incrementa
  assert.deepEqual(histActions(s3), ['retry_with_feedback', 'retry_with_feedback']);
  assert.ok(await hasDecision(t.id));
});

// 2. transient ×2 → human_intervention (bucle real vía errorClass).
test('LP #2 transient ×2 → human (progresión real)', async () => {
  const t = await oneDispatchedTask();

  await onHokageTaskCompleted(t.work_item_id!, false, 'OpenRouter 429: rate limited', 'transient');
  const s1 = await fullTask(t.id);
  assert.equal(s1.status, 'dispatched');
  assert.equal(s1.retry_count, 1);
  assert.equal(s1.remediation_count, 0);
  assert.deepEqual(histActions(s1), ['retry_immediate']);

  await onHokageTaskCompleted(s1.work_item_id!, false, 'timeout', 'transient');
  const s2 = await fullTask(t.id);
  assert.equal(s2.retry_count, 2);
  assert.deepEqual(histActions(s2), ['retry_immediate', 'retry_immediate']);

  await onHokageTaskCompleted(s2.work_item_id!, false, 'ECONNRESET', 'transient'); // tope maxRetries=2 → human
  const s3 = await fullTask(t.id);
  assert.equal(s3.status, 'failed');
  assert.equal(s3.retry_count, 2);
  assert.ok(await hasDecision(t.id));
});

// 3. reassign_agent → human (secuencia real vía remediateTask + recarga; missing_capability, cap=1).
test('LP #3 reassign_agent agotado → human (secuencia real)', async () => {
  const t = await oneDispatchedTask();
  const prevAgent = t.agent_id!;
  await createAgent({ name: `alt LP3 #${seq}`, role: 'investigador', venture_id: 1 });

  await remediateTask(t, makeEval('fail', 'missing_capability', true)); // reassign_agent (n=0<1)
  const s1 = await fullTask(t.id);
  assert.equal(s1.status, 'dispatched');
  assert.equal(s1.remediation_count, 1);
  assert.deepEqual(histActions(s1), ['reassign_agent']);
  const newWi = await get<{ agent_id: number }>('SELECT agent_id FROM work_items WHERE id = ?', [s1.work_item_id]);
  assert.notEqual(newWi!.agent_id, prevAgent);

  await remediateTask(s1, makeEval('fail', 'missing_capability', true)); // reassign agotado (n=1) → human
  const s2 = await fullTask(t.id);
  assert.equal(s2.status, 'failed');
  assert.equal(s2.remediation_count, 1);             // no incrementa en el terminal
  assert.deepEqual(histActions(s2), ['reassign_agent']);
  assert.ok(await hasDecision(t.id));
});

// 4a. maxRetries=1 → 1 retry_immediate, luego terminal.
test('LP #4a maxRetries=1: un retry y luego human', async () => {
  const t = await oneDispatchedTask();
  await setPolicy(t.id, { maxRetries: 1, maxRemediations: 4, respectReviewCycles: false, escalationPath: FULL_PATH });

  await remediateTask((await fullTask(t.id)), makeEval('fail', 'transient', true)); // retry_immediate (n=0<1)
  const s1 = await fullTask(t.id);
  assert.equal(s1.status, 'dispatched');
  assert.equal(s1.retry_count, 1);
  assert.deepEqual(histActions(s1), ['retry_immediate']);

  await remediateTask((await fullTask(t.id)), makeEval('fail', 'transient', true)); // n=1 → agotado → human
  const s2 = await fullTask(t.id);
  assert.equal(s2.status, 'failed');
  assert.equal(s2.retry_count, 1);
  assert.ok(await hasDecision(t.id));
});

// 4b. maxRemediations=1 → exactamente 1 acción, luego human.
test('LP #4b maxRemediations=1: una acción y luego human', async () => {
  const t = await oneDispatchedTask();
  await setPolicy(t.id, { maxRetries: 2, maxRemediations: 1, respectReviewCycles: false, escalationPath: FULL_PATH });

  await remediateTask((await fullTask(t.id)), makeEval('fail', 'output_invalid', true)); // retry_with_feedback (history 0<1)
  const s1 = await fullTask(t.id);
  assert.equal(s1.status, 'dispatched');
  assert.equal(s1.remediation_count, 1);
  assert.deepEqual(histActions(s1), ['retry_with_feedback']);

  await remediateTask((await fullTask(t.id)), makeEval('fail', 'output_invalid', true)); // history.length=1>=1 → human
  const s2 = await fullTask(t.id);
  assert.equal(s2.status, 'failed');
  assert.equal(s2.remediation_count, 1);
  assert.ok(await hasDecision(t.id));
});

// 4c. maxRemediations=0 → human inmediato, sin acción ni counter.
test('LP #4c maxRemediations=0: human inmediato sin acción', async () => {
  const t = await oneDispatchedTask();
  const beforeWi = (await get<{ n: number }>('SELECT COUNT(*) as n FROM work_items'))!.n;
  await setPolicy(t.id, { maxRetries: 2, maxRemediations: 0, respectReviewCycles: false, escalationPath: FULL_PATH });

  await remediateTask((await fullTask(t.id)), makeEval('fail', 'transient', true)); // isGlobalExhausted → human
  const s = await fullTask(t.id);
  assert.equal(s.status, 'failed');
  assert.equal(s.retry_count, 0);
  assert.equal(s.remediation_count, 0);
  assert.deepEqual(histActions(s), []);              // ninguna acción ejecutada
  assert.equal((await get<{ n: number }>('SELECT COUNT(*) as n FROM work_items'))!.n, beforeWi); // sin nuevo work_item
  assert.ok(await hasDecision(t.id));
});
