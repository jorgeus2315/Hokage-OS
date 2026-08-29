import type { Tool, ToolContext, ToolResult, ToolStatus, ToolPermission } from './base.js';
import type { EtsyListingInput, EtsyListingOutput, EtsyReceiptInput, EtsyReceiptOutput, EtsyMockReceiptInput, EtsyMockReceiptOutput, SalesRecordInput, SalesRecordOutput, ShopifyListingInput, ShopifyListingOutput, PrintifyProductInput, PrintifyProductOutput, GoogleTrendsInput, GoogleTrendsOutput, WebBrowserInput, WebBrowserOutput, SystemExecInput, SystemExecOutput, TrendReportInput, TrendReportOutput, ContentCreateInput, ContentCreateOutput, MemoryWriteInput, MemoryWriteOutput, MemoryReadInput, MemoryReadOutput, DecisionCreateInput, DecisionCreateOutput, MemoryRememberInput, MemoryRememberOutput, EtsyCreateListingInput, EtsyCreateListingOutput, EtsyUpdateListingInput, EtsyUpdateListingOutput, EtsyCreateReplyInput, EtsyCreateReplyOutput, EtsyReviewsInput, EtsyReviewsOutput, EtsyListingAnalyticsInput, EtsyListingAnalyticsOutput } from './types.js';
import { requestExec } from '../services/hermesService.js';
import { createMarket } from '../services/marketService.js';
import { createContent } from '../services/contentService.js';
import { writeAgentMemory, readAgentMemory } from '../services/agentMemoryService.js';
import { createDecision } from '../services/decisionService.js';
import { maybeAutoApprove } from '../services/agentAutonomy.js';
import { createMemoryEntry } from '../services/memoryService.js';
import { get, run } from '../db/init.js';
import bus from '../config/eventBus.js';
import { safeFetch } from './ssrfGuard.js';
import { getListings as etsyGetListings, getReceipts as etsyGetReceipts, getReviews as etsyGetReviews, getListingAnalytics as etsyGetListingAnalytics, createListing as etsyCreateListing, updateListing as etsyUpdateListing, createReply as etsyCreateReply, EtsyNotConnectedError } from '../services/etsyClient.js';

const MEMORY_KEY_PATTERN = /^[a-z_][a-z0-9_]*$/;

function permission(
  scope: ToolPermission['scope'],
  overrides: Partial<ToolPermission> = {}
): ToolPermission {
  return { scope, ...overrides };
}

function result<T>(
  ok: boolean,
  opts: Omit<ToolResult<T>, 'ok'>
): ToolResult<T> {
  return { ok, ...opts };
}

function stubInputSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required };
}

function stubOutputSchema(properties: Record<string, unknown>) {
  return { type: 'object', properties };
}

// Fase 4 · Slice 1 — LECTURA de listings del shop propio (etsy.listings). La escritura
// (createListing) queda fuera de este slice. Requiere que la venture esté conectada por OAuth
// (ver /api/integrations/etsy/*). Sin conexión → error limpio, nunca secretos (F3).
export const EtsyTool: Tool<EtsyListingInput, EtsyListingOutput> = {
  id: 'etsy.listings',
  name: 'Etsy Listings',
  description: 'Lee los listings activos de la tienda Etsy conectada (solo lectura).',
  category: 'marketplace',
  status: 'ready',
  permissions: permission('business', { requiresAdmin: true }),
  requiredApproval: false,   // lectura: sin efecto externo, no requiere aprobación
  inputSchema: stubInputSchema(
    { limit: { type: 'integer', description: 'Límite de resultados (1-100)', minimum: 1, maximum: 100 } },
    []
  ),
  outputSchema: stubOutputSchema({
    total: { type: 'integer' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          price: { type: 'number' },
          currency: { type: 'string' },
          url: { type: 'string' },
        },
      },
    },
  }),
  async estimateCost(_input) {
    return 0;   // lectura de API externa: sin coste de IA
  },
  async execute(input, ctx) {
    if (ctx.ventureId == null) {
      return result<EtsyListingOutput>(false, { data: { total: 0, items: [] }, error: 'Falta ventureId para consultar Etsy' });
    }
    try {
      const { total, items } = await etsyGetListings(ctx.ventureId, { limit: input?.limit });
      return result<EtsyListingOutput>(true, { data: { total, items } });
    } catch (err: any) {
      const msg = err instanceof EtsyNotConnectedError ? err.message : (err?.message || 'Error consultando Etsy');
      return result<EtsyListingOutput>(false, { data: { total: 0, items: [] }, error: msg });
    }
  },
};

// Fase 4 · Slice 2 — LECTURA de pedidos (receipts) del shop propio (etsy.receipts). Mismo
// patrón/contrato read-only que etsy.listings: envuelve getReceipts() de etsyClient, sin
// escritura. Requiere venture conectada por OAuth; sin conexión → error limpio (F3).
export const EtsyReceiptsTool: Tool<EtsyReceiptInput, EtsyReceiptOutput> = {
  id: 'etsy.receipts',
  name: 'Etsy Receipts',
  description: 'Lee los pedidos (receipts) de la tienda Etsy conectada (solo lectura).',
  category: 'marketplace',
  status: 'ready',
  permissions: permission('business', { requiresAdmin: true }),
  requiredApproval: false,   // lectura: sin efecto externo, no requiere aprobación
  inputSchema: stubInputSchema(
    { limit: { type: 'integer', description: 'Límite de resultados (1-100)', minimum: 1, maximum: 100 } },
    []
  ),
  outputSchema: stubOutputSchema({
    total: { type: 'integer' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          total: { type: 'number' },
          currency: { type: 'string' },
          status: { type: 'string' },
          createdAt: { type: 'string' },
        },
      },
    },
  }),
  async estimateCost(_input) {
    return 0;   // lectura de API externa: sin coste de IA
  },
  async execute(input, ctx) {
    if (ctx.ventureId == null) {
      return result<EtsyReceiptOutput>(false, { data: { total: 0, items: [] }, error: 'Falta ventureId para consultar Etsy' });
    }
    try {
      const { total, items } = await etsyGetReceipts(ctx.ventureId, { limit: input?.limit });
      return result<EtsyReceiptOutput>(true, { data: { total, items } });
    } catch (err: any) {
      const msg = err instanceof EtsyNotConnectedError ? err.message : (err?.message || 'Error consultando Etsy');
      return result<EtsyReceiptOutput>(false, { data: { total: 0, items: [] }, error: msg });
    }
  },
};

