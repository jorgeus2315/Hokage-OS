import { run } from '../db/init.js';

export interface ToolRunRecord {
  toolId: string;
  ok: boolean;
  error?: string;
  cost?: number;
  durationMs?: number;
}

export async function recordExecution(record: ToolRunRecord): Promise<void> {
  try {
    await run(
      'INSERT INTO tool_runs (tool_id, status, ok, error, cost, duration_ms) VALUES (?, ?, ?, ?, ?, ?)',
      [
        record.toolId,
        record.ok ? 'completed' : 'failed',
        record.ok ? 1 : 0,
        record.error || null,
        record.cost,
        record.durationMs,
      ]
    );
  } catch {
    // Tool run logging is non-critical
  }
}
