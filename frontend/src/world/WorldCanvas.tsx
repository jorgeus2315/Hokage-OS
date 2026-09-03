import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { WorldEngine } from './WorldEngineBridge';
import { CameraSystem } from './systems/CameraSystem';
import { COLOR, hashOffset, makeText } from './visuals';
import { ROLES } from '../shared/types';
import type { HubDescriptor, RoomDescriptor, TokenDescriptor, RippleEvent } from './types';
import { worldModelClient } from './client/WorldModelClient';

const MINIMAP_W = 150;
const MINIMAP_H = 110;
const MINIMAP_PAD = 12;
// Borde derecho del rail izquierdo (.hk-game-overlay--left en styles.css: left:10 +
// width:200, sin media query que lo altere). La leyenda arranca a su derecha para no
// quedar oculta bajo el panel DOM "Ship Crew", que se superpone al canvas a pantalla completa.
const LEFT_RAIL_RIGHT = 210;

// Slice 1 — Identidad visual de agentes. Monograma por rol: una letra fija y
// ÚNICA por rol (no la inicial del nombre, que colisiona: Explorador/Escritor
// → "E"). Es la iconografía sencilla legible al tamaño del token (~13px);
// pictogramas SVG no sobreviven a esa escala (ver resumen del slice). Canal
// secundario y colorblind-safe: distingue ceo (rojo) de finanzas (verde)
// aunque el color falle. Junto al color de departamento y la leyenda, el
// agente es identificable por rol sin clicar.
const ROLE_LETTER: Record<string, string> = {
  ceo: 'H',          // Hokage — evita colisión con contenido ("C")
  investigador: 'I',
  contenido: 'C',
  trafico: 'T',
  finanzas: 'F',
  operaciones: 'O',
  soporte: 'S',
  hermes: 'M',       // Sala de Máquinas — evita colisión con ceo ("H")
};

// Localización de datos reales del tooltip. primary declara 10 estados pero el
// backend hoy solo emite WORKING/IDLE/COMPLETED/ERROR — el resto se mapea por
// completitud, nunca se inventa.
const PRIMARY_ES: Record<string, string> = {
  IDLE: 'Inactivo', THINKING: 'Pensando', RESEARCHING: 'Investigando',
  WORKING: 'Trabajando', WAITING: 'Esperando', REVIEWING: 'Revisando',
  COMMUNICATING: 'Comunicando', MOVING: 'Moviéndose', COMPLETED: 'Completado', ERROR: 'Error',
};
const KIND_ES: Record<string, string> = {
  autonomous_run: 'Run autónomo', event_triggered: 'Por evento', decision_execution: 'Ejecutar decisión',
};