// Fase 4.3 — Mock Receipts para desarrollo/testing. Genera datos deterministas
// SIN llamar a la API real de Etsy. Solo para rol 'finanzas' (lectura de ventas).
// Usa seed determinista basado en ventureId para reproducibilidad entre ticks.
export const EtsyMockReceiptsTool: Tool<EtsyMockReceiptInput, EtsyMockReceiptOutput> = {
  id: 'etsy.mock_receipts',
  name: 'Etsy Mock Receipts',
  description: 'Genera receipts de prueba deterministas para desarrollo (NO llama a Etsy real). Solo para rol finanzas.',
  category: 'marketplace',
  status: 'ready',
  permissions: permission('agent'),
  requiredApproval: false,
  inputSchema: stubInputSchema(
    { limit: { type: 'integer', description: 'Límite de resultados (1-25)', minimum: 1, maximum: 25 } },
    []
  ),
  outputSchema: stubOutputSchema({
    total: { type: 'integer' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          total: { type: 'number' },
          currency: { type: 'string' },
          status: { type: 'string' },
          createdAt: { type: 'string' },
        },
      },
    },
  }),
  async estimateCost(_input) { return 0; },
  async execute(input, ctx) {
    if (ctx.ventureId == null) {
      return result<EtsyMockReceiptOutput>(false, { data: { total: 0, items: [] }, error: 'Falta ventureId para mock receipts' });
    }
    // Seed determinista por ventureId — misma secuencia en cada llamada
    const seed = ctx.ventureId * 1000 + 42;
    const limit = Math.min(Math.max(input?.limit ?? 10, 1), 25);
    const items = [];
    for (let i = 0; i < limit; i++) {
      // Deterministic pseudo-random basado en seed + índice
      const r = (seed + i * 17) % 100;
      const total = 10 + (r % 40); // 10-50 USD/EUR
      const currency = (r % 2 === 0) ? 'USD' : 'EUR';
      const status = r % 5 === 0 ? 'pending' : 'paid';
      const daysAgo = r % 30;
      const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
      items.push({
        id: `mock_${ctx.ventureId}_${i + 1}_${seed}`,
        total,
        currency,
        status,
        createdAt,
      });
    }
    return result<EtsyMockReceiptOutput>(true, { data: { total: items.length, items } });
  },
};

