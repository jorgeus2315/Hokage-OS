import * as PIXI from 'pixi.js';
import { COLOR } from './palette';
import { makeText, makeInteractive } from './shared';
import type { VisualKindDefinition, VisualKindHandle, VisualUpdateData } from '../registries/VisualKindRegistry';
import type { AnimationBehavior } from '../registries/AnimationRegistry';

// Construcción extraída VERBATIM de WorldCanvas.tsx (buildToken original) —
// ni un trazo, número o alpha cambiado. Fase 2 del Plan de Migración ECS.
// Devuelve los refs directamente desde la Fase 9 — sin Object.assign(container,
// {__x}) + cast.
function buildTokenContainer(): {
  container: PIXI.Container; ring: PIXI.Graphics; ringOuter: PIXI.Graphics; diamond: PIXI.Graphics;
  label: PIXI.Text; tip: PIXI.Text; bubble: PIXI.Graphics; nameText: PIXI.Text; nameBg: PIXI.Graphics;
} {
  const container = makeInteractive(new PIXI.Container());
  container.label = 'token';
  const sz = 13;
  container.hitArea = new PIXI.Circle(0, 0, sz * 2.2);

  // Outer aura (justActed)
  const ringOuter = new PIXI.Graphics()
    .circle(0, 0, sz * 2.4)
    .stroke({ width: 1, color: 0xffffff });
  ringOuter.alpha = 0;

  // Inner pulsing ring (working)
  const ring = new PIXI.Graphics()
    .circle(0, 0, sz * 1.7)
    .stroke({ width: 1.5, color: 0xffffff });
  ring.alpha = 0;

  // Main circle body
  const diamond = new PIXI.Graphics()  // named diamond for backward compat
    .circle(0, 0, sz)
    .fill(0xffffff);

  // Inner depth dot
  const innerDot = new PIXI.Graphics()
    .circle(0, 0, sz * 0.38)
    .fill({ color: 0x000000, alpha: 0.4 });

  // Initial letter
  const label = makeText('', { fontSize: 9, fontWeight: '700', fill: 0x060809 });
  label.anchor.set(0.5);

  // Name badge background (pill shape)
  const nameBg = new PIXI.Graphics();

  // Name text above
  const nameText = makeText('', { fontSize: 7.5, fontWeight: '600', fill: COLOR.ink });
  nameText.anchor.set(0.5);
  nameText.position.set(0, -sz - 12);

  // Action text + bubble below
  const tip = makeText('', { fontSize: 7, fill: COLOR.inkDim });
  tip.anchor.set(0.5);
  tip.position.set(0, sz + 10);

  const bubble = new PIXI.Graphics();
  bubble.visible = false;

  container.addChild(ringOuter, ring, diamond, innerDot, label, nameBg, nameText, bubble, tip);
  return { container, ring, ringOuter, diamond, label, tip, bubble, nameText, nameBg };
}

// Wrapper VisualKindDefinition. create() ignora data (buildToken no toma
// argumentos, igual que antes — el color se aplica vía tint en update()).
// update() hace exactamente lo que WorldCanvas.tsx hacía cada frame para
// posición/tint/label/nombre de un token — el resto (ring de pulso,
// rotación, burbuja de acción) es animación y se queda en WorldCanvas
// hasta la Fase 3, leyendo estos mismos refs.
export const tokenVisualKind: VisualKindDefinition = {
  create(_data: VisualUpdateData): VisualKindHandle {
    const { container, ...refs } = buildTokenContainer();
    return { container, refs };
  },
  update(handle: VisualKindHandle, data: VisualUpdateData): void {
    handle.container.position.set(data.pos.x, data.pos.y);
    const refs = handle.refs as {
      diamond: PIXI.Graphics; label: PIXI.Text; nameText: PIXI.Text; nameBg: PIXI.Graphics;
    };
    refs.diamond.tint = data.color;
    refs.label.text = data.label[0]?.toUpperCase() || '';

    // Name badge — depende de label/color, no de tiempo, así que es
    // identidad (Fase 2), no animación (Fase 3). Extraído verbatim de
    // WorldCanvas.tsx.
    refs.nameText.text = data.label;
    refs.nameBg.clear();
    const nw = data.label.length * 5 + 12;
    refs.nameBg
      .roundRect(-nw / 2, -14 - 12, nw, 12, 3)
      .fill({ color: COLOR.panel, alpha: 0.85 })
      .stroke({ width: 0.5, color: data.color, alpha: 0.5 });
  },
};

// Estado efímero por frame que necesita la animación de un token — mismos
// campos que TokenDescriptor consultaba directamente en WorldCanvas.tsx.
export interface TokenAnimationState {
  working: boolean;
  justActed: boolean;
  action?: string;
}

// Animación de token — extraída verbatim del bucle de WorldCanvas.tsx: ring/
// ringOuter de pulso (justActed/working) y burbuja de acción (tip/bubble).
// Fase 3 del Plan de Migración ECS.
export const tokenAnimation: AnimationBehavior = (refs, state, t) => {
  const s = state as unknown as TokenAnimationState;
  const r = refs as {
    ring: PIXI.Graphics; ringOuter: PIXI.Graphics; diamond: PIXI.Graphics;
    tip: PIXI.Text; bubble: PIXI.Graphics;
  };

  const actionText = (s.working || s.justActed) ? (s.action || '') : '';
  if (actionText) {
    const truncated = actionText.length > 20 ? actionText.slice(0, 20) + '…' : actionText;
    r.tip.text = truncated;
    r.tip.style.fill = s.justActed ? COLOR.amber : COLOR.signal;
    const bw = Math.min(truncated.length * 5.2 + 14, 140);
    r.bubble.clear()
      .roundRect(-bw / 2, 17, bw, 12, 3)
      .fill({ color: COLOR.panel, alpha: 0.88 })
      .stroke({ width: 0.5, color: s.justActed ? COLOR.amber : COLOR.signal, alpha: 0.55 });
    r.bubble.visible = true;
  } else {
    r.tip.text = '';
    r.bubble.visible = false;
  }

  if (s.justActed) {
    const fp = 0.5 + 0.5 * Math.sin(t * 9);
    r.ring.alpha = 0.5 + 0.4 * fp;
    r.ring.scale.set(0.85 + 0.3 * fp);
    r.ring.tint = COLOR.amber;
    r.ringOuter.alpha = 0.2 + 0.25 * (1 - fp);
    r.ringOuter.scale.set(0.9 + 0.18 * fp);
    r.ringOuter.tint = COLOR.ember;
    r.diamond.rotation = Math.sin(t * 6) * 0.0;
  } else if (s.working) {
    const sp = 0.5 + 0.5 * Math.sin(t * 3.2);
    r.ring.alpha = 0.2 + 0.28 * sp;
    r.ring.scale.set(0.88 + 0.18 * sp);
    r.ring.tint = COLOR.ember;
    r.ringOuter.alpha = 0;
  } else {
    r.ring.alpha = 0;
    r.ringOuter.alpha = 0;
  }
};
