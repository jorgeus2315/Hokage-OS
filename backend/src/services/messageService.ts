import { run, get, all } from '../db/init.js';
import type { Message, MessageCreatePayload } from '../types/index.js';

const SELECT = 'SELECT id, sender_id, receiver_id, content, channel, created_at FROM messages';
const MAX_MESSAGES = 500;

export async function listMessages(): Promise<Message[]> {
  return all<Message>(`${SELECT} ORDER BY id DESC LIMIT ${MAX_MESSAGES}`);
}

export async function createMessage(payload: MessageCreatePayload): Promise<Message> {
  const result = await run(
    'INSERT INTO messages (sender_id, receiver_id, content, channel) VALUES (?, ?, ?, ?)',
    [payload.sender_id ?? null, payload.receiver_id ?? null, payload.content, payload.channel || 'internal']
  );

  const id = Number(result.lastID);
  const row = await get<Message>(`${SELECT} WHERE id = ?`, [id]);
  if (!row) throw new Error('Message not found after insert');

  // Limpieza automática:
  // 1) Eliminar mensajes con más de 30 días.
  // 2) Aplicar cutoff duro por cantidad, preservando los más recientes.
  await run(`DELETE FROM messages WHERE created_at < datetime('now', '-30 days')`);
  await run(`DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ${MAX_MESSAGES})`);

  return row;
}
