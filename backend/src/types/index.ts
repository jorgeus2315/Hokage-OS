export interface Agent {
  id: number;
  name: string;
  role: string;
  status: string;
  created_at: string;
}

export interface AgentCreatePayload {
  name: string;
  role: string;
}

export interface Business {
  id: number;
  name: string;
  channel: string;
  category: string | null;
  status: string;
  target_revenue: number;
  current_revenue: number;
  created_at: string;
}

export interface BusinessCreatePayload {
  name: string;
  channel?: string;
  category?: string | null;
  target_revenue?: number | null;
}

export interface Product {
  id: number;
  business_id: number;
  title: string;
  price: number;
  stock: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProductCreatePayload {
  business_id: number;
  title: string;
  price: number;
  stock?: number;
  status?: string;
}

export interface Decision {
  id: number;
  agent_id: number | null;
  entity_type: string | null;
  entity_id: number | null;
  title: string;
  amount: number | null;
  risk_level: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface DecisionCreatePayload {
  agent_id?: number | null;
  entity_type?: string | null;
  entity_id?: number | null;
  title: string;
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
  keyword: string;
  source: string;
  score: number | null;
  payload: string;
  created_at: string;
}

export interface MarketCreatePayload {
  keyword: string;
  source?: string;
  score?: number | null;
  payload?: string;
}

export interface FinanceItem {
  id: number;
  business_id: number | null;
  direction: string;
  amount: number;
  currency: string;
  source: string | null;
  created_at: string;
}

export interface FinanceCreatePayload {
  business_id?: number | null;
  direction?: string;
  amount: number;
  currency?: string;
  source?: string | null;
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
