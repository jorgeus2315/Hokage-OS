import type { EvidenceKind, ValidationStatus } from '../types/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// f11Policy — reglas DETERMINISTAS de F11 (código, no LLM). El LLM propone datos;
// aquí se decide. Ningún campo de autoridad (approved/autonomy/tools/budget/can_create)
// se lee jamás de una salida LLM. PURO: testeable sin BD ni red.
// ═══════════════════════════════════════════════════════════════════════════

// Tope DURO del presupuesto inicial de una venture creada desde una propuesta. El LLM no puede
// superarlo — lo aplica el código. Distinto del límite por-rol de 20/mes (F7).
export const MAX_VENTURE_BUDGET_USD = 50;

// Umbrales de validación (en código, no inventados por el modelo).
export const MIN_EVIDENCE = 4;
export const MIN_FACTS = 1;
export const MIN_AVG_CONFIDENCE = 40; // 0..100

const VALID_KINDS: readonly EvidenceKind[] = ['fact', 'inference', 'hypothesis', 'unknown'];

export interface CleanEvidence {
  kind: EvidenceKind;
  claim: string;
  source: string | null;
  confidence: number;
}

// Sanea UNA fila de evidencia propuesta por el LLM. Reglas (§8):
//  - kind debe ser uno de los 4; si no → descartada (null).
//  - claim no vacío; si no → descartada.
//  - 'fact' SIN fuente verificable se DEGRADA a 'inference' (una respuesta LLM no es un hecho).
//  - confidence se recorta a 0..100.
export function sanitizeEvidenceRow(raw: unknown): CleanEvidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kindRaw = typeof r.kind === 'string' ? r.kind.trim().toLowerCase() : '';
  if (!VALID_KINDS.includes(kindRaw as EvidenceKind)) return null;
  const claim = typeof r.claim === 'string' ? r.claim.trim() : '';
  if (!claim) return null;
  const sourceRaw = typeof r.source === 'string' ? r.source.trim() : '';
  const source = sourceRaw || null;
  let kind = kindRaw as EvidenceKind;
  if (kind === 'fact' && !source) kind = 'inference'; // hecho sin fuente → inferencia
  const confNum = typeof r.confidence === 'number' ? r.confidence : Number(r.confidence);
  const confidence = Number.isFinite(confNum) ? Math.max(0, Math.min(100, Math.round(confNum))) : 0;
  return { kind, claim: claim.slice(0, 1000), source: source ? source.slice(0, 500) : null, confidence };
}

export interface EvidenceCounts {
  total: number;
  facts: number;
  contradictions: number; // evidencias con conflicts_with != null
  avgConfidence: number;  // 0..100
}
// Señales del juez LLM — DATO, no autoridad. Solo se leen estos campos.
export interface JudgeSignals {
  complete: boolean;
  evidenceSufficient: boolean;
  sourcesOk: boolean;
  recommendation: 'validated' | 'insufficient' | 'rejected' | 'review' | string;
}

// Decisión DETERMINISTA de validación. El juez nunca fija 'validated' por sí solo: solo cuando
// las señales CONTADAS (evidencia real) Y el juez coinciden. Detecta también "resultado
// insuficiente" (§11): vacío/incompleto/schema inválido/sin evidencia/contradicciones.
export function evaluateValidation(counts: EvidenceCounts, judge: JudgeSignals | null): ValidationStatus {
  if (!judge || judge.complete === false) return 'insufficient_evidence';   // vacío / no completado / schema inválido
  if (counts.total < MIN_EVIDENCE) return 'insufficient_evidence';
  if (counts.facts < MIN_FACTS) return 'insufficient_evidence';
  if (counts.contradictions > 0) return 'needs_human_review';               // contradicción sin resolver → humano (§9)
  if (judge.recommendation === 'rejected') return 'rejected';
  if (counts.avgConfidence >= MIN_AVG_CONFIDENCE && judge.evidenceSufficient && judge.recommendation === 'validated') {
    return 'validated';
  }
  return 'needs_human_review'; // conservador por defecto
}

// Extrae solo las señales permitidas del output crudo del juez (ignora cualquier otro campo,
// p. ej. un 'validated:true' o 'approved' que el LLM intente colar).
export function readJudgeSignals(raw: unknown): JudgeSignals | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    complete: r.complete === true,
    evidenceSufficient: r.evidence_sufficient === true || r.evidenceSufficient === true,
    sourcesOk: r.sources_ok === true || r.sourcesOk === true,
    recommendation: typeof r.recommendation === 'string' ? r.recommendation.trim().toLowerCase() : 'review',
  };
}

// Capa el presupuesto propuesto al rango permitido por CÓDIGO. El LLM no elige libremente.
export function capBudget(proposed: unknown): number {
  const n = typeof proposed === 'number' ? proposed : Number(proposed);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_VENTURE_BUDGET_USD);
}

export interface CleanProposal {
  content: Record<string, unknown>;
  proposedBudget: number;
  name: string;
  type: string;
}
const VALID_VENTURE_TYPES = new Set(['store', 'saas', 'content', 'fund', 'agency', 'community', 'other']);

// Sanea la propuesta de monetización del LLM. Presupuesto capado; nombre requerido; SOLO se leen
// campos de contenido (nunca approved/budget-as-authority/etc.). Devuelve null si no hay nombre.
export function sanitizeProposal(raw: unknown): CleanProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.proposed_name === 'string' ? r.proposed_name.trim()
    : typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) return null;
  const typeRaw = (typeof r.proposed_type === 'string' ? r.proposed_type : typeof r.type === 'string' ? r.type : 'other').trim().toLowerCase();
  const type = VALID_VENTURE_TYPES.has(typeRaw) ? typeRaw : 'other';
  const budgetRaw = r.proposed_budget_usd ?? r.budget ?? r.proposed_budget;
  // El contenido estructurado (customer/problem/value/... §13). Solo campos de datos, sin autoridad.
  const AUTHORITY = new Set(['approved', 'human_approved', 'can_create', 'can_execute', 'is_admin', 'is_system', 'autonomy', 'tools', 'scope', 'budget', 'proposed_budget_usd']);
  const content: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (AUTHORITY.has(k)) continue; // nunca se conserva un campo de autoridad
    if (typeof v === 'string') content[k] = v.slice(0, 2000);
    else if (typeof v === 'number' || typeof v === 'boolean' || v == null) content[k] = v;
    else if (Array.isArray(v)) content[k] = v.slice(0, 20);
    else content[k] = '[omitido]';
  }
  return { content, proposedBudget: capBudget(budgetRaw), name: name.slice(0, 120), type };
}
