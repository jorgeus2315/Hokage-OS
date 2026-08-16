import { all, get, run } from '../db/init.js';
import type { RoleDefinition } from '../types/index.js';
import { AGENT_MODELS, AGENT_TOOLS, DEFAULT_MODEL } from '../config/agentModels.js';
import { ROLE_SEEDS } from '../config/roleSeeds.js';
import { validateRoleConfig } from '../config/rolePolicy.js';

// ═══════════════════════════════════════════════════════════════════════════
// roleService — lectura del Registry de roles + resolvers con fallback.
// Fase 1a: solo lectura y resolvers. NADIE los consume todavía — el runtime
// sigue leyendo los mapas TS directamente hasta la Fase 1b, que reemplaza esas
// lecturas por estos resolvers. CRUD/validación de política llegan en 1c.
// ═══════════════════════════════════════════════════════════════════════════

// Fila cruda de SQLite (tools como TEXT JSON, is_system como INTEGER).
interface RoleDefinitionRow {
  key: string;
  label: string;
  specialty: string | null;
  mission: string | null;
  base_prompt: string | null;
  autonomous_task: string | null;
  interval_minutes: number | null;
  model: string;
  fallback_model: string | null;
  tools: string;
  capabilities: string;
  default_autonomy: number;
  monthly_budget_usd: number;
  scope: string;
  is_system: number;
  status: string;
  max_review_cycles: number;
  created_at: string;
  updated_at: string;
}

