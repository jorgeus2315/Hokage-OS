import { useState, useEffect, useCallback } from 'react';
import type { ContentItem, MarketItem } from '../shared/types';
import { api } from '../shared';

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function ContentCard({ item }: { item: ContentItem }) {
  return (
    <div style={{
      padding: '10px 12px',
      marginBottom: 8,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: '3px solid var(--signal)',
      borderRadius: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--signal)', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0.04em' }}>
          {item.platform.toUpperCase()} · {item.status.toUpperCase()}
        </span>
        <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace' }}>
          {timeAgo(item.created_at)}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.4 }}>{item.body}</div>
    </div>
  );
}

function MarketCard({ item }: { item: MarketItem }) {
  let description = '';
  try { description = JSON.parse(item.payload)?.description ?? ''; } catch { /* payload no es JSON */ }
  return (
    <div style={{
      padding: '10px 12px',
      marginBottom: 8,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: '3px solid var(--amber)',
      borderRadius: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber)' }}>{item.keyword}</span>
        <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace' }}>
          {timeAgo(item.created_at)}
        </span>
      </div>
      {description && <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.4 }}>{description}</div>}
    </div>
  );
}

// Fase 9: 'all' = tendencias + contenido (tab genérico Outputs). 'market' = solo tendencias
// (Laboratorio, solo lectura). 'content' = solo galería de contenido (Marketing).
export function OutputsPanel({ agentId, variant = 'all' }: { agentId: number | undefined; variant?: 'all' | 'market' | 'content' }) {
  const [content, setContent] = useState<ContentItem[]>([]);
  const [market, setMarket] = useState<MarketItem[]>([]);
  const [loading, setLoading] = useState(false);
  const showMarket = variant !== 'content';
  const showContent = variant !== 'market';

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    const data = await api.agentOutputs(agentId);
    if (data) {
      setContent(data.content);
      setMarket(data.market);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const marketVisible = showMarket ? market : [];
  const contentVisible = showContent ? content : [];
  const emptyMsg = variant === 'market'
    ? 'Sin tendencias todavía. Aparecerán aquí en cuanto el agente detecte una.'
    : variant === 'content'
    ? 'Sin contenido todavía. Aparecerá aquí en cuanto el agente cree una pieza.'
    : 'Sin outputs todavía. Aparecerán aquí en cuanto el agente detecte una tendencia o cree contenido.';

  if (!agentId) return <div className="hk-feed-empty">Sin agente asignado.</div>;
  if (loading && marketVisible.length === 0 && contentVisible.length === 0) {
    return <div className="hk-feed-empty">Cargando…</div>;
  }
  if (marketVisible.length === 0 && contentVisible.length === 0) {
    return <div className="hk-feed-empty">{emptyMsg}</div>;
  }

  return (
    <div>
      {marketVisible.length > 0 && (
        <div style={{ marginBottom: contentVisible.length > 0 ? 20 : 0 }}>
          <div className="hk-eyebrow" style={{ marginBottom: 8, color: 'var(--amber)' }}>
            TENDENCIAS DETECTADAS · {marketVisible.length}
          </div>
          {marketVisible.map((m) => <MarketCard key={m.id} item={m} />)}
        </div>
      )}
      {contentVisible.length > 0 && (
        <div>
          <div className="hk-eyebrow" style={{ marginBottom: 8, color: 'var(--signal)' }}>
            CONTENIDO CREADO · {contentVisible.length}
          </div>
          {contentVisible.map((c) => <ContentCard key={c.id} item={c} />)}
        </div>
      )}
    </div>
  );
}
