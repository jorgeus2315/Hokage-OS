import { run, get, all } from '../db/init.js';
import type { MarketItem, MarketCreatePayload } from '../types/index.js';

const SELECT = 'SELECT id, agent_id, keyword, source, score, payload, created_at FROM market';

export async function listMarket(agentId?: number): Promise<MarketItem[]> {
  if (agentId != null) {
    return all<MarketItem>(`${SELECT} WHERE agent_id = ? ORDER BY id DESC LIMIT 20`, [agentId]);
  }
  return all<MarketItem>(`${SELECT} ORDER BY id DESC`);
}

export async function createMarket(payload: MarketCreatePayload): Promise<MarketItem> {
  const result = await run(
    'INSERT INTO market (agent_id, keyword, source, score, payload) VALUES (?, ?, ?, ?, ?)',
    [payload.agent_id ?? null, payload.keyword, payload.source || 'etsy', payload.score ?? null, payload.payload || '{}']
  );

  const id = Number(result.lastID);
  const row = await get<MarketItem>(`${SELECT} WHERE id = ?`, [id]);
  if (!row) throw new Error('Market not found after insert');
  return row;
}
