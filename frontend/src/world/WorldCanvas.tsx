import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { WorldEngine } from './WorldEngine';
import type { HubDescriptor, RoomDescriptor, TokenDescriptor } from './types';

const COLOR = {
  void: 0x0a0b0d,
  panel: 0x14161a,
  line: 0x262a31,
  ember: 0xe8432d,
  emberDim: 0x7a2418,
  signal: 0x4fd1c5,
  ink: 0xe8e6e1,
  inkFaint: 0x4a4d53,
  inkDim: 0x8a8d93,
  minimapBg: 0x0d0e11,
  minimapViewport: 0x4fd1c5,
};

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;

const MINIMAP_W = 160;
const MINIMAP_H = 120;
const MINIMAP_PAD = 12;

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

// Cut-corner polygon (military HUD box)
function cutPoly(w: number, h: number, cut: number): number[] {
  return [
    -w / 2 + cut, -h / 2,
    w / 2 - cut, -h / 2,
    w / 2, -h / 2 + cut,
    w / 2, h / 2 - cut,
    w / 2 - cut, h / 2,
    -w / 2 + cut, h / 2,
    -w / 2, h / 2 - cut,
    -w / 2, -h / 2 + cut,
  ];
}

// Regular octagon inscribed in radius r
function octPoly(r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i * 45 + 22.5) * (Math.PI / 180);
    pts.push(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  return pts;
}

// Dot grid drawn once in world-space
function buildGrid(cx: number, cy: number): PIXI.Graphics {
  const g = new PIXI.Graphics();
  const spacing = 50;
  const range = 900;
  for (let x = cx - range; x <= cx + range; x += spacing) {
    for (let y = cy - range; y <= cy + range; y += spacing) {
      g.circle(x, y, 1).fill({ color: COLOR.line, alpha: 0.45 });
    }
  }
  return g;
}

function buildHub(): PIXI.Container {
  const container = withClick(new PIXI.Container());
  container.label = 'hub';
  container.hitArea = new PIXI.Circle(0, 0, 68);

  // Outer glow ring (pulsed via alpha in ticker)
  const glow = new PIXI.Graphics()
    .poly(octPoly(86))
    .stroke({ width: 16, color: COLOR.ember, alpha: 0.18 });

  // Outer structural ring
  const outerRing = new PIXI.Graphics()
    .poly(octPoly(74))
    .stroke({ width: 1, color: COLOR.emberDim, alpha: 0.55 });

  // Tactical crosshair lines
  const crosshair = new PIXI.Graphics()
    .moveTo(-90, 0).lineTo(90, 0).stroke({ width: 0.5, color: COLOR.ember, alpha: 0.18 })
    .moveTo(0, -90).lineTo(0, 90).stroke({ width: 0.5, color: COLOR.ember, alpha: 0.18 });

  // Main octagon body
  const main = new PIXI.Graphics()
    .poly(octPoly(60))
    .fill(COLOR.panel)
    .stroke({ width: 2, color: COLOR.ember });

  // Inner accent ring
  const innerRing = new PIXI.Graphics()
    .poly(octPoly(48))
    .stroke({ width: 0.5, color: COLOR.ember, alpha: 0.3 });

  const label = makeText('', { fontSize: 12, fontWeight: '700', letterSpacing: 2 });
  label.anchor.set(0.5);
  label.position.set(0, -7);

  const sublabel = makeText('', { fontSize: 7.5, fill: COLOR.inkFaint, letterSpacing: 1.5 });
  sublabel.anchor.set(0.5);
  sublabel.position.set(0, 10);

  container.addChild(glow, crosshair, outerRing, main, innerRing, label, sublabel);
  Object.assign(container, { __label: label, __sublabel: sublabel, __glow: glow });
  return container;
}

function hashOffset(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return h / 1000;
}

