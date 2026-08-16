import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get } from '../db/init.js';
import { createCommand, onHokageTaskCompleted } from './hokageOrchestrator.js';
import { classifyProviderError } from './aiService.js';
import type { HokageTask } from '../types/index.js';
import type { RawPlanForTest } from './hokageOrchestrator.js';

// ═══ ADR-014 — Transient error classification → retry_immediate (integración + clasificador). ═══

const plan = (phases: Array<{ tasks: Array<{ role: string; title: string; task: string }> }>) =>
  async (): Promise<RawPlanForTest> => ({ phases });

before(async () => { await initSchema(); });

let seq = 0;
async function oneDispatchedTask(): Promise<HokageTask> {
  seq++;
  const { tasks } = await createCommand(
    { text: `orden transient #${seq}`, ventureId: 1 },
    plan([{ tasks: [{ role: 'investigador', title: `TR${seq}`, task: 'haz algo' }] }])
  );
  assert.equal(tasks[0].status, 'dispatched');
  return (await get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [tasks[0].id]))!;
}
const fullTask = (id: number) => get<HokageTask>('SELECT * FROM hokage_tasks WHERE id = ?', [id]) as Promise<HokageTask>;
const countWorkItems = async () => (await get<{ n: number }>('SELECT COUNT(*) as n FROM work_items'))!.n;

// 1. ok=false + transient → retry_immediate (retry_count+1, un solo redispatch, sin remediation_count).
test('TC #1 ok=false + transient → retry_immediate', async () => {
  const t = await oneDispatchedTask();
  const oldWi = t.work_item_id!;
  const before = await countWorkItems();

  await onHokageTaskCompleted(oldWi, false, 'OpenRouter 429: rate limited', 'transient');

  const after = await fullTask(t.id);
  assert.equal(after.status, 'dispatched');            // re-despachada
  assert.notEqual(after.work_item_id, oldWi);          // nuevo work_item
  assert.equal(after.retry_count, 1);                  // retry_immediate cuenta como retry técnico
  assert.equal(after.remediation_count, 0);            // no cuenta como remediación de calidad
  assert.equal((await countWorkItems()) - before, 1);  // exactamente UN redispatch
  const newWi = await get<{ type: string }>('SELECT type FROM work_items WHERE id = ?', [after.work_item_id]);
  assert.equal(newWi!.type, 'hokage_task');            // vuelve por el dispatcher existente
});

// 2. transient + maxRetries agotado → terminal seguro (human_intervention), sin nuevo dispatch.
test('TC #2 transient con retry_immediate agotado → terminal humano', async () => {
  const t = await oneDispatchedTask();
  const hist = JSON.stringify([
    { action: 'retry_immediate', workItemId: 1, createdAt: 'x' },
    { action: 'retry_immediate', workItemId: 1, createdAt: 'x' },
  ]); // == maxRetries por defecto (2)
  await run(`UPDATE hokage_tasks SET remediation_history = ? WHERE id = ?`, [hist, t.id]);
  const before = await countWorkItems();

  await onHokageTaskCompleted(t.work_item_id!, false, 'timeout', 'transient');

  const after = await fullTask(t.id);
  assert.equal(after.status, 'failed');                 // terminal
  assert.equal(await countWorkItems(), before);         // sin redispatch (no loop)
  const dec = await get<{ id: number }>('SELECT id FROM decisions WHERE entity_type = ? AND entity_id = ?', ['hokage_task', t.id]);
  assert.ok(dec, 'esperaba Decision de intervención humana');
});

// 3. ok=false + permanent → failed, sin remediación.
test('TC #3 ok=false + permanent → failed sin remediación', async () => {
  const t = await oneDispatchedTask();
  const oldWi = t.work_item_id!;
  await onHokageTaskCompleted(oldWi, false, 'OpenRouter 400: bad request', 'permanent');
  const after = await fullTask(t.id);
  assert.equal(after.status, 'failed');
  assert.equal(after.work_item_id, oldWi);   // no re-despacho
  assert.equal(after.retry_count, 0);
  assert.equal(after.remediation_count, 0);
});

// 4. ok=false + errorClass undefined → comportamiento preexistente (failed, sin remediación).
test('TC #4 ok=false sin errorClass → failed (comportamiento preexistente)', async () => {
  const t = await oneDispatchedTask();
  const oldWi = t.work_item_id!;
  await onHokageTaskCompleted(oldWi, false, 'algo falló'); // sin 4º argumento
  const after = await fullTask(t.id);
  assert.equal(after.status, 'failed');
  assert.equal(after.work_item_id, oldWi);
  assert.equal(after.retry_count, 0);
});

// 5. Clasificador determinista (señales realmente disponibles del proveedor).
test('TC #5 classifyProviderError mapea señales correctamente', () => {
  assert.equal(classifyProviderError(new Error('OpenRouter 429: too many requests')), 'transient');
  assert.equal(classifyProviderError(new Error('rate limit exceeded')), 'transient');
  assert.equal(classifyProviderError(new Error('OpenRouter no respondió a tiempo')), 'transient');
  assert.equal(classifyProviderError({ message: 'fetch failed', cause: { code: 'ECONNRESET' } }), 'transient');
  assert.equal(classifyProviderError(new Error('error de red')), 'transient');
  assert.equal(classifyProviderError(new Error('OpenRouter 503: service unavailable')), 'transient');
  assert.equal(classifyProviderError(new Error('OpenRouter 401: unauthorized')), 'policy');
  assert.equal(classifyProviderError(new Error('OpenRouter 403: forbidden')), 'policy');
  assert.equal(classifyProviderError(new Error('OpenRouter 400: bad request')), 'permanent');
  assert.equal(classifyProviderError(new Error('OpenRouter 500: internal server error')), 'permanent');
  assert.equal(classifyProviderError(new Error('algo raro e inesperado')), 'permanent'); // ambigüedad → permanent
});
