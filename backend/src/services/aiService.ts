import { get, run, all } from '../db/init.js';
import { modelForRole, DEFAULT_MODEL } from '../config/agentModels.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const AI_TIMEOUT_MS = 120_000;

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
    if (error?.message === 'AI_TIMEOUT') {
      throw new Error('OpenRouter no respondió a tiempo');
    }
    throw error;
  }
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
    if (!OPENROUTER_API_KEY) {
      return { ok: false, error: 'Falta OPENROUTER_API_KEY en el entorno' };
    }

    // Solo leer hechos semánticos escritos explícitamente por el agente (category='fact')
    const memoryRows = await all<{ key: string; value: string }>(
      `SELECT key, value FROM agent_memory
       WHERE agent_id = ? AND category = 'fact'
       ORDER BY updated_at DESC LIMIT 10`,
      [agentId]
    );
    const memoryBlock = memoryRows.length > 0
      ? '\n\n[LO QUE SÉ]\n' + memoryRows.map(m => `- ${m.key}: ${m.value}`).join('\n')
      : '';
    const systemPrompt = basePrompt + memoryBlock;

    const url = `${OPENROUTER_BASE}/chat/completions`;
    const body = {
      model: MODEL,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    };

    const res = await withAiTimeout(
      fetch(url, {
        method: 'POST',
        headers: openRouterHeaders(OPENROUTER_API_KEY),
        body: JSON.stringify(body),
      })
    );

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `OpenRouter ${res.status}: ${text}` };
    }

    const data = (await res.json()) as any;
    const answer = data?.choices?.[0]?.message?.content || '';

    const usage = data?.usage || {};
    const totalTokens = usage.total_tokens ?? usage.prompt_tokens ?? 0;

    await run(
      'INSERT INTO agent_runs (agent_id, action, status, tokens_used, cost) VALUES (?, ?, ?, ?, ?)',
      [agentId, 'ask', 'completed', totalTokens, 0]
    );

    return { ok: true, data: { response: answer, tokens: totalTokens } };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Error al consultar OpenRouter' };
  }
}

// Escribe un hecho semántico en la memoria del agente.
// Si la clave ya existe, la actualiza en lugar de duplicar.
export async function writeAgentMemory(agentId: number, key: string, value: string): Promise<void> {
  const existing = await get<{ id: number }>(
    'SELECT id FROM agent_memory WHERE agent_id = ? AND key = ?',
    [agentId, key]
  );
  if (existing) {
    await run(
      `UPDATE agent_memory SET value = ?, updated_at = datetime('now') WHERE agent_id = ? AND key = ?`,
      [value, agentId, key]
    );
  } else {
    await run(
      `INSERT INTO agent_memory (agent_id, key, value, category) VALUES (?, ?, ?, 'fact')`,
      [agentId, key, value]
    );
  }
}
