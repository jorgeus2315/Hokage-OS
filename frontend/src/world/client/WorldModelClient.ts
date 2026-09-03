// WorldModelClient — Frontend access to world_entities and world_relations.
// Hydrated from initial_snapshot.world (if present) or via REST GET /api/world.
// No derivation, no layout logic. Pure data access.

// Shapes matching backend WorldEntity/WorldRelation (from initial_snapshot or REST)
export interface WorldEntityDto {
  id: number;
  kind: string;
  name: string;
  parentId: number | null;
  refKind: string | null;
  refId: number | null;
  ventureId: number | null;
  posX: number | null;
  posY: number | null;
  status: string;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorldRelationDto {
  id: number;
  fromId: number;
  toId: number;
  kind: string;
  attributes: Record<string, unknown>;
  createdAt: string;
}

export interface WorldSnapshot {
  entities: WorldEntityDto[];
  relations: WorldRelationDto[];
}

export class WorldModelClient {
  private entities = new Map<number, WorldEntityDto>();
  private relations = new Map<number, WorldRelationDto[]>();
  private byKind = new Map<string, number[]>();
  private byRef = new Map<string, Map<number, number>>(); // refKind -> refId -> entityId
  private ventureFilter: number | null = null;
  private listeners = new Set<() => void>();

  constructor() {}

  // Hydrate from initial_snapshot or REST response
  hydrate(snapshot: WorldSnapshot, ventureId?: number | null): void {
    this.entities.clear();
    this.relations.clear();
    this.byKind.clear();
    this.byRef.clear();
    this.ventureFilter = ventureId ?? null;

    for (const e of snapshot.entities) {
      // Apply venture filter if set
      if (this.ventureFilter !== null && e.ventureId !== this.ventureFilter) {
        continue;
      }
      this.entities.set(e.id, e);
      // Index by kind
      const kindList = this.byKind.get(e.kind) ?? [];
      kindList.push(e.id);
      this.byKind.set(e.kind, kindList);
      // Index by ref (for character→agent lookup)
      if (e.refKind && e.refId !== null) {
        const refMap = this.byRef.get(e.refKind) ?? new Map();
        refMap.set(e.refId, e.id);
        this.byRef.set(e.refKind, refMap);
      }
    }

    for (const r of snapshot.relations) {
      const fromEnt = this.entities.get(r.fromId);
      const toEnt = this.entities.get(r.toId);
      if (!fromEnt || !toEnt) continue; // Skip relations to filtered-out entities
      const list = this.relations.get(r.fromId) ?? [];
      list.push(r);
      this.relations.set(r.fromId, list);
      const listTo = this.relations.get(r.toId) ?? [];
      listTo.push(r);
      this.relations.set(r.toId, listTo);
    }
    this.notify();
  }

  // Fetch from REST (if initial_snapshot doesn't include world)
  async fetch(ventureId?: number | null): Promise<void> {
    const params = ventureId != null ? `?ventureId=${ventureId}` : '';
    const res = await fetch(`/api/world${params}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch world: ${res.status}`);
    const data = await res.json() as WorldSnapshot;
    this.hydrate(data, ventureId);
  }

  // Get entity by id
  getEntity(id: number): WorldEntityDto | undefined {
    return this.entities.get(id);
  }

  // Get all entities of a kind (e.g., 'room', 'building', 'character')
  getEntitiesByKind(kind: string): WorldEntityDto[] {
    const ids = this.byKind.get(kind) ?? [];
    return ids.map(id => this.entities.get(id)!).filter(Boolean);
  }

  // Get rooms for a venture (kind='room', optionally filtered by venture)
  getRooms(): WorldEntityDto[] {
    return this.getEntitiesByKind('room');
  }

  // Get buildings/hubs (kind='building')
  getBuildings(): WorldEntityDto[] {
    return this.getEntitiesByKind('building');
  }

  // Get hub (building with is_hub in attributes or name='HOKAGE')
  getHub(): WorldEntityDto | undefined {
    const buildings = this.getBuildings();
    return buildings.find(b =>
      b.attributes.is_hub === true ||
      b.name.toUpperCase() === 'HOKAGE' ||
      b.kind === 'hub'
    );
  }

  // Get character entity for an agent (ref_kind='agent', ref_id=agentId)
  getCharacterForAgent(agentId: number): WorldEntityDto | undefined {
    const refMap = this.byRef.get('agent');
    if (!refMap) return undefined;
    const entityId = refMap.get(agentId);
    if (!entityId) return undefined;
    return this.entities.get(entityId);
  }

  // Get room where a character works (works_in relation)
  getRoomForCharacter(characterId: number): WorldEntityDto | undefined {
    const relations = this.relations.get(characterId) ?? [];
    for (const rel of relations) {
      if (rel.kind === 'works_in' || rel.kind === 'can_move_to') {
        const room = this.entities.get(rel.toId);
        if (room && room.kind === 'room') return room;
      }
    }
    return undefined;
  }

  // Get home room from character attributes
  getHomeRoomForCharacter(characterId: number): WorldEntityDto | undefined {
    const character = this.entities.get(characterId);
    if (!character) return undefined;
    const homeRoomId = character.attributes.homeRoom as number | undefined;
    if (homeRoomId) return this.entities.get(homeRoomId);
    return undefined;
  }

  // Get position for an entity (pos_x/pos_y as layout hints)
  getPosition(entityId: number): { x: number; y: number } | null {
    const entity = this.entities.get(entityId);
    if (!entity || entity.posX === null || entity.posY === null) return null;
    return { x: entity.posX, y: entity.posY };
  }

  // Subscribe to changes
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  // Clear all data
  clear(): void {
    this.entities.clear();
    this.relations.clear();
    this.byKind.clear();
    this.byRef.clear();
    this.notify();
  }

  // Get all entities (for testing)
  getAllEntities(): WorldEntityDto[] {
    return [...this.entities.values()];
  }
}

// Singleton instance
export const worldModelClient = new WorldModelClient();