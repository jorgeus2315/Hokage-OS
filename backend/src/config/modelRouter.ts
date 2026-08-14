// ═══════════════════════════════════════════════════════════════════════════
// modelRouter — selección determinista de modelo (Bloque 0, ADR-008/ADR-010).
// ═══════════════════════════════════════════════════════════════════════════
//
// ADITIVO y NO cableado: aiService.ts sigue eligiendo el modelo por rol como antes. El cableado
// (Hokage emite TaskProfile, askAgent llama a selectModel) es K.5. Aquí: funciones puras + tests.
//
// Patrón: el LLM propone (TaskProfile), este código DECIDE (modelo) — igual que validatePlan.
// Regla: elegir el modelo MÁS BARATO por encima del SUELO de calidad requerido; el ahorro nunca
// cruza el suelo. El ModelRouter es solo UNA etapa de la cadena de orquestación (ADR-009).

import { MODEL_CATALOG, TIER_RANK, type ModelDescriptor, type ModelTier } from './modelCatalog.js';
import type { TaskProfile, TaskKind, TaskImportance, TaskComplexity, TaskNeeds } from '../types/index.js';

// Suelo de calidad (kind × importance → tier mínimo). DATO afinable HACIA ARRIBA; el mínimo de
// sistema por categoría es invariante (ADR-010): p.ej. content nunca < A, strategy nunca < S.
const QUALITY_FLOOR: Record<TaskKind, Record<TaskImportance, ModelTier>> = {
  classify:     { low: 'B', medium: 'B', high: 'A', critical: 'A' },
  bulk:         { low: 'B', medium: 'B', high: 'A', critical: 'A' },
  research:     { low: 'B', medium: 'A', high: 'S', critical: 'S' },
  content:      { low: 'A', medium: 'A', high: 'S', critical: 'S' },
  strategy:     { low: 'S', medium: 'S', high: 'S', critical: 'S' },
  analysis:     { low: 'B', medium: 'A', high: 'S', critical: 'S' },
  review:       { low: 'A', medium: 'S', high: 'S', critical: 'S' },
  code:         { low: 'A', medium: 'A', high: 'S', critical: 'S' },
  design:       { low: 'A', medium: 'A', high: 'S', critical: 'S' },
  conversation: { low: 'A', medium: 'A', high: 'S', critical: 'S' },
};

// Categorías cuya salida CRÍTICA exige revisión por un 2º modelo (ADR-010 §F).
const REVIEW_KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>(['content', 'strategy', 'design']);

export function qualityFloor(kind: TaskKind, importance: TaskImportance): ModelTier {
  return QUALITY_FLOOR[kind][importance];
}

function tierByComplexity(c: TaskComplexity): ModelTier {
  return c === 'high' ? 'S' : c === 'medium' ? 'A' : 'B';
}

function tierByNeeds(needs: TaskNeeds): ModelTier {
  return needs.reasoning || needs.creativity ? 'A' : 'B';
}

function maxTier(...tiers: ModelTier[]): ModelTier {
  return tiers.reduce((a, b) => (TIER_RANK[b] > TIER_RANK[a] ? b : a), 'B' as ModelTier);
}

export function needsReview(p: TaskProfile): boolean {
  return p.risk === 'high' || (p.importance === 'critical' && REVIEW_KINDS.has(p.kind));
}

export interface ModelSelection {
  model: ModelDescriptor;
  requiredTier: ModelTier;
  review: boolean;
}

export interface SelectOptions {
  estimatedContextTokens?: number;
  catalog?: readonly ModelDescriptor[];
}

const cheapest = (arr: ModelDescriptor[]): ModelDescriptor =>
  [...arr].sort((a, b) => {
    const pa = a.price.in + a.price.out;
    const pb = b.price.in + b.price.out;
    return pa !== pb ? pa - pb : TIER_RANK[a.tier] - TIER_RANK[b.tier];
  })[0];

// Elige el modelo más barato por encima del suelo requerido, respetando tools y contexto.
export function selectModel(profile: TaskProfile, opts: SelectOptions = {}): ModelSelection {
  const catalog = (opts.catalog ?? MODEL_CATALOG).filter((m) => m.status === 'ready');
  const requiredTier = maxTier(
    qualityFloor(profile.kind, profile.importance),
    tierByComplexity(profile.complexity),
    tierByNeeds(profile.needs),
  );
  const minRank = TIER_RANK[requiredTier];
  const ctxNeeded = opts.estimatedContextTokens ?? 0;
  const meets = (m: ModelDescriptor) =>
    (!profile.needs.tools || m.supportsTools) && m.contextWindow >= ctxNeeded;

  const eligible = catalog.filter((m) => TIER_RANK[m.tier] >= minRank && meets(m));
  if (eligible.length > 0) {
    return { model: cheapest(eligible), requiredTier, review: needsReview(profile) };
  }

  // Fallback defensivo (no ocurre con el catálogo actual): nada cumple el suelo + restricciones
  // → mejor esfuerzo = el tier más alto que cumpla tools/contexto. Nunca baja el suelo a propósito.
  const fallback = [...catalog.filter(meets)].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])[0];
  if (!fallback) throw new Error('modelRouter: ningún modelo satisface tools/contexto');
  return { model: fallback, requiredTier, review: needsReview(profile) };
}
