import { useState, useEffect } from 'react';
import { api } from '../shared';
import { Panel } from '../shared/ui';

type AgentStats = {
  total_runs: number; successful_runs: number; failed_runs: number;
  success_rate: number | null; total_tokens: number; total_cost_usd: number;
  active_work_items: number; pending_work_items: number;
  pending_decisions: number; last_run_at: string | null;
};

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'ember' | 'signal' | 'dim' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'ember' ? 'var(--ember)' : tone === 'signal' ? 'var(--signal)' : 'var(--ink)';
  return (
    <Panel className="hk-statcard">
      <div className="hk-statcard-value" style={{ color }}>{value}</div>
      <div className="hk-statcard-label">{label}</div>
    </Panel>
  );
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function StatsPanel({ agentId }: { agentId: number | undefined }) {
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    api.agentStats(agentId).then((data) => {
      if (data) setStats(data);
      setLoading(false);
    });
    const t = setInterval(() => {
      api.agentStats(agentId).then((data) => { if (data) setStats(data); });
    }, 15_000);
    return () => clearInterval(t);
  }, [agentId]);

  if (!agentId) return <div className="hk-feed-empty">Sin agente asignado.</div>;
  if (loading && !stats) return <div className="hk-feed-empty">Cargando estadísticas…</div>;
  if (!stats) return <div className="hk-feed-empty">Sin datos todavía.</div>;

  const successTone = stats.success_rate === null ? 'dim' : stats.success_rate >= 80 ? 'good' : stats.success_rate >= 50 ? 'signal' : 'ember';

  return (
    <div>
      <div className="hk-statgrid">
        <StatCard label="Ejecuciones totales" value={stats.total_runs} />
        <StatCard label="Completadas" value={stats.successful_runs} tone="good" />
        <StatCard label="Fallidas" value={stats.failed_runs} tone={stats.failed_runs > 0 ? 'ember' : 'dim'} />
        <StatCard label="Tasa de éxito" value={stats.success_rate !== null ? `${stats.success_rate}%` : '—'} tone={successTone} />
        <StatCard label="Tokens usados" value={stats.total_tokens.toLocaleString()} tone="signal" />
        <StatCard label="Coste total" value={`$${stats.total_cost_usd}`} tone={stats.total_cost_usd > 4 ? 'ember' : 'dim'} />
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {stats.active_work_items > 0 && (
          <div style={{ padding: '6px 10px', background: 'var(--signal-faint, #00ccff11)', border: '1px solid var(--signal)', borderRadius: 4, fontSize: 11, color: 'var(--signal)', fontFamily: 'IBM Plex Mono, monospace' }}>
            {stats.active_work_items} tarea{stats.active_work_items > 1 ? 's' : ''} activa{stats.active_work_items > 1 ? 's' : ''}
          </div>
        )}
        {stats.pending_work_items > 0 && (
          <div style={{ padding: '6px 10px', background: 'var(--amber-faint, #ffcc0011)', border: '1px solid var(--amber)', borderRadius: 4, fontSize: 11, color: 'var(--amber)', fontFamily: 'IBM Plex Mono, monospace' }}>
            {stats.pending_work_items} en cola
          </div>
        )}
        {stats.pending_decisions > 0 && (
          <div style={{ padding: '6px 10px', background: 'var(--ember-faint, #e74c3c11)', border: '1px solid var(--ember)', borderRadius: 4, fontSize: 11, color: 'var(--ember)', fontFamily: 'IBM Plex Mono, monospace' }}>
            {stats.pending_decisions} decisión{stats.pending_decisions > 1 ? 'es' : ''} pendiente{stats.pending_decisions > 1 ? 's' : ''}
          </div>
        )}
        {stats.last_run_at && (
          <div style={{ padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11, color: 'var(--ink-dim)', fontFamily: 'IBM Plex Mono, monospace' }}>
            Última ejecución: {timeAgo(stats.last_run_at)}
          </div>
        )}
      </div>
    </div>
  );
}
