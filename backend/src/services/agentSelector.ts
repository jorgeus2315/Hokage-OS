import { run, get, all } from '../db/init.js';
import type { AgentCapability, AgentCapabilities, AgentType, SelectionCriteria, SelectionResult, ProvisionResult } from '../types/index.js';
import { AGENT_CAPABILITY_VOCABULARY } from '../types/index.js';
import { getRoleDefinition } from './roleService.js';
import { createAgent } from './agentService.js';
import { recordAudit } from './auditService.js';

// ═══════════════════════════════════════════════════════════════════════════
// agentSelector — ADR-011 (Agent Registry y Capability-based Selection)
// ═══════════════════════════════════════════════════════════════════════════
//
// Selección determinista de especialista por matching de capabilities (no por
// creación implícita de selectOrCreateSpecialist). Atómico en claim/release para
// soportar concurrencia: exactamente un llamador gana el claim de un agente.
//
// Modelo: un claim activo por agente (claimed_by_task + claim_expires_at).
// Expiración determinista vía claim_expires_at (ISO) comparado con datetime('now').

// Validar que una capability pertenece al vocabulario
function isValidCapability(cap: string): cap is AgentCapability {
  return AGENT_CAPABILITY_VOCABULARY.includes(cap as AgentCapability);
}

// Filtrar capabilities válidas
function filterValidCapabilities(caps: string[]): AgentCapabilities {
  return caps.filter(isValidCapability) as AgentCapabilities;
}

// Parsear capabilities desde JSON string (array de strings)
export function parseCapabilities(raw: string | null | undefined): AgentCapabilities {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return filterValidCapabilities(parsed);
    }
    return [];
  } catch {
    return [];
  }
}

// Fusionar capabilities base + override (union sin duplicados, solo válidas)
export function mergeCapabilities(base: AgentCapabilities, override?: AgentCapabilities): AgentCapabilities {
  if (!override || override.length === 0) return base;
  const merged = [...base, ...override];
  return filterValidCapabilities([...new Set(merged)]);
}

// Verificar si un agente tiene TODAS las capabilities requeridas (hard filter)
function hasAllRequired(agentCaps: AgentCapabilities, required: AgentCapability[]): boolean {
  return required.every(req => agentCaps.includes(req));
}

// Calcular cobertura de preferred capabilities (0..1)
function preferredCoverage(agentCaps: AgentCapabilities, preferred: AgentCapability[]): number {
  if (preferred.length === 0) return 0;
  const matched = preferred.filter(p => agentCaps.includes(p)).length;
  return matched / preferred.length;
}

// Score de disponibilidad
function availabilityScore(availability: string): number {
  switch (availability) {
    case 'available': return 1.0;
    case 'busy': return 0.5;
    case 'paused':
    case 'offline':
    default: return 0;
  }
}

// ── Selección por Capability Matching (SOLO LECTURA) ────────────────────────

