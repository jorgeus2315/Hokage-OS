import { get, run } from '../db/init.js';
import { modelForRole, DEFAULT_MODEL } from '../config/agentModels.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export interface AskResult {
  ok: boolean;
  data?: { response: string; tokens: number };
  error?: string;
}

export async function askAgent(agentId: number, userMessage: string): Promise<AskResult> {
  try {
    const [promptRow, agentRow] = await Promise.all([
      get<{ content: string }>('SELECT content FROM agent_prompts WHERE agent_id = ? AND active = 1', [agentId]),
      get<{ role: string; model: string | null }>('SELECT role, model FROM agents WHERE id = ?', [agentId]),
    ]);
    const systemPrompt = promptRow?.content || 'Eres un agente de HOKAGE OS.';

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const MODEL = agentRow?.model || (agentRow?.role ? modelForRole(agentRow.role) : process.env.AI_MODEL) || DEFAULT_MODEL;
    if (!OPENROUTER_API_KEY) {
      return { ok: false, error: 'Falta OPENROUTER_API_KEY en el entorno' };
    }

    const url = `${OPENROUTER_BASE}/chat/completions`;
    const body = {
      model: MODEL,
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `OpenRouter ${res.status}: ${text}` };
    }

    const data = (await res.json()) as any;
    const answer = data?.choices?.[0]?.message?.content || '';

    // Tokens reales de OpenRouter
    const usage = data?.usage || {};
    const totalTokens = usage.total_tokens ?? usage.prompt_tokens ?? 0;

    // Guardar respuesta en memoria
    await run(
      'INSERT INTO agent_memory (agent_id, key, value, category) VALUES (?, ?, ?, ?)',
      [agentId, `ask_${Date.now()}`, answer, 'response']
    );

    // Registrar ejecución
    await run(
      'INSERT INTO agent_runs (agent_id, action, status, tokens_used, cost) VALUES (?, ?, ?, ?, ?)',
      [agentId, 'ask', 'completed', totalTokens, 0]
    );

    return { ok: true, data: { response: answer, tokens: totalTokens } };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Error al consultar OpenRouter' };
  }
}