// Fase 4.3 — Sales Record: INSERT OR IGNORE en tabla sales + emit sale.received si nueva.
export const SalesRecordTool: Tool<SalesRecordInput, SalesRecordOutput> = {
  id: 'sales.record',
  name: 'Sales Record',
  description: 'Registra receipts de ventas en BD (INSERT OR IGNORE). Emite sale.received solo para ventas nuevas. Solo para rol finanzas.',
  category: 'pipeline',
  status: 'ready',
  permissions: permission('agent'),
  requiredApproval: false,
  inputSchema: stubInputSchema({
    receipts: {
      type: 'array',
      description: 'Array de receipts a procesar',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          total: { type: 'number' },
          currency: { type: 'string' },
          status: { type: 'string' },
          createdAt: { type: 'string' },
        },
        required: ['id', 'total', 'currency', 'status', 'createdAt'],
      },
    },
  }, ['receipts']),
  outputSchema: stubOutputSchema({
    recorded: { type: 'integer' },
    skipped: { type: 'integer' },
    total: { type: 'integer' },
  }),
  async estimateCost(_input) { return 0; },
  async execute(input, ctx) {
    if (ctx.ventureId == null) {
      return result<SalesRecordOutput>(false, { error: 'Falta ventureId para registrar ventas' });
    }
    if (!input.receipts || !Array.isArray(input.receipts) || input.receipts.length === 0) {
      return result<SalesRecordOutput>(true, { data: { recorded: 0, skipped: 0, total: 0 } });
    }

    let recorded = 0;
    let skipped = 0;

    for (const r of input.receipts) {
      const res = await run(
        `INSERT OR IGNORE INTO sales (venture_id, receipt_id, total_usd, currency, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [ctx.ventureId, r.id, r.total, r.currency, r.status, r.createdAt]
      );
      if (res.changes === 1) {
        recorded++;
        bus.publish({
          type: 'sale.received',
          from: 'finanzas',
          payload: {
            ventureId: ctx.ventureId,
            receiptId: r.id,
            total: r.total,
            currency: r.currency,
            status: r.status,
            createdAt: r.createdAt,
            detectedAt: new Date().toISOString(),
          },
        });
      } else {
        skipped++;
      }
    }

    return result<SalesRecordOutput>(true, { data: { recorded, skipped, total: input.receipts.length } });
  },
};

// Fase 4 · Slice 3 — Etsy: reviews (lectura)
export const EtsyReviewsTool: Tool<EtsyReviewsInput, EtsyReviewsOutput> = {
  id: 'etsy.reviews',
  name: 'Etsy Reviews',
  description: 'Obtiene reviews de la tienda Etsy conectada. Opcionalmente filtrar por listingId.',
  category: 'marketplace',
  status: 'ready',
  permissions: permission('business', { requiresAdmin: true }),
  requiredApproval: false,
  inputSchema: stubInputSchema(
    { limit: { type: 'integer', description: 'Límite de resultados (1-100)', minimum: 1, maximum: 100 }, listingId: { type: 'string', description: 'Filtrar por listing ID' } },
    []
  ),
  outputSchema: stubOutputSchema({
    total: { type: 'integer' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          listingId: { type: 'string' },
          rating: { type: 'number' },
          review: { type: 'string' },
          reviewer: { type: 'string' },
          createdAt: { type: 'string' },
        },
      },
    },
  }),
  async estimateCost(_input) {
    return 0.001;
  },
  async execute(input, ctx) {
    if (ctx.ventureId == null) {
      return result<EtsyReviewsOutput>(false, { data: { total: 0, items: [] }, error: 'Falta ventureId para consultar Etsy' });
    }
    try {
      const { total, items } = await etsyGetReviews(ctx.ventureId, {
        limit: input.limit,
        listingId: input.listingId,
      });
      return result<EtsyReviewsOutput>(true, { data: { total, items } });
    } catch (err: any) {
      const msg = err instanceof EtsyNotConnectedError ? err.message : (err?.message || 'Error consultando Etsy');
      return result<EtsyReviewsOutput>(false, { data: { total: 0, items: [] }, error: msg });
    }
  },
};

// Fase 4 · Slice 3 — Etsy: analytics de listing (lectura)
export const EtsyListingAnalyticsTool: Tool<EtsyListingAnalyticsInput, EtsyListingAnalyticsOutput> = {
  id: 'etsy.listing_analytics',
  name: 'Etsy Listing Analytics',
  description: 'Obtiene métricas de un listing específico (views, visits, favorites, orders, revenue, conversion rate).',
  category: 'marketplace',
  status: 'ready',
  permissions: permission('business', { requiresAdmin: true }),
  requiredApproval: false,
  inputSchema: stubInputSchema(
    { listingId: { type: 'string', description: 'ID del listing a analizar' } },
    ['listingId']
  ),
  outputSchema: stubOutputSchema({
    total: { type: 'integer' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          listingId: { type: 'string' },
          views: { type: 'number' },
          visits: { type: 'number' },
          favorites: { type: 'number' },
          orders: { type: 'number' },
          revenue: { type: 'number' },
          currency: { type: 'string' },
          conversionRate: { type: 'number' },
        },
      },
    },
  }),
  async estimateCost(_input) {
    return 0.001;
  },
  async execute(input, ctx) {
    if (ctx.ventureId == null) {
      return result<EtsyListingAnalyticsOutput>(false, { data: { total: 0, items: [] }, error: 'Falta ventureId para consultar Etsy' });
    }
    try {
      const analytics = await etsyGetListingAnalytics(ctx.ventureId, input.listingId);
      if (!analytics) {
        return result<EtsyListingAnalyticsOutput>(false, { data: { total: 0, items: [] }, error: 'Listing no encontrado o sin analytics' });
      }
      return result<EtsyListingAnalyticsOutput>(true, { data: { total: 1, items: [analytics] } });
    } catch (err: any) {
      const msg = err instanceof EtsyNotConnectedError ? err.message : (err?.message || 'Error consultando Etsy');
      return result<EtsyListingAnalyticsOutput>(false, { data: { total: 0, items: [] }, error: msg });
    }
  },
};

// Fase 4 · Slice 3 — Etsy: crear listing (escritura, requiere Decision aprobada)
export const EtsyCreateListingTool: Tool<EtsyCreateListingInput, EtsyCreateListingOutput> = {
  id: 'etsy.create_listing',
  name: 'Etsy Create Listing',
  description: 'Crea un nuevo listing en Etsy. Requiere Decision aprobada con categoría FINANCIAL y scope listings_w.',
  category: 'marketplace',
  status: 'ready',
  permissions: permission('business', { requiresAdmin: true }),
  requiredApproval: true,
  inputSchema: stubInputSchema(
    {
      title: { type: 'string', description: 'Título del listing' },
      description: { type: 'string', description: 'Descripción del listing' },
      price: { type: 'number', description: 'Precio' },
      currency: { type: 'string', description: 'Moneda (USD, EUR, etc.)' },
      quantity: { type: 'integer', description: 'Cantidad disponible', minimum: 1 },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags (máx 13)' },
      materials: { type: 'array', items: { type: 'string' }, description: 'Materiales' },
      whoMade: { type: 'string', enum: ['i_did', 'someone_else', 'collective'], description: 'Quién lo hizo' },
      whenMade: { type: 'string', description: 'Cuándo se hizo (ej: 2024, 2020_2024, made_to_order)' },
      taxonomyId: { type: 'integer', description: 'ID de taxonomía de Etsy' },
      shippingProfileId: { type: 'integer', description: 'ID de perfil de envío' },
      returnPolicyId: { type: 'integer', description: 'ID de política de devoluciones' },
    },
    ['title', 'description', 'price', 'currency', 'quantity']
  ),
  outputSchema: stubOutputSchema({
    listingId: { type: 'string' },
    title: { type: 'string' },
    state: { type: 'string' },
    url: { type: 'string' },
  }),
  async estimateCost(_input) {
    return 0.01;
  },
  async execute(input, ctx) {
    if (ctx.ventureId == null) {
      return result<EtsyCreateListingOutput>(false, { data: { listingId: '', title: '', state: '', url: '' }, error: 'Falta ventureId para crear listing en Etsy' });
    }
    try {
      const created = await etsyCreateListing(ctx.ventureId, input);
      return result<EtsyCreateListingOutput>(true, { data: { listingId: created.listingId, title: created.title, state: created.state, url: created.url } });
    } catch (err: any) {
      const msg = err instanceof EtsyNotConnectedError ? err.message : (err?.message || 'Error creando listing en Etsy');
      return result<EtsyCreateListingOutput>(false, { data: { listingId: '', title: '', state: '', url: '' }, error: msg });
    }
  },
};

// Fase 4 · Slice 3 — Etsy: actualizar listing (escritura, requiere Decision aprobada)
export const EtsyUpdateListingTool: Tool<EtsyUpdateListingInput, EtsyUpdateListingOutput> = {
  id: 'etsy.update_listing',
  name: 'Etsy Update Listing',
  description: 'Actualiza un listing existente en Etsy. Requiere Decision aprobada con categoría FINANCIAL y scope listings_w.',
  category: 'marketplace',
  status: 'ready',
  permissions: permission('business', { requiresAdmin: true }),
  requiredApproval: true,
  inputSchema: stubInputSchema(
    {
      listingId: { type: 'string', description: 'ID del listing a actualizar' },
      title: { type: 'string', description: 'Título del listing' },
      description: { type: 'string', description: 'Descripción del listing' },
      price: { type: 'number', description: 'Precio' },
      currency: { type: 'string', description: 'Moneda (USD, EUR, etc.)' },
      quantity: { type: 'integer', description: 'Cantidad disponible', minimum: 1 },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags (máx 13)' },
      state: { type: 'string', enum: ['active', 'draft', 'expired'], description: 'Estado del listing' },
    },
    ['listingId']
  ),
  outputSchema: stubOutputSchema({
    listingId: { type: 'string' },
    updated: { type: 'boolean' },
  }),
  async estimateCost(_input) {
    return 0.01;
  },
  async execute(input, ctx) {
    if (ctx.ventureId == null) {
      return result<EtsyUpdateListingOutput>(false, { data: { listingId: '', updated: false }, error: 'Falta ventureId para actualizar listing en Etsy' });
    }
    try {
      const updated = await etsyUpdateListing(ctx.ventureId, input);
      return result<EtsyUpdateListingOutput>(true, { data: { listingId: updated.listingId, updated: updated.updated } });
    } catch (err: any) {
      const msg = err instanceof EtsyNotConnectedError ? err.message : (err?.message || 'Error actualizando listing en Etsy');
      return result<EtsyUpdateListingOutput>(false, { data: { listingId: '', updated: false }, error: msg });
    }
  },
};

// Fase 4 · Slice 3 — Etsy: responder review (escritura, requiere Decision aprobada)
export const EtsyCreateReplyTool: Tool<EtsyCreateReplyInput, EtsyCreateReplyOutput> = {
  id: 'etsy.create_reply',
  name: 'Etsy Create Reply',
  description: 'Responde a una review en Etsy. Requiere Decision aprobada con categoría FINANCIAL y scope transactions_w.',
  category: 'marketplace',
  status: 'ready',
  permissions: permission('business', { requiresAdmin: true }),
  requiredApproval: true,
  inputSchema: stubInputSchema(
    {
      reviewId: { type: 'string', description: 'ID de la review a responder' },
      message: { type: 'string', description: 'Mensaje de respuesta' },
    },
    ['reviewId', 'message']
  ),
  outputSchema: stubOutputSchema({
    replyId: { type: 'string' },
    reviewId: { type: 'string' },
  }),
  async estimateCost(_input) {
    return 0.005;
  },
  async execute(input, ctx) {
    if (ctx.ventureId == null) {
      return result<EtsyCreateReplyOutput>(false, { data: { replyId: '', reviewId: '' }, error: 'Falta ventureId para responder review en Etsy' });
    }
    try {
      const reply = await etsyCreateReply(ctx.ventureId, input);
      return result<EtsyCreateReplyOutput>(true, { data: { replyId: reply.replyId, reviewId: reply.reviewId } });
    } catch (err: any) {
      const msg = err instanceof EtsyNotConnectedError ? err.message : (err?.message || 'Error respondiendo review en Etsy');
      return result<EtsyCreateReplyOutput>(false, { data: { replyId: '', reviewId: '' }, error: msg });
    }
  },
};

export const ShopifyTool: Tool<ShopifyListingInput, ShopifyListingOutput> = {
  id: 'shopify.listings',
  name: 'Shopify Listings',
  description: 'Consulta listings y productos de Shopify.',
  category: 'marketplace',
  status: 'stub',
  permissions: permission('business', { requiresAdmin: true }),
  requiredApproval: true,
  inputSchema: stubInputSchema(
    {
      query: { type: 'string', description: 'Término de búsqueda' },
      limit: { type: 'integer', description: 'Límite de resultados', minimum: 1, maximum: 100 },
    },
    []
  ),
  outputSchema: stubOutputSchema({
    total: { type: 'integer' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          price: { type: 'number' },
          currency: { type: 'string' },
          url: { type: 'string' },
        },
      },
    },
  }),
  async estimateCost(_input) {
    return 0.01;
  },
  async execute(_input, _ctx) {
    return result<ShopifyListingOutput>(false, {
      data: { total: 0, items: [] },
      error: 'ShopifyTool no implementado: requiere MCP o API key.',
    });
  },
};

export const PrintifyTool: Tool<PrintifyProductInput, PrintifyProductOutput> = {
  id: 'printify.products',
  name: 'Printify Products',
  description: 'Gestión de productos print-on-demand.',
  category: 'fulfillment',
  status: 'stub',
  permissions: permission('business', { requiresAdmin: true }),
  requiredApproval: true,
  inputSchema: stubInputSchema(
    {
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    []
  ),
  outputSchema: stubOutputSchema({
    total: { type: 'integer' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          variants: { type: 'integer' },
          basePrice: { type: 'number' },
          currency: { type: 'string' },
        },
      },
    },
  }),
  async estimateCost(_input) {
    return 0.01;
  },
  async execute(_input, _ctx) {
    return result<PrintifyProductOutput>(false, {
      data: { total: 0, items: [] },
      error: 'PrintifyTool no implementado: requiere MCP o API key.',
    });
  },
};

const TRENDS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function stripTrendsPrefix(text: string): string {
  // Google Trends prefixes JSON responses with ")]}',\n" to prevent XSSI
  return text.replace(/^\)\]\}',?\n/, '');
}

const TRENDS_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function computeTrend(interest: Array<{ date: string; value: number }>): 'up' | 'stable' | 'down' {
  if (interest.length < 2) return 'stable';
  const recent = interest.slice(-4);
  const older = interest.slice(0, 4);
  const recentAvg = recent.reduce((s, d) => s + d.value, 0) / recent.length;
  const olderAvg = older.reduce((s, d) => s + d.value, 0) / (older.length || 1);
  if (recentAvg > olderAvg * 1.15) return 'up';
  if (recentAvg < olderAvg * 0.85) return 'down';
  return 'stable';
}

export const GoogleTrendsTool: Tool<GoogleTrendsInput, GoogleTrendsOutput> = {
  id: 'google.trends',
  name: 'Google Trends',
  description: 'Consulta el interés de búsqueda de una keyword y queries relacionadas en alza. Devuelve: keyword, volume (0-100), trend (up/stable/down), relatedQueries[].',
  category: 'research',
  status: 'ready',
  permissions: permission('global'),
  requiredApproval: false,
  inputSchema: stubInputSchema(
    {
      query:     { type: 'string',  description: 'Keyword a analizar (ej: "minimal wall art")' },
      region:    { type: 'string',  description: 'Código de región ISO 3166-1 alpha-2 (ej: US, ES)' },
      timeframe: { type: 'string',  description: 'Ventana temporal: 7d, 30d o 90d', enum: ['7d', '30d', '90d'] },
    },
    ['query']
  ),
  outputSchema: stubOutputSchema({
    keyword:       { type: 'string' },
    volume:        { type: 'integer', minimum: 0, maximum: 100 },
    trend:         { type: 'string', enum: ['up', 'stable', 'down'] },
    relatedQueries: { type: 'array', items: { type: 'string' } },
  }),
  async estimateCost(_input) { return 0; },
  async execute(input, _ctx) {
    const geo     = input.region    || 'US';
    const timeMap = { '7d': 'now 7-d', '30d': 'today 1-m', '90d': 'today 3-m' } as const;
    const time    = timeMap[input.timeframe || '30d'] ?? 'today 1-m';
    const hl      = 'en-US';
    const headers = { 'User-Agent': TRENDS_UA, Accept: 'application/json, text/plain, */*' };

    // Paso 1: obtener tokens de widgets desde /explore
    const exploreReq = JSON.stringify({
      comparisonItem: [{ keyword: input.query, geo, time }],
      category: 0,
      property: '',
    });
    const exploreUrl = `https://trends.google.com/trends/api/explore?hl=${hl}&tz=0&req=${encodeURIComponent(exploreReq)}`;

    let exploreRes: Response;
    try {
      exploreRes = await fetchWithTimeout(exploreUrl, { headers }, TRENDS_TIMEOUT_MS);
    } catch (err: any) {
      return result<GoogleTrendsOutput>(false, { error: `GoogleTrends timeout/red: ${err.message}` });
    }
    if (!exploreRes.ok) {
      return result<GoogleTrendsOutput>(false, { error: `Google Trends explore ${exploreRes.status}` });
    }

    let widgets: any[];
    try {
      widgets = JSON.parse(stripTrendsPrefix(await exploreRes.text())).widgets || [];
    } catch {
      return result<GoogleTrendsOutput>(false, { error: 'GoogleTrends: respuesta explore inválida' });
    }

    const timeseriesWidget = widgets.find((w: any) => w.id === 'TIMESERIES');
    const relatedWidget    = widgets.find((w: any) => w.id === 'RELATED_QUERIES');

    // Paso 2: interés a lo largo del tiempo
    let interest: Array<{ date: string; value: number }> = [];
    if (timeseriesWidget?.token) {
      const tsReq = JSON.stringify({
        time,
        resolution: 'WEEK',
        locale: hl,
        comparisonItem: [{ geo, complexKeywordsRestriction: { keyword: [{ type: 'BROAD', value: input.query }] } }],
        requestOptions: { property: '', backend: 'IZG', category: 0 },
      });
      const tsUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=${hl}&tz=0&req=${encodeURIComponent(tsReq)}&token=${encodeURIComponent(timeseriesWidget.token)}&geo=${geo}`;

      let tsRes: Response;
      try {
        tsRes = await fetchWithTimeout(tsUrl, { headers }, TRENDS_TIMEOUT_MS);
      } catch (err: any) {
        return result<GoogleTrendsOutput>(false, { error: `GoogleTrends timeout series: ${err.message}` });
      }
      if (tsRes.ok) {
        try {
          const tsJson = JSON.parse(stripTrendsPrefix(await tsRes.text()));
          interest = (tsJson.default?.timelineData || []).map((d: any) => ({
            date:  d.formattedAxisTime || d.formattedTime || '',
            value: d.value?.[0] ?? 0,
          }));
        } catch {
          // parse falla → interest vacío, no inventar
        }
      }
    }

    // Paso 3: queries relacionadas en alza
    let relatedQueries: string[] = [];
    if (relatedWidget?.token) {
      const rqReq = JSON.stringify({
        restriction: { geo, time, originalTimeRangeForExploreUrl: time },
        keywordType: 'QUERY',
        metric: ['TOP', 'RISING'],
        trendinessSettings: {},
        requestOptions: { property: '', backend: 'IZG', category: 0 },
        language: hl,
      });
      const rqUrl = `https://trends.google.com/trends/api/widgetdata/relatedsearches?hl=${hl}&tz=0&req=${encodeURIComponent(rqReq)}&token=${encodeURIComponent(relatedWidget.token)}&geo=${geo}`;

      let rqRes: Response;
      try {
        rqRes = await fetchWithTimeout(rqUrl, { headers }, TRENDS_TIMEOUT_MS);
      } catch (err: any) {
        return result<GoogleTrendsOutput>(false, { error: `GoogleTrends timeout related: ${err.message}` });
      }
      if (rqRes.ok) {
        try {
          const rqJson = JSON.parse(stripTrendsPrefix(await rqRes.text()));
          const risingItems: any[] = rqJson.default?.rankedList?.[1]?.rankedKeyword || [];
          relatedQueries = risingItems.slice(0, 10).map((item: any) => item.query || '').filter(Boolean);
        } catch {
          // parse falla → relatedQueries vacío, no inventar
        }
      }
    }

    // Si no hay datos de interés, no inventar → error real para que el loop lo gestione
    if (interest.length === 0) {
      return result<GoogleTrendsOutput>(false, { error: 'GoogleTrends: sin datos de interés para la keyword' });
    }

    const volume = Math.max(...interest.map(d => d.value), 0);
    const trend  = computeTrend(interest);

    return result<GoogleTrendsOutput>(true, {
      data: { keyword: input.query, volume, trend, relatedQueries },
      cost: 0,
    });
  },
};

export const WebBrowserTool: Tool<WebBrowserInput, WebBrowserOutput> = {
  id: 'web.browser',
  name: 'Web Browser',
  description: 'Lee el contenido de texto de cualquier URL pública. Útil para investigar productos, competidores o noticias.',
  category: 'browser',
  status: 'ready',
  permissions: permission('global'),
  requiredApproval: false,
  inputSchema: stubInputSchema(
    {
      url:      { type: 'string', format: 'uri', description: 'URL completa a leer' },
      maxChars: { type: 'integer', minimum: 100, maximum: 50000, description: 'Máximo de caracteres a devolver (default 8000)' },
    },
    ['url']
  ),
  outputSchema: stubOutputSchema({
    url:       { type: 'string' },
    title:     { type: 'string' },
    content:   { type: 'string' },
    truncated: { type: 'boolean' },
  }),
  async estimateCost(_input) { return 0; },
  async execute(input, _ctx) {
    try {
      // Guard SSRF: solo http/https hacia IPs públicas, redirecciones revalidadas (ver ssrfGuard.ts).
      const res = await safeFetch(input.url, {
        'User-Agent': TRENDS_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });

      if (!res.ok) {
        return result<WebBrowserOutput>(false, { error: `HTTP ${res.status} al acceder a ${input.url}` });
      }

      const html  = await res.text();
      const title = html.match(/<title[^>]*>([^<]{0,200})<\/title>/i)?.[1]?.trim() || '';

      // Strip scripts, styles, then all tags, normalize whitespace
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s{2,}/g, ' ')
        .trim();

      const max       = input.maxChars ?? 8000;
      const content   = text.slice(0, max);
      const truncated = text.length > max;

      return result<WebBrowserOutput>(true, { data: { url: input.url, title, content, truncated }, cost: 0 });
    } catch (err: any) {
      return result<WebBrowserOutput>(false, { error: `WebBrowser: ${err.message}` });
    }
  },
};

