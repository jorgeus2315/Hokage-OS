import { useState, useEffect, useCallback } from 'react';
import type { Agent } from '../shared/types';
import { ROLES } from '../shared/types';
import { Panel, Led, Badge } from '../shared/ui';
import { IconChevron } from '../shared/icons';
import { AgentConfigPanel } from '../panels/AgentConfigPanel';
import { api } from '../shared/api';

function MasterPromptSection() {
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.getMasterPrompt().then((r) => {
      setContent(r?.content ?? '');
      setLoaded(true);
    });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setMsg('');
    await api.setMasterPrompt(content);
    setSaving(false);
    setMsg('Guardado');
    setTimeout(() => setMsg(''), 2500);
  }, [content]);

  return (
    <Panel className="hk-mb-16">
      <div className="hk-eyebrow" style={{ marginBottom: 6, color: 'var(--ember)' }}>PROMPT MAESTRO GLOBAL</div>
      <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 10, lineHeight: 1.5 }}>
        Se antepone automáticamente al prompt de cada agente antes de cada ejecución.
        Úsalo para reglas que aplican a todo el equipo, sin repetirlas agente por agente.
      </div>
      {!loaded ? (
        <div style={{ color: 'var(--ink-faint)', fontSize: 12 }}>Cargando…</div>
      ) : (
        <>
          <textarea
            className="hk-config-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            placeholder="Ej: Todo en español. Prioriza siempre el criterio sobre la obediencia ciega. Nunca prometas plazos que no puedes cumplir."
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <button className="hk-btn hk-btn--sm" style={{ background: 'var(--ember)', color: '#000', borderColor: 'var(--ember)' }} onClick={save} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
            {msg && <span style={{ fontSize: 11, color: 'var(--good)' }}>✓ {msg}</span>}
          </div>
        </>
      )}
    </Panel>
  );
}

function AgentRow({ agent, accentColor, onSaved }: { agent: Agent; accentColor: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Panel className="hk-mb-12">
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
      >
        <div
          className="hk-building-agent-avatar"
          style={{ background: accentColor, width: 30, height: 30, fontSize: 12, boxShadow: `0 0 12px ${accentColor}66`, flexShrink: 0 }}
        >
          {agent.name[0]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{agent.name}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{ROLES[agent.role] || agent.role}</div>
        </div>
        <Badge tone="dim">{agent.model?.split('/')[1] || agent.model}</Badge>
        <Led state="on" />
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', color: 'var(--ink-faint)' }}>
          <IconChevron />
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <AgentConfigPanel agent={agent} accentColor={accentColor} onSaved={onSaved} />
        </div>
      )}
    </Panel>
  );
}

export function ConfigView({
  agents,
  roleColors,
  onAgentUpdated,
}: {
  agents: Agent[];
  roleColors?: Record<string, string>;
  onAgentUpdated: () => void;
}) {
  return (
    <div>
      <MasterPromptSection />

      <div className="hk-eyebrow hk-mb-16" style={{ color: 'var(--ink-faint)' }}>
        AGENTES · {agents.length}
      </div>
      {agents.map((a) => (
        <AgentRow key={a.id} agent={a} accentColor={roleColors?.[a.role] ?? 'var(--signal)'} onSaved={onAgentUpdated} />
      ))}
    </div>
  );
}
