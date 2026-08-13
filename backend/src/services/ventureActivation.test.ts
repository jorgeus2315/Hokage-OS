import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get, all } from '../db/init.js';
import { activateVenture, type DecomposeFn } from './ventureActivation.js';
import { createCommand } from './hokageOrchestrator.js';
import { createVentureFromProposal } from './opportunityPipeline.js';
import { listAuditEvents } from './auditService.js';

// ═══ Tests de integración F12 — activación de venture. BD aislada. ═══
// decompose se inyecta (sin red), igual que en F5/F11. El brief lo compone CÓDIGO (7.3); la única
// IA sería el decompose de F5, aquí simulado. Verifican: gate de presupuesto 0 (7.1), idempotencia
// (secuencial, crash-retry, concurrencia), hilo venture_id, distinción de source y auditoría.

const fakeDecompose: DecomposeFn = async () => ({ phases: [{ tasks: [{ role: 'finanzas', title: 'Arranque', task: 'primer paso' }] }] });

// Crea funding + oportunidad + propuesta + venture (con source_proposal_id), como deja F11 tras aprobar.
async function ventureWithProposal(opts: { budget: number; content?: Record<string, unknown> }): Promise<{ ventureId: number; proposalId: number }> {
  const funding = (await run(`INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES ('Fund F12', 'store', 'active', 0)`)).lastID;
  const opp = (await run(`INSERT INTO opportunities (funding_venture_id, title, status) VALUES (?, 'Op F12', 'awaiting_approval')`, [funding])).lastID;
  const content = JSON.stringify(opts.content ?? { target_customer: 'gente que ama gatos', value_proposition: 'algo valioso y único', key_assumptions: ['pagan 20€', 'demanda alta'] });
  const prop = (await run(
    `INSERT INTO business_proposals (opportunity_id, content, proposed_budget_usd, proposed_name, proposed_type, status) VALUES (?, ?, ?, 'Nueva Venture F12', 'store', 'awaiting_approval')`,
    [opp, content, opts.budget]
  )).lastID;
  const venture = (await run(
    `INSERT INTO ventures (name, type, status, goal, budget_allocated_usd, source_proposal_id) VALUES ('Nueva Venture F12', 'store', 'active', ?, ?, ?)`,
    [`Creada desde propuesta #${prop}`, opts.budget, prop]
  )).lastID;
  return { ventureId: venture, proposalId: prop };
}

const requestedSource = async (ventureId: number): Promise<string | undefined> => {
  const ev = await get<{ payload: string }>("SELECT payload FROM event_log WHERE type = 'venture.activation_requested' AND venture_id = ? ORDER BY id DESC LIMIT 1", [ventureId]);
  return ev ? (JSON.parse(ev.payload).source as string) : undefined;
};

before(async () => { await initSchema(); });

test('activación feliz (budget>0): sella activated_at, crea 1 command con venture_id + key, enriquece goal', async () => {
  const { ventureId } = await ventureWithProposal({ budget: 30 });
  const res = await activateVenture(ventureId, 'endpoint', fakeDecompose);

  assert.equal(res.activated, true);
  assert.ok(res.commandId);
  const v = await get<{ activated_at: string | null; goal: string }>('SELECT activated_at, goal FROM ventures WHERE id = ?', [ventureId]);
  assert.ok(v!.activated_at, 'activated_at debe quedar sellado');
  assert.notEqual(v!.goal, `Creada desde propuesta #`); // goal enriquecido, no el placeholder
  const cmd = await get<{ venture_id: number; idempotency_key: string }>('SELECT venture_id, idempotency_key FROM hokage_commands WHERE id = ?', [res.commandId]);
  assert.equal(cmd!.venture_id, ventureId); // hilo venture_id intacto (F7/F8)
  assert.equal(cmd!.idempotency_key, `venture-activation-${ventureId}`);
  const tasks = await all('SELECT id FROM hokage_tasks WHERE command_id = ?', [res.commandId]);
  assert.ok(tasks.length >= 1, 'el orquestador F5 descompuso en ≥1 task');
  // 7.3 determinista: el brief lleva campos de la propuesta compuestos por código.
  const cmdText = await get<{ text: string }>('SELECT text FROM hokage_commands WHERE id = ?', [res.commandId]);
  assert.ok(cmdText!.text.includes('gente que ama gatos'));
  // Auditoría F9 correlacionada.
  const evs = await listAuditEvents({ ventureId });
  assert.ok(evs.some((e) => e.type === 'venture.activated' && e.command_id === res.commandId));
});

test('7.1 · budget 0 no auto-activa (queda inerte); con presupuesto asignado, activa', async () => {
  const { ventureId } = await ventureWithProposal({ budget: 0 });
  const r1 = await activateVenture(ventureId, 'endpoint', fakeDecompose);
  assert.equal(r1.activated, false);
  assert.equal(r1.reason, 'no_budget');
  const v0 = await get<{ activated_at: string | null }>('SELECT activated_at FROM ventures WHERE id = ?', [ventureId]);
  assert.equal(v0!.activated_at, null);
  const cnt0 = await get<{ c: number }>('SELECT COUNT(*) c FROM hokage_commands WHERE venture_id = ?', [ventureId]);
  assert.equal(cnt0!.c, 0); // ni un command, no gasta
  const evs = await listAuditEvents({ ventureId });
  assert.ok(evs.some((e) => e.type === 'venture.activation_skipped'));

  // Asignar presupuesto (superficie de gestión existente) + reactivar por el backstop.
  await run(`UPDATE ventures SET budget_allocated_usd = 25 WHERE id = ?`, [ventureId]);
  const r2 = await activateVenture(ventureId, 'endpoint', fakeDecompose);
  assert.equal(r2.activated, true);
});

