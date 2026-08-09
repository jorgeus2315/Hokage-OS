const BASE = '/api';

declare global {
  interface ImportMeta {
    readonly env?: {
      readonly VITE_ADMIN_TOKEN?: string;
    };
  }
}

// Exportado para reutilizar el mismo valor en el handshake del WebSocket (useWebSocket.ts)
// — una sola lectura de VITE_ADMIN_TOKEN, nunca una segunda fuente de configuración.
export const ADMIN_TOKEN = (typeof window !== 'undefined' ? import.meta.env?.VITE_ADMIN_TOKEN : undefined) || '';

function adminHeaders(): Record<string, string> {
  return ADMIN_TOKEN ? { 'x-admin-token': ADMIN_TOKEN } : {};
}

async function req<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(BASE + path, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...(init?.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(init.method.toUpperCase()) ? adminHeaders() : {}),
      },
    });
    if (!res.ok) {
      let payload: Record<string, unknown> = {};
      try { payload = await res.json(); } catch {}
      const msg = typeof payload.error === 'string' ? payload.error : `HTTP ${res.status}`;
      console.error(`[API] ${path} -> ${res.status}: ${msg}`);
      return null;
    }
    const json = await res.json();
    return json.ok ? (json.data as T) : null;
  } catch (err) {
    console.error(`[API] ${path} -> error`, err);
    return null;
  }
}

export const api = {
  agents: () => req<import('./types').Agent[]>('/agents'),
  decisions: () => req<import('./types').Decision[]>('/decisions'),
  agentRuns: (agentId?: number) => req<import('./types').AgentRun[]>(agentId ? `/agent-runs?agent_id=${agentId}` : '/agent-runs'),
  messages: () => req<import('./types').CommMsg[]>('/messages'),

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
    type Raw = { id: number; key: string; name: string; desc: string; role: string; glyph: string; color: string; pos_x: number; pos_y: number; is_hub: number; position_locked: number };
    const raw = await req<Raw[]>('/departments');
    if (!raw) return null;
    return raw.map((d) => ({ id: d.key, name: d.name, desc: d.desc, role: d.role, glyph: d.glyph, color: d.color, db_id: d.id, pos_x: d.pos_x, pos_y: d.pos_y, is_hub: d.is_hub === 1, position_locked: d.position_locked === 1 }));
  },
  updateDepartment: (dbId: number, payload: { name?: string; desc?: string; color?: string; pos_x?: number; pos_y?: number; active?: number }) =>
    req(`/departments/${dbId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),

  workItems: (agentId: number) => req<import('./types').WorkItem[]>(`/agents/${agentId}/work-items`),
  agentOutputs: (agentId: number) =>
    req<{ content: import('./types').ContentItem[]; market: import('./types').MarketItem[] }>(`/agents/${agentId}/outputs`),

  hermesRuns: () => req<import('./types').ExecRun[]>('/hermes/runs'),

  metricsSummary: () => req<import('./types').MetricsSummary>('/metrics/summary'),
  agentStats: (agentId: number) => req<{
    total_runs: number; successful_runs: number; failed_runs: number;
    success_rate: number | null; total_tokens: number; total_cost_usd: number;
    active_work_items: number; pending_work_items: number;
    pending_decisions: number; last_run_at: string | null;
  }>(`/agents/${agentId}/stats`),

  runtimeStatus: () => req<{ running: boolean }>('/runtime/status'),
  runtimeStart: () => req('/runtime/start', { method: 'POST' }),
  runtimeStop: () => req('/runtime/stop', { method: 'POST' }),

  expireOldDecisions: (olderThanHours = 0) =>
    req<{ expired: number }>('/decisions/expire-old', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ older_than_hours: olderThanHours }),
    }),

  assets: (ventureId?: number) =>
    req<Array<{ id: number; venture_id: number | null; type: string; name: string; status: string; platform: string | null; created_at: string }>>(
      ventureId ? `/assets?venture_id=${ventureId}` : '/assets'
    ),

  ventures: () => req<import('./types').Venture[]>('/ventures'),
  createVenture: (payload: { name: string; type?: string; goal?: string; revenue_target_usd?: number }) =>
    req('/ventures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),

  automations: () => req<import('./types').Automation[]>('/automations'),
  createAutomation: (payload: Record<string, unknown>) =>
    req<import('./types').Automation>('/automations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  updateAutomation: (id: number, payload: Record<string, unknown>) =>
    req<import('./types').Automation>(`/automations/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  deleteAutomation: (id: number) =>
    req(`/automations/${id}`, { method: 'DELETE' }),
  toggleAutomation: (id: number) =>
    req(`/automations/${id}/toggle`, { method: 'PATCH' }),

  objectives: () => req<import('./types').Objective[]>('/objectives'),
  createObjective: (title: string) =>
    req<import('./types').Objective>('/objectives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }),
  approvePlan: (objectiveId: number) =>
    req<import('./types').Objective>(`/objectives/${objectiveId}/plan/approve`, { method: 'PUT' }),
  updateObjective: (id: number, payload: { status?: string }) =>
    req<import('./types').Objective>(`/objectives/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  retryObjective: (id: number) =>
    req<import('./types').Objective>(`/objectives/${id}/retry`, { method: 'POST' }),

  // Prompts y configuración de agentes
  getAgentPrompt: (agentId: number) =>
    req<{ content: string }>(`/agents/${agentId}/prompt`),
  setAgentPrompt: (agentId: number, content: string) =>
    req(`/agents/${agentId}/prompt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  updateAgent: (agentId: number, payload: { name?: string; model?: string }) =>
    req(`/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  // Prompt maestro global
  getMasterPrompt: () => req<{ content: string }>('/config/master-prompt'),
  setMasterPrompt: (content: string) =>
    req('/config/master-prompt', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
};
