import { useState, useEffect } from 'react';
import { api } from '../shared';
import { Panel, Led } from '../shared/ui';
import type { RuntimeStatus, MetricsSummary } from '../shared/types';

// Fase 8 — Panel de Sistema de la Sala de Máquinas (Hermes = runtime/kernel).
// Solo datos reales de GET /api/runtime/status y GET /api/metrics/summary. Sin datos
// inventados ni endpoints nuevos.

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'ember' | 'signal' | 'dim' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'ember' ? 'var(--ember)' : tone === 'signal' ? 'var(--signal)' : 'var(--ink)';
  return (
    <Panel className="hk-statcard">
      <div className="hk-statcard-value" style={{ color }}>{value}</div>
      <div className="hk-statcard-label">{label}</div>
    </Panel>
  );
}

export function SystemStatusPanel() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      api.runtimeStatus().then((d) => { if (d) setStatus(d); });
      api.metricsSummary().then((d) => { if (d) setMetrics(d); }).finally(() => setLoading(false));
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  if (loading && !status && !metrics) return <div className="hk-feed-empty">Cargando estado del sistema…</div>;

  const running = status?.running ?? false;
  const activeAgents = status?.activeAgents ?? [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}>
        <Led state={running ? 'on' : 'idle'} />
        <span style={{ color: running ? 'var(--good)' : 'var(--ink-faint)' }}>
          Runtime {running ? 'activo' : 'detenido'}
        </span>
      </div>

      <div className="hk-statgrid">
        <StatCard label="Agentes activos" value={activeAgents.length} tone={activeAgents.length > 0 ? 'good' : 'dim'} />
        <StatCard label="Eventos en cola" value={status?.queuedEvents ?? 0} tone={(status?.queuedEvents ?? 0) > 0 ? 'signal' : 'dim'} />
        <StatCard label="Coste IA hoy" value={metrics ? `$${metrics.ai_cost_today_usd}` : '—'} tone={(metrics?.ai_cost_today_usd ?? 0) > 4 ? 'ember' : 'dim'} />
        <StatCard label="Mensajes hoy" value={metrics?.messages_today ?? 0} tone="dim" />
        <StatCard label="Decisiones pendientes" value={metrics?.pending_decisions ?? 0} tone={(metrics?.pending_decisions ?? 0) > 0 ? 'ember' : 'dim'} />
        <StatCard label="Urgentes" value={metrics?.urgent_decisions ?? 0} tone={(metrics?.urgent_decisions ?? 0) > 0 ? 'ember' : 'dim'} />
      </div>

      {activeAgents.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="hk-eyebrow" style={{ marginBottom: 8 }}>AGENTES EN EJECUCIÓN</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeAgents.map((name) => (
              <div key={name} style={{ padding: '6px 10px', background: 'var(--signal-faint)', border: '1px solid var(--signal)', borderRadius: 4, fontSize: 11, color: 'var(--signal)', fontFamily: 'IBM Plex Mono, monospace' }}>
                {name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
