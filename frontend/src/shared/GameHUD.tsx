import { useState, useRef, useEffect } from 'react';
import type { Agent, Decision, CommMsg, Objective, MetricsSummary } from './types';
import { api } from './api';
import { IconConfig, IconSend } from './icons';

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
  onApprove,
  onReject,
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
  onApprove: (id: number) => Promise<void>;
  onReject: (id: number) => Promise<void>;
}) {
  const activeObjectives = objectives.filter(
    (o) => o.status === 'active' || o.plan?.status === 'proposed',
  ).length;
  const isUrgent = metrics.urgent_decisions > 0;

  // Fase 6 — desplegable de alertas accionables y entrada directa a Hokage
  const [alertsOpen, setAlertsOpen] = useState(false);
  const alertsRef = useRef<HTMLDivElement>(null);
  const [hokageText, setHokageText] = useState('');
  const [hokageBusy, setHokageBusy] = useState(false);
  const [hokageReply, setHokageReply] = useState('');
  const hokageInputRef = useRef<HTMLInputElement>(null);

  const hokageAgent = agents.find((a) => a.role === 'ceo');

  // Cerrar el desplegable al hacer click fuera
  useEffect(() => {
    if (!alertsOpen) return;
    function onDocClick(e: MouseEvent) {
      if (alertsRef.current && !alertsRef.current.contains(e.target as Node)) {
        setAlertsOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [alertsOpen]);

  async function handleAlertAction(id: number, approve: boolean) {
    if (approve) await onApprove(id);
    else await onReject(id);
    if (pending.filter((d) => d.status === 'proposed').length === 0) {
      setAlertsOpen(false);
    }
  }

  async function handleHokageSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = hokageText.trim();
    if (!text || hokageBusy || !hokageAgent) return;
    setHokageText('');
    setHokageBusy(true);
    setHokageReply('Hokage está respondiendo…');
    try {
      const res = await api.ask(hokageAgent.id, text);
      setHokageReply(res?.response ?? 'Sin respuesta.');
    } catch {
      setHokageReply('Error de conexión con Hokage.');
    } finally {
      setHokageBusy(false);
    }
  }

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

        <div className="hk-game-hud-alerts" ref={alertsRef}>
          <button
            className={`hk-game-stat hk-game-stat-btn${pending.length > 0 ? ' hk-game-stat--alert' : ''}${isUrgent ? ' hk-game-stat--urgent' : ''}`}
            onClick={() => setAlertsOpen((o) => !o)}
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

          {alertsOpen && (
            <div className="hk-game-alerts-dropdown">
              <div className="hk-game-alerts-head">
                <span>DECISIONES PENDIENTES</span>
                <button
                  className="hk-game-alerts-link"
                  onClick={() => { setAlertsOpen(false); onAlerts(); }}
                >VER TODAS</button>
              </div>
              {pending.filter((d) => d.status === 'proposed').length === 0 ? (
                <div className="hk-game-alerts-empty">Sin decisiones pendientes.</div>
              ) : (
                pending.filter((d) => d.status === 'proposed').map((d) => (
                  <div key={d.id} className="hk-game-alert-row">
                    <div className="hk-game-alert-row-title">{d.title}</div>
                    {d.amount != null && (
                      <div className="hk-game-alert-row-amount">${d.amount.toFixed(2)}</div>
                    )}
                    <div className="hk-game-alert-row-meta">
                      <span className={`hk-game-alert-risk hk-game-alert-risk--${d.risk_level}`}>
                        {d.risk_level.toUpperCase()}
                      </span>
                      {d.category && <span className="hk-game-alert-cat">{d.category}</span>}
                    </div>
                    <div className="hk-game-alert-row-actions">
                      <button
                        className="hk-game-alert-approve"
                        onClick={() => handleAlertAction(d.id, true)}
                      >APROBAR</button>
                      <button
                        className="hk-game-alert-reject"
                        onClick={() => handleAlertAction(d.id, false)}
                      >RECHAZAR</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

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

      {/* Entrada directa a Hokage — siempre visible (Fase 6) */}
      <div className="hk-game-hokage">
        <form onSubmit={handleHokageSubmit} className="hk-game-hokage-form">
          <input
            ref={hokageInputRef}
            className="hk-game-hokage-input"
            value={hokageText}
            onChange={(e) => setHokageText(e.target.value)}
            placeholder={hokageAgent ? 'Pregunta a Hokage…' : 'Hokage no disponible'}
            disabled={!hokageAgent || hokageBusy}
          />
          <button
            type="submit"
            className="hk-game-hokage-send"
            disabled={!hokageText.trim() || hokageBusy || !hokageAgent}
            aria-label="Enviar a Hokage"
          >
            <IconSend className="hk-game-hokage-send-icon" />
          </button>
        </form>
        {hokageReply && (
          <div className="hk-game-hokage-reply">
            <span className="hk-game-hokage-reply-label">HOKAGE</span>
            <span className="hk-game-hokage-reply-text">{hokageReply}</span>
          </div>
        )}
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
