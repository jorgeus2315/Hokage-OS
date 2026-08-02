import type { Tool, ToolContext, ToolResult } from './base.js';
import { get, run } from '../db/init.js';
import { recordExecution as internalRecordExecution } from './logger.js';

export interface ToolValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateInput(tool: Tool, input: unknown): ToolValidationResult {
  const errors: string[] = [];
  if (!tool.inputSchema || typeof tool.inputSchema.properties !== 'object') {
    return { valid: true, errors: [] };
  }

  const data = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  for (const required of tool.inputSchema.required || []) {
    if (!(required in data) || data[required] === undefined || data[required] === null || data[required] === '') {
      errors.push(`Missing required input: ${required}`);
    }
  }

  const schema = tool.inputSchema.properties as Record<string, { type?: string; enum?: string[]; minimum?: number; maximum?: number; format?: string }>;

  for (const [key, schemaItem] of Object.entries(schema)) {
    if (!(key in data)) continue;
    const value = data[key];
    if (value === undefined || value === null) continue;

    if (schemaItem.type === 'string' && typeof value !== 'string') errors.push(`Invalid type for ${key}: expected string`);
    if (schemaItem.type === 'integer' && typeof value !== 'number') errors.push(`Invalid type for ${key}: expected integer`);
    if (schemaItem.type === 'number' && typeof value !== 'number') errors.push(`Invalid type for ${key}: expected number`);
    if (schemaItem.type === 'boolean' && typeof value !== 'boolean') errors.push(`Invalid type for ${key}: expected boolean`);

    if (schemaItem.enum && !schemaItem.enum.includes(String(value))) {
      errors.push(`Invalid enum value for ${key}: ${String(value)}`);
    }

    if (typeof value === 'number') {
      if (typeof schemaItem.minimum === 'number' && value < schemaItem.minimum) errors.push(`Value too small for ${key}`);
      if (typeof schemaItem.maximum === 'number' && value > schemaItem.maximum) errors.push(`Value too large for ${key}`);
    }

    if (schemaItem.format === 'uri' && typeof value === 'string') {
      try {
        new URL(value);
      } catch {
        errors.push(`Invalid URI for ${key}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function validateOutput(tool: Tool, data: unknown): Promise<ToolValidationResult> {
  const errors: string[] = [];
  if (!tool.outputSchema || typeof tool.outputSchema.properties !== 'object') {
    return { valid: true, errors: [] };
  }

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Output must be an object'] };
  }

  return { valid: errors.length === 0, errors };
}

export async function checkPermissions(tool: Tool, ctx: ToolContext): Promise<ToolResult> {
  const perm = tool.permissions;
  if (perm.requiresAdmin && !ctx.requestId) {
    return { ok: false, error: 'Admin approval required', cost: 0, durationMs: 0 };
  }
  if (perm.scope === 'business' && !ctx.businessId) {
    return { ok: false, error: 'Business context required', cost: 0, durationMs: 0 };
  }
  if (perm.scope === 'agent' && !ctx.agentId) {
    return { ok: false, error: 'Agent context required', cost: 0, durationMs: 0 };
  }
  return { ok: true, cost: 0, durationMs: 0 };
}

export async function estimateTotalCost(tool: Tool, input: unknown): Promise<number> {
  try {
    return Number(await tool.estimateCost(input)) || 0;
  } catch {
    return 0;
  }
}

export interface ToolLogRecord {
  toolId: string;
  ok: boolean;
  error?: string;
  cost: number;
  durationMs: number;
}

export async function recordExecution(record: ToolLogRecord): Promise<void> {
  return internalRecordExecution(record);
}
