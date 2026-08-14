// ═══════════════════════════════════════════════════════════════════════════
// agentRuntimeState — derivación REAL del estado de un agente (K.4, ADR-007).
// ═══════════════════════════════════════════════════════════════════════════
//
// FUENTE DE VERDAD: work_items + decisions (durable, SQLite) + activeAgents (runtime, efímero).
// El estado NO se persiste (recalculable tras reinicio) — no hay tabla `agent_runtime_state`.
//
// `deriveAgentRuntimeState` es PURA: evidencia → estado. Determinista y testeable, sin BD, red,
// reloj global ni azar. NO usa Math.random/setInterval/heurística de tiempo para AFIRMAR
// actividad: "WORKING" viene de work_items.status='in_progress' (durable), no de "hace X min".
//
// Identidad por `agentId`, nunca por rol (ADR-009): compatible con 1/varios/temporales/paralelo.
// Aislamiento por venture: el estado lleva el venture_id de su trabajo actual; nunca mezcla.

import { get } from '../db/init.js';
import { listBusinessAgents } from './agentService.js';
import type {
  AgentRuntimeState, AgentPrimaryState, AgentStateModifiers, AgentCurrentTask,
} from '../types/index.js';

const COMPLETED_WINDOW_MS = 30_000;  // ventana breve de COMPLETED antes de volver a IDLE
const ERROR_WINDOW_MS = 60_000;      // ventana de ERROR primario tras un fallo reciente

