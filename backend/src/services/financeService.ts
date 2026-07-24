import { run, get, all } from '../db/init.js';
import type { FinanceItem, FinanceCreatePayload } from '../types/index.js';

const SELECT = 'SELECT id, business_id, direction, amount, currency, source, created_at FROM finance';

export async function listFinance(businessId?: number): Promise<FinanceItem[]> {
  if (businessId) {
    return all<FinanceItem>(`${SELECT} WHERE business_id = ? ORDER BY id DESC`, [businessId]);
  }
  return all<FinanceItem>(`${SELECT} ORDER BY id DESC`);
}

export async function createFinance(payload: FinanceCreatePayload): Promise<FinanceItem> {
  const result = await run(
    'INSERT INTO finance (business_id, direction, amount, currency, source) VALUES (?, ?, ?, ?, ?)',
    [payload.business_id ?? null, payload.direction || 'in', payload.amount, payload.currency || 'EUR', payload.source || null]
  );

  const id = Number(result.lastID);
  const row = await get<FinanceItem>(`${SELECT} WHERE id = ?`, [id]);
  if (!row) throw new Error('Finance not found after insert');
  return row;
}
