import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskGraph, TaskGraphValidationError } from './taskGraph.js';
import type { HokageTask, TaskEdge } from '../types/index.js';

// ═══ Tests de validateTaskGraph (ADR-012) — puro, sin BD ═══
// Cubre: DAG válido, ciclo detectado, review_of sin revisor distinto, handoff payload inválido.

function task(id: number, commandId: number, role: string): HokageTask {
  return {
    id, command_id: commandId, phase: 0, role, agent_id: null, title: `t${id}`, prompt: '',
    status: 'pending', work_item_id: null, result: null, error: null, reserved_usd: 0, model: null,
    depends_on_count: 0, handoff_input: null, handoff_from_role: null, review_cycles: 0, review_verdict: null, review_feedback: null,
    output_schema: null, acceptance_criteria: null, quality_floor: null,
    retry_count: 0, remediation_count: 0, remediation_policy: null,
    created_at: '', updated_at: '',
  };
}

function edge(id: number, commandId: number, from: number, to: number, type: TaskEdge['type'], payload = '{}'): TaskEdge {
  return { id, command_id: commandId, from_task_id: from, to_task_id: to, type, payload, created_at: '' };
}

test('DAG válido: orden topológico correcto y phases calculadas', () => {
  const tasks = [task(1, 1, 'investigador'), task(2, 1, 'contenido')];
  const edges = [edge(1, 1, 1, 2, 'depends_on')];
  const g = validateTaskGraph(tasks, edges);
  assert.deepEqual(g.topologicalOrder, [1, 2]);
  assert.equal(g.phases.get(1), 0);
  assert.equal(g.phases.get(2), 1);
  assert.equal(g.hasReviewCycles, false);
});

test('ciclo detectado: lanza TaskGraphValidationError con cyclePath', () => {
  const tasks = [task(1, 1, 'investigador'), task(2, 1, 'contenido')];
  const edges = [edge(1, 1, 1, 2, 'depends_on'), edge(2, 1, 2, 1, 'depends_on')];
  assert.throws(() => validateTaskGraph(tasks, edges), (e: unknown) => {
    return e instanceof TaskGraphValidationError && e.cyclePath !== undefined;
  });
});

test('review_of requiere revisor distinto (mismo rol → error)', () => {
  const tasks = [
    { ...task(1, 1, 'contenido'), role: 'contenido' },
    { ...task(2, 1, 'contenido'), role: 'contenido' },
  ];
  const edges = [edge(1, 1, 1, 2, 'review_of', '{"criteria":"calidad"}')];
  assert.throws(() => validateTaskGraph(tasks, edges), (e: unknown) => {
    return e instanceof TaskGraphValidationError && /review_of/.test((e as Error).message);
  });
});

test('review_of con rol distinto → OK', () => {
  const tasks = [task(1, 1, 'contenido'), task(2, 1, 'finanzas')];
  const edges = [edge(1, 1, 1, 2, 'review_of', '{"criteria":"calidad"}')];
  const g = validateTaskGraph(tasks, edges);
  assert.equal(g.hasReviewCycles, true);
});

test('handoff payload inválido (keys vacío) → error', () => {
  const tasks = [task(1, 1, 'investigador'), task(2, 1, 'contenido')];
  const edges = [edge(1, 1, 1, 2, 'handoff', '{"template":"{{x}}"}')];
  assert.throws(() => validateTaskGraph(tasks, edges), (e: unknown) => {
    return e instanceof TaskGraphValidationError && /handoff/.test((e as Error).message);
  });
});

test('handoff payload válido (keys + template con {{}}) → OK', () => {
  const tasks = [task(1, 1, 'investigador'), task(2, 1, 'contenido')];
  const edges = [edge(1, 1, 1, 2, 'handoff', '{"keys":["trend"],"template":"Tendencia: {{trend}}"}')];
  const g = validateTaskGraph(tasks, edges);
  assert.equal(g.topologicalOrder.length, 2);
});

test('auto-loop (from === to) → error', () => {
  const tasks = [task(1, 1, 'contenido')];
  const edges = [edge(1, 1, 1, 1, 'depends_on')];
  assert.throws(() => validateTaskGraph(tasks, edges), TaskGraphValidationError);
});
