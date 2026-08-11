import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get, all } from '../db/init.js';
import {
  createCommand, getCommand, cancelCommand, onHokageTaskCompleted, orchestratableRoles, attemptReplan,
} from './hokageOrchestrator.js';
import { createAgent } from './agentService.js';
import { createMemoryEntry, listBusinessMemory } from './memoryService.js';
import { composeSystemContext } from './contextComposer.js';
import { listRoleDefinitions } from './roleService.js';
import { autonomyAutoApproves } from '../config/rolePolicy.js';
import type { RawPlanForTest } from './hokageOrchestrator.js';

// ═══ Tests de INTEGRACIÓN de la Fase 5 (BD aislada vía HOKAGE_DB_PATH). ═══
// La descomposición LLM se inyecta (decomposeFn) para ser deterministas; la validación
// determinista y toda la orquestación (despacho, dependencias, fallos) se ejecutan de verdad.

// Plan fijo inyectable como si viniera del LLM (pasa igualmente por validatePlan).
const plan = (phases: Array<{ tasks: Array<{ role: string; title: string; task: string }> }>) =>
  async (): Promise<RawPlanForTest> => ({ phases });

let VENTURE_B = 0;

before(async () => {
  await initSchema(); // siembra venture 1, roles, hermes, departamentos
  const r = await run(
    `INSERT INTO ventures (name, type, status, goal, revenue_target_usd) VALUES ('Test Venture B','store','active','meta B',500)`
  );
  VENTURE_B = r.lastID;
});

async function completeDispatched(commandId: number, ok = true): Promise<void> {
  const res = await getCommand(commandId);
  for (const t of res!.tasks.filter((t) => t.status === 'dispatched' && t.work_item_id != null)) {
    await onHokageTaskCompleted(t.work_item_id!, ok, ok ? 'hecho' : 'fallo');
  }
}

test('#1 orden simple: 1 tarea → work_item con tipo/venture/agente correctos', async () => {
  const { command, tasks } = await createCommand(
    { text: 'Investiga el nicho de posters', ventureId: 1 },
    plan([{ tasks: [{ role: 'investigador', title: 'Demanda', task: 'Analiza la demanda' }] }])
  );
  assert.equal(command.status, 'active');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, 'dispatched');
  assert.ok(tasks[0].work_item_id);

  const wi = await get<{ type: string; venture_id: number; agent_id: number; context: string }>(
    'SELECT type, venture_id, agent_id, context FROM work_items WHERE id = ?', [tasks[0].work_item_id]
  );
  assert.equal(wi!.type, 'hokage_task');
  assert.equal(wi!.venture_id, 1);
  assert.ok(wi!.agent_id);
  assert.equal(wi!.context, 'Analiza la demanda');
});

test('#2/#4/#5 varios especialistas en paralelo, creados desde role_definitions', async () => {
  const { tasks } = await createCommand(
    { text: 'Evalúa oportunidad', ventureId: 1 },
    plan([{ tasks: [
      { role: 'investigador', title: 'Demanda', task: 'a' },
      { role: 'contenido', title: 'Copy', task: 'b' },
      { role: 'finanzas', title: 'Números', task: 'c' },
    ] }])
  );
  assert.equal(tasks.length, 3);
  // Todas despachadas a la vez (misma fase = paralelo seguro).
  assert.ok(tasks.every((t) => t.status === 'dispatched'));
  // Se crearon (o reutilizaron) agentes para cada rol.
  for (const role of ['investigador', 'contenido', 'finanzas']) {
    const agent = await get<{ id: number }>('SELECT id FROM agents WHERE role = ? LIMIT 1', [role]);
    assert.ok(agent, `esperaba un agente para ${role}`);
  }
});

test('#6 dependencias: la fase 1 espera a que la fase 0 termine OK', async () => {
  const { command, tasks } = await createCommand(
    { text: 'Investiga y luego escribe', ventureId: 1 },
    plan([
      { tasks: [{ role: 'investigador', title: 'F0', task: 'a' }] },
      { tasks: [{ role: 'contenido', title: 'F1', task: 'b' }] },
    ])
  );
  const f0 = tasks.find((t) => t.phase === 0)!;
  const f1 = tasks.find((t) => t.phase === 1)!;
  assert.equal(f0.status, 'dispatched');
  assert.equal(f1.status, 'pending'); // aún NO despachada

  await completeDispatched(command.id, true); // cierra la fase 0
  const after = await getCommand(command.id);
  const f1After = after!.tasks.find((t) => t.phase === 1)!;
  assert.equal(f1After.status, 'dispatched');

  // La fase 1 recibe el resultado de la fase 0 como DATO en su contexto (flujo de dependencias).
  const wi1 = await get<{ context: string }>('SELECT context FROM work_items WHERE id = ?', [f1After.work_item_id]);
  assert.match(wi1!.context, /RESULTADOS PREVIOS/);
  assert.match(wi1!.context, /hecho/);

  await completeDispatched(command.id, true); // cierra la fase 1
  const done = await getCommand(command.id);
  assert.equal(done!.command.status, 'completed');
});

