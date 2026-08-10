import type { Tool, ToolContext, ToolResult, ToolStatus, ToolPermission } from './base.js';
import type { EtsyListingInput, EtsyListingOutput, ShopifyListingInput, ShopifyListingOutput, PrintifyProductInput, PrintifyProductOutput, GoogleTrendsInput, GoogleTrendsOutput, WebBrowserInput, WebBrowserOutput, SystemExecInput, SystemExecOutput, TrendReportInput, TrendReportOutput, ContentCreateInput, ContentCreateOutput, MemoryWriteInput, MemoryWriteOutput, DecisionCreateInput, DecisionCreateOutput } from './types.js';
import { requestExec } from '../services/hermesService.js';
import { createMarket } from '../services/marketService.js';
import { createContent } from '../services/contentService.js';
import { writeAgentMemory } from '../services/agentMemoryService.js';
import { createDecision } from '../services/decisionService.js';
import { maybeAutoApprove } from '../services/agentAutonomy.js';
import { get } from '../db/init.js';
import bus from '../config/eventBus.js';
import { safeFetch } from './ssrfGuard.js';

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

export const EtsyTool: Tool<EtsyListingInput, EtsyListingOutput> = {
  id: 'etsy.listings',
  name: 'Etsy Listings',
  description: 'Consulta listings, tendencias y pedidos de Etsy.',
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
    return result<EtsyListingOutput>(false, {
      data: { total: 0, items: [] },
      error: 'EtsyTool no implementado: requiere MCP o API key.',
    });
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

export const GoogleTrendsTool: Tool<GoogleTrendsInput, GoogleTrendsOutput> = {
  id: 'google.trends',
  name: 'Google Trends',
  description: 'Consulta el interés de búsqueda de una keyword y queries relacionadas en alza.',
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
    query:     { type: 'string' },
    region:    { type: 'string' },
    timeframe: { type: 'string' },
    interest:  { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, value: { type: 'integer' } } } },
    rising:    { type: 'array', items: { type: 'object', properties: { query: { type: 'string' }, value: { type: 'integer' } } } },
  }),
  async estimateCost(_input) { return 0; },
  async execute(input, _ctx) {
    const geo       = input.region    || 'US';
    const timeMap   = { '7d': 'now 7-d', '30d': 'today 1-m', '90d': 'today 3-m' } as const;
    const time      = timeMap[input.timeframe || '30d'] ?? 'today 1-m';
    const hl        = 'en-US';
    const headers   = { 'User-Agent': TRENDS_UA, Accept: 'application/json, text/plain, */*' };

    try {
      // Paso 1: obtener tokens de widgets desde /explore
      const exploreReq = JSON.stringify({
        comparisonItem: [{ keyword: input.query, geo, time }],
        category: 0,
        property: '',
      });
      const exploreUrl = `https://trends.google.com/trends/api/explore?hl=${hl}&tz=0&req=${encodeURIComponent(exploreReq)}`;
      const exploreRes = await fetch(exploreUrl, { headers });
      if (!exploreRes.ok) {
        return result<GoogleTrendsOutput>(false, { error: `Google Trends explore ${exploreRes.status}` });
      }
      const widgets: any[] = JSON.parse(stripTrendsPrefix(await exploreRes.text())).widgets || [];

      const timeseriesWidget = widgets.find((w: any) => w.id === 'TIMESERIES');
      const relatedWidget    = widgets.find((w: any) => w.id === 'RELATED_QUERIES');

      let interest: GoogleTrendsOutput['interest'] = [];
      let rising:   GoogleTrendsOutput['rising']   = [];

      // Paso 2: interés a lo largo del tiempo
      if (timeseriesWidget?.token) {
        const tsReq = JSON.stringify({
          time,
          resolution: 'WEEK',
          locale: hl,
          comparisonItem: [{ geo, complexKeywordsRestriction: { keyword: [{ type: 'BROAD', value: input.query }] } }],
          requestOptions: { property: '', backend: 'IZG', category: 0 },
        });
        const tsUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=${hl}&tz=0&req=${encodeURIComponent(tsReq)}&token=${encodeURIComponent(timeseriesWidget.token)}&geo=${geo}`;
        const tsRes = await fetch(tsUrl, { headers });
        if (tsRes.ok) {
          const tsJson = JSON.parse(stripTrendsPrefix(await tsRes.text()));
          interest = (tsJson.default?.timelineData || []).map((d: any) => ({
            date:  d.formattedAxisTime || d.formattedTime || '',
            value: d.value?.[0] ?? 0,
          }));
        }
      }

      // Paso 3: queries relacionadas en alza
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
        const rqRes = await fetch(rqUrl, { headers });
        if (rqRes.ok) {
          const rqJson = JSON.parse(stripTrendsPrefix(await rqRes.text()));
          const risingItems: any[] = rqJson.default?.rankedList?.[1]?.rankedKeyword || [];
          rising = risingItems.slice(0, 10).map((item: any) => ({
            query: item.query  || '',
            value: item.value  ?? 0,
          }));
        }
      }

      return result<GoogleTrendsOutput>(true, {
        data: { query: input.query, region: geo, timeframe: input.timeframe || '30d', interest, rising },
        cost: 0,
      });
    } catch (err: any) {
      return result<GoogleTrendsOutput>(false, { error: `GoogleTrends: ${err.message}` });
    }
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

      await writeAgentMemory(ctx.agentId, key, value);

      const agent = await get<{ name: string }>('SELECT name FROM agents WHERE id = ?', [ctx.agentId]);
      console.log(`[TOOL:memory.write] ${agent?.name || 'agente'} → agent_memory :: ${key}`);

      return result<MemoryWriteOutput>(true, { data: { key, saved: true }, cost: 0 });
    } catch (err: any) {
      console.error(`[TOOL:memory.write] error:`, err.message);
      return result<MemoryWriteOutput>(false, { error: `MemoryWrite: ${err.message}` });
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
