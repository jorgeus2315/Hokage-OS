// AgentStateStore — Single source of truth for AgentRuntimeState on the frontend.
// Hydrated from initial_snapshot.agent_states + updated via agent.state.changed deltas.
// No derivation, no heuristics, no timers. Pure state container.

import type { AgentRuntimeState } from '../../shared/types';

export class AgentStateStore {
  private states = new Map<number, AgentRuntimeState>();
  private listeners = new Set<() => void>();

  // Hydrate from initial snapshot (array of AgentRuntimeState)
  hydrate(states: AgentRuntimeState[]): void {
    this.states.clear();
    for (const s of states) {
      this.states.set(s.agentId, s);
    }
    this.notify();
  }

  // Apply delta from agent.state.changed event
  applyDelta(state: AgentRuntimeState): void {
    const existing = this.states.get(state.agentId);
    // Only update if signature actually changed (backend already dedups, but defensive)
    if (existing && this.signature(existing) === this.signature(state)) {
      return;
    }
    this.states.set(state.agentId, state);
    this.notify();
  }

  // Remove agent (e.g., on agent deletion)
  remove(agentId: number): void {
    this.states.delete(agentId);
    this.notify();
  }

  // Set state directly (for testing)
  set(agentId: number, state: AgentRuntimeState): void {
    this.states.set(agentId, state);
    this.notify();
  }

  // Clear all states (for testing)
  clear(): void {
    this.states.clear();
    this.notify();
  }

  // Get single agent state
  get(agentId: number): AgentRuntimeState | undefined {
    return this.states.get(agentId);
  }

  // Get all states
  getAll(): AgentRuntimeState[] {
    return [...this.states.values()];
  }

  // Get state for agents that have a character entity (for BehaviorSystem)
  getForCharacters(characterAgentIds: number[]): Map<number, AgentRuntimeState> {
    const result = new Map<number, AgentRuntimeState>();
    for (const agentId of characterAgentIds) {
      const state = this.states.get(agentId);
      if (state) result.set(agentId, state);
    }
    return result;
  }

  // Subscribe to changes
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  // Signature matches backend's stateSignature for consistency
  private signature(s: AgentRuntimeState): string {
    return [
      s.primary,
      s.modifiers.awaitingApproval ? 'A' : '',
      s.modifiers.hasError ? 'E' : '',
      s.modifiers.blocked ? 'B' : '',
      s.modifiers.reviewing ? 'R' : '',
      s.currentTask?.workItemId ?? '',
      s.ventureId ?? '',
    ].join('|');
  }
}

// Singleton instance for the app
export const agentStateStore = new AgentStateStore();