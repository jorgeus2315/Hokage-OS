import { run, get } from '../db/init';
import type { Agent, AgentCreatePayload } from '../types';

export async function listAgents(): Promise<Agent[]> {
  return await get<Agent[]>('SELECT id, name, role, status, created_at FROM agents ORDER BY id ASC') ?? [];
}

export async function getAgent(id: number): Promise<Agent | undefined> {
  return await get<Agent>('SELECT id, name, role, status, created_at FROM agents WHERE id = ?', [id]);
}

export async function createAgent(payload: AgentCreatePayload): Promise<Agent> {
  const result = await run('INSERT INTO agents (name, role, status) VALUES (?, ?, ?)', [payload.name, payload.role, 'idle']);
  const id = Number((result as any).lastID);
  const row = await get<Agent>('SELECT id, name, role, status, created_at FROM agents WHERE id = ?', [id]);
  if (!row) throw new Error('Agent not found after insert');
  return row;
}

export async function updateAgent(id: number, payload: Partial<AgentCreatePayload> & { status?: string }): Promise<Agent> {
  const current = await getAgent(id);
  if (!current) throw new Error('Agent not found');

  const name = payload.name ?? current.name;
  const role = payload.role ?? current.role;
  const status = payload.status ?? current.status;

  await run('UPDATE agents SET name = ?, role = ?, status = ? WHERE id = ?', [name, role, status, id]);
  const row = await get<Agent>('SELECT id, name, role, status, created_at FROM agents WHERE id = ?', [id]);
  if (!row) throw new Error('Agent not found after update');
  return row;
}

export async function deleteAgent(id: number): Promise<void> {
  await run('DELETE FROM agents WHERE id = ?', [id]);
}
