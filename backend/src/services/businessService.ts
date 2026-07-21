import { run, get, all } from '../db/init';
import type { Business, BusinessCreatePayload } from '../types';

export async function listBusinesses(): Promise<Business[]> {
  return await all<Business>('SELECT id, name, channel, category, status, target_revenue, current_revenue, created_at FROM businesses ORDER BY id DESC');
}

export async function createBusiness(payload: BusinessCreatePayload): Promise<Business> {
  const result = await run(
    'INSERT INTO businesses (name, channel, category, target_revenue, status) VALUES (?, ?, ?, ?, ?)',
    [payload.name, payload.channel || 'etsy', payload.category || null, payload.target_revenue || 0, 'draft']
  );

  const id = Number((result as any).lastID);
  const row = await get<Business>('SELECT id, name, channel, category, status, target_revenue, current_revenue, created_at FROM businesses WHERE id = ?', [id]);
  if (!row) throw new Error('Business not found after insert');
  return row;
}
