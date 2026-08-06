import type { WorldCommand } from './WorldCommand';
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
}
export interface AgentLookup {
  name: string;
  role: string;
}
export interface RoomLookup {
  id: string;
  role: string;
}

// Traduce eventos crudos del bus al vocabulario cerrado de WorldCommand —
// extraído verbatim de la lógica que vivía inline en useWorldState.ts
// (resuelve agente→rol→sala por nombre, descarta eventos sin sala
// asociada). Fase 7 del Plan de Migración ECS.
export function adaptEvents(events: EventSource[], agents: AgentLookup[], rooms: RoomLookup[]): WorldCommand[] {
  const commands: WorldCommand[] = [];
  for (const e of events.slice(0, 30)) {
    const agent = agents.find((a) => a.name === e.from);
    const room = agent ? rooms.find((r) => r.role === agent.role) : undefined;
    if (!room) continue;
    commands.push({
      kind: 'ripple',
      id: e._cid ?? `${e.type ?? ''}-${e.from ?? ''}-${e.timestamp ?? ''}`,
      eventType: e.type ?? '',
      roomId: room.id,
    });
  }
  return commands;
}

// Traduce el vocabulario cerrado de WorldCommand al contrato público que
// WorldCanvas.tsx sigue consumiendo (RippleEvent[], sin cambios desde
// antes de esta fase). Hoy solo existe la variante 'ripple' — una función
// plana es la forma honesta de expresar eso; construir un Registry para un
// único caso sería la misma sobre-ingeniería que ya se evitó al cerrar la
// deuda técnica de la Fase 4. Cuando exista una segunda variante real, este
// mapeo crece a un `switch`/tabla — decisión de esa fase, no de esta.
export function commandsToRippleEvents(commands: WorldCommand[]): RippleEvent[] {
  return commands.map((c) => ({ id: c.id, type: c.eventType, roomId: c.roomId }));
}
