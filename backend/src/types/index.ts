export interface Agent {
  id: number;
  name: string;
  role: string;
  status: string;
  model: string | null;
  venture_id: number | null;
  capabilities: string;
  created_at: string;
}

export interface AgentCreatePayload {
  name: string;
  role: string;
  model?: string;
}

export interface Decision {
  id: number;
  agent_id: number | null;
  entity_type: string | null;
  entity_id: number | null;
  title: string;
  description: string | null;
  reasoning: string | null;
  amount: number | null;
  risk_level: string;
  status: string;
  category: 'FINANCIAL' | 'LEGAL' | 'PUBLICATION' | 'STRATEGIC' | 'TECHNICAL' | 'OPERATIONAL';
  venture_id: number | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface DecisionCreatePayload {
  agent_id?: number | null;
  entity_type?: string | null;
  entity_id?: number | null;
  title: string;
  description?: string | null;
  reasoning?: string | null;
  amount?: number | null;
  risk_level?: string;
}

export interface Message {
  id: number;
  sender_id: number | null;
  receiver_id: number | null;
  content: string;
  channel: string;
  created_at: string;
}

export interface MessageCreatePayload {
  sender_id?: number | null;
  receiver_id?: number | null;
  content: string;
  channel?: string;
}

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

export interface ContentCreatePayload {
  agent_id?: number | null;
  business_id?: number | null;
  platform: string;
  body?: string | null;
  media_url?: string | null;
  schedule_at?: string | null;
  status?: string;
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

export interface MarketCreatePayload {
  agent_id?: number | null;
  keyword: string;
  source?: string;
  score?: number | null;
  payload?: string;
}

export interface Department {
  id: number;
  key: string;
  name: string;
  desc: string;
  role: string;
  glyph: string;
  color: string;
  pos_x: number;
  pos_y: number;
  is_hub: number;
  active: number;
  sort_order: number;
  created_at: string;
}

export interface DepartmentUpdatePayload {
  name?: string;
  desc?: string;
  color?: string;
  pos_x?: number;
  pos_y?: number;
  active?: number;
}

export interface AuditLog {
  id: number;
  action: string;
  entity: string;
  entity_id: number | null;
  user_id: number | null;
  details: string;
  created_at: string;
}

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

export interface VentureCreatePayload {
  name: string;
  type?: VentureType;
  status?: VentureStatus;
  goal?: string | null;
  revenue_target_usd?: number;
}

// ═══════════ ASSETS ════════════════════════════════════════════════════════════
export type AssetType = 'content' | 'code' | 'data' | 'audience' | 'brand' | 'ip' | 'credential' | 'tool';
export type AssetStatus = 'draft' | 'active' | 'deprecated';

export interface Asset {
  id: number;
  venture_id: number | null;
  type: AssetType;
  name: string;
  description: string | null;
  value_usd: number | null;
  status: AssetStatus;
  platform: string | null;
  external_id: string | null;
  metadata: string;
  created_at: string;
}

export interface AssetCreatePayload {
  venture_id?: number | null;
  type: AssetType;
  name: string;
  description?: string | null;
  value_usd?: number | null;
  platform?: string | null;
  external_id?: string | null;
}

// ═══════════ PROJECTS ══════════════════════════════════════════════════════════
export type ProjectStatus = 'planned' | 'active' | 'completed' | 'cancelled';

export interface Project {
  id: number;
  venture_id: number | null;
  name: string;
  goal: string | null;
  status: ProjectStatus;
  deadline: string | null;
  budget_usd: number | null;
  created_at: string;
}

export interface ProjectCreatePayload {
  venture_id?: number | null;
  name: string;
  goal?: string | null;
  deadline?: string | null;
  budget_usd?: number | null;
}

// ═══════════ REVENUE_STREAMS ═══════════════════════════════════════════════════
export type RevenueType = 'one_time' | 'subscription' | 'ads' | 'commission' | 'licensing' | 'consulting' | 'tips';

export interface RevenueStream {
  id: number;
  venture_id: number | null;
  asset_id: number | null;
  type: RevenueType;
  platform: string;
  status: string;
  mrr_usd: number;
  total_earned_usd: number;
  last_synced_at: string | null;
  created_at: string;
}

// ═══════════ AUTOMATIONS — pipeline como datos ══════════════════════════════════
export type DecisionCategory = 'FINANCIAL' | 'LEGAL' | 'PUBLICATION' | 'STRATEGIC' | 'TECHNICAL' | 'OPERATIONAL';

export interface Automation {
  id: number;
  venture_id: number | null;
  name: string;
  trigger_event: string;
  trigger_conditions: string;
  action_type: string;
  action_agent_role: string | null;
  action_priority: number;
  action_context_template: string | null;
  requires_approval: number;
  active: number;
  created_at: string;
}

export interface AutomationCreatePayload {
  venture_id?: number | null;
  name: string;
  trigger_event: string;
  action_agent_role: string;
  action_priority?: number;
  action_context_template?: string | null;
  requires_approval?: boolean;
}
