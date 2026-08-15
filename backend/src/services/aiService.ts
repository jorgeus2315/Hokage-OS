import { get, run } from '../db/init.js';
import { modelSupportsTools, DEFAULT_MODEL } from '../config/agentModels.js';
import { modelFor, toolsFor, getRoleDefinition } from './roleService.js';
import { autonomyAllowsTool } from '../config/rolePolicy.js';
import { composeSystemContext } from './contextComposer.js';
import { ventureOverRealBudget } from './ventureBudget.js';
import * as registry from '../tools/registry.js';
import { getModel, priceOf } from '../config/modelCatalog.js';
import { getProvider, type ChatMessage } from './aiProvider.js';

const MAX_TOOL_TURNS = 3; // máx iteraciones tool_call → resultado → LLM

// K.5: el precio es dato del CATÁLOGO (fuente de verdad), no una tabla local. El dominio no
// conoce OpenRouter ni precios de proveedor: los llama a través de AIProvider y del catálogo.
function calcCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = priceOf(model);
  return (tokensIn * price.in + tokensOut * price.out) / 1_000_000;
}

// Estimación CONSERVADORA de coste (Fase 7) — NO es coste real, solo lo que una reserva
// compromete por adelantado. Fuente de precios única (catálogo). Redondeo a microdólar.
const EST_INPUT_TOKENS = 6000;
const EST_OUTPUT_TOKENS = 2000; // = max_tokens por llamada
function round6(n: number): number { return Math.round(n * 1e6) / 1e6; }

// Coste estimado de UNA llamada al modelo (planner/replanner de Hokage).
export function estimateCallCostUsd(model: string): number {
  return round6(calcCostUsd(model, EST_INPUT_TOKENS, EST_OUTPUT_TOKENS));
}

// Coste estimado de UNA tarea de especialista: hasta MAX_TOOL_TURNS+1 llamadas (loop de tools).
export function estimateTaskCostUsd(model: string): number {
  return round6(calcCostUsd(model, EST_INPUT_TOKENS, EST_OUTPUT_TOKENS) * (MAX_TOOL_TURNS + 1));
}

export interface AskResult {
  ok: boolean;
  data?: { response: string; tokens: number };
  error?: string;
}

// OpenRouter exige nombres de función que cumplan ^[a-zA-Z0-9_-]{1,128}$ — los tool IDs internos
// usan puntos (google.trends) → se convierten a guión bajo (detalle de formato del dominio de tools,
// no del proveedor concreto).
const toFnName = (id: string) => id.replace(/\./g, '_');
const fromFnName = (name: string) => name.replace(/_/g, '.');

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

