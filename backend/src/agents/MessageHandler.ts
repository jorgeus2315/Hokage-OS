import { run, get } from '../db/init';
import type { MessageCreatePayload, Message } from '../types';

export async function createMessage(payload: MessageCreatePayload): Promise<Message> {
  const result = await run('INSERT INTO messages (sender_id, receiver_id, content, channel) VALUES (?, ?, ?, ?)', [payload.sender_id ?? null, payload.receiver_id ?? null, payload.content, payload.channel || 'internal']);
  const id = Number((result as any).lastID);
  const row = await get<{ id: number; sender_id: number | null; receiver_id: number | null; content: string; channel: string; created_at: string }>('SELECT id, sender_id, receiver_id, content, channel, created_at FROM messages WHERE id = ?', [id]);
  if (!row) throw new Error('Message not found after insert');
  return {
    id: row.id,
    sender_id: row.sender_id,
    receiver_id: row.receiver_id,
    content: row.content,
    channel: row.channel,
    created_at: row.created_at,
  };
}

export async function listMessages(): Promise<any[]> {
  const { all } = await import("../db/init.js");
  return all("SELECT * FROM messages ORDER BY created_at DESC LIMIT 50");
}