function buildRoom(color: number): { container: PIXI.Container; alertDot: PIXI.Graphics; pulseRing: PIXI.Graphics } {
  const container = withClick(new PIXI.Container());
  container.label = 'room';

  const W = 114, H = 70, CUT = 11;
  const poly = cutPoly(W, H, CUT);
  const glowPoly = cutPoly(W + 22, H + 22, CUT + 5);

  container.hitArea = new PIXI.Polygon(poly);

  // Outer glow
  const glowOuter = new PIXI.Graphics()
    .poly(glowPoly)
    .stroke({ width: 14, color, alpha: 0.07 });
  const glowMid = new PIXI.Graphics()
    .poly(cutPoly(W + 10, H + 10, CUT + 2))
    .stroke({ width: 5, color, alpha: 0.15 });

  // Very faint zone fill
  const zoneFill = new PIXI.Graphics()
    .poly(poly)
    .fill({ color, alpha: 0.05 });

  // Main body
  const main = new PIXI.Graphics()
    .poly(poly)
    .fill(COLOR.panel)
    .stroke({ width: 1.5, color, alpha: 0.88 });

  // Top accent bar (3px bar under the top edge)
  const accentBar = new PIXI.Graphics()
    .rect(-W / 2 + CUT, -H / 2 + 1, W - CUT * 2, 3)
    .fill({ color, alpha: 0.85 });

  // Tactical corner brackets
  const br = new PIXI.Graphics();
  const bl = 9;
  br
    // top-left
    .moveTo(-W / 2 + CUT, -H / 2 + CUT + bl).lineTo(-W / 2 + CUT, -H / 2 + CUT).lineTo(-W / 2 + CUT + bl, -H / 2 + CUT)
    .stroke({ width: 1, color: COLOR.inkFaint, alpha: 0.35 })
    // top-right
    .moveTo(W / 2 - CUT - bl, -H / 2 + CUT).lineTo(W / 2 - CUT, -H / 2 + CUT).lineTo(W / 2 - CUT, -H / 2 + CUT + bl)
    .stroke({ width: 1, color: COLOR.inkFaint, alpha: 0.35 })
    // bottom-left
    .moveTo(-W / 2 + CUT, H / 2 - CUT - bl).lineTo(-W / 2 + CUT, H / 2 - CUT).lineTo(-W / 2 + CUT + bl, H / 2 - CUT)
    .stroke({ width: 1, color: COLOR.inkFaint, alpha: 0.35 })
    // bottom-right
    .moveTo(W / 2 - CUT - bl, H / 2 - CUT).lineTo(W / 2 - CUT, H / 2 - CUT).lineTo(W / 2 - CUT, H / 2 - CUT - bl)
    .stroke({ width: 1, color: COLOR.inkFaint, alpha: 0.35 });

  const pulseRing = new PIXI.Graphics();

  const label = makeText('', { fontSize: 10.5, fontWeight: '700', letterSpacing: 1 });
  label.anchor.set(0.5);
  label.position.set(0, 4);

  const sublabel = makeText('', { fontSize: 8, fill: COLOR.inkFaint });
  sublabel.anchor.set(0.5);
  sublabel.position.set(0, 19);

  const alertDot = new PIXI.Graphics().circle(0, 0, 4).fill(COLOR.ember);
  alertDot.position.set(W / 2 - CUT - 5, -H / 2 + CUT + 5);
  alertDot.visible = false;

  container.addChild(glowOuter, glowMid, zoneFill, main, accentBar, br, pulseRing, label, sublabel, alertDot);
  Object.assign(container, { __label: label, __sublabel: sublabel });
  return { container, alertDot, pulseRing };
}

