// BehaviorSystem tests — F1: Movement with Purpose
// Tests that BehaviorSystem correctly determines Motion.target based on AgentRuntimeState

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BehaviorSystem } from './BehaviorSystem.js';
import { worldModelClient } from '../client/WorldModelClient.js';
import { agentStateStore } from '../state/AgentStateStore.js';
import type { WorldEntityDto } from '../client/WorldModelClient.js';
import type { AgentRuntimeState, AgentPrimaryState } from '../../shared/types.js';

// Mock WorldContext for testing
interface MockComponentStore {
  entities: Set<string>;
  components: Map<string, Map<string, any>>;
  getEntitiesWith(kind: string): string[];
  getComponent<T>(entityId: string, kind: string): T | undefined;
  addComponent(entityId: string, kind: string, component: any): void;
  hasComponent(entityId: string, kind: string): boolean;
  hasEntity(entityId: string): boolean;
  removeComponent(entityId: string, kind: string): void;
  destroyEntity(entityId: string): void;
}

interface MockWorldContext {
  components: MockComponentStore;
  entities: Set<string>;
}

function createMockContext(): MockWorldContext {
  const components = new Map<string, Map<string, any>>();
  const entities = new Set<string>();

  const store: MockComponentStore = {
    entities,
    components,
    getEntitiesWith(kind: string): string[] {
      const result: string[] = [];
      for (const entityId of entities) {
        const comps = components.get(entityId);
        if (comps && comps.has(kind)) result.push(entityId);
      }
      return result;
    },
    getComponent<T>(entityId: string, kind: string): T | undefined {
      return components.get(entityId)?.get(kind);
    },
    addComponent(entityId: string, kind: string, component: any): void {
      if (!components.has(entityId)) components.set(entityId, new Map());
      components.get(entityId)!.set(kind, component);
    },
    hasComponent(entityId: string, kind: string): boolean {
      return components.get(entityId)?.has(kind) ?? false;
    },
    hasEntity(entityId: string): boolean {
      return entities.has(entityId);
    },
    removeComponent(entityId: string, kind: string): void {
      components.get(entityId)?.delete(kind);
    },
    destroyEntity(entityId: string): void {
      entities.delete(entityId);
      components.delete(entityId);
    },
  };

  return { components: store, entities };
}

