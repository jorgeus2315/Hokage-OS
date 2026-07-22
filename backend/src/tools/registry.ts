import type { Tool, ToolContext } from './base.js';
import { EtsyTool, PrintifyTool, GoogleTrendsTool, WebBrowserTool } from './index.js';

const registry = new Map<string, Tool>([
  ['etsy', EtsyTool],
  ['printify', PrintifyTool],
  ['google-trends', GoogleTrendsTool],
  ['web-browser', WebBrowserTool],
]);

export function register(tool: Tool): void {
  registry.set(tool.name, tool);
}

export function get(name: string): Tool | undefined {
  return registry.get(name);
}

export function list(): Tool[] {
  return Array.from(registry.values());
}

export async function execute(name: string, input: unknown, ctx: ToolContext) {
  const tool = registry.get(name);
  if (!tool) return { ok: false, error: `Tool not found: ${name}` } as const;
  return tool.execute(input, ctx);
}
