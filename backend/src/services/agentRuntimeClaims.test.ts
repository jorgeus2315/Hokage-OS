import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get } from '../db/init.js';
import {
  claimAgent, releaseAgent, cleanupExpiredClaims, selectAgent, provisionAgent,
} from './agentSelector.js';
import {
  createCommand, onHokageTaskCompleted, onHokageWorkItemCancelled,
} from './hokageOrchestrator.js';
import type { RawPlanForTest } from './hokageOrchestrator.js';
import { createAgent } from './agentService.js';
import { runtime } from '../config/agentRuntime.js';

// ═══ Tests de INTEGRACIÓN: Agent Runtime ↔ ADR-011 (coordinación de claims). ═══
// Verifica la exclusión mutua UNIFICADA (una sola primitiva: claimAgent/releaseAgent) entre
// ejecución autónoma (runtime), Hokage (orquestador) y ejecución manual (endpoint):
//   - claim como gate atómico de pending→in_progress (stage2)
//   - release en éxito/error (stage3), TTL y presupuesto (stage4 / hooks), cancelación (Hokage)
//   - cleanupExpiredClaims por tick como red anti-deadlock (bug A)
//   - TTL vencido nunca deja un claim huérfano (bug B)
// La descomposición LLM se inyecta (plan determinista). askAgent se fuerza OFFLINE borrando la
// key → stage3 real sin red ni coste (askAgent devuelve {ok:false} → work_item 'failed').
// Este archivo corre el ÚLTIMO del suite (concurrency=1): puede limpiar la cola global sin dañar
// a otros archivos, que ya se ejecutaron.

let savedKey: string | undefined;

const plan = (phases: Array<{ tasks: Array<{ role: string; title: string; task: string }> }>) =>
  async (): Promise<RawPlanForTest> => ({ phases });

// Slate determinista para conducir stage2/stage3/stage4: sin work_items vivos ni claims previos.
async function resetSlate(): Promise<void> {
  await run(`UPDATE work_items SET status='cancelled', resolved_at=datetime('now') WHERE status IN ('pending','in_progress')`);
  await run(`UPDATE agents SET claimed_by_task=NULL, claim_expires_at=NULL, availability='available'`);
  await run(`UPDATE agent_schedules SET next_run_at = datetime('now','+1 day')`); // nadie 'due' en stage2
}

let seq = 0;
// Agente de negocio con rol único → sin role_definition → sin schedule autónomo (no ensucia stage2).
async function freshAgent(availability: 'available' | 'busy' = 'available'): Promise<number> {
  seq++;
  const a = await createAgent({ name: `ClaimTest ${seq}`, role: `zzz_claim_${seq}`, availability });
  return a.id;
}
async function pendingWorkItem(agentId: number, type = 'autonomous_run', priority = 9, ttl = 30): Promise<number> {
  const r = await run(
    `INSERT INTO work_items (agent_id, type, priority, status, context, ttl_minutes) VALUES (?, ?, ?, 'pending', 'ctx', ?)`,
    [agentId, type, priority, ttl]
  );
  return r.lastID;
}
async function agentRow(id: number) {
  return get<{ claimed_by_task: number | null; claim_expires_at: string | null; availability: string }>(
    'SELECT claimed_by_task, claim_expires_at, availability FROM agents WHERE id = ?', [id]
  );
}
async function wiStatus(id: number): Promise<string> {
  const r = await get<{ status: string }>('SELECT status FROM work_items WHERE id = ?', [id]);
  return r!.status;
}
async function freshVenture(name: string): Promise<number> {
  const r = await run(
    `INSERT INTO ventures (name, type, status, goal, revenue_target_usd) VALUES (?, 'store', 'active', 'g', 100)`,
    [name]
  );
  return r.lastID;
}

before(async () => {
  await initSchema();
  savedKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY; // stage3 offline: askAgent → {ok:false}, sin red ni coste
});
after(() => { if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey; });

// ── 1. Autonomous claim exitoso (stage2 = gate atómico) ─────────────────────────
test('#1 autonomous claim exitoso: stage2 reclama y promueve a in_progress', async () => {
  await resetSlate();
  const agentId = await freshAgent();
  const wi = await pendingWorkItem(agentId);

  await (runtime as any).stage2_assignWork();

  assert.equal(await wiStatus(wi), 'in_progress');
  const row = await agentRow(agentId);
  assert.equal(row!.claimed_by_task, wi);          // identidad del claim = work_item.id
  assert.equal(row!.availability, 'busy');
});

// ── 2. Autonomous claim rechazado porque el agente está ocupado ──────────────────
test('#2 autonomous claim rechazado: agente ya reclamado → work_item sigue pending', async () => {
  await resetSlate();
  const agentId = await freshAgent();
  assert.equal(await claimAgent(agentId, 777777, 30), true); // ocupado por otro
  const wi = await pendingWorkItem(agentId);

  await (runtime as any).stage2_assignWork();

  assert.equal(await wiStatus(wi), 'pending');       // no promovido
  assert.equal((await agentRow(agentId))!.claimed_by_task, 777777); // claim original intacto
});

