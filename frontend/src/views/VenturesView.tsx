import { useState, useEffect } from 'react';
import type { Venture, Automation } from '../shared/types';
import { api } from '../shared/api';
import { Panel, Led, Badge, Bar } from '../shared/ui';

const STATUS_TONE: Record<string, 'good' | 'signal' | 'amber' | 'dim'> = {
  active:  'good',
  scaling: 'signal',
  idea:    'amber',
  paused:  'amber',
  closed:  'dim',
};

const STATUS_LED: Record<string, 'on' | 'signal' | 'idle' | 'alert'> = {
  active:  'on',
  scaling: 'signal',
  idea:    'idle',
  paused:  'alert',
  closed:  'idle',
};

const TYPE_LABEL: Record<string, string> = {
  store:     'TIENDA',
  saas:      'SAAS',
  content:   'CONTENIDO',
  fund:      'FONDO',
  agency:    'AGENCIA',
  community: 'COMUNIDAD',
  other:     'OTRO',
};

const ROLE_DISPLAY: Record<string, string> = {
  investigador: 'Explorador',
  contenido:    'Escritor',
  trafico:      'Tráfico',
  finanzas:     'Finanzas',
  operaciones:  'Ops',
  soporte:      'Soporte',
  ceo:          'Hokage',
};

export function VenturesView({ ventures }: { ventures: Venture[] }) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [toggling, setToggling] = useState<number | null>(null);

  useEffect(() => {
    api.automations().then((data) => { if (data) setAutomations(data); });
  }, []);

  async function handleToggle(id: number) {
    setToggling(id);
    const updated = await api.toggleAutomation(id);
    if (updated) {
      setAutomations((prev) => prev.map((a) => (a.id === id ? (updated as Automation) : a)));
    }
    setToggling(null);
  }

  const activeVentures = ventures.filter((v) => v.status === 'active' || v.status === 'scaling');

  return (
    <div>
      {/* ── Header ── */}
      <div className="hk-flex hk-gap-8 hk-mb-16" style={{ alignItems: 'center' }}>
        <Led state={activeVentures.length > 0 ? 'on' : 'idle'} />
        <span className="hk-eyebrow" style={{ color: 'var(--good)' }}>
          VENTURES · {activeVentures.length} ACTIVOS
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* ── Venture cards ── */}
        <div>
          <div className="hk-eyebrow hk-mb-16" style={{ color: 'var(--ink-faint)' }}>INICIATIVAS ECONÓMICAS</div>
          {ventures.length === 0 && (
            <Panel>
              <div style={{ color: 'var(--ink-faint)', fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
                Sin ventures. Crea el primero.
              </div>
            </Panel>
          )}
          {ventures.map((v) => {
            const revPct = v.revenue_target_usd > 0
              ? Math.min(100, (v.budget_spent_usd / v.revenue_target_usd) * 100)
              : 0;
            const tone = STATUS_TONE[v.status] ?? 'dim';
            const led  = STATUS_LED[v.status]  ?? 'idle';
            return (
              <Panel key={v.id} className="hk-mb-16" style={{ position: 'relative', overflow: 'hidden' }}>
                {/* corner accent */}
                <div style={{
                  position: 'absolute', top: 0, left: 0,
                  width: 3, height: '100%',
                  background: `var(--${tone === 'good' ? 'good' : tone === 'signal' ? 'signal' : 'amber'})`,
                  opacity: 0.6,
                }} />
                <div style={{ paddingLeft: 10 }}>
                  <div className="hk-flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div className="hk-flex hk-gap-8" style={{ alignItems: 'center' }}>
                      <Led state={led} />
                      <Badge tone={tone}>{v.status.toUpperCase()}</Badge>
                    </div>
                    <Badge tone="dim">{TYPE_LABEL[v.type] ?? v.type}</Badge>
                  </div>

                  <div style={{
                    fontFamily: 'Chakra Petch, sans-serif',
                    fontWeight: 700,
                    fontSize: 16,
                    letterSpacing: '0.04em',
                    marginBottom: 4,
                  }}>
                    {v.name}
                  </div>

                  {v.goal && (
                    <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 10, lineHeight: 1.4 }}>
                      {v.goal}
                    </div>
                  )}

                  {v.revenue_target_usd > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <div className="hk-flex" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace' }}>
                          INGRESOS
                        </span>
                        <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--signal)' }}>
                          ${v.budget_spent_usd.toFixed(0)} / ${v.revenue_target_usd.toFixed(0)}
                        </span>
                      </div>
                      <Bar pct={revPct} signal />
                    </div>
                  )}

                  <div style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace' }}>
                    ID-{String(v.id).padStart(3, '0')} · {new Date(v.created_at).toLocaleDateString('es-ES')}
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>

        {/* ── Automation rules ── */}
        <div>
          <div className="hk-eyebrow hk-mb-16" style={{ color: 'var(--ink-faint)' }}>
            PIPELINE RULES · {automations.filter((a) => a.active).length} ACTIVAS
          </div>

          {automations.length === 0 && (
            <Panel>
              <div style={{ color: 'var(--ink-faint)', fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
                Sin automations.
              </div>
            </Panel>
          )}

          {automations.map((a) => (
            <Panel key={a.id} className="hk-mb-12" style={{
              opacity: a.active ? 1 : 0.45,
              transition: 'opacity 0.2s',
            }}>
              <div className="hk-flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="hk-flex hk-gap-8" style={{ alignItems: 'center', marginBottom: 6 }}>
                    <Led state={a.active ? 'on' : 'idle'} />
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{a.name}</span>
                  </div>

                  <div style={{
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                  }}>
                    <span style={{ color: 'var(--signal)' }}>{a.trigger_event}</span>
                    <span style={{ color: 'var(--ink-faint)' }}>→</span>
                    <span style={{ color: 'var(--ember)' }}>
                      {a.action_agent_role ? (ROLE_DISPLAY[a.action_agent_role] ?? a.action_agent_role) : '—'}
                    </span>
                    <Badge tone="dim">P{a.action_priority}</Badge>
                  </div>
                </div>

                <button
                  className={`hk-btn hk-btn--sm${a.active ? ' hk-btn--ghost-danger' : ''}`}
                  style={{ flexShrink: 0, minWidth: 58 }}
                  disabled={toggling === a.id}
                  onClick={() => handleToggle(a.id)}
                >
                  {toggling === a.id ? '…' : a.active ? 'OFF' : 'ON'}
                </button>
              </div>
            </Panel>
          ))}

          <div style={{
            marginTop: 16,
            padding: '10px 12px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 10,
            fontFamily: 'IBM Plex Mono, monospace',
            color: 'var(--ink-faint)',
            lineHeight: 1.6,
          }}>
            <span style={{ color: 'var(--signal)' }}>// </span>
            añadir regla sin código:<br />
            <span style={{ color: 'var(--signal)' }}>INSERT INTO automations</span><br />
            <span style={{ color: 'var(--ink-faint)', paddingLeft: 10 }}>
              (trigger_event, action_agent_role, action_context_template)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
