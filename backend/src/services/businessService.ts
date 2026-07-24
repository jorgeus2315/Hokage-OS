import { run, get, all } from '../db/init.js';
import type { Business, BusinessCreatePayload } from '../types/index.js';

const SELECT = 'SELECT id, name, channel, category, status, target_revenue, current_revenue, created_at FROM businesses';

export async function listBusinesses(): Promise<Business[]> {
  return all<Business>(`${SELECT} ORDER BY id DESC`);
}

export async function getBusiness(id: number): Promise<Business | undefined> {
  return get<Business>(`${SELECT} WHERE id = ?`, [id]);
}

export async function createBusiness(payload: BusinessCreatePayload): Promise<Business> {
  const result = await run(
    'INSERT INTO businesses (name, channel, category, target_revenue, status) VALUES (?, ?, ?, ?, ?)',
    [payload.name, payload.channel || 'etsy', payload.category || null, payload.target_revenue || 0, 'draft']
  );

  const id = Number(result.lastID);
  const row = await getBusiness(id);
  if (!row) throw new Error('Business not found after insert');
  return row;
}

export async function updateBusiness(id: number, payload: Partial<BusinessCreatePayload> & { status?: string }): Promise<Business> {
  const current = await getBusiness(id);
  if (!current) throw new Error('Business not found');

  const name = payload.name ?? current.name;
  const channel = payload.channel ?? current.channel;
  const category = payload.category ?? current.category;
  const target_revenue = payload.target_revenue ?? current.target_revenue;
  const status = payload.status ?? current.status;

  await run('UPDATE businesses SET name = ?, channel = ?, category = ?, target_revenue = ?, status = ? WHERE id = ?', [name, channel, category, target_revenue, status, id]);
  const row = await getBusiness(id);
  if (!row) throw new Error('Business not found after update');
  return row;
}
