import { get, run, all } from '../db/init.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export interface AskResult {
  ok: boolean;
  response?: string;
  error?: string;
}

export async function askAgent(agentId: number, userMessage: string): Promise<AskResult> {
  try {
    const promptRow = await get<any>(
      'SELECT content FROM agent_prompts WHERE agent_id = ? AND active = 1',
      [agentId]
    );
    const systemPrompt = promptRow?.content || 'Eres un agente de HOKAGE OS.';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.AI_MODEL || 'anthropic/claude-haiku-4-5';
if (!OPENROUTER_API_KEY) {      return { ok: false, error: 'Falta OPENROUTER_API_KEY en el entorno' };
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

    // Guardar respuesta en memoria
    await run(
      'INSERT INTO agent_memory (agent_id, key, value, category) VALUES (?, ?, ?, ?)',
      [agentId, `ask_${Date.now()}`, answer, 'response']
    );

    // Registrar ejecución
    const runResult = await run(
      'INSERT INTO agent_runs (agent_id, action, status, tokens_used, cost) VALUES (?, ?, ?, ?, ?)',
      [agentId, 'ask', 'completed', 0, 0]
    );
    await run('UPDATE agent_runs SET output = ?, finished_at = datetime("now") WHERE id = ?', [answer, runResult.lastID]);

    return { ok: true, response: answer };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Error al consultar OpenRouter' };
  }
}
