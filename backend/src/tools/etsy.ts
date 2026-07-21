import type { Tool, ToolContext, ToolResult } from './base.js';

export const EtsyTool: Tool = {
  name: 'etsy',
  description: 'Consulta y opera sobre Etsy: listings, trends, pedidos.',
  category: 'marketplace',
  requiredApproval: true,
  async estimateCost() {
    return 0.01;
  },
  async execute(_input: unknown, _ctx: ToolContext): Promise<ToolResult> {
    return { ok: true, data: { platform: 'etsy', status: 'stub' } };
  },
};
