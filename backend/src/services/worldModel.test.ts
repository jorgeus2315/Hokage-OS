import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// BD aislada si se ejecuta suelto; en el runner respeta HOKAGE_DB_PATH ya fijado.
process.env.HOKAGE_DB_PATH = process.env.HOKAGE_DB_PATH || path.resolve(__dirname, '../../data/test-world.db');

import { initSchema, run } from '../db/init.js';
import {
  createEntity, getEntity, updateEntity, deleteEntity,
  entitiesByKind, childrenOf, entityForRef, listWorld,
  link, unlink, relationsOf,
} from './worldModelService.js';

// ═══ ADR-017 F0 — World Model (datos + contratos). Determinista, sin red. ═══

before(async () => { await initSchema(); });
beforeEach(async () => {
  await run('DELETE FROM world_relations');
  await run('DELETE FROM world_entities');
});

test('CRUD: crear / leer / borrar entidad', async () => {
  const b = await createEntity({ kind: 'building', name: 'HQ' });
  const got = await getEntity(b.id);
  assert.equal(got?.name, 'HQ');
  assert.equal(got?.kind, 'building');
  assert.equal(got?.status, 'active');
  await deleteEntity(b.id);
  assert.equal(await getEntity(b.id), null);
});

test('EXTENSIBILIDAD: un kind NUEVO (no diseñado en F0) se acepta sin migración', async () => {
  const e = await createEntity({ kind: 'quantum_dragon', name: 'Dracarys', attributes: { breathesFire: true } });
  const got = await getEntity(e.id);
  assert.equal(got?.kind, 'quantum_dragon');
  assert.equal(got?.attributes.breathesFire, true);
  assert.equal((await entitiesByKind('quantum_dragon')).length, 1);
});

test('EXTENSIBILIDAD: attributes hace MERGE (editar una clave no borra el resto) y admite claves nuevas', async () => {
  const c = await createEntity({ kind: 'character', name: 'Yuki', attributes: { skinId: 'neon', level: 12 } });
  const upd = await updateEntity(c.id, { attributes: { skinId: 'pixel-pikachu' } }); // solo cambia skinId
  assert.equal(upd?.attributes.skinId, 'pixel-pikachu');
  assert.equal(upd?.attributes.level, 12, 'la clave existente se conserva (merge)');
  const upd2 = await updateEntity(c.id, { attributes: { mood: 'happy' } });          // clave nueva, sin migración
  assert.equal(upd2?.attributes.mood, 'happy');
  assert.equal(upd2?.attributes.skinId, 'pixel-pikachu', 'nada previo se pierde');
});

test('contención: room→building y object→room vía parent_id', async () => {
  const b = await createEntity({ kind: 'building', name: 'HQ' });
  const r = await createEntity({ kind: 'room', name: 'Marketing', parentId: b.id });
  const o = await createEntity({ kind: 'object', name: 'Terminal', parentId: r.id });
  const rooms = await childrenOf(b.id);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].id, r.id);
  assert.equal((await childrenOf(r.id))[0].name, 'Terminal');
  assert.equal(o.parentId, r.id);
});

test('enlace al CEREBRO: character→agent vía ref (representa, no reemplaza)', async () => {
  const ch = await createEntity({ kind: 'character', name: 'Banquero', refKind: 'agent', refId: 42 });
  const found = await entityForRef('agent', 42);
  assert.equal(found?.id, ch.id);
  assert.equal(found?.refKind, 'agent');
  assert.equal(found?.refId, 42);
});

test('relaciones: link / relationsOf / unlink y un kind de relación NUEVO sin migración', async () => {
  const a = await createEntity({ kind: 'character', name: 'A' });
  const room = await createEntity({ kind: 'room', name: 'Lab' });
  await link(a.id, room.id, 'works_in');
  await link(a.id, room.id, 'can_move_to', { via: 'pasillo' });      // kind de relación no diseñado
  await link(a.id, room.id, 'teleports_on_tuesdays');               // otro kind nuevo, sin migración
  const rels = await relationsOf(a.id);
  assert.equal(rels.length, 3);
  assert.ok(rels.some(r => r.kind === 'can_move_to' && r.attributes.via === 'pasillo'));
  await unlink(a.id, room.id, 'works_in');
  assert.equal((await relationsOf(a.id)).length, 2);
});

test('listWorld: mundo completo + aislamiento por venture', async () => {
  // Crear las ventures (FK world_entities.venture_id) para que el test sea robusto aislado.
  const v1 = (await run(`INSERT INTO ventures (name, type, status) VALUES ('WM-V1','store','active')`)).lastID;
  const v2 = (await run(`INSERT INTO ventures (name, type, status) VALUES ('WM-V2','store','active')`)).lastID;
  await createEntity({ kind: 'room', name: 'V1-room', ventureId: v1 });
  await createEntity({ kind: 'room', name: 'V2-room', ventureId: v2 });
  assert.equal((await listWorld()).entities.length, 2);
  const only1 = await listWorld(v1);
  assert.equal(only1.entities.length, 1);
  assert.equal(only1.entities[0].name, 'V1-room');
});

test('borrar una entidad elimina sus relaciones (integridad del grafo)', async () => {
  const a = await createEntity({ kind: 'character', name: 'A' });
  const room = await createEntity({ kind: 'room', name: 'R' });
  await link(a.id, room.id, 'works_in');
  await deleteEntity(a.id);
  assert.equal((await relationsOf(room.id)).length, 0);
});

test('pos_x/pos_y son datos opacos (hint de layout), no lógica — se guardan y devuelven tal cual', async () => {
  const r = await createEntity({ kind: 'room', name: 'R', posX: 412.5, posY: 300 });
  const got = await getEntity(r.id);
  assert.equal(got?.posX, 412.5);
  assert.equal(got?.posY, 300);
});
