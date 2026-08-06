// Bridge/adapter temporal — Fases 1-4 del Plan de Migración ECS (vault
// 02_Sistemas/World Engine/Plan de Migración ECS.md).
//
// FASE 1: expone la misma API de movimiento que el WorldEngine legacy
// (upsert/setTarget/get/all/remove/clear/tick, mismo shape WorldNode).
// Delega en MovementSystem sobre componentes Position/Motion del ECS.
//
// FASE 2: añade registro de entidades solo-visuales (hub, salas — nunca
// tuvieron Motion) y sincroniza sus containers Pixi vía RenderSyncSystem +
// VisualKindRegistry. Los tokens, que ya pasan por upsert()/setTarget()
// (Fase 1), ganan también su componente Visual con setVisual() — sin que
// upsert()/setTarget() cambien una línea.
//
// FASE 3: añade animate(), que resuelve refs Pixi vía AnimationSystem +
// AnimationRegistry — mismo patrón síncrono que ensureVisual/ensureTokenVisual.
//
// FASE 4: añade spawnParticle()/syncParticles() — TTLSystem (genérico,
// cualquier entidad con componente Ttl) + ParticleSystem (dibuja sobre un
// Graphics que sigue creando/posicionando WorldCanvas.tsx, no este bridge,
// para preservar el z-order exacto de las capas de fondo). Ninguno de los
// dos se registra vía ecs.addSystem() — su único camino de ejecución es
// syncParticles() (corregido el 2026-08-06, ver Plan de Migración ECS).
//
// FASE 6: añade setSelectable() — SelectionSystem engancha el listener
// pointertap una sola vez por container (la primera vez que la entidad
// gana componente Selectable) y lo delega a components.getComponent() en
// el momento del click, sustituyendo el patrón
// Object.assign(container, { __onClick }). Tampoco se registra vía
// ecs.addSystem() — mismo criterio que TTL/Particle/Camera.
//
// El WorldEngine legacy (./WorldEngine.ts) se deja intacto y sin usar,
// como red de seguridad, hasta la Fase 9 (limpieza final) del plan.

import * as PIXI from 'pixi.js';
import { WorldEngine as ECSWorldEngine } from './ecs/WorldEngine';
import { MovementSystem } from './systems/MovementSystem';
import { RenderSyncSystem } from './systems/RenderSyncSystem';
import { AnimationSystem } from './systems/AnimationSystem';
import { TTLSystem } from './systems/TTLSystem';
import { ParticleSystem } from './systems/ParticleSystem';
import { SelectionSystem } from './systems/SelectionSystem';
import { VisualKindRegistry, type VisualKindHandle } from './registries/VisualKindRegistry';
import { AnimationRegistry } from './registries/AnimationRegistry';
import { ParticleEffectRegistry } from './registries/ParticleEffectRegistry';
import { registerCoreVisualKinds, registerCoreAnimations, registerCoreParticleEffects } from './visuals';
import {
  ComponentKinds,
  type PositionComponent,
  type MotionComponent,
  type VisualComponent,
  type ParticleComponent,
  type TtlComponent,
  type SelectableComponent,
} from './ecs/components';
import type { Vec2, WorldNode } from './types';

export class WorldEngine {
  private ecs = new ECSWorldEngine();
  private movement = new MovementSystem();
  private renderSync: RenderSyncSystem;
  private registry = new VisualKindRegistry();
  private animationRegistry = new AnimationRegistry();
  private animation: AnimationSystem;
  private ttl = new TTLSystem();
  private particleRegistry = new ParticleEffectRegistry();
  private particles: ParticleSystem;
  private selection = new SelectionSystem();
  private nodes = new Map<string, WorldNode>();

  // rippleGfx (o cualquier Graphics de partículas futuro) lo crea y
  // posiciona WorldCanvas.tsx, no este motor — ver nota de z-order en
  // ParticleSystem.
  //
  // ttl/particles NO se registran vía ecs.addSystem() (corregido el
  // 2026-08-06 — ver "Deuda técnica resuelta" en el Plan de Migración
  // ECS): su único camino de ejecución es syncParticles(), más abajo.
  // Registrarlos también como System hacía que engine.tick() los
  // ejecutara una segunda vez cada frame, automáticamente.
  constructor(worldContainer: PIXI.Container, particleGfx: PIXI.Graphics) {
    registerCoreVisualKinds(this.registry);
    registerCoreAnimations(this.animationRegistry);
    registerCoreParticleEffects(this.particleRegistry);
    this.renderSync = new RenderSyncSystem(worldContainer, this.registry);
    this.animation = new AnimationSystem(this.animationRegistry);
    this.particles = new ParticleSystem(particleGfx, this.particleRegistry);
    this.ecs.addSystem(this.movement);
    this.ecs.addSystem(this.renderSync);
    this.ecs.addSystem(this.animation);
  }

