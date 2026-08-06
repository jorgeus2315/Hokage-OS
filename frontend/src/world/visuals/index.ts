import type { VisualKindRegistry } from '../registries/VisualKindRegistry';
import type { AnimationRegistry } from '../registries/AnimationRegistry';
import type { ParticleEffectRegistry } from '../registries/ParticleEffectRegistry';
import { hubVisualKind, hubAnimation } from './hub';
import { roomVisualKind, roomAnimation } from './room';
import { tokenVisualKind, tokenAnimation } from './token';
import { rippleEffect } from './particles';

export * from './palette';
export * from './shared';
export { hubVisualKind, hubAnimation } from './hub';
export { roomVisualKind, roomAnimation, type RoomAnimationState } from './room';
export { tokenVisualKind, tokenAnimation, type TokenAnimationState } from './token';
export { rippleEffect } from './particles';

// Registra los 3 tipos visuales que hoy existen (extraídos de
// WorldCanvas.tsx, Fase 2). Un tipo visual nuevo se añade aquí, nunca
// tocando RenderSyncSystem.
export function registerCoreVisualKinds(registry: VisualKindRegistry): void {
  registry.register('hub', hubVisualKind);
  registry.register('room', roomVisualKind);
  registry.register('token', tokenVisualKind);
}

// Registra los 3 comportamientos de animación que hoy existen (extraídos de
// WorldCanvas.tsx, Fase 3). Un tipo visual nuevo añade su animación aquí,
// nunca tocando AnimationSystem.
export function registerCoreAnimations(registry: AnimationRegistry): void {
  registry.register('hub', hubAnimation);
  registry.register('room', roomAnimation);
  registry.register('token', tokenAnimation);
}

// Registra el único efecto de partícula que hoy existe (extraído de
// WorldCanvas.tsx, Fase 4). Un efecto nuevo se añade aquí, nunca tocando
// ParticleSystem.
export function registerCoreParticleEffects(registry: ParticleEffectRegistry): void {
  registry.register('ripple', rippleEffect);
}
