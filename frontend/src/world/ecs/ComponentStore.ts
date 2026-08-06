import type { EntityId, ComponentKind } from './types';

// Almacena componentes indexados por tipo y por entidad:
// Map<ComponentKind, Map<EntityId, data>>. Cada System pide solo los
// componentes que necesita — nunca conoce la "entidad completa".
export class ComponentStore {
  private stores = new Map<ComponentKind, Map<EntityId, unknown>>();

  private storeFor(kind: ComponentKind): Map<EntityId, unknown> {
    let store = this.stores.get(kind);
    if (!store) {
      store = new Map();
      this.stores.set(kind, store);
    }
    return store;
  }

  addComponent<T>(id: EntityId, kind: ComponentKind, data: T): void {
    this.storeFor(kind).set(id, data);
  }

  removeComponent(id: EntityId, kind: ComponentKind): void {
    this.stores.get(kind)?.delete(id);
  }

  getComponent<T>(id: EntityId, kind: ComponentKind): T | undefined {
    return this.stores.get(kind)?.get(id) as T | undefined;
  }

  hasComponent(id: EntityId, kind: ComponentKind): boolean {
    return this.stores.get(kind)?.has(id) ?? false;
  }

  // Entidades que tienen TODOS los kinds pedidos (intersección).
  getEntitiesWith(...kinds: ComponentKind[]): EntityId[] {
    if (kinds.length === 0) return [];
    const [first, ...rest] = kinds;
    const base = this.stores.get(first);
    if (!base) return [];
    const result: EntityId[] = [];
    for (const id of base.keys()) {
      if (rest.every((k) => this.stores.get(k)?.has(id))) result.push(id);
    }
    return result;
  }

  // Borra todos los componentes de una entidad — usado por WorldEngine.destroyEntity().
  removeAllForEntity(id: EntityId): void {
    for (const store of this.stores.values()) store.delete(id);
  }

  clear(): void {
    this.stores.clear();
  }
}
