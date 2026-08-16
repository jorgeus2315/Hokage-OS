import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get, all } from '../db/init.js';
import { createCommand, getCommand, onHokageTaskCompleted } from './hokageOrchestrator.js';
import type { RawPlanForTest } from './hokageOrchestrator.js';
import type { TaskEdge } from '../types/index.js';

// ═══ Tests de INTEGRACIÓN ADR-012 — Task Graph DAG con edges explícitos ═══
// Verifica: task_edges como fuente de verdad, depends_on_count, handoff dirigido,
// review_of spawn + veredicto, dispatchReadyTasks (grafo implícito por fase).

const plan = (phases: Array<{ tasks: Array<{ role: string; title: string; task: string }> }>) =>
  async (): Promise<RawPlanForTest> => ({ phases });

before(async () => {
  await initSchema(); // siembra venture 1, roles, hermes, departamentos
});

async function completeDispatched(commandId: number, ok = true, result = 'hecho'): Promise<void> {
  const res = await getCommand(commandId);
  for (const t of res!.tasks.filter((t) => t.status === 'dispatched' && t.work_item_id != null)) {
    await onHokageTaskCompleted(t.work_item_id!, ok, ok ? result : 'fallo');
  }
}

test('ADR-012 dispatchReadyTasks: paralelo en misma fase vía grafo implícito', async () => {
  const { command, tasks } = await createCommand(
    { text: 'Paralelo A', ventureId: 1 },
    plan([{ tasks: [
      { role: 'investigador', title: 'A', task: 'a' },
      { role: 'contenido', title: 'B', task: 'b' },
      { role: 'finanzas', title: 'C', task: 'c' },
    ] }])
  );
  assert.equal(tasks.length, 3);
  assert.ok(tasks.every((t) => t.status === 'dispatched'));
  // Las 3 tareas de la fase 0 tienen depends_on_count = 0 (no hay aristas entrantes).
  const deps = await all<{ id: number; depends_on_count: number }>(
    'SELECT id, depends_on_count FROM hokage_tasks WHERE command_id = ?', [command.id]
  );
  assert.ok(deps.every((d) => d.depends_on_count === 0));
});

test('ADR-012 task_edges creadas por fase: fan-in completo', async () => {
  const { command } = await createCommand(
    { text: 'Grafo implícito', ventureId: 1 },
    plan([
      { tasks: [{ role: 'investigador', title: 'F0', task: 'a' }] },
      { tasks: [{ role: 'contenido', title: 'F1', task: 'b' }] },
    ])
  );
  const edges = await all<TaskEdge>(
    "SELECT * FROM task_edges WHERE command_id = ? AND type = 'depends_on'", [command.id]
  );
  assert.equal(edges.length, 1); // F0 → F1
  assert.equal(edges[0].from_task_id, edges[0].from_task_id);
});

test('ADR-012 directed handoff: resultado propagado a handoff_input de task destino', async () => {
  // Insertar comando y luego inyectar edge handoff explícito.
  const { command, tasks } = await createCommand(
    { text: 'Handoff dirigido', ventureId: 1 },
    plan([
      { tasks: [{ role: 'investigador', title: 'Origen', task: 'encuentra tendencia' }] },
      { tasks: [{ role: 'contenido', title: 'Destino', task: 'escribe copy' }] },
    ])
  );
  const origin = tasks.find((t) => t.title === 'Origen')!;
  const dest = tasks.find((t) => t.title === 'Destino')!;

  // Reemplazar grafo implícito por handoff dirigido: origin → dest (handoff) + depends_on.
  await run('DELETE FROM task_edges WHERE command_id = ?', [command.id]);
  await run(
    `INSERT INTO task_edges (command_id, from_task_id, to_task_id, type, payload) VALUES (?, ?, ?, 'handoff', ?)`,
    [command.id, origin.id, dest.id, JSON.stringify({ keys: ['kw'], template: 'Keyword sugerida: {{kw}}' })]
  );
  await run(
    `INSERT INTO task_edges (command_id, from_task_id, to_task_id, type, payload) VALUES (?, ?, ?, 'depends_on', '{}')`,
    [command.id, origin.id, dest.id]
  );
  await run('UPDATE hokage_tasks SET depends_on_count = 1 WHERE id = ?', [dest.id]);

  // Completar origen con resultado JSON que contiene 'kw'.
  await onHokageTaskCompleted(origin.work_item_id!, true, JSON.stringify({ kw: 'posters minimalistas' }));

  const destAfter = (await getCommand(command.id))!.tasks.find((t) => t.title === 'Destino')!;
  assert.equal(destAfter.status, 'dispatched');
  const handoff = await get<{ handoff_input: string }>('SELECT handoff_input FROM hokage_tasks WHERE id = ?', [dest.id]);
  assert.match(handoff!.handoff_input, /posters minimalistas/);
  const wi = await get<{ context: string }>('SELECT context FROM work_items WHERE id = ?', [destAfter.work_item_id!]);
  assert.match(wi!.context, /HANDOFF de investigador/);
  assert.match(wi!.context, /posters minimalistas/);
});

