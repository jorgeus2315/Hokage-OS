import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_CATALOG, getModel, TIER_RANK } from './modelCatalog.js';
import { AGENT_MODELS, DEFAULT_MODEL, modelSupportsTools } from './agentModels.js';
import { OpenRouterProvider } from '../services/aiProvider.js';

// ═══ Tests del Bloque 0 (K.1) — catálogo + proveedor. ═══
// Prueba de NO DRIFT: el catálogo cubre y coincide con la config de modelos ACTUAL, de modo que
// cablearlo después (K.5) no cambie el comportamiento. K.1-K.3 son puramente aditivos.

test('B0 catálogo · cada modelo usado hoy (AGENT_MODELS + DEFAULT) existe en el catálogo', () => {
  for (const model of Object.values(AGENT_MODELS)) {
    assert.ok(getModel(model), `modelo en uso ausente del catálogo: ${model}`);
  }
  assert.ok(getModel(DEFAULT_MODEL), `DEFAULT_MODEL ausente del catálogo: ${DEFAULT_MODEL}`);
});

test('B0 catálogo · supportsTools coincide con modelSupportsTools (sin drift de capacidad)', () => {
  for (const m of MODEL_CATALOG) {
    assert.equal(m.supportsTools, modelSupportsTools(m.id), `supportsTools no coincide para ${m.id}`);
  }
});

test('B0 catálogo · entradas bien formadas (tier, precio, contexto)', () => {
  for (const m of MODEL_CATALOG) {
    assert.ok(m.tier in TIER_RANK, `tier inválido: ${m.id}`);
    assert.ok(m.price.in >= 0 && m.price.out >= 0, `precio inválido: ${m.id}`);
    assert.ok(m.contextWindow > 0, `contextWindow inválido: ${m.id}`);
    assert.equal(m.status, 'ready');
  }
});

test('B0 proveedor · OpenRouterProvider expone su catálogo', () => {
  const p = new OpenRouterProvider();
  assert.equal(p.id, 'openrouter');
  const models = p.listModels();
  assert.ok(models.length > 0);
  assert.ok(models.every((m) => m.provider === 'openrouter'));
});
