import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { WorldEngine } from './WorldEngine';
import type { HubDescriptor, RoomDescriptor, TokenDescriptor, RippleEvent } from './types';

const COLOR = {
  void: 0x0a0b0d,
  panel: 0x12141a,
  line: 0x1e2229,
  ember: 0xe8432d,
  emberDim: 0x7a2418,
  signal: 0x4fd1c5,
  amber: 0xf0a93b,
  good: 0x3ecf6a,
  ink: 0xe8e6e1,
  inkFaint: 0x4a4d53,
  inkDim: 0x8a8d93,
  minimapBg: 0x0d0e11,
  minimapViewport: 0x4fd1c5,
};

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;
const MINIMAP_W = 150;
const MINIMAP_H = 110;
const MINIMAP_PAD = 12;

// Room dimensions — rectangulares, más grandes
const RW = 154, RH = 104;

function makeText(text: string, style: Partial<PIXI.TextStyleOptions>): PIXI.Text {
  return new PIXI.Text({
    text,
    style: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fill: COLOR.ink, ...style },
  });
}

function withClick(container: PIXI.Container): PIXI.Container {
  container.eventMode = 'static';
  container.cursor = 'pointer';
  container.on('pointertap', () => {
    (container as unknown as { __onClick?: () => void }).__onClick?.();
  });
  return container;
}

function octPoly(r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i * 45 + 22.5) * (Math.PI / 180);
    pts.push(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  return pts;
}

function buildGrid(cx: number, cy: number): PIXI.Graphics {
  const g = new PIXI.Graphics();
  const spacing = 60;
  const range = 1000;
  for (let x = cx - range; x <= cx + range; x += spacing) {
    g.moveTo(x, cy - range).lineTo(x, cy + range)
      .stroke({ width: 0.5, color: COLOR.line, alpha: 0.35 });
  }
  for (let y = cy - range; y <= cy + range; y += spacing) {
    g.moveTo(cx - range, y).lineTo(cx + range, y)
      .stroke({ width: 0.5, color: COLOR.line, alpha: 0.35 });
  }
  // Accent dots at intersections (every 3rd)
  for (let x = cx - range; x <= cx + range; x += spacing * 3) {
    for (let y = cy - range; y <= cy + range; y += spacing * 3) {
      g.circle(x, y, 1.2).fill({ color: COLOR.line, alpha: 0.7 });
    }
  }
  return g;
}

function buildHub(): PIXI.Container {
  const container = withClick(new PIXI.Container());
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
  Object.assign(container, { __label: label, __sublabel: sublabel, __glow: glow });
  return container;
}

function buildRoom(color: number): {
  container: PIXI.Container;
  alertDot: PIXI.Graphics;
  pulseRing: PIXI.Graphics;
  activeDot: PIXI.Graphics;
} {
  const container = withClick(new PIXI.Container());
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

  Object.assign(container, {
    __label: label,
    __sublabel: sublabel,
    __accentBar: accentBar,
    __glowOuter: glowOuter,
    __interiorFill: interiorFill,
    __bottomBar: bottomBar,
  });

  return { container, alertDot, pulseRing, activeDot };
}

function buildToken(): PIXI.Container {
  const container = withClick(new PIXI.Container());
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
  Object.assign(container, {
    __ring: ring,
    __ringOuter: ringOuter,
    __diamond: diamond,
    __label: label,
    __tip: tip,
    __bubble: bubble,
    __nameText: nameText,
    __nameBg: nameBg,
  });
  return container;
}

function hashOffset(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return h / 1000;
}

type WithSlots<T> = PIXI.Container & T;
type Ripple = { x: number; y: number; startMs: number; color: number };

