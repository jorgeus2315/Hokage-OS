import type { Tool, ToolContext, ToolResult } from './base.js';
import type { ToolValidationResult } from './manager.js';
import { list, register, execute, listMeta, discover } from './registry.js';
import { validateInput, validateOutput, checkPermissions, estimateTotalCost } from './manager.js';
import { recordExecution } from './logger.js';

export interface ToolRunSummary {
  toolId: string;
  ok: boolean;
  cost: number;
  durationMs: number;
  error?: string;
  validationErrors?: string[];
}

export interface ToolRuntimeOptions {
  autoRegister?: boolean;
}

export class ToolRuntime {
  private readonly autoRegister: boolean;

  constructor(opts: ToolRuntimeOptions = {}) {
    this.autoRegister = opts.autoRegister ?? true;
    this.bootstrap();
  }

  private bootstrap() {
    if (this.autoRegister) {
      for (const tool of list()) {
        register(tool);
      }
    }
  }

  register(tool: Tool) {
    register(tool);
  }

  async run(toolId: string, input: unknown, ctx: ToolContext): Promise<ToolRunSummary> {
    const tool = list().find(t => t.id === toolId);
    if (!tool) {
      return this.summary(toolId, false, 0, 0, `Tool not found: ${toolId}`);
    }

    const validation = validateInput(tool, input);
    if (!validation.valid) {
      const err = validation.errors.join('; ');
      return this.summary(toolId, false, 0, 0, `Validation failed: ${err}`, validation.errors);
    }

    const perm = await checkPermissions(tool, ctx);
    if (!perm.ok) {
      return this.summary(toolId, false, perm.cost || 0, perm.durationMs || 0, perm.error);
    }

    const estimatedCost = await estimateTotalCost(tool, input);

    const start = Date.now();
    let result: ToolResult<unknown>;
    try {
      result = await execute(toolId, input, ctx);
    } catch (error: any) {
      const durationMs = Date.now() - start;
      const message = error?.message || 'Unknown runtime error';
      await recordExecution({ toolId, ok: false, error: message, cost: 0, durationMs });
      return this.summary(toolId, false, 0, durationMs, message);
    }

    const durationMs = Date.now() - start;
    const cost = estimatedCost;

    await recordExecution({
      toolId,
      ok: result.ok,
      error: result.error,
      cost,
      durationMs,
    });

    if (!result.ok) {
      return this.summary(toolId, false, cost, durationMs, result.error);
    }

    const outputValidation = await validateOutput(tool, result.data);
    if (!outputValidation.valid) {
      const err = outputValidation.errors.join('; ');
      return this.summary(toolId, false, cost, durationMs, `Output validation failed: ${err}`);
    }

    return this.summary(toolId, true, cost, durationMs);
  }

  list() {
    return listMeta();
  }

  discover() {
    return discover();
  }

  getStatus() {
    return {
      initialized: true,
      toolCount: list().length,
      categories: Object.keys(this.discover().categories),
    };
  }

  private summary(
    toolId: string,
    ok: boolean,
    cost: number,
    durationMs: number,
    error?: string,
    validationErrors?: string[]
  ): ToolRunSummary {
    return { toolId, ok, cost, durationMs, error, validationErrors };
  }
}

export function createRuntime(opts?: ToolRuntimeOptions): ToolRuntime {
  return new ToolRuntime(opts);
}