export async function askAgent(
  agentId: number,
  userMessage: string,
  ventureId?: number | null,
  modelOverride?: string | null,   // K.5: modelo elegido por el ModelRouter (cadena de Hokage). Sin él → estático.
): Promise<AskResult> {
  try {
    const agentRow = await get<{ role: string; model: string | null; name: string }>(
      'SELECT role, model, name FROM agents WHERE id = ?', [agentId]
    );

    // Definición de rol (modelo + tools + autonomía en una sola lectura). null si el rol no está
    // en role_definitions todavía → resolvers/fallback de siempre.
    const roleDef = agentRow?.role ? await getRoleDefinition(agentRow.role) : null;
    const autonomy = roleDef?.default_autonomy ?? 1;
    const roleModel = agentRow?.role ? (roleDef?.model ?? await modelFor(agentRow.role)) : process.env.AI_MODEL;
    // K.5: precedencia — modelo ENRUTADO (override del router) > override del agente > rol > default.
    // Sin override, el comportamiento es exactamente el anterior (estático por rol).
    const MODEL = modelOverride || agentRow?.model || roleModel || DEFAULT_MODEL;

    // Frontera de proveedor: el proveedor sale del catálogo del modelo. El dominio no conoce
    // detalles de OpenRouter ni gestiona su API key — eso vive en el proveedor.
    const provider = getProvider(getModel(MODEL)?.provider ?? 'openrouter');
    if (!provider.isConfigured()) return { ok: false, error: 'Proveedor de IA no configurado' };

    // Defensa en profundidad (Fase 7): ninguna llamada a IA si la venture agotó su presupuesto REAL.
    if (await ventureOverRealBudget(ventureId)) {
      return { ok: false, error: 'Presupuesto de la venture agotado' };
    }

    // Mensaje de SISTEMA por capas (Fase 3). El composer solo produce texto — no altera tools/autonomía.
    const systemPrompt = await composeSystemContext({ agentId, agentName: agentRow?.name ?? null, ventureId });

    // Tools del rol ∩ autonomía. La autonomía NUNCA amplía la lista del rol. El modelo solo decide
    // si SE OFRECEN (capacidad del modelo), nunca QUÉ tools tiene el agente (eso es rol+política).
    const roleTools = roleDef ? roleDef.tools : await toolsFor(agentRow?.role || '');
    const allowedTools = roleTools.filter((id) => autonomyAllowsTool(autonomy, id));
    const availableTools = modelSupportsTools(MODEL)
      ? allowedTools
          .map(id => registry.get(id))
          .filter((t): t is NonNullable<typeof t> => !!t && t.status === 'ready')
          .map(toolToOpenRouterSchema)
          .filter(Boolean)
      : [];

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ];

    let totalTokens = 0, tokensIn = 0, tokensOut = 0;
    let finalResponse = '';

    // Loop de function calling (máx MAX_TOOL_TURNS iteraciones) — vía el proveedor, no fetch directo.
    for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
      const resp = await provider.chat({
        model: MODEL,
        messages,
        maxTokens: 2000,
        tools: availableTools.length > 0 ? availableTools : undefined,
      });
      tokensIn    += resp.tokensIn;
      tokensOut   += resp.tokensOut;
      totalTokens += resp.totalTokens;

      if (resp.toolCalls.length === 0) { finalResponse = resp.content; break; }

      messages.push({ role: 'assistant', content: resp.content || null, tool_calls: resp.toolCalls });
      for (const call of resp.toolCalls) {
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
    }

    const costUsd = calcCostUsd(MODEL, tokensIn, tokensOut);

    await run(
      'INSERT INTO agent_runs (agent_id, action, status, tokens_used, cost) VALUES (?, ?, ?, ?, ?)',
      [agentId, 'ask', 'completed', totalTokens, costUsd]
    );
    // K.5: se registra el MODELO usado (control real del gasto por modelo/venture/agente).
    await run(
      'INSERT INTO agent_costs (agent_id, venture_id, model, tokens_in, tokens_out, llm_cost_usd) VALUES (?, ?, ?, ?, ?, ?)',
      [agentId, ventureId ?? null, MODEL, tokensIn, tokensOut, costUsd]
    ).catch(() => {});
    await run(
      `INSERT INTO agent_budgets (agent_id, monthly_limit_usd, current_month_usd)
       VALUES (?, 5.0, ?)
       ON CONFLICT(agent_id) DO UPDATE SET current_month_usd = current_month_usd + ?`,
      [agentId, costUsd, costUsd]
    ).catch(() => {});

    return { ok: true, data: { response: finalResponse, tokens: totalTokens } };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Error al consultar el proveedor de IA' };
  }
}

// Llamada directa para obtener JSON estructurado (planner/replanner de Hokage) — sin tools ni el
// system prompt del agente. También pasa por AIProvider (sin fetch duplicado). costCtx (Fase 7,
// opcional) atribuye el coste a una venture registrando en agent_costs sin tocar agent_budgets.
export async function callAIJson<T = unknown>(
  systemPrompt: string,
  userMessage: string,
  model?: string,
  costCtx?: { ventureId?: number | null; agentId: number },
): Promise<T | null> {
  const MODEL = model || DEFAULT_MODEL;
  const provider = getProvider(getModel(MODEL)?.provider ?? 'openrouter');
  if (!provider.isConfigured()) return null;
  try {
    const resp = await provider.chat({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxTokens: 2000,
    });

    if (costCtx) {
      await run(
        'INSERT INTO agent_costs (agent_id, venture_id, model, tokens_in, tokens_out, llm_cost_usd) VALUES (?, ?, ?, ?, ?, ?)',
        [costCtx.agentId, costCtx.ventureId ?? null, MODEL, resp.tokensIn, resp.tokensOut, calcCostUsd(MODEL, resp.tokensIn, resp.tokensOut)]
      ).catch(() => {});
    }

    const raw = resp.content || '';
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
