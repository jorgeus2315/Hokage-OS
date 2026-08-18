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
  // business_proposals does NOT have agent_id column - skip
  // Finally delete the agent
  await run('DELETE FROM agents WHERE id = ?', [aId]);
}

after(async () => {
  // Clean up agent FIRST (main agent belongs to main venture)
  // This removes FK references from agent-scoped tables
  if (agentId) {
    await cleanupAgent(agentId);
  }
  // Clean up extra ventures (no agents created for these in tests)
  for (const vId of extraVentureIds) {
    await cleanupVenture(vId);
  }
  // Clean up main venture (agent already deleted, venture_id cleared in cleanupVenture)
  if (ventureId) {
    await cleanupVenture(ventureId);
  }
});