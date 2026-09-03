import type { WorldCommand, MoveToRoomCommand, ReturnToHubCommand, SetHomeRoomCommand, RippleCommand } from './WorldCommand';
import type { RippleEvent } from '../types';

// Formas mínimas estructurales — no importan Agent/Building/WsEvent de
// shared/types. world/ no conoce tipos de nivel app, mismo criterio ya
// establecido para CameraSystem.fitScene() (Fase 5): acepta lo que
// necesita por forma, no por import. Cualquier WsEvent/Agent/Building real
// del resto de la app encaja aquí por tipado estructural, sin cast.
export interface EventSource {
  _cid?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  // Backend events that carry agentId directly
  agentId?: number;
  workItemId?: number;
  // Payload for agent.state.changed
  payload?: {
    state?: { agentId: number; primary: string; ventureId: number | null; modifiers?: any; currentTask?: any; updatedAt: string };
    action?: string;
    characterId?: number;
    roomId?: number;
  };
}
export interface AgentLookup {
  id: number;
  name: string;
  role: string;
}
export interface RoomLookup {
  id: string;
  role: string;
  db_id?: number;
}
export interface CharacterLookup {
  id: number;
  agentId: number;
}

// State signature for delta detection (matches backend)
function stateSignature(s: { primary: string; modifiers?: any; currentTask?: any; ventureId: number | null }): string {
  return [
    s.primary,
    s.modifiers?.awaitingApproval ? 'A' : '',
    s.modifiers?.hasError ? 'E' : '',
    s.modifiers?.blocked ? 'B' : '',
    s.modifiers?.reviewing ? 'R' : '',
    s.currentTask?.workItemId ?? '',
    s.ventureId ?? '',
  ].join('|');
}

// Traduce eventos crudos del bus al vocabulario cerrado de WorldCommand.
// F1: Emite comandos de movimiento basados en eventos REALES del backend.
// - work_item.started → move_to_room
// - agent.state.changed (WORKING→IDLE/COMPLETED) → return_to_hub
// - decision.approved (config) → set_home_room
// - existing events → ripple (unchanged)
export function adaptEvents(
  events: EventSource[],
  agents: AgentLookup[],
  rooms: RoomLookup[],
  characters: CharacterLookup[]
): WorldCommand[] {
  const commands: WorldCommand[] = [];
  const previousStates = new Map<number, string>(); // agentId → signature

  for (const e of events.slice(0, 50)) {
    // 1. work_item.started → move_to_room
    if (e.type === 'work_item.started' && e.agentId !== undefined) {
      const agent = agents.find((a) => a.id === e.agentId);
      const character = characters.find((c) => c.agentId === e.agentId);
      const room = agent ? rooms.find((r) => r.role === agent.role) : undefined;
      if (agent && character && room) {
        const roomNumId = Number((room.db_id ?? (room.id.replace(/\D/g, '') || 10)));
        commands.push({
          kind: 'move_to_room',
          id: `move-${e.workItemId ?? e._cid ?? e.timestamp}`,
          agentId: agent.id,
          characterId: character.id,
          roomId: roomNumId,
          reason: 'work_started',
        } satisfies MoveToRoomCommand);
      }
      continue;
    }

    // 2. agent.state.changed → detect transition WORKING → IDLE/COMPLETED → return_to_hub
    if (e.type === 'agent.state.changed' && e.payload?.state) {
      const curr = e.payload.state;
      const agentId = curr.agentId;
      const prevSig = previousStates.get(agentId);
      const currSig = stateSignature(curr);

      // Check if transitioned from WORKING to IDLE/COMPLETED
      const wasWorking = prevSig?.startsWith('WORKING|');
      const nowIdleOrCompleted = curr.primary === 'IDLE' || curr.primary === 'COMPLETED';

      if (wasWorking && nowIdleOrCompleted) {
        const character = characters.find((c) => c.agentId === agentId);
        if (character) {
          commands.push({
            kind: 'return_to_hub',
            id: `return-${agentId}-${curr.updatedAt ?? Date.now()}`,
            agentId,
            characterId: character.id,
            reason: curr.primary === 'COMPLETED' ? 'work_completed' : 'idle_timeout',
          } satisfies ReturnToHubCommand);
        }
      }

      // Update previous state for next event
      previousStates.set(agentId, currSig);
      continue;
    }

    // 3. decision.approved with config action → set_home_room
    if (e.type === 'decision.approved' && e.payload?.action === 'set_home_room') {
      const characterId = e.payload.characterId as number | undefined;
      const roomId = e.payload.roomId as number | undefined;
      if (characterId !== undefined) {
        commands.push({
          kind: 'set_home_room',
          id: `home-${characterId}-${e._cid ?? e.timestamp}`,
          characterId,
          roomId: roomId ?? null,
        } satisfies SetHomeRoomCommand);
      }
      continue;
    }

    // 4. Existing ripple logic (unchanged) — maps by agent name → role → room
    const agent = agents.find((a) => a.name === e.from);
    const room = agent ? rooms.find((r) => r.role === agent.role) : undefined;
    if (room) {
      commands.push({
        kind: 'ripple',
        id: e._cid ?? `${e.type ?? ''}-${e.from ?? ''}-${e.timestamp ?? ''}`,
        eventType: e.type ?? '',
        roomId: String(room.id),
      } satisfies RippleCommand);
    }
  }
  return commands;
}

// Traduce el vocabulario cerrado de WorldCommand al contrato público que
// WorldCanvas.tsx sigue consumiendo (RippleEvent[], sin cambios desde
// antes de esta fase). Hoy solo existe la variante 'ripple' que mapea
// directamente; los comandos de movimiento son consumidos por BehaviorSystem
// vía WorldEngine.dispatch, no por este mapeo.
export function commandsToRippleEvents(commands: WorldCommand[]): RippleEvent[] {
  return commands
    .filter((c): c is RippleCommand => c.kind === 'ripple')
    .map((c) => ({ id: c.id, type: c.eventType, roomId: c.roomId }));
}