// ── 3. Hokage no reutiliza un agente que el runtime tiene reclamado ──────────────
test('#3 Hokage (dispatch) no reutiliza un agente reclamado por el runtime', async () => {
  await resetSlate();
  const ventureId = await freshVenture('ClaimTest V3');
  const prov = await provisionAgent(ventureId, 'investigador'); // agente con capabilities reales
  assert.equal(await claimAgent(prov.agentId, 888888, 30), true);

  const { tasks } = await createCommand(
    { text: 'cmd-hokage-excl', ventureId },
    plan([{ tasks: [{ role: 'investigador', title: 'T', task: 't' }] }])
  );
  const t = tasks[0];
  assert.equal(t.status, 'dispatched');
  assert.notEqual(t.agent_id, prov.agentId);         // eligió/creó OTRO agente
  assert.equal((await agentRow(prov.agentId))!.claimed_by_task, 888888); // el reclamado, intacto
});

// ── 4. Release tras ÉXITO (path de completado de Hokage) ─────────────────────────
test('#4 release tras éxito: onHokageTaskCompleted(ok=true) libera el claim', async () => {
  await resetSlate();
  const { tasks } = await createCommand(
    { text: 'cmd-release-ok', ventureId: 1 },
    plan([{ tasks: [{ role: 'investigador', title: 'T', task: 't' }] }])
  );
  const t = tasks[0];
  const wi = t.work_item_id!;
  assert.equal(await claimAgent(t.agent_id!, wi, 30), true); // simula el claim de stage2

  await onHokageTaskCompleted(wi, true, 'hecho');

  const row = await agentRow(t.agent_id!);
  assert.equal(row!.claimed_by_task, null);
  assert.equal(row!.availability, 'available');
});

// ── 5. Release tras ERROR (stage2 + stage3 real, askAgent offline → failed) ──────
test('#5 release tras error: stage3 (askAgent offline → failed) libera el claim', async () => {
  await resetSlate();
  const agentId = await freshAgent();
  const wi = await pendingWorkItem(agentId);

  await (runtime as any).stage2_assignWork();       // claim + in_progress
  assert.equal(await wiStatus(wi), 'in_progress');
  await (runtime as any).stage3_executeAgents();    // ejecuta → ok:false → 'failed' → release

  assert.equal(await wiStatus(wi), 'failed');
  const row = await agentRow(agentId);
  assert.equal(row!.claimed_by_task, null);
  assert.equal(row!.availability, 'available');
});

// ── 6. Release tras TTL cancellation (retry ≥ 3 → cancelado) ─────────────────────
test('#6 release tras TTL cancellation: stage4 cancela y libera (retry≥3)', async () => {
  await resetSlate();
  const agentId = await freshAgent();
  const wi = await pendingWorkItem(agentId);
  assert.equal(await claimAgent(agentId, wi, 30), true);
  await run(`UPDATE work_items SET status='in_progress', locked_at=datetime('now','-60 minutes'), ttl_minutes=30, retry_count=3 WHERE id=?`, [wi]);

  await (runtime as any).stage4_checkTTLs();

  assert.equal(await wiStatus(wi), 'cancelled');
  const row = await agentRow(agentId);
  assert.equal(row!.claimed_by_task, null);
  assert.equal(row!.availability, 'available');
});

// ── 6b. TTL requeue (retry < 3 → pending + claim liberado para re-reclamar) ──────
test('#6b TTL requeue: stage4 devuelve a pending y libera el claim (retry<3)', async () => {
  await resetSlate();
  const agentId = await freshAgent();
  const wi = await pendingWorkItem(agentId);
  assert.equal(await claimAgent(agentId, wi, 30), true);
  await run(`UPDATE work_items SET status='in_progress', locked_at=datetime('now','-60 minutes'), ttl_minutes=30, retry_count=0 WHERE id=?`, [wi]);

  await (runtime as any).stage4_checkTTLs();

  assert.equal(await wiStatus(wi), 'pending');       // reencolado
  assert.equal((await agentRow(agentId))!.claimed_by_task, null); // liberado → re-reclamable
});

// ── 7. Release tras budget cancellation (hook onHokageWorkItemCancelled) ─────────
test('#7 release tras budget/cancel: onHokageWorkItemCancelled libera el claim', async () => {
  await resetSlate();
  const { tasks } = await createCommand(
    { text: 'cmd-release-cancel', ventureId: 1 },
    plan([{ tasks: [{ role: 'investigador', title: 'T', task: 't' }] }])
  );
  const t = tasks[0];
  const wi = t.work_item_id!;
  assert.equal(t.status, 'dispatched');
  assert.equal(await claimAgent(t.agent_id!, wi, 30), true);
  await run(`UPDATE work_items SET status='cancelled' WHERE id=?`, [wi]); // como hace stage2 al bloquear

  await onHokageWorkItemCancelled(wi);

  const row = await agentRow(t.agent_id!);
  assert.equal(row!.claimed_by_task, null);
  assert.equal(row!.availability, 'available');
});