// Texto multilínea del tooltip — solo datos presentes (no se rellenan huecos).
function tooltipText(m: TokenDescriptor): string {
  const lines = [m.label.toUpperCase(), ROLES[m.role] ?? m.role];
  if (m.primary) lines.push(`Estado: ${PRIMARY_ES[m.primary] ?? m.primary}`);
  if (m.kind) lines.push(`Tarea: ${KIND_ES[m.kind] ?? m.kind}`);
  if (m.model) lines.push(`Modelo: ${m.model}`);
  if (m.awaitingApproval) lines.push('Aprobación pendiente');
  if (m.hasError) lines.push('Error reciente');
  return lines.join('\n');
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

// Refs de cada tipo visual — sustituyen a los WithSlots<{...}> del legacy.
// Fase 2 del Plan de Migración ECS: los refs vienen del VisualKindHandle
// que crea/actualiza RenderSyncSystem, ya no de Object.assign directo.
// HubRefs/RoomRefs ya no hacen falta aquí (Fase 3): su animación vive en
// engine.animate(), que resuelve los refs internamente por `kind`.
interface TokenRefs {
  ring: PIXI.Graphics; ringOuter: PIXI.Graphics; diamond: PIXI.Graphics;
  label: PIXI.Text; tip: PIXI.Text; bubble: PIXI.Graphics;
  nameText: PIXI.Text; nameBg: PIXI.Graphics;
}

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
    // Ids de sala conocidos entre frames — sustituye a la Map roomGfx del
    // legacy (que guardaba objetos Pixi localmente); ahora el bridge/ECS
    // los guarda, aquí solo hace falta saber "qué ids vimos la vez
    // anterior" para poder destruir los que ya no están.
    const knownRoomIds = new Set<string>();
    const seenEventIds = new Set<string>();

    // El motor se construye dentro del IIFE async (necesita `world`, que
    // no existe todavía aquí) pero el cleanup de fuera necesita poder
    // llamar a clear() al desmontar — mismo patrón que camera.
    let engineRef: WorldEngine | null = null;

    // La cámara se construye aquí, no dentro del IIFE — igual que antes
    // (Fase 5), sus listeners deben engancharse de forma síncrona al
    // montar. camera.world se fija más abajo, después de app.init(), vía
    // setWorld(); hasta entonces los handlers no-opean con seguridad (ver
    // CameraSystem).
    const camera = new CameraSystem(host);

    host.addEventListener('pointerdown', camera.onPointerDown);
    host.addEventListener('pointermove', camera.onPointerMove);
    host.addEventListener('pointerup', camera.onPointerUp);
    host.addEventListener('wheel', camera.onWheel, { passive: false });

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
      // zIndex explícito (Fase 2) — hub/sala/token declaran su zIndex al
      // crearse (ver RenderSyncSystem). El resto de capas de abajo se
      // quedan en el zIndex 0 implícito, así que mantienen su orden
      // relativo de siempre y siguen por debajo de las entidades.
      world.sortableChildren = true;
      app.stage.addChild(world);

      const gridGfx = buildGrid(1000, 1000);
      const trailGfx = new PIXI.Graphics();
      const scanGfx = new PIXI.Graphics();
      const rippleGfx = new PIXI.Graphics();
      const orbit = new PIXI.Graphics();
      const spokes = new PIXI.Graphics();
      world.addChild(gridGfx, trailGfx, scanGfx, rippleGfx, orbit, spokes);
      camera.setWorld(world);

      // El motor se construye aquí, no antes — RenderSyncSystem (Fase 2)
      // necesita el container `world` ya creado para poder añadirle hijos;
      // ParticleSystem (Fase 4) dibuja sobre `rippleGfx`, creado y
      // posicionado arriba por WorldCanvas.tsx (no por el motor) para
      // conservar exactamente su orden de addChild/z-order.
      const engine = new WorldEngine(world, rippleGfx);
      engineRef = engine;

      // fitScene lee propsRef.current (no `hub`/`rooms` del scope del
      // componente) por el mismo motivo que antes: evitar un closure
      // obsoleto si React re-renderiza mientras app.init() todavía no
      // resuelve.
      camera.fitScene(propsRef.current.hub, propsRef.current.rooms, app.screen.width, app.screen.height);

      const minimapContainer = new PIXI.Container();
      minimapContainer.label = 'minimap';
      app.stage.addChild(minimapContainer);
      const minimapBg = new PIXI.Graphics();
      const minimapDots = new PIXI.Graphics();
      const minimapViewport = new PIXI.Graphics();
      minimapContainer.addChild(minimapBg, minimapDots, minimapViewport);

      // Slice 1 — Leyenda fija y discreta (esquina inferior izquierda, espejo
      // del minimapa). Se reconstruye solo cuando cambia el set de roles
      // presentes, no cada frame — evita churn de PIXI.Text. Su posición sí se
      // fija cada frame (depende de la altura de pantalla).
      const legendContainer = new PIXI.Container();
      legendContainer.label = 'legend';
      legendContainer.eventMode = 'none';   // panel decorativo, no intercepta hover
      app.stage.addChild(legendContainer);
      let legendKey = '';
      let legendH = 0;

      // Slice 1 — Tooltip de hover. Se crea una vez; el ticker solo actualiza
      // texto, tamaño del fondo, posición y visibilidad. Vive en app.stage
      // (espacio de pantalla), posicionado vía world.toGlobal().
      const tooltipContainer = new PIXI.Container();
      tooltipContainer.label = 'tooltip';
      tooltipContainer.visible = false;
      tooltipContainer.eventMode = 'none';   // no intercepta el hover del token
      const tooltipBg = new PIXI.Graphics();
      const tooltipTxt = makeText('', { fontSize: 8.5, fill: COLOR.ink, lineHeight: 12 });
      tooltipTxt.position.set(8, 6);
      tooltipContainer.addChild(tooltipBg, tooltipTxt);
      app.stage.addChild(tooltipContainer);

      // Estado de hover — el id del token bajo el cursor (o null). Lo fijan los
      // listeners pointerover/pointerout enganchados en el bucle de tokens.
      let hoveredTokenId: string | null = null;
      const hoverBound = new WeakSet<PIXI.Container>();

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

        // Hub — ensureVisual crea/actualiza el container Pixi de forma
        // síncrona (Fase 2); engine.animate() aplica el glow (Fase 3).
        const orbitRx = 420, orbitRy = 400;
        orbit.clear()
          .ellipse(hub.x, hub.y, orbitRx, orbitRy)
          .stroke({ width: 0.8, color: COLOR.line, alpha: 0.8 });

        engine.ensureVisual('hub', 'hub', { x: hub.x, y: hub.y }, COLOR.ember, hub.label, hub.sublabel);
        engine.setSelectable('hub', hub.onClick);
        engine.animate('hub', {}, t);

        // Spokes + data pulses — densidad PROPORCIONAL a la actividad REAL del agente de
        // cada sala (activityLevel, derivado de work_items in_progress vía K.4). Roadmap
        // Fase 3 (D3): sin actividad → sin paquetes (no se inventa flujo).
        spokes.clear();
        for (const r of rooms) {
          const a = r.activityLevel;
          spokes.moveTo(hub.x, hub.y).lineTo(r.x, r.y)
            .stroke({ width: 0.8 + 1.0 * a, color: r.color, alpha: 0.12 + 0.22 * a });
        }
        for (const r of rooms) {
          const a = r.activityLevel;
          const numPackets = Math.round(4 * a);   // 0 (idle) … 4 (working): proporcional al estado real
          const speed = 0.16 + 0.14 * a;
          for (let p = 0; p < numPackets; p++) {
            const progress = (t * speed + hashOffset(r.id) + p / numPackets) % 1;
            const px = hub.x + (r.x - hub.x) * progress;
            const py = hub.y + (r.y - hub.y) * progress;
            const fade = Math.sin(progress * Math.PI);
            const sz = 2.2 + 1.4 * a;
            spokes.circle(px, py, sz)
              .fill({ color: r.color, alpha: (0.1 + 0.12 * a) + 0.6 * fade });
          }
        }

        // Rooms — ensureVisual sustituye a "buscar en roomGfx o buildRoom +
        // addChild" (Fase 2). engine.animate() aplica alert/active dot,
        // glow, fill, barra y pulse ring (Fase 3) — misma fórmula, ahora en
        // roomAnimation (visuals/room.ts).
        const seenRooms = new Set<string>();
        for (const r of rooms) {
          seenRooms.add(r.id);
          knownRoomIds.add(r.id);

          engine.ensureVisual(r.id, 'room', { x: r.x, y: r.y }, r.color, r.label, r.sublabel);
          engine.setSelectable(r.id, r.onClick);
          engine.animate(r.id, {
            id: r.id,
            color: r.color,
            pending: r.pending,
            active: r.active,
            hasError: r.hasError,
            activityLevel: r.activityLevel,
          }, t);
        }
        for (const id of knownRoomIds) {
          if (!seenRooms.has(id)) {
            engine.removeVisual(id);
            knownRoomIds.delete(id);
          }
        }

        // Tokens — upsert/setTarget (Fase 1, intactos) siguen fijando el
        // movimiento. ensureTokenVisual (Fase 2) crea/actualiza SOLO el
        // container Pixi + color/label — la posición final se fija después
        // de engine.tick(), igual que antes.
        // Slice 1 — el cuerpo del token toma el color de IDENTIDAD (rol/
        // departamento). El estado (working/justActed) ya lo comunican el
        // anillo pulsante y la burbuja de acción (tokenAnimation), y el
        // minimapa sigue coloreando por estado — separación cuerpo=identidad,
        // anillo=estado.
        const seenTokens = new Set<string>();
        const tokenMeta = new Map(tokens.map((t) => [t.id, t]));
        for (const tk of tokens) {
          seenTokens.add(tk.id);
          const color = tk.color;
          const node = engine.get(tk.id);
          if (!node) {
            engine.upsert(tk.id, { x: tk.x, y: tk.y }, color, tk.label);
            // F1: Register character for BehaviorSystem — maps token to agent via world_entities
            const agentId = Number(tk.id);
            const characterEntity = worldModelClient.getCharacterForAgent(agentId);
            if (characterEntity) {
              engine.registerCharacter(tk.id, characterEntity, agentId);
            }
          } else {
            // BehaviorSystem now owns Motion.target; only update visual properties
            node.color = color;
            node.label = tk.label;
          }
          engine.ensureTokenVisual(tk.id, color, tk.label);
          engine.setSelectable(tk.id, tk.onClick);
        }
        for (const node of engine.all()) {
          if (!seenTokens.has(node.id)) {
            engine.remove(node.id);
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

        // Token visuals — mismo bucle de siempre, leyendo el handle del
        // bridge en vez de la Map tokenGfx local. La animación
        // (ring/ringOuter, burbuja de acción) ahora vive en engine.animate()
        // (Fase 3), ver más abajo.
        for (const node of engine.all()) {
          const handle = engine.getVisualHandle(node.id);
          if (!handle) continue;
          const refs = handle.refs as unknown as TokenRefs;
          const meta = tokenMeta.get(node.id);

          // Hover para tooltip — se engancha UNA vez por container (mismo
          // criterio que SelectionSystem con pointertap), guardado en un
          // WeakSet para no re-enganchar ni fugar al recrearse el token.
          if (!hoverBound.has(handle.container)) {
            hoverBound.add(handle.container);
            const id = node.id;
            handle.container.on('pointerover', () => { hoveredTokenId = id; });
            handle.container.on('pointerout', () => { if (hoveredTokenId === id) hoveredTokenId = null; });
          }

          handle.container.position.set(node.pos.x, node.pos.y);
          refs.diamond.tint = node.color;
          // Slice 1 — monograma por rol (único), no la inicial del nombre.
          refs.label.text = (meta && ROLE_LETTER[meta.role]) || node.label[0]?.toUpperCase() || '';

          // Name badge
          refs.nameText.text = node.label;
          refs.nameBg.clear();
          const nw = node.label.length * 5 + 12;
          refs.nameBg
            .roundRect(-nw / 2, -14 - 12, nw, 12, 3)
            .fill({ color: COLOR.panel, alpha: 0.85 })
            .stroke({ width: 0.5, color: node.color, alpha: 0.5 });

          const state = tokenState.get(node.id);
          const isWorking = state?.working ?? false;
          const isJustActed = state?.justActed ?? false;

          // Ring/ringOuter de pulso + burbuja de acción — Fase 3, ahora en
          // tokenAnimation (visuals/token.ts).
          engine.animate(node.id, { working: isWorking, justActed: isJustActed, action: state?.action }, t);
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

        // Ripples from events — spawnParticle crea la entidad ECS (Fase 4);
        // TTLSystem la expira sola y ParticleSystem la redibuja cada frame
        // (visuals/particles.ts: rippleEffect), ver engine.syncParticles()
        // más abajo.
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
              engine.spawnParticle('ripple', { x: room.x, y: room.y }, rippleColor, 1800);
            }
          }
        }
        engine.syncParticles();

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

        // ── Leyenda de roles (Slice 1) — reconstruida solo al cambiar el set
        // de roles; posición fija cada frame (inferior, a la derecha del rail
        // izquierdo para no quedar oculta bajo el panel Ship Crew) ──
        const roleColorMap = new Map<string, number>();
        for (const tk of tokens) if (!roleColorMap.has(tk.role)) roleColorMap.set(tk.role, tk.color);
        const legendRoles = [...roleColorMap.keys()];
        const key = legendRoles.join(',');
        if (key !== legendKey) {
          legendKey = key;
          for (const c of legendContainer.removeChildren()) c.destroy({ children: true });
          const padX = 8, padY = 6, rowH = 14, swSz = 10;
          const bg = new PIXI.Graphics();
          legendContainer.addChild(bg);
          let maxW = 0;
          legendRoles.forEach((role, i) => {
            const y = padY + i * rowH;
            const swatch = new PIXI.Graphics()
              .roundRect(padX, y + 1, swSz, swSz, 2)
              .fill({ color: roleColorMap.get(role)!, alpha: 0.9 });
            const letter = makeText(ROLE_LETTER[role] ?? role[0]?.toUpperCase() ?? '', { fontSize: 7, fontWeight: '700', fill: COLOR.void });
            letter.anchor.set(0.5);
            letter.position.set(padX + swSz / 2, y + 1 + swSz / 2);
            const name = makeText(ROLES[role] ?? role, { fontSize: 8, fill: COLOR.ink });
            name.position.set(padX + swSz + 6, y + 1);
            legendContainer.addChild(swatch, letter, name);
            maxW = Math.max(maxW, padX + swSz + 6 + name.width);
          });
          legendH = padY * 2 + legendRoles.length * rowH;
          bg.roundRect(0, 0, maxW + padX, legendH, 3)
            .fill({ color: COLOR.panel, alpha: 0.82 })
            .stroke({ width: 1, color: COLOR.line, alpha: 0.8 });
        }
        legendContainer.position.set(LEFT_RAIL_RIGHT + MINIMAP_PAD, sh - legendH - MINIMAP_PAD);
        legendContainer.visible = legendRoles.length > 0;

        // ── Tooltip de hover (Slice 1) — solo datos reales, borde con el
        // color de identidad del agente ──
        const hoverMeta = hoveredTokenId ? tokenMeta.get(hoveredTokenId) : undefined;
        const hoverNode = hoveredTokenId ? engine.get(hoveredTokenId) : undefined;
        if (hoverMeta && hoverNode) {
          tooltipTxt.text = tooltipText(hoverMeta);
          const w = tooltipTxt.width + 16;
          const h = tooltipTxt.height + 12;
          tooltipBg.clear()
            .roundRect(0, 0, w, h, 3)
            .fill({ color: COLOR.panel, alpha: 0.94 })
            .stroke({ width: 1, color: hoverMeta.color, alpha: 0.7 });
          const gp = world.toGlobal(new PIXI.Point(hoverNode.pos.x, hoverNode.pos.y));
          let tx = gp.x + 16;
          let ty = gp.y - h - 8;
          if (tx + w > sw) tx = gp.x - w - 16;
          if (ty < 0) ty = gp.y + 16;
          tooltipContainer.position.set(tx, ty);
          tooltipContainer.visible = true;
        } else {
          tooltipContainer.visible = false;
        }
      });
    })();

    return () => {
      destroyed = true;
      host.removeEventListener('pointerdown', camera.onPointerDown);
      host.removeEventListener('pointermove', camera.onPointerMove);
      host.removeEventListener('pointerup', camera.onPointerUp);
      host.removeEventListener('wheel', camera.onWheel);
      try { app.destroy(true, { children: true }); } catch { /* ya destruido */ }
      knownRoomIds.clear();
      engineRef?.clear();
    };
  }, []);

  return <div ref={hostRef} className="hk-scene" />;
}
