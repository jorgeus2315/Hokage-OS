import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get, all } from '../db/init.js';
import type { AgentCapability, AgentCapabilities } from '../types/index.js';
import {
  selectAgent,
  claimAgent,
  releaseAgent,
  cleanupExpiredClaims,
  provisionAgent,
  parseCapabilities,
  mergeCapabilities,
} from './agentSelector.js';

// ═══ Tests ADR-011 (diseño corregido): Agent Registry & Capability-based Selection ═══
// Cubre: parseCapabilities / mergeCapabilities (vocabulario atómico),
// selectAgent (hard filter requiredCapabilities, scoring, maxResults, agentTypes,
//   requireReviewer, exclusiones, claim/expiración),
// claimAgent/releaseAgent (atómicos, concurrencia, expiración, idempotencia),
// provisionAgent (creación explícita desde rol + override),
// cleanupExpiredClaims,
// migración idempotente (columnas, defaults, normalización a array).

let ventureId: number;

before(async () => {
  // El script de test ya limpia el fichero DB (rm -f test-fase5.db) — initSchema crea todo
  await initSchema();

  const v = await get<{ id: number }>(`SELECT id FROM ventures WHERE name = 'Minimal Designs'`);
  ventureId = v!.id;

  // Agentes de test con capabilities atómicas conocidas (formato array).
  await run(`INSERT OR IGNORE INTO agents (name, role, status, model, venture_id, capabilities, agent_type, availability)
             VALUES ('Investigador Seed', 'investigador', 'idle', 'google/gemini-flash-1.5', ?, '["research.web","research.trends","analysis.data","analysis.competitive"]', 'permanent', 'available')`, [ventureId]);
  await run(`INSERT OR IGNORE INTO agents (name, role, status, model, venture_id, capabilities, agent_type, availability)
             VALUES ('Escritor Seed', 'contenido', 'idle', 'anthropic/claude-haiku-4.5', ?, '["content.seo","content.social","strategy.marketing"]', 'permanent', 'available')`, [ventureId]);
});

// ═══ parseCapabilities ═══

test('ADR-011 parseCapabilities: array válido → AgentCapabilities filtrado por vocabulario', () => {
  const caps = parseCapabilities('["research.web","content.seo"]');
  assert.deepEqual(caps, ['research.web', 'content.seo']);
});

test('ADR-011 parseCapabilities: items fuera de vocabulario se descartan', () => {
  const caps = parseCapabilities('["research.web","tool.inexistente","content.seo"]');
  assert.deepEqual(caps, ['research.web', 'content.seo']);
});

test('ADR-011 parseCapabilities: JSON inválido → []', () => {
  assert.deepEqual(parseCapabilities('no-es-json'), []);
});

test('ADR-011 parseCapabilities: null/undefined/"" → []', () => {
  assert.deepEqual(parseCapabilities(null), []);
  assert.deepEqual(parseCapabilities(undefined), []);
  assert.deepEqual(parseCapabilities(''), []);
});

test('ADR-011 parseCapabilities: "[]" → []', () => {
  assert.deepEqual(parseCapabilities('[]'), []);
});

test('ADR-011 parseCapabilities: objeto (no array) → [] (no rompe)', () => {
  assert.deepEqual(parseCapabilities('{"tools":["x"]}'), []);
});

// ═══ mergeCapabilities ═══

test('ADR-011 mergeCapabilities: union sin duplicados, solo válidas', () => {
  const base: AgentCapabilities = ['research.web', 'analysis.data'];
  const merged = mergeCapabilities(base, ['analysis.data', 'content.seo']);
  assert.deepEqual(merged.sort(), ['analysis.data', 'content.seo', 'research.web']);
});

test('ADR-011 mergeCapabilities: override undefined → base intacto', () => {
  const base: AgentCapabilities = ['research.web'];
  assert.deepEqual(mergeCapabilities(base, undefined), base);
  assert.deepEqual(mergeCapabilities(base, []), base);
});

// ═══ selectAgent ═══

test('ADR-011 selectAgent: HARD FILTER excluye agente sin todas las required', async () => {
  // Investigador Seed NO tiene content.seo → no debería ser seleccionado para esa required
  const res = await selectAgent({
    ventureId,
    requiredCapabilities: ['content.seo'],
  });
  assert.ok(res.length >= 0);
  for (const r of res) {
    const caps = parseCapabilities((await get<{ capabilities: string }>(`SELECT capabilities FROM agents WHERE id = ?`, [r.agentId]))!.capabilities);
    assert.ok(caps.includes('content.seo'));
  }
});

