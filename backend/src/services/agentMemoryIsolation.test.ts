import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, all } from '../db/init.js';
import { writeAgentMemory } from './agentMemoryService.js';
import { composeSystemContext } from './contextComposer.js';
import { createMemoryEntry, listBusinessMemory } from './memoryService.js';

// ═══ Tests de aislamiento de agent_memory PRIVADA entre ventures (Fase 8). BD aislada. ═══

let AGENT = 0, V1 = 0, V2 = 0;

before(async () => {
  await initSchema();
  AGENT = (await run(`INSERT INTO agents (name, role, status, model) VALUES ('Iso', 'investigador', 'idle', 'x')`)).lastID;
  V1 = (await run(`INSERT INTO ventures (name, type, status) VALUES ('V1', 'store', 'active')`)).lastID;
  V2 = (await run(`INSERT INTO ventures (name, type, status) VALUES ('V2', 'store', 'active')`)).lastID;
});

async function readMem(agentId: number, ventureId: number): Promise<Array<{ key: string; value: string }>> {
  return all<{ key: string; value: string }>(
    "SELECT key, value FROM agent_memory WHERE agent_id = ? AND venture_id = ? AND category = 'fact' ORDER BY key",
    [agentId, ventureId]
  );
}

test('A · mismo agente + misma key en dos ventures → valores separados, nunca mezclados', async () => {
  await writeAgentMemory(AGENT, 'nicho', 'valor V1', V1);
  await writeAgentMemory(AGENT, 'nicho', 'valor V2', V2);
  assert.deepEqual(await readMem(AGENT, V1), [{ key: 'nicho', value: 'valor V1' }]);
  assert.deepEqual(await readMem(AGENT, V2), [{ key: 'nicho', value: 'valor V2' }]);
});

test('B · aislamiento de lectura: keys de V1 no aparecen al leer en V2', async () => {
  await writeAgentMemory(AGENT, 'k_a', 'a', V1);
  await writeAgentMemory(AGENT, 'k_b', 'b', V1);
  const m2 = await readMem(AGENT, V2);
  assert.ok(!m2.some((r) => r.key === 'k_a' || r.key === 'k_b'), 'V2 no ve la memoria de V1');
});

test('C · aislamiento de escritura: escribir la misma key en V2 no sobrescribe V1', async () => {
  await writeAgentMemory(AGENT, 'compartida', 'v1-original', V1);
  await writeAgentMemory(AGENT, 'compartida', 'v2-otro', V2);
  const m1 = await readMem(AGENT, V1);
  assert.equal(m1.find((r) => r.key === 'compartida')?.value, 'v1-original');
});

test('D · ContextComposer: [LO QUE SÉ] solo contiene la memoria privada de la venture ejecutada', async () => {
  await writeAgentMemory(AGENT, 'secreto_v1', 'DATO-PRIVADO-V1', V1);
  await writeAgentMemory(AGENT, 'secreto_v2', 'DATO-PRIVADO-V2', V2);
  const ctx1 = await composeSystemContext({ agentId: AGENT, agentName: 'Iso', ventureId: V1 });
  const ctx2 = await composeSystemContext({ agentId: AGENT, agentName: 'Iso', ventureId: V2 });
  assert.match(ctx1, /DATO-PRIVADO-V1/);
  assert.ok(!/DATO-PRIVADO-V2/.test(ctx1), 'el contexto de V1 NO debe contener memoria de V2');
  assert.match(ctx2, /DATO-PRIVADO-V2/);
  assert.ok(!/DATO-PRIVADO-V1/.test(ctx2), 'el contexto de V2 NO debe contener memoria de V1');
});

test('E · memory_entries: compartida por venture y aislada; agent_memory sigue privada', async () => {
  await createMemoryEntry({ ventureId: V1, category: 'learning', title: 'negocio_V1', content: 'compartido en V1' });
  const biz1 = await listBusinessMemory(V1, 20);
  const biz2 = await listBusinessMemory(V2, 20);
  assert.ok(biz1.some((m) => m.title === 'negocio_V1'), 'memory_entries de V1 visible en V1 (compartida entre agentes)');
  assert.ok(!biz2.some((m) => m.title === 'negocio_V1'), 'memory_entries de V1 NO visible en V2 (aislada)');
  // La memoria privada no se mezcla con la de negocio.
  await writeAgentMemory(AGENT, 'privada_e', 'solo mía', V1);
  const biz1After = await listBusinessMemory(V1, 20);
  assert.ok(!biz1After.some((m) => m.title === 'privada_e'), 'agent_memory no aparece en memory_entries');
});

test('F · sin venture (venture_id 0 = global): separada de la memoria de venture', async () => {
  await writeAgentMemory(AGENT, 'global_key', 'GLOBAL-VAL', undefined); // sin venture → 0
  assert.ok((await readMem(AGENT, 0)).some((r) => r.key === 'global_key' && r.value === 'GLOBAL-VAL'));
  assert.ok(!(await readMem(AGENT, V1)).some((r) => r.key === 'global_key'), 'la global no aparece en una venture');
  const ctxGlobal = await composeSystemContext({ agentId: AGENT, agentName: 'Iso', ventureId: null });
  assert.match(ctxGlobal, /GLOBAL-VAL/);
  assert.ok(!/DATO-PRIVADO-V1/.test(ctxGlobal), 'el contexto global no contiene memoria de una venture');
});

test('H · Hokage: mismo agente especialista reutilizado en dos ventures no cruza memoria', async () => {
  const spec = (await run(`INSERT INTO agents (name, role, status, model) VALUES ('Spec', 'contenido', 'idle', 'x')`)).lastID;
  await writeAgentMemory(spec, 'aprendizaje', 'aprendido en V1', V1);
  await writeAgentMemory(spec, 'aprendizaje', 'aprendido en V2', V2);
  const ctx1 = await composeSystemContext({ agentId: spec, agentName: 'Spec', ventureId: V1 });
  const ctx2 = await composeSystemContext({ agentId: spec, agentName: 'Spec', ventureId: V2 });
  assert.match(ctx1, /aprendido en V1/);
  assert.ok(!/aprendido en V2/.test(ctx1));
  assert.match(ctx2, /aprendido en V2/);
  assert.ok(!/aprendido en V1/.test(ctx2));
});

test('G · migración idempotente: re-init preserva datos, no duplica, retira el índice viejo', async () => {
  await writeAgentMemory(AGENT, 'persistente', 'valor', V1);
  await initSchema(); // re-ejecuta migraciones
  const rows = await all<{ value: string }>(
    "SELECT value FROM agent_memory WHERE agent_id = ? AND venture_id = ? AND key = 'persistente'", [AGENT, V1]
  );
  assert.equal(rows.length, 1, 'no se duplica tras re-init');
  assert.equal(rows[0].value, 'valor', 'dato preservado');
  const idx = (await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_agent_memory%'")).map((i) => i.name);
  assert.ok(idx.includes('idx_agent_memory_venture_unique'), 'índice nuevo presente');
  assert.ok(!idx.includes('idx_agent_memory_unique'), 'índice viejo (agent_id,key) retirado');
});
