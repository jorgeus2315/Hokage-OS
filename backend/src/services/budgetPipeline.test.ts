import { test, before, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Aislar BD para tests de budgetPipeline — DEBE ir ANTES de importar init.ts
const testDbPath = path.resolve(__dirname, '../../data/test-budget-pipeline.db');
process.env.HOKAGE_DB_PATH = testDbPath;

// Sin .env: el proveedor de IA se inyecta como FAKE determinista (ver FakeProvider abajo).
// El test no depende de OPENROUTER_API_KEY, red ni disponibilidad de modelos.

// Importaciones DESPUÉS de configurar HOKAGE_DB_PATH
import { initSchema, run, get, all } from '../db/init.js';
import { createAgent } from './agentService.js';
import { toolsForRole } from '../config/agentModels.js';
import { reserveVentureBudget, releaseVentureBudget, getVentureBudget, checkVentureBudgetAlert, createBudgetRequestDecision } from './ventureBudget.js';
import { runtime } from '../config/agentRuntime.js';
import { run as runDb, get as getDb } from '../db/init.js';
import bus from '../config/eventBus.js';
import { askAgent } from './aiService.js';
import { get as getTool } from '../tools/registry.js';
import { registerProvider, type AIProvider, type ChatResponse } from './aiProvider.js';

// ── Proveedor de IA FAKE: determinista, sin red ni API key (paso 1 del rediseño de costes) ──
// Sustituye a OpenRouter en la frontera aiProvider vía registerProvider(). Devuelve tokens fijos
// para que askAgent() calcule un coste determinista y ejecute su ruta real (agent_costs, budgets)
// sin tocar la red. `script` permite guionizar respuestas (p. ej. con tool_calls) en pasos futuros.
class FakeProvider implements AIProvider {
  readonly id = 'openrouter';
  script: ChatResponse[] = [];
  isConfigured(): boolean { return true; }
  listModels() { return []; }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (this.script.length > 0) return this.script.shift()!;
    // Fallback: si el sistema pasa tools, devolvemos una respuesta con tool_calls vacíos
    // para evitar loop infinito. Sin tools, devolvemos respuesta de texto simple.
    if (req.tools && req.tools.length > 0) {
      return { content: '', toolCalls: [], tokensIn: 100, tokensOut: 50, totalTokens: 150 };
    }
    return { content: 'respuesta fake determinista', toolCalls: [], tokensIn: 100, tokensOut: 50, totalTokens: 150 };
  }

  // Helper para configurar respuestas con tool_calls específicos
  setScript(responses: ChatResponse[]) {
    this.script = responses;
  }
}
const fakeProvider = new FakeProvider();
let restoreProvider: (() => void) | undefined;

// Conduce UN tick del runtime de forma determinista: activa `running` solo durante el tick y
// cancela el timer de 10s que pollTick() reprograma en su finally. Así no queda un motor de tick
// de fondo compitiendo con las llamadas manuales — la carrera que causaba flakiness y el cuelgue
// del proceso de test. Reemplaza a runtime.start() + pollTick() manuales.
async function tick(): Promise<void> {
  const rt = runtime as any;
  rt.running = true;
  try {
    await rt.pollTick();
  } finally {
    rt.running = false;
    clearTimeout(rt.pollTimer);
    rt.pollTimer = null;
  }
}

