import type { Tool } from './base.js';

export const EtsyTool: Tool = {
  name: 'etsy',
  description: 'Consulta y opera sobre Etsy: listings, trends, pedidos.',
  category: 'marketplace',
  requiredApproval: true,
  async estimateCost() {
    return 0.01;
  },
  async execute(_input: unknown, _ctx: unknown) {
    return { ok: true, data: { platform: 'etsy', status: 'stub' } };
  },
};

export const PrintifyTool: Tool = {
  name: 'printify',
  description: 'Gestión de productos print-on-demand.',
  category: 'fulfillment',
  requiredApproval: true,
  async estimateCost() {
    return 0.01;
  },
  async execute(_input: unknown, _ctx: unknown) {
    return { ok: true, data: { platform: 'printify', status: 'stub' } };
  },
};

export const GoogleTrendsTool: Tool = {
  name: 'google-trends',
  description: 'Consultas de tendencias de búsqueda.',
  category: 'research',
  requiredApproval: false,
  async estimateCost() {
    return 0.005;
  },
  async execute(_input: unknown, _ctx: unknown) {
    return { ok: true, data: { source: 'google-trends', status: 'stub' } };
  },
};

export const WebBrowserTool: Tool = {
  name: 'web-browser',
  description: 'Navegación web para lectura y scraping controlado.',
  category: 'browser',
  requiredApproval: true,
  async estimateCost() {
    return 0.02;
  },
  async execute(_input: unknown, _ctx: unknown) {
    return { ok: true, data: { source: 'web-browser', status: 'stub' } };
  },
};