function buildToken(): PIXI.Container {
  const container = withClick(new PIXI.Container());
  container.label = 'token';
  const sz = 12;
  container.hitArea = new PIXI.Circle(0, 0, 18);

  // Diamond shape (military unit marker)
  const diamond = new PIXI.Graphics()
    .poly([0, -sz, sz, 0, 0, sz, -sz, 0])
    .fill(0xffffff);

  // Small inner diamond for depth
  const innerSz = sz - 4;
  const inner = new PIXI.Graphics()
    .poly([0, -innerSz, innerSz, 0, 0, innerSz, -innerSz, 0])
    .fill({ color: 0x000000, alpha: 0.25 });

  const label = makeText('', { fontSize: 8.5, fontWeight: '700', fill: 0x0a0b0d });
  label.anchor.set(0.5);
  label.position.set(0, 0);

  const tip = makeText('', { fontSize: 7.5, fill: COLOR.inkDim });
  tip.anchor.set(0.5);
  tip.position.set(0, 22);

  container.addChild(diamond, inner, label, tip);
  Object.assign(container, { __diamond: diamond, __label: label, __tip: tip });
  return container;
}

type WithSlots<T> = PIXI.Container & T;

export function WorldCanvas({
  hub,
  rooms,
  tokens,
}: {
  hub: HubDescriptor;
  rooms: RoomDescriptor[];
  tokens: TokenDescriptor[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ hub, rooms, tokens });
  propsRef.current = { hub, rooms, tokens };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let destroyed = false;
    const app = new PIXI.Application();
    const engine = new WorldEngine();
    const roomGfx = new Map<string, { container: PIXI.Container; alertDot: PIXI.Graphics; pulseRing: PIXI.Graphics; color: number }>();
    const tokenGfx = new Map<string, PIXI.Container>();

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
      if (destroyed) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);

      const world = new PIXI.Container();
      world.label = 'world';
      world.eventMode = 'passive';
      app.stage.addChild(world);

      // Tactical dot grid (world-space, scales with pan/zoom)
      const gridGfx = buildGrid(1000, 1000);

      const orbit = new PIXI.Graphics();
      const spokes = new PIXI.Graphics();
      const hubContainer = buildHub() as WithSlots<{ __label: PIXI.Text; __sublabel: PIXI.Text; __glow: PIXI.Graphics }>;
      world.addChild(gridGfx, orbit, spokes, hubContainer);
      worldRef = world;

      function fitScene() {
        const { hub, rooms } = propsRef.current;
        const sw = app.screen.width;
        const sh = app.screen.height;
        if (sw === 0 || sh === 0) return;

        const allX = [hub.x, ...rooms.map((r) => r.x)];
        const allY = [hub.y, ...rooms.map((r) => r.y)];
        const margin = 120;
        const minX = Math.min(...allX) - margin;
        const maxX = Math.max(...allX) + margin;
        const minY = Math.min(...allY) - margin;
        const maxY = Math.max(...allY) + margin;
        const sceneW = maxX - minX;
        const sceneH = maxY - minY;
        const scale = Math.min(sw / sceneW, sh / sceneH, 1.5);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        world.scale.set(scale);
        world.position.set(sw / 2 - cx * scale, sh / 2 - cy * scale);
      }
      fitScene();

      // Minimapa
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

        // Orbit ellipse
        const orbitRx = 420;
        const orbitRy = 400;
        orbit.clear()
          .ellipse(hub.x, hub.y, orbitRx, orbitRy)
          .stroke({ width: 0.8, color: COLOR.line, alpha: 0.7 });

        hubContainer.position.set(hub.x, hub.y);
        hubContainer.__label.text = hub.label;
        hubContainer.__sublabel.text = hub.sublabel;
        // Pulse the glow alpha
        hubContainer.__glow.alpha = 0.5 + 0.5 * Math.sin(t * 1.4);
        Object.assign(hubContainer, { __onClick: hub.onClick });

        // Spokes + data pulses
        spokes.clear();
        for (const r of rooms) {
          spokes.moveTo(hub.x, hub.y).lineTo(r.x, r.y).stroke({ width: 1, color: r.color, alpha: 0.18 });
        }
        for (const r of rooms) {
          const progress = (t * 0.18 + hashOffset(r.id)) % 1;
          const px = hub.x + (r.x - hub.x) * progress;
          const py = hub.y + (r.y - hub.y) * progress;
          const fade = Math.sin(progress * Math.PI);
          spokes.circle(px, py, 2.5).fill({ color: r.color, alpha: 0.12 + 0.6 * fade });
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
          const c = entry.container as WithSlots<{ __label: PIXI.Text; __sublabel: PIXI.Text }>;
          c.position.set(r.x, r.y);
          c.__label.text = r.label;
          c.__sublabel.text = r.sublabel;
          Object.assign(c, { __onClick: r.onClick });
          entry.alertDot.visible = r.pending;
          entry.pulseRing.clear();
          if (r.pending) {
            entry.alertDot.alpha = 0.5 + 0.5 * Math.sin(t * 5);
            const W = 114, H = 70, CUT = 11;
            const s = 1 + Math.sin(t * 3) * 0.025;
            entry.pulseRing
              .poly(cutPoly(W * s, H * s, CUT))
              .stroke({ width: 1.5, color: COLOR.ember, alpha: 0.3 + 0.2 * Math.sin(t * 3) });
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
        for (const node of engine.all()) {
          const gfx = tokenGfx.get(node.id) as WithSlots<{ __diamond: PIXI.Graphics; __label: PIXI.Text; __tip: PIXI.Text }> | undefined;
          if (!gfx) continue;
          gfx.position.set(node.pos.x, node.pos.y);
          gfx.__diamond.tint = node.color;
          gfx.__label.text = node.label[0]?.toUpperCase() || '';
          gfx.__tip.text = node.label;
        }

        // Minimapa
        const allX: number[] = [hub.x];
        const allY: number[] = [hub.y];
        for (const r of rooms) { allX.push(r.x); allY.push(r.y); }
        const pad = 120;
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
          .fill({ color: COLOR.minimapBg, alpha: 0.9 })
          .stroke({ width: 1, color: COLOR.line, alpha: 0.7 });

        minimapDots.clear();
        const toMmX = (wx: number) => ((wx - sceneMinX) / sceneW) * MINIMAP_W;
        const toMmY = (wy: number) => ((wy - sceneMinY) / sceneH) * MINIMAP_H;

        // Hub: octagon dot on minimap
        minimapDots
          .poly(octPoly(5).map((v, i) => v + (i % 2 === 0 ? toMmX(hub.x) : toMmY(hub.y))))
          .fill(COLOR.ember);
        for (const r of rooms) {
          minimapDots.rect(toMmX(r.x) - 3, toMmY(r.y) - 2, 6, 4).fill(r.color);
        }
        for (const node of engine.all()) {
          minimapDots
            .poly([
              toMmX(node.pos.x), toMmY(node.pos.y) - 3,
              toMmX(node.pos.x) + 3, toMmY(node.pos.y),
              toMmX(node.pos.x), toMmY(node.pos.y) + 3,
              toMmX(node.pos.x) - 3, toMmY(node.pos.y),
            ])
            .fill(COLOR.signal);
        }

        const vpLeft = -world.position.x / world.scale.x;
        const vpTop = -world.position.y / world.scale.x;
        const vpW = sw / world.scale.x;
        const vpH = sh / world.scale.x;
        minimapViewport.clear()
          .rect(toMmX(vpLeft), toMmY(vpTop), (vpW / sceneW) * MINIMAP_W, (vpH / sceneH) * MINIMAP_H)
          .stroke({ width: 1, color: COLOR.minimapViewport, alpha: 0.7 });
      });
    })();

    return () => {
      destroyed = true;
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('wheel', onWheel);
      try {
        app.destroy(true, { children: true });
      } catch {
        /* ya destruido */
      }
      roomGfx.clear();
      tokenGfx.clear();
      engine.clear();
    };
  }, []);

  return <div ref={hostRef} className="hk-scene" />;
}
