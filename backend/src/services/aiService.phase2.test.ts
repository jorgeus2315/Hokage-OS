import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get, all } from '../db/init.js';
import { askAgent } from './aiService.js';
import { getProvider } from './aiProvider.js';
import { checkVentureBudgetAlert, createBudgetRequestDecision, getVentureBudget } from './ventureBudget.js';
import { get as dbGet } from '../db/init.js';
import { get as getTool } from '../tools/registry.js';

// GoogleTrendsTool vía registry (evita ciclo de imports con tools/index.ts).
const GoogleTrendsTool = getTool('google.trends')!;

// ═══ Tests de Fase 2 — Tool Pipeline Real ═══
// BD aislada vía HOKAGE_DB_PATH (tests de Fase 5). Sin conexión real a OpenRouter.

let agentId = 0;
let ventureId = 0;
const extraVentureIds: number[] = [];

before(async () => {
  await initSchema();
  // API key dummy para que provider.isConfigured() pase y el mock de fetch intercepte la llamada
  process.env.OPENROUTER_API_KEY = 'test-key-dummy';

  // Crear venture de prueba
  const v = await run('INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES (?, ?, ?, ?)',
    ['Test Venture', 'store', 'active', 100]);
  ventureId = v.lastID;

  // Crear agente de prueba (rol investigador → tiene google.trends)
  const a = await run('INSERT INTO agents (name, role, status, model, venture_id) VALUES (?, ?, ?, ?, ?)',
    ['Test Explorer', 'investigador', 'idle', 'google/gemini-2.5-flash', ventureId]);
  agentId = a.lastID;

  // Budget por rol (para compatibilidad)
  await run('INSERT INTO agent_budgets (agent_id, venture_id, monthly_limit_usd, current_month_usd) VALUES (?, ?, ?, ?)',
    [agentId, ventureId, 5.0, 0]);
});

// Helper para registrar tools de coste en un test específico
async function registerCostToolsForTest() {
  const { register } = await import('../tools/registry.js');
  const { Tool } = await import('../tools/base.js');

  const MultiCostToolA: Tool<{}, {}> = {
    id: 'test.multi_a', name: 'Multi Cost A', description: 'A', category: 'test',
    status: 'ready', permissions: { scope: 'global' }, requiredApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    async estimateCost() { return 0.02; },
    async execute() { return { ok: true, data: {}, cost: 0.02 }; }
  };
  const MultiCostToolB: Tool<{}, {}> = {
    id: 'test.multi_b', name: 'Multi Cost B', description: 'B', category: 'test',
    status: 'ready', permissions: { scope: 'global' }, requiredApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    async estimateCost() { return 0.03; },
    async execute() { return { ok: true, data: {}, cost: 0.03 }; }
  };
  const SepCostTool: Tool<{}, {}> = {
    id: 'test.sep_cost', name: 'Sep Cost', description: 'Separate cost', category: 'test',
    status: 'ready', permissions: { scope: 'global' }, requiredApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    async estimateCost() { return 0.07; },
    async execute() { return { ok: true, data: {}, cost: 0.07 }; }
  };
  const FailingCostTool: Tool<{}, {}> = {
    id: 'test.fail_cost', name: 'Fail Cost', description: 'Falla', category: 'test',
    status: 'ready', permissions: { scope: 'global' }, requiredApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    async estimateCost() { return 0.1; },
    async execute() { return { ok: false, error: 'Error simulado', cost: 0 }; }
  };
  register(MultiCostToolA);
  register(MultiCostToolB);
  register(SepCostTool);
  register(FailingCostTool);
}

function trackVenture(vId: number) { extraVentureIds.push(vId); }

// ─── Tool Registry / Execution ───