function parseTools(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function hydrate(row: RoleDefinitionRow): RoleDefinition {
  return {
    key: row.key,
    label: row.label,
    specialty: row.specialty,
    mission: row.mission,
    base_prompt: row.base_prompt,
    autonomous_task: row.autonomous_task,
    interval_minutes: row.interval_minutes,
    model: row.model,
    fallback_model: row.fallback_model,
    tools: parseTools(row.tools),
    default_autonomy: row.default_autonomy,
    monthly_budget_usd: row.monthly_budget_usd,
    scope: row.scope === 'system' ? 'system' : 'business',
    is_system: row.is_system === 1,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    capabilities: row.capabilities ?? '[]',
    max_review_cycles: row.max_review_cycles ?? 2,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── Lectura ────────────────────────────────────────────────────────────────
export async function listRoleDefinitions(): Promise<RoleDefinition[]> {
  const rows = await all<RoleDefinitionRow>('SELECT * FROM role_definitions ORDER BY is_system DESC, key ASC');
  return rows.map(hydrate);
}

export async function getRoleDefinition(key: string): Promise<RoleDefinition | null> {
  const row = await get<RoleDefinitionRow>('SELECT * FROM role_definitions WHERE key = ?', [key]);
  return row ? hydrate(row) : null;
}

// ── Resolvers con fallback en cascada ───────────────────────────────────────
// Orden: role_definitions (dato, gana) → mapa/semilla TS (fallback) → default duro.
// Garantiza que una migración incompleta nunca deje un agente sin modelo/tools
// ni crashee (punto 6 del diseño).

export async function modelFor(role: string): Promise<string> {
  const def = await getRoleDefinition(role);
  if (def?.model) return def.model;
  return AGENT_MODELS[role] ?? DEFAULT_MODEL;
}

export async function toolsFor(role: string): Promise<string[]> {
  const def = await getRoleDefinition(role);
  if (def) return def.tools;
  return AGENT_TOOLS[role] ?? [];
}

export async function autonomousTaskFor(
  role: string
): Promise<{ task: string; interval: number } | null> {
  const def = await getRoleDefinition(role);
  if (def) {
    if (def.autonomous_task && def.interval_minutes) {
      return { task: def.autonomous_task, interval: def.interval_minutes * 60_000 };
    }
    return null; // rol existente sin tarea = chat-only, no rompe
  }
  // Fallback a la semilla TS si el rol aún no está en la tabla
  const s = ROLE_SEEDS.find((r) => r.key === role);
  if (s?.autonomous_task && s.interval_minutes) {
    return { task: s.autonomous_task, interval: s.interval_minutes * 60_000 };
  }
  return null;
}

// ── CRUD (Fase 1c) — toda escritura pasa por validateRoleConfig (política) ───

export interface RoleCreateInput {
  key: string;
  label: string;
  specialty?: string | null;
  mission?: string | null;
  base_prompt?: string | null;
  autonomous_task?: string | null;
  interval_minutes?: number | null;
  model?: string;
  fallback_model?: string | null;
  tools?: string[];
  default_autonomy?: number;
  monthly_budget_usd?: number;
}

export type RoleUpdateInput = Partial<Omit<RoleCreateInput, 'key'>>;

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export async function createRoleDefinition(input: RoleCreateInput): Promise<RoleDefinition> {
  const key = (input.key || '').trim().toLowerCase();
  if (!KEY_PATTERN.test(key)) throw new Error('key inválida — debe ser snake_case en minúsculas (ej: growth_hacker).');
  if (!input.label?.trim()) throw new Error('label es obligatorio.');

  const existing = await get<{ key: string }>('SELECT key FROM role_definitions WHERE key = ?', [key]);
  if (existing) throw new Error(`Ya existe un rol con key "${key}".`);

  // Política: los roles creados por API son siempre de negocio, nunca de sistema.
  const check = validateRoleConfig(input, { creating: true });
  if (!check.ok) throw new Error(check.error);

  await run(
    `INSERT INTO role_definitions
      (key, label, specialty, mission, base_prompt, autonomous_task, interval_minutes,
       model, fallback_model, tools, default_autonomy, monthly_budget_usd, scope, is_system, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'business', 0, 'active')`,
    [
      key, input.label.trim(), input.specialty ?? null, input.mission ?? null, input.base_prompt ?? null,
      input.autonomous_task ?? null, input.interval_minutes ?? null,
      input.model || DEFAULT_MODEL, input.fallback_model ?? null,
      JSON.stringify(input.tools ?? []), input.default_autonomy ?? 1, input.monthly_budget_usd ?? 5.0,
    ]
  );
  const created = await getRoleDefinition(key);
  if (!created) throw new Error('Rol no encontrado tras crear.');
  return created;
}

export async function updateRoleDefinition(key: string, patch: RoleUpdateInput): Promise<RoleDefinition> {
  const existing = await getRoleDefinition(key);
  if (!existing) throw new Error(`Rol "${key}" no encontrado.`);

  const check = validateRoleConfig(patch, {
    creating: false,
    existing: { scope: existing.scope, is_system: existing.is_system },
  });
  if (!check.ok) throw new Error(check.error);

  // Columnas editables por API — nunca key, scope, is_system ni status (este último via setRoleStatus).
  const cols: Array<[string, unknown]> = [];
  const push = (col: string, val: unknown) => cols.push([col, val]);
  if (patch.label !== undefined) push('label', patch.label);
  if (patch.specialty !== undefined) push('specialty', patch.specialty);
  if (patch.mission !== undefined) push('mission', patch.mission);
  if (patch.base_prompt !== undefined) push('base_prompt', patch.base_prompt);
  if (patch.autonomous_task !== undefined) push('autonomous_task', patch.autonomous_task);
  if (patch.interval_minutes !== undefined) push('interval_minutes', patch.interval_minutes);
  if (patch.model !== undefined) push('model', patch.model);
  if (patch.fallback_model !== undefined) push('fallback_model', patch.fallback_model);
  if (patch.tools !== undefined) push('tools', JSON.stringify(patch.tools));
  if (patch.default_autonomy !== undefined) push('default_autonomy', patch.default_autonomy);
  if (patch.monthly_budget_usd !== undefined) push('monthly_budget_usd', patch.monthly_budget_usd);

  if (cols.length === 0) return existing;

  const setSql = cols.map(([c]) => `${c} = ?`).join(', ');
  await run(
    `UPDATE role_definitions SET ${setSql}, updated_at = datetime('now') WHERE key = ?`,
    [...cols.map(([, v]) => v), key]
  );
  const updated = await getRoleDefinition(key);
  if (!updated) throw new Error('Rol no encontrado tras actualizar.');
  return updated;
}

export async function setRoleStatus(key: string, status: 'active' | 'disabled'): Promise<RoleDefinition> {
  const existing = await getRoleDefinition(key);
  if (!existing) throw new Error(`Rol "${key}" no encontrado.`);
  if (existing.is_system && status === 'disabled') {
    throw new Error('Un rol de sistema no se puede desactivar.');
  }
  await run(`UPDATE role_definitions SET status = ?, updated_at = datetime('now') WHERE key = ?`, [status, key]);
  const updated = await getRoleDefinition(key);
  if (!updated) throw new Error('Rol no encontrado tras cambiar estado.');
  return updated;
}
