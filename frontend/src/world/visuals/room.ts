import * as PIXI from 'pixi.js';
import { COLOR } from './palette';
import { makeText, makeInteractive, hashOffset } from './shared';
import type { VisualKindDefinition, VisualKindHandle, VisualUpdateData } from '../registries/VisualKindRegistry';
import type { AnimationBehavior } from '../registries/AnimationRegistry';

// Room dimensions — idénticas a WorldCanvas.tsx (RW/RH).
const RW = 154, RH = 104;

// Construcción extraída VERBATIM de WorldCanvas.tsx (buildRoom original) —
// ni un trazo, número o alpha cambiado. Fase 2 del Plan de Migración ECS.
// color se fija en la creación (igual que antes — buildRoom(color) tomaba
// el color base como argumento de construcción, nunca cambia después).
// Devuelve todos los refs directamente desde la Fase 9 — antes una parte
// pasaba por Object.assign(container, {__x}) + cast, el resto ya se
// devolvía directo; inconsistencia real, no solo estilo.
function buildRoomContainer(color: number): {
  container: PIXI.Container;
  label: PIXI.Text;
  sublabel: PIXI.Text;
  accentBar: PIXI.Graphics;
  glowOuter: PIXI.Graphics;
  interiorFill: PIXI.Graphics;
  bottomBar: PIXI.Graphics;
  alertDot: PIXI.Graphics;
  pulseRing: PIXI.Graphics;
  activeDot: PIXI.Graphics;
} {
  const container = makeInteractive(new PIXI.Container());
  container.label = 'room';
  container.hitArea = new PIXI.Rectangle(-RW / 2, -RH / 2, RW, RH);

  // Outer ambient glow
  const glowOuter = new PIXI.Graphics()
    .roundRect(-RW / 2 - 12, -RH / 2 - 12, RW + 24, RH + 24, 8)
    .stroke({ width: 12, color, alpha: 0.07 });

  // Interior colored fill
  const interiorFill = new PIXI.Graphics()
    .roundRect(-RW / 2 + 2, -RH / 2 + 8, RW - 4, RH - 10, 3)
    .fill({ color, alpha: 0.06 });

  // Interior horizontal grid lines
  const gridLines = new PIXI.Graphics();
  for (let y = -RH / 2 + 22; y < RH / 2 - 12; y += 14) {
    gridLines.moveTo(-RW / 2 + 6, y).lineTo(RW / 2 - 6, y)
      .stroke({ width: 0.5, color, alpha: 0.14 });
  }

  // Main body
  const main = new PIXI.Graphics()
    .roundRect(-RW / 2, -RH / 2, RW, RH, 4)
    .fill({ color: COLOR.panel, alpha: 0.96 })
    .stroke({ width: 1.5, color, alpha: 0.82 });

  // Top accent bar (solid color strip)
  const accentBar = new PIXI.Graphics()
    .roundRect(-RW / 2 + 2, -RH / 2 + 2, RW - 4, 4, 2)
    .fill({ color, alpha: 0.9 });

  // Corner accent marks (L-brackets)
  const corners = new PIXI.Graphics();
  const cLen = 11;
  const cx2 = RW / 2 - 7, cy2 = RH / 2 - 7;
  corners
    .moveTo(-cx2 - cLen, -cy2).lineTo(-cx2, -cy2).lineTo(-cx2, -cy2 - cLen)
    .stroke({ width: 1, color, alpha: 0.45 })
    .moveTo(cx2 + cLen, -cy2).lineTo(cx2, -cy2).lineTo(cx2, -cy2 - cLen)
    .stroke({ width: 1, color, alpha: 0.45 })
    .moveTo(-cx2 - cLen, cy2).lineTo(-cx2, cy2).lineTo(-cx2, cy2 + cLen)
    .stroke({ width: 1, color, alpha: 0.45 })
    .moveTo(cx2 + cLen, cy2).lineTo(cx2, cy2).lineTo(cx2, cy2 + cLen)
    .stroke({ width: 1, color, alpha: 0.45 });

  // Bottom activity bar background
  const bottomBarBg = new PIXI.Graphics()
    .roundRect(-RW / 2 + 5, RH / 2 - 9, RW - 10, 3, 1)
    .fill({ color: 0x000000, alpha: 0.5 });

  // Bottom activity bar fill (drawn per-frame)
  const bottomBar = new PIXI.Graphics();

  // Pulse ring for pending decisions
  const pulseRing = new PIXI.Graphics();

  // Labels
  const label = makeText('', { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, fill: COLOR.ink });
  label.anchor.set(0.5);
  label.position.set(0, -10);

  const sublabel = makeText('', { fontSize: 8, fill: COLOR.inkDim, letterSpacing: 0.3 });
  sublabel.anchor.set(0.5);
  sublabel.position.set(0, 8);

  // Alert dot — ember, top right
  const alertDot = new PIXI.Graphics().circle(0, 0, 5).fill(COLOR.ember);
  alertDot.position.set(RW / 2 - 10, -RH / 2 + 10);
  alertDot.visible = false;

  // Active dot — signal, top left
  const activeDot = new PIXI.Graphics().circle(0, 0, 3.5).fill(COLOR.signal);
  activeDot.position.set(-RW / 2 + 10, -RH / 2 + 10);
  activeDot.visible = false;

  container.addChild(
    glowOuter, interiorFill, gridLines, main, accentBar, corners,
    bottomBarBg, bottomBar, pulseRing, label, sublabel, alertDot, activeDot,
  );

  return {
    container, label, sublabel, accentBar, glowOuter, interiorFill,
    bottomBar, alertDot, pulseRing, activeDot,
  };
}