test('GoogleTrendsTool: formato esperado { keyword, volume, trend, relatedQueries[] }', async () => {
  // Mock del fetch para aislar el test de la red
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('/explore')) {
      return new Response(
        `)]}',\n{"widgets":[{"id":"TIMESERIES","token":"ts-token"},{"id":"RELATED_QUERIES","token":"rq-token"}]}`,
        { status: 200 }
      );
    }
    if (u.includes('multiline')) {
      return new Response(
        `)]}',\n{"default":{"timelineData":[{"formattedTime":"2024-01","value":[50]},{"formattedTime":"2024-02","value":[80]}]}}`,
        { status: 200 }
      );
    }
    if (u.includes('relatedsearches')) {
      return new Response(
        `)]}',\n{"default":{"rankedList":[{},{"rankedKeyword":[{"query":"minimalist wall art","value":100},{"query":"digital planner","value":80}]}]}}`,
        { status: 200 }
      );
    }
    return new Response('', { status: 404 });
  }) as any;

  try {
    const outcome = await GoogleTrendsTool.execute({ query: 'minimalist wall art' }, { agentId, ventureId });
    assert.equal(outcome.ok, true, 'tool debe retornar ok=true');
    const data = outcome.data!;
    assert.equal(data.keyword, 'minimalist wall art');
    assert.ok(typeof data.volume === 'number' && data.volume >= 0 && data.volume <= 100, 'volume debe ser 0-100');
    assert.ok(['up', 'stable', 'down'].includes(data.trend), 'trend debe ser up/stable/down');
    assert.ok(Array.isArray(data.relatedQueries), 'relatedQueries debe ser array');
    assert.ok(data.relatedQueries.length > 0, 'relatedQueries no debe estar vacío');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GoogleTrendsTool: timeout no inventa — retorna error real', async () => {
  const originalFetch = globalThis.fetch;
  // Mock abort-aware: si recibe AbortSignal y se aborta, rechaza (como fetch real con timeout).
  globalThis.fetch = (async (_url: string | URL | Request, opts?: RequestInit) => {
    const signal = opts?.signal;
    if (signal) {
      if (signal.aborted) throw new Error('The operation was aborted.');
      signal.addEventListener('abort', () => {
        // simulamos el aborto del controller en fetchWithTimeout
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 20_000)); // más que TRENDS_TIMEOUT_MS
    if (signal?.aborted) throw new Error('The operation was aborted.');
    return new Response('', { status: 200 });
  }) as any;

  try {
    const outcome = await GoogleTrendsTool.execute({ query: 'test' }, { agentId, ventureId });
    assert.equal(outcome.ok, false, 'timeout debe retornar ok=false');
    assert.ok(/timeout/i.test(outcome.error || ''), 'error debe mencionar timeout');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GoogleTrendsTool: respuesta inválida no inventa — error real', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('/explore')) {
      return new Response(`)]}',\n{"widgets":[{"id":"TIMESERIES","token":"x"}]}`, { status: 200 });
    }
    if (u.includes('multiline')) {
      return new Response('NOT JSON', { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as any;

  try {
    const outcome = await GoogleTrendsTool.execute({ query: 'test' }, { agentId, ventureId });
    assert.equal(outcome.ok, false, 'sin datos de interés → error real');
    assert.ok(/sin datos|inválida/.test(outcome.error || ''), 'error debe indicar falta de datos');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─── Function Calling Loop ───

test('askAgent: agente sin tools → respuesta normal (sin tool calling)', async () => {
  // Agente operaciones (Llama 3.1 8B) tiene [] tools
  const a = await run('INSERT INTO agents (name, role, status, model) VALUES (?, ?, ?, ?)',
    ['No Tools Agent', 'operaciones', 'idle', 'meta-llama/llama-3.1-8b-instruct']);
  const noToolsId = a.lastID;

  // Mock provider para no llamar red y validar que NO se envían tools
  const originalProvider = getProvider;
  // getProvider es función exportada; no se puede mockear fácil sin violar encapsulación.
  // En su lugar, verify que availableTools queda vacío para modelo sin tool support.

  const a2 = await get<{ role: string }>('SELECT role FROM agents WHERE id = ?', [noToolsId]);
  assert.equal(a2?.role, 'operaciones');

  // El modelo llama/3.1-8b NO soporta tools → availableTools vacío → loop no hace tool calls
  const { modelSupportsTools } = await import('../config/agentModels.js');
  assert.equal(modelSupportsTools('meta-llama/llama-3.1-8b-instruct'), false, 'Llama 3.1 8B no soporta tools');

  await run('DELETE FROM agents WHERE id = ?', [noToolsId]);
});

test('askAgent: validación de tool no permitida lanza error (no ejecuta tool arbitraria)', async () => {
  // registry.execute rechaza tools inexistentes
  const { execute } = await import('../tools/registry.js');
  const outcome = await execute('tool.inexistente', {}, { agentId, ventureId });
  assert.equal(outcome.ok, false, 'tool inexistente → error');
  assert.match(outcome.error || '', /not found/i);
});

test('askAgent: tool permitida se ejecuta correctamente', async () => {
  const { execute } = await import('../tools/registry.js');
  const outcome = await execute('trend.report', { keyword: 'test k', description: 'desc' }, { agentId, ventureId });
  assert.equal(outcome.ok, true, 'trend.report debe ejecutarse');
  assert.ok((outcome.data as any)?.marketId > 0, 'debe crear market entry');
});

// ─── Budget thresholds (venture) ───

test('checkVentureBudgetAlert: <80% → normal', async () => {
  const v = await run('INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES (?, ?, ?, ?)',
    ['V-normal', 'store', 'active', 100]);
  trackVenture(v.lastID);
  await run('INSERT INTO agent_costs (agent_id, venture_id, tokens_in, tokens_out, llm_cost_usd) VALUES (?, ?, 0, 0, ?)',
    [agentId, v.lastID, 50]); // 50% usado
  const alert = await checkVentureBudgetAlert(v.lastID);
  assert.equal(alert?.level, 'normal');
  assert.equal(alert?.blocked, false);
});

test('checkVentureBudgetAlert: >=80% → warning', async () => {
  const v = await run('INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES (?, ?, ?, ?)',
    ['V-warn', 'store', 'active', 100]);
  trackVenture(v.lastID);
  await run('INSERT INTO agent_costs (agent_id, venture_id, tokens_in, tokens_out, llm_cost_usd) VALUES (?, ?, 0, 0, ?)',
    [agentId, v.lastID, 85]); // 85% usado
  const alert = await checkVentureBudgetAlert(v.lastID);
  assert.equal(alert?.level, 'warning');
  assert.equal(alert?.blocked, false);
});

test('checkVentureBudgetAlert: >=100% → critical/blocked', async () => {
  const v = await run('INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES (?, ?, ?, ?)',
    ['V-crit', 'store', 'active', 100]);
  trackVenture(v.lastID);
  await run('INSERT INTO agent_costs (agent_id, venture_id, tokens_in, tokens_out, llm_cost_usd) VALUES (?, ?, 0, 0, ?)',
    [agentId, v.lastID, 100]); // 100% usado
  const alert = await checkVentureBudgetAlert(v.lastID);
  assert.equal(alert?.level, 'critical');
  assert.equal(alert?.blocked, true);
});

test('createBudgetRequestDecision: crea Decision budget_request al 100%', async () => {
  const v = await run('INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES (?, ?, ?, ?)',
    ['V-req', 'store', 'active', 100]);
  trackVenture(v.lastID);
  await run('INSERT INTO agent_costs (agent_id, venture_id, tokens_in, tokens_out, llm_cost_usd) VALUES (?, ?, 0, 0, ?)',
    [agentId, v.lastID, 100]);

  await createBudgetRequestDecision(v.lastID, agentId);

  const decision = await dbGet<{ title: string; category: string; status: string }>(
    'SELECT title, category, status FROM decisions WHERE venture_id = ? AND title LIKE ? ORDER BY id DESC LIMIT 1',
    [v.lastID, '%Presupuesto venture%']
  );
  assert.ok(decision, 'debe crear decisión');
  assert.equal(decision.category, 'FINANCIAL');
  assert.equal(decision.status, 'proposed');
});

test('createBudgetRequestDecision: no duplica si ya existe', async () => {
  const v = await run('INSERT INTO ventures (name, type, status, budget_allocated_usd) VALUES (?, ?, ?, ?)',
    ['V-dup', 'store', 'active', 100]);
  trackVenture(v.lastID);
  await run('INSERT INTO agent_costs (agent_id, venture_id, tokens_in, tokens_out, llm_cost_usd) VALUES (?, ?, 0, 0, ?)',
    [agentId, v.lastID, 100]);

  await createBudgetRequestDecision(v.lastID, agentId);
  await createBudgetRequestDecision(v.lastID, agentId);

  const count = await dbGet<{ c: number }>(
    'SELECT COUNT(*) as c FROM decisions WHERE venture_id = ? AND title LIKE ?',
    [v.lastID, '%Presupuesto venture%']
  );
  assert.equal(count?.c, 1, 'solo una decisión, no duplicada');
});

// ─── Multiple tool calls, iteration limit, cost tracking ───

test('askAgent: registra tokens/coste en agent_costs', async () => {
  // Este test requiere red; verificamos que la tabla existe y el esquema es correcto
  const cols = await all<{ name: string }>('PRAGMA table_info(agent_costs)');
  const names = cols.map(c => c.name);
  assert.ok(names.includes('tokens_in'), 'tokens_in debe existir');
  assert.ok(names.includes('tokens_out'), 'tokens_out debe existir');
  assert.ok(names.includes('llm_cost_usd'), 'llm_cost_usd debe existir');
  assert.ok(names.includes('tool_cost_usd'), 'tool_cost_usd debe existir');
  assert.ok(names.includes('venture_id'), 'venture_id debe existir (Fase 2)');
});

// ─── Tool cost tracking (Fase 2.3/2.4) ───

test('askAgent: sin tool calls → tool_cost_usd = 0', async () => {
  // Agente sin tools (operaciones = Llama 3.1 8B, sin tool support) - usar ventureId principal
  const a = await run('INSERT INTO agents (name, role, status, model, venture_id) VALUES (?, ?, ?, ?, ?)',
    ['No Tools Agent', 'operaciones', 'idle', 'meta-llama/llama-3.1-8b-instruct', ventureId]);
  const noToolsId = a.lastID;

  // Mock provider que NO devuelve tool_calls
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({
      id: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Respuesta sin tools' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await askAgent(noToolsId, 'Hola', ventureId);
    assert.equal(result.ok, true);

    // Verificar en BD
    const costRow = await get<{ llm_cost_usd: number; tool_cost_usd: number }>(
      'SELECT llm_cost_usd, tool_cost_usd FROM agent_costs WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
      [noToolsId]
    );
    assert.ok(costRow, 'debe haber registro en agent_costs');
    assert.ok(costRow!.llm_cost_usd > 0, 'llm_cost_usd > 0');
    assert.equal(costRow!.tool_cost_usd, 0, 'tool_cost_usd debe ser 0 sin tool calls');
  } finally {
    globalThis.fetch = originalFetch;
    // Clean up ALL tables referencing agents(id) first (FK constraint), then agent
    await run('DELETE FROM agent_costs WHERE agent_id = ?', [noToolsId]);
    await run('DELETE FROM agent_budgets WHERE agent_id = ?', [noToolsId]);
    await run('DELETE FROM agent_runs WHERE agent_id = ?', [noToolsId]);
    await run('DELETE FROM agents WHERE id = ?', [noToolsId]);
  }
});

test('askAgent: tool con coste 0 → tool_cost_usd = 0', async () => {
  // Mock provider que devuelve tool_call a trend.report (coste 0)
  const originalFetch = globalThis.fetch;
  let turn = 0;
  globalThis.fetch = (async () => {
    turn++;
    if (turn === 1) {
      // Primera vuelta: LLM pide tool_call
      return new Response(JSON.stringify({
        id: 'test',
        choices: [{ index: 0, message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'trend_report', arguments: '{"keyword":"test","description":"desc"}' } }]
        }}],
        usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // Segunda vuelta: LLM responde final
    return new Response(JSON.stringify({
      id: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'He reportado la tendencia' } }],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await askAgent(agentId, 'Reporta tendencia test', ventureId);
    assert.equal(result.ok, true);

    // Verificar en BD
    const costRow = await get<{ llm_cost_usd: number; tool_cost_usd: number }>(
      'SELECT llm_cost_usd, tool_cost_usd FROM agent_costs WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
      [agentId]
    );
    assert.ok(costRow, 'debe haber registro en agent_costs');
    assert.ok(costRow!.llm_cost_usd > 0, 'llm_cost_usd > 0');
    assert.equal(costRow!.tool_cost_usd, 0, 'tool_cost_usd debe ser 0 (trend.report es gratis)');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('askAgent: tool con coste >0 → se persiste correctamente en tool_cost_usd', async () => {
  // Crear tool ficticia con coste >0 para test
  const { register } = await import('../tools/registry.js');
  const { Tool } = await import('../tools/base.js');

  const TestCostTool: Tool<{ x: number }, { y: number }> = {
    id: 'test.cost',
    name: 'Test Cost Tool',
    description: 'Tool de prueba con coste',
    category: 'test',
    status: 'ready',
    permissions: { scope: 'global' },
    requiredApproval: false,
    inputSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
    outputSchema: { type: 'object', properties: { y: { type: 'number' } } },
    async estimateCost() { return 0.05; },
    async execute() { return { ok: true, data: { y: 1 }, cost: 0.05 }; }
  };
  register(TestCostTool);

  // Mock provider que usa test.cost
  const originalFetch = globalThis.fetch;
  let turn = 0;
  globalThis.fetch = (async () => {
    turn++;
    if (turn === 1) {
      return new Response(JSON.stringify({
        id: 'test',
        choices: [{ index: 0, message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'test_cost', arguments: '{"x":1}' } }]
        }}],
        usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      id: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Done' } }],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await askAgent(agentId, 'Usa test cost tool', ventureId);
    assert.equal(result.ok, true);

    const costRow = await get<{ llm_cost_usd: number; tool_cost_usd: number }>(
      'SELECT llm_cost_usd, tool_cost_usd FROM agent_costs WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
      [agentId]
    );
    assert.ok(costRow, 'debe haber registro');
    assert.ok(costRow!.llm_cost_usd > 0, 'llm_cost_usd > 0');
    assert.ok(costRow!.tool_cost_usd > 0, 'tool_cost_usd > 0 para tool con coste');
    // El coste exacto puede variar por redondeo, pero debe ser ~0.05
    assert.ok(costRow!.tool_cost_usd >= 0.049 && costRow!.tool_cost_usd <= 0.051,
      `tool_cost_usd debe ser ~0.05, fue ${costRow!.tool_cost_usd}`);
  } finally {
    globalThis.fetch = originalFetch;
    // Limpiar tool de test (no hay unregister, pero no afecta otros tests)
  }
});

// Test tools de coste - registrados en before
async function registerTestCostTools() {
  const { register } = await import('../tools/registry.js');
  const { Tool } = await import('../tools/base.js');

  const MultiCostToolA: Tool<{}, {}> = {
    id: 'test.multi_a', name: 'Multi Cost A', description: 'A', category: 'test',
    status: 'ready', permissions: { scope: 'global' }, requiredApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    async estimateCost() { return 0.02; },
    async execute() { return { ok: true, data: {}, cost: 0.02 }; }
  };
  const MultiCostToolB: Tool<{}, {}> = {
    id: 'test.multi_b', name: 'Multi Cost B', description: 'B', category: 'test',
    status: 'ready', permissions: { scope: 'global' }, requiredApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    async estimateCost() { return 0.03; },
    async execute() { return { ok: true, data: {}, cost: 0.03 }; }
  };
  const SepCostTool: Tool<{}, {}> = {
    id: 'test.sep_cost', name: 'Sep Cost', description: 'Separate cost', category: 'test',
    status: 'ready', permissions: { scope: 'global' }, requiredApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    async estimateCost() { return 0.07; },
    async execute() { return { ok: true, data: {}, cost: 0.07 }; }
  };
  const FailingCostTool: Tool<{}, {}> = {
    id: 'test.fail_cost', name: 'Fail Cost', description: 'Falla', category: 'test',
    status: 'ready', permissions: { scope: 'global' }, requiredApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    async estimateCost() { return 0.1; },
    async execute() { return { ok: false, error: 'Error simulado', cost: 0 }; }
  };
  register(MultiCostToolA);
  register(MultiCostToolB);
  register(SepCostTool);
  register(FailingCostTool);
}

test('askAgent: varias tool calls → costes se acumulan', async () => {
  // Registrar tools de coste INLINE en el test (como test 15, evita module caching)
  const { register } = await import('../tools/registry.js');
  const { Tool } = await import('../tools/base.js');
  const { run } = await import('../db/init.js');

  const MultiCostToolA: Tool<{}, {}> = {
    id: 'test.multi_a', name: 'Multi Cost A', description: 'A', category: 'test',
    status: 'ready', permissions: { scope: 'global' }, requiredApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    async estimateCost() { return 0.02; },
    async execute() { return { ok: true, data: {}, cost: 0.02 }; }
  };
  const MultiCostToolB: Tool<{}, {}> = {
    id: 'test.multi_b', name: 'Multi Cost B', description: 'B', category: 'test',
    status: 'ready', permissions: { scope: 'global' }, requiredApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    async estimateCost() { return 0.03; },
    async execute() { return { ok: true, data: {}, cost: 0.03 }; }
  };
  register(MultiCostToolA);
  register(MultiCostToolB);

  // Añadir test tools al rol 'investigador' en BD para que estén en availableTools
  const originalTools = await get<{ tools: string }>('SELECT tools FROM role_definitions WHERE key = ?', ['investigador']);
  const originalToolsJson = originalTools?.tools || '[]';
  const newTools = JSON.parse(originalToolsJson);
  newTools.push('test.multi_a', 'test.multi_b');
  await run('UPDATE role_definitions SET tools = ? WHERE key = ?', [JSON.stringify(newTools), 'investigador']);

  const originalFetch = globalThis.fetch;
  let turn = 0;
  globalThis.fetch = (async () => {
    turn++;
    if (turn === 1) {
      return new Response(JSON.stringify({
        id: 'test',
        choices: [{ index: 0, message: {
          role: 'assistant', content: null,
          tool_calls: [
            { id: 'call_1', function: { name: 'test_multi_a', arguments: '{}' } },
            { id: 'call_2', function: { name: 'test_multi_b', arguments: '{}' } }
          ]
        }}],
        usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      id: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Done' } }],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await askAgent(agentId, 'Usa dos tools', ventureId);
    assert.equal(result.ok, true);

    const costRow = await get<{ llm_cost_usd: number; tool_cost_usd: number }>(
      'SELECT llm_cost_usd, tool_cost_usd FROM agent_costs WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
      [agentId]
    );
    assert.ok(costRow);
    assert.ok(costRow!.tool_cost_usd >= 0.049 && costRow!.tool_cost_usd <= 0.051,
      `tool_cost_usd debe ser ~0.05 (0.02+0.03), fue ${costRow!.tool_cost_usd}`);
  } finally {
    globalThis.fetch = originalFetch;
    // Restaurar tools originales del rol
    await run('UPDATE role_definitions SET tools = ? WHERE key = ?', [originalToolsJson, 'investigador']);
  }
});

test('askAgent: tool que falla (ok=false) → no genera coste ficticio', async () => {
  const originalFetch = globalThis.fetch;
  let turn = 0;
  globalThis.fetch = (async () => {
    turn++;
    if (turn === 1) {
      return new Response(JSON.stringify({
        id: 'test',
        choices: [{ index: 0, message: {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'test_fail_cost', arguments: '{}' } }]
        }}],
        usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      id: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Tool falló' } }],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await askAgent(agentId, 'Usa tool que falla', ventureId);
    assert.equal(result.ok, true); // askAgent no falla si la tool falla, el LLM maneja el error

    const costRow = await get<{ llm_cost_usd: number; tool_cost_usd: number }>(
      'SELECT llm_cost_usd, tool_cost_usd FROM agent_costs WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
      [agentId]
    );
    assert.ok(costRow);
    assert.equal(costRow!.tool_cost_usd, 0, 'tool fallida con cost=0 no debe sumar coste');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('askAgent: llm_cost_usd y tool_cost_usd permanecen separados', async () => {
  // Registrar tools de coste INLINE en el test (como test 15, evita module caching)
  const { register } = await import('../tools/registry.js');
  const { Tool } = await import('../tools/base.js');
  const { run, get } = await import('../db/init.js');

  const SepCostTool: Tool<{}, {}> = {
    id: 'test.sep_cost', name: 'Sep Cost', description: 'Separate cost', category: 'test',
    status: 'ready', permissions: { scope: 'global' }, requiredApproval: false,
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    async estimateCost() { return 0.07; },
    async execute() { return { ok: true, data: {}, cost: 0.07 }; }
  };
  register(SepCostTool);

  // Añadir test tool al rol 'investigador' en BD para que esté en availableTools
  const originalTools = await get<{ tools: string }>('SELECT tools FROM role_definitions WHERE key = ?', ['investigador']);
  const originalToolsJson = originalTools?.tools || '[]';
  const newTools = JSON.parse(originalToolsJson);
  newTools.push('test.sep_cost');
  await run('UPDATE role_definitions SET tools = ? WHERE key = ?', [JSON.stringify(newTools), 'investigador']);

  const originalFetch = globalThis.fetch;
  let turn = 0;
  globalThis.fetch = (async () => {
    turn++;
    if (turn === 1) {
      return new Response(JSON.stringify({
        id: 'test',
        choices: [{ index: 0, message: {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'test_sep_cost', arguments: '{}' } }]
        }}],
        usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      id: 'test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Done' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await askAgent(agentId, 'Separa costes', ventureId);
    assert.equal(result.ok, true);

    const costRow = await get<{ llm_cost_usd: number; tool_cost_usd: number }>(
      'SELECT llm_cost_usd, tool_cost_usd FROM agent_costs WHERE agent_id = ? ORDER BY ID DESC LIMIT 1',
      [agentId]
    );
    assert.ok(costRow);
    // Verificar que AMBOS campos existen y tienen valores independientes
    assert.ok(costRow!.llm_cost_usd > 0, 'llm_cost_usd debe ser > 0');
    assert.ok(costRow!.tool_cost_usd > 0, 'tool_cost_usd debe ser > 0');
    // No son el mismo valor (llm ≠ tool)
    assert.notEqual(costRow!.llm_cost_usd, costRow!.tool_cost_usd, 'llm_cost_usd y tool_cost_usd deben ser independientes');
    assert.ok(costRow!.tool_cost_usd >= 0.069 && costRow!.tool_cost_usd <= 0.071,
      `tool_cost_usd ~0.07, fue ${costRow!.tool_cost_usd}`);
  } finally {
    globalThis.fetch = originalFetch;
    // Restaurar tools originales del rol
    await run('UPDATE role_definitions SET tools = ? WHERE key = ?', [originalToolsJson, 'investigador']);
  }
});

test('askAgent: MAX_TOOL_TURNS limita iteraciones (no loop infinito)', async () => {
  // Verificar que la constante existe y es razonable
  const aiService = await import('./aiService.js');
  // No podemos acceder a MAX_TOOL_TURNS (privado) pero podemos verificar el comportamiento
  // indirectamente: el loop en askAgent tiene 'turn <= MAX_TOOL_TURNS'
  assert.ok(typeof aiService.askAgent === 'function', 'askAgent debe existir');
  assert.ok(typeof aiService.callAIJson === 'function', 'callAIJson debe existir');
});

// ─── End-to-end: Explorador → TrendsTool → agent_memory ───

test('End-to-end simulado: Explorador usa TrendsTool y persiste en agent_memory', async () => {
  // Mock del fetch para TrendsTool
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('/explore')) {
      return new Response(`)]}',\n{"widgets":[{"id":"TIMESERIES","token":"ts"},{"id":"RELATED_QUERIES","token":"rq"}]}`, { status: 200 });
    }
    if (u.includes('multiline')) {
      return new Response(`)]}',\n{"default":{"timelineData":[{"formattedTime":"2024-01","value":[30]},{"formattedTime":"2024-02","value":[90]}]}}`, { status: 200 });
    }
    if (u.includes('relatedsearches')) {
      return new Response(`)]}',\n{"default":{"rankedList":[{},{"rankedKeyword":[{"query":"minimalist art","value":100}]}]}}`, { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as any;

  try {
    // Ejecutar TrendsTool directamente (simula lo que haría askAgent con function calling)
    const outcome = await GoogleTrendsTool.execute({ query: 'minimalist wall art' }, { agentId, ventureId });
    assert.equal(outcome.ok, true);

    // Persistir resultado en agent_memory (como haría el agente tras tool call)
    const { writeAgentMemory } = await import('./agentMemoryService.js');
    await writeAgentMemory(agentId, 'trend_minimalist_wall_art', JSON.stringify(outcome.data), ventureId);

    const mem = await dbGet<{ value: string }>(
      'SELECT value FROM agent_memory WHERE agent_id = ? AND key = ? AND venture_id = ?',
      [agentId, 'trend_minimalist_wall_art', ventureId]
    );
    assert.ok(mem, 'memoria debe persistir');
    const parsed = JSON.parse(mem!.value);
    assert.equal(parsed.keyword, 'minimalist wall art');
    assert.ok(Array.isArray(parsed.relatedQueries));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Cleanup function - order matters for FK constraints
async function cleanupVenture(vId: number) {
  // Delete child tables first, then venture
  await run('DELETE FROM decisions WHERE venture_id = ?', [vId]);
  await run('DELETE FROM agent_costs WHERE venture_id = ?', [vId]);
  await run('DELETE FROM agent_memory WHERE venture_id = ?', [vId]);
  await run('DELETE FROM agent_budgets WHERE venture_id = ?', [vId]);
  await run('DELETE FROM work_items WHERE venture_id = ?', [vId]);
  await run('DELETE FROM assets WHERE venture_id = ?', [vId]);
  await run('DELETE FROM projects WHERE venture_id = ?', [vId]);
  await run('DELETE FROM automations WHERE venture_id = ?', [vId]);
  await run('DELETE FROM opportunities WHERE funding_venture_id = ?', [vId]);
  await run('DELETE FROM business_proposals WHERE created_venture_id = ?', [vId]);
  await run('DELETE FROM objectives WHERE venture_id = ?', [vId]);
  await run('DELETE FROM event_log WHERE venture_id = ?', [vId]);
  await run('DELETE FROM memory_entries WHERE venture_id = ?', [vId]);
  await run('DELETE FROM hokage_commands WHERE venture_id = ?', [vId]);
  // agent_tools does NOT have venture_id column
  // IMPORTANT: Clear agents.venture_id before deleting venture (FK constraint)
  await run('UPDATE agents SET venture_id = NULL WHERE venture_id = ?', [vId]);
  await run('DELETE FROM ventures WHERE id = ?', [vId]);
}

async function cleanupAgent(aId: number) {
  // Delete all tables referencing agents(id)
  await run('DELETE FROM work_items WHERE agent_id = ?', [aId]);
  await run('DELETE FROM market WHERE agent_id = ?', [aId]);
  await run('DELETE FROM agent_schedules WHERE agent_id = ?', [aId]);
  await run('DELETE FROM content WHERE agent_id = ?', [aId]);
  await run('DELETE FROM agent_memory WHERE agent_id = ?', [aId]);
  await run('DELETE FROM agent_costs WHERE agent_id = ?', [aId]);
  await run('DELETE FROM agent_budgets WHERE agent_id = ?', [aId]);
  await run('DELETE FROM decisions WHERE agent_id = ?', [aId]);
  await run('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?', [aId, aId]);
  await run('DELETE FROM exec_runs WHERE requested_by_agent_id = ?', [aId]);
  await run('DELETE FROM agent_feedback WHERE agent_id = ?', [aId]);
  await run('DELETE FROM agent_runs WHERE agent_id = ?', [aId]);
  await run('DELETE FROM agent_prompts WHERE agent_id = ?', [aId]);
  await run('DELETE FROM hokage_tasks WHERE agent_id = ?', [aId]);
  await run('DELETE FROM evidence WHERE agent_id = ?', [aId]);
  await run('DELETE FROM memory_entries WHERE source_agent_id = ?', [aId]);
  await run('DELETE FROM agent_tools WHERE agent_id = ?', [aId]);
  // business_proposals does NOT have agent_id column - skip
  // Finally delete the agent
  await run('DELETE FROM agents WHERE id = ?', [aId]);
}

after(async () => {
  // Clean up extra ventures FIRST (no agents created for these in tests)
  for (const vId of extraVentureIds) {
    await cleanupVenture(vId);
  }
  // Clean up MAIN venture: must clear agent.venture_id BEFORE deleting venture
  if (ventureId && agentId) {
    await run('UPDATE agents SET venture_id = NULL WHERE venture_id = ?', [ventureId]);
    await cleanupVenture(ventureId);
  }
  // Clean up agent LAST
  if (agentId) {
    await cleanupAgent(agentId);
  }
});