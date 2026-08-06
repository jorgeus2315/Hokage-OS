import * as PIXI from 'pixi.js';
import { COLOR } from './palette';
import { makeText, makeInteractive, octPoly } from './shared';
import type { VisualKindDefinition, VisualKindHandle, VisualUpdateData } from '../registries/VisualKindRegistry';
import type { AnimationBehavior } from '../registries/AnimationRegistry';

// Construcción extraída VERBATIM de WorldCanvas.tsx (buildHub original) —
// ni un trazo, número o alpha cambiado. Fase 2 del Plan de Migración ECS.
// Devuelve los refs directamente (sin pasar por Object.assign(container,
// {__x}) + cast) desde la Fase 9 — el patrón de guardar referencias en
// propiedades del container era exactamente lo que el ECS sustituye.
function buildHubContainer(): { container: PIXI.Container; label: PIXI.Text; sublabel: PIXI.Text; glow: PIXI.Graphics } {
  const container = makeInteractive(new PIXI.Container());
  container.label = 'hub';
  container.hitArea = new PIXI.Circle(0, 0, 72);

  const glow = new PIXI.Graphics()
    .poly(octPoly(90))
    .stroke({ width: 18, color: COLOR.ember, alpha: 0.12 });

  const outerRing = new PIXI.Graphics()
    .poly(octPoly(76))
    .stroke({ width: 1, color: COLOR.emberDim, alpha: 0.6 });

  const crosshair = new PIXI.Graphics()
    .moveTo(-100, 0).lineTo(100, 0).stroke({ width: 0.5, color: COLOR.ember, alpha: 0.15 })
    .moveTo(0, -100).lineTo(0, 100).stroke({ width: 0.5, color: COLOR.ember, alpha: 0.15 });

  const main = new PIXI.Graphics()
    .poly(octPoly(62))
    .fill(COLOR.panel)
    .stroke({ width: 2, color: COLOR.ember });

  const innerRing = new PIXI.Graphics()
    .poly(octPoly(50))
    .stroke({ width: 0.5, color: COLOR.ember, alpha: 0.35 });

  // Interior grid lines
  const interiorGrid = new PIXI.Graphics();
  for (let i = -40; i <= 40; i += 14) {
    interiorGrid.moveTo(-55, i).lineTo(55, i).stroke({ width: 0.4, color: COLOR.ember, alpha: 0.12 });
  }

  const label = makeText('', { fontSize: 12, fontWeight: '700', letterSpacing: 2.5, fill: COLOR.ink });
  label.anchor.set(0.5);
  label.position.set(0, -8);

  const sublabel = makeText('', { fontSize: 7.5, fill: COLOR.inkFaint, letterSpacing: 1.8 });
  sublabel.anchor.set(0.5);
  sublabel.position.set(0, 10);

  container.addChild(glow, crosshair, outerRing, main, innerRing, interiorGrid, label, sublabel);
  return { container, label, sublabel, glow };
}

// Wrapper VisualKindDefinition — la parte NUEVA de la Fase 2. create()
// llama a la construcción verbatim de arriba. update() hace exactamente lo
// que WorldCanvas.tsx hacía cada frame para posición/label/sublabel del
// hub; el glow es animación (ver hubAnimation, Fase 3).
export const hubVisualKind: VisualKindDefinition = {
  create(_data: VisualUpdateData): VisualKindHandle {
    const { container, label, sublabel, glow } = buildHubContainer();
    return {
      container,
      refs: { label, sublabel, glow },
    };
  },
  update(handle: VisualKindHandle, data: VisualUpdateData): void {
    handle.container.position.set(data.pos.x, data.pos.y);
    const refs = handle.refs as { label: PIXI.Text; sublabel: PIXI.Text };
    refs.label.text = data.label;
    refs.sublabel.text = data.sublabel ?? '';
  },
};

// Animación del hub — extraída verbatim del bucle de WorldCanvas.tsx. Único
// elemento animado del hub: el glow respira con un seno. Fase 3 del Plan de
// Migración ECS.
export const hubAnimation: AnimationBehavior = (refs, _state, t) => {
  const r = refs as { glow: PIXI.Graphics };
  r.glow.alpha = 0.45 + 0.55 * Math.sin(t * 1.3);
};
