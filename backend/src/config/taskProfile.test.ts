import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskProfile, DEFAULT_TASK_PROFILE } from './taskProfile.js';

// ═══ Tests de K.5 — guard determinista del TaskProfile (el LLM propone, el runtime sanea). ═══

test('K.5 profile · undefined/basura → defecto conservador (no rompe, no inventa)', () => {
  assert.deepEqual(validateTaskProfile(undefined), DEFAULT_TASK_PROFILE);
  assert.deepEqual(validateTaskProfile(null), DEFAULT_TASK_PROFILE);
  assert.deepEqual(
    validateTaskProfile({ kind: 'inventado', importance: 'ultra', complexity: 'x', risk: 'z' }),
    DEFAULT_TASK_PROFILE,
  );
});

test('K.5 profile · valores válidos del vocabulario se conservan', () => {
  const p = validateTaskProfile({ kind: 'research', complexity: 'high', importance: 'high', needs: { reasoning: true, tools: true }, risk: 'medium' });
  assert.equal(p.kind, 'research');
  assert.equal(p.complexity, 'high');
  assert.equal(p.importance, 'high');
  assert.equal(p.risk, 'medium');
  assert.deepEqual(p.needs, { reasoning: true, tools: true });
});

test('K.5 profile · GUARD: campos peligrosos del LLM se ignoran; needs solo cuenta true', () => {
  const p = validateTaskProfile({
    kind: 'content',
    needs: { tools: 'yes', reasoning: 1, creativity: true },   // 'yes'/1 NO cuentan; solo true
    tools: ['system.exec'], autonomy: 3, monthly_budget_usd: 9999, scope: 'system',  // peligrosos
  });
  assert.deepEqual(p.needs, { creativity: true });
  // El profile saneado NO contiene ningún campo peligroso — el LLM no puede inyectar permisos/presupuesto.
  assert.deepEqual(Object.keys(p).sort(), ['complexity', 'importance', 'kind', 'needs', 'risk']);
});