export function WorldCanvas({
  hub,
  rooms,
  tokens,
  events = [],
}: {
  hub: HubDescriptor;
  rooms: RoomDescriptor[];
  tokens: TokenDescriptor[];
  events?: RippleEvent[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ hub, rooms, tokens, events });
  propsRef.current = { hub, rooms, tokens, events };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let destroyed = false;
    const app = new PIXI.Application();
    const engine = new WorldEngine();
    const roomGfx = new Map<string, {
      container: PIXI.Container;
      alertDot: PIXI.Graphics;
      pulseRing: PIXI.Graphics;
      activeDot: PIXI.Graphics;
      color: number;
    }>();
    const tokenGfx = new Map<string, PIXI.Container>();
    const seenEventIds = new Set<string>();
    const ripples: Ripple[] = [];

    const PAN_THRESHOLD = 4;
    let panState: 'idle' | 'pending' | 'panning' = 'idle';
    let dragStart = { x: 0, y: 0 };
    let worldStart = { x: 0, y: 0 };
    let pendingPointerId = -1;
    let worldRef: PIXI.Container | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      panState = 'pending';
      pendingPointerId = e.pointerId;
      dragStart = { x: e.clientX, y: e.clientY };
      worldStart = { x: worldRef?.position.x ?? 0, y: worldRef?.position.y ?? 0 };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (panState === 'idle' || !worldRef) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (panState === 'pending') {
        if (Math.abs(dx) < PAN_THRESHOLD && Math.abs(dy) < PAN_THRESHOLD) return;
        panState = 'panning';
        host.setPointerCapture(pendingPointerId);
      }
      worldRef.position.set(worldStart.x + dx, worldStart.y + dy);
    };
    const onPointerUp = () => { panState = 'idle'; };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!worldRef) return;
      const direction = e.deltaY < 0 ? 1 : -1;
      const oldScale = worldRef.scale.x;
      const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldScale + direction * ZOOM_STEP * oldScale));
      if (newScale === oldScale) return;
      const rect = host.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const wx = (mouseX - worldRef.position.x) / oldScale;
      const wy = (mouseY - worldRef.position.y) / oldScale;
      worldRef.scale.set(newScale);
      worldRef.position.set(mouseX - wx * newScale, mouseY - wy * newScale);
    };

    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('wheel', onWheel, { passive: false });

    (async () => {
      await app.init({
        background: COLOR.void,
        antialias: true,
        resizeTo: host,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
      if (destroyed) { app.destroy(true); return; }
      host.appendChild(app.canvas);

      const world = new PIXI.Container();
      world.label = 'world';
      world.eventMode = 'passive';
      app.stage.addChild(world);

      const gridGfx = buildGrid(1000, 1000);
      const trailGfx = new PIXI.Graphics();
      const scanGfx = new PIXI.Graphics();
      const rippleGfx = new PIXI.Graphics();
      const orbit = new PIXI.Graphics();
      const spokes = new PIXI.Graphics();
      const hubContainer = buildHub() as WithSlots<{ __label: PIXI.Text; __sublabel: PIXI.Text; __glow: PIXI.Graphics }>;
      world.addChild(gridGfx, trailGfx, scanGfx, rippleGfx, orbit, spokes, hubContainer);
      worldRef = world;

      function fitScene() {
        const { hub, rooms } = propsRef.current;
        const sw = app.screen.width;
        const sh = app.screen.height;
        if (sw === 0 || sh === 0) return;
        const allX = [hub.x, ...rooms.map((r) => r.x)];
        const allY = [hub.y, ...rooms.map((r) => r.y)];
        const margin = 140;
        const minX = Math.min(...allX) - margin;
        const maxX = Math.max(...allX) + margin;
        const minY = Math.min(...allY) - margin;
        const maxY = Math.max(...allY) + margin;
        const sceneW = maxX - minX;
        const sceneH = maxY - minY;
        const scale = Math.min(sw / sceneW, sh / sceneH, 1.4);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        world.scale.set(scale);
        world.position.set(sw / 2 - cx * scale, sh / 2 - cy * scale);
      }
      fitScene();

      const minimapContainer = new PIXI.Container();
      minimapContainer.label = 'minimap';
      app.stage.addChild(minimapContainer);
      const minimapBg = new PIXI.Graphics();
      const minimapDots = new PIXI.Graphics();
      const minimapViewport = new PIXI.Graphics();
      minimapContainer.addChild(minimapBg, minimapDots, minimapViewport);

      app.ticker.add(() => {
        const { hub, rooms, tokens } = propsRef.current;
        const sw = app.screen.width;
        const sh = app.screen.height;
        if (sw === 0 || sh === 0) return;

        const t = performance.now() / 1000;

        const tokenState = new Map<string, { working: boolean; justActed: boolean; action?: string }>();
        for (const tk of tokens) {
          tokenState.set(tk.id, { working: tk.working, justActed: tk.justActed ?? false, action: tk.action });
        }

        // Hub
        const orbitRx = 420, orbitRy = 400;
        orbit.clear()
          .ellipse(hub.x, hub.y, orbitRx, orbitRy)
          .stroke({ width: 0.8, color: COLOR.line, alpha: 0.8 });

        hubContainer.position.set(hub.x, hub.y);
        hubContainer.__label.text = hub.label;
        hubContainer.__sublabel.text = hub.sublabel;
        hubContainer.__glow.alpha = 0.45 + 0.55 * Math.sin(t * 1.3);
        Object.assign(hubContainer, { __onClick: hub.onClick });

        // Spokes + data pulses
        spokes.clear();
        for (const r of rooms) {
          const lineAlpha = r.active ? 0.3 : 0.14;
          spokes.moveTo(hub.x, hub.y).lineTo(r.x, r.y)
            .stroke({ width: r.active ? 1.5 : 0.8, color: r.color, alpha: lineAlpha });
        }
        for (const r of rooms) {
          const numPackets = r.active ? 4 : 2;
          const speed = r.active ? 0.28 : 0.16;
          for (let p = 0; p < numPackets; p++) {
            const progress = (t * speed + hashOffset(r.id) + p / numPackets) % 1;
            const px = hub.x + (r.x - hub.x) * progress;
            const py = hub.y + (r.y - hub.y) * progress;
            const fade = Math.sin(progress * Math.PI);
            const sz = r.active ? 3.5 : 2.2;
            spokes.circle(px, py, sz)
              .fill({ color: r.color, alpha: (r.active ? 0.2 : 0.1) + 0.6 * fade });
          }
        }

        // Rooms
        const seenRooms = new Set<string>();
        for (const r of rooms) {
          seenRooms.add(r.id);
          let entry = roomGfx.get(r.id);
          if (!entry) {
            entry = { ...buildRoom(r.color), color: r.color };
            world.addChild(entry.container);
            roomGfx.set(r.id, entry);
          }
          const c = entry.container as WithSlots<{
            __label: PIXI.Text;
            __sublabel: PIXI.Text;
            __accentBar: PIXI.Graphics;
            __glowOuter: PIXI.Graphics;
            __interiorFill: PIXI.Graphics;
            __bottomBar: PIXI.Graphics;
          }>;
          c.position.set(r.x, r.y);
          c.__label.text = r.label;
          c.__sublabel.text = r.sublabel;
          Object.assign(c, { __onClick: r.onClick });

          // Color efectivo — ámbar si hay error, color base si no
          const effectColor = r.hasError ? COLOR.amber : r.color;

          // Alert dot
          entry.alertDot.visible = r.pending;
          if (r.pending) entry.alertDot.alpha = 0.6 + 0.4 * Math.sin(t * 5);

          // Active dot
          entry.activeDot.visible = r.active;
          if (r.active) entry.activeDot.alpha = 0.6 + 0.4 * Math.sin(t * 4 + 1);

          // Outer glow — intensidad escalada por activityLevel
          const al = r.activityLevel ?? (r.active ? 1 : 0.06);
          if (r.active) {
            c.__glowOuter.alpha = al * (0.55 + 0.45 * Math.sin(t * 1.8));
          } else if (r.hasError) {
            c.__glowOuter.alpha = 0.3 + 0.2 * Math.sin(t * 4);
          } else if (r.pending) {
            c.__glowOuter.alpha = 0.35 + 0.25 * Math.sin(t * 2.5);
          } else {
            // salas idle: dim proporcional a actividad pasada
            c.__glowOuter.alpha = Math.max(0.04, al * 0.6);
          }

          // Color del glow outer si hay error
          if (r.hasError) {
            (c.__glowOuter as PIXI.Graphics).tint = COLOR.amber;
          } else {
            (c.__glowOuter as PIXI.Graphics).tint = 0xffffff;
          }

          // Interior fill — respira según actividad
          c.__interiorFill.alpha = r.active
            ? 0.7 + 0.3 * Math.sin(t * 2.2)
            : Math.max(0.02, al * 0.5);

          // Bottom activity bar — se llena con activityLevel base + pulso si activo
          c.__bottomBar.clear();
          if (al > 0.05) {
            const barW = RW - 10;
            const fillFraction = r.active
              ? 0.3 + 0.7 * Math.abs(Math.sin(t * 0.4 + hashOffset(r.id) * Math.PI))
              : al;
            const fillW = barW * fillFraction;
            c.__bottomBar
              .roundRect(-barW / 2, RH / 2 - 9, fillW, 3, 1)
              .fill({ color: effectColor, alpha: r.active ? 0.85 : 0.45 });
          }

          // Pulse ring para pending o error
          entry.pulseRing.clear();
          if (r.pending || r.hasError) {
            const pulseColor = r.hasError ? COLOR.amber : COLOR.ember;
            const s = 1 + Math.sin(t * 2.8) * 0.02;
            entry.pulseRing
              .roundRect(-RW * s / 2, -RH * s / 2, RW * s, RH * s, 4)
              .stroke({ width: 1.5, color: pulseColor, alpha: 0.28 + 0.18 * Math.sin(t * 2.8) });
          }
        }
        for (const [id, entry] of roomGfx) {
          if (!seenRooms.has(id)) {
            world.removeChild(entry.container);
            entry.container.destroy({ children: true });
            roomGfx.delete(id);
          }
        }

        // Tokens
        const seenTokens = new Set<string>();
        for (const tk of tokens) {
          seenTokens.add(tk.id);
          const color = tk.working ? COLOR.ember : COLOR.signal;
          const node = engine.get(tk.id);
          if (!node) {
            engine.upsert(tk.id, { x: tk.x, y: tk.y }, color, tk.label);
          } else {
            engine.setTarget(tk.id, { x: tk.x, y: tk.y });
            node.color = color;
            node.label = tk.label;
          }
          let gfx = tokenGfx.get(tk.id);
          if (!gfx) {
            gfx = buildToken();
            world.addChild(gfx);
            tokenGfx.set(tk.id, gfx);
          }
          Object.assign(gfx, { __onClick: tk.onClick });
        }
        for (const [id, gfx] of tokenGfx) {
          if (!seenTokens.has(id)) {
            world.removeChild(gfx);
            gfx.destroy({ children: true });
            tokenGfx.delete(id);
            engine.remove(id);
          }
        }

        engine.tick();

        // Trails
        trailGfx.clear();
        for (const node of engine.all()) {
          const trail = node.trail;
          for (let i = 0; i < trail.length; i++) {
            const frac = (i + 1) / trail.length;
            trailGfx.circle(trail[i].x, trail[i].y, 1 + frac * 1.8)
              .fill({ color: node.color, alpha: frac * 0.18 });
          }
        }

        // Token visuals
        for (const node of engine.all()) {
          const gfx = tokenGfx.get(node.id) as WithSlots<{
            __ring: PIXI.Graphics;
            __ringOuter: PIXI.Graphics;
            __diamond: PIXI.Graphics;
            __label: PIXI.Text;
            __tip: PIXI.Text;
            __bubble: PIXI.Graphics;
            __nameText: PIXI.Text;
            __nameBg: PIXI.Graphics;
          }> | undefined;
          if (!gfx) continue;

          gfx.position.set(node.pos.x, node.pos.y);
          gfx.__diamond.tint = node.color;
          gfx.__label.text = node.label[0]?.toUpperCase() || '';

          // Name badge
          gfx.__nameText.text = node.label;
          gfx.__nameBg.clear();
          const nw = node.label.length * 5 + 12;
          gfx.__nameBg
            .roundRect(-nw / 2, -14 - 12, nw, 12, 3)
            .fill({ color: COLOR.panel, alpha: 0.85 })
            .stroke({ width: 0.5, color: node.color, alpha: 0.5 });

          const state = tokenState.get(node.id);
          const isWorking = state?.working ?? false;
          const isJustActed = state?.justActed ?? false;

          // Action bubble
          const actionText = (isWorking || isJustActed) ? (state?.action || '') : '';
          if (actionText) {
            const truncated = actionText.length > 20 ? actionText.slice(0, 20) + '…' : actionText;
            gfx.__tip.text = truncated;
            gfx.__tip.style.fill = isJustActed ? COLOR.amber : COLOR.signal;
            const bw = Math.min(truncated.length * 5.2 + 14, 140);
            gfx.__bubble.clear()
              .roundRect(-bw / 2, 17, bw, 12, 3)
              .fill({ color: COLOR.panel, alpha: 0.88 })
              .stroke({ width: 0.5, color: isJustActed ? COLOR.amber : COLOR.signal, alpha: 0.55 });
            gfx.__bubble.visible = true;
          } else {
            gfx.__tip.text = '';
            gfx.__bubble.visible = false;
          }

          if (isJustActed) {
            const fp = 0.5 + 0.5 * Math.sin(t * 9);
            gfx.__ring.alpha = 0.5 + 0.4 * fp;
            gfx.__ring.scale.set(0.85 + 0.3 * fp);
            gfx.__ring.tint = COLOR.amber;
            gfx.__ringOuter.alpha = 0.2 + 0.25 * (1 - fp);
            gfx.__ringOuter.scale.set(0.9 + 0.18 * fp);
            gfx.__ringOuter.tint = COLOR.ember;
            gfx.__diamond.rotation = Math.sin(t * 6) * 0.0;
          } else if (isWorking) {
            const sp = 0.5 + 0.5 * Math.sin(t * 3.2);
            gfx.__ring.alpha = 0.2 + 0.28 * sp;
            gfx.__ring.scale.set(0.88 + 0.18 * sp);
            gfx.__ring.tint = COLOR.ember;
            gfx.__ringOuter.alpha = 0;
          } else {
            gfx.__ring.alpha = 0;
            gfx.__ringOuter.alpha = 0;
          }
        }

        // Scan line
        const SCAN_PERIOD = 12;
        const scanPhase = (t % SCAN_PERIOD) / SCAN_PERIOD;
        const scanBase = hub.x - 700;
        const scanEnd = hub.x + 700;
        const scanX = scanBase + scanPhase * (scanEnd - scanBase + 600) - 100;
        scanGfx.clear()
          .moveTo(scanX - 200, hub.y - 700).lineTo(scanX + 200, hub.y + 700)
          .stroke({ width: 2, color: COLOR.signal, alpha: 0.025 })
          .moveTo(scanX - 80, hub.y - 700).lineTo(scanX + 80, hub.y + 700)
          .stroke({ width: 1, color: COLOR.signal, alpha: 0.045 });

        // Ripples from events
        const { events } = propsRef.current;
        for (const ev of events) {
          if (!seenEventIds.has(ev.id)) {
            seenEventIds.add(ev.id);
            const room = rooms.find((r) => r.id === ev.roomId);
            if (room) {
              const rippleColor = ev.type.includes('error')
                ? COLOR.ember
                : ev.type.includes('done')
                  ? COLOR.signal
                  : COLOR.amber;
              ripples.push({ x: room.x, y: room.y, startMs: performance.now(), color: rippleColor });
            }
          }
        }

        const now = performance.now();
        rippleGfx.clear();
        for (let i = ripples.length - 1; i >= 0; i--) {
          const r = ripples[i];
          const age = (now - r.startMs) / 1800;
          if (age >= 1) { ripples.splice(i, 1); continue; }
          for (let ring = 0; ring < 2; ring++) {
            const ringAge = Math.min(1, age + ring * 0.28);
            if (ringAge >= 1) continue;
            const scale = 1 + ringAge * 2.6;
            const alpha = (1 - ringAge) * (ring === 0 ? 0.55 : 0.22);
            rippleGfx
              .roundRect(r.x - (RW * scale) / 2, r.y - (RH * scale) / 2, RW * scale, RH * scale, 4 * scale)
              .stroke({ width: ring === 0 ? 1.5 : 0.8, color: r.color, alpha });
          }
        }

        // Minimap
        const allX = [hub.x, ...rooms.map((r) => r.x)];
        const allY = [hub.y, ...rooms.map((r) => r.y)];
        const pad = 130;
        const sceneMinX = Math.min(...allX) - pad;
        const sceneMinY = Math.min(...allY) - pad;
        const sceneMaxX = Math.max(...allX) + pad;
        const sceneMaxY = Math.max(...allY) + pad;
        const sceneW = sceneMaxX - sceneMinX || 1;
        const sceneH = sceneMaxY - sceneMinY || 1;

        const mmX = sw - MINIMAP_W - MINIMAP_PAD;
        const mmY = sh - MINIMAP_H - MINIMAP_PAD;
        minimapContainer.position.set(mmX, mmY);

        minimapBg.clear()
          .roundRect(0, 0, MINIMAP_W, MINIMAP_H, 3)
          .fill({ color: COLOR.minimapBg, alpha: 0.92 })
          .stroke({ width: 1, color: COLOR.line, alpha: 0.8 });

        minimapDots.clear();
        const toMmX = (wx: number) => ((wx - sceneMinX) / sceneW) * MINIMAP_W;
        const toMmY = (wy: number) => ((wy - sceneMinY) / sceneH) * MINIMAP_H;

        minimapDots.circle(toMmX(hub.x), toMmY(hub.y), 4).fill(COLOR.ember);
        for (const r of rooms) {
          minimapDots.roundRect(toMmX(r.x) - 4, toMmY(r.y) - 3, 8, 5, 1).fill(r.color);
          if (r.active) {
            minimapDots.circle(toMmX(r.x), toMmY(r.y), 7).stroke({ width: 0.8, color: r.color, alpha: 0.4 });
          }
        }
        for (const node of engine.all()) {
          const state = tokenState.get(node.id);
          const dotColor = state?.justActed ? COLOR.amber : state?.working ? COLOR.ember : COLOR.signal;
          minimapDots.circle(toMmX(node.pos.x), toMmY(node.pos.y), 2.5).fill(dotColor);
        }

        const vpLeft = -world.position.x / world.scale.x;
        const vpTop = -world.position.y / world.scale.x;
        const vpW = sw / world.scale.x;
        const vpH = sh / world.scale.x;
        minimapViewport.clear()
          .roundRect(toMmX(vpLeft), toMmY(vpTop), (vpW / sceneW) * MINIMAP_W, (vpH / sceneH) * MINIMAP_H, 2)
          .stroke({ width: 1, color: COLOR.minimapViewport, alpha: 0.75 });
      });
    })();

    return () => {
      destroyed = true;
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('wheel', onWheel);
      try { app.destroy(true, { children: true }); } catch { /* ya destruido */ }
      roomGfx.clear();
      tokenGfx.clear();
      engine.clear();
    };
  }, []);

  return <div ref={hostRef} className="hk-scene" />;
}
