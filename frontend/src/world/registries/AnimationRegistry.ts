// Comportamiento de animación de un tipo visual — recibe los refs Pixi ya
// creados (mismo VisualKindHandle.refs de la Fase 2), un estado efímero
// específico del tipo (pending/active/hasError para sala, working/
// justActed/action para token — cada behavior conoce su propia forma) y el
// tiempo transcurrido en segundos. No devuelve nada — muta los refs Pixi
// directamente, igual que hacía WorldCanvas.tsx antes de esta fase.
export type AnimationBehavior = (
  refs: Record<string, unknown>,
  state: Record<string, unknown>,
  t: number,
) => void;

// Registro de comportamientos de animación — mismo patrón exacto que
// VisualKindRegistry (Fase 2). Un tipo visual nuevo registra su propia
// animación aquí, nunca tocando AnimationSystem.
export class AnimationRegistry {
  private behaviors = new Map<string, AnimationBehavior>();

  register(kind: string, behavior: AnimationBehavior): void {
    this.behaviors.set(kind, behavior);
  }

  get(kind: string): AnimationBehavior | undefined {
    return this.behaviors.get(kind);
  }
}