test('idempotencia secuencial: segunda llamada → already_activated, sin segundo command', async () => {
  const { ventureId } = await ventureWithProposal({ budget: 40 });
  const a = await activateVenture(ventureId, 'endpoint', fakeDecompose);
  const b = await activateVenture(ventureId, 'endpoint', fakeDecompose);
  assert.equal(a.activated, true);
  assert.equal(b.activated, false);
  assert.equal(b.reason, 'already_activated');
  const cnt = await get<{ c: number }>('SELECT COUNT(*) c FROM hokage_commands WHERE idempotency_key = ?', [`venture-activation-${ventureId}`]);
  assert.equal(cnt!.c, 1);
  const evs = await listAuditEvents({ ventureId });
  assert.equal(evs.filter((e) => e.type === 'venture.activated').length, 1);
});

test('idempotencia concurrente: invariante = 1 command y 1 activación sea cual sea el interleaving', async () => {
  const { ventureId } = await ventureWithProposal({ budget: 40 });
  // allSettled: bajo carrera, el perdedor puede reutilizar o fallar por UNIQUE(idempotency_key);
  // la invariante que importa se cumple en ambos casos.
  await Promise.allSettled([
    activateVenture(ventureId, 'endpoint', fakeDecompose),
    activateVenture(ventureId, 'endpoint', fakeDecompose),
  ]);
  const cnt = await get<{ c: number }>('SELECT COUNT(*) c FROM hokage_commands WHERE idempotency_key = ?', [`venture-activation-${ventureId}`]);
  assert.equal(cnt!.c, 1); // nunca dos commands
  const v = await get<{ activated_at: string | null }>('SELECT activated_at FROM ventures WHERE id = ?', [ventureId]);
  assert.ok(v!.activated_at);
  const evs = await listAuditEvents({ ventureId });
  assert.equal(evs.filter((e) => e.type === 'venture.activated').length, 1); // sellado una sola vez
});

test('retry tras crash entre createCommand y activated_at: reusa la MISMA key, un único command', async () => {
  const { ventureId } = await ventureWithProposal({ budget: 35 });
  const key = `venture-activation-${ventureId}`;
  // Simula el crash: el command de activación ya se creó, pero el proceso murió antes del CAS →
  // activated_at quedó NULL (venture con command pero inerte).
  const pre = await createCommand({ text: 'brief del intento previo', ventureId, idempotencyKey: key }, fakeDecompose);
  const v0 = await get<{ activated_at: string | null }>('SELECT activated_at FROM ventures WHERE id = ?', [ventureId]);
  assert.equal(v0!.activated_at, null);

  const res = await activateVenture(ventureId, 'endpoint', fakeDecompose);
  assert.equal(res.activated, true);
  assert.equal(res.commandId, pre.command.id); // reutiliza el command del intento anterior (misma key)
  const cnt = await get<{ c: number }>('SELECT COUNT(*) c FROM hokage_commands WHERE idempotency_key = ?', [key]);
  assert.equal(cnt!.c, 1); // no se duplicó
  const v1 = await get<{ activated_at: string | null }>('SELECT activated_at FROM ventures WHERE id = ?', [ventureId]);
  assert.ok(v1!.activated_at); // ahora sí sellado
});

test('source distingue approval vs endpoint en venture.activation_requested', async () => {
  const viaApproval = await ventureWithProposal({ budget: 20 });
  await activateVenture(viaApproval.ventureId, 'approval', fakeDecompose);
  assert.equal(await requestedSource(viaApproval.ventureId), 'approval');

  const viaEndpoint = await ventureWithProposal({ budget: 20 });
  await activateVenture(viaEndpoint.ventureId, 'endpoint', fakeDecompose);
  assert.equal(await requestedSource(viaEndpoint.ventureId), 'endpoint');
});

test('venture inexistente → no_venture, sin efectos', async () => {
  const res = await activateVenture(999999, 'endpoint', fakeDecompose);
  assert.equal(res.activated, false);
  assert.equal(res.reason, 'no_venture');
});

test('createVentureFromProposal devuelve el ventureId y es idempotente (wiring F12)', async () => {
  // Propuesta lista para crear (sin venture aún): el resolver usa este id para activar.
  const funding = (await run(`INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES ('Fund W', 'store', 'active', 0)`)).lastID;
  const opp = (await run(`INSERT INTO opportunities (funding_venture_id, title, status) VALUES (?, 'Op W', 'awaiting_approval')`, [funding])).lastID;
  const prop = (await run(`INSERT INTO business_proposals (opportunity_id, content, proposed_budget_usd, proposed_name, proposed_type, status) VALUES (?, '{}', 15, 'Venture W', 'store', 'awaiting_approval')`, [opp])).lastID;
  await run(`UPDATE opportunities SET status = 'awaiting_approval' WHERE id = ?`, [opp]);

  const id1 = await createVentureFromProposal(prop);
  assert.equal(typeof id1, 'number');
  const id2 = await createVentureFromProposal(prop); // idempotente → mismo id
  assert.equal(id2, id1);
  const cnt = await get<{ c: number }>('SELECT COUNT(*) c FROM ventures WHERE source_proposal_id = ?', [prop]);
  assert.equal(cnt!.c, 1);
});
