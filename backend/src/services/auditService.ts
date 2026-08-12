import { run, get, all } from '../db/init.js';

// ═══════════════════════════════════════════════════════════════════════════
// auditService — observabilidad y auditoría (Fase 9). ADITIVO, no cambia lógica.
// ═══════════════════════════════════════════════════════════════════════════
//
// Reutiliza event_log (F2) como ÚNICA fuente de la traza temporal, ahora con columnas de
// correlación (venture/command/task/work_item/agent). NO duplica el coste (agent_costs sigue
// siendo la verdad económica) ni el estado (hokage_commands/tasks/work_items/decisions).
//
// PRIVACIDAD (crítico): recordAudit/recordBusEvent NUNCA persisten secretos, prompts, valores
// de memoria, argumentos ni resultados de tools. sanitizeMeta() es la red de seguridad final:
// redacta por nombre de clave y descarta objetos/arrays anidados. Los callers deben pasar solo
// metadatos operativos; el sanitizador protege aunque un caller se equivoque.

const MAX_VAL_LEN = 200;
// Claves cuyo VALOR nunca debe quedar en un log de auditoría (redactadas aunque el caller falle).
const SENSITIVE_KEY = /(token|secret|password|passwd|api[_-]?key|apikey|authorization|cookie|credential|private|prompt|command|content|value|output|stdout|stderr|args?|body|env)/i;

export function sanitizeMeta(meta: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!meta) return out;
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) continue;
    if (SENSITIVE_KEY.test(k)) { out[k] = '[redacted]'; continue; }
    if (typeof v === 'string') out[k] = v.length > MAX_VAL_LEN ? v.slice(0, MAX_VAL_LEN) + '…' : v;
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else out[k] = '[omitted]'; // objetos/arrays: podrían anidar secretos → no se registran
  }
  return out;
}

export interface AuditInput {
  type: string;
  actor?: string | null;      // from_actor: quién lo provocó (agente, 'Hokage', 'system', usuario)
  ventureId?: number | null;
  commandId?: number | null;
  taskId?: number | null;
  workItemId?: number | null;
  agentId?: number | null;
  status?: string | null;
  meta?: Record<string, unknown>;
}

// Escritor canónico de auditoría. Nunca lanza (no debe romper el flujo instrumentado).
export async function recordAudit(e: AuditInput): Promise<void> {
  const payload = sanitizeMeta({ ...(e.meta ?? {}), ...(e.status ? { status: e.status } : {}) });
  await run(
    `INSERT INTO event_log (type, from_actor, to_actor, payload, venture_id, command_id, task_id, work_item_id, agent_id)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    [e.type, e.actor ?? 'system', JSON.stringify(payload), e.ventureId ?? null, e.commandId ?? null, e.taskId ?? null, e.workItemId ?? null, e.agentId ?? null]
  ).catch((err) => console.error('[AUDIT] Error registrando evento:', err.message));
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Tipos ya persistidos (venture-scopeados y correlacionados) por recordAudit en su punto de
// origen → el suscriptor del bus NO los vuelve a persistir para evitar eventos duplicados.
// (El bus sigue publicándolos para el feed en tiempo real; eso lo consume el WebSocket aparte.)
const AUDIT_OWNED_TYPES = new Set(['decision.created', 'decision.approved', 'decision.rejected']);

// Persiste un evento del bus en event_log extrayendo la correlación del payload (best-effort)
// y sanitizándolo. Sustituye al INSERT inline del suscriptor de eventBus (mismo mecanismo F2).
export async function recordBusEvent(event: { type: string; from: string; to?: string; payload?: Record<string, unknown> }): Promise<void> {
  if (AUDIT_OWNED_TYPES.has(event.type)) return;
  const p = event.payload ?? {};
  await run(
    `INSERT INTO event_log (type, from_actor, to_actor, payload, venture_id, command_id, task_id, work_item_id, agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.type, event.from, event.to ?? null, JSON.stringify(sanitizeMeta(p)),
      numOrNull(p.ventureId), numOrNull(p.commandId), numOrNull(p.taskId), numOrNull(p.workItemId), numOrNull(p.agentId),
    ]
  ).catch((err) => console.error('[EVENT_LOG] Error persistiendo evento:', err.message));
}

export interface AuditEvent {
  id: number;
  type: string;
  from_actor: string;
  to_actor: string | null;
  payload: string;
  venture_id: number | null;
  command_id: number | null;
  task_id: number | null;
  work_item_id: number | null;
  agent_id: number | null;
  created_at: string;
}

export interface AuditFilters {
  ventureId?: number | null;
  commandId?: number;
  taskId?: number;
  workItemId?: number;
  agentId?: number;
  type?: string;
  since?: string;   // created_at >=
  until?: string;   // created_at <=
  limit?: number;
  cursor?: number;  // id < cursor (paginación descendente)
}

const EVT_SELECT = 'SELECT id, type, from_actor, to_actor, payload, venture_id, command_id, task_id, work_item_id, agent_id, created_at FROM event_log';

// Consulta de auditoría con scope por venture IMPUESTO en la query (no solo en el frontend):
// una consulta de V1 nunca devuelve eventos de V2. Paginación por cursor (id descendente).
export async function listAuditEvents(f: AuditFilters): Promise<AuditEvent[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.ventureId !== undefined) {
    if (f.ventureId === null) where.push('venture_id IS NULL');
    else { where.push('venture_id = ?'); params.push(f.ventureId); }
  }
  if (f.commandId !== undefined) { where.push('command_id = ?'); params.push(f.commandId); }
  if (f.taskId !== undefined) { where.push('task_id = ?'); params.push(f.taskId); }
  if (f.workItemId !== undefined) { where.push('work_item_id = ?'); params.push(f.workItemId); }
  if (f.agentId !== undefined) { where.push('agent_id = ?'); params.push(f.agentId); }
  if (f.type) { where.push('type = ?'); params.push(f.type); }
  if (f.since) { where.push('created_at >= ?'); params.push(f.since); }
  if (f.until) { where.push('created_at <= ?'); params.push(f.until); }
  if (f.cursor) { where.push('id < ?'); params.push(f.cursor); }
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const sql = `${EVT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
  params.push(limit);
  return all<AuditEvent>(sql, params);
}

// Reconstrucción de un command a partir de IDs existentes (sin trace_id nuevo): command +
// tasks + work_items + la traza de eventos correlacionada por command_id. El coste real NO se
// recalcula aquí (se referencia agent_costs por venture); es DATO de solo lectura.
export async function getCommandTrace(commandId: number): Promise<Record<string, unknown> | null> {
  const command = await get<Record<string, unknown>>(
    'SELECT id, venture_id, text, status, plan_summary, result_summary, idempotency_key, replan_count, created_at, updated_at FROM hokage_commands WHERE id = ?',
    [commandId]
  );
  if (!command) return null;

  const tasks = await all<{ id: number; work_item_id: number | null }>(
    'SELECT id, command_id, phase, role, agent_id, title, prompt, status, work_item_id, result, error, reserved_usd, created_at, updated_at FROM hokage_tasks WHERE command_id = ? ORDER BY phase ASC, id ASC',
    [commandId]
  );
  const wiIds = tasks.map((t) => t.work_item_id).filter((v): v is number => v != null);
  const workItems = wiIds.length
    ? await all(`SELECT id, agent_id, venture_id, type, status, resolved_at, created_at FROM work_items WHERE id IN (${wiIds.map(() => '?').join(',')})`, wiIds)
    : [];
  const events = await listAuditEvents({ commandId, limit: 500 });

  return { command, tasks, work_items: workItems, events };
}
