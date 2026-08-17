import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get } from '../db/init.js';
import { createCommand, remediateTask } from './hokageOrchestrator.js';
import type { HokageTask, TaskEvaluation, TaskVerdict, DiagnosisCategory } from '../types/index.js';
import type { RawPlanForTest } from './hokageOrchestrator.js';

// ═══ ADR-014 — replan_task vía reopen-in-place. ═══
// Verifica: re-planificación LLM de la MISMA fila (sin INSERT, sin tocar depends_on_count),
// fallback humano si el LLM falla, accounting gated (dispatch bloqueado no cuenta), y que
// replan_command permanece como fallback humano (inalcanzable vía planRemediation).

before(async () => { await initSchema(); });

function makeEval(verdict: TaskVerdict, category?: DiagnosisCategory, retryable = true): TaskEvaluation {
  return {
    workItemId: 0, taskId: null, verdict, confidence: 50, evidence: [],
    diagnosis: category ? { category, rootCause: `causa ${category}`, suggestedRemediation: 'replan_task', retryable, context: {} } : null,
    evaluator: 'automated', model: null, costUsd: 0, createdAt: new Date().toISOString(),
  };
}

const CONTENT_PROFILE = { kind: 'content', complexity: 'medium', importance: 'high', needs: {}, risk: 'low' };

// Planner LLM inyectado (mismo contrato que decompose: (text, ventureId) => RawPlan | null).
const validPlanner = (role: string, prompt: string, profile: unknown = CONTENT_PROFILE) =>
  async (): Promise<RawPlanForTest> => ({ phases: [{ tasks: [{ role, title: 'Replan', task: prompt, profile } as never] }] });
const nullPlanner = async (): Promise<RawPlanForTest | null> => null;

let seq = 0;
async function oneDispatchedTask(ventureId = 1): Promise<HokageTask> {
  seq++;
  const { tasks } = await createCommand(
    { text: `orden replan #${seq}-${Math.random()}`, ventureId },
    (async () => ({ phases: [{ tasks: [{ role: 'investigador', title: `RT${seq}`, task: 'haz la tarea original' }] }] })) as never
  );
  assert.equal(tasks[0].status, 'dispatched');
  return (await get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [tasks[0].id]))!;
}

const fullTask = (id: number) => get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [id]) as Promise<HokageTask>;
const rawProfile = (t: HokageTask) => String((t as unknown as { task_profile?: unknown }).task_profile ?? '');
const histActions = (t: HokageTask): string[] =>
  (JSON.parse(String((t as unknown as { remediation_history?: unknown }).remediation_history ?? '[]')) as Array<{ action: string }>).map((a) => a.action);
const hasDecision = async (taskId: number) =>
  !!(await get<{ id: number }>('SELECT id FROM decisions WHERE entity_type = ? AND entity_id = ?', ['hokage_task', taskId]));
const auditCount = async (taskId: number, type: string) =>
  (await get<{ n: number }>('SELECT COUNT(*) as n FROM event_log WHERE task_id = ? AND type = ?', [taskId, type]))!.n;
const countTasks = async (commandId: number) =>
  (await get<{ n: number }>('SELECT COUNT(*) as n FROM hokage_tasks WHERE command_id = ?', [commandId]))!.n;
const countWorkItems = async () => (await get<{ n: number }>('SELECT COUNT(*) as n FROM work_items'))!.n;

// Test 1 — replan válido: reopen-in-place de la MISMA fila.
test('replan #1 válido: reopen-in-place (misma fila, role/prompt/profile, depends_on_count intacto)', async () => {
  const t = await oneDispatchedTask();
  const oldWi = t.work_item_id!;
  const beforeDep = t.depends_on_count;
  const beforeTasks = await countTasks(t.command_id);

  await remediateTask(t, makeEval('fail', 'budget_exceeded', false), validPlanner('contenido', 'PROMPT REPLAN NUEVO'));

  const after = await fullTask(t.id);
  assert.equal(await countTasks(t.command_id), beforeTasks);   // no INSERT: misma cantidad de filas
  assert.equal(after.id, t.id);                                 // misma fila
  assert.equal(after.role, 'contenido');                        // role actualizado
  assert.equal(after.prompt, 'PROMPT REPLAN NUEVO');            // prompt reemplazado (no anexado)
  assert.ok(after.model && after.model.length > 0);             // model re-enrutado desde el nuevo profile
  const tp = JSON.parse(rawProfile(after));
  assert.equal(tp.kind, 'content');                             // task_profile nuevo válido
  assert.notEqual(rawProfile(after), '');                       // task_profile NUNCA NULL tras replan válido
  assert.equal(after.depends_on_count, beforeDep);             // depends_on_count INTACTO (sidestepea #13)
  assert.notEqual(after.work_item_id, oldWi);                   // nuevo work_item
  assert.equal(after.remediation_count, 1);                    // +1 solo tras dispatch real
  assert.equal(after.retry_count, 0);
  assert.deepEqual(histActions(after), ['replan_task']);       // history exacta
  assert.equal(after.status, 'dispatched');
});