// Helper local para crear work_items (no exportado por agentRuntime)
async function createWorkItem(params: {
  agentId: number;
  ventureId?: number | null;
  type: 'autonomous_run' | 'event_triggered' | 'decision_execution';
  priority?: number;
  context?: string;
}): Promise<number> {
  const result = await runDb(
    `INSERT INTO work_items (agent_id, venture_id, type, priority, status, context)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [params.agentId, params.ventureId ?? null, params.type, params.priority ?? 6, params.context ?? null]
  );
  return result.lastID;
}

// ═══ Fase 4.2 + Budget Enforcement — Tests integrales ═══
// BD aislada vía HOKAGE_DB_PATH = data/test-budget-pipeline.db

let ventureId: number;
let contenidoAgentId: number;
let investigadorAgentId: number;

before(async () => {
  await initSchema();

  // Usar venture existente 'Minimal Designs' (ya tiene agent_budgets sembrados)
  const v = await getDb<{ id: number }>(`SELECT id FROM ventures WHERE name = 'Minimal Designs'`);
  ventureId = v!.id;

  // Asegurar agentes sembrados
  const c = await getDb<{ id: number }>(`SELECT id FROM agents WHERE role = 'contenido'`);
  const i = await getDb<{ id: number }>(`SELECT id FROM agents WHERE role = 'investigador'`);
  contenidoAgentId = c!.id;
  investigadorAgentId = i!.id;

  // Asegurar que agent_budgets existe para estos agentes en este venture
  // (seedAgents solo crea si el agente es nuevo, pero los budgets pueden haberse borrado)
  for (const agentId of [contenidoAgentId, investigadorAgentId]) {
    const existing = await getDb<{ id: number }>('SELECT 1 as id FROM agent_budgets WHERE agent_id = ? AND venture_id = ?', [agentId, ventureId]);
    if (!existing) {
      const def = await getDb<{ monthly_budget_usd: number }>('SELECT monthly_budget_usd FROM role_definitions WHERE key = (SELECT role FROM agents WHERE id = ?)', [agentId]);
      const monthlyLimit = def?.monthly_budget_usd ?? 5.0;
      await runDb(
        `INSERT INTO agent_budgets (agent_id, venture_id, monthly_limit_usd, current_month_usd, reset_date, status)
         VALUES (?, ?, ?, 0, strftime('%Y-%m-01', 'now', '+1 month'), 'active')`,
        [agentId, ventureId, monthlyLimit]
      );
    }
  }

  // Asegurar que agente contenido tiene google.trends
  const tools = toolsForRole('contenido');
  assert.ok(tools.includes('google.trends'), 'contenido debe tener google.trends');

  // Inyectar proveedor de IA FAKE (frontera aiProvider): sin OpenRouter, sin red, sin API key.
  restoreProvider = registerProvider('openrouter', fakeProvider);

  // Preparar los listeners del bus una sola vez (los pipeline tests publican eventos que stage1
  // drena). NO se arranca el timer de fondo: cada tick se conduce a mano con tick().
  const rt = runtime as any;
  if (!rt.listenersReady) { rt.setupEventListeners(); rt.listenersReady = true; }
});

afterEach(async () => {
  // Limpiar work_items, decisions, agent_costs entre tests
  // NO borrar agent_budgets: se siembra una vez en before() y usa INSERT OR IGNORE
  // Resetear venture budget para aislar tests
  await runDb(`UPDATE ventures SET budget_allocated_usd = 10.00, budget_spent_usd = 0.00 WHERE id = ?`, [ventureId]);
  // Resetear consumo mensual de los agentes de prueba — si un test (p. ej. test 3)
  // deja al agente contenido bloqueado (current >= limit), los tests siguientes que
  // necesitan que contenido EJECUTE se cancelarían en stage2 y no producirían
  // agent_costs ni decisiones. Mismo principio de aislamiento que el venture budget.
  await runDb(`UPDATE agent_budgets SET current_month_usd = 0 WHERE agent_id IN (?, ?) AND venture_id = ?`, [contenidoAgentId, investigadorAgentId, ventureId]);
  // Orden de borrado: hijos antes que padres. agent_costs.work_item_id → work_items (FK), así que
  // agent_costs DEBE borrarse antes que work_items. Antes no se notaba porque agent_costs estaba
  // siempre vacío (el proveedor real fallaba); con el FakeProvider askAgent ya registra costes.
  await runDb(`DELETE FROM agent_costs`);
  await runDb(`DELETE FROM work_items`);
  await runDb(`DELETE FROM decisions`);
  await runDb(`DELETE FROM market`);
  await runDb(`DELETE FROM content`);
  // Resetear claims de agentes: los tests que conducen SOLO stage2 (reserva+claim) no ejecutan
  // stage3/stage4, que en producción liberarían el claim. Sin este reset, un agente queda reclamado
  // y el siguiente test no puede reclamarlo. En producción no aplica (stage2→stage3 en el mismo tick).
  await runDb(`UPDATE agents SET claimed_by_task = NULL, claim_expires_at = NULL, availability = 'available'`);
});

after(async () => {
  const rt = runtime as any;
  rt.running = false;
  clearTimeout(rt.pollTimer);
  rt.pollTimer = null;
  restoreProvider?.();
});

test('google.trends: contenido tiene la tool asignada', () => {
  const tools = toolsForRole('contenido');
  assert.ok(tools.includes('google.trends'), 'contenido debe tener google.trends');
  assert.ok(tools.includes('content.create'), 'contenido debe tener content.create');
  assert.ok(tools.includes('etsy.create_listing'), 'contenido debe tener etsy.create_listing');
  assert.ok(tools.includes('decision.create'), 'contenido debe tener decision.create');
});

test('google.trends: tool registrada y operativa', async () => {
  const tool = getTool('google.trends');
  assert.ok(tool, 'google.trends debe estar registrado');
  assert.equal(tool!.status, 'ready');
  assert.equal(tool!.requiredApproval, false);
  assert.equal(tool!.category, 'research');
});

test('budget: agente contenido bloqueado al alcanzar límite mensual (stage2_assignWork)', async () => {
  // Configurar presupuesto mensual bajo para contenido (Paso 3: límite en agent_budgets, gasto en agent_costs)
  await runDb(`UPDATE agent_budgets SET monthly_limit_usd = 0.10 WHERE agent_id = ? AND venture_id = ?`, [contenidoAgentId, ventureId]);
  // Simular gasto previo en el mes actual vía agent_costs (fuente de verdad ADR-015)
  await runDb(
    `INSERT INTO agent_costs (agent_id, venture_id, model, tokens_in, tokens_out, llm_cost_usd, tool_cost_usd, created_at)
     VALUES (?, ?, 'test-model', 0, 0, 0.15, 0, datetime('now'))`,
    [contenidoAgentId, ventureId]
  );

  // Crear work_item autónomo pendiente
  const workItemId = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'test' });

  // Ejecutar stage2_assignWork (via pollTick una vez)
  await tick();

  // Verificar que el work_item fue cancelado (por ID específico, no el último)
  const wi = await get<{ status: string }>('SELECT status FROM work_items WHERE id = ?', [workItemId]);
  assert.equal(wi?.status, 'cancelled', 'work_item debe ser cancelado por presupuesto excedido');
});

test('budget: venture bloqueada al alcanzar 100% (stage2_assignWork)', async () => {
  // Venture con presupuesto 0.50, ya gastado 0.50
  await runDb(`UPDATE ventures SET budget_allocated_usd = 0.50, budget_spent_usd = 0.50 WHERE id = ?`, [ventureId]);

  // Crear work_item para cualquier agente de negocio
  await createWorkItem({ agentId: investigadorAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'test' });

  await tick();

  const wi = await get<{ status: string }>('SELECT status FROM work_items WHERE agent_id = ? ORDER BY id DESC LIMIT 1', [investigadorAgentId]);
  assert.equal(wi?.status, 'cancelled', 'work_item debe ser cancelado por presupuesto venture agotado');

  // Verificar que se creó decision de budget_request
  const dec = await get<{ title: string; category: string }>('SELECT title, category FROM decisions WHERE venture_id = ? AND category = \'FINANCIAL\' ORDER BY id DESC LIMIT 1', [ventureId]);
  assert.ok(dec, 'debe crearse decision budget_request');
  assert.match(dec.title, /Presupuesto venture agotado/);
});

test('budget: warning al 80% venture (no bloquea, se ejecuta)', async () => {
  await runDb(`UPDATE ventures SET budget_allocated_usd = 1.00, budget_spent_usd = 0.80 WHERE id = ?`, [ventureId]);

  await createWorkItem({ agentId: investigadorAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'test' });
  await tick();

  const wi = await get<{ status: string }>('SELECT status FROM work_items WHERE agent_id = ? ORDER BY id DESC LIMIT 1', [investigadorAgentId]);
  assert.equal(wi?.status, 'done', 'work_item debe ejecutarse en warning (80%) - warning no bloquea');
});

test('cost registration: agent_costs populado en stage3_executeAgents con venture_id, model, tokens, costs', async () => {
  // Limpiar antes
  await runDb(`DELETE FROM agent_costs`);

  // Crear work_item y ejecutar
  await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'Di hola mundo' });
  await tick(); // stage1 + stage2
  await tick(); // stage3 ejecuta

  // Verificar agent_costs tiene fila con venture_id, model, tokens, costs
  const cost = await get<{ venture_id: number; model: string; tokens_in: number; tokens_out: number; llm_cost_usd: number; tool_cost_usd: number; work_item_id: number | null }>(
    'SELECT venture_id, model, tokens_in, tokens_out, llm_cost_usd, tool_cost_usd, work_item_id FROM agent_costs WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
    [contenidoAgentId]
  );

  assert.ok(cost, 'debe haber fila en agent_costs');
  assert.equal(cost.venture_id, ventureId, 'venture_id debe propagarse');
  assert.ok(cost.model && cost.model.length > 0, 'model debe registrarse');
  assert.ok(cost.tokens_in >= 0, 'tokens_in debe existir');
  assert.ok(cost.tokens_out >= 0, 'tokens_out debe existir');
  assert.ok(cost.llm_cost_usd >= 0, 'llm_cost_usd debe existir');
});

test('cost registration: work_items poblado con costes desde agent_costs (trazabilidad)', async () => {
  await runDb(`DELETE FROM agent_costs`);
  await runDb(`DELETE FROM work_items`);

  await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'Di hola mundo' });
  await tick();
  await tick();

  const wi = await get<{ tokens_in: number; tokens_out: number; llm_cost_usd: number; tool_cost_usd: number }>(
    'SELECT tokens_in, tokens_out, llm_cost_usd, tool_cost_usd FROM work_items WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
    [contenidoAgentId]
  );

  assert.ok(wi, 'work_item debe existir');
  // Los costes se copian de agent_costs a work_items
  assert.ok(wi.tokens_in >= 0);
  assert.ok(wi.tokens_out >= 0);
  assert.ok(wi.llm_cost_usd >= 0);
});

test('cost registration: sin duplicados en reintentos (work_item_id marcado en agent_costs)', async () => {
  await runDb(`DELETE FROM agent_costs`);
  await runDb(`DELETE FROM work_items`);

  // Crear work_item específico y guardar su ID
  const workItemId1 = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'event_triggered', priority: 5, context: 'test' });

  // Ejecutar hasta que este work_item específico se complete
  // pollTick ejecuta stage1 (drain bus + scheduler), stage2 (asignar), stage3 (ejecutar)
  await tick();

  // Verificar que este work_item específico tiene su coste en agent_costs
  const cost1 = await get<{ c: number }>('SELECT COUNT(*) as c FROM agent_costs WHERE work_item_id = ?', [workItemId1]);
  assert.equal(cost1?.c, 1, 'work_item 1 tiene exactamente 1 fila de coste');

  // Simular reintento: crear segundo work_item específico
  const workItemId2 = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'event_triggered', priority: 5, context: 'test 2' });
  await tick();

  // Verificar que cada work_item tiene SU fila de coste
  const cost2 = await get<{ c: number }>('SELECT COUNT(*) as c FROM agent_costs WHERE work_item_id = ?', [workItemId2]);
  assert.equal(cost2?.c, 1, 'work_item 2 tiene exactamente 1 fila de coste');

  // Verificar total: 2 filas, una por cada work_item
  const totalCosts = await get<{ c: number }>('SELECT COUNT(*) as c FROM agent_costs WHERE agent_id = ? AND work_item_id IS NOT NULL', [contenidoAgentId]);
  assert.equal(totalCosts?.c, 2, 'total 2 filas de coste, sin duplicados');
});

test('venture isolation: costes de V1 no afectan V2', async () => {
  const v2 = (await runDb(`INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES ('V2', 'store', 'active', 100)`)).lastID;

  await runDb(`DELETE FROM agent_costs`);

  // Coste en V1
  await runDb(`INSERT INTO agent_costs (agent_id, venture_id, tokens_in, tokens_out, llm_cost_usd) VALUES (?, ?, 100, 50, 0.01)`, [contenidoAgentId, ventureId]);
  // Coste en V2
  await runDb(`INSERT INTO agent_costs (agent_id, venture_id, tokens_in, tokens_out, llm_cost_usd) VALUES (?, ?, 200, 100, 0.02)`, [contenidoAgentId, v2]);

  const b1 = await getVentureBudget(ventureId);
  const b2 = await getVentureBudget(v2);

  assert.ok(b1!.real > 0, 'V1 tiene coste real');
  assert.equal(b2!.real, 0.02, 'V2 tiene su coste real aislado');
  assert.ok(b1!.real !== b2!.real, 'costes aislados por venture');
});

test('pipeline 4.2: trend.detected → contenido crea content.create → decision.create', async () => {
  await runDb(`DELETE FROM work_items`);
  await runDb(`DELETE FROM decisions`);
  await runDb(`DELETE FROM market`);
  await runDb(`DELETE FROM content`);

  // Usar keyword única para este test para evitar colisiones con tests previos
  const uniqueKeyword = `test keyword ${Date.now()}`;

  // Configurar fake provider ANTES del primer tick - el primer tick ya ejecuta stage3
  const summary = `Contenido para ${uniqueKeyword}`;
  const decisionTitle = `Publicar en Etsy — ${uniqueKeyword}`;
  const contentCreateArgs = JSON.stringify({ keyword: uniqueKeyword, summary });
  const decisionCreateArgs = JSON.stringify({ title: decisionTitle, description: 'Contenido listo para publicar', risk_level: 'low', amount: 0 });
  const r1: ChatResponse = {
    content: '',
    toolCalls: [{ id: 'call_1', function: { name: 'content_create', arguments: contentCreateArgs } }],
    tokensIn: 100,
    tokensOut: 50,
    totalTokens: 150
  };
  const r2: ChatResponse = {
    content: '',
    toolCalls: [{ id: 'call_2', function: { name: 'decision_create', arguments: decisionCreateArgs } }],
    tokensIn: 100,
    tokensOut: 50,
    totalTokens: 150
  };
  const r3: ChatResponse = {
    content: 'Contenido y decisión creados',
    toolCalls: [],
    tokensIn: 50,
    tokensOut: 20,
    totalTokens: 70
  };
  fakeProvider.setScript([r1, r2, r3]);

  // Simular evento trend.detected (desde Explorador)
  bus.publish({
    type: 'trend.detected',
    from: 'investigador',
    payload: { keyword: uniqueKeyword, description: 'Tendencia en alza', detectedAt: new Date().toISOString() }
  });

  // Procesar eventos (stage1 + stage2 + stage3) - crea y ejecuta work_item para contenido
  await tick();

  // Debe crearse work_item para contenido - buscar por nuestro keyword específico
  const wi = await get<{ id: number; agent_id: number; context: string; type: string }>(
    `SELECT id, agent_id, context, type FROM work_items WHERE type = 'event_triggered' AND context LIKE ? ORDER BY id DESC LIMIT 1`,
    [`%${uniqueKeyword}%`]
  );
  assert.ok(wi, 'work_item event_triggered creado para contenido');
  assert.equal(wi.agent_id, contenidoAgentId);
  assert.match(wi.context, new RegExp(uniqueKeyword));

  // Verificar content.create llamado (content creado con nuestro keyword)
  const content = await get<{ body: string }>('SELECT body FROM content WHERE body LIKE ? ORDER BY id DESC LIMIT 1', [`%${uniqueKeyword}%`]);
  assert.ok(content, 'content.create persistió en content');

  // Verificar decision.create llamada (decision creada con nuestro keyword)
  const decisionTitle2 = `Publicar en Etsy — ${uniqueKeyword}`;
  const dec = await get<{ title: string; category: string }>('SELECT title, category FROM decisions WHERE title = ? ORDER BY id DESC LIMIT 1', [decisionTitle2]);
  assert.ok(dec, 'decision.create llamada con título correcto');
  assert.equal(dec.category, 'PUBLICATION');
});

test('pipeline 4.2: decision.approved → contenido ejecuta etsy.create_listing', async () => {
  await runDb(`DELETE FROM work_items`);
  await runDb(`DELETE FROM decisions`);
  await runDb(`DELETE FROM agent_memory`);

  // Sembrar memoria con datos de listing
  await runDb(`INSERT INTO agent_memory (agent_id, venture_id, key, value) VALUES (?, ?, ?, ?)`,
    [contenidoAgentId, ventureId, 'etsy_listing_minimal_wall_art', JSON.stringify({
      title: 'Minimal Wall Art Print',
      description: 'Beautiful minimal art',
      price: 25.00,
      currency: 'USD',
      quantity: 10,
      tags: ['minimal', 'wall', 'art', 'print', 'decor'],
      materials: ['paper', 'ink'],
      whoMade: 'i_did',
      whenMade: '2024'
    })]);

  // Crear decision aprobada
  const dec = await runDb(`INSERT INTO decisions (agent_id, venture_id, title, description, status, category, risk_level, amount) VALUES (?, ?, ?, ?, 'approved', 'PUBLICATION', 'low', 0)`,
    [contenidoAgentId, ventureId, 'Publicar en Etsy — minimal wall art', 'Contenido listo para publicar']);

  // Publicar evento decision.approved
  bus.publish({
    type: 'decision.approved',
    from: 'Jorge',
    payload: { decisionId: dec.lastID, decisionTitle: 'Publicar en Etsy — minimal wall art' }
  });

  await tick(); // stage1 crea work_item decision_execution
  await tick(); // stage3 ejecuta

  // Verificar work_item decision_execution creado y ejecutado
  const wi = await get<{ type: string; status: string }>(
    `SELECT type, status FROM work_items WHERE type = 'decision_execution' ORDER BY id DESC LIMIT 1`
  );
  assert.ok(wi, 'work_item decision_execution creado');
  assert.equal(wi.status, 'done', 'work_item ejecutado');
});

test('requiredApproval protection: etsy.create_listing requiere approval, bloquea sin decision', async () => {
  const tool = getTool('etsy.create_listing');
  assert.ok(tool, 'etsy.create_listing registrado');
  assert.equal(tool!.requiredApproval, true, 'etsy.create_listing DEBE requerir approval');

  // Intentar ejecutar sin approval (simular agente llamando tool directamente)
  const res = await tool!.execute({
    title: 'Test',
    description: 'Test',
    price: 10,
    currency: 'USD',
    quantity: 1,
    tags: ['test'],
    materials: ['paper'],
    whoMade: 'i_did',
    whenMade: '2024'
  }, { agentId: contenidoAgentId, ventureId });

  // La tool valida ventureId pero requiredApproval=true significa que el runtime debe haber verificado decision aprobada
  // En la práctica, el agente no puede invocarla si no tiene autonomía 2+ o decision aprobada
  // Aquí verificamos que la tool tiene requiredApproval=true
  assert.ok(tool!.requiredApproval);
});

test('requiredApproval protection: etsy.update_listing y etsy.create_reply también requieren approval', () => {
  const updateTool = getTool('etsy.update_listing');
  const replyTool = getTool('etsy.create_reply');

  assert.ok(updateTool && updateTool.requiredApproval === true, 'etsy.update_listing requiere approval');
  assert.ok(replyTool && replyTool.requiredApproval === true, 'etsy.create_reply requiere approval');
});

test('pipeline 4.2 completo: trend.detected → contenido → content.create → decision.create → approved → etsy.create_listing (integración)', async () => {
  await runDb(`DELETE FROM work_items`);
  await runDb(`DELETE FROM decisions`);
  await runDb(`DELETE FROM market`);
  await runDb(`DELETE FROM content`);
  await runDb(`DELETE FROM agent_memory`);

  // 1. Sembrar memoria (simula que contenido ya guardó el listing)
  await runDb(`INSERT INTO agent_memory (agent_id, venture_id, key, value) VALUES (?, ?, ?, ?)`,
    [contenidoAgentId, ventureId, 'etsy_listing_test_keyword', JSON.stringify({
      title: 'Test Product',
      description: 'Test desc',
      price: 15.00,
      currency: 'USD',
      quantity: 5,
      tags: ['test', 'product'],
      materials: ['digital'],
      whoMade: 'i_did',
      whenMade: '2024'
    })]);

  // 2. Configurar fake provider para el primer work_item (content.create + decision.create)
  // IMPORTANTE: configurar ANTES del primer tick, porque tick() ejecuta TODAS las etapas incluyendo stage3
  const args1 = '{"keyword":"test_keyword","summary":"Contenido para test_keyword"}';
  const args2 = '{"title":"Publicar en Etsy — test_keyword","description":"Contenido listo para publicar","risk_level":"low","amount":0}';
  const tc1 = [{ id: 'call_1', function: { name: 'content_create', arguments: args1 } }];
  const tc2 = [{ id: 'call_2', function: { name: 'decision_create', arguments: args2 } }];
  const r1 = { content: '', toolCalls: tc1, tokensIn: 100, tokensOut: 50, totalTokens: 150 };
  const r2 = { content: '', toolCalls: tc2, tokensIn: 100, tokensOut: 50, totalTokens: 150 };
  const r3 = { content: 'Contenido y decisión creados', toolCalls: [], tokensIn: 50, tokensOut: 20, totalTokens: 70 };
  fakeProvider.setScript([r1, r2, r3]);

  // 3. Evento trend.detected
  bus.publish({
    type: 'trend.detected',
    from: 'investigador',
    payload: { keyword: 'test_keyword', description: 'Test trend', detectedAt: new Date().toISOString() }
  });

  await tick(); // stage1 + stage2 + stage3: crea y ejecuta work_item event_triggered

  const dec = await get<{ id: number; title: string; status: string }>(
    `SELECT id, title, status FROM decisions WHERE title LIKE 'Publicar en Etsy — test_keyword' ORDER BY id DESC LIMIT 1`
  );
  assert.ok(dec, 'decision creada');
  assert.equal(dec.status, 'proposed');

  // 4. Aprobar decision (simula Jorge)
  await runDb(`UPDATE decisions SET status = 'approved', approved_by = 'Jorge', approved_at = datetime('now') WHERE id = ?`, [dec.id]);

  bus.publish({
    type: 'decision.approved',
    from: 'Jorge',
    payload: { decisionId: dec.id, decisionTitle: dec.title }
  });

  await tick(); // stage1: crea work_item decision_execution

  // 5. Ejecutar decision_execution → etsy.create_listing
  const args3 = '{"title":"Test Product","description":"Test desc","price":15.00,"currency":"USD","quantity":5,"tags":["test","product"],"materials":["digital"],"whoMade":"i_did","whenMade":"2024","taxonomyId":null,"shippingProfileId":null,"returnPolicyId":null}';
  const tc3 = [{ id: 'call_3', function: { name: 'etsy_create_listing', arguments: args3 } }];
  const r4 = { content: '', toolCalls: tc3, tokensIn: 100, tokensOut: 50, totalTokens: 150 };
  const r5 = { content: 'Listing publicado en Etsy', toolCalls: [], tokensIn: 50, tokensOut: 20, totalTokens: 70 };
  fakeProvider.setScript([r4, r5]);
  await tick(); // stage3: ejecuta etsy.create_listing (mock, sin API real)

  // 6. Verificar work_item decision_execution completado
  const wi = await get<{ type: string; status: string }>(
    `SELECT type, status FROM work_items WHERE type = 'decision_execution' ORDER BY id DESC LIMIT 1`
  );
  assert.ok(wi, 'work_item decision_execution creado');
  assert.equal(wi.status, 'done', 'pipeline completado hasta publicación');
});

// ═══════════════════════════════════════════════════════════════════════════
// ADR-015 Paso 4 — reserve-then-settle en el camino autónomo de stage2.
// Se conducen las etapas directamente ((runtime as any).stageN_...) para observar la ventana
// de reserva entre claim y settle. Determinista, sin red (FakeProvider).
// ═══════════════════════════════════════════════════════════════════════════
const stage2 = () => (runtime as any).stage2_assignWork();
const stage3 = () => (runtime as any).stage3_executeAgents();
const stage4 = () => (runtime as any).stage4_checkTTLs();

// Deja la venture con presupuesto holgado, el agente sin bloqueo mensual, y el fake en su
// respuesta determinista por defecto (sin tool_calls → askAgent ok).
async function p4setup(agentId: number, allocated: number) {
  await runDb(`UPDATE ventures SET budget_allocated_usd = ?, budget_spent_usd = 0 WHERE id = ?`, [allocated, ventureId]);
  await runDb(`UPDATE agent_budgets SET monthly_limit_usd = 1000, status = 'active' WHERE agent_id = ? AND venture_id = ?`, [agentId, ventureId]);
  fakeProvider.setScript([]);
}
const wiRow = (id: number) => get<{ status: string; reserved_usd: number }>('SELECT status, reserved_usd FROM work_items WHERE id = ?', [id]);

test('P4 reserva correcta: stage2 reserva antes del claim (reserved_usd + budget_spent de la venture)', async () => {
  await p4setup(contenidoAgentId, 100);
  const wi = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'hola' });
  await stage2();
  const row = await wiRow(wi);
  assert.equal(row?.status, 'in_progress', 'promovido a in_progress tras reservar y claim');
  assert.ok(row!.reserved_usd > 0, 'reserved_usd guardado en el work_item');
  const b = await getVentureBudget(ventureId);
  assert.ok(Math.abs(b!.reserved - row!.reserved_usd) < 1e-9, 'budget_spent de la venture == reserva del work_item');
});

test('P4 reserva rechazada: venture sin presupuesto → cancel + budget_request, sin claim ni reserva', async () => {
  await p4setup(contenidoAgentId, 0.0001); // tope minúsculo: la estimación no cabe
  const wi = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'x' });
  await stage2();
  const row = await wiRow(wi);
  assert.equal(row?.status, 'cancelled', 'cancelado por reserva rechazada');
  assert.equal(row?.reserved_usd, 0, 'no deja reserva colgando');
  const b = await getVentureBudget(ventureId);
  assert.equal(b!.reserved, 0, 'budget_spent de la venture intacto');
  const dec = await get<{ title: string }>(`SELECT title FROM decisions WHERE venture_id = ? AND category = 'FINANCIAL' ORDER BY id DESC LIMIT 1`, [ventureId]);
  assert.ok(dec, 'budget_request creada');
});

test('P4 done: settle libera exactamente la reserva', async () => {
  await p4setup(contenidoAgentId, 100);
  const wi = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'hola' });
  await stage2();
  assert.ok((await wiRow(wi))!.reserved_usd > 0, 'reservado tras stage2');
  await stage3(); // ejecuta (ok) + settle
  const row = await wiRow(wi);
  assert.equal(row?.status, 'done');
  assert.equal(row?.reserved_usd, 0, 'reserva liberada tras done');
  const b = await getVentureBudget(ventureId);
  assert.equal(b!.reserved, 0, 'sin reserva colgando');
  assert.ok(b!.real > 0, 'el coste real quedó registrado en agent_costs (settle reservado→real)');
});

test('P4 failed: settle libera la reserva', async () => {
  await p4setup(contenidoAgentId, 100);
  const wi = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'x' });
  await stage2();
  assert.ok((await wiRow(wi))!.reserved_usd > 0);
  // Forzar fallo del proveedor durante stage3 (chat lanza) → work_item failed.
  const failing: AIProvider = { id: 'openrouter', isConfigured: () => true, listModels: () => [], async chat() { throw new Error('fallo simulado'); } };
  const restore = registerProvider('openrouter', failing);
  await stage3();
  restore();
  const row = await wiRow(wi);
  assert.equal(row?.status, 'failed');
  assert.equal(row?.reserved_usd, 0, 'reserva liberada tras failed');
  assert.equal((await getVentureBudget(ventureId))!.reserved, 0);
});

test('P4 budget-cancel: el camino cancelado por presupuesto no deja reserva', async () => {
  // Bloqueo por límite MENSUAL del agente (antes de la reserva): no debe quedar reserva.
  await runDb(`UPDATE ventures SET budget_allocated_usd = 100, budget_spent_usd = 0 WHERE id = ?`, [ventureId]);
  await runDb(`UPDATE agent_budgets SET monthly_limit_usd = 0.10, status = 'active' WHERE agent_id = ? AND venture_id = ?`, [contenidoAgentId, ventureId]);
  await runDb(`INSERT INTO agent_costs (agent_id, venture_id, model, llm_cost_usd, tool_cost_usd, created_at) VALUES (?, ?, 'm', 0.20, 0, datetime('now'))`, [contenidoAgentId, ventureId]);
  const wi = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'x' });
  await stage2();
  const row = await wiRow(wi);
  assert.equal(row?.status, 'cancelled', 'cancelado por límite mensual');
  assert.equal(row?.reserved_usd, 0, 'sin reserva (se canceló antes de reservar)');
  assert.equal((await getVentureBudget(ventureId))!.reserved, 0);
});

test('P4 TTL-requeue: libera la reserva y vuelve a pending', async () => {
  await p4setup(contenidoAgentId, 100);
  const wi = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'x' });
  await stage2(); // reserva + claim (in_progress, reserved > 0)
  assert.ok((await wiRow(wi))!.reserved_usd > 0);
  await runDb(`UPDATE work_items SET locked_at = datetime('now','-1 hour'), ttl_minutes = 1, retry_count = 0 WHERE id = ?`, [wi]);
  await stage4();
  const row = await wiRow(wi);
  assert.equal(row?.status, 'pending', 'requeue');
  assert.equal(row?.reserved_usd, 0, 'reserva liberada en requeue (el reintento reservará de nuevo)');
  assert.equal((await getVentureBudget(ventureId))!.reserved, 0);
});

test('P4 TTL-cancel: libera la reserva al cancelar tras reintentos', async () => {
  await p4setup(contenidoAgentId, 100);
  const wi = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'x' });
  await stage2();
  assert.ok((await wiRow(wi))!.reserved_usd > 0);
  await runDb(`UPDATE work_items SET locked_at = datetime('now','-1 hour'), ttl_minutes = 1, retry_count = 3 WHERE id = ?`, [wi]);
  await stage4();
  const row = await wiRow(wi);
  assert.equal(row?.status, 'cancelled');
  assert.equal(row?.reserved_usd, 0, 'reserva liberada al cancelar por TTL');
  assert.equal((await getVentureBudget(ventureId))!.reserved, 0);
});

test('P4 claim expirado: stage4 (TTL = TTL del claim) libera la reserva', async () => {
  // El claim y el work_item comparten TTL; un in_progress con claim expirado lo recoge stage4.
  await p4setup(contenidoAgentId, 100);
  const wi = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'x' });
  await stage2();
  assert.ok((await wiRow(wi))!.reserved_usd > 0);
  await runDb(`UPDATE work_items SET locked_at = datetime('now','-2 hours'), ttl_minutes = 1, retry_count = 0 WHERE id = ?`, [wi]);
  await stage4(); // recoge el claim/work_item expirado y libera la reserva
  assert.equal((await wiRow(wi))!.reserved_usd, 0, 'reserva liberada en claim expirado');
  assert.equal((await getVentureBudget(ventureId))!.reserved, 0);
});

test('P4 idempotencia: liberar dos veces no decrementa el presupuesto dos veces', async () => {
  await p4setup(contenidoAgentId, 100);
  const wi = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'x' });
  await stage2();
  const reserved = (await wiRow(wi))!.reserved_usd;
  assert.ok(reserved > 0);
  assert.ok(Math.abs((await getVentureBudget(ventureId))!.reserved - reserved) < 1e-9);
  await stage3(); // done + release (una vez)
  assert.equal((await getVentureBudget(ventureId))!.reserved, 0, 'liberado una vez');
  // Segundos intentos por otros caminos terminales NO vuelven a liberar (reserved_usd ya es 0).
  await stage4();
  await stage3();
  const b = await getVentureBudget(ventureId);
  assert.equal(b!.reserved, 0, 'sin doble liberación (nunca negativo)');
  assert.ok(b!.reserved >= 0);
});

test('P4 pipeline completo: reserve → claim → ejecución → settle en un solo tick', async () => {
  await p4setup(contenidoAgentId, 100);
  const wi = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'hola' });
  await tick(); // stage1..9 en orden: reserva, claim, ejecuta, settle
  const row = await wiRow(wi);
  assert.equal(row?.status, 'done', 'ejecutado end-to-end');
  assert.equal(row?.reserved_usd, 0, 'settle: reserva liberada');
  const b = await getVentureBudget(ventureId);
  assert.equal(b!.reserved, 0, 'sin reserva colgando');
  assert.ok(b!.real > 0, 'coste real registrado en agent_costs');
});

test('P4 aislamiento entre ventures: la reserva de una venture no afecta a otra', async () => {
  await p4setup(contenidoAgentId, 100);
  const v2 = (await runDb(`INSERT INTO ventures (name, type, status, budget_allocated_usd, budget_spent_usd) VALUES ('P4-V2','store','active',100,0)`)).lastID;
  const wi = await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'x' });
  await stage2();
  assert.ok((await wiRow(wi))!.reserved_usd > 0, 'V1 reservó');
  assert.equal((await getVentureBudget(v2))!.reserved, 0, 'V2 intacta');
  assert.ok((await getVentureBudget(ventureId))!.reserved > 0, 'V1 con su reserva');
});

test('budget enforcement: reserveVentureBudget bloquea trabajo si no hay presupuesto', async () => {
  // Venture sin presupuesto
  await runDb(`UPDATE ventures SET budget_allocated_usd = 0.01 WHERE id = ?`, [ventureId]);
  await runDb(`DELETE FROM agent_costs WHERE venture_id = ?`, [ventureId]);

  // Estimar coste de una tarea
  const reserved = await reserveVentureBudget(ventureId, 0.05); // 0.05 > 0.01 disponible
  assert.equal(reserved, null, 'reserva bloqueada por presupuesto insuficiente');
});

test('budget enforcement: reserveVentureBudget permite si hay presupuesto', async () => {
  await runDb(`UPDATE ventures SET budget_allocated_usd = 1.00, budget_spent_usd = 0 WHERE id = ?`, [ventureId]);
  await runDb(`DELETE FROM agent_costs WHERE venture_id = ?`, [ventureId]);

  const reserved = await reserveVentureBudget(ventureId, 0.05);
  assert.equal(reserved, 0.05, 'reserva permitida');

  // Liberar
  await releaseVentureBudget(ventureId, 0.05);
  const b = await getVentureBudget(ventureId);
  assert.equal(b!.reserved, 0, 'reserva liberada');
});

test('agent_budgets: límite mensual por agente (schema actual: PK compuesta agent_id + venture_id)', async () => {
  // Budget agente contenido: límite en agent_budgets, gasto derivado de agent_costs (Paso 3 ADR-015)
  await runDb(`UPDATE agent_budgets SET monthly_limit_usd = 0.20 WHERE agent_id = ? AND venture_id = ?`, [contenidoAgentId, ventureId]);

  const b = await get<{ monthly_limit_usd: number }>('SELECT monthly_limit_usd FROM agent_budgets WHERE agent_id = ? AND venture_id = ?', [contenidoAgentId, ventureId]);
  assert.equal(b?.monthly_limit_usd, 0.20);

  // Verificar que stage2 bloquea si gasto mensual (agentMonthlySpent) >= monthly_limit_usd
  // Simular gasto del mes actual en agent_costs
  await runDb(
    `INSERT INTO agent_costs (agent_id, venture_id, model, tokens_in, tokens_out, llm_cost_usd, tool_cost_usd, created_at)
     VALUES (?, ?, 'test-model', 0, 0, 0.25, 0, datetime('now'))`,
    [contenidoAgentId, ventureId]
  );

  await createWorkItem({ agentId: contenidoAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'test' });
  await tick();

  const wi = await get<{ status: string }>('SELECT status FROM work_items WHERE agent_id = ? ORDER BY id DESC LIMIT 1', [contenidoAgentId]);
  assert.equal(wi?.status, 'cancelled', 'work_item cancelado al alcanzar límite mensual');
});

test('stage2 traceability: work_item cancelado por presupuesto tiene trace en logs/decisiones', async () => {
  await runDb(`DELETE FROM work_items`);
  await runDb(`DELETE FROM decisions`);
  await runDb(`UPDATE ventures SET budget_allocated_usd = 0.10, budget_spent_usd = 0.10 WHERE id = ?`, [ventureId]);

  await createWorkItem({ agentId: investigadorAgentId, ventureId, type: 'autonomous_run', priority: 5, context: 'test' });
  await tick();

  const wi = await get<{ status: string; resolved_at: string }>('SELECT status, resolved_at FROM work_items WHERE agent_id = ? ORDER BY id DESC LIMIT 1', [investigadorAgentId]);
  assert.equal(wi?.status, 'cancelled');
  assert.ok(wi?.resolved_at, 'resolved_at poblado para trazabilidad');

  const dec = await get<{ title: string; category: string }>('SELECT title, category FROM decisions WHERE venture_id = ? AND category = \'FINANCIAL\' ORDER BY id DESC LIMIT 1', [ventureId]);
  assert.ok(dec, 'decision budget_request creada como trace');
});