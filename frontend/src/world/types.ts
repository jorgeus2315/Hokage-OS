export interface Vec2 {
  x: number;
  y: number;
}

export interface WorldNode {
  id: string;
  pos: Vec2;
  target: Vec2;
  color: number;
  label: string;
  trail: Vec2[];  // historial de posiciones para trail de movimiento
}

export interface HubDescriptor {
  label: string;
  sublabel: string;
  x: number;
  y: number;
  onClick: () => void;
}

export interface RoomDescriptor {
  id: string;
  x: number;
  y: number;
  label: string;
  sublabel: string;
  pending: boolean;
  active: boolean;  // agente trabajando activamente aquí ahora mismo
  color: number;
  onClick: () => void;
}

export interface TokenDescriptor {
  id: string;
  x: number;
  y: number;
  label: string;
  working: boolean;
  justActed?: boolean;  // actuó en los últimos 30s — animación intensa
  action?: string;      // texto de la acción actual
  onClick?: () => void;
}

export interface RippleEvent {
  id: string;         // id único para deduplicar
  type: string;       // agent.task.done, decision.created, etc.
  roomId?: string;    // id del edificio donde emitir el ripple
}
