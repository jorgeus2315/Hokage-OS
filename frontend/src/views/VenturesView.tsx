import { useState, useEffect } from 'react';
import type { Venture, Automation, Agent } from '../shared/types';
import { AUTOMATION_EVENTS } from '../shared/types';
import { api } from '../shared/api';
import { Panel, Led, Badge, Bar } from '../shared/ui';

type Asset = { id: number; venture_id: number | null; type: string; name: string; status: string; platform: string | null; created_at: string };

const ASSET_TYPE_COLOR: Record<string, string> = {
  content:    'var(--signal)',
  code:       'var(--good)',
  data:       'var(--amber)',
  audience:   'var(--ember)',
  brand:      'var(--ember)',
  ip:         'var(--amber)',
  credential: 'var(--ink-faint)',
  tool:       'var(--ink-faint)',
};

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
  hermes:       'Hermes',
};

type FormState = {
  name: string;
  trigger_event: string;
  action_agent_role: string;
  action_priority: number;
  action_context_template: string;
  requires_approval: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  trigger_event: AUTOMATION_EVENTS[0],
  action_agent_role: '',
  action_priority: 6,
  action_context_template: '',
  requires_approval: false,
};

function AutomationForm({
  form,
  agents,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  form: FormState;
  agents: Agent[];
  onChange: (f: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const roles = [...new Set(agents.map((a) => a.role))];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input
        className="hk-config-input"
        placeholder="Nombre de la regla (ej: Tendencia → Escritor)"
        value={form.name}
        onChange={(e) => onChange({ ...form, name: e.target.value })}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div className="hk-eyebrow" style={{ marginBottom: 4, fontSize: 9 }}>EVENTO ORIGEN</div>
          <select
            className="hk-config-input"
            value={form.trigger_event}
            onChange={(e) => onChange({ ...form, trigger_event: e.target.value })}
          >
            {AUTOMATION_EVENTS.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div className="hk-eyebrow" style={{ marginBottom: 4, fontSize: 9 }}>AGENTE DESTINO</div>
          <select
            className="hk-config-input"
            value={form.action_agent_role}
            onChange={(e) => onChange({ ...form, action_agent_role: e.target.value })}
          >
            <option value="">— elegir —</option>
            {roles.map((r) => <option key={r} value={r}>{ROLE_DISPLAY[r] ?? r}</option>)}
          </select>
        </div>
        <div style={{ width: 70 }}>
          <div className="hk-eyebrow" style={{ marginBottom: 4, fontSize: 9 }}>PRIOR.</div>
          <input
            className="hk-config-input"
            type="number"
            min={1}
            max={9}
            value={form.action_priority}
            onChange={(e) => onChange({ ...form, action_priority: Number(e.target.value) })}
          />
        </div>
      </div>
      <div>
        <div className="hk-eyebrow" style={{ marginBottom: 4, fontSize: 9 }}>
          CONDICIÓN / CONTEXTO — usa {'{{'}campo{'}}'} para insertar datos del evento
        </div>
        <textarea
          className="hk-config-textarea"
          rows={3}
          placeholder='Ej: Tendencia detectada: "{{keyword}}". {{description}}. Crea contenido SEO.'
          value={form.action_context_template}
          onChange={(e) => onChange({ ...form, action_context_template: e.target.value })}
        />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-faint)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={form.requires_approval}
          onChange={(e) => onChange({ ...form, requires_approval: e.target.checked })}
        />
        Requiere aprobación de Jorge antes de ejecutarse
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="hk-btn hk-btn--sm"
          style={{ background: 'var(--signal)', color: '#000', borderColor: 'var(--signal)' }}
          onClick={onSave}
          disabled={saving || !form.name.trim() || !form.action_agent_role}
        >
          {saving ? 'Guardando…' : 'Guardar regla'}
        </button>
        <button className="hk-btn hk-btn--sm" onClick={onCancel} disabled={saving}>Cancelar</button>
      </div>
    </div>
  );
}

export function VenturesView({ ventures, agents }: { ventures: Venture[]; agents: Agent[] }) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [toggling, setToggling] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  useEffect(() => {
    api.automations().then((data) => { if (data) setAutomations(data); });
    api.assets().then((data) => { if (data) setAssets(data); });
  }, []);

  async function handleToggle(id: number) {
    setToggling(id);
    const updated = await api.toggleAutomation(id);
    if (updated) {
      setAutomations((prev) => prev.map((a) => (a.id === id ? (updated as Automation) : a)));
    }
    setToggling(null);
  }

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId('new');
  }

  function startEdit(a: Automation) {
    setForm({
      name: a.name,
      trigger_event: a.trigger_event,
      action_agent_role: a.action_agent_role ?? '',
      action_priority: a.action_priority,
      action_context_template: a.action_context_template ?? '',
      requires_approval: !!a.requires_approval,
    });
    setEditingId(a.id);
  }

  function cancelForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function saveForm() {
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      trigger_event: form.trigger_event,
      action_agent_role: form.action_agent_role,
      action_priority: form.action_priority,
      action_context_template: form.action_context_template.trim() || null,
      requires_approval: form.requires_approval ? 1 : 0,
    };
    if (editingId === 'new') {
      const created = await api.createAutomation(payload);
      if (created) setAutomations((prev) => [...prev, created as Automation]);
    } else if (typeof editingId === 'number') {
      const updated = await api.updateAutomation(editingId, payload);
      if (updated) setAutomations((prev) => prev.map((a) => (a.id === editingId ? (updated as Automation) : a)));
    }
    setSaving(false);
    cancelForm();
  }

  async function handleDelete(id: number) {
    if (!window.confirm('¿Borrar esta conexión? No se puede deshacer.')) return;
    setDeleting(id);
    const res = await api.deleteAutomation(id);
    if (res !== null) setAutomations((prev) => prev.filter((a) => a.id !== id));
    setDeleting(null);
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

                  <div style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace', marginBottom: 8 }}>
                    ID-{String(v.id).padStart(3, '0')} · {new Date(v.created_at).toLocaleDateString('es-ES')}
                  </div>

                  {/* Assets de este venture */}
                  {assets.filter((a) => a.venture_id === v.id).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {assets.filter((a) => a.venture_id === v.id).map((a) => (
                        <span key={a.id} style={{
                          fontSize: 9,
                          fontFamily: 'IBM Plex Mono, monospace',
                          padding: '2px 6px',
                          border: `1px solid ${ASSET_TYPE_COLOR[a.type] ?? 'var(--border)'}44`,
                          borderRadius: 3,
                          color: ASSET_TYPE_COLOR[a.type] ?? 'var(--ink-faint)',
                          background: `${ASSET_TYPE_COLOR[a.type] ?? 'transparent'}11`,
                        }}>
                          {a.type.toUpperCase()} · {a.name.slice(0, 18)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>

        {/* ── Automation rules ── */}
        <div>
          <div className="hk-flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div className="hk-eyebrow" style={{ color: 'var(--ink-faint)' }}>
              CONEXIONES · {automations.filter((a) => a.active).length} ACTIVAS
            </div>
            {editingId === null && (
              <button className="hk-btn hk-btn--sm" onClick={startCreate}>+ Nueva conexión</button>
            )}
          </div>

          {editingId === 'new' && (
            <Panel className="hk-mb-12" style={{ borderColor: 'var(--signal)' }}>
              <AutomationForm form={form} agents={agents} onChange={setForm} onSave={saveForm} onCancel={cancelForm} saving={saving} />
            </Panel>
          )}

          {automations.length === 0 && editingId !== 'new' && (
            <Panel>
              <div style={{ color: 'var(--ink-faint)', fontSize: 12, textAlign: 'center', padding: '24px 0' }}>
                Sin conexiones. Crea la primera para que un agente dispare a otro.
              </div>
            </Panel>
          )}

          {automations.map((a) => (
            <Panel key={a.id} className="hk-mb-12" style={{
              opacity: a.active ? 1 : 0.45,
              transition: 'opacity 0.2s',
              borderColor: editingId === a.id ? 'var(--signal)' : undefined,
            }}>
              {editingId === a.id ? (
                <AutomationForm form={form} agents={agents} onChange={setForm} onSave={saveForm} onCancel={cancelForm} saving={saving} />
              ) : (
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
                      {!!a.requires_approval && <Badge tone="amber">APROBACIÓN</Badge>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="hk-btn hk-btn--sm" onClick={() => startEdit(a)}>Editar</button>
                    <button
                      className={`hk-btn hk-btn--sm${a.active ? ' hk-btn--ghost-danger' : ''}`}
                      style={{ minWidth: 46 }}
                      disabled={toggling === a.id}
                      onClick={() => handleToggle(a.id)}
                    >
                      {toggling === a.id ? '…' : a.active ? 'OFF' : 'ON'}
                    </button>
                    <button
                      className="hk-btn hk-btn--sm hk-btn--ghost-danger"
                      disabled={deleting === a.id}
                      onClick={() => handleDelete(a.id)}
                    >
                      {deleting === a.id ? '…' : '×'}
                    </button>
                  </div>
                </div>
              )}
            </Panel>
          ))}
        </div>
      </div>
    </div>
  );
}
