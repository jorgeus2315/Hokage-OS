// Vocabulario cerrado de comandos hacia el mundo — mismo principio que
// AgentEventType en el backend (backend/src/config/eventBus.ts): añadir un
// comando nuevo es añadir una variante a la unión, nunca un canal nuevo.
//
// Fase 7 del Plan de Migración ECS: primera variante real ('ripple'),
// sustituye el placeholder genérico de la Fase 0. La firma pública que lo
// consume no cambia: WorldEngine.dispatch(command: WorldCommand) (§2 del
// plan) sigue aceptando cualquier WorldCommand — hoy nada la usa todavía
// (ver EventAdapter.ts para por qué), pero la forma queda lista.
export interface RippleCommand {
  kind: 'ripple';
  id: string;
  eventType: string;
  roomId: string;
}

export type WorldCommand = RippleCommand;
