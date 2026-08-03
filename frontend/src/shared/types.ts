export interface Agent {
  id: number;
  name: string;
  role: string;
  status: string;
  model: string | null;
  created_at: string;
}

export interface Business {
  id: number;
  name: string;
  channel: string;
  category: string | null;
  status: string;
  target_revenue: number;
  current_revenue: number;
}

export interface Decision {
  id: number;
  agent_id: number | null;
  title: string;
  description: string | null;
  reasoning: string | null;
  amount: number | null;
  risk_level: string;
  status: string;
  created_at: string;
}

export interface Achievement {
  id: number;
  code: string;
  title: string;
  description: string;
  icon: string | null;
  xp_reward: number;
  unlocked_at: string | null;
}

export interface AgentRun {
  id: number;
  agent_id: number;
  action: string;
  status: string;
  started_at: string;
}

export interface WsEvent {
  type: string;
  from?: string;
  to?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

// Sobre crudo que envía el WebSocket del backend: { type, data, timestamp }.
export interface WsEnvelope {
  type: string;
  data?: unknown;
  timestamp?: string;
}

export interface ChatMsg {
  role: 'user' | 'agent';
  text: string;
  time: string;
  agentName?: string;
}

export interface CommMsg {
  id: number;
  sender_id: number | null;
  receiver_id: number | null;
  content: string;
  channel: string;
  created_at: string;
}

export interface Building {
  id: string;
  name: string;
  desc: string;
  role: string;
  glyph: string;
  color: string;
  // Fase 3: campos opcionales cuando viene de la BD
  db_id?: number;
  pos_x?: number;
  pos_y?: number;
  is_hub?: boolean;
}

export interface WorkItem {
  id: number;
  agent_id: number;
  type: 'autonomous_run' | 'event_triggered' | 'decision_execution';
  priority: number;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  context: string | null;
  result: string | null;
  locked_at: string | null;
  retry_count: number;
  created_at: string;
  resolved_at: string | null;
}

export type Screen = 'boot' | 'menu' | 'map' | 'building' | 'crew' | 'missions' | 'alerts' | 'comms';

export type BuildingSection = 'chat' | 'feed' | 'stats' | 'pipeline' | 'alerts';

// Un color por departamento — se usa tanto en CSS (DOM) como en el renderer
// PixiJS del mapa (WorldCanvas.tsx replica esta paleta en hex numérico).
// ═══════════ VENTURES ══════════════════════════════════════════════════════════
export type VentureStatus = 'idea' | 'active' | 'scaling' | 'paused' | 'closed';
export type VentureType = 'store' | 'saas' | 'content' | 'fund' | 'agency' | 'community' | 'other';

export interface Venture {
  id: number;
  name: string;
  type: VentureType;
  status: VentureStatus;
  goal: string | null;
  budget_allocated_usd: number;
  budget_spent_usd: number;
  revenue_target_usd: number;
  metadata: string;
  created_at: string;
}

// ═══════════ AUTOMATIONS ════════════════════════════════════════════════════════
export interface Automation {
  id: number;
  venture_id: number | null;
  name: string;
  trigger_event: string;
  action_agent_role: string | null;
  action_priority: number;
  action_context_template: string | null;
  requires_approval: number;
  active: number;
  created_at: string;
}

export const ROLES: Record<string, string> = {
  ceo: 'Director General',
  investigador: 'Investigador de Mercado',
  contenido: 'Creador de Contenido',
  trafico: 'Gestor de Tráfico',
  soporte: 'Atención al Cliente',
  finanzas: 'Director Financiero',
  operaciones: 'Director de Operaciones',
};
