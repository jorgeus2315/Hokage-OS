import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run } from '../db/init.js';
import { getRoleDefinition } from './roleService.js';
import { estimateTaskCostUsd } from './aiService.js';
import { listAuditEvents, getCommandTrace, sanitizeMeta, type AuditEvent } from './auditService.js';
import { createCommand, onHokageTaskCompleted, attemptReplan } from './hokageOrchestrator.js';
import { execute as toolExecute } from '../tools/registry.js';
import { writeAgentMemory } from './agentMemoryService.js';
import { createDecision, approveDecision, rejectDecision } from './decisionService.js';
import { resolveDecisionApproval, resolveDecisionRejection } from './decisionResolvers.js';
import type { RawPlanForTest } from './hokageOrchestrator.js';

// ═══ Tests de observabilidad / auditoría (Fase 9). BD aislada. ═══

const plan = (phases: Array<{ tasks: Array<{ role: string; title: string; task: string }> }>) =>
  async (): Promise<RawPlanForTest> => ({ phases });

let V1 = 0, V2 = 0, EST = 0, AGENT = 0;
const evTypes = (evs: AuditEvent[]) => evs.map((e) => e.type);

before(async () => {
  await initSchema();
  EST = estimateTaskCostUsd((await getRoleDefinition('finanzas'))!.model);
  V1 = (await run(`INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES ('AV1', 'store', 'active', 0)`)).lastID; // sin tope
  V2 = (await run(`INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES ('AV2', 'store', 'active', 0)`)).lastID;
  AGENT = (await run(`INSERT INTO agents (name, role, status, model) VALUES ('AudAgent', 'finanzas', 'idle', 'x')`)).lastID;
});

test('A · un command produce eventos correlacionables por command_id', async () => {
  const { command, tasks } = await createCommand({ text: 'orden A', ventureId: V1 }, plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]));
  const evs = await listAuditEvents({ commandId: command.id });
  assert.ok(evs.length > 0);
  assert.ok(evs.every((e) => e.command_id === command.id));
  assert.ok(evTypes(evs).includes('task.created'));
  assert.ok(evs.some((e) => e.task_id === tasks[0].id));
});

test('B · task tiene lifecycle (created + completed)', async () => {
  const { tasks } = await createCommand({ text: 'orden B', ventureId: V1 }, plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]));
  await onHokageTaskCompleted(tasks[0].work_item_id!, true, 'ok');
  const t = evTypes(await listAuditEvents({ taskId: tasks[0].id }));
  assert.ok(t.includes('task.created'));
  assert.ok(t.includes('task.completed'));
});

test('C · los eventos de tarea llevan work_item_id', async () => {
  const { tasks } = await createCommand({ text: 'orden C', ventureId: V1 }, plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]));
  await onHokageTaskCompleted(tasks[0].work_item_id!, true, 'ok');
  const evs = await listAuditEvents({ workItemId: tasks[0].work_item_id! });
  assert.ok(evs.some((e) => e.type === 'task.completed' && e.work_item_id === tasks[0].work_item_id));
});

test('D · el agente queda identificado en los eventos', async () => {
  const { command } = await createCommand({ text: 'orden D', ventureId: V1 }, plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]));
  const evs = await listAuditEvents({ commandId: command.id });
  assert.ok(evs.some((e) => e.type === 'agent.selected' || e.type === 'agent.created'));
  assert.ok(evs.some((e) => e.agent_id != null));
});

test('E · tools producen started/completed sin argumentos ni resultados', async () => {
  await toolExecute('memory.write', { key: 'k_audit', value: 'VALOR-SECRETO-TOOL' }, { agentId: AGENT, ventureId: V1 });
  assert.ok((await listAuditEvents({ agentId: AGENT, type: 'tool.started' })).length >= 1);
  assert.ok((await listAuditEvents({ agentId: AGENT, type: 'tool.completed' })).length >= 1);
  const blob = JSON.stringify(await listAuditEvents({ agentId: AGENT }));
  assert.ok(!blob.includes('VALOR-SECRETO-TOOL'), 'el valor del argumento no debe quedar en la auditoría');
});

test('F · decisiones producen eventos (created + approved + rejected)', async () => {
  const d1 = await createDecision({ agent_id: AGENT, venture_id: V1, title: 'Auditar decisión', description: 'x', risk_level: 'low' });
  await resolveDecisionApproval(await approveDecision(d1.id, 'Jorge'));
  const d2 = await createDecision({ agent_id: AGENT, venture_id: V1, title: 'Otra decisión', description: 'y', risk_level: 'low' });
  await resolveDecisionRejection(await rejectDecision(d2.id, 'Jorge'));
  const t = evTypes(await listAuditEvents({ ventureId: V1, limit: 500 }));
  assert.ok(t.includes('decision.created'));
  assert.ok(t.includes('decision.approved'));
  assert.ok(t.includes('decision.rejected'));
});

