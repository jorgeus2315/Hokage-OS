import type { Agent, Decision, CommMsg, Objective, MetricsSummary } from './types';
import { IconConfig } from './icons';

export function GameHUD({
  agents,
  pending,
  messages,
  objectives,
  metrics,
  runtimeOn,
  connected,
  clock,
  onToggleRuntime,
  onMenu,
  onAlerts,
  onComms,
  onCrew,
  onObjectives,
  onConfig,
}: {
  agents: Agent[];
  pending: Decision[];
  messages: CommMsg[];
  objectives: Objective[];
  metrics: MetricsSummary;
  runtimeOn: boolean;
  connected: boolean;
  clock: string;
  onToggleRuntime: () => void;
  onMenu: () => void;
  onAlerts: () => void;
  onComms: () => void;
  onCrew: () => void;
  onObjectives: () => void;
  onConfig: () => void;
}) {
  const activeObjectives = objectives.filter(
    (o) => o.status === 'active' || o.plan?.status === 'proposed',
  ).length;
  const isUrgent = metrics.urgent_decisions > 0;

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
          className={`hk-game-stat hk-game-stat-btn${pending.length > 0 ? ' hk-game-stat--alert' : ''}${isUrgent ? ' hk-game-stat--urgent' : ''}`}
          onClick={onAlerts}
          title={isUrgent ? `${metrics.urgent_decisions} decisión(es) urgente(s) — riesgo alto, importe o más de 24h esperando` : undefined}
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

        <button className="hk-game-stat hk-game-stat-btn" onClick={onComms} title={`${metrics.messages_today} mensajes hoy`}>
          <span style={{ fontSize: 10, lineHeight: 1, color: 'var(--signal)' }}>◈</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span className="hk-game-stat-label">COMMS</span>
            <span className="hk-game-stat-value">{messages.length}</span>
          </div>
        </button>

        <div className="hk-game-stat" title="Coste de IA acumulado hoy">
          <span style={{ fontSize: 10, lineHeight: 1, color: 'var(--good)' }}>$</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span className="hk-game-stat-label">COSTE HOY</span>
            <span className="hk-game-stat-value">${metrics.ai_cost_today_usd.toFixed(2)}</span>
          </div>
        </div>

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

        <button className="hk-game-stat hk-game-stat-btn" onClick={onConfig} title="Configuración global" aria-label="Configuración global">
          <IconConfig className="hk-game-config-icon" />
        </button>
      </div>

      <div style={{ flex: 1 }} />

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
