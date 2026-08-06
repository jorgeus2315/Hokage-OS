import type { ParticleEffect } from '../registries/ParticleEffectRegistry';

// Room dimensions — mismo valor que RW/RH en room.ts y WorldCanvas.tsx (ver
// nota de duplicación heredada de la Fase 2: el ripple usa el tamaño fijo
// de sala, no el de la sala concreta que lo originó).
const RW = 154, RH = 104;

// Ripple — extraído verbatim del bucle de WorldCanvas.tsx: dos anillos
// escalonados (offset 0.28 en edad) que se expanden y se desvanecen a lo
// largo de la vida de la partícula. Fase 4 del Plan de Migración ECS.
export const rippleEffect: ParticleEffect = (gfx, pos, color, age) => {
  for (let ring = 0; ring < 2; ring++) {
    const ringAge = Math.min(1, age + ring * 0.28);
    if (ringAge >= 1) continue;
    const scale = 1 + ringAge * 2.6;
    const alpha = (1 - ringAge) * (ring === 0 ? 0.55 : 0.22);
    gfx
      .roundRect(pos.x - (RW * scale) / 2, pos.y - (RH * scale) / 2, RW * scale, RH * scale, 4 * scale)
      .stroke({ width: ring === 0 ? 1.5 : 0.8, color, alpha });
  }
};
