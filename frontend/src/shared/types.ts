export interface Agent {
  id: number;
  name: string;
  role: string;
  status: string;
  model: string | null;
  created_at: string;
}

export type DecisionCategory = 'FINANCIAL' | 'LEGAL' | 'PUBLICATION' | 'STRATEGIC' | 'TECHNICAL' | 'OPERATIONAL';

export interface Decision {
  id: number;
  agent_id: number | null;
  title: string;
  description: string | null;
  reasoning: string | null;
  amount: number | null;
  risk_level: string;
  status: string;
  category: DecisionCategory;
  venture_id: number | null;
  created_at: string;
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
  _cid?: string; // ID único cliente, asignado al recibir el evento
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
  // Fase 8 del Plan de Migración ECS: el backend ya enviaba este campo
  // (columna `position_locked` en `departments`) — el frontend lo
  // ignoraba en silencio hasta conectarlo a WorldLayoutEngine.
  position_locked?: boolean;
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

export type Screen = 'boot' | 'menu' | 'map' | 'building' | 'crew' | 'alerts' | 'comms' | 'ventures' | 'objetivos' | 'config';

// ═══════════ GOAL SYSTEM ════════════════════════════════════════════════════
export type ObjectiveStatus = 'planning' | 'active' | 'pending_review' | 'achieved' | 'paused' | 'abandoned';
export type MilestoneStatus = 'pending' | 'in_progress' | 'done' | 'blocked' | 'skipped';
export type PlanStatus = 'proposed' | 'approved' | 'active' | 'completed';

export interface ObjMilestone {
  id: number;
  plan_id: number;
  objective_id: number;
  phase_index: number;
  title: string;
  description: string | null;
  assigned_agent_role: string | null;
  status: MilestoneStatus;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ObjPlan {
  id: number;
  objective_id: number;
  phases: string; // JSON
  estimated_weeks: number | null;
  confidence: number;
  status: PlanStatus;
  created_at: string;
  milestones?: ObjMilestone[];
}

export interface Objective {
  id: number;
  title: string;
  goal: string | null;
  success_criteria: string | null;
  deadline: string | null;
  priority: number;
  status: ObjectiveStatus;
  venture_id: number | null;
  created_at: string;
  plan?: ObjPlan;
}

export type BuildingSection = 'chat' | 'feed' | 'stats' | 'pipeline' | 'outputs' | 'terminal' | 'alerts' | 'config';

export interface MetricsSummary {
  ai_cost_today_usd: number;
  messages_today: number;
  pending_decisions: number;
  urgent_decisions: number;
}

// ═══════════ HERMES ══════════════════════════════════════════════════════════
export interface ExecRun {
  id: number;
  decision_id: number | null;
  requested_by_agent_id: number | null;
  command: string;
  cwd: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'done' | 'failed';
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
  created_at: string;
  executed_at: string | null;
}

// ═══════════ OUTPUTS REALES ══════════════════════════════════════════════════
export interface ContentItem {
  id: number;
  agent_id: number | null;
  business_id: number | null;
  platform: string;
  body: string | null;
  media_url: string | null;
  schedule_at: string | null;
  status: string;
  created_at: string;
}

export interface MarketItem {
  id: number;
  agent_id: number | null;
  keyword: string;
  source: string;
  score: number | null;
  payload: string;
  created_at: string;
}

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
  hermes: 'Agente de Sistema',
};

// Eventos que puede emitir el bus — fuente: backend/src/config/eventBus.ts (AgentEventType)
export const AUTOMATION_EVENTS: string[] = [
  'trend.detected', 'content.created', 'content.ready',
  'decision.created', 'decision.approved', 'decision.rejected',
  'sale.made', 'alert.triggered',
  'agent.task.start', 'agent.task.done', 'agent.task.error',
  'report.daily', 'system.error',
  'objective.created', 'objective.approved', 'objective.achieved',
];
