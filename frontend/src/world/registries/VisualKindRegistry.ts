import type * as PIXI from 'pixi.js';

// Handle que un VisualKindDefinition crea/actualiza. `container` es el nodo
// Pixi raíz de la entidad; `refs` son las piezas internas que el código de
// animación (Fase 3, todavía en WorldCanvas.tsx) necesita seguir tocando —
// sustituye al patrón Object.assign(container, { __x }) de antes.
export interface VisualKindHandle {
  container: PIXI.Container;
  refs: Record<string, unknown>;
}

// Datos de identidad que RenderSyncSystem sincroniza cada tick — posición,
// color e texto. Todo lo que es animación (glow, pulsos, alpha dinámico)
// NO vive aquí — sigue en WorldCanvas.tsx hasta la Fase 3.
export interface VisualUpdateData {
  pos: { x: number; y: number };
  color: number;
  label: string;
  sublabel?: string;
}

export interface VisualKindDefinition {
  // Recibe los mismos datos que update() porque algunos tipos (sala) fijan
  // su color en construcción, no después — hub/token lo ignoran.
  create(data: VisualUpdateData): VisualKindHandle;
  update(handle: VisualKindHandle, data: VisualUpdateData): void;
}

// Registro de tipos visuales — sustituye progresivamente las funciones
// hardcodeadas (antes buildHub/buildRoom/buildToken llamadas directamente
// desde WorldCanvas.tsx). Añadir un tipo visual nuevo es registrar una
// entrada más aquí, nunca tocar RenderSyncSystem.
export class VisualKindRegistry {
  private kinds = new Map<string, VisualKindDefinition>();

  register(kind: string, def: VisualKindDefinition): void {
    this.kinds.set(kind, def);
  }

  get(kind: string): VisualKindDefinition | undefined {
    return this.kinds.get(kind);
  }
}