test('ADR-011 selectAgent: matching exacto required → score 0.7 (req=1.0, pref=0, avail=1.0)', async () => {
  const res = await selectAgent({
    ventureId,
    requiredCapabilities: ['research.web', 'research.trends', 'analysis.data', 'analysis.competitive'],
  });
  assert.ok(res.length >= 1);
  const top = res[0];
  const expectedId = (await get<{ id: number }>(`SELECT id FROM agents WHERE name = 'Investigador Seed'`))!.id;
  assert.equal(top.agentId, expectedId);
  // reqCoverage=1.0*0.5 + pref=0*0.3 + avail=1.0*0.2 = 0.7
  assert.ok(Math.abs(top.matchScore - 0.7) < 1e-9, `score esperado 0.7, got ${top.matchScore}`);
});

test('ADR-011 selectAgent: preferredCoverage eleva score', async () => {
  // Ambos candidatos cumplen required=['content.seo']; Escritor tiene strategy.marketing (preferred)
  const res = await selectAgent({
    ventureId,
    requiredCapabilities: ['content.seo'],
    preferredCapabilities: ['strategy.marketing', 'content.social'],
  });
  assert.ok(res.length >= 1);
  const escritor = await get<{ id: number }>(`SELECT id FROM agents WHERE name = 'Escritor Seed'`);
  // Escritor: req=1.0 (0.5) + pref=2/2=1.0 (0.3) + avail=1.0 (0.2) = 1.0
  const top = res[0];
  assert.equal(top.agentId, escritor!.id);
  assert.ok(Math.abs(top.matchScore - 1.0) < 1e-9, `score esperado 1.0, got ${top.matchScore}`);
});

test('ADR-011 selectAgent: availability afecta score (busy=0.5)', async () => {
  const busy = await get<{ id: number }>(`SELECT id FROM agents WHERE name = 'Escritor Seed'`);
  await run(`UPDATE agents SET availability = 'busy' WHERE id = ?`, [busy!.id]);

  const res = await selectAgent({
    ventureId,
    requiredCapabilities: ['content.seo'],
  });
  const found = res.find((r) => r.agentId === busy!.id);
  assert.ok(found);
  // req=1.0*0.5 + pref=0*0.3 + avail=0.5*0.2 = 0.6
  assert.ok(Math.abs(found!.matchScore - 0.6) < 1e-9, `score esperado 0.6, got ${found!.matchScore}`);

  // restaurar
  await run(`UPDATE agents SET availability = 'available' WHERE id = ?`, [busy!.id]);
});

test('ADR-011 selectAgent: maxResults limita la salida', async () => {
  const res = await selectAgent({
    ventureId,
    requiredCapabilities: [],
    maxResults: 1,
  });
  assert.ok(res.length <= 1);
});

test('ADR-011 selectAgent: agentTypes filtra por tipo', async () => {
  const res = await selectAgent({
    ventureId,
    requiredCapabilities: ['research.web'],
    agentTypes: ['reviewer'],
  });
  assert.equal(res.length, 0);
});

test('ADR-011 selectAgent: requireReviewer exige capability review.*', async () => {
  // Ningún agente seed tiene review.* → con requireReviewer debe quedar vacío
  const res = await selectAgent({
    ventureId,
    requiredCapabilities: [],
    requireReviewer: true,
  });
  assert.equal(res.length, 0);

  // Crear agente con review.quality
  const r = await run(`INSERT INTO agents (name, role, status, model, venture_id, capabilities, agent_type, availability)
    VALUES ('Revisor', 'finanzas', 'idle', 'google/gemini-flash-1.5', ?, '["review.quality","analysis.financial"]', 'permanent', 'available')`, [ventureId]);
  const res2 = await selectAgent({
    ventureId,
    requiredCapabilities: [],
    requireReviewer: true,
  });
  assert.ok(res2.some((x) => x.agentId === r.lastID));
});

test('ADR-011 selectAgent: excludeAgentIds excluye', async () => {
  const agents = await all<{ id: number }>(`SELECT id FROM agents WHERE venture_id = ? AND agent_type = 'permanent'`, [ventureId]);
  assert.ok(agents.length >= 2);
  const firstId = agents[0].id;

  const res = await selectAgent({
    ventureId,
    requiredCapabilities: [],
    excludeAgentIds: [firstId],
    maxResults: 10,
  });
  assert.ok(res.length >= 1);
  assert.ok(!res.some((r) => r.agentId === firstId));
});

test('ADR-011 selectAgent: claim expirado → agente elegible de nuevo', async () => {
  const expired = await get<{ id: number }>(`SELECT id FROM agents WHERE name = 'Escritor Seed'`);
  await run(`UPDATE agents SET availability = 'busy', claimed_by_task = 888, claim_expires_at = datetime('now', '-1 hour') WHERE id = ?`, [expired!.id]);

  await cleanupExpiredClaims();

  const res = await selectAgent({
    ventureId,
    requiredCapabilities: ['content.seo'],
  });
  assert.ok(res.some((r) => r.agentId === expired!.id));
});

