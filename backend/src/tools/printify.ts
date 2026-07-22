import type { Tool } from './base.js';
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
