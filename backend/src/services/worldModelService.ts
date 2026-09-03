import { run, get, all } from '../db/init.js';
import type { WorldEntity, WorldRelation, WorldEntityCreate, WorldEntityPatch } from '../types/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// worldModelService — CRUD + grafo del World Model (ADR-017, F0).
// ═══════════════════════════════════════════════════════════════════════════
// SIN presentación: no conoce PIXI, ni React, ni trata pos_x/pos_y como lógica (son datos opacos,
// hint de layout — invariante I1). El mundo crece por DATOS: `kind` y el kind de relación son
// ABIERTOS (string), y `attributes` es JSON extensible — añadir un tipo/atributo/relación NO
// requiere migración (I3). Es el contrato que consumirán el snapshot del frontend (F1) y las
// tools de edición de Hokage (F6), siempre con permisos/aprobación/presupuesto por encima.

interface EntityRow {
  id: number; kind: string; name: string; parent_id: number | null;
  ref_kind: string | null; ref_id: number | null; venture_id: number | null;
  pos_x: number | null; pos_y: number | null; status: string;
  attributes: string; created_at: string; updated_at: string;
}
interface RelationRow {
  id: number; from_id: number; to_id: number; kind: string; attributes: string; created_at: string;
}

const ENTITY_COLS = 'id, kind, name, parent_id, ref_kind, ref_id, venture_id, pos_x, pos_y, status, attributes, created_at, updated_at';
const RELATION_COLS = 'id, from_id, to_id, kind, attributes, created_at';

