import type { Vec2 } from '../types';

// Claves de componente conocidas — constantes para evitar typos de string
// sueltos. ComponentKind sigue siendo `string` (ver types.ts): un System
// futuro puede introducir un componente nuevo sin tocar EntityStore ni
// ComponentStore, igual que un evento nuevo se añade al union de
// AgentEventType sin tocar el Event Bus (backend/src/config/eventBus.ts).
export const ComponentKinds = {
  Position: 'position',
  Motion: 'motion',
  Visual: 'visual',
  Render: 'render',
  Animation: 'animation',
  Ttl: 'ttl',
  Particle: 'particle',
  Selectable: 'selectable',
} as const;

// Forma que usará MovementSystem (Fase 1) — equivalente a WorldNode.pos hoy.
export interface PositionComponent {
  pos: Vec2;
}

// Forma que usará MovementSystem (Fase 1) — equivalente a WorldNode.target/trail hoy.
export interface MotionComponent {
  target: Vec2;
  trail: Vec2[];
}

// Usado por RenderSyncSystem/VisualKindRegistry (Fase 2) para resolver qué
// constructor Pixi crea/actualiza esta entidad (hub/room/token). `sublabel`
// añadido en Fase 2 — hub y sala lo necesitan, no estaba en el boceto de
// Fase 0.
export interface VisualComponent {
  kind: string;
  color: number;
  label: string;
  sublabel?: string;
}

// Sustituye al patrón Object.assign(container, { __label, __glow, ... }) de
// hoy (Fase 2/3/9) — referencias Pixi ya creadas para esta entidad. Tipado
// como unknown a propósito: el ECS no depende de PIXI, quien lo consume
// (los Systems de render/animación) sí.
export interface RenderComponent {
  container: unknown;
  refs: Record<string, unknown>;
}

// Estado mínimo que AnimationSystem (Fase 3) necesita por entidad — el
// detalle de cada fórmula de pulso vive en el System, no aquí.
export interface AnimationComponent {
  phase: number;
}

// Usado por TTLSystem (Fase 4) — cualquier entidad con este componente se
// autodestruye al cumplirse expiresAtMs. Genérico: no sabe nada de
// partículas, sirve para cualquier entidad temporal futura.
export interface TtlComponent {
  expiresAtMs: number;
}

// Usado por ParticleSystem (Fase 4) — junto a Position y Ttl describe una
// partícula efímera (hoy: 'ripple'). `startMs` + el `expiresAtMs` del Ttl
// emparejado son suficientes para derivar la edad (0→1) en el momento de
// dibujar — no se guarda una duración redundante aquí.
export interface ParticleComponent {
  kind: string;
  color: number;
  startMs: number;
}

// Usado por SelectionSystem (Fase 6) — mismo criterio de "siempre el
// callback más reciente" que ya usa el patrón __onClick de hoy.
export interface SelectableComponent {
  onClick?: () => void;
}
