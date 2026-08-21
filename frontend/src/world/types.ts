import type { AgentPrimaryState } from '../shared/types';

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
  active: boolean;        // agente trabajando activamente ahora mismo
  activityLevel: number;  // 0–1: actividad real del runtime (work_items in_progress, K.4) — glow y densidad de spokes
  hasError: boolean;      // último run terminó en error → borde/glow ámbar
  color: number;
  onClick: () => void;
}

export interface TokenDescriptor {
  id: string;
  x: number;
  y: number;
  label: string;        // nombre del agente (badge sobre el token)
  role: string;         // Slice 1 — rol canónico: color de cuerpo + monograma + leyenda
  color: number;        // Slice 1 — color de identidad (departamento/rol); fallback inkDim
  working: boolean;
  justActed?: boolean;  // actuó en los últimos 30s — animación intensa
  action?: string;      // texto de la acción actual
  // Slice 1 — datos REALES para el tooltip (opcionales; el backend no siempre los emite).
  // No se inventan `tool` ni estados finos: primary hoy solo toma WORKING/IDLE/COMPLETED/ERROR.
  model?: string | null;         // Agent.model — modelo LLM del agente
  primary?: AgentPrimaryState;   // AgentRuntimeState.primary
  kind?: string;                 // AgentRuntimeState.currentTask.kind (tipo de work_item)
  hasError?: boolean;            // AgentRuntimeState.modifiers.hasError
  awaitingApproval?: boolean;    // AgentRuntimeState.modifiers.awaitingApproval
  onClick?: () => void;
}

export interface RippleEvent {
  id: string;         // id único para deduplicar
  type: string;       // agent.task.done, decision.created, etc.
  roomId?: string;    // id del edificio donde emitir el ripple
}
