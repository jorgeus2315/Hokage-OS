import type { ReactNode } from 'react';

// Mismo patrón que VisualKindRegistry del ECS (world/registries/VisualKindRegistry.ts):
// el motor (aquí, GameLayout.tsx) no conoce qué pantallas existen — solo pide "la
// definición de esta clave" y monta lo que le devuelva. Añadir un overlay nuevo es
// una entrada de registro más, nunca una rama condicional nueva en el JSX.
// Fase 4 de UI Implementation Plan.md: solo describe qué se monta — el estado
// (qué overlay está abierto) sigue siendo React local hasta la Fase 5.
export interface PanelDefinition {
  title: string;
  render: () => ReactNode;
}

export class PanelRegistry<K extends string> {
  private panels = new Map<K, PanelDefinition>();

  register(key: K, def: PanelDefinition): void {
    this.panels.set(key, def);
  }

  get(key: K): PanelDefinition | undefined {
    return this.panels.get(key);
  }
}
