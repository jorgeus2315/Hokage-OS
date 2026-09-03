import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../shared';
import { Panel } from '../shared/ui';
import type { Venture, VentureBudget, MetricsSummary, Sale } from '../shared/types';
import { useAppData } from '../hooks/useAppData';

// Fase 4.4 — Panel de Finanzas (Banco) con revenue en tiempo real
// Carga inicial desde /api/ventures/:id/sales (BD = fuente de verdad)
// Escucha sale.received por WebSocket para actualizaciones incrementales
// Aislamiento por venture: cada sala de finanzas muestra SOLO su venture

function money(n: number): string {
  if (!isFinite(n)) return '∞';
  return `$${n.toFixed(2)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  } catch {
    return iso;
  }
}

interface StatCardProps {
  label: string;
  value: string | number;
  tone?: 'good' | 'ember' | 'signal' | 'dim';
}

function StatCard({ label, value, tone }: StatCardProps) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'ember' ? 'var(--ember)' : tone === 'signal' ? 'var(--signal)' : 'var(--ink)';
  return (
    <Panel className="hk-statcard">
      <div className="hk-statcard-value" style={{ color }}>{value}</div>
      <div className="hk-statcard-label">{label}</div>
    </Panel>
  );
}

interface VentureFinanceCardProps {
  venture: Venture;
  budget: VentureBudget | null;
}

function VentureFinanceCard({ venture, budget }: VentureFinanceCardProps) {
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

interface SaleRowProps {
  sale: Sale;
}

function SaleRow({ sale }: SaleRowProps) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '8px 12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: 'var(--ink-faint)' }}>
        {sale.receipt_id}
      </td>
      <td style={{ padding: '8px 12px', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, textAlign: 'right', color: 'var(--good)' }}>
        {money(sale.total_usd)} {sale.currency}
      </td>
      <td style={{ padding: '8px 12px', fontSize: 11, textAlign: 'center', color: sale.status === 'paid' ? 'var(--good)' : 'var(--amber)' }}>
        {sale.status}
      </td>
      <td style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--ink-dim)' }}>
        {formatDate(sale.detected_at)}
      </td>
    </tr>
  );
}

interface BankPanelProps {
  ventureId?: number | null;
}

export function BankPanel({ ventureId }: BankPanelProps) {
  const { liveEvents, ventures } = useAppData();
  const [sales, setSales] = useState<Sale[]>([]);
  const [totalSales, setTotalSales] = useState(0);
  const [revenueUsd, setRevenueUsd] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<Record<number, VentureBudget>>({});
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const receiptIdsRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef(false);

  // Determinar ventureId: prop > primer venture activa > null
  const targetVentureId = ventureId ?? ventures.find(v => v.status === 'active')?.id ?? null;

  // Cargar ventas iniciales desde BD (fuente de verdad)
  const loadSales = useCallback(async () => {
    if (!targetVentureId) {
      setLoading(false);
      setError(null);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await api.venturesSales(targetVentureId, 100, 0);
      if (data) {
        const newSales = data.sales ?? [];
        setSales(newSales);
        setTotalSales(data.total ?? 0);
        setRevenueUsd(data.revenue_usd ?? 0);
        // Poblar Set de receipt_ids para deduplicación en tiempo real
        receiptIdsRef.current = new Set(newSales.map(s => s.receipt_id));
      }
    } catch (e: any) {
      console.error('[BankPanel] Error cargando ventas:', e);
      setError('Error cargando ventas');
    } finally {
      setLoading(false);
      initialLoadDoneRef.current = true;
    }
  }, [targetVentureId]);

  // Cargar presupuestos y métricas (existente)
  const loadFinanceData = useCallback(async () => {
    const vs = await api.ventures();
    if (vs) {
      const entries = await Promise.all(
        vs.map(async (v) => [v.id, await api.ventureBudget(v.id)] as const)
      );
      const map: Record<number, VentureBudget> = {};
      for (const [id, b] of entries) if (b) map[id] = b;
      setBudgets(map);
    }
    const m = await api.metricsSummary();
    if (m) setMetrics(m);
  }, []);

  // Carga inicial
  useEffect(() => {
    loadSales();
    loadFinanceData();
  }, [loadSales, loadFinanceData]);

  // Actualización periódica de métricas/presupuestos (no ventas — WebSocket cubre delta)
  useEffect(() => {
    const t = setInterval(loadFinanceData, 60_000);
    return () => clearInterval(t);
  }, [loadFinanceData]);

  // Escuchar eventos sale.received por WebSocket para actualizaciones incrementales
  useEffect(() => {
    if (!initialLoadDoneRef.current || !targetVentureId) return;

    const handleSaleReceived = (event: { type: string; payload?: any; from?: string }) => {
      if (event.type !== 'sale.received' || !event.payload) return;

      const payload = event.payload;
      // Filtrar por ventureId para aislamiento
      if (payload.ventureId !== targetVentureId) return;

      const receiptId = payload.receiptId ?? payload.receipt_id;
      if (!receiptId) return;

      // Deduplicación: solo procesar si NO existe ya
      if (receiptIdsRef.current.has(receiptId)) return;
      receiptIdsRef.current.add(receiptId);

      // Añadir venta nueva al inicio de la lista (más reciente primero)
      const newSale: Sale = {
        id: payload.id ?? Date.now(), // fallback si el backend no envía id
        venture_id: targetVentureId,
        receipt_id: receiptId,
        total_usd: payload.total_usd ?? payload.total ?? 0,
        currency: payload.currency ?? 'USD',
        status: payload.status ?? 'paid',
        created_at: payload.createdAt ?? payload.created_at ?? new Date().toISOString(),
        detected_at: payload.detectedAt ?? payload.detected_at ?? new Date().toISOString(),
      };

      setSales(prev => [newSale, ...prev].slice(0, 100));
      setTotalSales(prev => prev + 1);
      setRevenueUsd(prev => prev + (newSale.total_usd ?? 0));
    };

    // Suscribirse a eventos del bus que llegan via WebSocket
    // useAppData ya expone liveEvents, pero necesitamos el handler en tiempo real
    // El evento llega como { type: 'agent.event', data: WsEvent }
    // Ver useAppData.handleWsEvent — 'agent.event' con inner.type === 'sale.received'

    // Como liveEvents ya incluye los eventos, podemos escuchar cambios en él
    // Pero mejor: escuchar directamente desde useWebSocket. Usemos un enfoque híbrido:
    // El hook useAppData ya procesa 'agent.event' → liveEvents. Aquí escuchamos liveEvents.

    // Enfoque: useEffect que observa liveEvents y filtra sale.received
    // (ya filtrado por targetVentureId arriba)
    const latestEvent = liveEvents[0];
    if (latestEvent && latestEvent.type === 'sale.received') {
      handleSaleReceived(latestEvent);
    }
  }, [liveEvents, targetVentureId]);

  // Renderizado
  if (loading && sales.length === 0 && !error) {
    return <div className="hk-feed-empty">Cargando finanzas…</div>;
  }

  if (error) {
    return (
      <Panel>
        <div style={{ color: 'var(--ember)', padding: 16, textAlign: 'center' }}>
          {error}
        </div>
      </Panel>
    );
  }

  if (!targetVentureId) {
    return (
      <Panel>
        <div className="hk-feed-empty" style={{ textAlign: 'center', padding: 24 }}>
          No hay venture activa. Crea una venture para ver sus finanzas.
        </div>
      </Panel>
    );
  }

  const currentVenture = ventures.find(v => v.id === targetVentureId);
  const currentBudget = currentVenture ? budgets[currentVenture.id] ?? null : null;

  const totalSpent = Object.values(budgets).reduce((sum, b) => sum + (b.real ?? 0), 0);

  return (
    <div>
      {/* Header con métricas clave */}
      <div className="hk-statgrid">
        <StatCard label="Revenue total" value={money(revenueUsd)} tone="good" />
        <StatCard label="Ventas totales" value={totalSales} tone="signal" />
        <StatCard label="Coste IA hoy" value={metrics ? money(metrics.ai_cost_today_usd) : '—'} tone={(metrics?.ai_cost_today_usd ?? 0) > 4 ? 'ember' : 'dim'} />
        <StatCard label="Gasto total ventures" value={money(totalSpent)} tone="signal" />
      </div>

      {/* Venture actual — presupuesto */}
      {currentVenture && (
        <div style={{ marginTop: 16 }}>
          <div className="hk-eyebrow" style={{ marginBottom: 8 }}>
            VENTURE ACTIVA: {currentVenture.name.toUpperCase()}
          </div>
          <VentureFinanceCard venture={currentVenture} budget={currentBudget} />
        </div>
      )}

      {/* Tabla de ventas recientes */}
      <div style={{ marginTop: 16 }}>
        <div className="hk-eyebrow" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          VENTAS RECIENTES
          <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace' }}>
            {sales.length > 0 ? `Mostrando ${sales.length} de ${totalSales}` : 'Sin ventas'}
          </span>
        </div>

        {sales.length === 0 ? (
          <Panel>
            <div className="hk-feed-empty" style={{ textAlign: 'center', padding: 24 }}>
              No hay ventas registradas todavía.
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-faint)' }}>
                El agente Finanzas detecta ventas automáticamente cada 60 min.
              </div>
            </div>
          </Panel>
        ) : (
          <Panel>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-faint)', fontSize: 10, textTransform: 'uppercase' }}>
                      Receipt ID
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--ink-faint)', fontSize: 10, textTransform: 'uppercase' }}>
                      Importe
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: 'var(--ink-faint)', fontSize: 10, textTransform: 'uppercase' }}>
                      Estado
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-faint)', fontSize: 10, textTransform: 'uppercase' }}>
                      Detectada
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map(sale => (
                    <SaleRow key={sale.id} sale={sale} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>

      {/* Resumen global de todas las ventures (existente) */}
      <div style={{ marginTop: 24 }}>
        <div className="hk-eyebrow" style={{ marginBottom: 8 }}>PRESUPUESTO GLOBAL</div>
        {ventures.length === 0 ? (
          <div className="hk-feed-empty">Sin ventures todavía.</div>
        ) : (
          ventures.map((v) => <VentureFinanceCard key={v.id} venture={v} budget={budgets[v.id] ?? null} />)
        )}
      </div>
    </div>
  );
}