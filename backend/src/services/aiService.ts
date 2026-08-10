import { get, run, all } from '../db/init.js';
import { modelSupportsTools, DEFAULT_MODEL } from '../config/agentModels.js';
import { modelFor, toolsFor } from './roleService.js';
import * as registry from '../tools/registry.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const AI_TIMEOUT_MS   = 120_000;
const MAX_TOOL_TURNS  = 3; // máx iteraciones tool_call → resultado → LLM

// Precios por millón de tokens (input/output) por modelo OpenRouter
// Fuente: openrouter.ai/models — actualizar si cambian
const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  'anthropic/claude-sonnet-4.5':          { in: 3.00,  out: 15.00 },
  'anthropic/claude-haiku-4.5':           { in: 0.80,  out: 4.00  },
  'google/gemini-2.5-flash':              { in: 0.15,  out: 0.60  },
  'google/gemini-flash-1.5':              { in: 0.075, out: 0.30  },
  'meta-llama/llama-3.1-8b-instruct':    { in: 0.06,  out: 0.06  },
};
const DEFAULT_PRICE = { in: 1.00, out: 5.00 }; // fallback conservador

function calcCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  return (tokensIn * price.in + tokensOut * price.out) / 1_000_000;
}

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

// OpenRouter exige nombres de función que cumplan ^[a-zA-Z0-9_-]{1,128}$
// Los tool IDs internos usan puntos (google.trends) → convertir a guión bajo
const toFnName = (id: string) => id.replace(/\./g, '_');
const fromFnName = (name: string) => name.replace(/_/g, '.');

// Convierte el inputSchema de un tool al formato OpenAI/OpenRouter
function toolToOpenRouterSchema(tool: ReturnType<typeof registry.get>) {
  if (!tool) return null;
  return {
    type: 'function' as const,
    function: {
      name:        toFnName(tool.id),
      description: tool.description,
      parameters:  tool.inputSchema,
    },
  };
}

export async function askAgent(agentId: number, userMessage: string, ventureId?: number | null): Promise<AskResult> {
  try {
    const [promptRow, agentRow, masterRow] = await Promise.all([
      get<{ content: string }>('SELECT content FROM agent_prompts WHERE agent_id = ? AND active = 1 ORDER BY version DESC LIMIT 1', [agentId]),
      get<{ role: string; model: string | null; name: string }>('SELECT role, model, name FROM agents WHERE id = ?', [agentId]),
      get<{ content: string }>('SELECT content FROM agent_prompts WHERE agent_id = 0 AND prompt_type = ? AND active = 1 ORDER BY version DESC LIMIT 1', ['master']),
    ]);

    const masterBlock = masterRow?.content ? `[CONTEXTO GLOBAL DEL SISTEMA]\n${masterRow.content}\n\n` : '';
    const basePrompt = promptRow?.content || `Eres ${agentRow?.name ?? 'un agente'} de HOKAGE OS.`;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    // Modelo: override del agente > modelo del rol (role_definitions, vía resolver con fallback) > AI_MODEL > default.
    const roleModel = agentRow?.role ? await modelFor(agentRow.role) : process.env.AI_MODEL;
    const MODEL = agentRow?.model || roleModel || DEFAULT_MODEL;

    if (!OPENROUTER_API_KEY) return { ok: false, error: 'Falta OPENROUTER_API_KEY en el entorno' };

    const memoryRows = await all<{ key: string; value: string }>(
      `SELECT key, value FROM agent_memory WHERE agent_id = ? AND category = 'fact' ORDER BY updated_at DESC LIMIT 10`,
      [agentId]
    );
    const memoryBlock = memoryRows.length > 0
      ? '\n\n[LO QUE SÉ]\n' + memoryRows.map(m => `- ${m.key}: ${m.value}`).join('\n')
      : '';
    const systemPrompt = masterBlock + basePrompt + memoryBlock;

    // Construir tools disponibles para este agente (solo si el modelo lo soporta).
    // Tools del rol vía role_definitions (resolver con fallback); modelSupportsTools sigue
    // siendo capacidad de runtime del MODELO, no del rol — se mantiene en agentModels.
    const roleTools = await toolsFor(agentRow?.role || '');
    const availableTools = modelSupportsTools(MODEL)
      ? roleTools
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
    let tokensIn = 0;
    let tokensOut = 0;
    let finalResponse = '';

    // Loop de function calling (máx MAX_TOOL_TURNS iteraciones)
    for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
      const body: Record<string, unknown> = {
        model:      MODEL,
        max_tokens: 2000,
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
      const usage    = data?.usage || {};
      const turnIn   = usage.prompt_tokens     ?? 0;
      const turnOut  = usage.completion_tokens ?? 0;
      tokensIn    += turnIn;
      tokensOut   += turnOut;
      totalTokens += usage.total_tokens ?? (turnIn + turnOut);

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
          const toolId  = fromFnName(call.function.name);
          const outcome = await registry.execute(toolId, args, { agentId, ventureId: ventureId ?? undefined });
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

    const costUsd = calcCostUsd(MODEL, tokensIn, tokensOut);

    // Persistir en agent_runs
    await run(
      'INSERT INTO agent_runs (agent_id, action, status, tokens_used, cost) VALUES (?, ?, ?, ?, ?)',
      [agentId, 'ask', 'completed', totalTokens, costUsd]
    );

    // Registrar coste en agent_costs
    await run(
      'INSERT INTO agent_costs (agent_id, tokens_in, tokens_out, llm_cost_usd) VALUES (?, ?, ?, ?)',
      [agentId, tokensIn, tokensOut, costUsd]
    ).catch(() => {});

    // Actualizar gasto mensual en agent_budgets (upsert — crea la fila si no existe)
    await run(
      `INSERT INTO agent_budgets (agent_id, monthly_limit_usd, current_month_usd)
       VALUES (?, 5.0, ?)
       ON CONFLICT(agent_id) DO UPDATE SET current_month_usd = current_month_usd + ?`,
      [agentId, costUsd, costUsd]
    ).catch(() => {});

    return { ok: true, data: { response: finalResponse, tokens: totalTokens } };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Error al consultar OpenRouter' };
  }
}

// Llamada directa a la IA para obtener JSON estructurado sin el sistema prompt del agente.
// Usar solo para tareas internas del sistema (no conversaciones con el usuario).
export async function callAIJson<T = unknown>(systemPrompt: string, userMessage: string, model?: string): Promise<T | null> {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) return null;
  const MODEL = model || DEFAULT_MODEL;
  try {
    const res = await withAiTimeout(
      fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: openRouterHeaders(OPENROUTER_API_KEY),
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
      })
    );
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const raw: string = data?.choices?.[0]?.message?.content || '';
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return null;
    return JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as T;
  } catch {
    return null;
  }
}

// Movida a agentMemoryService.ts para evitar un ciclo de imports con tools/index.ts —
// se re-exporta aquí para no romper a los importadores existentes (agentRuntime.ts).
export { writeAgentMemory } from './agentMemoryService.js';
