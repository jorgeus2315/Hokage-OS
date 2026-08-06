import type * as PIXI from 'pixi.js';
import type { System, WorldContext } from '../ecs/System';
import { ComponentKinds, type PositionComponent, type VisualComponent } from '../ecs/components';
import type { ComponentStore } from '../ecs/ComponentStore';
import type { EntityId } from '../ecs/types';
import type { VisualKindRegistry, VisualKindHandle, VisualUpdateData } from '../registries/VisualKindRegistry';

// zIndex explícito por tipo — sustituye la dependencia del orden accidental
// de addChild. Las capas que no son entidades (grid/trail/scan/ripple/
// orbit/spokes) se quedan sin zIndex (0 implícito) en WorldCanvas.tsx, así
// que siguen dibujándose siempre por debajo de hub/sala/token sin tocarlas.
const Z_INDEX: Record<string, number> = { hub: 1, room: 2, token: 3 };

// Sincroniza entidades ECS (Position + Visual) con containers de PixiJS —
// crea, actualiza y destruye, generalizando el patrón que WorldCanvas.tsx
// tenía duplicado casi idéntico para salas y tokens. Fase 2 del Plan de
// Migración ECS. Es el único System que conoce PixiJS — MovementSystem
// (Fase 1) nunca lo toca, por diseño, y sigue sin tocarlo aquí.
export class RenderSyncSystem implements System {
  readonly name = 'renderSync';

  constructor(
    private worldContainer: PIXI.Container,
    private registry: VisualKindRegistry,
  ) {}

  // Crea (si hace falta) o actualiza el container Pixi de una entidad, de
  // forma SÍNCRONA — no espera al siguiente tick(). Es lo que llama el
  // bridge directamente para que WorldCanvas.tsx pueda seguir leyendo refs
  // en la misma pasada por entidad que ya usaba antes, sin tener que
  // reestructurar su ticker en "registrar → tick → animar".
  ensure(id: EntityId, kind: string, data: VisualUpdateData, components: ComponentStore): VisualKindHandle {
    const def = this.registry.get(kind);
    if (!def) throw new Error(`VisualKindRegistry: tipo '${kind}' no registrado`);

    const existing = components.getComponent<VisualKindHandle>(id, ComponentKinds.Render);
    if (existing) {
      def.update(existing, data);
      return existing;
    }
    const handle = def.create(data);
    handle.container.zIndex = Z_INDEX[kind] ?? 0;
    this.worldContainer.addChild(handle.container);
    components.addComponent(id, ComponentKinds.Render, handle);
    return handle;
  }

  // Barrido genérico del System — usa ensure() para cada entidad con
  // Position+Visual. En la práctica, hoy el bridge ya llama a ensure()
  // directamente por entidad antes de que esto corra, así que este bucle
  // no vuelve a crear nada — solo re-confirma que todo sigue sincronizado
  // (red de seguridad, no el camino primario).
  update(ctx: WorldContext, _dt: number): void {
    for (const id of ctx.components.getEntitiesWith(ComponentKinds.Position, ComponentKinds.Visual)) {
      const position = ctx.components.getComponent<PositionComponent>(id, ComponentKinds.Position);
      const visual = ctx.components.getComponent<VisualComponent>(id, ComponentKinds.Visual);
      if (!position || !visual) continue;
      const data = { pos: position.pos, color: visual.color, label: visual.label, sublabel: visual.sublabel };
      this.ensure(id, visual.kind, data, ctx.components);
    }
  }

  // Destrucción inmediata del lado Pixi — llamada DIRECTAMENTE por el
  // bridge (no a través de update()/tick()) en el mismo momento en que hoy
  // WorldCanvas.tsx hace world.removeChild(gfx); gfx.destroy(...). Tiene
  // que ser así: si se esperara al siguiente tick(), los componentes ya se
  // habrían borrado y se perdería la referencia al container que hay que
  // destruir.
  destroy(id: EntityId, components: ComponentStore): void {
    const handle = components.getComponent<VisualKindHandle>(id, ComponentKinds.Render);
    if (!handle) return;
    this.worldContainer.removeChild(handle.container);
    handle.container.destroy({ children: true });
    components.removeComponent(id, ComponentKinds.Render);
  }
}
