import { run, get, all } from '../db/init.js';
import type { Decision, DecisionCreatePayload } from '../types/index.js';

const SELECT = 'SELECT id, agent_id, entity_type, entity_id, title, description, reasoning, amount, risk_level, status, approved_by, approved_at, created_at FROM decisions';

export async function listDecisions(): Promise<Decision[]> {
  return all<Decision>(`${SELECT} ORDER BY id DESC`);
}

export async function getDecision(id: number): Promise<Decision | undefined> {
  return get<Decision>(`${SELECT} WHERE id = ?`, [id]);
}

export async function createDecision(payload: DecisionCreatePayload): Promise<Decision> {
  const result = await run(
    'INSERT INTO decisions (agent_id, entity_type, entity_id, title, description, reasoning, amount, risk_level, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      payload.agent_id ?? null,
      payload.entity_type ?? null,
      payload.entity_id ?? null,
      payload.title,
      payload.description ?? null,
      payload.reasoning ?? null,
      payload.amount ?? null,
      payload.risk_level || 'low',
      'proposed',
    ]
  );

  const id = Number(result.lastID);
  const row = await getDecision(id);
  if (!row) throw new Error('Decision not found after insert');
  return row;
}

export async function approveDecision(id: number, approvedBy: string): Promise<Decision> {
  const current = await getDecision(id);
  if (!current) throw new Error('Decision not found');

  await run('UPDATE decisions SET status = ?, approved_by = ?, approved_at = datetime("now") WHERE id = ?', ['approved', approvedBy, id]);
  const updated = await getDecision(id);
  if (!updated) throw new Error('Decision not found after update');
  return updated;
}

export async function rejectDecision(id: number, approvedBy: string): Promise<Decision> {
  const current = await getDecision(id);
  if (!current) throw new Error('Decision not found');

  await run('UPDATE decisions SET status = ?, approved_by = ?, approved_at = datetime("now") WHERE id = ?', ['rejected', approvedBy, id]);
  const updated = await getDecision(id);
  if (!updated) throw new Error('Decision not found after update');
  return updated;
}
