import type * as PIXI from 'pixi.js';
import type { Vec2 } from '../types';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;
const PAN_THRESHOLD = 4;

// Pan/zoom/fitScene del mapa — extraído verbatim de los handlers DOM
// sueltos y la función fitScene() que vivían dentro del useEffect de
// WorldCanvas.tsx. Fase 5 del Plan de Migración ECS.
//
// NO implementa la interfaz System ni se registra vía ecs.addSystem() —
// decisión explícita (2026-08-06, confirmada por Jorge antes de
// implementar): la cámara es una única instancia global, nunca un
// conjunto de entidades sobre las que barrer, así que no aporta nada
// modelarla como entidad/componente del ECS (ComponentStore/EntityStore
// existen para eso, no para un singleton). Mismo criterio que cerró la
// deuda técnica de la Fase 4: no registrar maquinaria ECS que nada usa.
//
// `world` es nullable y se fija después, vía setWorld() — mismo motivo que
// el `worldRef`/`engineRef` que ya usaba WorldCanvas.tsx: los listeners DOM
// se enganchan de forma síncrona al montar (antes de que `app.init()`
// resuelva y exista el PIXI.Container `world`), así que deben poder
// no-opear con seguridad durante esa ventana — igual que hacía el `worldRef
// ?? 0`/`if (!worldRef) return` original.
export class CameraSystem {
  private world: PIXI.Container | null = null;
  private panState: 'idle' | 'pending' | 'panning' = 'idle';
  private dragStart: Vec2 = { x: 0, y: 0 };
  private worldStart: Vec2 = { x: 0, y: 0 };
  private pendingPointerId = -1;

  constructor(private host: HTMLElement) {}

  setWorld(world: PIXI.Container): void {
    this.world = world;
  }

  // Ajuste inicial de cámara — llamado una sola vez, tras setWorld(), antes
  // de que arranque el ticker. hub/rooms/screenW/screenH se pasan como
  // parámetros en vez de leerse de un closure/propsRef: CameraSystem no
  // conoce React, el call site (WorldCanvas.tsx) sigue leyendo
  // propsRef.current igual que antes, evitando el mismo bug de closure
  // obsoleto que ya evitaba el código original.
  fitScene(hub: Vec2, rooms: Vec2[], screenW: number, screenH: number): void {
    if (!this.world) return;
    if (screenW === 0 || screenH === 0) return;
    const allX = [hub.x, ...rooms.map((r) => r.x)];
    const allY = [hub.y, ...rooms.map((r) => r.y)];
    const margin = 140;
    const minX = Math.min(...allX) - margin;
    const maxX = Math.max(...allX) + margin;
    const minY = Math.min(...allY) - margin;
    const maxY = Math.max(...allY) + margin;
    const sceneW = maxX - minX;
    const sceneH = maxY - minY;
    const scale = Math.min(screenW / sceneW, screenH / sceneH, 1.4);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.world.scale.set(scale);
    this.world.position.set(screenW / 2 - cx * scale, screenH / 2 - cy * scale);
  }

  // Arrow function class property (no PIXI.Application) — mantiene una
  // referencia de función estable por instancia, necesaria para que
  // host.addEventListener/removeEventListener apunten al mismo callback.
  onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.panState = 'pending';
    this.pendingPointerId = e.pointerId;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.worldStart = { x: this.world?.position.x ?? 0, y: this.world?.position.y ?? 0 };
  };

  onPointerMove = (e: PointerEvent): void => {
    if (this.panState === 'idle' || !this.world) return;
    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;
    if (this.panState === 'pending') {
      if (Math.abs(dx) < PAN_THRESHOLD && Math.abs(dy) < PAN_THRESHOLD) return;
      this.panState = 'panning';
      this.host.setPointerCapture(this.pendingPointerId);
    }
    this.world.position.set(this.worldStart.x + dx, this.worldStart.y + dy);
  };

  onPointerUp = (): void => {
    this.panState = 'idle';
  };

  onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (!this.world) return;
    const direction = e.deltaY < 0 ? 1 : -1;
    const oldScale = this.world.scale.x;
    const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldScale + direction * ZOOM_STEP * oldScale));
    if (newScale === oldScale) return;
    const rect = this.host.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const wx = (mouseX - this.world.position.x) / oldScale;
    const wy = (mouseY - this.world.position.y) / oldScale;
    this.world.scale.set(newScale);
    this.world.position.set(mouseX - wx * newScale, mouseY - wy * newScale);
  };
}
