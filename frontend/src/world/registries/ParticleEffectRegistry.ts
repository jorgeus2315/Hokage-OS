import type * as PIXI from 'pixi.js';
import type { Vec2 } from '../types';

// Dibuja una partícula de un `kind` dado sobre un Graphics compartido, dada
// su posición, color y edad (0→1, 0 = recién creada, 1 = a punto de
// expirar). No devuelve nada — dibuja directamente, igual que
// AnimationBehavior (Fase 3) muta refs Pixi directamente.
export type ParticleEffect = (gfx: PIXI.Graphics, pos: Vec2, color: number, age: number) => void;

// Registro de efectos de partícula — mismo patrón exacto que
// VisualKindRegistry (Fase 2) y AnimationRegistry (Fase 3): tabla
// `kind → comportamiento`. Un efecto nuevo (ej. una explosión de "venta
// completada" distinta del ripple genérico) se registra aquí, nunca
// tocando ParticleSystem.
export class ParticleEffectRegistry {
  private effects = new Map<string, ParticleEffect>();

  register(kind: string, effect: ParticleEffect): void {
    this.effects.set(kind, effect);
  }

  get(kind: string): ParticleEffect | undefined {
    return this.effects.get(kind);
  }
}
