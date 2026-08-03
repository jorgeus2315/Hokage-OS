import type { Agent, Decision, CommMsg, Objective } from './types';

export function GameHUD({
  agents,
  pending,
  messages,
  objectives,
  runtimeOn,
  connected,
  clock,
  level,
  xp,
  xpNext,
  onToggleRuntime,
  onMenu,
  onAlerts,
  onComms,
  onCrew,
  onObjectives,
}: {
  agents: Agent[];
  pending: Decision[];
  messages: CommMsg[];
  objectives: Objective[];
  runtimeOn: boolean;
  connected: boolean;
  clock: string;
  level: number;
  xp: number;
  xpNext: number;
  onToggleRuntime: () => void;
  onMenu: () => void;
  onAlerts: () => void;
  onComms: () => void;
  onCrew: () => void;
  onObjectives: () => void;
}) {
  const activeObjectives = objectives.filter(
    (o) => o.status === 'active' || o.plan?.status === 'proposed',
  ).length;

  return (
    <div className="hk-game-hud">
      <button className="hk-game-logo" onClick={onMenu} aria-label="Menú principal">
        <span className="hk-game-logo-h">HOKAGE</span>
        <span className="hk-game-logo-os"> OS</span>
      </button>

      <div className="hk-game-hud-sep" />

      <div className="hk-game-stats">
        <div className="hk-game-stat">
          <span
            className="hk-led"
            style={{
              background: connected ? 'var(--good)' : 'var(--ember)',
              boxShadow: connected ? '0 0 6px var(--good)' : '0 0 8px var(--ember)',
            }}
          />
          <span className="hk-game-stat-label">AGENTES</span>
          <span className="hk-game-stat-value">{agents.length}</span>
        </div>

        <button
          className={`hk-game-stat hk-game-stat-btn${pending.length > 0 ? ' hk-game-stat--alert' : ''}`}
          onClick={onAlerts}
        >
          <span className="hk-game-stat-dot" style={{ background: pending.length > 0 ? 'var(--ember)' : 'var(--ink-faint)' }} />
          <span className="hk-game-stat-label">ALERTAS</span>
          <span className="hk-game-stat-value">{pending.length}</span>
        </button>

        <button className="hk-game-stat hk-game-stat-btn" onClick={onComms}>
          <span className="hk-game-stat-dot" style={{ background: 'var(--signal)' }} />
          <span className="hk-game-stat-label">COMMS</span>
          <span className="hk-game-stat-value">{messages.length}</span>
        </button>

        <button
          className={`hk-game-stat hk-game-stat-btn${activeObjectives > 0 ? ' hk-game-stat--signal' : ''}`}
          onClick={onObjectives}
        >
          <span className="hk-game-stat-dot" style={{ background: activeObjectives > 0 ? 'var(--signal)' : 'var(--ink-faint)' }} />
          <span className="hk-game-stat-label">OBJETIVOS</span>
          <span className="hk-game-stat-value">{activeObjectives}</span>
        </button>

        <button className="hk-game-stat hk-game-stat-btn" onClick={onCrew}>
          <span className="hk-game-stat-dot" style={{ background: 'var(--amber)' }} />
          <span className="hk-game-stat-label">CREW</span>
          <span className="hk-game-stat-value">{agents.length}</span>
        </button>
      </div>

      <div style={{ flex: 1 }} />

      <div className="hk-game-xp">
        <span className="hk-game-xp-level">NV.{level}</span>
        <div className="hk-game-xp-bar">
          <div
            className="hk-game-xp-fill"
            style={{ width: `${Math.min(100, xpNext > 0 ? (xp / xpNext) * 100 : 0)}%` }}
          />
        </div>
        <span className="hk-game-xp-text">{xp}/{xpNext}</span>
      </div>

      <div className="hk-game-hud-sep" />

      <button
        className={`hk-game-runtime${runtimeOn ? ' hk-game-runtime--on' : ''}`}
        onClick={onToggleRuntime}
      >
        <span
          className="hk-led"
          style={
            runtimeOn
              ? { background: 'var(--good)', boxShadow: '0 0 6px var(--good)' }
              : { background: 'var(--ink-faint)' }
          }
        />
        {runtimeOn ? 'EN LÍNEA' : 'PAUSADO'}
      </button>

      <div className="hk-game-hud-sep" />

      <div className="hk-game-clock">{clock}</div>
    </div>
  );
}