// ── 8. Claim expirado + cleanup → agente vuelve a available ─────────────────────
test('#8 expired claim + cleanup → agente vuelve a available', async () => {
  await resetSlate();
  const agentId = await freshAgent();
  assert.equal(await claimAgent(agentId, 555, 30), true);
  await run(`UPDATE agents SET claim_expires_at=datetime('now','-1 minute') WHERE id=?`, [agentId]);

  const cleaned = await cleanupExpiredClaims();

  assert.ok(cleaned >= 1);
  const row = await agentRow(agentId);
  assert.equal(row!.claimed_by_task, null);
  assert.equal(row!.availability, 'available');
});

// ── 9. cleanup NO toca claims vivos ─────────────────────────────────────────────
test('#9 cleanup NO toca claims vivos', async () => {
  await resetSlate();
  const agentId = await freshAgent();
  assert.equal(await claimAgent(agentId, 556, 30), true); // expira en 30 min (vivo)

  await cleanupExpiredClaims();

  const row = await agentRow(agentId);
  assert.equal(row!.claimed_by_task, 556);
  assert.equal(row!.availability, 'busy');
});

// ── 10. Dos work_items del mismo agente → exactamente uno ejecuta ────────────────
test('#10 dos work_items del mismo agente → exactamente uno pasa a in_progress', async () => {
  await resetSlate();
  const agentId = await freshAgent();
  const wiA = await pendingWorkItem(agentId, 'autonomous_run', 9);
  const wiB = await pendingWorkItem(agentId, 'event_triggered', 9);

  await (runtime as any).stage2_assignWork();

  const statuses = [await wiStatus(wiA), await wiStatus(wiB)].sort();
  assert.deepEqual(statuses, ['in_progress', 'pending']); // exactamente uno
  const claimed = (await agentRow(agentId))!.claimed_by_task;
  assert.ok(claimed === wiA || claimed === wiB);
});

// ── 11. Runtime + Hokage compiten por el mismo agente → exactamente uno gana ─────
test('#11 runtime + Hokage: claim mutuamente excluyente + selectAgent respeta el claim', async () => {
  await resetSlate();
  // (a) dos subsistemas reclamando el mismo agente: exactamente uno gana
  const agentId = await freshAgent();
  assert.equal(await claimAgent(agentId, 1001, 30), true);  // runtime
  assert.equal(await claimAgent(agentId, 1002, 30), false); // Hokage pierde

  // (b) mientras el runtime lo posee, selectAgent (la vía de Hokage) no lo ofrece
  const ventureId = await freshVenture('ClaimTest V11');
  const prov = await provisionAgent(ventureId, 'investigador');
  const before = await selectAgent({ ventureId, requiredCapabilities: [], agentTypes: ['permanent'], maxResults: 5 });
  assert.ok(before.some((r) => r.agentId === prov.agentId));   // libre → ofrecido
  await claimAgent(prov.agentId, 1003, 30);
  const after = await selectAgent({ ventureId, requiredCapabilities: [], agentTypes: ['permanent'], maxResults: 5 });
  assert.ok(!after.some((r) => r.agentId === prov.agentId));   // reclamado → excluido
});

// ── 12. Anti-deadlock: claim expirado sin release NO deja al agente inclamable ───
test('#12 claim expirado sin release NO deja al agente permanentemente busy (bug A)', async () => {
  await resetSlate();
  const agentId = await freshAgent();
  assert.equal(await claimAgent(agentId, 600, 30), true);
  // Muerte de proceso: claim vencido pero availability sigue 'busy'.
  await run(`UPDATE agents SET claim_expires_at=datetime('now','-5 minutes') WHERE id=?`, [agentId]);

  // Antes del cleanup el agente está bloqueado: nadie puede re-reclamarlo (availability='busy').
  assert.equal(await claimAgent(agentId, 601, 30), false);

  // stage4 ejecuta cleanupExpiredClaims por tick → resetea availability→available.
  await (runtime as any).stage4_checkTTLs();
  const row = await agentRow(agentId);
  assert.equal(row!.availability, 'available');
  assert.equal(row!.claimed_by_task, null);
  assert.equal(await claimAgent(agentId, 602, 30), true); // re-reclamable
});

// ── 13. POST /api/agents/:id/run respeta el claim (sentinela -1) ─────────────────
test('#13 POST /run respeta el claim: manual (-1) y runtime son mutuamente excluyentes', async () => {
  await resetSlate();
  // runtime posee el agente → el claim manual del endpoint falla (endpoint respondería 409)
  const a1 = await freshAgent();
  assert.equal(await claimAgent(a1, 700, 30), true);
  assert.equal(await claimAgent(a1, -1, 5), false);

  // inverso: manual gana → runtime pierde; release(-1) (finally del endpoint) lo libera
  const a2 = await freshAgent();
  assert.equal(await claimAgent(a2, -1, 5), true);
  assert.equal(await claimAgent(a2, 701, 30), false);
  await releaseAgent(a2, -1);
  assert.equal((await agentRow(a2))!.claimed_by_task, null);
});
