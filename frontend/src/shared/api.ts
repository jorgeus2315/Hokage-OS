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

  departments: async (): Promise<import('./types').Building[] | null> => {
    type Raw = { id: number; key: string; name: string; desc: string; role: string; glyph: string; color: string; pos_x: number; pos_y: number; is_hub: number };
    const raw = await req<Raw[]>('/departments');
    if (!raw) return null;
    return raw.map((d) => ({ id: d.key, name: d.name, desc: d.desc, role: d.role, glyph: d.glyph, color: d.color, db_id: d.id, pos_x: d.pos_x, pos_y: d.pos_y, is_hub: d.is_hub === 1 }));
  },
  updateDepartment: (dbId: number, payload: { name?: string; desc?: string; color?: string; pos_x?: number; pos_y?: number; active?: number }) =>
    req(`/departments/${dbId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),

  runtimeStatus: () => req<{ running: boolean }>('/runtime/status'),
  runtimeStart: () => req('/runtime/start', { method: 'POST' }),
  runtimeStop: () => req('/runtime/stop', { method: 'POST' }),
};