test('G · presupuesto: reserva, bloqueo y liberación se auditan', async () => {
  const vb = (await run(`INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES ('AudBudget', 'store', 'active', ?)`, [2 * EST])).lastID;
  const { command, tasks } = await createCommand(
    { text: 'orden G', ventureId: vb },
    plan([{ tasks: [{ role: 'finanzas', title: 'A', task: 'a' }, { role: 'finanzas', title: 'B', task: 'b' }, { role: 'finanzas', title: 'C', task: 'c' }] }])
  );
  const t = evTypes(await listAuditEvents({ commandId: command.id, limit: 500 }));
  assert.ok(t.includes('budget.reserved'));
  assert.ok(t.includes('budget.blocked')); // la 3ª tarea no cabe en 2*EST
  const done = tasks.find((x) => x.status === 'dispatched')!;
  await onHokageTaskCompleted(done.work_item_id!, true, 'ok');
  assert.ok((await listAuditEvents({ commandId: command.id, type: 'budget.released' })).length >= 1);
});

test('H · replan produce evento con el contador correcto', async () => {
  const c = await run(`INSERT INTO hokage_commands (venture_id, text, status) VALUES (?, 'obj', 'active')`, [V1]);
  await run(`INSERT INTO hokage_tasks (command_id, phase, role, title, prompt, status) VALUES (?, 0, 'finanzas', 'F', 'x', 'failed')`, [c.lastID]);
  await attemptReplan(c.lastID, plan([{ tasks: [{ role: 'contenido', title: 'N', task: 'y' }] }]));
  const evs = await listAuditEvents({ commandId: c.lastID, type: 'command.replanned' });
  assert.equal(evs.length, 1);
  assert.match(evs[0].payload, /"replan":1/);
});

test('I · memoria genera solo metadatos, nunca la clave ni el valor', async () => {
  await writeAgentMemory(AGENT, 'clave_privada', 'CONTENIDO-PRIVADO-MEM', V1);
  const evs = await listAuditEvents({ agentId: AGENT, type: 'memory.write' });
  assert.ok(evs.length >= 1);
  const blob = JSON.stringify(evs);
  assert.ok(!blob.includes('CONTENIDO-PRIVADO-MEM'));
  assert.ok(!blob.includes('clave_privada'));
  assert.match(evs[0].payload, /"category":"fact"/);
});

test('J · NO exfiltración: secretos inyectados no aparecen en event_log', async () => {
  await writeAgentMemory(AGENT, 'token_falso', 'ADMIN_TOKEN=supersecreto123', V1);
  await toolExecute('memory.write', { key: 'apikey', value: 'OPENROUTER_API_KEY=sk-falso-999' }, { agentId: AGENT, ventureId: V1 });
  await createDecision({ agent_id: AGENT, venture_id: V1, title: 'password=Authorization Bearer xyz', description: 'z', risk_level: 'low' });
  const blob = JSON.stringify(await listAuditEvents({ ventureId: V1, limit: 500 }));
  for (const secret of ['supersecreto123', 'sk-falso-999', 'Bearer xyz', 'Authorization Bearer']) {
    assert.ok(!blob.includes(secret), `no debe aparecer en la auditoría: ${secret}`);
  }
  // el sanitizador redacta claves sensibles aunque un caller se equivoque
  const s = sanitizeMeta({ token: 'x', apiKey: 'y', password: 'z', authorization: 'w', normal: 'ok' });
  assert.equal(s.token, '[redacted]');
  assert.equal(s.apiKey, '[redacted]');
  assert.equal(s.password, '[redacted]');
  assert.equal(s.authorization, '[redacted]');
  assert.equal(s.normal, 'ok');
});

test('K · una venture no puede consultar eventos de otra', async () => {
  const { command } = await createCommand({ text: 'K en V1', ventureId: V1 }, plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]));
  const evV2 = await listAuditEvents({ ventureId: V2, limit: 500 });
  assert.ok(!evV2.some((e) => e.command_id === command.id), 'V2 no ve eventos del command de V1');
  assert.ok(evV2.every((e) => e.venture_id === V2), 'la consulta de V2 solo devuelve eventos de V2');
});

test('M · filtros funcionan (type + commandId)', async () => {
  const { command } = await createCommand({ text: 'M', ventureId: V1 }, plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]));
  const onlyCreated = await listAuditEvents({ commandId: command.id, type: 'task.created' });
  assert.ok(onlyCreated.length >= 1);
  assert.ok(onlyCreated.every((e) => e.type === 'task.created' && e.command_id === command.id));
});

test('N · límite y cursor paginan', async () => {
  const page1 = await listAuditEvents({ ventureId: V1, limit: 3 });
  assert.ok(page1.length <= 3);
  if (page1.length === 3) {
    const cursor = page1[page1.length - 1].id;
    const page2 = await listAuditEvents({ ventureId: V1, limit: 3, cursor });
    assert.ok(page2.every((e) => e.id < cursor), 'la página 2 continúa antes del cursor');
  }
});

test('O · un command existente se reconstruye (command + tasks + work_items + events)', async () => {
  const { command, tasks } = await createCommand({ text: 'O', ventureId: V1 }, plan([{ tasks: [{ role: 'finanzas', title: 'T', task: 'x' }] }]));
  await onHokageTaskCompleted(tasks[0].work_item_id!, true, 'ok');
  const trace = (await getCommandTrace(command.id)) as { command: { id: number }; tasks: unknown[]; work_items: unknown[]; events: AuditEvent[] };
  assert.equal(trace.command.id, command.id);
  assert.equal(trace.tasks.length, 1);
  assert.ok(trace.work_items.length >= 1);
  assert.ok(trace.events.length > 0);
  assert.ok(trace.events.every((e) => e.command_id === command.id));
});
