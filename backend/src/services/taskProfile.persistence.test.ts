import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get } from '../db/init.js';
import { createCommand, attemptReplan, remediateTask, parseTaskProfile } from './hokageOrchestrator.js';
import { validateTaskProfile } from '../config/taskProfile.js';
import { getEscalatedModelProfile } from './remediationEngine.js';
import { selectModel } from '../config/modelRouter.js';
import type { HokageTask, TaskProfile, TaskEvaluation, TaskVerdict, DiagnosisCategory, RemediationPolicy } from '../types/index.js';
import type { RawPlanForTest } from './hokageOrchestrator.js';

// ═══ ADR-014 — Persistencia de TaskProfile: tests de persistencia/integración. ═══

const plan = (phases: Array<{ tasks: Array<{ role: string; title: string; task: string; profile?: unknown }> }>) =>
  async (): Promise<RawPlanForTest> => ({ phases });

before(async () => {
  await initSchema();
});

function makeEval(verdict: TaskVerdict, category?: DiagnosisCategory, retryable = true): TaskEvaluation {
  return {
    workItemId: 0, taskId: null, verdict, confidence: 50, evidence: [],
    diagnosis: category ? { category, rootCause: `causa ${category}`, suggestedRemediation: 'retry_immediate', retryable, context: {} } : null,
    evaluator: 'automated', model: null, costUsd: 0, createdAt: new Date().toISOString(),
  };
}

let seq = 0;
async function oneTask(profile?: unknown): Promise<HokageTask> {
  seq++;
  const { tasks } = await createCommand(
    { text: `orden profile #${seq}`, ventureId: 1 },
    plan([{ tasks: [{ role: 'investigador', title: `TP${seq}`, task: 'haz algo', profile }] }])
  );
  return (await get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [tasks[0].id]))!;
}

const rawProfile = (id: number) => get<{ task_profile: string | null }>('SELECT task_profile FROM hokage_tasks WHERE id = ?', [id]);
const wiModel = (id: number | null) => get<{ model: string | null }>('SELECT model FROM work_items WHERE id = ?', [id]);

const REAL: TaskProfile = { kind: 'research', complexity: 'high', importance: 'critical', needs: { research: true }, risk: 'medium' };

// 1/2. Creación persiste task_profile con el perfil validado correcto.
test('TP #1/#2 creación persiste el task_profile validado', async () => {
  const t = await oneTask(REAL);
  const row = await rawProfile(t.id);
  assert.ok(row!.task_profile, 'task_profile no debe ser NULL');
  const parsed = JSON.parse(row!.task_profile!);
  assert.deepEqual(parsed, validateTaskProfile(REAL)); // contenido correcto (saneado)
  assert.equal(parsed.kind, 'research');
  assert.equal(parsed.importance, 'critical');
});

// 3. Lectura: parseTaskProfile devuelve un perfil válido.
test('TP #3 parseTaskProfile devuelve perfil válido', async () => {
  const t = await oneTask(REAL);
  const row = await rawProfile(t.id);
  const p = parseTaskProfile(row!.task_profile);
  assert.deepEqual(p, validateTaskProfile(REAL));
});

// 4. NULL → null (no fabrica perfil).
test('TP #4 parseTaskProfile(NULL) → null', () => {
  assert.equal(parseTaskProfile(null), null);
  assert.equal(parseTaskProfile(undefined), null);
  assert.equal(parseTaskProfile(''), null);
});

// 5. JSON corrupto → null, sin lanzar.
test('TP #5 parseTaskProfile(JSON corrupto) → null sin throw', () => {
  assert.doesNotThrow(() => parseTaskProfile('{no es json'));
  assert.equal(parseTaskProfile('{no es json'), null);
  assert.equal(parseTaskProfile('}}}'), null);
});

// 6. retry_immediate conserva task_profile.
test('TP #6 retry_immediate conserva task_profile', async () => {
  const t = await oneTask(REAL);
  const before = (await rawProfile(t.id))!.task_profile;
  await remediateTask(t, makeEval('fail', 'transient', true));
  const after = (await rawProfile(t.id))!.task_profile;
  assert.equal(after, before); // intacto
  assert.deepEqual(parseTaskProfile(after), validateTaskProfile(REAL));
});

// 7. retry_with_feedback conserva task_profile.
test('TP #7 retry_with_feedback conserva task_profile', async () => {
  const t = await oneTask(REAL);
  const before = (await rawProfile(t.id))!.task_profile;
  await remediateTask(t, makeEval('fail', 'output_invalid', true));
  assert.equal((await rawProfile(t.id))!.task_profile, before);
});

// 8. reassign_agent conserva task_profile.
test('TP #8 reassign_agent conserva task_profile', async () => {
  const t = await oneTask(REAL);
  const before = (await rawProfile(t.id))!.task_profile;
  await remediateTask(t, makeEval('fail', 'missing_capability', true));
  assert.equal((await rawProfile(t.id))!.task_profile, before);
});

