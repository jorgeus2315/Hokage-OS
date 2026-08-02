import type { Agent, WsEvent, ChatMsg, Building, BuildingSection, Decision } from '../shared/types';
import { ROLES } from '../shared/types';
import { Panel, Led, Badge } from '../shared/ui';
import { BuildingGlyph, SectionIcon, IconPlay } from '../shared/icons';
import { ChatPanel } from '../panels/ChatPanel';
import { LiveFeedPanel } from '../panels/LiveFeedPanel';
import { StatsPanel } from '../panels/StatsPanel';
import { PipelinePanel } from '../panels/PipelinePanel';
import { AlertsPanel } from '../panels/AlertsPanel';

const SECTIONS: Array<{ id: BuildingSection; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'feed', label: 'Live Feed' },
  { id: 'stats', label: 'Stats' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'alerts', label: 'Alertas' },
];

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
          {section === 'feed' && <LiveFeedPanel events={agentEvents} />}
          {section === 'stats' && <StatsPanel agentId={agent?.id} />}
          {section === 'pipeline' && <PipelinePanel agentId={agent?.id} />}
          {section === 'alerts' && <AlertsPanel decisions={pendingForAgent} onApprove={onApprove} onReject={onReject} />}
        </Panel>
      </div>
    </div>
  );
}
