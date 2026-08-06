import type { System, WorldContext } from '../ecs/System';
import { ComponentKinds, type VisualComponent, type AnimationComponent } from '../ecs/components';
import type { VisualKindHandle } from '../registries/VisualKindRegistry';
import type { AnimationRegistry } from '../registries/AnimationRegistry';

// Anima los refs Pixi que RenderSyncSystem (Fase 2) ya creó — generaliza
// los ~9 bloques de animación por fórmula de tiempo que hoy viven en
// WorldCanvas.tsx (glow del hub; alert/active dot, glow, fill, barra de
// actividad y pulse ring de sala; ring, ringOuter y burbuja de acción de
// token). Fase 3 del Plan de Migración ECS.
//
// Mismo patrón que RenderSyncSystem: animate() es el método SÍNCRONO que
// llama el bridge directamente, una vez por entidad, en la misma pasada
// donde WorldCanvas.tsx ya tenía el código de animación — así no hace
// falta esperar a tick() ni reestructurar el ticker en más fases de las
// que ya tiene desde la Fase 2. update() es un barrido genérico por si
// algún día algo persiste un componente Animation real — hoy nada lo hace
// (el bridge llama a animate() directo), así que en la práctica no
// recorre nada.
//
// Deliberadamente NO usa ctx.elapsedSec — ese contador es frame-count, no
// tiempo real (ver Plan de Migración ECS, nota de la Fase 1). Usar
// performance.now()/1000, exactamente como hace WorldCanvas.tsx hoy,
// evita cualquier riesgo de desfase de fase/velocidad en las animaciones.
export class AnimationSystem implements System {
  readonly name = 'animation';

  constructor(private registry: AnimationRegistry) {}

  animate(kind: string, refs: Record<string, unknown>, state: Record<string, unknown>, t: number): void {
    const behavior = this.registry.get(kind);
    if (!behavior) return;
    behavior(refs, state, t);
  }

  update(ctx: WorldContext, _dt: number): void {
    const t = performance.now() / 1000;
    for (const id of ctx.components.getEntitiesWith(ComponentKinds.Visual, ComponentKinds.Render, ComponentKinds.Animation)) {
      const visual = ctx.components.getComponent<VisualComponent>(id, ComponentKinds.Visual);
      const render = ctx.components.getComponent<VisualKindHandle>(id, ComponentKinds.Render);
      const anim = ctx.components.getComponent<AnimationComponent & { state?: Record<string, unknown> }>(id, ComponentKinds.Animation);
      if (!visual || !render || !anim) continue;
      this.animate(visual.kind, render.refs, anim.state ?? {}, t);
    }
  }
}
