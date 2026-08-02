import { useState, useEffect, useCallback } from 'react';
import type { WorkItem } from '../shared/types';
import { api } from '../shared';

const TYPE_LABEL: Record<string, string> = {
  autonomous_run: 'Ejecución autónoma',
  event_triggered: 'Evento',
  decision_execution: 'Decisión aprobada',
};

const STATUS_ORDER = ['pending', 'in_progress', 'done', 'failed', 'cancelled'] as const;

const STAGE_COLOR: Record<string, string> = {
  pending:    'var(--amber)',
  in_progress:'var(--signal)',
  done:       'var(--good)',
  failed:     'var(--ember)',
  cancelled:  'var(--ink-faint)',
};

const STAGE_LABEL: Record<string, string> = {
  pending:    'Pendiente',
  in_progress:'En curso',
  done:       'Hecho',
  failed:     'Fallido',
  cancelled:  'Cancelado',
};

function FlowBar({ items }: { items: WorkItem[] }) {
  const counts = STATUS_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = items.filter((i) => i.status === s).length;
    return acc;
  }, {});
  const total = items.length || 1;

  return (
    <div style={{ display: 'flex', gap: 4, height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 16 }}>
      {STATUS_ORDER.map((s) => {
        const w = (counts[s] / total) * 100;
        if (w === 0) return null;
        return (
          <div
            key={s}
            title={`${STAGE_LABEL[s]}: ${counts[s]}`}
            style={{ width: `${w}%`, background: STAGE_COLOR[s], borderRadius: 3, transition: 'width 0.4s ease' }}
          />
        );
      })}
    </div>
  );
}

function WorkCard({ item }: { item: WorkItem }) {
  const age = Math.floor((Date.now() - new Date(item.created_at).getTime()) / 60000);
  const ageLabel = age < 60 ? `${age}m` : `${Math.floor(age / 60)}h ${age % 60}m`;

  return (
    <div style={{
      padding: '10px 12px',
      marginBottom: 8,
      background: 'var(--surface)',
      border: `1px solid ${STAGE_COLOR[item.status]}33`,
      borderLeft: `3px solid ${STAGE_COLOR[item.status]}`,
      borderRadius: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace', flexShrink: 0 }}>
          #{item.id} · P{item.priority}
        </div>
        <div style={{
          fontSize: 10, padding: '2px 6px', borderRadius: 3,
          background: `${STAGE_COLOR[item.status]}22`, color: STAGE_COLOR[item.status],
          fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.04em',
        }}>
          {STAGE_LABEL[item.status]}
        </div>
      </div>

      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>
        {TYPE_LABEL[item.type] || item.type}
      </div>

      {item.status === 'in_progress' && (
        <div style={{ marginTop: 6, height: 2, background: 'var(--surface-alt)', borderRadius: 1, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: '40%',
            background: 'var(--signal)',
            borderRadius: 1,
            animation: 'hk-scan 1.8s ease-in-out infinite',
          }} />
        </div>
      )}

      {item.result && item.status !== 'in_progress' && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-faint)', lineHeight: 1.4, maxHeight: 48, overflow: 'hidden' }}>
          {item.result.slice(0, 140)}{item.result.length > 140 ? '…' : ''}
        </div>
      )}

      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace' }}>
        {ageLabel} atrás
        {item.retry_count > 0 && ` · ${item.retry_count} reintentos`}
      </div>
    </div>
  );
}

export function PipelinePanel({ agentId }: { agentId: number | undefined }) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    const data = await api.workItems(agentId);
    if (data) setItems(data);
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (!agentId) return <div className="hk-feed-empty">Sin agente asignado.</div>;
  if (loading && items.length === 0) return <div className="hk-feed-empty">Cargando pipeline…</div>;
  if (items.length === 0) return (
    <div className="hk-feed-empty">
      Pipeline vacío. El agente no tiene tareas registradas aún.
    </div>
  );

  const active = items.filter((i) => i.status === 'in_progress');
  const pending = items.filter((i) => i.status === 'pending');
  const rest = items.filter((i) => i.status !== 'in_progress' && i.status !== 'pending');

  return (
    <div>
      <FlowBar items={items} />

      <div style={{ display: 'flex', gap: 12, fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', marginBottom: 14 }}>
        {STATUS_ORDER.map((s) => {
          const n = items.filter((i) => i.status === s).length;
          if (!n) return null;
          return (
            <span key={s} style={{ color: STAGE_COLOR[s] }}>
              {n} {STAGE_LABEL[s].toLowerCase()}
            </span>
          );
        })}
      </div>

      {active.map((i) => <WorkCard key={i.id} item={i} />)}
      {pending.map((i) => <WorkCard key={i.id} item={i} />)}
      {rest.map((i) => <WorkCard key={i.id} item={i} />)}
    </div>
  );
}