// 9. escalate_model usa el PERFIL REAL (no el fallback).
test('TP #9 escalate_model usa el task_profile real', async () => {
  const t = await oneTask({ kind: 'classify', complexity: 'low', importance: 'low', needs: {}, risk: 'low' });
  // Política custom con escalate_model en el path + retry_with_feedback agotado → planRemediation elige escalate_model.
  const policy: RemediationPolicy = {
    maxRetries: 2, maxRemediations: 6, respectReviewCycles: false,
    escalationPath: ['retry_immediate', 'retry_with_feedback', 'escalate_model', 'replan_task', 'human_intervention'],
  };
  const history = JSON.stringify([
    { action: 'retry_with_feedback', workItemId: 1, createdAt: 'x' },
    { action: 'retry_with_feedback', workItemId: 1, createdAt: 'x' },
  ]);
  await run(`UPDATE hokage_tasks SET remediation_policy = ?, remediation_history = ? WHERE id = ?`, [JSON.stringify(policy), history, t.id]);

  const fresh = await get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [t.id]);
  await remediateTask(fresh!, makeEval('fail', 'quality_below_floor', true));

  const after = await get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [t.id]);
  assert.equal(after!.status, 'dispatched'); // se re-despachó (escalate_model)
  const realProfile: TaskProfile = { kind: 'classify', complexity: 'low', importance: 'low', needs: {}, risk: 'low' };
  const expectedReal = selectModel(getEscalatedModelProfile(realProfile as never) as never).model.id;
  const expectedFallback = selectModel(getEscalatedModelProfile({ kind: 'analysis', complexity: 'medium', importance: 'high', needs: { reasoning: true }, risk: 'medium' } as never) as never).model.id;
  const m = (await wiModel(after!.work_item_id))!.model;
  assert.equal(m, expectedReal);           // usó el perfil real
  assert.notEqual(expectedReal, expectedFallback); // el perfil real difiere del fallback (prueba de que NO usó fallback)
  // task_profile NO se sobrescribe por escalate_model
  assert.deepEqual(parseTaskProfile(after!.task_profile), realProfile);
});

// 10. tarea legacy sin task_profile → escalate_model usa el fallback conservador.
test('TP #10 legacy sin perfil → escalate_model usa fallback', async () => {
  const t = await oneTask({ kind: 'classify', complexity: 'low', importance: 'low', needs: {}, risk: 'low' });
  const policy: RemediationPolicy = {
    maxRetries: 2, maxRemediations: 6, respectReviewCycles: false,
    escalationPath: ['retry_immediate', 'retry_with_feedback', 'escalate_model', 'replan_task', 'human_intervention'],
  };
  const history = JSON.stringify([
    { action: 'retry_with_feedback', workItemId: 1, createdAt: 'x' },
    { action: 'retry_with_feedback', workItemId: 1, createdAt: 'x' },
  ]);
  // Simular tarea legacy: task_profile NULL.
  await run(`UPDATE hokage_tasks SET task_profile = NULL, remediation_policy = ?, remediation_history = ? WHERE id = ?`, [JSON.stringify(policy), history, t.id]);

  const fresh = await get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [t.id]);
  assert.equal(parseTaskProfile(fresh!.task_profile), null); // legacy
  await remediateTask(fresh!, makeEval('fail', 'quality_below_floor', true));

  const after = await get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [t.id]);
  const expectedFallback = selectModel(getEscalatedModelProfile({ kind: 'analysis', complexity: 'medium', importance: 'high', needs: { reasoning: true }, risk: 'medium' } as never) as never).model.id;
  const m = (await wiModel(after!.work_item_id))!.model;
  assert.equal(m, expectedFallback); // comportamiento legacy conservado
});

// 11/12. attemptReplan persiste task_profile y mantiene su comportamiento.
test('TP #11/#12 attemptReplan persiste task_profile y no cambia su comportamiento', async () => {
  const c = await run(`INSERT INTO hokage_commands (venture_id, text, status) VALUES (1, 'obj replan profile', 'active')`);
  await run(`INSERT INTO hokage_tasks (command_id, phase, role, title, prompt, status) VALUES (?, 0, 'investigador', 'F0', 'x', 'failed')`, [c.lastID]);

  const ok = await attemptReplan(
    c.lastID,
    plan([{ tasks: [{ role: 'contenido', title: 'Alt', task: 'z', profile: { kind: 'content', complexity: 'medium', importance: 'high', needs: {}, risk: 'low' } }] }])
  );
  // #12 comportamiento de attemptReplan intacto. NOTA: no se asserta status='dispatched' porque
  // el despacho tras replan es la brecha DAG PREEXISTENTE (test #13, fuera de scope); mi cambio
  // solo añade una columna al INSERT y no toca el control de flujo. Se comprueba el contrato real.
  assert.equal(ok, true);
  const nueva = await get<HokageTask>("SELECT * FROM hokage_tasks WHERE command_id = ? AND title = 'Alt'", [c.lastID]);
  assert.ok(nueva, 'esperaba la tarea replanificada');
  assert.ok(nueva!.phase > 0, 'la tarea de replan va a una fase posterior');
  const cmd = await get<{ replan_count: number }>('SELECT replan_count FROM hokage_commands WHERE id = ?', [c.lastID]);
  assert.equal(cmd!.replan_count, 1);
  // #11 perfil persistido
  const p = parseTaskProfile(nueva!.task_profile);
  assert.ok(p, 'task_profile persistido en replan');
  assert.equal(p!.kind, 'content');
  assert.equal(p!.importance, 'high');
});