export const SystemExecTool: Tool<SystemExecInput, SystemExecOutput> = {
  id: 'system.exec',
  name: 'System Exec',
  description: 'Propone un comando de terminal para ejecutar en el Mac de Jorge. NUNCA se ejecuta directo — siempre queda pendiente de aprobación en Alertas.',
  category: 'system',
  status: 'ready',
  permissions: permission('agent', { requiresAdmin: true }),
  requiredApproval: true,
  inputSchema: stubInputSchema(
    {
      command: { type: 'string', description: 'Comando exacto de shell a ejecutar' },
      cwd:     { type: 'string', description: 'Directorio de trabajo relativo a la raíz del proyecto (opcional)' },
      reason:  { type: 'string', description: 'Por qué hace falta este comando, en una frase' },
    },
    ['command']
  ),
  outputSchema: stubOutputSchema({
    status:    { type: 'string' },
    execRunId: { type: 'integer' },
  }),
  async estimateCost(_input) { return 0; },
  async execute(input, ctx) {
    try {
      const { execRunId } = await requestExec({ agentId: ctx.agentId, command: input.command, cwd: input.cwd, reason: input.reason });
      return result<SystemExecOutput>(true, { data: { status: 'pending_approval', execRunId }, cost: 0 });
    } catch (err: any) {
      return result<SystemExecOutput>(false, { error: `SystemExec: ${err.message}` });
    }
  },
};

