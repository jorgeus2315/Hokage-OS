import { run } from '../db/init.js';

// Escribe un hecho semántico en la memoria PRIVADA del agente, scopeada por venture (Fase 8).
// venture_id procede SIEMPRE del contexto de ejecución (backend), nunca del LLM: 0 = global/sin
// venture. El UNIQUE (agent_id, venture_id, key) garantiza upsert sin duplicados y sin que una
// venture sobrescriba la memoria de otra (misma key en ventures distintas = filas distintas).
// Vive en su propio fichero (no en aiService.ts) para que tools/index.ts pueda importarla sin
// crear un ciclo: aiService.ts → tools/registry.ts → tools/index.ts → aiService.ts.
export async function writeAgentMemory(agentId: number, key: string, value: string, ventureId?: number | null): Promise<void> {
  await run(
    `INSERT INTO agent_memory (agent_id, venture_id, key, value, category, updated_at)
     VALUES (?, ?, ?, ?, 'fact', datetime('now'))
     ON CONFLICT(agent_id, venture_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [agentId, ventureId ?? 0, key, value]
  );
}