export interface WorkItemEvidence {
  id: number;
  type: string;
  ventureId: number | null;
  status: string;
  lockedAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AgentStateEvidence {
  agentId: number;
  isActiveInRuntime: boolean;                    // activeAgents.has(id) — refuerzo efímero
  activeWorkItem: WorkItemEvidence | null;       // work_item in_progress (señal viva durable)
  lastResolvedWorkItem: WorkItemEvidence | null; // más reciente done/failed/cancelled
  proposedDecisionCount: number;                 // decisions del agente en 'proposed'
  now: string;                                   // ISO — inyectable para determinismo en tests
}

function within(ts: string | null, nowMs: number, windowMs: number): boolean {
  if (!ts) return false;
  const d = nowMs - Date.parse(ts);
  return d >= 0 && d <= windowMs;
}

// PURA: misma evidencia → mismo estado. Sin BD/red/azar/reloj global (now es un parámetro).
export function deriveAgentRuntimeState(ev: AgentStateEvidence): AgentRuntimeState {
  const nowMs = Date.parse(ev.now);
  const lastFailed = ev.lastResolvedWorkItem?.status === 'failed';

  const modifiers: AgentStateModifiers = {
    awaitingApproval: ev.proposedDecisionCount > 0,
    hasError: !!lastFailed,
    blocked: false,    // GAP K.4 — requiere inspección de dependencias del orquestador (→ D-2)
    reviewing: false,  // GAP K.4 — requiere quality gate (→ C §10)
  };

  let primary: AgentPrimaryState;
  let currentTask: AgentCurrentTask | undefined;
  let ventureId: number | null;
  let since: string;

  if (ev.activeWorkItem) {
    // Señal viva y durable: sobrevive a reinicio (in_progress persiste aunque activeAgents no).
    primary = 'WORKING';
    currentTask = {
      workItemId: ev.activeWorkItem.id,
      kind: ev.activeWorkItem.type,
      startedAt: ev.activeWorkItem.lockedAt ?? ev.activeWorkItem.createdAt,
    };
    ventureId = ev.activeWorkItem.ventureId;
    since = currentTask.startedAt;
  } else if (lastFailed && within(ev.lastResolvedWorkItem!.resolvedAt, nowMs, ERROR_WINDOW_MS)) {
    primary = 'ERROR';
    ventureId = ev.lastResolvedWorkItem!.ventureId;
    since = ev.lastResolvedWorkItem!.resolvedAt!;
  } else if (ev.lastResolvedWorkItem?.status === 'done' && within(ev.lastResolvedWorkItem.resolvedAt, nowMs, COMPLETED_WINDOW_MS)) {
    primary = 'COMPLETED';
    ventureId = ev.lastResolvedWorkItem.ventureId;
    since = ev.lastResolvedWorkItem.resolvedAt!;
  } else {
    // Ausencia de evidencia de trabajo → IDLE. NUNCA "working porque han pasado < X min".
    primary = 'IDLE';
    ventureId = ev.lastResolvedWorkItem?.ventureId ?? null;
    since = ev.lastResolvedWorkItem?.resolvedAt ?? ev.now;
  }

  // activity deriva del ESTADO real, no del tiempo transcurrido (sin heurística temporal).
  const activity = primary === 'WORKING' ? 1 : primary === 'COMPLETED' ? 0.5 : primary === 'ERROR' ? 0.2 : 0;

  return { agentId: ev.agentId, ventureId, primary, modifiers, currentTask, activity, since, updatedAt: ev.now, source: 'runtime' };
}

// Reúne evidencia real de la BD para un agente y deriva su estado. isActive = activeAgents.has(id).
export async function computeAgentRuntimeState(
  agentId: number,
  isActive: boolean,
  now: string = new Date().toISOString(),
): Promise<AgentRuntimeState> {
  const active = await get<{ id: number; type: string; venture_id: number | null; locked_at: string | null; created_at: string }>(
    `SELECT id, type, venture_id, locked_at, created_at FROM work_items
     WHERE agent_id = ? AND status = 'in_progress' ORDER BY locked_at DESC, id DESC LIMIT 1`,
    [agentId],
  );
  const resolved = await get<{ id: number; type: string; venture_id: number | null; status: string; resolved_at: string | null }>(
    `SELECT id, type, venture_id, status, resolved_at FROM work_items
     WHERE agent_id = ? AND status IN ('done','failed','cancelled') AND resolved_at IS NOT NULL
     ORDER BY resolved_at DESC, id DESC LIMIT 1`,
    [agentId],
  );
  const prop = await get<{ c: number }>(
    `SELECT COUNT(*) as c FROM decisions WHERE agent_id = ? AND status = 'proposed'`,
    [agentId],
  );

  return deriveAgentRuntimeState({
    agentId,
    isActiveInRuntime: isActive,
    activeWorkItem: active
      ? { id: active.id, type: active.type, ventureId: active.venture_id, status: 'in_progress', lockedAt: active.locked_at, createdAt: active.created_at, resolvedAt: null }
      : null,
    lastResolvedWorkItem: resolved
      ? { id: resolved.id, type: resolved.type, ventureId: resolved.venture_id, status: resolved.status, lockedAt: null, createdAt: '', resolvedAt: resolved.resolved_at }
      : null,
    proposedDecisionCount: prop?.c ?? 0,
    now,
  });
}

// Estado de todos los agentes de NEGOCIO (por agentId; Hermes/kernel excluido vía listBusinessAgents).
export async function computeAllRuntimeStates(
  activeAgentIds: ReadonlySet<number>,
  now: string = new Date().toISOString(),
): Promise<AgentRuntimeState[]> {
  const agents = await listBusinessAgents();
  const states: AgentRuntimeState[] = [];
  for (const a of agents) {
    states.push(await computeAgentRuntimeState(a.id, activeAgentIds.has(a.id), now));
  }
  return states;
}

// Firma para detección de cambios (delta). Excluye timestamps volátiles (updatedAt/since) para
// que un recálculo idéntico NO genere un delta espurio.
export function stateSignature(s: AgentRuntimeState): string {
  return [
    s.primary,
    s.modifiers.awaitingApproval ? 'A' : '',
    s.modifiers.hasError ? 'E' : '',
    s.modifiers.blocked ? 'B' : '',
    s.modifiers.reviewing ? 'R' : '',
    s.currentTask?.workItemId ?? '',
    s.ventureId ?? '',
  ].join('|');
}