// Fase 1 de la migración marcadores → Tool Calling (HOKAGE_CORE_SPECIFICATION_v1.md §2).
// Sustituye el parseo regex de [TENDENCIA: keyword | descripcion] en agentRuntime.ts —
// el regex se queda activo hasta verificar N ejecuciones reales por esta tool.
export const TrendReportTool: Tool<TrendReportInput, TrendReportOutput> = {
  id: 'trend.report',
  name: 'Trend Report',
  description: 'Registra una tendencia de mercado detectada. Úsala en vez de escribir texto libre — cada llamada crea un registro real en el pipeline de tendencias.',
  category: 'pipeline',
  status: 'ready',
  permissions: permission('agent'),
  requiredApproval: false,
  inputSchema: stubInputSchema(
    {
      keyword:     { type: 'string', description: 'Keyword de la tendencia (ej: "minimalist wall art")' },
      description: { type: 'string', description: 'Descripción breve, menos de 120 caracteres', maxLength: 120 },
    },
    ['keyword', 'description']
  ),
  outputSchema: stubOutputSchema({
    marketId: { type: 'integer' },
    keyword:  { type: 'string' },
  }),
  async estimateCost(_input) { return 0; },
  async execute(input, ctx) {
    try {
      const agent = ctx.agentId ? await get<{ name: string }>('SELECT name FROM agents WHERE id = ?', [ctx.agentId]) : null;
      const agentName = agent?.name || 'agente';

      const market = await createMarket({
        agent_id: ctx.agentId ?? null,
        keyword: input.keyword,
        source: 'agent',
        payload: JSON.stringify({ description: input.description }),
      });

      bus.publish({
        type: 'trend.detected',
        from: agentName,
        payload: { keyword: input.keyword, description: input.description, detectedAt: new Date().toISOString() },
      });
      console.log(`[TOOL:trend.report] ${agentName} → trend.detected :: ${input.keyword}`);

      return result<TrendReportOutput>(true, { data: { marketId: market.id, keyword: input.keyword }, cost: 0 });
    } catch (err: any) {
      console.error(`[TOOL:trend.report] error:`, err.message);
      return result<TrendReportOutput>(false, { error: `TrendReport: ${err.message}` });
    }
  },
};

