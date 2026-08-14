import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get } from '../db/init.js';
import { createAgent } from './agentService.js';
import {
  deriveAgentRuntimeState, computeAgentRuntimeState, computeAllRuntimeStates, stateSignature,
  type AgentStateEvidence, type WorkItemEvidence,
} from './agentRuntimeState.js';

// ═══ Tests de K.4 — derivación real de AgentRuntimeState (ADR-007). ═══
// El deriver es PURO: se prueba con evidencia inyectada y `now` fijo → determinismo total,
// sin sleeps ni azar. Además, integración con la BD real (recalculabilidad, aislamiento).

const NOW = '2026-08-13T12:00:00.000Z';
const T = {
  ago10s: '2026-08-13T11:59:50.000Z',   // dentro de COMPLETED (30s) y ERROR (60s)
  ago30s: '2026-08-13T11:59:30.000Z',   // dentro de ERROR (60s), borde de COMPLETED
  ago120s: '2026-08-13T11:58:00.000Z',  // FUERA de ambas ventanas
};

const ev = (over: Partial<AgentStateEvidence> = {}): AgentStateEvidence => ({
  agentId: 1, isActiveInRuntime: false, activeWorkItem: null, lastResolvedWorkItem: null,
  proposedDecisionCount: 0, now: NOW, ...over,
});
const activeWI = (over: Partial<WorkItemEvidence> = {}): WorkItemEvidence => ({
  id: 5, type: 'autonomous_run', ventureId: 2, status: 'in_progress', lockedAt: T.ago10s, createdAt: T.ago30s, resolvedAt: null, ...over,
});
const resolvedWI = (status: string, resolvedAt: string, ventureId: number | null = 2): WorkItemEvidence => ({
  id: 9, type: 'autonomous_run', ventureId, status, lockedAt: null, createdAt: T.ago120s, resolvedAt,
});

// ── Deriver PURO ─────────────────────────────────────────────────────────────

test('K.4 #1 IDLE sin evidencia (no inventa actividad)', () => {
  const s = deriveAgentRuntimeState(ev());
  assert.equal(s.primary, 'IDLE');
  assert.equal(s.activity, 0);
  assert.equal(s.currentTask, undefined);
  assert.deepEqual(s.modifiers, { awaitingApproval: false, hasError: false, blocked: false, reviewing: false });
  assert.equal(s.source, 'runtime');
});

test('K.4 #2 WORKING con work_item in_progress + currentTask + venture', () => {
  const s = deriveAgentRuntimeState(ev({ activeWorkItem: activeWI() }));
  assert.equal(s.primary, 'WORKING');
  assert.equal(s.activity, 1);
  assert.equal(s.ventureId, 2);
  assert.equal(s.currentTask?.workItemId, 5);
  assert.equal(s.currentTask?.kind, 'autonomous_run');
});

test('K.4 #3 ERROR con fallo reciente (dentro de ventana)', () => {
  const s = deriveAgentRuntimeState(ev({ lastResolvedWorkItem: resolvedWI('failed', T.ago30s) }));
  assert.equal(s.primary, 'ERROR');
  assert.equal(s.modifiers.hasError, true);
  assert.equal(s.activity, 0.2);
});

test('K.4 #4 COMPLETED con done reciente (ventana breve)', () => {
  const s = deriveAgentRuntimeState(ev({ lastResolvedWorkItem: resolvedWI('done', T.ago10s) }));
  assert.equal(s.primary, 'COMPLETED');
  assert.equal(s.activity, 0.5);
});

test('K.4 #5 done ANTIGUO → IDLE (NO "working porque hace X min")', () => {
  const s = deriveAgentRuntimeState(ev({ lastResolvedWorkItem: resolvedWI('done', T.ago120s) }));
  assert.equal(s.primary, 'IDLE');   // fuera de la ventana → no COMPLETED, no WORKING
  assert.equal(s.activity, 0);
});

