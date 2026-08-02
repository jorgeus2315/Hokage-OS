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

export const GoogleTrendsTool: Tool<GoogleTrendsInput, GoogleTrendsOutput> = {
  id: 'google.trends',
  name: 'Google Trends',
  description: 'Consultas de tendencias de búsqueda.',
  category: 'research',
  status: 'stub',
  permissions: permission('business'),
  requiredApproval: false,
  inputSchema: stubInputSchema(
    {
      query: { type: 'string' },
      region: { type: 'string' },
      timeframe: { type: 'string', enum: ['7d', '30d', '90d'] },
    },
    ['query']
  ),
  outputSchema: stubOutputSchema({
    query: { type: 'string' },
    region: { type: 'string' },
    timeframe: { type: 'string' },
    interest: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          value: { type: 'integer' },
        },
      },
    },
    rising: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          value: { type: 'integer' },
        },
      },
    },
  }),
  async estimateCost(_input) {
    return 0.005;
  },
  async execute(_input, _ctx) {
    return result<GoogleTrendsOutput>(false, {
      data: { query: '', region: '', timeframe: '7d', interest: [], rising: [] },
      error: 'GoogleTrendsTool no implementado: requiere fuente externa o dataset.',
    });
  },
};

export const WebBrowserTool: Tool<WebBrowserInput, WebBrowserOutput> = {
  id: 'web.browser',
  name: 'Web Browser',
  description: 'Navegación web para lectura y scraping controlado.',
  category: 'browser',
  status: 'stub',
  permissions: permission('global', { requiresAdmin: true }),
  requiredApproval: true,
  inputSchema: stubInputSchema(
    {
      url: { type: 'string', format: 'uri' },
      maxChars: { type: 'integer', minimum: 100, maximum: 100000 },
    },
    ['url']
  ),
  outputSchema: stubOutputSchema({
    url: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    content: { type: 'string' },
    truncated: { type: 'boolean' },
  }),
  async estimateCost(_input) {
    return 0.02;
  },
  async execute(_input, _ctx) {
    return result<WebBrowserOutput>(false, {
      data: { url: '', content: '', truncated: false },
      error: 'WebBrowserTool no implementado: requiere servicio de navegación o sandbox.',
    });
  },
};