export async function selectAgent(criteria: SelectionCriteria): Promise<SelectionResult[]> {
  const agentTypes: AgentType[] = criteria.agentTypes?.length ? criteria.agentTypes : ['permanent'];
  const maxResults = criteria.maxResults ?? 1;
  const requireReviewer = criteria.requireReviewer ?? false;

  // Placeholders para IN (SQLite no soporta arrays en IN directamente)
  const typePlaceholders = agentTypes.map(() => '?').join(',');
  const ventureClause = criteria.ventureId != null
    ? 'venture_id = ?'
    : 'venture_id IS NULL';
  const ventureParams = criteria.ventureId != null ? [criteria.ventureId] : [];

  // Filtrar candidatos elegibles (incluye agentes 'busy' para que availabilityScore los puntúe bajo)
  const candidates = await all<{
    id: number;
    role: string;
    capabilities: string;
    claimed_by_task: number | null;
    claim_expires_at: string | null;
    availability: string;
    venture_id: number | null;
    agent_type: string;
  }>(
    `SELECT id, role, capabilities, claimed_by_task, claim_expires_at, availability, venture_id, agent_type
     FROM agents
     WHERE ${ventureClause}
       AND agent_type IN (${typePlaceholders})
       AND status = 'idle'
       AND availability NOT IN ('offline', 'maintenance')
       AND (claimed_by_task IS NULL OR claim_expires_at < datetime('now'))
     ORDER BY id ASC`,
    [...ventureParams, ...agentTypes]
  );

  const exclude = new Set(criteria.excludeAgentIds ?? []);
  const required = criteria.requiredCapabilities ?? [];
  const preferred = criteria.preferredCapabilities ?? [];

  const scored = candidates
    .filter((c) => !exclude.has(c.id))
    .filter((c) => {
      const caps = parseCapabilities(c.capabilities);
      // HARD FILTER: todas las required deben estar presentes
      if (!hasAllRequired(caps, required)) return false;
      // requireReviewer: al menos una capability 'review.*'
      if (requireReviewer && !caps.some(cap => cap.startsWith('review.'))) return false;
      return true;
    })
    .map((c) => {
      const caps = parseCapabilities(c.capabilities);
      const reqCoverage = 1.0; // garantizado por hard filter
      const prefCoverage = preferredCoverage(caps, preferred);
      const availScore = availabilityScore(c.availability);

      const matchScore = reqCoverage * 0.50 + prefCoverage * 0.30 + availScore * 0.20;

      return {
        agentId: c.id,
        role: c.role,
        capabilities: caps,
        matchScore,
        availability: c.availability as 'available' | 'busy',
        ventureId: c.venture_id,
        agentType: c.agent_type as AgentType,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore || a.agentId - b.agentId);

  return scored.slice(0, maxResults);
}

// ── Provisioning: crea agente desde rol + override (separado de selección) ──

export async function provisionAgent(
  ventureId: number,
  roleKey: string,
  overrides?: AgentCapabilities
): Promise<ProvisionResult> {
  const def = await getRoleDefinition(roleKey);
  const baseCaps = def ? parseCapabilities(def.capabilities) : [];
  const mergedCaps = mergeCapabilities(baseCaps, overrides);

  const result = await createAgent({
    name: `${def?.label ?? roleKey} · v${ventureId}`,
    role: roleKey,
    venture_id: ventureId,
    capabilities: JSON.stringify(mergedCaps),
    agent_type: 'permanent',
    availability: 'available',
  });

  return { agentId: result.id, capabilities: mergedCaps };
}

// ── Claim / Release (atómicos, concurrency-safe) ──────────────────────────

export async function claimAgent(agentId: number, workItemId: number, ttlMinutes: number = 30): Promise<boolean> {
  const res = await run(
    `UPDATE agents
     SET claimed_by_task = ?, claim_expires_at = datetime('now', '+' || ? || ' minutes'), availability = 'busy'
     WHERE id = ?
       AND (claimed_by_task IS NULL OR claim_expires_at < datetime('now'))
       AND availability = 'available'`,
    [workItemId, ttlMinutes, agentId]
  );
  const won = res.changes === 1;
  if (won) {
    await recordAudit({ type: 'agent.claimed', meta: { agentId, workItemId, ttlMinutes } });
  }
  return won;
}

export async function releaseAgent(agentId: number, workItemId: number): Promise<void> {
  await run(
    `UPDATE agents
     SET claimed_by_task = NULL, claim_expires_at = NULL, availability = 'available'
     WHERE id = ? AND claimed_by_task = ?`,
    [agentId, workItemId]
  );
  await recordAudit({ type: 'agent.released', meta: { agentId, workItemId } });
}

// Limpia claims expirados de forma determinista (idempotente).
export async function cleanupExpiredClaims(): Promise<number> {
  const res = await run(
    `UPDATE agents
     SET claimed_by_task = NULL, claim_expires_at = NULL, availability = 'available'
     WHERE claimed_by_task IS NOT NULL AND claim_expires_at < datetime('now')`
  );
  if (res.changes > 0) {
    await recordAudit({ type: 'agent.claims.cleaned', meta: { count: res.changes } });
  }
  return res.changes;
}