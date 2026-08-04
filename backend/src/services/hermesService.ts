import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { run, get, all } from '../db/init.js';
import { createDecision } from './decisionService.js';
import bus from '../config/eventBus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../');
const EXEC_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 1_000_000;

export interface ExecRun {
  id: number;
  decision_id: number | null;
  requested_by_agent_id: number | null;
  command: string;
  cwd: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'done' | 'failed';
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
  created_at: string;
  executed_at: string | null;
}

const SELECT = 'SELECT id, decision_id, requested_by_agent_id, command, cwd, status, exit_code, stdout, stderr, created_at, executed_at FROM exec_runs';

export async function listExecRuns(limit = 30): Promise<ExecRun[]> {
  return all<ExecRun>(`${SELECT} ORDER BY id DESC LIMIT ?`, [limit]);
}

// Nunca ejecuta nada — registra el comando y crea la Decision que Jorge debe aprobar.
export async function requestExec(params: { agentId?: number; command: string; cwd?: string; reason?: string }): Promise<{ execRunId: number; decisionId: number }> {
  const command = params.command.trim();
  if (!command) throw new Error('command vacío');

  const execResult = await run(
    `INSERT INTO exec_runs (requested_by_agent_id, command, cwd, status) VALUES (?, ?, ?, 'pending')`,
    [params.agentId ?? null, command, params.cwd ?? null]
  );
  const execRunId = execResult.lastID;

  const decision = await createDecision({
    agent_id: params.agentId ?? null,
    entity_type: 'system_exec',
    entity_id: execRunId,
    title: `Ejecutar comando — ${command.slice(0, 60)}`,
    description: command,
    reasoning: params.reason || 'Comando de terminal solicitado a Hermes.',
    risk_level: 'medium',
  });

  await run(`UPDATE exec_runs SET decision_id = ? WHERE id = ?`, [decision.id, execRunId]);
  bus.publish({ type: 'decision.created', from: 'Hermes', payload: { title: decision.title, agentId: params.agentId ?? null } });

  return { execRunId, decisionId: decision.id };
}

// Se llama SOLO cuando Jorge aprueba la Decision vinculada — es el único punto
// del sistema donde un comando de terminal se ejecuta de verdad.
export async function runApprovedExec(execRunId: number): Promise<void> {
  const execRun = await get<ExecRun>(`${SELECT} WHERE id = ?`, [execRunId]);
  if (!execRun || execRun.status !== 'pending') return;

  const cwd = execRun.cwd ? path.resolve(REPO_ROOT, execRun.cwd) : REPO_ROOT;

  await new Promise<void>((resolve) => {
    execFile('/bin/sh', ['-c', execRun.command], { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, async (error, stdout, stderr) => {
      const exitCode = error && typeof (error as any).code === 'number' ? (error as any).code : error ? 1 : 0;
      await run(
        `UPDATE exec_runs SET status = ?, exit_code = ?, stdout = ?, stderr = ?, executed_at = datetime('now') WHERE id = ?`,
        [error ? 'failed' : 'done', exitCode, stdout?.slice(0, 20_000) ?? '', stderr?.slice(0, 20_000) ?? '', execRunId]
      );
      await run(
        `INSERT INTO audit_logs (action, entity, entity_id, details) VALUES ('exec', 'exec_runs', ?, ?)`,
        [execRunId, JSON.stringify({ command: execRun.command, cwd, ok: !error, exitCode })]
      );
      bus.publish({ type: 'agent.task.done', from: 'Hermes', payload: { taskType: 'exec', response: error ? `Error: ${error.message}` : (stdout || '(sin salida)').slice(0, 200) } });
      console.log(`[HERMES] Comando ${execRunId} ${error ? 'FALLÓ' : 'completado'}: ${execRun.command}`);
      resolve();
    });
  });
}

export async function rejectExec(execRunId: number): Promise<void> {
  await run(`UPDATE exec_runs SET status = 'rejected', executed_at = datetime('now') WHERE id = ? AND status = 'pending'`, [execRunId]);
}
