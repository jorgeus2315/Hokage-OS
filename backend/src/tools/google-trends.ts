import type { Tool } from './base.js';
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
