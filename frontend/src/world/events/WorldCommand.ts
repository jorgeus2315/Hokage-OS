// Vocabulario cerrado de comandos hacia el mundo — mismo principio que
// AgentEventType en el backend (backend/src/config/eventBus.ts): añadir un
// comando nuevo es añadir una variante a la unión, nunca un canal nuevo.
//
// Fase 7 del Plan de Migración ECS: primera variante real ('ripple'),
// sustituye el placeholder genérico de la Fase 0. La firma pública que lo
// consume no cambia: WorldEngine.dispatch(command: WorldCommand) (§2 del
// plan) sigue aceptando cualquier WorldCommand — hoy nada la usa todavía
// (ver EventAdapter.ts para por qué), pero la forma queda lista.
//
// F1: Comandos de movimiento basados en estado real del agente.
export interface RippleCommand {
  kind: 'ripple';
  id: string;
  eventType: string;
  roomId: string;
}

export interface MoveToRoomCommand {
  kind: 'move_to_room';
  id: string;
  agentId: number;
  characterId: number;
  roomId: number;
  reason: 'work_started' | 'work_assigned' | 'handoff' | 'explicit';
}

export interface ReturnToHubCommand {
  kind: 'return_to_hub';
  id: string;
  agentId: number;
  characterId: number;
  reason: 'work_completed' | 'work_failed' | 'idle_timeout' | 'explicit';
}

export interface SetHomeRoomCommand {
  kind: 'set_home_room';
  id: string;
  characterId: number;
  roomId: number | null; // null = hub
}

export type WorldCommand =
  | RippleCommand
  | MoveToRoomCommand
  | ReturnToHubCommand
  | SetHomeRoomCommand;
