import { useState, useEffect, useCallback } from 'react';
import { api } from '../shared/api';
import { Panel, Badge } from '../shared/ui';
import type { Venture, WsEnvelope, HokageCommandTrace, VentureBudget, AuditEvent } from '../shared/types';

// Consola de gestión de Hokage (Fase 10). Reutiliza los endpoints de F5/F7/F9 — NO duplica
// lógica de negocio. El estado real vive en el backend; esta vista solo lo muestra y despacha.

const TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled']);

type Tone = 'good' | 'signal' | 'dim' | 'amber' | 'ember';
function statusTone(s: string): Tone {
  if (s === 'completed') return 'good';
  if (s === 'active' || s === 'dispatched' || s === 'planning') return 'signal';
  if (s === 'partial') return 'amber';
  if (s === 'failed' || s === 'blocked') return 'ember';
  return 'dim';
}
const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(4)}`);

export function HokageConsoleView({ ventures, liveEvents }: { ventures: Venture[]; liveEvents: WsEnvelope[] }) {
  const [text, setText] = useState('');
  const [ventureId, setVentureId] = useState<number | ''>(ventures[0]?.id ?? '');
  const [commands, setCommands] = useState<Array<{ id: number; text: string }>>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<HokageCommandTrace | null>(null);
  const [budget, setBudget] = useState<VentureBudget | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [auditType, setAuditType] = useState('');
  const [busy, setBusy] = useState(false);
  const evTick = liveEvents.length; // cambia con cada evento WS → dispara refrescos en vivo

  const loadDetail = useCallback(async (id: number) => {
    const d = await api.hokageCommandDetail(id);
    if (d) setDetail(d);
  }, []);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await api.hokageCommand(text.trim(), ventureId === '' ? null : Number(ventureId));
    setBusy(false);
    if (r) {
      setCommands((prev) => [{ id: r.command.id, text: r.command.text }, ...prev.filter((c) => c.id !== r.command.id)]);
      setSelected(r.command.id);
      setText('');
    }
  };

  const cancel = async () => {
    if (selected == null) return;
    if (!window.confirm('¿Cancelar esta orden?\n\nLas tareas ya en vuelo pueden terminar, pero su resultado se ignorará. No se aborta una llamada al LLM en curso.')) return;
    const r = await api.cancelHokageCommand(selected);
    if (r) loadDetail(selected);
  };

  useEffect(() => { if (selected != null) loadDetail(selected); }, [selected, loadDetail, evTick]);

  // Fallback ligero mientras la orden no es terminal (el WS es la vía principal; esto es red de seguridad).
  useEffect(() => {
    if (selected == null || (detail && TERMINAL.has(detail.command.status))) return;
    const t = setInterval(() => { if (selected != null) loadDetail(selected); }, 5000);
    return () => clearInterval(t);
  }, [selected, detail?.command.status, loadDetail]);

  useEffect(() => {
    if (ventureId === '') { setBudget(null); return; }
    api.ventureBudget(Number(ventureId)).then(setBudget);
  }, [ventureId, evTick]);

  const loadAudit = useCallback(() => {
    api.auditEvents({
      venture_id: ventureId === '' ? undefined : Number(ventureId),
      type: auditType || undefined,
      limit: 60,
    }).then((e) => setAudit(e ?? []));
  }, [ventureId, auditType]);
  useEffect(() => { loadAudit(); }, [loadAudit, evTick]);

  const cmd = detail?.command;
  const cancellable = cmd && (cmd.status === 'active' || cmd.status === 'planning');

  return (
    <div style={{ display: 'grid', gap: 16, padding: 4 }}>
      {/* ── Orden nueva + presupuesto ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <Panel>
          <div style={{ fontFamily: 'Chakra Petch, sans-serif', color: 'var(--ember)', marginBottom: 8 }}>NUEVA ORDEN</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Dile a Hokage qué objetivo perseguir… (p. ej. «Investiga si el nicho de posters minimalistas de gatos merece la pena»)"
            rows={3}
            style={{ width: '100%', background: 'var(--void)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 6, padding: 8, fontFamily: 'IBM Plex Mono, monospace', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <select value={ventureId} onChange={(e) => setVentureId(e.target.value === '' ? '' : Number(e.target.value))}
              style={{ background: 'var(--void)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 8px' }}>
              <option value="">Sin venture</option>
              {ventures.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button className="hk-btn hk-btn--sm" onClick={submit} disabled={busy || !text.trim()}>
              {busy ? 'Despachando…' : 'Ejecutar orden'}
            </button>
          </div>
        </Panel>

        <Panel>
          <div style={{ fontFamily: 'Chakra Petch, sans-serif', color: 'var(--signal)', marginBottom: 8 }}>PRESUPUESTO</div>
          {!budget ? (
            <div style={{ color: 'var(--ink-dim)' }}>Selecciona una venture.</div>
          ) : !budget.capped ? (
            <div style={{ color: 'var(--ink-dim)' }}>Sin tope · real gastado {usd(budget.real)}</div>
          ) : (
            <div style={{ display: 'grid', gap: 4, fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
              <BudgetRow k="Asignado" v={usd(budget.allocated)} />
              <BudgetRow k="Reservado" v={usd(budget.reserved)} />
              <BudgetRow k="Real" v={usd(budget.real)} />
              <BudgetRow k="Disponible" v={usd(budget.available)} accent />
            </div>
          )}
        </Panel>
      </div>

      {/* ── Órdenes de esta sesión + detalle ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        <Panel>
          <div style={{ fontFamily: 'Chakra Petch, sans-serif', color: 'var(--ember)', marginBottom: 8 }}>ÓRDENES</div>
          {commands.length === 0 ? (
            <div style={{ color: 'var(--ink-dim)' }}>Aún no has lanzado ninguna orden en esta sesión.</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {commands.map((c) => (
                <div key={c.id} onClick={() => setSelected(c.id)}
                  style={{ cursor: 'pointer', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line)', background: selected === c.id ? 'var(--panel-raised)' : 'transparent' }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>#{c.id}</div>
                  <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.text}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          {!cmd ? (
            <div style={{ color: 'var(--ink-dim)' }}>Selecciona o lanza una orden para ver su plan, tareas y resultado.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'Chakra Petch, sans-serif' }}>Orden #{cmd.id}</span>
                <Badge tone={statusTone(cmd.status)}>{cmd.status}</Badge>
                {cmd.replan_count > 0 && <Badge tone="amber">replan ×{cmd.replan_count}</Badge>}
                <span style={{ flex: 1 }} />
                <button className="hk-btn hk-btn--sm" onClick={() => loadDetail(cmd.id)}>Refrescar</button>
                {cancellable && <button className="hk-btn hk-btn--sm hk-btn--ghost-danger" onClick={cancel}>Cancelar</button>}
              </div>
              <div style={{ color: 'var(--ink-dim)', fontSize: 13 }}>{cmd.text}</div>

              <div>
                <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 4 }}>TAREAS</div>
                <div style={{ display: 'grid', gap: 4 }}>
                  {(detail?.tasks ?? []).map((t) => (
                    <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '28px 110px 1fr auto', gap: 8, alignItems: 'center', fontSize: 13, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--line)' }}>
                      <span style={{ color: 'var(--ink-dim)' }}>F{t.phase}</span>
                      <span style={{ color: 'var(--signal)' }}>{t.role}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}{t.error ? ` — ${t.error}` : t.result ? ` → ${t.result.slice(0, 80)}` : ''}
                      </span>
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                    </div>
                  ))}
                  {(detail?.tasks ?? []).length === 0 && <div style={{ color: 'var(--ink-dim)' }}>Sin tareas (no se pudo planificar).</div>}
                </div>
              </div>

              {cmd.result_summary && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 4 }}>BRIEFING</div>
                  <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, background: 'var(--void)', border: '1px solid var(--line)', borderRadius: 6, padding: 8, margin: 0 }}>{cmd.result_summary}</pre>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Auditoría ── */}
      <Panel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontFamily: 'Chakra Petch, sans-serif', color: 'var(--signal)' }}>AUDITORÍA</span>
          <input value={auditType} onChange={(e) => setAuditType(e.target.value)} placeholder="tipo (p.ej. budget.reserved)"
            style={{ background: 'var(--void)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', fontSize: 12 }} />
          <span style={{ color: 'var(--ink-dim)', fontSize: 12 }}>
            {ventureId === '' ? 'todas las ventures' : `venture #${ventureId}`} · {audit.length} eventos
          </span>
          <span style={{ flex: 1 }} />
          <button className="hk-btn hk-btn--sm" onClick={loadAudit}>Refrescar</button>
        </div>
        <div style={{ display: 'grid', gap: 2, maxHeight: 260, overflowY: 'auto', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}>
          {audit.length === 0 ? (
            <div style={{ color: 'var(--ink-dim)' }}>Sin eventos.</div>
          ) : audit.map((e) => (
            <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '150px 190px 1fr', gap: 8, padding: '2px 4px', borderBottom: '1px solid var(--line)' }}>
              <span style={{ color: 'var(--ink-dim)' }}>{e.created_at}</span>
              <span style={{ color: 'var(--signal)' }}>{e.type}</span>
              <span style={{ color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.command_id ? `cmd#${e.command_id} ` : ''}{e.task_id ? `task#${e.task_id} ` : ''}{e.agent_id ? `agent#${e.agent_id} ` : ''}· {e.from_actor}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function BudgetRow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--ink-dim)' }}>{k}</span>
      <span style={{ color: accent ? 'var(--good)' : 'var(--ink)' }}>{v}</span>
    </div>
  );
}
