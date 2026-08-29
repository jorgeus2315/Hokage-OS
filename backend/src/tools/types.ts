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

// Fase 4 · Slice 2 — LECTURA de pedidos (receipts). Mismo patrón que EtsyListing.
export interface EtsyReceiptInput {
  limit?: number;
}

export interface EtsyReceiptOutput {
  total: number;
  items: Array<{
    id: string;
    total: number;
    currency: string;
    status: string;
    createdAt: string | null;
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
  // Formato esperado (Fase 2): { keyword, volume, trend, relatedQueries[] }
  keyword: string;
  volume: number;
  trend: 'up' | 'stable' | 'down';
  relatedQueries: string[];
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

// Fase 4 · Slice 4.2 — memory.read: leer un valor de tu memoria privada por clave.
// Solo para roles tool-capable (contenido, investigador, trafico, finanzas, ceo, hermes).
export interface MemoryReadInput {
  key: string;
}

export interface MemoryReadOutput {
  key: string;
  value: string | null;
  found: boolean;
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

// Fase 4.3 — Mock receipts para desarrollo/testing. Genera datos deterministas SIN llamar a Etsy.
export interface EtsyMockReceiptInput {
  limit?: number;
}

export interface EtsyMockReceiptOutput {
  total: number;
  items: Array<{
    id: string;
    total: number;
    currency: string;
    status: string;
    createdAt: string | null;
  }>;
}

// Fase 4.3 — Registrar ventas detectadas (INSERT OR IGNORE + emit sale.received si es nueva).
export interface SalesRecordInput {
  receipts: Array<{
    id: string;
    total: number;
    currency: string;
    status: string;
    createdAt: string | null;
  }>;
}

export interface SalesRecordOutput {
  recorded: number;      // cuántas eran NUEVAS (insert exitoso)
  skipped: number;       // cuántas ya existían (duplicate key)
  total: number;         // receipts procesados
}

// Fase 4 · Slice 3 — Etsy write tools (requieren Decision aprobada + scope listings_w/transactions_w)
export interface EtsyCreateListingInput {
  title: string;
  description: string;
  price: number;
  currency: string;
  quantity: number;
  tags?: string[];
  materials?: string[];
  whoMade?: 'i_did' | 'someone_else' | 'collective';
  whenMade?: string;
  taxonomyId?: number;
  shippingProfileId?: number;
  returnPolicyId?: number;
}

export interface EtsyCreateListingOutput {
  listingId: string;
  title: string;
  state: string;
  url: string;
}

export interface EtsyUpdateListingInput {
  listingId: string;
  title?: string;
  description?: string;
  price?: number;
  currency?: string;
  quantity?: number;
  tags?: string[];
  state?: 'active' | 'draft' | 'expired';
}

export interface EtsyUpdateListingOutput {
  listingId: string;
  updated: boolean;
}

export interface EtsyCreateReplyInput {
  reviewId: string;
  message: string;
}

export interface EtsyCreateReplyOutput {
  replyId: string;
  reviewId: string;
}

export interface EtsyReviewsInput {
  limit?: number;
  listingId?: string;
}

export interface EtsyReviewsOutput {
  total: number;
  items: Array<{
    id: string;
    listingId: string;
    rating: number;
    review: string;
    reviewer: string;
    createdAt: string | null;
  }>;
}

export interface EtsyListingAnalyticsInput {
  listingId: string;
}

export interface EtsyListingAnalyticsItem {
  listingId: string;
  views: number;
  visits: number;
  favorites: number;
  orders: number;
  revenue: number;
  currency: string;
  conversionRate: number;
}

export interface EtsyListingAnalyticsOutput {
  total: number;
  items: EtsyListingAnalyticsItem[];
}
