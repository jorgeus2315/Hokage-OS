import { run, get, all } from '../db/init';
import type { Decision, DecisionCreatePayload, Message, MessageCreatePayload, ContentItem, ContentCreatePayload, MarketItem, MarketCreatePayload, AuditLog } from '../types';

export async function listDecisions(): Promise<Decision[]> {
  return await all<Decision>('SELECT id, agent_id, entity_type, entity_id, title, amount, risk_level, status, approved_by, approved_at, created_at FROM decisions ORDER BY id DESC');
}

export async function createDecision(payload: DecisionCreatePayload): Promise<Decision> {
  const result = await run(
    'INSERT INTO decisions (agent_id, entity_type, entity_id, title, amount, risk_level, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [payload.agent_id ?? null, payload.entity_type ?? null, payload.entity_id ?? null, payload.title, payload.amount ?? null, payload.risk_level || 'low', 'proposed']
  );

  const id = Number((result as any).lastID);
  const row = await get<Decision>('SELECT id, agent_id, entity_type, entity_id, title, amount, risk_level, status, approved_by, approved_at, created_at FROM decisions WHERE id = ?', [id]);
  if (!row) throw new Error('Decision not found after insert');
  return row;
}

export async function approveDecision(id: number, approvedBy: string): Promise<Decision> {
  const row = await get<Decision>('SELECT id, agent_id, entity_type, entity_id, title, amount, risk_level, status, approved_by, approved_at, created_at FROM decisions WHERE id = ?', [id]);
  if (!row) throw new Error('Decision not found');

  await run('UPDATE decisions SET status = ?, approved_by = ?, approved_at = datetime("now") WHERE id = ?', ['approved', approvedBy, id]);
  const updated = await get<Decision>('SELECT id, agent_id, entity_type, entity_id, title, amount, risk_level, status, approved_by, approved_at, created_at FROM decisions WHERE id = ?', [id]);
  if (!updated) throw new Error('Decision not found after update');
  return updated;
}

export async function rejectDecision(id: number, approvedBy: string): Promise<Decision> {
  const row = await get<Decision>('SELECT id, agent_id, entity_type, entity_id, title, amount, risk_level, status, approved_by, approved_at, created_at FROM decisions WHERE id = ?', [id]);
  if (!row) throw new Error('Decision not found');

  await run('UPDATE decisions SET status = ?, approved_by = ?, approved_at = datetime("now") WHERE id = ?', ['rejected', approvedBy, id]);
  const updated = await get<Decision>('SELECT id, agent_id, entity_type, entity_id, title, amount, risk_level, status, approved_by, approved_at, created_at FROM decisions WHERE id = ?', [id]);
  if (!updated) throw new Error('Decision not found after update');
  return updated;
}

export async function listMessages(): Promise<Message[]> {
  return await all<Message>('SELECT id, sender_id, receiver_id, content, channel, created_at FROM messages ORDER BY id DESC');
}

export async function createMessage(payload: MessageCreatePayload): Promise<Message> {
  const result = await run('INSERT INTO messages (sender_id, receiver_id, content, channel) VALUES (?, ?, ?, ?)', [payload.sender_id ?? null, payload.receiver_id ?? null, payload.content, payload.channel || 'internal']);
  const id = Number((result as any).lastID);
  const row = await get<Message>('SELECT id, sender_id, receiver_id, content, channel, created_at FROM messages WHERE id = ?', [id]);
  if (!row) throw new Error('Message not found after insert');
  return row;
}

export async function listContent(): Promise<ContentItem[]> {
  return await all<ContentItem>('SELECT id, agent_id, business_id, platform, body, media_url, schedule_at, status, created_at FROM content ORDER BY id DESC');
}

export async function createContent(payload: ContentCreatePayload): Promise<ContentItem> {
  const result = await run(
    'INSERT INTO content (agent_id, business_id, platform, body, media_url, schedule_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [payload.agent_id ?? null, payload.business_id ?? null, payload.platform, payload.body ?? null, payload.media_url ?? null, payload.schedule_at ?? null, payload.status || 'draft']
  );

  const id = Number((result as any).lastID);
  const row = await get<ContentItem>('SELECT id, agent_id, business_id, platform, body, media_url, schedule_at, status, created_at FROM content WHERE id = ?', [id]);
  if (!row) throw new Error('Content not found after insert');
  return row;
}

export async function listMarket(): Promise<MarketItem[]> {
  return await all<MarketItem>('SELECT id, keyword, source, score, payload, created_at FROM market ORDER BY id DESC');
}

export async function createMarket(payload: MarketCreatePayload): Promise<MarketItem> {
  const result = await run(
    'INSERT INTO market (keyword, source, score, payload) VALUES (?, ?, ?, ?)',
    [payload.keyword, payload.source || 'etsy', payload.score ?? null, payload.payload || '{}']
  );

  const id = Number((result as any).lastID);
  const row = await get<MarketItem>('SELECT id, keyword, source, score, payload, created_at FROM market WHERE id = ?', [id]);
  if (!row) throw new Error('Market not found after insert');
  return row;
}

export async function listAuditLogs(): Promise<AuditLog[]> {
  return await all<AuditLog>('SELECT id, action, entity, entity_id, user_id, details, created_at FROM audit_logs ORDER BY id DESC');
}

export async function createAuditLog(action: string, entity: string, entityId?: number | null, userId?: number | null, details = ''): Promise<AuditLog> {
  const result = await run('INSERT INTO audit_logs (action, entity, entity_id, user_id, details) VALUES (?, ?, ?, ?, ?)', [action, entity, entityId ?? null, userId ?? null, details]);
  const id = Number((result as any).lastID);
  const row = await get<AuditLog>('SELECT id, action, entity, entity_id, user_id, details, created_at FROM audit_logs WHERE id = ?', [id]);
  if (!row) throw new Error('AuditLog not found after insert');
  return row;
}
