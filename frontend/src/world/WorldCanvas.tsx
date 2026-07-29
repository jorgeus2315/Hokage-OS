import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { WorldEngine } from './WorldEngine';
import type { HubDescriptor, RoomDescriptor, TokenDescriptor } from './types';

// Mismos valores que las custom properties de styles.css — el renderer
// vive fuera del DOM, así que no puede leer var(--ember) directamente.
const COLOR = {
  void: 0x0a0b0d,
  panel: 0x14161a,
  line: 0x262a31,
  ember: 0xe8432d,
  emberDim: 0x7a2418,
  signal: 0x4fd1c5,
  ink: 0xe8e6e1,
  inkFaint: 0x4a4d53,
};

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

function buildHub(): PIXI.Container {
  const container = withClick(new PIXI.Container());
  container.label = 'hub';
  container.hitArea = new PIXI.Circle(0, 0, 64);
  const ring = new PIXI.Graphics().circle(0, 0, 80).stroke({ width: 1.5, color: COLOR.emberDim, alpha: 0.6 });
  const circle = new PIXI.Graphics().circle(0, 0, 64).fill(COLOR.panel).stroke({ width: 2, color: COLOR.ember });
  const label = makeText('', { fontSize: 13, fontWeight: '700' });
  label.anchor.set(0.5);
  label.position.set(0, -4);
  const sublabel = makeText('', { fontSize: 8, fill: COLOR.inkFaint });
  sublabel.anchor.set(0.5);
  sublabel.position.set(0, 12);
  container.addChild(ring, circle, label, sublabel);
  Object.assign(container, { __label: label, __sublabel: sublabel });
  return container;
}

function buildRoom(): { container: PIXI.Container; alertDot: PIXI.Graphics } {
  const container = withClick(new PIXI.Container());
  container.label = 'room';
  container.hitArea = new PIXI.Rectangle(-54, -34, 108, 68);
  const box = new PIXI.Graphics().roundRect(-54, -34, 108, 68, 3).fill(COLOR.panel).stroke({ width: 1, color: COLOR.line });
  const label = makeText('', { fontSize: 10.5, fontWeight: '700' });
  label.anchor.set(0.5);
  label.position.set(0, 6);
  const sublabel = makeText('', { fontSize: 8.5, fill: COLOR.inkFaint });
  sublabel.anchor.set(0.5);
  sublabel.position.set(0, 20);
  const alertDot = new PIXI.Graphics().circle(0, 0, 4).fill(COLOR.ember);
  alertDot.position.set(46, -26);
  alertDot.visible = false;
  container.addChild(box, label, sublabel, alertDot);
  Object.assign(container, { __label: label, __sublabel: sublabel });
  return { container, alertDot };
}

function buildToken(): PIXI.Container {
  const container = withClick(new PIXI.Container());
  container.label = 'token';
  container.hitArea = new PIXI.Circle(0, 0, 13);
  const circle = new PIXI.Graphics().circle(0, 0, 13).fill(0xffffff);
  const label = makeText('', { fontSize: 10, fontWeight: '700', fill: 0xffffff });
  label.anchor.set(0.5);
  const tip = makeText('', { fontSize: 8, fill: COLOR.inkFaint });
  tip.anchor.set(0.5);
  tip.position.set(0, 20);
  container.addChild(circle, label, tip);
  Object.assign(container, { __circle: circle, __label: label, __tip: tip });
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
    const roomGfx = new Map<string, { container: PIXI.Container; alertDot: PIXI.Graphics }>();
    const tokenGfx = new Map<string, PIXI.Container>();

    (async () => {
      await app.init({ background: COLOR.void, antialias: true, resizeTo: host, autoDensity: true, resolution: window.devicePixelRatio || 1 });
      if (destroyed) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);

      const orbit = new PIXI.Graphics();
      const hubContainer = buildHub() as WithSlots<{ __label: PIXI.Text; __sublabel: PIXI.Text }>;
      app.stage.addChild(orbit, hubContainer);

      app.ticker.add(() => {
        const { hub, rooms, tokens } = propsRef.current;
        const w = app.screen.width;
        const h = app.screen.height;
        if (w === 0 || h === 0) return;

        orbit.clear().ellipse(w / 2, h / 2, w * 0.39, h * 0.37).stroke({ width: 1, color: COLOR.line, alpha: 0.8 });

        hubContainer.position.set(w / 2, h / 2);
        hubContainer.__label.text = hub.label;
        hubContainer.__sublabel.text = hub.sublabel;
        Object.assign(hubContainer, { __onClick: hub.onClick });

        const seenRooms = new Set<string>();
        for (const r of rooms) {
          seenRooms.add(r.id);
          let entry = roomGfx.get(r.id);
          if (!entry) {
            entry = buildRoom();
            app.stage.addChild(entry.container);
            roomGfx.set(r.id, entry);
          }
          const c = entry.container as WithSlots<{ __label: PIXI.Text; __sublabel: PIXI.Text }>;
          c.position.set((w * r.x) / 100, (h * r.y) / 100);
          c.__label.text = r.label;
          c.__sublabel.text = r.sublabel;
          Object.assign(c, { __onClick: r.onClick });
          entry.alertDot.visible = r.pending;
        }
        for (const [id, entry] of roomGfx) {
          if (!seenRooms.has(id)) {
            app.stage.removeChild(entry.container);
            entry.container.destroy({ children: true });
            roomGfx.delete(id);
          }
        }

        const seenTokens = new Set<string>();
        for (const t of tokens) {
          seenTokens.add(t.id);
          const px = (w * t.x) / 100;
          const py = (h * t.y) / 100;
          const color = t.working ? COLOR.ember : COLOR.signal;
          const node = engine.get(t.id);
          if (!node) {
            engine.upsert(t.id, { x: px, y: py }, color, t.label);
          } else {
            engine.setTarget(t.id, { x: px, y: py });
            node.color = color;
            node.label = t.label;
          }
          let gfx = tokenGfx.get(t.id);
          if (!gfx) {
            gfx = buildToken();
            app.stage.addChild(gfx);
            tokenGfx.set(t.id, gfx);
          }
          Object.assign(gfx, { __onClick: t.onClick });
        }
        for (const [id, gfx] of tokenGfx) {
          if (!seenTokens.has(id)) {
            app.stage.removeChild(gfx);
            gfx.destroy({ children: true });
            tokenGfx.delete(id);
            engine.remove(id);
          }
        }

        engine.tick();
        for (const node of engine.all()) {
          const gfx = tokenGfx.get(node.id) as WithSlots<{ __circle: PIXI.Graphics; __label: PIXI.Text; __tip: PIXI.Text }> | undefined;
          if (!gfx) continue;
          gfx.position.set(node.pos.x, node.pos.y);
          gfx.__circle.tint = node.color;
          gfx.__label.text = node.label[0] || '';
          gfx.__tip.text = node.label;
        }
      });
    })();

    return () => {
      destroyed = true;
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