test('ADR-011 selectAgent: agente claimed activo / busy → no elegible', async () => {
  const busy = await get<{ id: number }>(`SELECT id FROM agents WHERE name = 'Investigador Seed'`);
  await run(`UPDATE agents SET availability = 'busy', claimed_by_task = 999, claim_expires_at = datetime('now', '+1 hour') WHERE id = ?`, [busy!.id]);

  const res = await selectAgent({
    ventureId,
    requiredCapabilities: ['research.web'],
  });
  assert.ok(!res.some((r) => r.agentId === busy!.id));

  // restaurar
  await run(`UPDATE agents SET availability = 'available', claimed_by_task = NULL, claim_expires_at = NULL WHERE id = ?`, [busy!.id]);
});

test('ADR-011 selectAgent: ventureId undefined selecciona agents globales', async () => {
  await run(`INSERT INTO agents (name, role, status, model, venture_id, capabilities, agent_type, availability)
    VALUES ('Global Agent', 'finanzas', 'idle', 'google/gemini-flash-1.5', NULL, '["analysis.financial"]', 'permanent', 'available')`);

  const res = await selectAgent({
    requiredCapabilities: ['analysis.financial'],
  });
  const global = await get<{ id: number }>(`SELECT id FROM agents WHERE name = 'Global Agent'`);
  assert.ok(res.some((r) => r.agentId === global!.id));
});

// ═══ claimAgent / releaseAgent (atómicos, concurrencia) ═══

async function createAvailableAgent(caps: AgentCapabilities = ['research.web']): Promise<number> {
  const res = await run(`INSERT INTO agents (name, role, status, model, venture_id, capabilities, agent_type, availability)
             VALUES ('Test Agent', 'investigador', 'idle', 'google/gemini-flash-1.5', ?, ?, 'permanent', 'available')`,
    [ventureId, JSON.stringify(caps)]);
  return res.lastID;
}

test('ADR-011 claimAgent: claim exitoso → true, agente marcado busy', async () => {
  const agentId = await createAvailableAgent();
  const won = await claimAgent(agentId, 42, 30);
  assert.equal(won, true);

  const row = await get<{ availability: string; claimed_by_task: number; claim_expires_at: string }>(`SELECT availability, claimed_by_task, claim_expires_at FROM agents WHERE id = ?`, [agentId]);
  assert.equal(row!.availability, 'busy');
  assert.equal(row!.claimed_by_task, 42);
  assert.ok(row!.claim_expires_at);
});

test('ADR-011 claimAgent: claim ya tomado por OTRO workItem → false (pierde carrera)', async () => {
  const agentId = await createAvailableAgent();
  const won1 = await claimAgent(agentId, 100, 30);
  assert.equal(won1, true);
  const won2 = await claimAgent(agentId, 200, 30);
  assert.equal(won2, false);

  const row = await get<{ claimed_by_task: number }>(`SELECT claimed_by_task FROM agents WHERE id = ?`, [agentId]);
  assert.equal(row!.claimed_by_task, 100);
});

test('ADR-011 claimAgent: claim con claim EXPIRADO → true (lo roba) tras cleanup', async () => {
  const agentId = await createAvailableAgent();
  await run(`UPDATE agents SET availability = 'busy', claimed_by_task = 999, claim_expires_at = datetime('now', '-1 hour') WHERE id = ?`, [agentId]);

  await cleanupExpiredClaims();
  const won = await claimAgent(agentId, 300, 30);
  assert.equal(won, true);

  const row = await get<{ claimed_by_task: number }>(`SELECT claimed_by_task FROM agents WHERE id = ?`, [agentId]);
  assert.equal(row!.claimed_by_task, 300);
});

test('ADR-011 releaseAgent: libera solo si workItemId coincide', async () => {
  const agentId = await createAvailableAgent();
  await claimAgent(agentId, 400, 30);
  await releaseAgent(agentId, 999); // incorrecto

  let row = await get<{ availability: string; claimed_by_task: number | null }>(`SELECT availability, claimed_by_task FROM agents WHERE id = ?`, [agentId]);
  assert.equal(row!.availability, 'busy');
  assert.equal(row!.claimed_by_task, 400);

  await releaseAgent(agentId, 400); // correcto
  row = await get<{ availability: string; claimed_by_task: number | null }>(`SELECT availability, claimed_by_task FROM agents WHERE id = ?`, [agentId]);
  assert.equal(row!.availability, 'available');
  assert.equal(row!.claimed_by_task, null);
});