test('#7/#8 fallo + continuación segura: la hermana termina, la fase dependiente se bloquea', async () => {
  const { command, tasks } = await createCommand(
    { text: 'Dos en paralelo, luego una', ventureId: 1 },
    plan([
      { tasks: [{ role: 'investigador', title: 'A', task: 'a' }, { role: 'trafico', title: 'B', task: 'b' }] },
      { tasks: [{ role: 'finanzas', title: 'C', task: 'c' }] },
    ])
  );
  const a = tasks.find((t) => t.title === 'A')!;
  const b = tasks.find((t) => t.title === 'B')!;

  await onHokageTaskCompleted(a.work_item_id!, false, 'error de red'); // A falla
  await onHokageTaskCompleted(b.work_item_id!, true, 'ok');            // B sigue y termina

  const res = await getCommand(command.id);
  assert.equal(res!.tasks.find((t) => t.title === 'A')!.status, 'failed');
  assert.equal(res!.tasks.find((t) => t.title === 'B')!.status, 'completed'); // no se abortó
  assert.equal(res!.tasks.find((t) => t.title === 'C')!.status, 'blocked');   // dependiente bloqueada
  assert.equal(res!.command.status, 'partial');
});

test('#15 límite presupuestario: agente sin presupuesto → tarea bloqueada, sin work_item', async () => {
  // Agente de finanzas scopeado a la venture B, con presupuesto agotado.
  const agent = await createAgent({ name: 'Fin B', role: 'finanzas', venture_id: VENTURE_B });
  await run('UPDATE agent_budgets SET monthly_limit_usd = 5, current_month_usd = 6 WHERE agent_id = ?', [agent.id]);

  const { command, tasks } = await createCommand(
    { text: 'Reporte financiero', ventureId: VENTURE_B },
    plan([{ tasks: [{ role: 'finanzas', title: 'Reporte', task: 'x' }] }])
  );
  assert.equal(tasks[0].status, 'blocked');
  assert.equal(tasks[0].work_item_id, null);
  assert.match(tasks[0].error ?? '', /presupuesto/);
  assert.equal(command.status, 'failed');
});

test('#16/#17/#18 aislamiento por venture: memoria y contexto no se filtran entre negocios', async () => {
  await createMemoryEntry({ ventureId: 1, category: 'learning', title: 'Secreto A', content: 'dato exclusivo de la venture 1' });
  await createMemoryEntry({ ventureId: VENTURE_B, category: 'learning', title: 'Secreto B', content: 'dato exclusivo de la venture B' });

  const memA = await listBusinessMemory(1, 20);
  const memB = await listBusinessMemory(VENTURE_B, 20);
  assert.ok(memA.some((m) => m.title === 'Secreto A'));
  assert.ok(!memA.some((m) => m.title === 'Secreto B'));
  assert.ok(memB.some((m) => m.title === 'Secreto B'));
  assert.ok(!memB.some((m) => m.title === 'Secreto A'));

  // ContextComposer scopea la memoria de negocio por venture.
  const agent = await get<{ id: number }>('SELECT id FROM agents WHERE role = ? LIMIT 1', ['investigador']);
  const ctxA = await composeSystemContext({ agentId: agent!.id, agentName: 'Explorador', ventureId: 1 });
  assert.match(ctxA, /Secreto A/);
  assert.ok(!/Secreto B/.test(ctxA));

  // Una orden en la venture B despacha work_items con venture_id = B (nunca otra).
  const { tasks } = await createCommand(
    { text: 'Trabajo en B', ventureId: VENTURE_B },
    plan([{ tasks: [{ role: 'investigador', title: 'T', task: 'x' }] }])
  );
  const wi = await get<{ venture_id: number }>('SELECT venture_id FROM work_items WHERE id = ?', [tasks[0].work_item_id]);
  assert.equal(wi!.venture_id, VENTURE_B);
});

test('#9/#10 frontera de autonomía intacta: L2 auto-aprueba solo lo no crítico', () => {
  assert.equal(autonomyAutoApproves(2, { amount: null, risk_level: 'low' }), true);   // L2 no crítico → auto
  assert.equal(autonomyAutoApproves(2, { amount: 5 }), false);                          // gasto → humano
  assert.equal(autonomyAutoApproves(2, { category: 'PUBLICATION' }), false);            // publicación → humano
  assert.equal(autonomyAutoApproves(2, { entity_type: 'system_exec' }), false);         // exec → humano
  assert.equal(autonomyAutoApproves(1, { amount: null }), false);                       // L1 nunca auto-aprueba
});

test('#19 sin regresión: 8 roles intactos; orquestables = 6 (excluye ceo/hermes)', async () => {
  const roles = await listRoleDefinitions();
  assert.ok(roles.length >= 8, `esperaba >=8 roles, hay ${roles.length}`);
  const orq = await orchestratableRoles();
  const keys = orq.map((r) => r.key).sort();
  assert.deepEqual(keys, ['contenido', 'finanzas', 'investigador', 'operaciones', 'soporte', 'trafico']);
  assert.ok(!keys.includes('ceo'));
  assert.ok(!keys.includes('hermes'));
});

