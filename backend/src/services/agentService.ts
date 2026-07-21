import { run, get, all } from '../db/init';
import type { Agent, AgentCreatePayload } from '../types';

export async function listAgents(): Promise<Agent[]> {
  return await all<Agent>('SELECT id, name, role, status, created_at FROM agents ORDER BY id ASC');
}

export async function createAgent(payload: AgentCreatePayload): Promise<Agent> {
  const result = await run('INSERT INTO agents (name, role, status) VALUES (?, ?, ?)', [payload.name, payload.role, 'idle']);
  const id = Number((result as any).lastID);
  const row = await get<Agent>('SELECT id, name, role, status, created_at FROM agents WHERE id = ?', [id]);
  if (!row) throw new Error('Agent not found after insert');
  return row;
}
