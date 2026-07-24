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
}

export type Screen = 'boot' | 'menu' | 'map' | 'building' | 'crew' | 'missions' | 'alerts' | 'comms';

export type BuildingSection = 'chat' | 'feed' | 'stats' | 'pipeline' | 'alerts';

export const BUILDINGS: Building[] = [
  { id: 'hokage', name: 'Torre Hokage', desc: 'Centro de mando', role: 'ceo', glyph: 'tower' },
  { id: 'lab', name: 'Laboratorio', desc: 'Investigación de mercado', role: 'investigador', glyph: 'lab' },
  { id: 'estudio', name: 'Estudio', desc: 'Fábrica de contenido', role: 'contenido', glyph: 'studio' },
  { id: 'tienda', name: 'Tienda', desc: 'Sala de ventas', role: 'trafico', glyph: 'shop' },
  { id: 'banco', name: 'Banco', desc: 'Sala financiera', role: 'finanzas', glyph: 'bank' },
  { id: 'taller', name: 'Taller', desc: 'Sala técnica', role: 'operaciones', glyph: 'workshop' },
];

export const ROLES: Record<string, string> = {
  ceo: 'Director General',
  investigador: 'Investigador de Mercado',
  contenido: 'Creador de Contenido',
  trafico: 'Gestor de Tráfico',
  soporte: 'Atención al Cliente',
  finanzas: 'Director Financiero',
  operaciones: 'Director de Operaciones',
};