// Fase 2 de la migración marcadores → Tool Calling (HOKAGE_CORE_SPECIFICATION_v1.md §2).
// Sustituye el parseo regex de [CONTENIDO: keyword | resumen] en agentRuntime.ts —
// el regex se queda activo hasta verificar N ejecuciones reales por esta tool.
export const ContentCreateTool: Tool<ContentCreateInput, ContentCreateOutput> = {
  id: 'content.create',
  name: 'Content Create',
  description: 'Registra contenido SEO listo para distribuir. Úsala en vez de escribir texto libre — cada llamada crea un registro real en el pipeline de contenido.',
  category: 'pipeline',
  status: 'ready',
  permissions: permission('agent'),
  requiredApproval: false,
  inputSchema: stubInputSchema(
    {
      keyword: { type: 'string', description: 'Keyword del contenido creado' },
      summary: { type: 'string', description: 'Resumen de 1 línea del contenido', maxLength: 120 },
    },
    ['keyword', 'summary']
  ),
  outputSchema: stubOutputSchema({
    contentId: { type: 'integer' },
    keyword:   { type: 'string' },
  }),
  async estimateCost(_input) { return 0; },
  async execute(input, ctx) {
    try {
      const agent = ctx.agentId ? await get<{ name: string }>('SELECT name FROM agents WHERE id = ?', [ctx.agentId]) : null;
      const agentName = agent?.name || 'agente';

      const content = await createContent({
        agent_id: ctx.agentId ?? null,
        platform: 'seo',
        body: `${input.keyword} — ${input.summary}`,
        status: 'draft',
      });

      bus.publish({
        type: 'content.created',
        from: agentName,
        payload: { keyword: input.keyword, summary: input.summary, agentId: ctx.agentId ?? null, createdAt: new Date().toISOString() },
      });
      console.log(`[TOOL:content.create] ${agentName} → content.created :: ${input.keyword}`);

      return result<ContentCreateOutput>(true, { data: { contentId: content.id, keyword: input.keyword }, cost: 0 });
    } catch (err: any) {
      console.error(`[TOOL:content.create] error:`, err.message);
      return result<ContentCreateOutput>(false, { error: `ContentCreate: ${err.message}` });
    }
  },
};

