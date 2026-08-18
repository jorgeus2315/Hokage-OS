import { run, all } from '../db/init.js';
import { recordAudit } from './auditService.js';

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
  // Auditoría (Fase 9): SOLO metadatos — nunca la clave ni el valor de la memoria privada.
  await recordAudit({ type: 'memory.write', ventureId: ventureId ?? 0, agentId, meta: { category: 'fact' } });
}

// Fase 10: Lee memoria privada del agente (solo lectura, sin auditoría).
// Devuelve entradas ordenadas por created_at DESC (más recientes primero), límite por defecto 20.
export interface AgentMemoryEntry {
  id: number;
  agent_id: number;
  venture_id: number;
  key: string;
  value: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export async function readAgentMemory(agentId: number, limit = 20): Promise<AgentMemoryEntry[]> {
  return all<AgentMemoryEntry>(
    `SELECT id, agent_id, venture_id, key, value, category, created_at, updated_at
     FROM agent_memory
     WHERE agent_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [agentId, limit]
  );
}
