import { run, get, all } from '../db/init.js';
import type { ContentItem, ContentCreatePayload } from '../types/index.js';

const SELECT = 'SELECT id, agent_id, business_id, platform, body, media_url, schedule_at, status, created_at FROM content';

export async function listContent(): Promise<ContentItem[]> {
  return all<ContentItem>(`${SELECT} ORDER BY id DESC`);
}

export async function createContent(payload: ContentCreatePayload): Promise<ContentItem> {
  const result = await run(
    'INSERT INTO content (agent_id, business_id, platform, body, media_url, schedule_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [payload.agent_id ?? null, payload.business_id ?? null, payload.platform, payload.body ?? null, payload.media_url ?? null, payload.schedule_at ?? null, payload.status || 'draft']
  );

  const id = Number(result.lastID);
  const row = await get<ContentItem>(`${SELECT} WHERE id = ?`, [id]);
  if (!row) throw new Error('Content not found after insert');
  return row;
}
