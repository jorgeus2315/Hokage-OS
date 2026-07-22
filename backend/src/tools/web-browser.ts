import type { Tool } from './base.js';

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
