import { run } from '../db/init.js';

// Escribe un hecho semántico en la memoria del agente.
// Con el UNIQUE index en (agent_id, key) el INSERT REPLACE garantiza upsert sin duplicados.
// Vive en su propio fichero (no en aiService.ts) para que tools/index.ts pueda importarla sin
// crear un ciclo: aiService.ts → tools/registry.ts → tools/index.ts → aiService.ts.
export async function writeAgentMemory(agentId: number, key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO agent_memory (agent_id, key, value, category, updated_at)
     VALUES (?, ?, ?, 'fact', datetime('now'))
     ON CONFLICT(agent_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [agentId, key, value]
  );
}
