import { ComponentKinds, type TtlComponent } from '../ecs/components';
import type { EntityStore } from '../ecs/EntityStore';
import type { ComponentStore } from '../ecs/ComponentStore';

// Destruye cualquier entidad con componente Ttl cuyo expiresAtMs ya pasó —
// genérico, no sabe nada de partículas ni de ripples en particular. Sustituye
// el array `ripples: Ripple[]` + `age >= 1` que hoy vive en WorldCanvas.tsx
// por un mecanismo reutilizable para cualquier entidad temporal futura.
// Fase 4 del Plan de Migración ECS.
//
// NO implementa la interfaz System y NO se registra vía ecs.addSystem() —
// decisión corregida el 2026-08-06 (ver "Deuda técnica resuelta" en el
// Plan de Migración ECS). Su único camino de ejecución es prune(),
// llamado síncronamente por el bridge (WorldEngine.syncParticles()) en el
// mismo punto del frame donde el código legacy comprobaba `age >= 1`
// antes de dibujar. Registrarlo también como System hacía que
// engine.tick() lo ejecutara una segunda vez automáticamente cada
// frame — doble fuente de verdad para la misma responsabilidad, corregida
// eliminando el registro, no añadiendo una guarda.
export class TTLSystem {
  prune(entities: EntityStore, components: ComponentStore): void {
    const now = performance.now();
    for (const id of components.getEntitiesWith(ComponentKinds.Ttl)) {
      const ttl = components.getComponent<TtlComponent>(id, ComponentKinds.Ttl);
      if (ttl && now >= ttl.expiresAtMs) {
        components.removeAllForEntity(id);
        entities.destroyEntity(id);
      }
    }
  }
}
