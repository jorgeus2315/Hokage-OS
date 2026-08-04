import { useState, useEffect, useCallback } from 'react';
import type { Agent, WsEvent, ChatMsg, Building, BuildingSection, Decision } from '../shared/types';
import { ROLES } from '../shared/types';
import { Panel, Led, Badge } from '../shared/ui';
import { BuildingGlyph, SectionIcon, IconPlay } from '../shared/icons';
import { ChatPanel } from '../panels/ChatPanel';
import { LiveFeedPanel } from '../panels/LiveFeedPanel';
import { StatsPanel } from '../panels/StatsPanel';
import { PipelinePanel } from '../panels/PipelinePanel';
import { OutputsPanel } from '../panels/OutputsPanel';
import { AlertsPanel } from '../panels/AlertsPanel';
import { api } from '../shared/api';

const OPENROUTER_MODELS = [
  { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
];

const SECTIONS: Array<{ id: BuildingSection; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'outputs', label: 'Outputs' },
  { id: 'feed', label: 'Live Feed' },
  { id: 'stats', label: 'Stats' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'alerts', label: 'Alertas' },
  { id: 'config', label: 'Configurar' },
];

function ConfigPanel({ agent, building, onSaved }: { agent: Agent; building: Building; onSaved: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState(agent.name);
  const [model, setModel] = useState(agent.model || '');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.getAgentPrompt(agent.id).then((r) => {
      setPrompt(r?.content ?? '');
      setLoaded(true);
    });
    setName(agent.name);
    setModel(agent.model || '');
  }, [agent.id, agent.name, agent.model]);

  const save = useCallback(async () => {
    setSaving(true);
    setMsg('');
    const tasks = [
      api.setAgentPrompt(agent.id, prompt || `Eres ${name} de HOKAGE OS. Tu rol es ${agent.role}.`),
      api.updateAgent(agent.id, { name: name.trim(), model: model.trim() }),
    ];
    await Promise.all(tasks);
    setSaving(false);
    setMsg('Guardado');
    onSaved();
    setTimeout(() => setMsg(''), 2500);
  }, [agent.id, agent.role, prompt, name, model, onSaved]);

  if (!loaded) return <div style={{ padding: 20, color: 'var(--ink-faint)', fontSize: 12 }}>Cargando…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
      <div>
        <div className="hk-eyebrow" style={{ marginBottom: 6 }}>NOMBRE DEL AGENTE</div>
        <input
          className="hk-config-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del agente"
        />
      </div>
      <div>
        <div className="hk-eyebrow" style={{ marginBottom: 6 }}>MODELO IA</div>
        <select
          className="hk-config-input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {OPENROUTER_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
      <div style={{ flex: 1 }}>
        <div className="hk-eyebrow" style={{ marginBottom: 6 }}>PROMPT DEL AGENTE</div>
        <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 6, lineHeight: 1.5 }}>
          Define quién es este agente, qué hace, cómo piensa y qué no debe hacer.
          El prompt maestro global se añade automáticamente antes de este.
        </div>
        <textarea
          className="hk-config-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={12}
          placeholder={`Eres ${agent.name} de HOKAGE OS.\nTu rol es ${agent.role}.\n\nTus responsabilidades son:\n- ...\n\nNunca debes:\n- ...`}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          className="hk-btn hk-btn--sm"
          style={{ background: building.color, color: '#000', borderColor: building.color }}
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {msg && (
          <span style={{ fontSize: 11, color: 'var(--good)' }}>✓ {msg}</span>
        )}
      </div>
    </div>
  );
}

export function BuildingView({
  building,
  agent,
  section,
  onChangeSection,
  chatMsgs,
  chatInput,
  chatLoading,
  onChangeChatInput,
  onSendChat,
  liveEvents,
  pendingForAgent,
  onApprove,
  onReject,
  onRunNow,
  onAgentUpdated,
}: {
  building: Building;
  agent: Agent | undefined;
  section: BuildingSection;
  onChangeSection: (s: BuildingSection) => void;
  chatMsgs: ChatMsg[];
  chatInput: string;
  chatLoading: boolean;
  onChangeChatInput: (v: string) => void;
  onSendChat: () => void;
  liveEvents: WsEvent[];
  pendingForAgent: Decision[];
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onRunNow: () => void;
  onAgentUpdated?: () => void;
}) {
  const agentEvents = liveEvents.filter((e) => e.from === agent?.name);

  return (
    <div className="hk-interior">
      <div className="hk-interior-side">
        {agent && (
          <Panel className="hk-mb-16">
            <div className="hk-eyebrow" style={{ marginBottom: 8 }}>
              AGENTE
            </div>
            <div className="hk-flex hk-gap-8">
              <div
                className="hk-building-agent-avatar"
                style={{ background: building.color, width: 34, height: 34, fontSize: 13, boxShadow: `0 0 14px ${building.color}66` }}
              >
                {agent.name[0]}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{agent.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{ROLES[agent.role] || agent.role}</div>
              </div>
            </div>
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5 }}>
              <Led state="on" />
              <span style={{ color: 'var(--good)' }}>Activo</span>
              <Badge tone="dim">{agent.model?.split('/')[1] || agent.model}</Badge>
            </div>
            <button className="hk-btn hk-btn--sm hk-btn--block" style={{ marginTop: 12 }} onClick={onRunNow}>
              <IconPlay /> Ejecutar ahora
            </button>
          </Panel>
        )}

        {SECTIONS.map((s) => (
          <div
            key={s.id}
            className={`hk-section-tab${section === s.id ? ' hk-section-tab--active' : ''}`}
            onClick={() => onChangeSection(s.id)}
            role="tab"
            aria-selected={section === s.id}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onChangeSection(s.id);
              }
            }}
          >
            <span className="hk-section-tab-icon">
              <SectionIcon section={s.id} />
            </span>
            {s.label}
            {s.id === 'alerts' && pendingForAgent.length > 0 && (
              <span className="hk-section-tab-badge">
                <Badge tone="ember">{pendingForAgent.length}</Badge>
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="hk-interior-main">
        <div className="hk-building-head">
          <div className="hk-building-head-glyph" style={{ color: building.color, filter: `drop-shadow(0 0 8px ${building.color}66)` }}>
            <BuildingGlyph glyph={building.glyph} />
          </div>
          <div>
            <div className="hk-building-head-title">{building.name}</div>
            <div className="hk-building-head-sub">{building.desc}</div>
          </div>
        </div>

        <Panel>
          {section === 'chat' && (
            <ChatPanel
              agent={agent}
              buildingName={building.name}
              messages={chatMsgs}
              input={chatInput}
              loading={chatLoading}
              onChangeInput={onChangeChatInput}
              onSend={onSendChat}
            />
          )}
          {section === 'outputs' && <OutputsPanel agentId={agent?.id} />}
          {section === 'feed' && <LiveFeedPanel events={agentEvents} />}
          {section === 'stats' && <StatsPanel agentId={agent?.id} />}
          {section === 'pipeline' && <PipelinePanel agentId={agent?.id} />}
          {section === 'alerts' && <AlertsPanel decisions={pendingForAgent} onApprove={onApprove} onReject={onReject} />}
          {section === 'config' && agent && (
            <ConfigPanel agent={agent} building={building} onSaved={onAgentUpdated ?? (() => {})} />
          )}
          {section === 'config' && !agent && (
            <div style={{ padding: 20, color: 'var(--ink-faint)', fontSize: 12 }}>
              No hay agente asignado a este departamento.
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
