export interface ToolContext {
  agentId?: number;
  userId?: number;
  businessId?: number;
  requestId?: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  cost?: number;
  durationMs?: number;
}

export interface Tool {
  name: string;
  description: string;
  category: string;
  requiredApproval: boolean;
  estimateCost(_input: unknown): Promise<number>;
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}