test('#20 idempotencia: misma clave → mismo comando; completar dos veces = no-op', async () => {
  const key = 'idem-test-123';
  const first = await createCommand(
    { text: 'Orden idempotente', ventureId: 1, idempotencyKey: key },
    plan([{ tasks: [{ role: 'investigador', title: 'U', task: 'x' }] }])
  );
  const second = await createCommand(
    { text: 'Orden idempotente', ventureId: 1, idempotencyKey: key },
    plan([{ tasks: [{ role: 'contenido', title: 'OTRA', task: 'y' }] }])
  );
  assert.equal(second.command.id, first.command.id);       // mismo comando, no uno nuevo
  assert.equal(second.tasks.length, first.tasks.length);   // no duplica tareas

  const wi = first.tasks[0].work_item_id!;
  await onHokageTaskCompleted(wi, true, 'ok');
  await onHokageTaskCompleted(wi, true, 'ok-otra-vez'); // segunda vez: no-op
  const res = await getCommand(first.command.id);
  const t = res!.tasks[0];
  assert.equal(t.status, 'completed');
  assert.equal(t.result, 'ok'); // no se sobreescribió con el segundo intento
});

test('#2 command inválido: texto vacío se rechaza', async () => {
  await assert.rejects(() => createCommand({ text: '   ', ventureId: 1 }, plan([])), /no puede estar vacía/);
});

test('#3/#4 venture: válida se acepta, inexistente se rechaza', async () => {
  // válida (venture 1 sembrada)
  const ok = await createCommand({ text: 'Con venture válida', ventureId: 1 }, plan([{ tasks: [{ role: 'investigador', title: 'X', task: 'y' }] }]));
  assert.equal(ok.command.venture_id, 1);
  // inexistente
  await assert.rejects(() => createCommand({ text: 'Con venture fantasma', ventureId: 999999 }, plan([])), /Venture inexistente/);
});

test('#13 replanificación: tras un fallo, el supervisor genera y despacha un plan alternativo', async () => {
  // Estado: comando activo con una tarea fallida (montado a mano para probar el supervisor aislado).
  const c = await run(`INSERT INTO hokage_commands (venture_id, text, status) VALUES (1, 'obj replan', 'active')`);
  await run(`INSERT INTO hokage_tasks (command_id, phase, role, title, prompt, status) VALUES (?, 0, 'investigador', 'F0', 'x', 'failed')`, [c.lastID]);

  const ok = await attemptReplan(c.lastID, plan([{ tasks: [{ role: 'contenido', title: 'Alternativa', task: 'z' }] }]));
  assert.equal(ok, true);
  const res = await getCommand(c.lastID);
  const nueva = res!.tasks.find((t) => t.title === 'Alternativa');
  assert.ok(nueva, 'esperaba una tarea nueva del replan');
  assert.equal(nueva!.status, 'dispatched');
  assert.ok(nueva!.phase > 0, 'la tarea de replan va a una fase posterior');
  assert.equal(res!.command.replan_count, 1);
});

test('#14 límite de replanificaciones: en el tope no se replanifica (sin bucles)', async () => {
  const c = await run(`INSERT INTO hokage_commands (venture_id, text, status, replan_count) VALUES (1, 'obj tope', 'active', 2)`);
  await run(`INSERT INTO hokage_tasks (command_id, phase, role, title, prompt, status) VALUES (?, 0, 'investigador', 'F0', 'x', 'failed')`, [c.lastID]);

  const ok = await attemptReplan(c.lastID, plan([{ tasks: [{ role: 'contenido', title: 'NoDebeAparecer', task: 'z' }] }]));
  assert.equal(ok, false); // tope alcanzado
  const res = await getCommand(c.lastID);
  assert.ok(!res!.tasks.some((t) => t.title === 'NoDebeAparecer'));
  assert.equal(res!.command.replan_count, 2);
});

test('cancelación: bloquea el despacho futuro y es idempotente', async () => {
  const { command, tasks } = await createCommand(
    { text: 'Orden cancelable', ventureId: 1 },
    plan([
      { tasks: [{ role: 'investigador', title: 'P0', task: 'a' }] },
      { tasks: [{ role: 'contenido', title: 'P1', task: 'b' }] },
    ])
  );
  const p0 = tasks.find((t) => t.phase === 0)!;
  const cancelled = await cancelCommand(command.id);
  assert.equal(cancelled!.command.status, 'cancelled');

  // Completar la tarea ya cancelada no reanima el comando ni despacha la fase 1.
  await onHokageTaskCompleted(p0.work_item_id!, true, 'llegó tarde');
  const res = await getCommand(command.id);
  assert.equal(res!.command.status, 'cancelled');
  assert.equal(res!.tasks.find((t) => t.phase === 1)!.status, 'cancelled');
});
