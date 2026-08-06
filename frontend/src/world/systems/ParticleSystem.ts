import type * as PIXI from 'pixi.js';
import { ComponentKinds, type PositionComponent, type ParticleComponent, type TtlComponent } from '../ecs/components';
import type { ComponentStore } from '../ecs/ComponentStore';
import type { ParticleEffectRegistry } from '../registries/ParticleEffectRegistry';

// Dibuja partículas efímeras (hoy: ripples de eventos) sobre un único
// PIXI.Graphics compartido, redibujado desde cero cada frame — mismo patrón
// que ya usaba WorldCanvas.tsx para `rippleGfx`. A diferencia de
// RenderSyncSystem (Fase 2), no hay un container Pixi por entidad: una
// partícula es una forma recalculada por edad cada frame, no un objeto
// persistente con estado propio.
//
// El Graphics lo crea y posiciona WorldCanvas.tsx, no este System — hace
// falta preservar exactamente el orden de addChild/z-order de las 6 capas
// de fondo (grid/trail/scan/ripple/orbit/spokes), ver Plan de Migración
// ECS §4 "Z-order silencioso". Si ParticleSystem creara su propio Graphics
// y lo insertara en el worldContainer, cambiaría ese orden.
//
// NO implementa la interfaz System y NO se registra vía ecs.addSystem() —
// decisión corregida el 2026-08-06 (ver "Deuda técnica resuelta" en el
// Plan de Migración ECS). Su único camino de ejecución es draw(), llamado
// síncronamente por el bridge (WorldEngine.syncParticles()), justo
// después de TTLSystem.prune(), en el mismo punto del frame donde
// WorldCanvas.tsx dibujaba los ripples antes. Registrarlo también como
// System hacía que engine.tick() lo ejecutara una segunda vez
// automáticamente cada frame — doble fuente de verdad para la misma
// responsabilidad, corregida eliminando el registro, no añadiendo una
// guarda de "ya dibujado este frame".
export class ParticleSystem {
  constructor(
    private gfx: PIXI.Graphics,
    private registry: ParticleEffectRegistry,
  ) {}

  // Asume que TTLSystem.prune() ya corrió este frame — cualquier entidad
  // todavía viva aquí tiene age < 1 por construcción, igual que el
  // `continue` tras `age >= 1` del código legacy.
  draw(components: ComponentStore): void {
    this.gfx.clear();
    const now = performance.now();
    for (const id of components.getEntitiesWith(ComponentKinds.Position, ComponentKinds.Particle, ComponentKinds.Ttl)) {
      const position = components.getComponent<PositionComponent>(id, ComponentKinds.Position);
      const particle = components.getComponent<ParticleComponent>(id, ComponentKinds.Particle);
      const ttl = components.getComponent<TtlComponent>(id, ComponentKinds.Ttl);
      if (!position || !particle || !ttl) continue;
      const effect = this.registry.get(particle.kind);
      if (!effect) continue;
      const age = (now - particle.startMs) / (ttl.expiresAtMs - particle.startMs);
      effect(this.gfx, position.pos, particle.color, age);
    }
  }
}