test('K.4 #6 modificador awaitingApproval por decisión propuesta', () => {
  const s = deriveAgentRuntimeState(ev({ proposedDecisionCount: 2 }));
  assert.equal(s.modifiers.awaitingApproval, true);
  assert.equal(s.primary, 'IDLE');   // sin trabajo activo, el modificador no crea actividad
});

test('K.4 #7 concurrencia: WORKING + awaitingApproval (el modificador no sustituye al primario)', () => {
  const s = deriveAgentRuntimeState(ev({ activeWorkItem: activeWI(), proposedDecisionCount: 1 }));
  assert.equal(s.primary, 'WORKING');
  assert.equal(s.modifiers.awaitingApproval, true);
});

test('K.4 #8 hasError persiste con IDLE si el último resuelto fue failed (fuera de ventana ERROR)', () => {
  const s = deriveAgentRuntimeState(ev({ lastResolvedWorkItem: resolvedWI('failed', T.ago120s) }));
  assert.equal(s.primary, 'IDLE');
  assert.equal(s.modifiers.hasError, true);
});

test('K.4 #9 determinismo: misma evidencia → mismo estado', () => {
  const input = ev({ activeWorkItem: activeWI(), proposedDecisionCount: 1 });
  assert.deepEqual(deriveAgentRuntimeState(input), deriveAgentRuntimeState(input));
});

test('K.4 #10 activity deriva del ESTADO, no del tiempo (Math.random/setInterval no participan)', () => {
  const now1 = deriveAgentRuntimeState(ev({ activeWorkItem: activeWI(), now: NOW }));
  const now2 = deriveAgentRuntimeState(ev({ activeWorkItem: activeWI(), now: '2027-01-01T00:00:00.000Z' }));
  assert.equal(now1.activity, 1);
  assert.equal(now2.activity, 1);   // muy distinto `now`, misma actividad → no es heurística temporal
  assert.equal(now1.primary, now2.primary);
});

test('K.4 #11 ausencia total de datos → IDLE (el backend nunca convierte ausencia en WORKING)', () => {
  const s = deriveAgentRuntimeState(ev({ activeWorkItem: null, lastResolvedWorkItem: null, proposedDecisionCount: 0 }));
  assert.equal(s.primary, 'IDLE');
  assert.equal(s.activity, 0);
});

// ── Firma / delta ────────────────────────────────────────────────────────────

test('K.4 #12 firma ignora updatedAt (un recálculo con otro timestamp NO genera delta)', () => {
  const a = deriveAgentRuntimeState(ev({ activeWorkItem: activeWI(), now: NOW }));
  const b = deriveAgentRuntimeState(ev({ activeWorkItem: activeWI(), now: '2026-08-13T12:05:00.000Z' }));
  assert.notEqual(a.updatedAt, b.updatedAt);
  assert.equal(stateSignature(a), stateSignature(b));   // mismo estado real → misma firma → sin delta
});

test('K.4 #13 firma cambia al cambiar el estado real (sí genera delta)', () => {
  const idle = deriveAgentRuntimeState(ev());
  const working = deriveAgentRuntimeState(ev({ activeWorkItem: activeWI() }));
  assert.notEqual(stateSignature(idle), stateSignature(working));
});

// ── Integración con BD real ──────────────────────────────────────────────────

let hermesId = 0;
before(async () => {
  await initSchema();
  const h = await get<{ id: number }>(`SELECT id FROM agents WHERE role = 'hermes'`);
  hermesId = h!.id;
});

test('K.4 #14 computeAgentRuntimeState: agente sin trabajo → IDLE', async () => {
  const a = await createAgent({ name: 'K4 Idle', role: 'investigador' });
  const s = await computeAgentRuntimeState(a.id, false);
  assert.equal(s.primary, 'IDLE');
  assert.equal(s.currentTask, undefined);
});

