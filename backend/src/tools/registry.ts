import type { Tool, ToolContext, ToolResult, ToolStatus, ToolPermission } from './base.js';
import { EtsyTool, EtsyReceiptsTool, ShopifyTool, PrintifyTool, GoogleTrendsTool, WebBrowserTool, SystemExecTool, TrendReportTool, ContentCreateTool, MemoryWriteTool, DecisionCreateTool, MemoryRememberTool } from './index.js';
import { recordAudit } from '../services/auditService.js';

const registry = new Map<string, Tool>([
  [EtsyTool.id, EtsyTool],
  [EtsyReceiptsTool.id, EtsyReceiptsTool],
  [ShopifyTool.id, ShopifyTool],
  [PrintifyTool.id, PrintifyTool],
  [GoogleTrendsTool.id, GoogleTrendsTool],
  [WebBrowserTool.id, WebBrowserTool],
  [SystemExecTool.id, SystemExecTool],
  [TrendReportTool.id, TrendReportTool],
  [ContentCreateTool.id, ContentCreateTool],
  [MemoryWriteTool.id, MemoryWriteTool],
  [DecisionCreateTool.id, DecisionCreateTool],
  [MemoryRememberTool.id, MemoryRememberTool],
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
  // Auditoría (Fase 9): SOLO nombre de tool, duración, estado y error saneado. Nunca argumentos
  // (input) ni resultados (data) — pueden contener secretos/contenido. Para system.exec esto
  // registra tool=system.exec/status/duración, jamás el comando, el env ni el output.
  const start = Date.now();
  const audit = { ventureId: ctx.ventureId ?? null, agentId: ctx.agentId ?? null } as const;
  await recordAudit({ type: 'tool.started', ...audit, meta: { tool: id } });
  try {
    const result = await tool.execute(input, ctx);
    await recordAudit({
      type: result.ok ? 'tool.completed' : 'tool.failed', ...audit,
      status: result.ok ? 'ok' : 'error',
      meta: { tool: id, duration_ms: Date.now() - start, ...(result.ok ? {} : { error: result.error }) },
    });
    return result;
  } catch (err: any) {
    await recordAudit({ type: 'tool.failed', ...audit, status: 'error', meta: { tool: id, duration_ms: Date.now() - start, error: err?.message } });
    throw err;
  }
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
