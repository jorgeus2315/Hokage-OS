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

  const xpPct = Math.min(100, xpNext > 0 ? (xp / xpNext) * 100 : 0);

  return (
    <div className="hk-game-hud">
      {/* Logo */}
      <button className="hk-game-logo" onClick={onMenu} aria-label="Menú principal">
        <span className="hk-game-logo-h">HOKAGE</span>
        <span className="hk-game-logo-os"> OS</span>
      </button>

      <div className="hk-game-hud-sep" />

      {/* Métricas */}
      <div className="hk-game-stats">
        {/* Agentes — no es clickable */}
        <div className="hk-game-stat">
          <span style={{
            fontSize: 11, lineHeight: 1,
            color: connected ? 'var(--good)' : 'var(--ember)',
            textShadow: connected ? '0 0 8px var(--good)' : '0 0 8px var(--ember)',
          }}>◉</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span className="hk-game-stat-label">AGENTES</span>
            <span className="hk-game-stat-value">{agents.length}</span>
          </div>
        </div>

        <button
          className={`hk-game-stat hk-game-stat-btn${pending.length > 0 ? ' hk-game-stat--alert' : ''}`}
          onClick={onAlerts}
        >
          <span style={{
            fontSize: 10, lineHeight: 1,
            color: pending.length > 0 ? 'var(--ember)' : 'var(--ink-faint)',
          }}>⚠</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span className="hk-game-stat-label">ALERTAS</span>
            <span className="hk-game-stat-value">{pending.length}</span>
          </div>
        </button>

        <button className="hk-game-stat hk-game-stat-btn" onClick={onComms}>
          <span style={{ fontSize: 10, lineHeight: 1, color: 'var(--signal)' }}>◈</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span className="hk-game-stat-label">COMMS</span>
            <span className="hk-game-stat-value">{messages.length}</span>
          </div>
        </button>

        <button
          className={`hk-game-stat hk-game-stat-btn${activeObjectives > 0 ? ' hk-game-stat--signal' : ''}`}
          onClick={onObjectives}
        >
          <span style={{
            fontSize: 10, lineHeight: 1,
            color: activeObjectives > 0 ? 'var(--signal)' : 'var(--ink-faint)',
          }}>◎</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span className="hk-game-stat-label">OBJETIVOS</span>
            <span className="hk-game-stat-value">{activeObjectives}</span>
          </div>
        </button>

        <button className="hk-game-stat hk-game-stat-btn" onClick={onCrew}>
          <span style={{ fontSize: 10, lineHeight: 1, color: 'var(--amber)' }}>⬡</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span className="hk-game-stat-label">CREW</span>
            <span className="hk-game-stat-value">{agents.length}</span>
          </div>
        </button>
      </div>

      <div style={{ flex: 1 }} />

      {/* XP bar */}
      <div className="hk-game-xp">
        <span className="hk-game-xp-level">NV.{level}</span>
        <div className="hk-game-xp-bar" title={`${xp} / ${xpNext} XP`}>
          <div className="hk-game-xp-fill" style={{ width: `${xpPct}%` }} />
        </div>
        <span className="hk-game-xp-text">{xp}<span style={{ opacity: 0.4 }}>/{xpNext}</span></span>
      </div>

      <div className="hk-game-hud-sep" />

      {/* Runtime toggle */}
      <button
        className={`hk-game-runtime${runtimeOn ? ' hk-game-runtime--on' : ''}`}
        onClick={onToggleRuntime}
        title={runtimeOn ? 'Detener agentes' : 'Iniciar agentes'}
      >
        <span style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: runtimeOn ? 'var(--good)' : 'var(--ink-faint)',
          boxShadow: runtimeOn ? '0 0 5px var(--good)' : 'none',
          flexShrink: 0,
        }} />
        {runtimeOn ? 'EN LÍNEA' : 'PAUSADO'}
      </button>

      <div className="hk-game-hud-sep" />

      {/* Reloj */}
      <div className="hk-game-clock">{clock}</div>
    </div>
  );
}
