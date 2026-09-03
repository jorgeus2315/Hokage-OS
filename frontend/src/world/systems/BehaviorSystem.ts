// BehaviorSystem — Single authority for deciding Motion.target for entities with Motion component.
// Uses ONLY real backend state (AgentRuntimeState via AgentStateStore) and world model data (WorldModelClient).
// No Math.random, no timers, no heuristics. Pure deterministic mapping: state + world model → target.

import type { System, WorldContext } from '../ecs/System';
import { ComponentKinds, type MotionComponent } from '../ecs/components';
import { agentStateStore } from '../state/AgentStateStore';
import { worldModelClient } from '../client/WorldModelClient';
import type { WorldEntityDto } from '../client/WorldModelClient';

interface CharacterMapping {
  entityId: string;           // ECS entity id (e.g., 'char-42')
  characterEntity: WorldEntityDto;  // world_entities row (kind='character')
  agentId: number;            // agent_id from ref_id
}

export class BehaviorSystem implements System {
  readonly name = 'behavior';
  private characterMappings = new Map<string, CharacterMapping>(); // ECS entityId → mapping
  private hubPosition: { x: number; y: number } | null = null;

  // Called by WorldEngineBridge when character entities are created/updated
  registerCharacter(ecsEntityId: string, characterEntity: WorldEntityDto, agentId: number): void {
    this.characterMappings.set(ecsEntityId, { entityId: ecsEntityId, characterEntity, agentId });
    this.updateHubPosition();
  }

  // Called when character is removed
  unregisterCharacter(ecsEntityId: string): void {
    this.characterMappings.delete(ecsEntityId);
  }

  // Update hub position from world model
  private updateHubPosition(): void {
    const hub = worldModelClient.getHub();
    if (hub) {
      const pos = worldModelClient.getPosition(hub.id);
      if (pos) this.hubPosition = pos;
    }
  }

  // Determine target position for a character based on agent state
  private calculateTarget(agentId: number, characterEntity: WorldEntityDto): { x: number; y: number } | null {
    const agentState = agentStateStore.get(agentId);

    // No agent state available → safe default: hub
    if (!agentState) {
      return this.hubPosition ?? null;
    }

    const primary = agentState.primary;
    const ventureId = agentState.ventureId;

    // Get character's assigned room (works_in relation or homeRoom attribute)
    let room: WorldEntityDto | undefined;
    const assignedRoom = worldModelClient.getRoomForCharacter(characterEntity.id);
    const homeRoom = worldModelClient.getHomeRoomForCharacter(characterEntity.id);
    room = assignedRoom ?? homeRoom;

    // Filter room by venture if needed
    if (room && ventureId !== null && room.ventureId !== ventureId) {
      room = undefined;
    }

    switch (primary) {
      case 'WORKING':
        // Agent is actively working → target is their room
        if (room) {
          const pos = worldModelClient.getPosition(room.id);
          if (pos) return pos;
        }
        // Fallback: hub if no room found (should not happen in normal operation)
        return this.hubPosition ?? null;

      case 'COMPLETED':
      case 'IDLE':
        // Work done or no work → return to hub orbit
        return this.hubPosition ?? null;

      case 'ERROR':
        // Error state → stay in room (if has one), else hub
        if (room) {
          const pos = worldModelClient.getPosition(room.id);
          if (pos) return pos;
        }
        return this.hubPosition ?? null;

      default:
        // THINKING, RESEARCHING, WAITING, REVIEWING, COMMUNICATING, MOVING
        // Treat as idle-ish → hub orbit (conservative, no invented movement)
        return this.hubPosition ?? null;
    }
  }

  update(ctx: WorldContext, _dt: number): void {
    // Update hub position in case it changed
    this.updateHubPosition();

    // Process all entities that have Motion component (tokens/characters)
    for (const ecsEntityId of ctx.components.getEntitiesWith(ComponentKinds.Motion)) {
      const mapping = this.characterMappings.get(ecsEntityId);
      if (!mapping) continue; // Not a character we track (e.g., particle)

      const motion = ctx.components.getComponent<MotionComponent>(ecsEntityId, ComponentKinds.Motion);
      if (!motion) continue;

      const target = this.calculateTarget(mapping.agentId, mapping.characterEntity);
      if (target) {
        // Mutate target in place (same object reference as MotionComponent.target)
        motion.target.x = target.x;
        motion.target.y = target.y;
      }
    }
  }
}