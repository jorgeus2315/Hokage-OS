import type { System, WorldContext } from '../ecs/System';
import { ComponentKinds, type PositionComponent, type MotionComponent } from '../ecs/components';

// Migrado verbatim desde el WorldEngine legacy (../WorldEngine.ts, tick()):
// mismo EASE, mismo TRAIL_EVERY/TRAIL_MAX, misma matemática de lerp y
// trail. Única diferencia real: opera sobre componentes del ECS
// (Position/Motion) en vez de un Map<string, WorldNode> privado. Nunca
// importa ni conoce PIXI — ese es el contrato de Fase 1 (Plan de Migración
// ECS, vault 02_Sistemas/World Engine/).
const EASE = 0.06;
const TRAIL_EVERY = 5;
const TRAIL_MAX = 7;

export class MovementSystem implements System {
  readonly name = 'movement';
  private frame = 0;

  update(ctx: WorldContext, _dt: number): void {
    this.frame++;
    const recordTrail = this.frame % TRAIL_EVERY === 0;

    for (const id of ctx.components.getEntitiesWith(ComponentKinds.Position, ComponentKinds.Motion)) {
      const position = ctx.components.getComponent<PositionComponent>(id, ComponentKinds.Position);
      const motion = ctx.components.getComponent<MotionComponent>(id, ComponentKinds.Motion);
      if (!position || !motion) continue;

      if (recordTrail) {
        motion.trail.push({ ...position.pos });
        if (motion.trail.length > TRAIL_MAX) motion.trail.shift();
      }
      position.pos.x += (motion.target.x - position.pos.x) * EASE;
      position.pos.y += (motion.target.y - position.pos.y) * EASE;
    }
  }
}
