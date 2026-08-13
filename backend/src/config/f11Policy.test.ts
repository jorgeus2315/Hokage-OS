import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeEvidenceRow, evaluateValidation, readJudgeSignals, capBudget, sanitizeProposal,
  MAX_VENTURE_BUDGET_USD, MIN_EVIDENCE, type EvidenceCounts, type JudgeSignals,
} from './f11Policy.js';

// ═══ Tests PUROS de F11 — reglas deterministas. El LLM propone; estas reglas deciden. ═══

test('evidencia: fact con fuente se acepta; fact SIN fuente se degrada a inference', () => {
  assert.equal(sanitizeEvidenceRow({ kind: 'fact', claim: 'x', source: 'https://a.com', confidence: 80 })?.kind, 'fact');
  const degraded = sanitizeEvidenceRow({ kind: 'fact', claim: 'x', source: '', confidence: 80 });
  assert.equal(degraded?.kind, 'inference'); // una respuesta LLM sin fuente NO es un hecho
});

test('evidencia: kind inválido o claim vacío → descartada', () => {
  assert.equal(sanitizeEvidenceRow({ kind: 'rumor', claim: 'x' }), null);
  assert.equal(sanitizeEvidenceRow({ kind: 'fact', claim: '' }), null);
  assert.equal(sanitizeEvidenceRow(null), null);
});

test('evidencia: confidence se recorta a 0..100', () => {
  assert.equal(sanitizeEvidenceRow({ kind: 'inference', claim: 'x', confidence: 999 })?.confidence, 100);
  assert.equal(sanitizeEvidenceRow({ kind: 'inference', claim: 'x', confidence: -5 })?.confidence, 0);
});

const okCounts: EvidenceCounts = { total: 6, facts: 2, contradictions: 0, avgConfidence: 70 };
const okJudge: JudgeSignals = { complete: true, evidenceSufficient: true, sourcesOk: true, recommendation: 'validated' };

test('validación: validated solo si evidencia contada Y juez coinciden', () => {
  assert.equal(evaluateValidation(okCounts, okJudge), 'validated');
});

test('validación: el juez NO puede forzar validated por sí solo', () => {
  // juez dice validated pero la confianza media es baja → needs_human_review
  assert.equal(evaluateValidation({ ...okCounts, avgConfidence: 20 }, okJudge), 'needs_human_review');
  // confianza alta pero el juez no recomienda validated → needs_human_review
  assert.equal(evaluateValidation(okCounts, { ...okJudge, recommendation: 'review' }), 'needs_human_review');
});

test('validación: insuficiente por evidencia escasa / juez incompleto', () => {
  assert.equal(evaluateValidation({ total: 2, facts: 0, contradictions: 0, avgConfidence: 90 }, okJudge), 'insufficient_evidence');
  assert.equal(evaluateValidation({ ...okCounts, facts: 0 }, okJudge), 'insufficient_evidence');
  assert.equal(evaluateValidation(okCounts, { ...okJudge, complete: false }), 'insufficient_evidence');
  assert.equal(evaluateValidation(okCounts, null), 'insufficient_evidence');
});

test('validación: contradicciones → needs_human_review (no se ocultan)', () => {
  assert.equal(evaluateValidation({ ...okCounts, contradictions: 1 }, okJudge), 'needs_human_review');
});

test('validación: juez rejected → rejected', () => {
  assert.equal(evaluateValidation(okCounts, { ...okJudge, recommendation: 'rejected' }), 'rejected');
});

test('readJudgeSignals: ignora campos de autoridad colados por el LLM', () => {
  const s = readJudgeSignals({ complete: true, evidence_sufficient: true, recommendation: 'validated', validated: true, approved: true, can_create: true });
  assert.equal(s?.complete, true);
  assert.equal((s as unknown as Record<string, unknown>).validated, undefined);
  assert.equal((s as unknown as Record<string, unknown>).approved, undefined);
});

test('capBudget: el código aplica el tope; el LLM no puede superarlo', () => {
  assert.equal(capBudget(9999), MAX_VENTURE_BUDGET_USD);
  assert.equal(capBudget(-10), 0);
  assert.equal(capBudget('mucho'), 0);
  assert.equal(capBudget(25), 25);
});

test('sanitizeProposal: capa presupuesto, exige nombre y ELIMINA campos de autoridad', () => {
  const p = sanitizeProposal({
    proposed_name: 'Gatos Minimal', proposed_type: 'store', target_customer: 'amantes de gatos',
    proposed_budget_usd: 1000000, approved: true, human_approved: true, can_create: true, autonomy: 3, tools: ['system.exec'], is_admin: true,
  });
  assert.ok(p);
  assert.equal(p!.name, 'Gatos Minimal');
  assert.equal(p!.type, 'store');
  assert.equal(p!.proposedBudget, MAX_VENTURE_BUDGET_USD); // capado
  assert.equal(p!.content.approved, undefined);
  assert.equal(p!.content.can_create, undefined);
  assert.equal(p!.content.autonomy, undefined);
  assert.equal(p!.content.tools, undefined);
  assert.equal(p!.content.is_admin, undefined);
  assert.equal(p!.content.target_customer, 'amantes de gatos'); // dato de contenido sí se conserva
});

test('sanitizeProposal: sin nombre → null', () => {
  assert.equal(sanitizeProposal({ target_customer: 'x' }), null);
});
