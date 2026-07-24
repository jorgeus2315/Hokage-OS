import { run, get, all } from '../db/init.js';
import { modelForRole } from '../config/agentModels.js';
import type { Agent, AgentCreatePayload } from '../types/index.js';

const SELECT = 'SELECT id, name, role, status, model, created_at FROM agents';

export async function listAgents(): Promise<Agent[]> {
  return all<Agent>(`${SELECT} ORDER BY id ASC`);
}

export async function getAgent(id: number): Promise<Agent | undefined> {
  return get<Agent>(`${SELECT} WHERE id = ?`, [id]);
}

export async function createAgent(payload: AgentCreatePayload): Promise<Agent> {
  const model = payload.model || modelForRole(payload.role);
  const result = await run('INSERT INTO agents (name, role, status, model) VALUES (?, ?, ?, ?)', [payload.name, payload.role, 'idle', model]);
  const id = Number(result.lastID);
  const row = await getAgent(id);
  if (!row) throw new Error('Agent not found after insert');
  return row;
}

export async function updateAgent(id: number, payload: Partial<AgentCreatePayload> & { status?: string }): Promise<Agent> {
  const current = await getAgent(id);
  if (!current) throw new Error('Agent not found');

  const name = payload.name ?? current.name;
  const role = payload.role ?? current.role;
  const status = payload.status ?? current.status;
  const model = payload.model ?? current.model ?? modelForRole(role);

  await run('UPDATE agents SET name = ?, role = ?, status = ?, model = ? WHERE id = ?', [name, role, status, model, id]);
  const row = await getAgent(id);
  if (!row) throw new Error('Agent not found after update');
  return row;
}

export async function deleteAgent(id: number): Promise<void> {
  await run('DELETE FROM agents WHERE id = ?', [id]);
}