test('ADR-012 review_of spawn: tarea completada dispara review_task', async () => {
  const { command, tasks } = await createCommand(
    { text: 'Review cycle', ventureId: 1 },
    plan([
      { tasks: [{ role: 'contenido', title: 'Original', task: 'escribe' }] },
      { tasks: [{ role: 'finanzas', title: 'Revisor', task: 'revisa' }] },
    ])
  );
  const original = tasks.find((t) => t.title === 'Original')!;
  const reviewTask = tasks.find((t) => t.title === 'Revisor')!;

  // Grafo: original → reviewTask (review_of), original → reviewTask (depends_on para que espere).
  await run('DELETE FROM task_edges WHERE command_id = ?', [command.id]);
  await run(
    `INSERT INTO task_edges (command_id, from_task_id, to_task_id, type, payload) VALUES (?, ?, ?, 'review_of', ?)`,
    [command.id, original.id, reviewTask.id, JSON.stringify({ criteria: 'calidad y estilo' })]
  );
  await run(
    `INSERT INTO task_edges (command_id, from_task_id, to_task_id, type, payload) VALUES (?, ?, ?, 'depends_on', '{}')`,
    [command.id, original.id, reviewTask.id]
  );
  await run('UPDATE hokage_tasks SET depends_on_count = 1 WHERE id = ?', [reviewTask.id]);

  // Completar original → dispara review_task.
  await onHokageTaskCompleted(original.work_item_id!, true, 'Contenido listo');
  const res = await getCommand(command.id);
  const reviewAfter = res!.tasks.find((t) => t.title === 'Revisor')!;
  assert.equal(reviewAfter.status, 'dispatched');
  const origAfter = res!.tasks.find((t) => t.title === 'Original')!;
  assert.equal(origAfter.review_cycles, 1);
});

test('ADR-012 review verdict pass: avanza el grafo', async () => {
  const { command, tasks } = await createCommand(
    { text: 'Review pass', ventureId: 1 },
    plan([
      { tasks: [{ role: 'contenido', title: 'Original2', task: 'escribe' }] },
      { tasks: [{ role: 'finanzas', title: 'Revisor2', task: 'revisa' }] },
    ])
  );
  const original = tasks.find((t) => t.title === 'Original2')!;
  const reviewTask = tasks.find((t) => t.title === 'Revisor2')!;

  await run('DELETE FROM task_edges WHERE command_id = ?', [command.id]);
  await run(
    `INSERT INTO task_edges (command_id, from_task_id, to_task_id, type, payload) VALUES (?, ?, ?, 'review_of', ?)`,
    [command.id, original.id, reviewTask.id, JSON.stringify({ criteria: 'calidad' })]
  );
  await run(
    `INSERT INTO task_edges (command_id, from_task_id, to_task_id, type, payload) VALUES (?, ?, ?, 'depends_on', '{}')`,
    [command.id, original.id, reviewTask.id]
  );
  await run('UPDATE hokage_tasks SET depends_on_count = 1 WHERE id = ?', [reviewTask.id]);

  await onHokageTaskCompleted(original.work_item_id!, true, 'Contenido listo');
  // Revisor completa con veredicto pass → original avanza (review_verdict guardado).
  const res = await getCommand(command.id);
  const reviewDispatched = res!.tasks.find((t) => t.title === 'Revisor2')!;
  await onHokageTaskCompleted(reviewDispatched.work_item_id!, true, JSON.stringify({ verdict: 'pass', feedback: 'Excelente' }));

  const final = await getCommand(command.id);
  const origFinal = final!.tasks.find((t) => t.title === 'Original2')!;
  assert.equal(origFinal.review_verdict, 'pass');
  assert.equal(origFinal.review_feedback, 'Excelente');
});

test('ADR-012 review verdict fail: re-abre original con feedback inyectado', async () => {
  const { command, tasks } = await createCommand(
    { text: 'Review fail', ventureId: 1 },
    plan([
      { tasks: [{ role: 'contenido', title: 'Original3', task: 'escribe' }] },
      { tasks: [{ role: 'finanzas', title: 'Revisor3', task: 'revisa' }] },
    ])
  );
  const original = tasks.find((t) => t.title === 'Original3')!;
  const reviewTask = tasks.find((t) => t.title === 'Revisor3')!;

  await run('DELETE FROM task_edges WHERE command_id = ?', [command.id]);
  await run(
    `INSERT INTO task_edges (command_id, from_task_id, to_task_id, type, payload) VALUES (?, ?, ?, 'review_of', ?)`,
    [command.id, original.id, reviewTask.id, JSON.stringify({ criteria: 'calidad' })]
  );
  await run(
    `INSERT INTO task_edges (command_id, from_task_id, to_task_id, type, payload) VALUES (?, ?, ?, 'depends_on', '{}')`,
    [command.id, original.id, reviewTask.id]
  );
  await run('UPDATE hokage_tasks SET depends_on_count = 1 WHERE id = ?', [reviewTask.id]);

  await onHokageTaskCompleted(original.work_item_id!, true, 'Borrador inicial');
  const res = await getCommand(command.id);
  const reviewDispatched = res!.tasks.find((t) => t.title === 'Revisor3')!;
  await onHokageTaskCompleted(reviewDispatched.work_item_id!, true, JSON.stringify({ verdict: 'fail', feedback: 'Falta SEO' }));

  const final = await getCommand(command.id);
  const origFinal = final!.tasks.find((t) => t.title === 'Original3')!;
  assert.equal(origFinal.status, 'pending'); // re-abierta
  assert.equal(origFinal.review_verdict, 'fail');
  assert.equal(origFinal.agent_id, null); // limpiada para re-despacho
  assert.match(origFinal.prompt, /FEEDBACK DE REVISIÓN/);
  assert.match(origFinal.prompt, /Falta SEO/);
});
