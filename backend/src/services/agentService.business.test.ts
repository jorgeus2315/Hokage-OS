import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, get } from '../db/init.js';
import { listAgents, listBusinessAgents, getAgent, createAgent } from './agentService.js';
import { orchestratableRoles } from './hokageOrchestrator.js';
import { requestExec, listExecRuns } from './hermesService.js';

// ═══ Tests de B.1 (Fase B — Hermes como Kernel) ═══
// Frontera de datos aditiva y segura: Hermes deja de contarse como agente de NEGOCIO sin
// borrarse de `agents`, sin tocar frontend/chat y sin alterar system.exec. La distinción
// canónica es role_definitions.scope='system'.

let hermesId = 0;

before(async () => {
  await initSchema(); // siembra roles, Hermes (scope='system') y departamentos
  const h = await get<{ id: number }>(`SELECT id FROM agents WHERE role = 'hermes'`);
  assert.ok(h, 'Hermes debe seguir sembrado en agents (no se elimina en B.1)');
  hermesId = h!.id;
});

test('B.1 #1 listBusinessAgents excluye Hermes y conserva los agentes de negocio', async () => {
  // Determinista: initSchema solo siembra a Hermes en `agents`; creamos un agente de negocio
  // real (rol 'investigador', scope='business') en vez de depender del seed o de otros tests.
  const biz = await createAgent({ name: 'B1 Investigador', role: 'investigador' });
  const business = await listBusinessAgents();
  assert.ok(!business.some((a) => a.role === 'hermes'), 'Hermes NO debe aparecer como agente de negocio');
  assert.ok(business.some((a) => a.id === biz.id), 'un agente de negocio real sigue presente');
});

test('B.1 #2 listAgents SÍ mantiene a Hermes (resolución interna intacta)', async () => {
  const all = await listAgents();
  assert.ok(all.some((a) => a.role === 'hermes'), 'listAgents conserva Hermes para resolución interna');
});

test('B.1 #3 getAgent(hermesId) sigue resolviendo a Hermes por id', async () => {
  const h = await getAgent(hermesId);
  assert.ok(h, 'getAgent debe resolver la fila de Hermes');
  assert.equal(h!.role, 'hermes');
});

test('B.1 #4 el orquestador sigue excluyendo a Hermes de los roles orquestables', async () => {
  const roles = await orchestratableRoles();
  assert.ok(!roles.some((r) => r.key === 'hermes'), 'Hermes nunca es delegable por Hokage');
});

test('B.1 #5 system.exec intacto: requestExec crea exec_run PENDIENTE + decision, sin ejecutar', async () => {
  const antes = (await listExecRuns(100)).length;
  const { execRunId, decisionId } = await requestExec({ agentId: hermesId, command: 'echo b1', reason: 'test B.1' });
  assert.ok(execRunId > 0 && decisionId > 0, 'requestExec devuelve ids válidos');

  const runs = await listExecRuns(100);
  assert.equal(runs.length, antes + 1, 'se registra exactamente un exec_run nuevo');
  const rec = runs.find((r) => r.id === execRunId);
  assert.ok(rec, 'el exec_run creado es consultable');
  assert.equal(rec!.status, 'pending', 'el comando queda PENDIENTE de aprobación, no se ejecuta');
  assert.equal(rec!.command, 'echo b1');
  assert.equal(rec!.decision_id, decisionId, 'exec_run queda vinculado a su decision');
});
