import type { Vec2, WorldNode } from './types';

const EASE = 0.06;
const TRAIL_EVERY = 5;   // frames entre cada punto del trail
const TRAIL_MAX = 7;     // máx puntos en el historial

export class WorldEngine {
  private nodes = new Map<string, WorldNode>();
  private frame = 0;

  upsert(id: string, initial: Vec2, color: number, label: string): WorldNode {
    const existing = this.nodes.get(id);
    if (existing) {
      existing.color = color;
      existing.label = label;
      return existing;
    }
    const node: WorldNode = { id, pos: { ...initial }, target: { ...initial }, color, label, trail: [] };
    this.nodes.set(id, node);
    return node;
  }

  setTarget(id: string, target: Vec2): void {
    const node = this.nodes.get(id);
    if (node) node.target = target;
  }

  get(id: string): WorldNode | undefined {
    return this.nodes.get(id);
  }

  remove(id: string): void {
    this.nodes.delete(id);
  }

  all(): WorldNode[] {
    return [...this.nodes.values()];
  }

  clear(): void {
    this.nodes.clear();
  }

  tick(): void {
    this.frame++;
    const recordTrail = this.frame % TRAIL_EVERY === 0;

    for (const node of this.nodes.values()) {
      if (recordTrail) {
        node.trail.push({ ...node.pos });
        if (node.trail.length > TRAIL_MAX) node.trail.shift();
      }
      node.pos.x += (node.target.x - node.pos.x) * EASE;
      node.pos.y += (node.target.y - node.pos.y) * EASE;
    }
  }
}