  // ── Fase 1 — movimiento (sin cambios) ───────────────────────────────

  upsert(id: string, initial: Vec2, color: number, label: string): WorldNode {
    const existing = this.nodes.get(id);
    if (existing) {
      existing.color = color;
      existing.label = label;
      return existing;
    }
    const node: WorldNode = { id, pos: { ...initial }, target: { ...initial }, color, label, trail: [] };
    this.nodes.set(id, node);
    this.ecs.createEntity(id);
    this.ecs.addComponent<PositionComponent>(id, ComponentKinds.Position, { pos: node.pos });
    this.ecs.addComponent<MotionComponent>(id, ComponentKinds.Motion, { target: node.target, trail: node.trail });
    return node;
  }

  setTarget(id: string, target: Vec2): void {
    const node = this.nodes.get(id);
    if (!node) return;
    // Muta en sitio (no reemplaza la referencia) para que el componente
    // Motion del ECS, que apunta al mismo objeto node.target, vea el cambio.
    node.target.x = target.x;
    node.target.y = target.y;
  }

  get(id: string): WorldNode | undefined {
    return this.nodes.get(id);
  }

  remove(id: string): void {
    this.renderSync.destroy(id, this.ecs.components);
    this.nodes.delete(id);
    this.ecs.destroyEntity(id);
  }

  all(): WorldNode[] {
    return [...this.nodes.values()];
  }

  clear(): void {
    this.nodes.clear();
    this.ecs.clear();
    this.ecs.addSystem(this.movement);
    this.ecs.addSystem(this.renderSync);
    this.ecs.addSystem(this.animation);
  }

  tick(): void {
    // dt no se usa por MovementSystem hoy — EASE/TRAIL son frame-based, no
    // time-based, exactamente como en el legacy (ver Baseline de
    // Comportamiento — World Engine, sección Movimiento).
    this.ecs.tick(1);
  }

  // ── Fase 2 — render (nuevo) ──────────────────────────────────────────

  // Para entidades SIN movimiento (hub, salas): fija Position directamente
  // a pos (sin lerp — hub/sala nunca se interpolan, igual que antes),
  // crea/actualiza Visual, y devuelve el handle Pixi YA listo — sin
  // esperar al siguiente tick(). Nunca se llama para tokens (ver
  // ensureTokenVisual).
  ensureVisual(id: string, kind: string, pos: Vec2, color: number, label: string, sublabel?: string): VisualKindHandle {
    if (!this.ecs.hasEntity(id)) this.ecs.createEntity(id);
    const existingPos = this.ecs.getComponent<PositionComponent>(id, ComponentKinds.Position);
    if (existingPos) {
      existingPos.pos.x = pos.x;
      existingPos.pos.y = pos.y;
    } else {
      this.ecs.addComponent<PositionComponent>(id, ComponentKinds.Position, { pos: { ...pos } });
    }
    this.setVisualComponent(id, kind, color, label, sublabel);
    const data = { pos: this.ecs.getComponent<PositionComponent>(id, ComponentKinds.Position)!.pos, color, label, sublabel };
    return this.renderSync.ensure(id, kind, data, this.ecs.components);
  }

  // Para tokens: solo toca Visual — Position lo gestiona exclusivamente
  // upsert()/setTarget() + MovementSystem (Fase 1, sin tocar). El handle
  // que devuelve puede tener la posición de un tick antiguo (o el punto de
  // spawn si es la primera vez) — WorldCanvas.tsx sigue fijando la
  // posición final del container tras engine.tick(), exactamente como
  // hacía antes con gfx.position.set(node.pos.x, node.pos.y).
  ensureTokenVisual(id: string, color: number, label: string): VisualKindHandle {
    this.setVisualComponent(id, 'token', color, label);
    const pos = this.ecs.getComponent<PositionComponent>(id, ComponentKinds.Position)?.pos ?? { x: 0, y: 0 };
    const data = { pos, color, label };
    return this.renderSync.ensure(id, 'token', data, this.ecs.components);
  }

