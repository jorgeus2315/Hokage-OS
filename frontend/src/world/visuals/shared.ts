import * as PIXI from 'pixi.js';
import { COLOR } from './palette';

// Extraído verbatim de WorldCanvas.tsx — helpers compartidos por los 3
// tipos visuales (hub/room/token). Fase 2 del Plan de Migración ECS.

export function makeText(text: string, style: Partial<PIXI.TextStyleOptions>): PIXI.Text {
  return new PIXI.Text({
    text,
    style: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fill: COLOR.ink, ...style },
  });
}

// Marca un container como clicable (cursor + eventMode). El propio evento
// pointertap ya no se engancha aquí — desde la Fase 6, SelectionSystem es
// quien escucha el click, keyed por entidad vía el componente Selectable,
// no por un `__onClick` guardado en el container (patrón anterior).
export function makeInteractive(container: PIXI.Container): PIXI.Container {
  container.eventMode = 'static';
  container.cursor = 'pointer';
  return container;
}

export function octPoly(r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i * 45 + 22.5) * (Math.PI / 180);
    pts.push(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  return pts;
}

// Extraído verbatim de WorldCanvas.tsx — Fase 3 del Plan de Migración ECS.
// Usado por la animación de la barra de actividad de sala (desfase por id).
export function hashOffset(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return h / 1000;
}
