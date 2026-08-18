import { useState, useEffect } from 'react';
import { api } from '../shared';
import { Panel } from '../shared/ui';
import type { Venture, VentureBudget, MetricsSummary } from '../shared/types';

// Fase 9 — Panel de Finanzas (Banco). Salud financiera interna: coste de IA y presupuesto
// por venture. Solo datos reales de /api/ventures, /api/ventures/:id/budget y
// /api/metrics/summary. NO refleja ventas externas (eso es Tienda, bloqueado).

function money(n: number): string {
  if (!isFinite(n)) return '∞';
  return `$${n.toFixed(2)}`;
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'ember' | 'signal' | 'dim' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'ember' ? 'var(--ember)' : tone === 'signal' ? 'var(--signal)' : 'var(--ink)';
  return (
    <Panel className="hk-statcard">
      <div className="hk-statcard-value" style={{ color }}>{value}</div>
      <div className="hk-statcard-label">{label}</div>
    </Panel>
  );
}

function VentureFinanceCard({ venture, budget }: { venture: Venture; budget: VentureBudget | null }) {
  const capped = budget?.capped ?? false;
  const spent = budget?.real ?? 0;
  const allocated = budget?.allocated ?? 0;
  const available = budget?.available ?? 0;
  const pct = capped && allocated > 0 ? Math.min(100, Math.round((spent / allocated) * 100)) : 0;
  const barTone = pct >= 90 ? 'var(--ember)' : pct >= 60 ? 'var(--amber)' : 'var(--good)';

  return (
    <Panel className="hk-mb-16">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{venture.name}</span>
        <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace' }}>
          {venture.status.toUpperCase()}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', marginBottom: capped ? 10 : 0 }}>
        <span style={{ color: 'var(--ink-dim)' }}>Gastado <b style={{ color: 'var(--ink)' }}>{money(spent)}</b></span>
        <span style={{ color: 'var(--ink-dim)' }}>Asignado <b style={{ color: 'var(--ink)' }}>{capped ? money(allocated) : 'sin tope'}</b></span>
        {capped && <span style={{ color: 'var(--ink-dim)' }}>Disponible <b style={{ color: available <= 0 ? 'var(--ember)' : 'var(--good)' }}>{money(available)}</b></span>}
      </div>
      {capped && (
        <div style={{ height: 6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: barTone, transition: 'width 0.3s' }} />
        </div>
      )}
    </Panel>
  );
}

export function BankPanel() {
  const [ventures, setVentures] = useState<Venture[]>([]);
  const [budgets, setBudgets] = useState<Record<number, VentureBudget>>({});
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [vs, m] = await Promise.all([api.ventures(), api.metricsSummary()]);
      if (m) setMetrics(m);
      if (vs) {
        setVentures(vs);
        const entries = await Promise.all(
          vs.map(async (v) => [v.id, await api.ventureBudget(v.id)] as const)
        );
        const map: Record<number, VentureBudget> = {};
        for (const [id, b] of entries) if (b) map[id] = b;
        setBudgets(map);
      }
      setLoading(false);
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  if (loading && ventures.length === 0 && !metrics) {
    return <div className="hk-feed-empty">Cargando finanzas…</div>;
  }

  const totalSpent = Object.values(budgets).reduce((sum, b) => sum + (b.real ?? 0), 0);
  const totalAllocated = Object.values(budgets).reduce((sum, b) => sum + (b.capped ? b.allocated : 0), 0);

  return (
    <div>
      <div className="hk-statgrid">
        <StatCard label="Coste IA hoy" value={metrics ? money(metrics.ai_cost_today_usd) : '—'} tone={(metrics?.ai_cost_today_usd ?? 0) > 4 ? 'ember' : 'dim'} />
        <StatCard label="Gasto total ventures" value={money(totalSpent)} tone="signal" />
        <StatCard label="Presupuesto asignado" value={totalAllocated > 0 ? money(totalAllocated) : 'sin tope'} tone="dim" />
        <StatCard label="Ventures activas" value={ventures.filter((v) => v.status === 'active').length} tone={ventures.some((v) => v.status === 'active') ? 'good' : 'dim'} />
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="hk-eyebrow" style={{ marginBottom: 8 }}>PRESUPUESTO POR VENTURE</div>
        {ventures.length === 0 ? (
          <div className="hk-feed-empty">Sin ventures todavía.</div>
        ) : (
          ventures.map((v) => <VentureFinanceCard key={v.id} venture={v} budget={budgets[v.id] ?? null} />)
        )}
      </div>
    </div>
  );
}