test('K.4 #15 computeAgentRuntimeState: work_item in_progress → WORKING + currentTask + venture', async () => {
  const a = await createAgent({ name: 'K4 Working', role: 'investigador' });
  const v = await run(`INSERT INTO ventures (name, type, status, goal, revenue_target_usd) VALUES ('V-K4','store','active','m',100)`);
  const wi = await run(
    `INSERT INTO work_items (agent_id, venture_id, type, status, locked_at, created_at) VALUES (?, ?, 'autonomous_run', 'in_progress', datetime('now'), datetime('now'))`,
    [a.id, v.lastID],
  );
  const s = await computeAgentRuntimeState(a.id, true);
  assert.equal(s.primary, 'WORKING');
  assert.equal(s.currentTask?.workItemId, wi.lastID);
  assert.equal(s.ventureId, v.lastID);
});

test('K.4 #16 recalculable tras REINICIO: WORKING deriva de work_items durable, no de activeAgents', async () => {
  const a = await createAgent({ name: 'K4 Restart', role: 'contenido' });
  await run(
    `INSERT INTO work_items (agent_id, type, status, locked_at, created_at) VALUES (?, 'autonomous_run', 'in_progress', datetime('now'), datetime('now'))`,
    [a.id],
  );
  // isActive=false simula activeAgents VACÍO tras un reinicio del proceso.
  const s = await computeAgentRuntimeState(a.id, false);
  assert.equal(s.primary, 'WORKING');   // sigue WORKING: la verdad es durable (work_items)
});

test('K.4 #17 modificador awaitingApproval desde decisions reales', async () => {
  const a = await createAgent({ name: 'K4 Decide', role: 'finanzas' });
  await run(`INSERT INTO decisions (agent_id, title, status) VALUES (?, 'aprueba esto', 'proposed')`, [a.id]);
  const s = await computeAgentRuntimeState(a.id, false);
  assert.equal(s.modifiers.awaitingApproval, true);
});

test('K.4 #18 multi-agente: dos agentes con estados independientes (por agentId)', async () => {
  const a = await createAgent({ name: 'K4 A', role: 'investigador' });
  const b = await createAgent({ name: 'K4 B', role: 'contenido' });
  await run(`INSERT INTO work_items (agent_id, type, status, locked_at, created_at) VALUES (?, 'autonomous_run', 'in_progress', datetime('now'), datetime('now'))`, [a.id]);
  const sa = await computeAgentRuntimeState(a.id, true);
  const sb = await computeAgentRuntimeState(b.id, false);
  assert.equal(sa.primary, 'WORKING');
  assert.equal(sb.primary, 'IDLE');
  assert.notEqual(sa.agentId, sb.agentId);
});

test('K.4 #19 aislamiento por venture: el estado lleva su venture_id y no mezcla', async () => {
  const a = await createAgent({ name: 'K4 V1', role: 'investigador' });
  const v1 = await run(`INSERT INTO ventures (name, type, status, goal, revenue_target_usd) VALUES ('V1-K4','store','active','m',100)`);
  await run(`INSERT INTO work_items (agent_id, venture_id, type, status, locked_at, created_at) VALUES (?, ?, 'autonomous_run', 'in_progress', datetime('now'), datetime('now'))`, [a.id, v1.lastID]);
  const s = await computeAgentRuntimeState(a.id, true);
  assert.equal(s.ventureId, v1.lastID);
});

test('K.4 #20 computeAllRuntimeStates excluye a Hermes (kernel) e incluye agentes de negocio', async () => {
  const nuevo = await createAgent({ name: 'K4 Nuevo', role: 'investigador' });   // agente creado posteriormente
  const states = await computeAllRuntimeStates(new Set());
  assert.ok(!states.some((s) => s.agentId === hermesId), 'Hermes no debe tener AgentRuntimeState de negocio');
  assert.ok(states.some((s) => s.agentId === nuevo.id), 'un agente creado después sí aparece');
  assert.ok(states.every((s) => s.source === 'runtime'));
});
