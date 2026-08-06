import type { EntityStore } from './EntityStore';
import type { ComponentStore } from './ComponentStore';
import type { WorldCommand } from '../events/WorldCommand';

// Contexto de solo-lectura + dispatch que cada System recibe en update().
// Deliberadamente NO expone el WorldEngine completo — un System nunca llama
// a otro System directamente, solo lee entidades/componentes y encola
// comandos. Evita acoplar Systems entre sí según crezcan (Fases 1-7).
export interface WorldContext {
  entities: EntityStore;
  components: ComponentStore;
  // Tiempo transcurrido en segundos desde que arrancó el motor — mismo `t`
  // que hoy calcula WorldCanvas.tsx como `performance.now() / 1000`.
  elapsedSec: number;
  // Comandos encolados en el tick anterior, listos para que este System los
  // procese si le corresponde (ninguno lo hace todavía — Fase 7).
  commands: readonly WorldCommand[];
  // Encola un comando para el próximo tick.
  dispatch(command: WorldCommand): void;
}

export interface System {
  readonly name: string;
  update(ctx: WorldContext, dt: number): void;
}