function setupWorldModel(): void {
  // Clear and setup world model with hub, rooms, and characters
  const entities: WorldEntityDto[] = [
    // Hub
    {
      id: 1,
      kind: 'building',
      name: 'HOKAGE',
      parentId: null,
      refKind: null,
      refId: null,
      ventureId: null,
      posX: 1000,
      posY: 1000,
      status: 'active',
      attributes: { is_hub: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Room for agent 1 (investigador)
    {
      id: 10,
      kind: 'room',
      name: 'Investigación',
      parentId: 1,
      refKind: 'department',
      refId: 10,
      ventureId: null,
      posX: 800,
      posY: 800,
      status: 'active',
      attributes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Room for agent 2 (contenido)
    {
      id: 11,
      kind: 'room',
      name: 'Contenido',
      parentId: 1,
      refKind: 'department',
      refId: 11,
      ventureId: null,
      posX: 1200,
      posY: 800,
      status: 'active',
      attributes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Character for agent 1
    {
      id: 1001,
      kind: 'character',
      name: 'Explorador',
      parentId: null,
      refKind: 'agent',
      refId: 1,
      ventureId: null,
      posX: null,
      posY: null,
      status: 'active',
      attributes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // Character for agent 2
    {
      id: 1002,
      kind: 'character',
      name: 'Escritor',
      parentId: null,
      refKind: 'agent',
      refId: 2,
      ventureId: null,
      posX: null,
      posY: null,
      status: 'active',
      attributes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const relations: Array<{ id: number; fromId: number; toId: number; kind: string; attributes: Record<string, unknown>; createdAt: string }> = [
    { id: 1, fromId: 1001, toId: 10, kind: 'works_in', attributes: {}, createdAt: new Date().toISOString() },
    { id: 2, fromId: 1002, toId: 11, kind: 'works_in', attributes: {}, createdAt: new Date().toISOString() },
  ];

  worldModelClient.hydrate({ entities, relations });
  agentStateStore.clear();
}

function createAgentState(agentId: number, primary: AgentPrimaryState, overrides: Partial<AgentRuntimeState> = {}): AgentRuntimeState {
  const now = new Date().toISOString();
  return {
    agentId,
    ventureId: null,
    primary,
    modifiers: {
      awaitingApproval: false,
      hasError: false,
      blocked: false,
      reviewing: false,
      ...overrides.modifiers,
    },
    currentTask: overrides.currentTask,
    activity: overrides.activity ?? (primary === 'WORKING' ? 1 : 0),
    since: now,
    updatedAt: now,
    source: 'runtime',
  };
}

describe('BehaviorSystem', () => {
  let system: BehaviorSystem;
  let ctx: MockWorldContext;

  beforeEach(() => {
    setupWorldModel();
    system = new BehaviorSystem();
    ctx = createMockContext();

    // Register characters
    const char1 = worldModelClient.getEntity(1001)!;
    const char2 = worldModelClient.getEntity(1002)!;
    system.registerCharacter('char-1', char1, 1);
    system.registerCharacter('char-2', char2, 2);

    // Create ECS entities with Motion component
    ctx.entities.add('char-1');
    ctx.entities.add('char-2');
    ctx.components.addComponent('char-1', 'motion', { target: { x: 1000, y: 1000 }, trail: [] });
    ctx.components.addComponent('char-2', 'motion', { target: { x: 1000, y: 1000 }, trail: [] });
  });

  it('WORKING agent targets their assigned room', () => {
    // Agent 1 is WORKING
    agentStateStore.set(1, createAgentState(1, 'WORKING'));

    system.update(ctx as any, 16);

    const motion1 = ctx.components.getComponent('char-1', 'motion');
    expect(motion1.target.x).toBe(800);
    expect(motion1.target.y).toBe(800);
  });

  it('IDLE agent targets hub', () => {
    agentStateStore.set(1, createAgentState(1, 'IDLE'));

    system.update(ctx as any, 16);

    const motion1 = ctx.components.getComponent('char-1', 'motion');
    expect(motion1.target.x).toBe(1000);
    expect(motion1.target.y).toBe(1000);
  });

  it('COMPLETED agent targets hub', () => {
    agentStateStore.set(1, createAgentState(1, 'COMPLETED'));

    system.update(ctx as any, 16);

    const motion1 = ctx.components.getComponent('char-1', 'motion');
    expect(motion1.target.x).toBe(1000);
    expect(motion1.target.y).toBe(1000);
  });

  it('ERROR agent stays in room (if has one)', () => {
    agentStateStore.set(1, createAgentState(1, 'ERROR'));

    system.update(ctx as any, 16);

    const motion1 = ctx.components.getComponent('char-1', 'motion');
    expect(motion1.target.x).toBe(800);
    expect(motion1.target.y).toBe(800);
  });

  it('ERROR agent without room targets hub', () => {
    // Create a new character entity without room
    const char3: WorldEntityDto = {
      id: 1003,
      kind: 'character',
      name: 'Test',
      parentId: null,
      refKind: 'agent',
      refId: 3,
      ventureId: null,
      posX: null,
      posY: null,
      status: 'active',
      attributes: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    worldModelClient.hydrate({
      entities: [...worldModelClient.getAllEntities().filter(e => e.kind !== 'character'), char3],
      relations: [],
    });
    system.registerCharacter('char-3', char3, 3);
    ctx.entities.add('char-3');
    ctx.components.addComponent('char-3', 'motion', { target: { x: 1000, y: 1000 }, trail: [] });

    agentStateStore.set(3, createAgentState(3, 'ERROR'));

    system.update(ctx as any, 16);

    const motion3 = ctx.components.getComponent('char-3', 'motion');
    expect(motion3.target.x).toBe(1000);
    expect(motion3.target.y).toBe(1000);
  });

  it('THINKING/RESEARCHING/WAITING/REVIEWING/COMMUNICATING/MOVING agents target hub (conservative)', () => {
    const idleStates: AgentPrimaryState[] = ['THINKING', 'RESEARCHING', 'WAITING', 'REVIEWING', 'COMMUNICATING', 'MOVING'];

    for (const state of idleStates) {
      agentStateStore.set(1, createAgentState(1, state));
      system.update(ctx as any, 16);

      const motion1 = ctx.components.getComponent('char-1', 'motion');
      expect(motion1.target.x).toBe(1000);
      expect(motion1.target.y).toBe(1000);
    }
  });

  it('Agent without state defaults to hub', () => {
    // Don't set any state for agent 1
    system.update(ctx as any, 16);

    const motion1 = ctx.components.getComponent('char-1', 'motion');
    expect(motion1.target.x).toBe(1000);
    expect(motion1.target.y).toBe(1000);
  });

  it('Deterministic: same inputs produce same outputs', () => {
    agentStateStore.set(1, createAgentState(1, 'WORKING'));
    agentStateStore.set(2, createAgentState(2, 'IDLE'));

    // Run multiple times
    for (let i = 0; i < 10; i++) {
      system.update(ctx as any, 16);
    }

    const motion1 = ctx.components.getComponent('char-1', 'motion');
    const motion2 = ctx.components.getComponent('char-2', 'motion');

    // Agent 1 (WORKING) should always target room 10
    expect(motion1.target.x).toBe(800);
    expect(motion1.target.y).toBe(800);

    // Agent 2 (IDLE) should always target hub
    expect(motion2.target.x).toBe(1000);
    expect(motion2.target.y).toBe(1000);
  });

  it('Venture filter: agent with ventureId only targets rooms in same venture', () => {
    // Add a room in venture 5
    const entities: WorldEntityDto[] = [
      {
        id: 20,
        kind: 'room',
        name: 'Venture 5 Room',
        parentId: 1,
        refKind: 'department',
        refId: 20,
        ventureId: 5,
        posX: 600,
        posY: 600,
        status: 'active',
        attributes: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const relations = [
      { id: 3, fromId: 1001, toId: 20, kind: 'works_in', attributes: {}, createdAt: new Date().toISOString() },
    ];
    worldModelClient.hydrate({
      entities: [...worldModelClient.getAllEntities().filter(e => e.kind !== 'room'), ...entities],
      relations
    });

    // Agent 1 has ventureId 5, should target venture 5 room
    agentStateStore.set(1, createAgentState(1, 'WORKING', { ventureId: 5 }));

    system.update(ctx as any, 16);

    const motion1 = ctx.components.getComponent('char-1', 'motion');
    expect(motion1.target.x).toBe(600);
    expect(motion1.target.y).toBe(600);
  });

  it('Home room takes precedence over works_in when set', () => {
    // Set home room for character 1 to room 11
    const char1 = worldModelClient.getEntity(1001)!;
    const updatedChar1 = { ...char1, attributes: { homeRoom: 11 } };
    // Re-hydrate with updated character
    const allEntities = worldModelClient.getAllEntities().map(e => e.id === 1001 ? updatedChar1 : e);
    worldModelClient.hydrate({
      entities: allEntities,
      relations: [],
    });
    system.registerCharacter('char-1', updatedChar1, 1);

    agentStateStore.set(1, createAgentState(1, 'WORKING'));

    system.update(ctx as any, 16);

    const motion1 = ctx.components.getComponent('char-1', 'motion');
    // Should target room 11 (home room) not room 10 (works_in)
    expect(motion1.target.x).toBe(1200);
    expect(motion1.target.y).toBe(800);
  });

  it('Unregister character removes tracking', () => {
    agentStateStore.set(1, createAgentState(1, 'WORKING'));
    system.unregisterCharacter('char-1');

    system.update(ctx as any, 16);

    // char-1 should not be updated (target remains at initial hub position)
    const motion1 = ctx.components.getComponent('char-1', 'motion');
    expect(motion1.target.x).toBe(1000);
    expect(motion1.target.y).toBe(1000);
  });
});