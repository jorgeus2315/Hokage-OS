import type { Vec2, WorldNode } from './types';

// Fracción de la distancia al objetivo que se recorre en cada tick.
// Sustituye a las CSS transitions: el motor interpola la posición cada
// frame, con independencia del ciclo de render de React.
const EASE = 0.06;

export class WorldEngine {
  private nodes = new Map<string, WorldNode>();

  upsert(id: string, initial: Vec2, color: number, label: string): WorldNode {
    const existing = this.nodes.get(id);
    if (existing) {
      existing.color = color;
      existing.label = label;
      return existing;
    }
    const node: WorldNode = { id, pos: { ...initial }, target: { ...initial }, color, label };
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

  // MovementSystem: se llama una vez por frame.
  tick(): void {
    for (const node of this.nodes.values()) {
      node.pos.x += (node.target.x - node.pos.x) * EASE;
      node.pos.y += (node.target.y - node.pos.y) * EASE;
    }
  }
}
