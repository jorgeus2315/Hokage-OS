import type * as PIXI from 'pixi.js';
import { ComponentKinds, type SelectableComponent } from '../ecs/components';
import type { ComponentStore } from '../ecs/ComponentStore';
import type { EntityId } from '../ecs/types';

// Formaliza el "click routing" que hoy vive como `withClick()` +
// `Object.assign(container, { __onClick })` — mismo comportamiento
// observable (un tap dispara el callback más reciente asignado a esa
// entidad), ahora respaldado por el componente Selectable ya declarado en
// el ECS desde la Fase 0, en vez de una propiedad `__onClick` sin tipar
// guardada directamente sobre el container. Fase 6 del Plan de Migración
// ECS. Alcance mínimo, sin funcionalidad nueva: sin hover, sin
// multi-selección, sin highlight — solo mueve quién escucha `pointertap`.
//
// NO implementa la interfaz System ni se registra vía ecs.addSystem() —
// mismo criterio que TTLSystem/ParticleSystem/CameraSystem: no hay ningún
// barrido por-frame que hacer, solo un listener que se engancha una vez
// por container y una lectura del componente en el momento del click.
export class SelectionSystem {
  // Engancha el listener pointertap UNA sola vez por container — lo llama
  // el bridge (WorldEngineBridge.setSelectable) la primera vez que ve una
  // entidad sin componente Selectable todavía, igual que
  // setVisualComponent()/RenderSyncSystem.ensure() distinguen "primera vez"
  // de "actualización". El listener lee el componente en el momento del
  // click, no en el momento de enganchar — así siempre dispara el
  // `onClick` más reciente, exactamente el mismo criterio que ya cumplía
  // `container.__onClick` (se sobrescribía cada frame vía Object.assign).
  bind(container: PIXI.Container, id: EntityId, components: ComponentStore): void {
    container.on('pointertap', () => {
      const selectable = components.getComponent<SelectableComponent>(id, ComponentKinds.Selectable);
      selectable?.onClick?.();
    });
  }
}
