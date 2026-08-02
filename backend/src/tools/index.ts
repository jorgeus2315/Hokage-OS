import type { Tool, ToolContext, ToolResult, ToolStatus, ToolPermission } from './base.js';
import type { EtsyListingInput, EtsyListingOutput, ShopifyListingInput, ShopifyListingOutput, PrintifyProductInput, PrintifyProductOutput, GoogleTrendsInput, GoogleTrendsOutput, WebBrowserInput, WebBrowserOutput } from './types.js';

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
      const res = await fetch(input.url, {
        headers: {
          'User-Agent': TRENDS_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
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