// Test 2 — LLM null/ inválido → fallback humano seguro, sin cambios en la tarea.
test('replan #2 LLM null → fallback humano (sin cambios, sin work_item, sin counter)', async () => {
  const t = await oneDispatchedTask();
  const beforeWi = await countWorkItems();
  const beforeRole = t.role, beforePrompt = t.prompt, beforeTp = rawProfile(t);

  await remediateTask(t, makeEval('fail', 'budget_exceeded', false), nullPlanner as never);

  const after = await fullTask(t.id);
  assert.equal(after.status, 'failed');                 // terminal humano
  assert.ok(await hasDecision(t.id));                   // Decision creada
  assert.equal(after.role, beforeRole);                 // role sin cambios
  assert.equal(after.prompt, beforePrompt);             // prompt sin cambios
  assert.equal(rawProfile(after), beforeTp);            // task_profile sin cambios
  assert.equal(after.remediation_count, 0);            // sin incremento
  assert.deepEqual(histActions(after), []);            // sin history
  assert.equal(await countWorkItems(), beforeWi);      // sin nuevo work_item
});

// Test 3 — plan válido pero dispatch bloqueado (presupuesto de venture) → sin counter/history/executed.
test('replan #3 dispatch bloqueado: sin counter/history phantom, sin executed', async () => {
  const v = await run(`INSERT INTO ventures (name, type, status, goal, revenue_target_usd, budget_allocated_usd) VALUES ('VT-replan','store','active','m',500,100)`);
  const t = await oneDispatchedTask(v.lastID);
  // Agotar el presupuesto REAL de la venture (agent_costs) → reserveVentureBudget bloqueará el re-dispatch.
  await run(`INSERT INTO agent_costs (agent_id, venture_id, llm_cost_usd, tool_cost_usd) VALUES (?, ?, 1000, 0)`, [t.agent_id, v.lastID]);
  const beforeWi = await countWorkItems();

  await remediateTask(t, makeEval('fail', 'budget_exceeded', false), validPlanner('contenido', 'nuevo prompt'));

  const after = await fullTask(t.id);
  assert.equal(after.status, 'blocked');               // dispatch bloqueado por presupuesto de venture
  assert.equal(after.remediation_count, 0);           // sin counter phantom
  assert.deepEqual(histActions(after), []);           // sin history
  assert.equal(await auditCount(t.id, 'task.remediation.executed'), 0); // sin executed
  assert.equal(await countWorkItems(), beforeWi);     // sin nuevo work_item
});

// Test 4 — replan_command permanece como fallback humano (inalcanzable vía planRemediation).
// planRemediation nunca emite replan_command: peldaño 4 elige replan_task. Se verifica que la
// acción planificada es replan_task (nunca replan_command) y que el fallback humano queda intacto.
test('replan #4 replan_command sigue como fallback humano (no se activa)', async () => {
  const t = await oneDispatchedTask();
  await remediateTask(t, makeEval('fail', 'policy_violation', false), nullPlanner as never);

  const planned = await get<{ payload: string }>(
    'SELECT payload FROM event_log WHERE task_id = ? AND type = ? ORDER BY id DESC LIMIT 1',
    [t.id, 'task.remediation.planned']
  );
  assert.ok(planned, 'esperaba un audit task.remediation.planned');
  assert.equal(JSON.parse(planned!.payload).action, 'replan_task'); // el engine elige replan_task, NUNCA replan_command

  const after = await fullTask(t.id);
  assert.equal(after.status, 'failed');   // fallback humano intacto
  assert.ok(await hasDecision(t.id));
});