function parseAttrs(s: string): Record<string, unknown> {
  try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}; }
  catch { return {}; }
}
function mapEntity(r: EntityRow): WorldEntity {
  return {
    id: r.id, kind: r.kind, name: r.name, parentId: r.parent_id,
    refKind: r.ref_kind, refId: r.ref_id, ventureId: r.venture_id,
    posX: r.pos_x, posY: r.pos_y, status: r.status,
    attributes: parseAttrs(r.attributes), createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapRelation(r: RelationRow): WorldRelation {
  return { id: r.id, fromId: r.from_id, toId: r.to_id, kind: r.kind, attributes: parseAttrs(r.attributes), createdAt: r.created_at };
}

// ── Entidades ────────────────────────────────────────────────────────────────

export async function createEntity(p: WorldEntityCreate): Promise<WorldEntity> {
  const res = await run(
    `INSERT INTO world_entities (kind, name, parent_id, ref_kind, ref_id, venture_id, pos_x, pos_y, status, attributes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.kind, p.name ?? '', p.parentId ?? null, p.refKind ?? null, p.refId ?? null, p.ventureId ?? null,
     p.posX ?? null, p.posY ?? null, p.status ?? 'active', JSON.stringify(p.attributes ?? {})]
  );
  return (await getEntity(res.lastID))!;
}

export async function getEntity(id: number): Promise<WorldEntity | null> {
  const r = await get<EntityRow>(`SELECT ${ENTITY_COLS} FROM world_entities WHERE id = ?`, [id]);
  return r ? mapEntity(r) : null;
}

// `attributes` se FUSIONA (merge), no se reemplaza: editar una clave no borra el resto — así una
// tool de Hokage puede cambiar solo skinId sin perder level/mood. Pasar attributes:{} no borra nada.
export async function updateEntity(id: number, patch: WorldEntityPatch): Promise<WorldEntity | null> {
  const cur = await get<EntityRow>(`SELECT ${ENTITY_COLS} FROM world_entities WHERE id = ?`, [id]);
  if (!cur) return null;
  const attrs = patch.attributes ? { ...parseAttrs(cur.attributes), ...patch.attributes } : parseAttrs(cur.attributes);
  await run(
    `UPDATE world_entities SET name = ?, parent_id = ?, ref_kind = ?, ref_id = ?, venture_id = ?,
       pos_x = ?, pos_y = ?, status = ?, attributes = ?, updated_at = datetime('now') WHERE id = ?`,
    [
      patch.name ?? cur.name,
      patch.parentId !== undefined ? patch.parentId : cur.parent_id,
      patch.refKind !== undefined ? patch.refKind : cur.ref_kind,
      patch.refId !== undefined ? patch.refId : cur.ref_id,
      patch.ventureId !== undefined ? patch.ventureId : cur.venture_id,
      patch.posX !== undefined ? patch.posX : cur.pos_x,
      patch.posY !== undefined ? patch.posY : cur.pos_y,
      patch.status ?? cur.status,
      JSON.stringify(attrs), id,
    ]
  );
  return getEntity(id);
}

// Borra la entidad y limpia sus aristas (integridad del grafo). No cascada a hijos (F0: hoja/simple).
export async function deleteEntity(id: number): Promise<void> {
  await run(`DELETE FROM world_relations WHERE from_id = ? OR to_id = ?`, [id, id]);
  await run(`DELETE FROM world_entities WHERE id = ?`, [id]);
}

export async function entitiesByKind(kind: string): Promise<WorldEntity[]> {
  const rows = await all<EntityRow>(`SELECT ${ENTITY_COLS} FROM world_entities WHERE kind = ? ORDER BY id`, [kind]);
  return rows.map(mapEntity);
}

export async function childrenOf(parentId: number): Promise<WorldEntity[]> {
  const rows = await all<EntityRow>(`SELECT ${ENTITY_COLS} FROM world_entities WHERE parent_id = ? ORDER BY id`, [parentId]);
  return rows.map(mapEntity);
}

// Resuelve la entidad de MUNDO que representa a una entidad del CEREBRO (character→agent, room→dept).
export async function entityForRef(refKind: string, refId: number): Promise<WorldEntity | null> {
  const r = await get<EntityRow>(`SELECT ${ENTITY_COLS} FROM world_entities WHERE ref_kind = ? AND ref_id = ? LIMIT 1`, [refKind, refId]);
  return r ? mapEntity(r) : null;
}

// Mundo completo (contrato para el snapshot del frontend en F1 — F0 solo lo expone, no lo cablea).
export async function listWorld(ventureId?: number | null): Promise<{ entities: WorldEntity[]; relations: WorldRelation[] }> {
  const eRows = ventureId == null
    ? await all<EntityRow>(`SELECT ${ENTITY_COLS} FROM world_entities ORDER BY id`)
    : await all<EntityRow>(`SELECT ${ENTITY_COLS} FROM world_entities WHERE venture_id = ? ORDER BY id`, [ventureId]);
  const rRows = await all<RelationRow>(`SELECT ${RELATION_COLS} FROM world_relations ORDER BY id`);
  return { entities: eRows.map(mapEntity), relations: rRows.map(mapRelation) };
}

// ── Relaciones (grafo del mundo) ────────────────────────────────────────────────

export async function link(fromId: number, toId: number, kind: string, attributes: Record<string, unknown> = {}): Promise<WorldRelation> {
  const res = await run(
    `INSERT INTO world_relations (from_id, to_id, kind, attributes) VALUES (?, ?, ?, ?)`,
    [fromId, toId, kind, JSON.stringify(attributes)]
  );
  const r = await get<RelationRow>(`SELECT ${RELATION_COLS} FROM world_relations WHERE id = ?`, [res.lastID]);
  return mapRelation(r!);
}

export async function unlink(fromId: number, toId: number, kind: string): Promise<void> {
  await run(`DELETE FROM world_relations WHERE from_id = ? AND to_id = ? AND kind = ?`, [fromId, toId, kind]);
}

export async function relationsOf(entityId: number): Promise<WorldRelation[]> {
  const rows = await all<RelationRow>(
    `SELECT ${RELATION_COLS} FROM world_relations WHERE from_id = ? OR to_id = ? ORDER BY id`,
    [entityId, entityId]
  );
  return rows.map(mapRelation);
}
