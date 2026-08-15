// ═══════════════════════════════════════════════════════════════════════════
// taskProfile — validación DETERMINISTA del TaskProfile (K.5, ADR-008/ADR-010, trampa D1).
// ═══════════════════════════════════════════════════════════════════════════
//
// El LLM PROPONE un TaskProfile al descomponer; este código lo SANEA a un TaskProfile válido.
// Guard (como validatePlan): la salida del LLM es dato NO confiable → cualquier campo fuera del
// vocabulario cerrado se normaliza a un defecto conservador. El LLM no puede inyectar campos
// peligrosos ni valores inventados. NO decide presupuesto — el techo duro lo impone el runtime.

import type { TaskProfile, TaskKind, TaskComplexity, TaskImportance, TaskRisk } from '../types/index.js';

const KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>(['research', 'content', 'strategy', 'analysis', 'review', 'classify', 'bulk', 'conversation', 'code', 'design']);
const COMPLEXITY: ReadonlySet<TaskComplexity> = new Set<TaskComplexity>(['low', 'medium', 'high']);
const IMPORTANCE: ReadonlySet<TaskImportance> = new Set<TaskImportance>(['low', 'medium', 'high', 'critical']);
const RISK: ReadonlySet<TaskRisk> = new Set<TaskRisk>(['low', 'medium', 'high']);

// Defecto conservador cuando falta o es inválido: tarea de contenido, complejidad/importancia media.
export const DEFAULT_TASK_PROFILE: TaskProfile = {
  kind: 'content', complexity: 'medium', importance: 'medium', needs: {}, risk: 'low',
};

function pick<T>(set: ReadonlySet<T>, v: unknown, fallback: T): T {
  return typeof v === 'string' && set.has(v as T) ? (v as T) : fallback;
}

export function validateTaskProfile(raw: unknown): TaskProfile {
  const r = (raw ?? {}) as Record<string, unknown>;
  const needsRaw = (r.needs ?? {}) as Record<string, unknown>;

  // Solo se leen los flags conocidos; solo `true` cuenta (ausencia = no declarado).
  const needs: TaskProfile['needs'] = {};
  if (needsRaw.reasoning === true)   needs.reasoning = true;
  if (needsRaw.creativity === true)  needs.creativity = true;
  if (needsRaw.research === true)    needs.research = true;
  if (needsRaw.tools === true)       needs.tools = true;
  if (needsRaw.longContext === true) needs.longContext = true;

  const profile: TaskProfile = {
    kind:       pick(KINDS, r.kind, DEFAULT_TASK_PROFILE.kind),
    complexity: pick(COMPLEXITY, r.complexity, DEFAULT_TASK_PROFILE.complexity),
    importance: pick(IMPORTANCE, r.importance, DEFAULT_TASK_PROFILE.importance),
    needs,
    risk:       pick(RISK, r.risk, DEFAULT_TASK_PROFILE.risk),
  };
  if (r.timeSensitivity === 'urgent' || r.timeSensitivity === 'normal') {
    profile.timeSensitivity = r.timeSensitivity;
  }
  return profile;
}
