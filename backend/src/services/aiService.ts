import { get, run, all } from '../db/init.js';
import { modelForRole, modelSupportsTools, toolsForRole, DEFAULT_MODEL } from '../config/agentModels.js';
import * as registry from '../tools/registry.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const AI_TIMEOUT_MS   = 120_000;
const MAX_TOOL_TURNS  = 3; // máx iteraciones tool_call → resultado → LLM

function openRouterHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

export interface AskResult {
  ok: boolean;
  data?: { response: string; tokens: number };
  error?: string;
}

async function withAiTimeout<T>(promise: Promise<T>): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch (error: any) {
    if (error?.message === 'AI_TIMEOUT') throw new Error('OpenRouter no respondió a tiempo');
    throw error;
  }
}

// Convierte el inputSchema de un tool al formato OpenAI/OpenRouter
function toolToOpenRouterSchema(tool: ReturnType<typeof registry.get>) {
  if (!tool) return null;
  return {
    type: 'function' as const,
    function: {
      name:        tool.id,
      description: tool.description,
      parameters:  tool.inputSchema,
    },
  };
}

export async function askAgent(agentId: number, userMessage: string): Promise<AskResult> {
  try {
    const [promptRow, agentRow] = await Promise.all([
      get<{ content: string }>('SELECT content FROM agent_prompts WHERE agent_id = ? AND active = 1', [agentId]),
      get<{ role: string; model: string | null }>('SELECT role, model FROM agents WHERE id = ?', [agentId]),
    ]);

    const basePrompt = promptRow?.content || 'Eres un agente de HOKAGE OS.';
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const MODEL = agentRow?.model || (agentRow?.role ? modelForRole(agentRow.role) : process.env.AI_MODEL) || DEFAULT_MODEL;

    if (!OPENROUTER_API_KEY) return { ok: false, error: 'Falta OPENROUTER_API_KEY en el entorno' };

    const memoryRows = await all<{ key: string; value: string }>(
      `SELECT key, value FROM agent_memory WHERE agent_id = ? AND category = 'fact' ORDER BY updated_at DESC LIMIT 10`,
      [agentId]
    );
    const memoryBlock = memoryRows.length > 0
      ? '\n\n[LO QUE SÉ]\n' + memoryRows.map(m => `- ${m.key}: ${m.value}`).join('\n')
      : '';
    const systemPrompt = basePrompt + memoryBlock;

    // Construir tools disponibles para este agente (solo si el modelo lo soporta)
    const availableTools = modelSupportsTools(MODEL)
      ? (toolsForRole(agentRow?.role || ''))
          .map(id => registry.get(id))
          .filter((t): t is NonNullable<typeof t> => !!t && t.status === 'ready')
          .map(toolToOpenRouterSchema)
          .filter(Boolean)
      : [];

    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ];

    const url = `${OPENROUTER_BASE}/chat/completions`;
    let totalTokens = 0;
    let finalResponse = '';

    // Loop de function calling (máx MAX_TOOL_TURNS iteraciones)
    for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
      const body: Record<string, unknown> = {
        model:      MODEL,
        max_tokens: 1200,
        messages,
      };
      if (availableTools.length > 0) body.tools = availableTools;

      const res = await withAiTimeout(
        fetch(url, { method: 'POST', headers: openRouterHeaders(OPENROUTER_API_KEY), body: JSON.stringify(body) })
      );

      if (!res.ok) {
        const text = await res.text();
        return { ok: false, error: `OpenRouter ${res.status}: ${text}` };
      }

      const data = (await res.json()) as any;
      const usage = data?.usage || {};
      totalTokens += usage.total_tokens ?? usage.prompt_tokens ?? 0;

      const choice    = data?.choices?.[0];
      const message   = choice?.message;
      const toolCalls = message?.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;

      // Sin tool_calls → respuesta final de texto
      if (!toolCalls || toolCalls.length === 0) {
        finalResponse = message?.content || '';
        break;
      }

      // Hay tool_calls: ejecutar cada uno y añadir resultados al hilo
      messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: toolCalls });

      for (const call of toolCalls) {
        let toolResult: string;
        try {
          const args    = JSON.parse(call.function.arguments || '{}');
          const outcome = await registry.execute(call.function.name, args, { agentId });
          toolResult    = JSON.stringify(outcome.ok ? outcome.data : { error: outcome.error });
        } catch (err: any) {
          toolResult = JSON.stringify({ error: err.message });
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult });
      }

      // Si llegamos al límite de turnos, forzar respuesta sin tools
      if (turn === MAX_TOOL_TURNS) {
        messages.push({ role: 'user', content: 'Resume con la respuesta final basada en los datos anteriores.' });
        body.tools = undefined;
      }
    }

    // Persistir en agent_runs
    await run(
      'INSERT INTO agent_runs (agent_id, action, status, tokens_used, cost) VALUES (?, ?, ?, ?, ?)',
      [agentId, 'ask', 'completed', totalTokens, 0]
    );

    // Registrar coste en agent_costs
    await run(
      'INSERT INTO agent_costs (agent_id, tokens_in, tokens_out) VALUES (?, ?, ?)',
      [agentId, 0, totalTokens]
    ).catch(() => {}); // no bloquear si la tabla aún no existe

    return { ok: true, data: { response: finalResponse, tokens: totalTokens } };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Error al consultar OpenRouter' };
  }
}

// Escribe un hecho semántico en la memoria del agente.
// Con el UNIQUE index en (agent_id, key) el INSERT REPLACE garantiza upsert sin duplicados.
export async function writeAgentMemory(agentId: number, key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO agent_memory (agent_id, key, value, category, updated_at)
     VALUES (?, ?, ?, 'fact', datetime('now'))
     ON CONFLICT(agent_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [agentId, key, value]
  );
}