// Fase 3 de la migración marcadores → Tool Calling (HOKAGE_CORE_SPECIFICATION_v1.md §2).
// Sustituye el parseo regex de [MEMORIA: clave=valor] en agentRuntime.ts, solo para roles
// tool-capable. operaciones/soporte (Llama 3.1 8B) nunca reciben esta tool — se quedan en el
// marcador de forma permanente, no como transición.
export const MemoryWriteTool: Tool<MemoryWriteInput, MemoryWriteOutput> = {
  id: 'memory.write',
  name: 'Memory Write',
  description: 'Guarda un hecho relevante en tu memoria privada para recordarlo en el futuro. Úsala en vez de escribir texto libre.',
  category: 'pipeline',
  status: 'ready',
  permissions: permission('agent'),
  requiredApproval: false,
  inputSchema: stubInputSchema(
    {
      key:   { type: 'string', description: 'Clave en snake_case (ej: cliente_principal)', pattern: '^[a-z_][a-z0-9_]*$' },
      value: { type: 'string', description: 'Valor a recordar, menos de 150 caracteres', maxLength: 150 },
    },
    ['key', 'value']
  ),
  outputSchema: stubOutputSchema({
    key:   { type: 'string' },
    saved: { type: 'boolean' },
  }),
  async estimateCost(_input) { return 0; },
  async execute(input, ctx) {
    try {
      const key = input.key.trim().toLowerCase();
      if (!MEMORY_KEY_PATTERN.test(key)) {
        // A diferencia del regex viejo (que descartaba en silencio una clave mal formada),
        // aquí el error vuelve al modelo en el resultado de la tool — puede corregir y reintentar.
        return result<MemoryWriteOutput>(false, { error: `MemoryWrite: clave inválida "${key}" — debe ser snake_case` });
      }
      if (!ctx.agentId) {
        return result<MemoryWriteOutput>(false, { error: 'MemoryWrite: falta agentId en el contexto' });
      }
      const value = input.value.trim().slice(0, 150);

      await writeAgentMemory(ctx.agentId, key, value, ctx.ventureId);

      const agent = await get<{ name: string }>('SELECT name FROM agents WHERE id = ?', [ctx.agentId]);
      console.log(`[TOOL:memory.write] ${agent?.name || 'agente'} → agent_memory :: ${key}`);

      return result<MemoryWriteOutput>(true, { data: { key, saved: true }, cost: 0 });
    } catch (err: any) {
      console.error(`[TOOL:memory.write] error:`, err.message);
      return result<MemoryWriteOutput>(false, { error: `MemoryWrite: ${err.message}` });
    }
  },
};

// Fase 4 · Slice 4.2 — memory.read: leer un valor de tu memoria privada por clave.
// Solo para roles tool-capable (contenido, investigador, trafico, finanzas, ceo, hermes).
export const MemoryReadTool: Tool<MemoryReadInput, MemoryReadOutput> = {
  id: 'memory.read',
  name: 'Memory Read',
  description: 'Lee un valor de tu memoria privada (agent_memory) por clave. Útil para recuperar datos que guardaste antes con memory.write.',
  category: 'pipeline',
  status: 'ready',
  permissions: permission('agent'),
  requiredApproval: false,
  inputSchema: stubInputSchema(
    {
      key: { type: 'string', description: 'Clave a leer (snake_case, ej: etsy_listing_minimal_wall_art)' },
    },
    ['key']
  ),
  outputSchema: stubOutputSchema({
    key: { type: 'string' },
    value: { type: 'string' },
    found: { type: 'boolean' },
  }),
  async estimateCost(_input) { return 0; },
  async execute(input, ctx) {
    try {
      if (!ctx.agentId) {
        return result<MemoryReadOutput>(false, { error: 'MemoryRead: falta agentId en el contexto' });
      }
      const entries = await readAgentMemory(ctx.agentId, 100);
      const entry = entries.find((e) => e.key === input.key);
      if (!entry) {
        return result<MemoryReadOutput>(true, { data: { key: input.key, value: null, found: false }, cost: 0 });
      }
      return result<MemoryReadOutput>(true, { data: { key: entry.key, value: entry.value, found: true }, cost: 0 });
    } catch (err: any) {
      console.error(`[TOOL:memory.read] error:`, err.message);
      return result<MemoryReadOutput>(false, { error: `MemoryRead: ${err.message}` });
    }
  },
};

