import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectModel, qualityFloor, needsReview } from './modelRouter.js';
import type { TaskProfile } from '../types/index.js';

// ═══ Tests del Bloque 0 (K.3) — ModelRouter determinista. ═══
// Función pura, verificable en aislado; NO cableada al runtime (aiService sin cambios).

const base = (over: Partial<TaskProfile> = {}): TaskProfile => ({
  kind: 'content', complexity: 'medium', importance: 'medium', needs: {}, risk: 'low', ...over,
});

test('B0 router · suelo de calidad por categoría', () => {
  assert.equal(qualityFloor('strategy', 'low'), 'S');       // estrategia nunca < S
  assert.equal(qualityFloor('classify', 'low'), 'B');
  assert.equal(qualityFloor('content', 'high'), 'S');
  assert.equal(qualityFloor('content', 'low'), 'A');        // cara al cliente nunca < A
});

test('B0 router · tarea trivial usa el tier B más barato', () => {
  const s = selectModel(base({ kind: 'classify', complexity: 'low', importance: 'low' }));
  assert.equal(s.model.tier, 'B');
  assert.equal(s.model.id, 'meta-llama/llama-3.1-8b-instruct');
});

test('B0 router · si necesita tools, excluye modelos sin tools', () => {
  const s = selectModel(base({ kind: 'classify', complexity: 'low', importance: 'low', needs: { tools: true } }));
  assert.ok(s.model.supportsTools);
  assert.equal(s.model.id, 'google/gemini-flash-1.5');      // B con tools más barato
});

test('B0 router · estrategia va a tier S (sonnet)', () => {
  const s = selectModel(base({ kind: 'strategy', complexity: 'medium', importance: 'medium' }));
  assert.equal(s.requiredTier, 'S');
  assert.equal(s.model.id, 'anthropic/claude-sonnet-4.5');
});

test('B0 router · investigación media usa el A más barato', () => {
  const s = selectModel(base({ kind: 'research', complexity: 'medium', importance: 'medium' }));
  assert.equal(s.requiredTier, 'A');
  assert.equal(s.model.id, 'google/gemini-2.5-flash');
});

test('B0 router · el ahorro NUNCA cruza el suelo de calidad', () => {
  const s = selectModel(base({ kind: 'content', complexity: 'low', importance: 'low' }));
  assert.notEqual(s.model.tier, 'B');                        // content nunca cae a B
});

test('B0 router · needs.reasoning sube el suelo a >= A', () => {
  const s = selectModel(base({ kind: 'analysis', complexity: 'low', importance: 'low', needs: { reasoning: true } }));
  assert.notEqual(s.model.tier, 'B');
});

test('B0 router · lo crítico marca revisión por 2º modelo', () => {
  assert.equal(needsReview(base({ kind: 'content', importance: 'critical' })), true);
  assert.equal(needsReview(base({ kind: 'strategy', importance: 'critical' })), true);
  assert.equal(needsReview(base({ kind: 'classify', importance: 'critical' })), false);
  assert.equal(needsReview(base({ risk: 'high' })), true);
});

test('B0 router · contexto grande excluye modelos de ventana insuficiente', () => {
  // llama (131k) queda fuera si se piden 200k; el más barato con ≥200k y sin floor alto:
  const s = selectModel(base({ kind: 'bulk', complexity: 'low', importance: 'low' }), { estimatedContextTokens: 200_001 });
  assert.ok(s.model.contextWindow >= 200_001);
  assert.notEqual(s.model.id, 'meta-llama/llama-3.1-8b-instruct');
});
