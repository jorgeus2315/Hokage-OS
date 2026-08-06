import type { EntityId } from './types';

// Registro puro de qué entidades existen. No sabe nada de componentes —
// eso es responsabilidad de ComponentStore. WorldEngine coordina ambos.
export class EntityStore {
  private ids = new Set<EntityId>();

  createEntity(id: EntityId): EntityId {
    this.ids.add(id);
    return id;
  }

  destroyEntity(id: EntityId): void {
    this.ids.delete(id);
  }

  hasEntity(id: EntityId): boolean {
    return this.ids.has(id);
  }

  allEntities(): EntityId[] {
    return [...this.ids];
  }

  get size(): number {
    return this.ids.size;
  }

  clear(): void {
    this.ids.clear();
  }
}
