const BASE = '/api';

// F10 — El frontend YA NO conoce el ADMIN_TOKEN (no hay VITE_ADMIN_TOKEN ni secretos en el
// bundle). Autentica por cookie de sesión HttpOnly que gestiona el navegador: todas las
// peticiones van con credentials:'include'. Un 401 = sesión ausente/expirada → se notifica para
// volver al login (sin bucles). Las mutaciones same-origin pasan el CSRF del backend (Origin).
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler | null = null;
export function setSessionExpiredHandler(h: SessionExpiredHandler | null): void { onSessionExpired = h; }

async function req<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(BASE + path, { ...init, credentials: 'include' });
    if (res.status === 401) { onSessionExpired?.(); return null; }
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

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

// ── Autenticación de sesión ──────────────────────────────────────────────────
export const auth = {
  // Estado de sesión (público). No devuelve secretos, solo { authenticated }.
  session: () => req<{ authenticated: boolean }>('/auth/session'),
  // Login con la credencial de operador. fetch crudo para NO disparar el handler de 401
  // (un 401 aquí = credencial inválida, no sesión expirada).
  login: async (password: string): Promise<boolean> => {
    try {
      const res = await fetch(BASE + '/auth/login', { ...jsonInit('POST', { password }), credentials: 'include' });
      return res.ok;
    } catch { return false; }
  },
  logout: async (): Promise<void> => {
    try { await fetch(BASE + '/auth/logout', { method: 'POST', credentials: 'include' }); } catch { /* idempotente */ }
  },
};

export const api = {
  agents: () => req<import('./types').Agent[]>('/agents'),
  decisions: () => req<import('./types').Decision[]>('/decisions'),
  agentRuns: (agentId?: number) => req<import('./types').AgentRun[]>(agentId ? `/agent-runs?agent_id=${agentId}` : '/agent-runs'),
  messages: () => req<import('./types').CommMsg[]>('/messages'),

  ask: (agentId: number, message: string) =>
    req<{ response: string; tokens: number }>(`/agents/${agentId}/ask`, jsonInit('POST', { message })),

  runNow: (agentId: number, task?: string) =>
    req(`/agents/${agentId}/run`, jsonInit('POST', { task: task || 'Ejecuta tu tarea principal ahora.' })),

  approve: (id: number) => req(`/decisions/${id}/approve`, { method: 'PUT' }),
  reject: (id: number) => req(`/decisions/${id}/reject`, { method: 'PUT' }),

  departments: async (): Promise<import('./types').Building[] | null> => {
    type Raw = { id: number; key: string; name: string; desc: string; role: string; glyph: string; color: string; pos_x: number; pos_y: number; is_hub: number; position_locked: number; type: import('./types').DepartmentType };
    const raw = await req<Raw[]>('/departments');
    if (!raw) return null;
    return raw.map((d) => ({ id: d.key, name: d.name, desc: d.desc, role: d.role, glyph: d.glyph, color: d.color, db_id: d.id, pos_x: d.pos_x, pos_y: d.pos_y, is_hub: d.is_hub === 1, position_locked: d.position_locked === 1, type: d.type ?? 'business' }));
  },
  updateDepartment: (dbId: number, payload: { name?: string; desc?: string; color?: string; pos_x?: number; pos_y?: number; active?: number }) =>
    req(`/departments/${dbId}`, jsonInit('PUT', payload)),

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
    req<{ expired: number }>('/decisions/expire-old', jsonInit('POST', { older_than_hours: olderThanHours })),

  assets: (ventureId?: number) =>
    req<Array<{ id: number; venture_id: number | null; type: string; name: string; status: string; platform: string | null; created_at: string }>>(
      ventureId ? `/assets?venture_id=${ventureId}` : '/assets'
    ),

  ventures: () => req<import('./types').Venture[]>('/ventures'),
  createVenture: (payload: { name: string; type?: string; goal?: string; revenue_target_usd?: number }) =>
    req('/ventures', jsonInit('POST', payload)),

  automations: () => req<import('./types').Automation[]>('/automations'),
  createAutomation: (payload: Record<string, unknown>) =>
    req<import('./types').Automation>('/automations', jsonInit('POST', payload)),
  updateAutomation: (id: number, payload: Record<string, unknown>) =>
    req<import('./types').Automation>(`/automations/${id}`, jsonInit('PUT', payload)),
  deleteAutomation: (id: number) => req(`/automations/${id}`, { method: 'DELETE' }),
  toggleAutomation: (id: number) => req(`/automations/${id}/toggle`, { method: 'PATCH' }),

  objectives: () => req<import('./types').Objective[]>('/objectives'),
  createObjective: (title: string) => req<import('./types').Objective>('/objectives', jsonInit('POST', { title })),
  approvePlan: (objectiveId: number) => req<import('./types').Objective>(`/objectives/${objectiveId}/plan/approve`, { method: 'PUT' }),
  updateObjective: (id: number, payload: { status?: string }) => req<import('./types').Objective>(`/objectives/${id}`, jsonInit('PATCH', payload)),
  retryObjective: (id: number) => req<import('./types').Objective>(`/objectives/${id}/retry`, { method: 'POST' }),

  getAgentPrompt: (agentId: number) => req<{ content: string }>(`/agents/${agentId}/prompt`),
  setAgentPrompt: (agentId: number, content: string) => req(`/agents/${agentId}/prompt`, jsonInit('PUT', { content })),
  updateAgent: (agentId: number, payload: { name?: string; model?: string }) => req(`/agents/${agentId}`, jsonInit('PATCH', payload)),

  getMasterPrompt: () => req<{ content: string }>('/config/master-prompt'),
  setMasterPrompt: (content: string) => req('/config/master-prompt', jsonInit('PUT', { content })),

  getLayout: () => req<import('./types').UserLayout>('/layout'),
  setLayout: (screen: string, buildingKey: string | null) => req('/layout', jsonInit('PUT', { screen, buildingKey })),

  // ── Fase 10: gestión de órdenes de Hokage, presupuesto y auditoría (endpoints F5/F7/F9) ──
  hokageCommand: (text: string, ventureId?: number | null) =>
    req<import('./types').HokageCommandResult>('/hokage/command', jsonInit('POST', { text, venture_id: ventureId ?? null })),
  hokageCommandDetail: (id: number) => req<import('./types').HokageCommandTrace>(`/hokage/commands/${id}`),
  cancelHokageCommand: (id: number) => req<import('./types').HokageCommandResult>(`/hokage/commands/${id}/cancel`, { method: 'POST' }),
  ventureBudget: (id: number) => req<import('./types').VentureBudget>(`/ventures/${id}/budget`),
  auditEvents: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    return req<import('./types').AuditEvent[]>(`/audit/events?${qs.toString()}`);
  },
};
