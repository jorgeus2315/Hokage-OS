import { useState, useEffect, useCallback } from 'react';
import type { ExecRun } from '../shared/types';
import { api } from '../shared';

const STATUS_COLOR: Record<ExecRun['status'], string> = {
  pending:  'var(--amber)',
  approved: 'var(--signal)',
  done:     'var(--good)',
  failed:   'var(--ember)',
  rejected: 'var(--ink-faint)',
};

const STATUS_LABEL: Record<ExecRun['status'], string> = {
  pending:  'ESPERANDO APROBACIÓN',
  approved: 'APROBADO',
  done:     'COMPLETADO',
  failed:   'FALLÓ',
  rejected: 'RECHAZADO',
};

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function ExecCard({ run }: { run: ExecRun }) {
  const color = STATUS_COLOR[run.status];
  const isPending = run.status === 'pending';
  return (
    <div style={{
      padding: '10px 12px',
      marginBottom: 8,
      background: 'var(--surface)',
      border: `1px solid ${color}33`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 }}>
        <span style={{
          fontSize: 10, padding: '2px 6px', borderRadius: 3,
          background: `${color}22`, color, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.04em',
          animation: isPending ? 'hk-scan 1.8s ease-in-out infinite' : 'none',
        }}>
          {STATUS_LABEL[run.status]}
        </span>
        <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace' }}>
          {timeAgo(run.created_at)}
        </span>
      </div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: 'var(--ink)', wordBreak: 'break-all' }}>
        <span style={{ color: 'var(--ink-faint)' }}>$ </span>{run.command}
      </div>
      {run.cwd && (
        <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2, fontFamily: 'IBM Plex Mono, monospace' }}>
          cwd: {run.cwd}
        </div>
      )}
      {(run.stdout || run.stderr) && (
        <div style={{
          marginTop: 8, padding: '8px 10px', background: '#000', borderRadius: 3,
          fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, lineHeight: 1.5,
          maxHeight: 160, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {run.stdout && <span style={{ color: 'var(--good)' }}>{run.stdout}</span>}
          {run.stderr && <span style={{ color: 'var(--ember)' }}>{run.stderr}</span>}
        </div>
      )}
      {run.exit_code !== null && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace' }}>
          exit code: {run.exit_code}
        </div>
      )}
    </div>
  );
}

export function TerminalPanel() {
  const [runs, setRuns] = useState<ExecRun[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.hermesRuns();
    if (data) setRuns(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && runs.length === 0) return <div className="hk-feed-empty">Cargando historial…</div>;

  return (
    <div>
      <div style={{
        fontSize: 10, color: 'var(--ink-faint)', marginBottom: 14, lineHeight: 1.5,
        fontFamily: 'IBM Plex Mono, monospace',
      }}>
        Pídele a Hermes algo desde el Chat. Ningún comando se ejecuta sin tu aprobación en Alertas.
      </div>
      {runs.length === 0 ? (
        <div className="hk-feed-empty">Sin comandos todavía.</div>
      ) : (
        runs.map((r) => <ExecCard key={r.id} run={r} />)
      )}
    </div>
  );
}
