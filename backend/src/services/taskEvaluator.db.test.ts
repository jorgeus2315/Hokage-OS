import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get, all } from '../db/init.js';
import { evaluateAutomated, insertTaskEvaluation } from './taskEvaluator.js';
import type { WorkItemForEval, HokageTask, RoleDefinition } from '../types/index.js';

let ventureId: number;
let commandId: number;
let testAgentId: number;

before(async () => {
  await initSchema();
  const v = await get<{ id: number }>(`SELECT id FROM ventures WHERE name = 'Minimal Designs'`);
  ventureId = v!.id;
  // Create a command for hokage_tasks FK
  const cmdRes = await run(
    `INSERT INTO hokage_commands (venture_id, text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [ventureId, 'Test command', 'planning', new Date().toISOString(), new Date().toISOString()]
  );
  commandId = cmdRes.lastID;
  // Get an actual agent (investigador role if exists, otherwise hermes)
  const agent = await get<{ id: number }>(`SELECT id FROM agents WHERE role = 'investigador' LIMIT 1`);
  testAgentId = agent?.id ?? 1;
});

function makeWorkItem(overrides: Partial<WorkItemForEval> = {}): WorkItemForEval {
  return {
    id: 0, // will be set after insert
    agent_id: testAgentId,
    type: 'hokage_task',
    context: 'test',
    result: '{"keywords":["minimal","design"],"summary":"OK"}',
    error: null,
    tokens_in: 100,
    tokens_out: 200,
    llm_cost_usd: 0.001,
    tool_cost_usd: 0,
    venture_id: ventureId,
    model: 'google/gemini-flash-1.5',
    milestone_id: null,
    retry_count: 0,
    created_at: new Date().toISOString(),
    resolved_at: new Date().toISOString(),
    ...overrides
  };
}

function makeTask(overrides: Partial<HokageTask> = {}): HokageTask {
  return {
    id: 1,
    command_id: commandId,
    phase: 0,
    role: 'investigador',
    agent_id: testAgentId,
    title: 'Test Task',
    prompt: 'Investigate trends',
    status: 'completed',
    work_item_id: 1,
    result: null,
    error: null,
    reserved_usd: 0.01,
    model: 'google/gemini-flash-1.5',
    depends_on_count: 0,
    handoff_input: null,
    handoff_from_role: null,
    review_cycles: 0,
    review_verdict: null,
    review_feedback: null,
    output_schema: null,
    acceptance_criteria: null,
    quality_floor: null,
    retry_count: 0,
    remediation_count: 0,
    remediation_policy: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

function makeRoleDef(overrides: Partial<RoleDefinition> = {}): RoleDefinition {
  return {
    key: 'investigador',
    label: 'Investigador',
    specialty: 'Market research',
    mission: 'Find trends',
    base_prompt: 'You are an investigator',
    autonomous_task: 'Research trends daily',
    interval_minutes: 60,
    model: 'google/gemini-flash-1.5',
    fallback_model: null,
    tools: ['web.search', 'google.trends'],
    default_autonomy: 2,
    monthly_budget_usd: 5,
    scope: 'business',
    is_system: false,
    status: 'active',
    capabilities: '["research.web","analysis.data"]',
    max_review_cycles: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

async function createTestWorkItem(data: Partial<WorkItemForEval> = {}): Promise<number> {
  const wi = makeWorkItem(data);
  const res = await run(
    `INSERT INTO work_items (agent_id, venture_id, type, priority, status, context, result, error, tokens_in, tokens_out, llm_cost_usd, tool_cost_usd, model, created_at, resolved_at)
     VALUES (?, ?, ?, 8, 'done', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [wi.agent_id, wi.venture_id, wi.type, wi.context, wi.result, wi.error, wi.tokens_in, wi.tokens_out, wi.llm_cost_usd, wi.tool_cost_usd, wi.model, wi.created_at, wi.resolved_at]
  );
  return res.lastID;
}

async function createTestTask(workItemId: number, data: Partial<HokageTask> = {}): Promise<number> {
  const task = makeTask({ ...data, work_item_id: workItemId });
  const res = await run(
    `INSERT INTO hokage_tasks (command_id, phase, role, agent_id, title, prompt, status, work_item_id, reserved_usd, model, depends_on_count, review_cycles, output_schema, acceptance_criteria, quality_floor, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.command_id, task.phase, task.role, task.agent_id, task.title, task.prompt, task.status, task.work_item_id, task.reserved_usd, task.model, task.depends_on_count, task.review_cycles, task.output_schema ? JSON.stringify(task.output_schema) : null, task.acceptance_criteria ? JSON.stringify(task.acceptance_criteria) : null, task.quality_floor ? JSON.stringify(task.quality_floor) : null, task.created_at, task.updated_at]
  );
  return res.lastID;
}

test('insertTaskEvaluation persists to task_evaluations and mirrors to work_items', async () => {
  const workItemId = await createTestWorkItem({ result: '{"ok":true}' });
  const taskId = await createTestTask(workItemId);

  const workItem = await get<WorkItemForEval>(`SELECT * FROM work_items WHERE id = ?`, [workItemId]);
  const task = await get<HokageTask>(`SELECT * FROM hokage_tasks WHERE id = ?`, [taskId]);
  const roleDef = makeRoleDef();

  const evaluation = await evaluateAutomated(workItem!, task, roleDef);
  const evalId = await insertTaskEvaluation(evaluation);

  assert.ok(evalId > 0);

  // Verificar task_evaluations
  const saved = await get<{ id: number; verdict: string; confidence: number; evidence: string; diagnosis: string | null; evaluator: string }>(
    `SELECT * FROM task_evaluations WHERE id = ?`, [evalId]
  );
  assert.ok(saved !== undefined);
  assert.equal(saved!.verdict, evaluation.verdict);
  assert.equal(saved!.confidence, evaluation.confidence);
  assert.equal(saved!.evaluator, 'automated');
  const evidence = JSON.parse(saved!.evidence);
  assert.ok(Array.isArray(evidence));
  assert.ok(evidence.length > 0);

  // Verificar espejo en work_items
  const wi = await get<{ evaluation_verdict: string; evaluation_confidence: number; evaluation_evidence: string }>(
    `SELECT evaluation_verdict, evaluation_confidence, evaluation_evidence FROM work_items WHERE id = ?`, [workItemId]
  );
  assert.equal(wi!.evaluation_verdict, evaluation.verdict);
  assert.equal(wi!.evaluation_confidence, evaluation.confidence);
  const wiEvidence = JSON.parse(wi!.evaluation_evidence);
  assert.deepEqual(wiEvidence, evidence);
});

test('insertTaskEvaluation with diagnosis persists diagnosis JSON', async () => {
  const workItemId = await createTestWorkItem({ result: '{"missing":"field"}', llm_cost_usd: 0.05 });
  const taskId = await createTestTask(workItemId, { reserved_usd: 0.01, output_schema: { required: ['field'] } });

  const workItem = await get<WorkItemForEval>(`SELECT * FROM work_items WHERE id = ?`, [workItemId]);
  const task = await get<HokageTask>(`SELECT * FROM hokage_tasks WHERE id = ?`, [taskId]);
  const roleDef = makeRoleDef();

  const evaluation = await evaluateAutomated(workItem!, task, roleDef);
  const evalId = await insertTaskEvaluation(evaluation);

  const saved = await get<{ diagnosis: string }>(`SELECT diagnosis FROM task_evaluations WHERE id = ?`, [evalId]);
  assert.ok(saved!.diagnosis !== null);
  const diagnosis = JSON.parse(saved!.diagnosis!);
  assert.equal(diagnosis.category, 'output_invalid');
});

test('insertTaskEvaluation is idempotent for work_items mirror (multiple evaluations overwrite)', async () => {
  const workItemId = await createTestWorkItem({ result: 'first' });
  const taskId = await createTestTask(workItemId);
  const workItem = await get<WorkItemForEval>(`SELECT * FROM work_items WHERE id = ?`, [workItemId]);
  const task = await get<HokageTask>(`SELECT * FROM hokage_tasks WHERE id = ?`, [taskId]);
  const roleDef = makeRoleDef();

  // Primera evaluación
  const eval1 = await evaluateAutomated(workItem!, task, roleDef);
  await insertTaskEvaluation(eval1);

  // Segunda evaluación (simula re-evaluación)
  const workItem2 = { ...workItem!, result: 'second', llm_cost_usd: 0.01 };
  const eval2 = await evaluateAutomated(workItem2, task, roleDef);
  await insertTaskEvaluation(eval2);

  // work_items debe reflejar la última
  const wi = await get<{ evaluation_verdict: string; evaluation_confidence: number }>(
    `SELECT evaluation_verdict, evaluation_confidence FROM work_items WHERE id = ?`, [workItemId]
  );
  assert.equal(wi!.evaluation_verdict, eval2.verdict);
  assert.equal(wi!.evaluation_confidence, eval2.confidence);

  // task_evaluations debe tener DOS registros
  const count = await get<{ count: number }>(`SELECT COUNT(*) as count FROM task_evaluations WHERE work_item_id = ?`, [workItemId]);
  assert.equal(count!.count, 2);
});

test('task_evaluations table has correct indexes', async () => {
  const indexes = await all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='task_evaluations'`);
  const names = indexes.map(i => i.name);
  assert.ok(names.includes('idx_task_evaluations_workitem'));
  assert.ok(names.includes('idx_task_evaluations_task'));
  assert.ok(names.includes('idx_task_evaluations_verdict'));
});

test('work_items evaluation columns exist', async () => {
  const cols = await all<{ name: string }>(`PRAGMA table_info(work_items)`);
  const names = cols.map(c => c.name);
  assert.ok(names.includes('evaluation_verdict'));
  assert.ok(names.includes('evaluation_confidence'));
  assert.ok(names.includes('evaluation_evidence'));
});

// B1: hokage_tasks remediation columns exist and have correct defaults
test('hokage_tasks has retry_count column with default 0', async () => {
  const cols = await all<{ name: string; dflt_value: any }>(`PRAGMA table_info(hokage_tasks)`);
  const retryCol = cols.find(c => c.name === 'retry_count');
  assert.ok(retryCol, 'retry_count column should exist');
  // SQLite PRAGMA returns default as string, so coerce
  assert.equal(Number(retryCol!.dflt_value), 0, 'retry_count default should be 0');
});

test('hokage_tasks has remediation_count column with default 0', async () => {
  const cols = await all<{ name: string; dflt_value: any }>(`PRAGMA table_info(hokage_tasks)`);
  const remCol = cols.find(c => c.name === 'remediation_count');
  assert.ok(remCol, 'remediation_count column should exist');
  assert.equal(Number(remCol!.dflt_value), 0, 'remediation_count default should be 0');
});

test('hokage_tasks has remediation_policy column (nullable)', async () => {
  const cols = await all<{ name: string }>(`PRAGMA table_info(hokage_tasks)`);
  const policyCol = cols.find(c => c.name === 'remediation_policy');
  assert.ok(policyCol, 'remediation_policy column should exist');
  // nullable TEXT, no default
});

// B1: Idempotency - re-running initSchema does not duplicate columns or break
test('initSchema is idempotent for B1 columns (re-running does not error)', async () => {
  // initSchema ya se ejecuta en before(); llamarlo de nuevo no debe fallar
  await initSchema();

  // Verificar que las columnas siguen existiendo con los mismos defaults
  const cols = await all<{ name: string; dflt_value: any }>(`PRAGMA table_info(hokage_tasks)`);
  const retryCol = cols.find(c => c.name === 'retry_count');
  const remCol = cols.find(c => c.name === 'remediation_count');
  const policyCol = cols.find(c => c.name === 'remediation_policy');

  assert.ok(retryCol && Number(retryCol.dflt_value) === 0);
  assert.ok(remCol && Number(remCol.dflt_value) === 0);
  assert.ok(policyCol);
});

// B1: Tasks created after migration have new columns with defaults
test('New tasks have retry_count=0 and remediation_count=0 by default', async () => {
  const workItemId = await createTestWorkItem({ result: '{"ok":true}' });
  const taskId = await createTestTask(workItemId);

  const task = await get<HokageTask>(`SELECT * FROM hokage_tasks WHERE id = ?`, [taskId]);
  assert.ok(task !== undefined);
  assert.equal(task!.retry_count, 0);
  assert.equal(task!.remediation_count, 0);
  assert.equal(task!.remediation_policy, null);
});