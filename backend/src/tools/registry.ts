import type { Tool, ToolContext, ToolResult, ToolStatus, ToolPermission } from './base.js';
import { EtsyTool, ShopifyTool, PrintifyTool, GoogleTrendsTool, WebBrowserTool } from './index.js';

const registry = new Map<string, Tool>([
  [EtsyTool.id, EtsyTool],
  [ShopifyTool.id, ShopifyTool],
  [PrintifyTool.id, PrintifyTool],
  [GoogleTrendsTool.id, GoogleTrendsTool],
  [WebBrowserTool.id, WebBrowserTool],
]);

export interface ToolMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  status: ToolStatus;
  requiredApproval: boolean;
  permissions: ToolPermission;
  inputSchema: Tool['inputSchema'];
  outputSchema: Tool['outputSchema'];
}

export function register(tool: Tool): void {
  registry.set(tool.id, tool);
}

export function get(id: string): Tool | undefined {
  return registry.get(id);
}

export function list(): Tool[] {
  return Array.from(registry.values());
}

export function listMeta(): ToolMeta[] {
  return list().map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    status: t.status,
    requiredApproval: t.requiredApproval,
    permissions: t.permissions,
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
  }));
}

export async function execute(id: string, input: unknown, ctx: ToolContext): Promise<ToolResult<unknown>> {
  const tool = registry.get(id);
  if (!tool) return { ok: false, error: `Tool not found: ${id}` };
  return tool.execute(input, ctx);
}

export function discover() {
  const byCategory = new Map<string, ToolMeta[]>();
  for (const meta of listMeta()) {
    const bucket = byCategory.get(meta.category) || [];
    bucket.push(meta);
    byCategory.set(meta.category, bucket);
  }
  return {
    total: registry.size,
    categories: Object.fromEntries(byCategory.entries()),
  };
}
