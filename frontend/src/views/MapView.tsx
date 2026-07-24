import type { Agent, AgentRun, Decision, WsEvent, Building } from '../shared/types';
import { BUILDINGS } from '../shared/types';
import { Panel, Led } from '../shared/ui';
import { BuildingGlyph, IconComms, IconAlert, IconCrew } from '../shared/icons';

export function MapView({
  agents,
  runs,
  pending,
  liveEvents,
  messagesCount,
  connected,
  onEnterBuilding,
  onGoComms,
  onGoAlerts,
  onGoCrew,
}: {
  agents: Agent[];
  runs: AgentRun[];
  pending: Decision[];
  liveEvents: WsEvent[];
  messagesCount: number;
  connected: boolean;
  onEnterBuilding: (b: Building) => void;
  onGoComms: () => void;
  onGoAlerts: () => void;
  onGoCrew: () => void;
}) {
  const lastRunFor = (agentId: number) => runs.find((r) => r.agent_id === agentId);

  return (
    <div>
      <Panel className="hk-mb-16">
        <div className="hk-flex hk-gap-8 hk-mb-16">
          <Led state="on" />
          <span className="hk-eyebrow" style={{ color: 'var(--good)' }}>
            SHIP CREW · {agents.length} ONLINE
          </span>
        </div>
        <div className="hk-crewstrip">
          {agents.map((a) => {
            const building = BUILDINGS.find((b) => b.role === a.role);
            const lastRun = lastRunFor(a.id);
            return (
              <div
                className="hk-crew-chip"
                key={a.id}
                onClick={() => building && onEnterBuilding(building)}
                style={{ cursor: building ? 'pointer' : 'default' }}
                role={building ? 'button' : undefined}
                tabIndex={building ? 0 : undefined}
                onKeyDown={(e) => {
                  if (building && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onEnterBuilding(building);
                  }
                }}
              >
                <Led state="on" />
                <span className="hk-crew-chip-name">{a.name}</span>
                <span className="hk-crew-chip-action">{lastRun?.action || 'En espera'}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      {liveEvents.length > 0 && (
        <Panel className="hk-mb-16">
          <div className="hk-eyebrow hk-mb-16">EVENTOS EN VIVO</div>
          {liveEvents.slice(0, 3).map((e, i) => (
            <div key={i} style={{ fontSize: 11.5, color: 'var(--ink-dim)', marginBottom: 5 }}>
              <span
                style={{
                  fontWeight: 600,
                  color: e.type?.includes('error') ? 'var(--ember)' : e.type?.includes('done') ? 'var(--good)' : 'var(--signal)',
                }}
              >
                {e.type}
              </span>
              {e.from && <span style={{ color: 'var(--ink-faint)' }}> · {e.from}</span>}
            </div>
          ))}
        </Panel>
      )}

      <div className="hk-eyebrow hk-mb-16">Selecciona una estación para entrar</div>
      <div className="hk-building-grid">
        {BUILDINGS.map((b) => {
          const agent = agents.find((a) => a.role === b.role);
          const lastRun = agent ? lastRunFor(agent.id) : undefined;
          const hasPending = pending.some((d) => d.agent_id === agent?.id);
          return (
            <Panel key={b.id} interactive className="hk-building" accent onClick={() => onEnterBuilding(b)}>
              {hasPending && <div className="hk-building-alert" />}
              <div className="hk-building-glyph">
                <BuildingGlyph glyph={b.glyph} />
              </div>
              <div className="hk-building-name">{b.name}</div>
              <div className="hk-building-desc">{b.desc}</div>
              {agent && (
                <div className="hk-building-agent">
                  <div className="hk-building-agent-avatar" style={{ background: 'var(--ember)' }}>
                    {agent.name[0]}
                  </div>
                  <div>
                    <div className="hk-building-agent-name">{agent.name}</div>
                    <div className="hk-building-agent-status">{lastRun?.action || 'Activo'}</div>
                  </div>
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      <div className="hk-quickrow" style={{ marginTop: 16 }}>
        <button className="hk-btn hk-btn--block" onClick={onGoComms}>
          <IconComms /> Ship Comms {messagesCount > 0 ? `(${messagesCount})` : ''}
        </button>
        <button className={`hk-btn hk-btn--block${pending.length > 0 ? ' hk-btn--ghost-danger' : ''}`} onClick={onGoAlerts}>
          <IconAlert /> Alertas {pending.length > 0 ? `(${pending.length})` : ''}
        </button>
        <button className="hk-btn hk-btn--block" onClick={onGoCrew}>
          <IconCrew /> Equipo
        </button>
      </div>

      <div style={{ textAlign: 'center', marginTop: 12, fontSize: 10.5, color: connected ? 'var(--good)' : 'var(--ember)', fontFamily: 'var(--font-mono)' }}>
        WS {connected ? '● conectado' : '○ desconectado'}
      </div>
    </div>
  );
}