test('ADR-011 releaseAgent: idempotente (release doble no rompe)', async () => {
  const agentId = await createAvailableAgent();
  await claimAgent(agentId, 500, 30);
  await releaseAgent(agentId, 500);
  await releaseAgent(agentId, 500);

  const row = await get<{ availability: string; claimed_by_task: number | null }>(`SELECT availability, claimed_by_task FROM agents WHERE id = ?`, [agentId]);
  assert.equal(row!.availability, 'available');
  assert.equal(row!.claimed_by_task, null);
});

// ═══ cleanupExpiredClaims ═══

test('ADR-011 cleanupExpiredClaims: limpia claims expirados y devuelve count', async () => {
  const agentId = await createAvailableAgent();
  await run(`UPDATE agents SET availability = 'busy', claimed_by_task = 777, claim_expires_at = datetime('now', '-1 hour') WHERE id = ?`, [agentId]);

  const cleaned = await cleanupExpiredClaims();
  assert.ok(cleaned >= 1);

  const row = await get<{ availability: string; claimed_by_task: number | null }>(`SELECT availability, claimed_by_task FROM agents WHERE id = ?`, [agentId]);
  assert.equal(row!.availability, 'available');
  assert.equal(row!.claimed_by_task, null);
});

test('ADR-011 cleanupExpiredClaims: idempotente (ejecutar dos veces)', async () => {
  const c1 = await cleanupExpiredClaims();
  const c2 = await cleanupExpiredClaims();
  assert.equal(c2, 0);
});

// ═══ provisionAgent ═══

test('ADR-011 provisionAgent: crea agente con capabilities del rol', async () => {
  const res = await provisionAgent(ventureId, 'investigador');
  assert.ok(res.agentId > 0);

  const agent = await get<{ venture_id: number; agent_type: string; availability: string; capabilities: string }>(`SELECT venture_id, agent_type, availability, capabilities FROM agents WHERE id = ?`, [res.agentId]);
  assert.equal(agent!.venture_id, ventureId);
  assert.equal(agent!.agent_type, 'permanent');
  assert.equal(agent!.availability, 'available');

  const caps = parseCapabilities(agent!.capabilities);
  assert.ok(caps.includes('research.web')); // del rol investigador
  assert.deepEqual(caps.sort(), res.capabilities.sort());
});

test('ADR-011 provisionAgent: override hace merge con capabilities del rol', async () => {
  const res = await provisionAgent(ventureId, 'investigador', ['content.seo']);
  const caps = res.capabilities;
  assert.ok(caps.includes('research.web')); // base del rol
  assert.ok(caps.includes('content.seo'));  // override
});

test('ADR-011 provisionAgent: venture_id correcto en el agente creado', async () => {
  const otherVenture = await run(`INSERT INTO ventures (name, type, status) VALUES ('Test Venture', 'store', 'active')`);
  const res = await provisionAgent(otherVenture.lastID, 'contenido');
  const agent = await get<{ venture_id: number }>(`SELECT venture_id FROM agents WHERE id = ?`, [res.agentId]);
  assert.equal(agent!.venture_id, otherVenture.lastID);
});

// ═══ Migración idempotente (columnas ADR-011, defaults, normalización a array) ═══

test('ADR-011 migración: agents tiene columnas agent_type, availability, claimed_by_task, claim_expires_at', async () => {
  const cols = await all<{ name: string }>(`PRAGMA table_info(agents)`);
  const names = cols.map((c) => c.name);
  assert.ok(names.includes('agent_type'));
  assert.ok(names.includes('availability'));
  assert.ok(names.includes('claimed_by_task'));
  assert.ok(names.includes('claim_expires_at'));
});

test('ADR-011 migración: capabilities se almacena como ARRAY (no objeto), default []', async () => {
  const agents = await all<{ capabilities: string }>(`SELECT capabilities FROM agents`);
  for (const a of agents) {
    const parsed = JSON.parse(a.capabilities || '[]');
    assert.ok(Array.isArray(parsed), `capabilities debe ser array, got: ${a.capabilities}`);
  }
});

test('ADR-011 migración: role_definitions tiene columna capabilities y es array', async () => {
  const cols = await all<{ name: string }>(`PRAGMA table_info(role_definitions)`);
  assert.ok(cols.some((c) => c.name === 'capabilities'));
  const roles = await all<{ capabilities: string }>(`SELECT capabilities FROM role_definitions`);
  for (const r of roles) {
    const parsed = JSON.parse(r.capabilities || '[]');
    assert.ok(Array.isArray(parsed), `role capabilities debe ser array, got: ${r.capabilities}`);
  }
});

test('ADR-011 migración: agent_type default "permanent", availability default "available"', async () => {
  const agent = await get<{ agent_type: string; availability: string }>(`SELECT agent_type, availability FROM agents LIMIT 1`);
  assert.equal(agent!.agent_type, 'permanent');
  assert.equal(agent!.availability, 'available');
});