// Wrapper VisualKindDefinition. create() lee data.color porque buildRoom
// ya pedía el color base en construcción (fijo de por vida, nunca cambia
// después — igual que antes). update() hace exactamente lo que
// WorldCanvas.tsx hacía cada frame para la posición/label/sublabel de una
// sala — el resto (glow, fill, barra de actividad, pulse ring, alert/
// active dot) es animación y se queda en WorldCanvas hasta la Fase 3,
// leyendo estos mismos refs.
export const roomVisualKind: VisualKindDefinition = {
  create(data: VisualUpdateData): VisualKindHandle {
    const { container, ...refs } = buildRoomContainer(data.color);
    return { container, refs };
  },
  update(handle: VisualKindHandle, data: VisualUpdateData): void {
    handle.container.position.set(data.pos.x, data.pos.y);
    const refs = handle.refs as { label: PIXI.Text; sublabel: PIXI.Text };
    refs.label.text = data.label;
    refs.sublabel.text = data.sublabel ?? '';
  },
};

// Estado efímero por frame que necesita la animación de una sala — mismos
// campos que RoomDescriptor consultaba directamente en WorldCanvas.tsx.
export interface RoomAnimationState {
  id: string;
  color: number;
  pending: boolean;
  active: boolean;
  hasError: boolean;
  activityLevel?: number;
}

// Animación de sala — extraída verbatim del bucle de WorldCanvas.tsx: alert/
// active dot, glow exterior, fill interior, barra de actividad y pulse ring
// de pendientes/error. Fase 3 del Plan de Migración ECS.
export const roomAnimation: AnimationBehavior = (refs, state, t) => {
  const s = state as unknown as RoomAnimationState;
  const refsTyped = refs as {
    alertDot: PIXI.Graphics; activeDot: PIXI.Graphics; glowOuter: PIXI.Graphics;
    interiorFill: PIXI.Graphics; bottomBar: PIXI.Graphics; pulseRing: PIXI.Graphics;
  };

  const effectColor = s.hasError ? COLOR.amber : s.color;

  refsTyped.alertDot.visible = s.pending;
  if (s.pending) refsTyped.alertDot.alpha = 0.6 + 0.4 * Math.sin(t * 5);

  refsTyped.activeDot.visible = s.active;
  if (s.active) refsTyped.activeDot.alpha = 0.6 + 0.4 * Math.sin(t * 4 + 1);

  const al = s.activityLevel ?? (s.active ? 1 : 0.06);
  if (s.active) {
    refsTyped.glowOuter.alpha = al * (0.55 + 0.45 * Math.sin(t * 1.8));
  } else if (s.hasError) {
    refsTyped.glowOuter.alpha = 0.3 + 0.2 * Math.sin(t * 4);
  } else if (s.pending) {
    refsTyped.glowOuter.alpha = 0.35 + 0.25 * Math.sin(t * 2.5);
  } else {
    refsTyped.glowOuter.alpha = Math.max(0.04, al * 0.6);
  }
  refsTyped.glowOuter.tint = s.hasError ? COLOR.amber : 0xffffff;

  refsTyped.interiorFill.alpha = s.active
    ? 0.7 + 0.3 * Math.sin(t * 2.2)
    : Math.max(0.02, al * 0.5);

  refsTyped.bottomBar.clear();
  if (al > 0.05) {
    const barW = RW - 10;
    const fillFraction = s.active
      ? 0.3 + 0.7 * Math.abs(Math.sin(t * 0.4 + hashOffset(s.id) * Math.PI))
      : al;
    const fillW = barW * fillFraction;
    refsTyped.bottomBar
      .roundRect(-barW / 2, RH / 2 - 9, fillW, 3, 1)
      .fill({ color: effectColor, alpha: s.active ? 0.85 : 0.45 });
  }

  refsTyped.pulseRing.clear();
  if (s.pending || s.hasError) {
    const pulseColor = s.hasError ? COLOR.amber : COLOR.ember;
    const scale = 1 + Math.sin(t * 2.8) * 0.02;
    refsTyped.pulseRing
      .roundRect(-RW * scale / 2, -RH * scale / 2, RW * scale, RH * scale, 4)
      .stroke({ width: 1.5, color: pulseColor, alpha: 0.28 + 0.18 * Math.sin(t * 2.8) });
  }
};
