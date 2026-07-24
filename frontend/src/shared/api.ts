const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(BASE + path, init);
    const json = await res.json();
    return json.ok ? (json.data as T) : null;
  } catch {
    return null;
  }
}

export const api = {
  agents: () => req<import('./types').Agent[]>('/agents'),
  businesses: () => req<import('./types').Business[]>('/businesses'),
  decisions: () => req<import('./types').Decision[]>('/decisions'),
  achievements: () => req<import('./types').Achievement[]>('/achievements'),
  agentRuns: (agentId?: number) => req<import('./types').AgentRun[]>(agentId ? `/agent-runs?agent_id=${agentId}` : '/agent-runs'),
  messages: () => req<import('./types').CommMsg[]>('/messages'),
  progress: () => req<Array<{ xp: number; level: number }>>('/progress'),

  ask: (agentId: number, message: string) =>
    req<{ response: string; tokens: number }>(`/agents/${agentId}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }),

  runNow: (agentId: number, task?: string) =>
    req(`/agents/${agentId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: task || 'Ejecuta tu tarea principal ahora.' }),
    }),

  approve: (id: number) => req(`/decisions/${id}/approve`, { method: 'PUT' }),
  reject: (id: number) => req(`/decisions/${id}/reject`, { method: 'PUT' }),

  runtimeStatus: () => req<{ running: boolean }>('/runtime/status'),
  runtimeStart: () => req('/runtime/start', { method: 'POST' }),
  runtimeStop: () => req('/runtime/stop', { method: 'POST' }),
};