  private setVisualComponent(id: string, kind: string, color: number, label: string, sublabel?: string): void {
    const existing = this.ecs.getComponent<VisualComponent>(id, ComponentKinds.Visual);
    if (existing) {
      existing.kind = kind;
      existing.color = color;
      existing.label = label;
      existing.sublabel = sublabel;
    } else {
      this.ecs.addComponent<VisualComponent>(id, ComponentKinds.Visual, { kind, color, label, sublabel });
    }
  }

  // Lee el handle Pixi (container + refs) ya creado — usado en la segunda
  // pasada del ticker (después de engine.tick()) para tokens, que
  // necesitan releer tras la interpolación de MovementSystem.
  getVisualHandle(id: string): VisualKindHandle | undefined {
    return this.ecs.getComponent<VisualKindHandle>(id, ComponentKinds.Render);
  }

  // ── Fase 3 — animación (nuevo) ────────────────────────────────────────

  // Anima los refs Pixi ya creados de una entidad, de forma síncrona (mismo
  // patrón que ensureVisual/ensureTokenVisual) — el llamador pasa el
  // `state` efímero propio del tipo visual (RoomAnimationState,
  // TokenAnimationState, {} para hub) y el tiempo real en segundos. No
  // hace nada si la entidad no tiene Visual o su handle Pixi todavía.
  animate(id: string, state: Record<string, unknown>, t: number): void {
    const visual = this.ecs.getComponent<VisualComponent>(id, ComponentKinds.Visual);
    const handle = this.getVisualHandle(id);
    if (!visual || !handle) return;
    this.animation.animate(visual.kind, handle.refs, state, t);
  }

  // ── Fase 4 — partículas (nuevo) ────────────────────────────────────────

  // Crea una partícula efímera de tipo `kind` (hoy: 'ripple') en `pos`, con
  // duración en ms. TTLSystem la destruye sola al expirar — el llamador no
  // necesita limpiarla ni llevar su propio array, a diferencia del
  // `ripples: Ripple[]` que vivía en WorldCanvas.tsx antes de esta fase.
  spawnParticle(kind: string, pos: Vec2, color: number, durationMs: number): void {
    const id = `particle:${kind}:${Math.random().toString(36).slice(2)}`;
    const startMs = performance.now();
    this.ecs.createEntity(id);
    this.ecs.addComponent<PositionComponent>(id, ComponentKinds.Position, { pos: { ...pos } });
    this.ecs.addComponent<ParticleComponent>(id, ComponentKinds.Particle, { kind, color, startMs });
    this.ecs.addComponent<TtlComponent>(id, ComponentKinds.Ttl, { expiresAtMs: startMs + durationMs });
  }

  // Poda partículas caducadas y redibuja las vivas — método síncrono (mismo
  // patrón que ensureVisual/animate), llamado por WorldCanvas.tsx en el
  // mismo punto del frame donde antes vivía el bucle de ripples.
  syncParticles(): void {
    this.ttl.prune(this.ecs.entities, this.ecs.components);
    this.particles.draw(this.ecs.components);
  }

  // ── Fase 6 — selección (nuevo) ──────────────────────────────────────────

  // Registra/actualiza el callback de click de una entidad. La primera vez
  // que se ve esta entidad (sin componente Selectable todavía) engancha el
  // listener pointertap sobre su container vía SelectionSystem.bind() —
  // llamadas posteriores solo reescriben el componente. Mismo criterio de
  // "siempre el callback más reciente" que ya cumplía
  // Object.assign(container, { __onClick }) antes de esta fase; no hace
  // nada si la entidad no tiene handle Pixi todavía (mismo guard que
  // animate()).
  setSelectable(id: string, onClick?: () => void): void {
    const handle = this.getVisualHandle(id);
    if (!handle) return;
    if (!this.ecs.hasComponent(id, ComponentKinds.Selectable)) {
      this.selection.bind(handle.container, id, this.ecs.components);
    }
    this.ecs.addComponent<SelectableComponent>(id, ComponentKinds.Selectable, { onClick });
  }

  // Elimina una entidad SOLO-visual (sala) — nunca se llama para tokens
  // (esos usan remove(), que ya limpia todo). El hub nunca se llama con
  // esto, no se destruye jamás.
  removeVisual(id: string): void {
    this.renderSync.destroy(id, this.ecs.components);
    this.ecs.removeComponent(id, ComponentKinds.Position);
    this.ecs.removeComponent(id, ComponentKinds.Visual);
    if (!this.ecs.hasComponent(id, ComponentKinds.Motion)) {
      this.ecs.destroyEntity(id);
    }
  }
}
