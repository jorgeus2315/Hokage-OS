export type ToolStatus = 'stub' | 'ready' | 'deprecated';

export interface ToolPermission {
  scope: 'global' | 'business' | 'agent';
  roles?: string[];
  requiresAdmin?: boolean;
}

export interface ToolContext {
  agentId?: number;
  userId?: number;
  ventureId?: number;
  requestId?: string;
}

export type ToolResult<O = unknown> = {
  ok: boolean;
  data?: O;
  error?: string;
  cost?: number;
  durationMs?: number;
};

export interface Tool<I = unknown, O = unknown> {
  id: string;
  name: string;
  description: string;
  category: string;
  status: ToolStatus;
  // permissions/requiredApproval son metadata informativa — no hay ninguna capa
  // de plataforma que los haga cumplir (registry.execute() los ignora). Si un
  // tool necesita una garantía real de aprobación, debe implementarla dentro de
  // su propio execute() — ver SystemExecTool como referencia.
  permissions: ToolPermission;
  requiredApproval: boolean;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  outputSchema: {
    type: string;
    properties: Record<string, unknown>;
  };
  estimateCost(input: I): Promise<number>;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
}
