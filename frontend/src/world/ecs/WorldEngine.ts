import { EntityStore } from './EntityStore';
import { ComponentStore } from './ComponentStore';
import type { System, WorldContext } from './System';
import type { EntityId, ComponentKind } from './types';
import type { WorldCommand } from '../events/WorldCommand';

// WorldEngine — orquestador del ECS del mapa.
//
// API PÚBLICA DEFINITIVA desde la Fase 0 (ver "Plan de Migración ECS" y
// "Baseline de Comportamiento — World Engine" en la bóveda Obsidian, ambas
// en 02_Sistemas/World Engine/): esta forma no debe cambiar en fases
// posteriores, aunque la implementación interna de cada método crezca.
//
// Fase 0: esta clase existe en paralelo al WorldEngine legacy
// (../WorldEngine.ts, todavía usado por WorldCanvas.tsx sin cambios) — está
// inerte, nada la consume todavía. La Fase 1 conecta WorldCanvas.tsx aquí
// y migra la lógica de movimiento del legacy a MovementSystem. El legacy
// se retira en la Fase 9, no antes.
export class WorldEngine {
  readonly entities = new EntityStore();
  readonly components = new ComponentStore();

  private systems: System[] = [];
  private commandQueue: WorldCommand[] = [];
  private elapsedSec = 0;

  // ── Entidades ──────────────────────────────────────────────────────
  createEntity(id: EntityId): EntityId {
    return this.entities.createEntity(id);
  }

  destroyEntity(id: EntityId): void {
    this.components.removeAllForEntity(id);
    this.entities.destroyEntity(id);
  }

  hasEntity(id: EntityId): boolean {
    return this.entities.hasEntity(id);
  }

  allEntities(): EntityId[] {
    return this.entities.allEntities();
  }

  // ── Componentes ────────────────────────────────────────────────────
  addComponent<T>(id: EntityId, kind: ComponentKind, data: T): void {
    this.components.addComponent(id, kind, data);
  }

  removeComponent(id: EntityId, kind: ComponentKind): void {
    this.components.removeComponent(id, kind);
  }

  getComponent<T>(id: EntityId, kind: ComponentKind): T | undefined {
    return this.components.getComponent<T>(id, kind);
  }

  hasComponent(id: EntityId, kind: ComponentKind): boolean {
    return this.components.hasComponent(id, kind);
  }

  getEntitiesWith(...kinds: ComponentKind[]): EntityId[] {
    return this.components.getEntitiesWith(...kinds);
  }

  // ── Systems ────────────────────────────────────────────────────────
  addSystem(system: System): void {
    this.systems.push(system);
  }

  // ── Comandos (Events) ──────────────────────────────────────────────
  dispatch(command: WorldCommand): void {
    this.commandQueue.push(command);
  }

  // ── Ciclo de vida ──────────────────────────────────────────────────
  tick(dt: number): void {
    this.elapsedSec += dt;
    const commandsThisTick = this.commandQueue;
    this.commandQueue = [];

    const ctx: WorldContext = {
      entities: this.entities,
      components: this.components,
      elapsedSec: this.elapsedSec,
      commands: commandsThisTick,
      dispatch: (c) => this.commandQueue.push(c),
    };

    for (const system of this.systems) {
      system.update(ctx, dt);
    }
  }

  clear(): void {
    this.entities.clear();
    this.components.clear();
    this.systems = [];
    this.commandQueue = [];
    this.elapsedSec = 0;
  }
}
