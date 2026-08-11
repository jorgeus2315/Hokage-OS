export interface EtsyListingInput {
  query?: string;
  limit?: number;
}

export interface EtsyListingOutput {
  total: number;
  items: Array<{
    id: string;
    title: string;
    price: number;
    currency: string;
    url?: string;
  }>;
}

export interface ShopifyListingInput {
  query?: string;
  limit?: number;
}

export interface ShopifyListingOutput {
  total: number;
  items: Array<{
    id: string;
    title: string;
    price: number;
    currency: string;
    url?: string;
  }>;
}

export interface PrintifyProductInput {
  query?: string;
  limit?: number;
}

export interface PrintifyProductOutput {
  total: number;
  items: Array<{
    id: string;
    title: string;
    variants: number;
    basePrice: number;
    currency: string;
  }>;
}

export interface GoogleTrendsInput {
  query: string;
  region?: string;
  timeframe?: '7d' | '30d' | '90d';
}

export interface GoogleTrendsOutput {
  query: string;
  region: string;
  timeframe: string;
  interest: Array<{
    date: string;
    value: number;
  }>;
  rising: Array<{
    query: string;
    value: number;
  }>;
}

export interface WebBrowserInput {
  url: string;
  maxChars?: number;
}

export interface WebBrowserOutput {
  url: string;
  title?: string;
  content: string;
  truncated: boolean;
}

export interface SystemExecInput {
  command: string;
  cwd?: string;
  reason?: string;
}

export interface SystemExecOutput {
  status: 'pending_approval';
  execRunId: number;
}

// Fase 1 de la migración marcadores → Tool Calling (HOKAGE_CORE_SPECIFICATION_v1.md §2)
export interface TrendReportInput {
  keyword: string;
  description: string;
}

export interface TrendReportOutput {
  marketId: number;
  keyword: string;
}

// Fase 2 de la migración marcadores → Tool Calling (HOKAGE_CORE_SPECIFICATION_v1.md §2)
export interface ContentCreateInput {
  keyword: string;
  summary: string;
}

export interface ContentCreateOutput {
  contentId: number;
  keyword: string;
}

// Fase 3 de la migración marcadores → Tool Calling (HOKAGE_CORE_SPECIFICATION_v1.md §2).
// Solo disponible para roles tool-capable — operaciones/soporte (Llama 3.1 8B) siguen en
// [MEMORIA: k=v] de forma permanente, no como transición.
export interface MemoryWriteInput {
  key: string;
  value: string;
}

export interface MemoryWriteOutput {
  key: string;
  saved: boolean;
}

// Fase 4 de la migración marcadores → Tool Calling (HOKAGE_CORE_SPECIFICATION_v1.md §2).
// Última fase — mayor superficie y más visible para Jorge (alimenta Alertas directo).
// Mismo alcance de roles que memory.write: solo tool-capable, operaciones/soporte permanecen
// en [DECISION: ...] por diseño.
export interface DecisionCreateInput {
  title: string;
  description: string;
  amount?: number;
  risk_level?: 'low' | 'medium' | 'high';
}

export interface DecisionCreateOutput {
  decisionId: number;
  title: string;
  status: string;
}

// Fase 4 — memoria de NEGOCIO (memory_entries). Distinta de memory.write (memoria privada
// clave-valor del agente). 'decision' y 'result' se excluyen a propósito: solo los escribe
// la captura automática, para que no compitan dos fuentes de verdad sobre el mismo hecho.
export interface MemoryRememberInput {
  category: 'error' | 'attempt' | 'research' | 'learning' | 'context';
  title: string;
  content: string;
}

export interface MemoryRememberOutput {
  memoryId: number;
}
