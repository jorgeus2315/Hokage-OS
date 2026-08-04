import { run, get, all } from '../db/init.js';
import type { Decision, DecisionCreatePayload, DecisionCategory } from '../types/index.js';

const SELECT = 'SELECT id, agent_id, entity_type, entity_id, title, description, reasoning, amount, risk_level, status, category, venture_id, approved_by, approved_at, created_at FROM decisions';

function inferCategory(title: string, amount?: number | null): DecisionCategory {
  const t = title.toLowerCase();
  if (amount && amount > 0) return 'FINANCIAL';
  if (/pagar|gasto|comprar|presupuesto|coste|precio|factura|invoice/.test(t)) return 'FINANCIAL';
  if (/legal|contrato|términos|tos|gdpr|licencia|registro|marca/.test(t)) return 'LEGAL';
  if (/publicar|publish|post|distribuir|lanzar|release|etsy|shopify|youtube/.test(t)) return 'PUBLICATION';
  if (/estrategia|pivotar|cerrar|contratar|fusionar|expandir/.test(t)) return 'STRATEGIC';
  if (/deploy|servidor|vps|migrar|actualizar|sistema/.test(t)) return 'TECHNICAL';
  return 'OPERATIONAL';
}

export async function listDecisions(): Promise<Decision[]> {
  return all<Decision>(`${SELECT} ORDER BY id DESC`);
}

export async function getDecision(id: number): Promise<Decision | undefined> {
  return get<Decision>(`${SELECT} WHERE id = ?`, [id]);
}

export async function createDecision(payload: DecisionCreatePayload): Promise<Decision> {
  // Deduplicación: si el mismo agente ya tiene una decisión idéntica propuesta
  // y sin revisar, no crear otra — evita que una tarea recurrente sature Alertas.
  if (payload.agent_id != null) {
    const duplicate = await get<Decision>(
      `${SELECT} WHERE agent_id = ? AND status = 'proposed' AND lower(trim(title)) = lower(trim(?)) LIMIT 1`,
      [payload.agent_id, payload.title]
    );
    if (duplicate) return duplicate;
  }

  const category = inferCategory(payload.title, payload.amount);
  const result = await run(
    'INSERT INTO decisions (agent_id, entity_type, entity_id, title, description, reasoning, amount, risk_level, status, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
      category,
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