// Fase 4 (última) de la migración marcadores → Tool Calling (HOKAGE_CORE_SPECIFICATION_v1.md §2).
// Sustituye el parseo regex de [DECISION: título] en agentRuntime.ts — el marcador de mayor
// superficie y el más visible para Jorge (alimenta Alertas directo). decisionService.createDecision()
// ya trae su propia deduplicación (mismo agente + mismo título + 'proposed') — se hereda gratis,
// no se reimplementa aquí.
export const DecisionCreateTool: Tool<DecisionCreateInput, DecisionCreateOutput> = {
  id: 'decision.create',
  name: 'Decision Create',
  description: 'Crea una Decision pendiente de aprobación de Jorge (publicar algo, gastar dinero, cambiar configuración). Úsala en vez de escribir texto libre.',
  category: 'pipeline',
  status: 'ready',
  permissions: permission('agent'),
  requiredApproval: false, // la Decision creada SÍ requiere aprobación de Jorge — eso lo aplica decisionService, no esta tool
  inputSchema: stubInputSchema(
    {
      title:       { type: 'string', description: 'Título de la decisión, menos de 100 caracteres', maxLength: 100 },
      description: { type: 'string', description: 'Por qué hace falta esta decisión y qué contexto necesita Jorge para decidir — obligatorio, no lo dejes vacío' },
      amount:      { type: 'number', description: 'Importe en USD si implica gasto (opcional)' },
      risk_level:  { type: 'string', description: 'Nivel de riesgo', enum: ['low', 'medium', 'high'] },
    },
    ['title', 'description']
  ),
  outputSchema: stubOutputSchema({
    decisionId: { type: 'integer' },
    title:      { type: 'string' },
    status:     { type: 'string' },
  }),
  async estimateCost(_input) { return 0; },
  async execute(input, ctx) {
    try {
      const agent = ctx.agentId ? await get<{ name: string }>('SELECT name FROM agents WHERE id = ?', [ctx.agentId]) : null;
      const agentName = agent?.name || 'agente';

      const decision = await createDecision({
        agent_id: ctx.agentId ?? null,
        title: input.title,
        description: input.description,
        reasoning: `Generado automaticamente por ${agentName} durante tarea autonoma`,
        risk_level: input.risk_level || 'low',
        amount: input.amount ?? null,
      });

      bus.publish({
        type: 'decision.created',
        from: agentName,
        payload: { title: decision.title, agentId: ctx.agentId ?? null },
      });
      // Nivel 2+ de autonomía: auto-aprueba la decisión si no es crítica (reutiliza el mecanismo
      // de aprobación existente; nunca aprueba gasto, publicación, system.exec ni alto riesgo).
      const autoApproved = await maybeAutoApprove(decision);
      console.log(`[TOOL:decision.create] ${agentName} → decision.created :: ${decision.title} (id=${decision.id})${autoApproved ? ' [auto-aprobada]' : ''}`);

      return result<DecisionCreateOutput>(true, { data: { decisionId: decision.id, title: decision.title, status: autoApproved ? 'approved' : decision.status }, cost: 0 });
    } catch (err: any) {
      console.error(`[TOOL:decision.create] error:`, err.message);
      return result<DecisionCreateOutput>(false, { error: `DecisionCreate: ${err.message}` });
    }
  },
};

// Fase 4 — memoria de NEGOCIO. Escribe un aprendizaje compartido del venture (memory_entries),
// scopeado por ctx.ventureId (la venture de la tarea actual). No es memoria privada (eso es
// memory.write). Efecto 'operational' → gateado por autonomía (Nivel 0 no la recibe). El
// contenido se guarda como DATO; el ContextComposer lo enmarca con la nota anti-inyección.
const MEMORY_REMEMBER_CATEGORIES = ['error', 'attempt', 'research', 'learning', 'context'];

export const MemoryRememberTool: Tool<MemoryRememberInput, MemoryRememberOutput> = {
  id: 'memory.remember',
  name: 'Memory Remember',
  description: 'Registra un aprendizaje del NEGOCIO (error, intento, investigación, aprendizaje o contexto) en la memoria empresarial compartida del venture, para que el equipo lo recuerde en el futuro. No es tu memoria privada (para eso usa memory.write).',
  category: 'pipeline',
  status: 'ready',
  permissions: permission('agent'),
  requiredApproval: false,
  inputSchema: stubInputSchema(
    {
      category: { type: 'string', description: 'Tipo de recuerdo de negocio', enum: MEMORY_REMEMBER_CATEGORIES },
      title:    { type: 'string', description: 'Título corto del recuerdo (menos de 120 caracteres)', maxLength: 120 },
      content:  { type: 'string', description: 'Qué pasó o qué aprendiste (menos de 800 caracteres)', maxLength: 800 },
    },
    ['category', 'title', 'content']
  ),
  outputSchema: stubOutputSchema({ memoryId: { type: 'integer' } }),
  async estimateCost(_input) { return 0; },
  async execute(input, ctx) {
    try {
      if (!MEMORY_REMEMBER_CATEGORIES.includes(input.category)) {
        return result<MemoryRememberOutput>(false, { error: `MemoryRemember: categoría inválida "${input.category}" (usa: ${MEMORY_REMEMBER_CATEGORIES.join(', ')})` });
      }
      const { id } = await createMemoryEntry({
        ventureId: ctx.ventureId ?? null,
        category: input.category,
        title: input.title,
        content: input.content,
        sourceAgentId: ctx.agentId ?? null,
      });
      const agent = ctx.agentId ? await get<{ name: string }>('SELECT name FROM agents WHERE id = ?', [ctx.agentId]) : null;
      console.log(`[TOOL:memory.remember] ${agent?.name || 'agente'} → memory_entries :: ${input.category}/${input.title.slice(0, 40)} (venture=${ctx.ventureId ?? 'global'})`);
      return result<MemoryRememberOutput>(true, { data: { memoryId: id }, cost: 0 });
    } catch (err: any) {
      console.error(`[TOOL:memory.remember] error:`, err.message);
      return result<MemoryRememberOutput>(false, { error: `MemoryRemember: ${err.message}` });
    }
  },
};
