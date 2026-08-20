import { useState, useCallback, useEffect, useRef } from 'react';
import type { Building, BuildingSection, ChatMsg, Screen } from '../shared/types';
import { api } from '../shared/api';
import { Led } from '../shared/ui';
import { GameHUD } from '../shared/GameHUD';
import { Toast } from '../modals';
import { useAppData } from '../hooks/useAppData';
import { useWorldState } from '../hooks/useWorldState';
import { WorldCanvas } from '../world/WorldCanvas';
import { PanelRegistry, PanelContext } from '../registries/PanelRegistry';
import { defaultSectionFor } from '../registries/buildingSectionRegistry';
import { BuildingView } from './BuildingView';
import { CommsView } from './CommsView';
import { CrewView } from './CrewView';
import { AlertsView } from './AlertsView';
import { VenturesView } from './VenturesView';
import { ObjectivesView } from './ObjectivesView';
import { ConfigView } from './ConfigView';
import { HokageConsoleView } from './HokageConsoleView';
import { MenuView } from './MenuView';
import { AgentPanel } from './AgentPanel';

const RECENT_MS = 5 * 60 * 1000;

type OverlayScreen = 'crew' | 'alerts' | 'comms' | 'ventures' | 'objetivos' | 'config' | 'hokage';

export function GameLayout() {
  const [screen, setScreen] = useState<Screen>('map');
  const [showMenu, setShowMenu] = useState(false);
  const [activeBuilding, setActiveBuilding] = useState<Building | null>(null);
  const [section, setSection] = useState<BuildingSection>('chat');
  const [chatByAgent, setChatByAgent] = useState<Record<number, ChatMsg[]>>({});
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString('es-ES', { hour12: false }),
  );

  const {
    agents, ventures, runs, messages, liveEvents,
    departments, objectives, metrics, runtimeOn, pending, wsConnected, agentStates, reload,
  } = useAppData();

  useEffect(() => {
    const t = setInterval(
      () => setClock(new Date().toLocaleTimeString('es-ES', { hour12: false })),
      1000,
    );
    return () => clearInterval(t);
  }, []);

  const show = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 3000);
  }, []);

  function enterBuilding(b: Building) {
    setActiveBuilding(b);
    // Fase 9 (A1): la sección inicial es el primer tab que declara la sala en el registro
    // data-driven. Sin condicionales por tipo/rol/nombre en el llamador.
    setSection(defaultSectionFor(b));
    setScreen('building');
  }

  const { hub, rooms, tokens, rippleEvents, allDepts } = useWorldState({
    departments,
    agents,
    runs,
    pending,
    liveEvents,
    agentStates,
    onEnterBuilding: enterBuilding,
  });

  // Estado para AgentPanel overlay
  const [agentPanel, setAgentPanel] = useState<{ agent: import('../shared/types').Agent; building: import('../shared/types').Building } | null>(null);

  function openAgentPanel(agent: import('../shared/types').Agent) {
    const building = allDepts.find((b) => b.role === agent.role);
    if (building) setAgentPanel({ agent, building });
  }

  function closeAgentPanel() {
    setAgentPanel(null);
  }

  // Fase 5 — restaurar layout persistido
  const [pendingLayout, setPendingLayout] = useState<{ screen: Screen; buildingKey: string | null } | null>(null);
  const layoutAppliedRef = useRef(false);

  useEffect(() => {
    api.getLayout().then((data) => { if (data) setPendingLayout(data); });
  }, []);

  useEffect(() => {
    if (!pendingLayout || layoutAppliedRef.current) return;
    if (screen !== 'map') { layoutAppliedRef.current = true; return; }
    if (pendingLayout.screen === 'building' && pendingLayout.buildingKey) {
      const building = allDepts.find((b) => b.id === pendingLayout.buildingKey);
      if (!building) return;
      enterBuilding(building);
    } else if (pendingLayout.screen !== 'map') {
      setScreen(pendingLayout.screen);
    }
    layoutAppliedRef.current = true;
  }, [pendingLayout, allDepts, screen]);

  useEffect(() => {
    if (!layoutAppliedRef.current) return;
    api.setLayout(screen, screen === 'building' ? (activeBuilding?.id ?? null) : null);
  }, [screen, activeBuilding]);

  async function sendChat() {
    if (!chatInput.trim() || !activeBuilding || chatLoading) return;
    const agent = agents.find((a) => a.role === activeBuilding.role);
    if (!agent) return;
    const msg = chatInput.trim();
    setChatInput('');
    const time = new Date().toLocaleTimeString('es-ES');
    setChatByAgent((p) => ({ ...p, [agent.id]: [...(p[agent.id] || []), { role: 'user', text: msg, time }] }));
    setChatLoading(true);
    const result = await api.ask(agent.id, msg);
    const text = result?.response || 'Error de conexión. Verifica que el backend esté activo.';
    setChatByAgent((p) => ({
      ...p,
      [agent.id]: [
        ...(p[agent.id] || []),
        { role: 'agent', text, time: new Date().toLocaleTimeString('es-ES'), agentName: agent.name },
      ],
    }));
    setChatLoading(false);
    reload.loadMessages();
  }

  async function approve(id: number) {
    await api.approve(id);
    reload.loadDecisions();
    show('Decisión aprobada');
  }

  async function reject(id: number) {
    await api.reject(id);
    reload.loadDecisions();
    show('Decisión rechazada');
  }

  async function expireAll() {
    const result = await api.expireOldDecisions(0);
    reload.loadDecisions();
    show(result ? `${result.expired} alertas limpiadas` : 'Error al limpiar');
  }

  async function toggleRuntime() {
    if (runtimeOn) await api.runtimeStop();
    else await api.runtimeStart();
    show(runtimeOn ? 'Runtime detenido' : 'Runtime iniciado');
    reload.loadRuntimeStatus();
  }

  async function runNow() {
    const agent = activeBuilding && agents.find((a) => a.role === activeBuilding.role);
    if (!agent) return;
    await api.runNow(agent.id);
    show(`${agent.name} ejecutando…`);
    setTimeout(() => { reload.loadMessages(); reload.loadRuns(); }, 3000);
  }

  const isWorking = (agentId: number) => {
    const last = runs.find((r) => r.agent_id === agentId);
    return !!last && Date.now() - new Date(last.started_at).getTime() < RECENT_MS;
  };

  const roleColors = Object.fromEntries(allDepts.map((d) => [d.role, d.color]));

  const buildingAgent = activeBuilding ? agents.find((a) => a.role === activeBuilding.role) : undefined;
  const pendingForAgent = buildingAgent ? pending.filter((d) => d.agent_id === buildingAgent.id) : [];

  // ═══════════════════════════════════════════════════════════════════
  // REGISTRO DE PANELES — Fase 4: cada panel es una entrada de registro,
  // no una rama condicional en el JSX. El estado (qué está abierto) sigue
  // siendo React local; la Fase 5 persistirá en backend.
  // ═══════════════════════════════════════════════════════════════════

  const panelRegistry = new PanelRegistry<string>();

  // Contexto compartido que todos los paneles pueden leer
  const panelContext: PanelContext = {
    agents, ventures, runs, messages, liveEvents, departments, objectives, metrics,
    runtimeOn, wsConnected, clock, pending, activeBuilding, buildingAgent, pendingForAgent,
    section, chatByAgent, chatInput, chatLoading,
    onChangeSection: setSection, onChangeChatInput: setChatInput, onSendChat: sendChat,
    onApprove: approve, onReject: reject, onRunNow: runNow, onAgentUpdated: reload.loadAgents,
    reload, setScreen, setShowMenu, setActiveBuilding, setSection, setChatByAgent,
    setChatInput, setChatLoading, enterBuilding, approve, reject, expireAll,
    toggleRuntime, runNow, sendChat, showToast: show, roleColors,
  };

  // LEFT — Rail de agentes (Ship Crew)
  panelRegistry.register('left-rail', {
    title: 'Ship Crew',
    position: 'left',
    render: () => (
      <div className="hk-game-overlay hk-game-overlay--left">
        <div className="hk-game-glass" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: '100%' }}>
          <div className="hk-game-rail-title">
            <Led state={wsConnected ? 'on' : 'idle'} />
            SHIP CREW · {agents.length}
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {agents.map((a) => {
              const building = allDepts.find((b) => b.role === a.role);
              const last = runs.find((r) => r.agent_id === a.id);
              const working = isWorking(a.id);
              const color = building?.color || 'var(--signal)';
              const activity = agentStates[a.id]?.activity ?? (working ? 1 : 0);
              let timeAgo = '';
              if (last) {
                const mins = Math.round((Date.now() - new Date(last.started_at).getTime()) / 60000);
                timeAgo = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
              }
              const isBusinessAgent = building && building.type !== 'system' && a.role !== 'ceo';
              // Roadmap Fase 3 (D4): decisiones pendientes reales de este agente.
              const pendingCount = pending.filter((d) => d.agent_id === a.id).length;

              return (
                <div
                  key={a.id}
                  className={`hk-game-agent-row${working ? ' hk-game-agent-row--active' : ''}`}
                  style={{ borderLeftColor: working ? color : 'transparent' }}
                  onClick={() => building && enterBuilding(building)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && building) {
                      e.preventDefault();
                      enterBuilding(building);
                    }
                  }}
                >
                  <span
                    className={`hk-game-agent-dot${working ? ' hk-game-agent-dot--active' : ''}`}
                    style={working ? { background: color, boxShadow: `0 0 5px ${color}` } : {}}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hk-game-agent-name" style={{ color: working ? color : undefined }}>
                      {a.name}
                    </div>
                    <div className="hk-game-agent-role">{a.role}</div>
                    {last && (
                      <div className="hk-game-agent-action">
                        {(last.action || 'En espera').slice(0, 26)}
                      </div>
                    )}
                    <div
                      className="hk-bar"
                      style={{
                        marginTop: 4, height: 3, background: 'var(--void-deep)',
                        border: '1px solid var(--line)', borderRadius: 2, overflow: 'hidden',
                      }}
                    >
                      <div
                        className="hk-bar-fill"
                        style={{
                          width: `${Math.round(activity * 100)}%`, height: '100%',
                          background: `linear-gradient(90deg, var(--good-dim), var(--good))`,
                          boxShadow: `0 0 6px var(--good)`, transition: 'width 0.4s ease',
                        }}
                      />
                    </div>
                  </div>
                  {pendingCount > 0 && (
                    <span
                      className="hk-game-agent-alert"
                      title={`${pendingCount} decisión${pendingCount > 1 ? 'es' : ''} pendiente${pendingCount > 1 ? 's' : ''}`}
                      style={{
                        marginLeft: 8, minWidth: 16, height: 16, padding: '0 5px',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace',
                        color: '#fff', background: 'var(--ember)', borderRadius: 8,
                        boxShadow: '0 0 6px var(--ember-glow)',
                      }}
                    >
                      {pendingCount}
                    </span>
                  )}
                  {working ? (
                    <span className="hk-game-badge hk-game-badge--live">LIVE</span>
                  ) : timeAgo ? (
                    <span className="hk-game-badge hk-game-badge--idle">{timeAgo}</span>
                  ) : null}
                  {isBusinessAgent && (
                    <button
                      className="hk-game-agent-panel-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openAgentPanel(a);
                      }}
                      title="Ver panel del agente"
                      style={{
                        marginLeft: 8, padding: '4px 8px', fontSize: 10,
                        background: 'transparent', border: '1px solid var(--border)',
                        borderRadius: 3, color: 'var(--ink-dim)', cursor: 'pointer',
                        fontFamily: 'IBM Plex Mono, monospace',
                      }}
                    >
                      👁
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    ),
  });

  // BOTTOM-LEFT — Acciones rápidas
  panelRegistry.register('bottom-actions', {
    title: 'Acciones',
    position: 'bottom-left',
    render: () => (
      <div className="hk-game-overlay hk-game-overlay--bottom-left">
        <div className="hk-game-actions-row">
          <button
            className={`hk-game-action-btn${pending.length > 0 ? ' hk-game-action-btn--alert' : ''}`}
            onClick={() => setScreen('alerts')}
          >
            ⚠{pending.length > 0 ? ` ${pending.length}` : ' 0'}
            <span className="hk-game-action-label">ALERTAS</span>
          </button>
          <button className="hk-game-action-btn" onClick={() => setScreen('comms')}>
            ◈
            <span className="hk-game-action-label">COMMS</span>
          </button>
          <button
            className={`hk-game-action-btn${objectives.filter((o) => o.status === 'active').length > 0 ? ' hk-game-action-btn--signal' : ''}`}
            onClick={() => setScreen('objetivos')}
          >
            ◎
            <span className="hk-game-action-label">OBJETIVOS</span>
          </button>
          <button className="hk-game-action-btn" onClick={() => setScreen('ventures')}>
            ⬡
            <span className="hk-game-action-label">VENTURES</span>
          </button>
        </div>
      </div>
    ),
  });

  // RIGHT — Log de sistema
  panelRegistry.register('system-log', {
    title: 'Sistema en vivo',
    position: 'right',
    render: () => (
      <div className={`hk-game-overlay hk-game-overlay--log${screen === 'building' && !!activeBuilding ? ' hk-game-overlay--log-hidden' : ''}`}>
        <div className="hk-game-log">
          <div className="hk-game-log-header">
            <span
              className="hk-led"
              style={{
                background: wsConnected ? 'var(--good)' : 'var(--ember)',
                boxShadow: wsConnected ? '0 0 5px var(--good)' : '0 0 5px var(--ember)',
              }}
            />
            <span>SISTEMA EN VIVO</span>
            <span style={{ marginLeft: 'auto', color: 'var(--ink-faint)', fontSize: 8 }}>
              {liveEvents.length}
            </span>
          </div>
          <div className="hk-game-log-body">
            {liveEvents.length === 0 ? (
              <div className="hk-game-log-empty">Sin actividad…</div>
            ) : (
              liveEvents.slice(0, 28).map((e) => {
                const isError = e.type?.includes('error');
                const isDone = e.type?.includes('done') || e.type?.includes('created');
                const iconColor = isError ? 'var(--ember)' : isDone ? 'var(--good)' : 'var(--signal)';
                const icon = isError ? '✕' : isDone ? '✓' : '▶';
                let timeAgo = '';
                if (e.timestamp) {
                  const ms = Date.now() - new Date(e.timestamp).getTime();
                  const secs = Math.floor(ms / 1000);
                  if (secs < 60) timeAgo = `${secs}s`;
                  else if (secs < 3600) timeAgo = `${Math.floor(secs / 60)}m`;
                  else timeAgo = `${Math.floor(secs / 3600)}h`;
                }
                return (
                  <div key={e._cid ?? `${e.type}-${e.timestamp}`} className="hk-game-log-entry">
                    <span className="hk-game-log-icon" style={{ color: iconColor }}>{icon}</span>
                    <div className="hk-game-log-content">
                      <div className="hk-game-log-type" style={{ color: iconColor }}>
                        {e.type}
                      </div>
                      {e.from && <div className="hk-game-log-from">{e.from}</div>}
                    </div>
                    {timeAgo && <span className="hk-game-log-time">{timeAgo}</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    ),
  });

  // BUILDING — Panel de sala seleccionada
  const showBuildingPanel = screen === 'building' && !!activeBuilding;
  panelRegistry.register('building-panel', {
    title: activeBuilding?.name ?? 'Sala',
    position: 'building',
    render: () => showBuildingPanel ? (
      <div className="hk-game-overlay hk-game-overlay--panel">
        <div className="hk-game-right-panel">
          <div className="hk-game-panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: activeBuilding.color, boxShadow: `0 0 8px ${activeBuilding.color}`,
                }}
              />
              <span className="hk-game-panel-title">{activeBuilding.name}</span>
            </div>
            <button className="hk-game-panel-close" onClick={() => setScreen('map')} aria-label="Cerrar panel">
              ✕
            </button>
          </div>
          <div className="hk-game-panel-body">
            <BuildingView
              building={activeBuilding}
              agent={buildingAgent}
              section={section}
              onChangeSection={setSection}
              chatMsgs={buildingAgent ? chatByAgent[buildingAgent.id] || [] : []}
              chatInput={chatInput}
              chatLoading={chatLoading}
              onChangeChatInput={setChatInput}
              onSendChat={sendChat}
              liveEvents={liveEvents}
              ventures={ventures}
              pendingForAgent={pendingForAgent}
              onApprove={approve}
              onReject={reject}
              onRunNow={runNow}
              onAgentUpdated={reload.loadAgents}
            />
          </div>
        </div>
      </div>
    ) : null,
  });

  // OVERLAYS — Pantallas secundarias de pantalla completa
  const overlayRegistry = new PanelRegistry<OverlayScreen>();
  overlayRegistry.register('objetivos', {
    title: 'Objetivos',
    render: () => <ObjectivesView objectives={objectives} onReload={reload.loadObjectives} />,
  });
  overlayRegistry.register('ventures', {
    title: 'Ventures',
    render: () => <VenturesView ventures={ventures} agents={agents} />,
  });
  overlayRegistry.register('comms', {
    title: 'Ship Comms',
    render: () => <CommsView agents={agents} messages={messages} liveEvents={liveEvents} />,
  });
  overlayRegistry.register('alerts', {
    title: 'Alertas',
    render: () => (
      <AlertsView
        pending={pending}
        agents={agents}
        buildings={allDepts}
        onApprove={approve}
        onReject={reject}
        onExpireAll={expireAll}
      />
    ),
  });
  overlayRegistry.register('crew', {
    title: 'Ship Crew',
    render: () => <CrewView agents={agents} runs={runs} buildings={allDepts} onEnterBuilding={enterBuilding} />,
  });
  overlayRegistry.register('config', {
    title: 'Configuración Global',
    render: () => <ConfigView agents={agents} roleColors={roleColors} onAgentUpdated={reload.loadAgents} />,
  });
  overlayRegistry.register('hokage', {
    title: 'Torre Hokage',
    render: () => <HokageConsoleView ventures={ventures} liveEvents={liveEvents} />,
  });

  const showOverlay = screen !== 'map' && screen !== 'building';
  const activeOverlay = showOverlay ? overlayRegistry.get(screen as OverlayScreen) : undefined;
  const overlayTitle = activeOverlay?.title ?? '';

  return (
    <div className="hk-game">
      <GameHUD
        agents={agents}
        pending={pending}
        messages={messages}
        objectives={objectives}
        metrics={metrics}
        runtimeOn={runtimeOn}
        connected={wsConnected}
        clock={clock}
        onToggleRuntime={toggleRuntime}
        onMenu={() => setShowMenu(true)}
        onAlerts={() => { setShowMenu(false); setScreen('alerts'); }}
        onComms={() => { setShowMenu(false); setScreen('comms'); }}
        onCrew={() => { setShowMenu(false); setScreen('crew'); }}
        onObjectives={() => { setShowMenu(false); setScreen('objetivos'); }}
        onConfig={() => { setShowMenu(false); setScreen('config'); }}
        onApprove={approve}
        onReject={reject}
      />

      <div className="hk-game-scene">
        {/* Canvas siempre visible como fondo — nunca se desmonta */}
        <WorldCanvas hub={hub} rooms={rooms} tokens={tokens} events={rippleEvents} />

        {/* Paneles registrados: izquierda, abajo-izquierda, derecha, edificio */}
        {panelRegistry.getByPosition('left').map((p) => p.render(panelContext))}
        {panelRegistry.getByPosition('bottom-left').map((p) => p.render(panelContext))}
        {panelRegistry.getByPosition('right').map((p) => p.render(panelContext))}
        {panelRegistry.getByPosition('building').map((p) => p.render(panelContext))}

        {/* Overlay de pantalla secundaria */}
        {showOverlay && (
          <div className="hk-game-screen-overlay">
            <div className="hk-game-screen-header">
              <span className="hk-game-screen-title">{overlayTitle}</span>
              <button className="hk-game-panel-close" onClick={() => setScreen('map')} aria-label="Volver al mapa">
                ✕
              </button>
            </div>
            <div className="hk-game-screen-body">
              {activeOverlay?.render(panelContext)}
            </div>
          </div>
        )}

        {/* AgentPanel overlay (Fase 10) — solo para agentes de negocio, no Hermes/CEO */}
        {agentPanel && (
          <div className="hk-game-screen-overlay hk-agent-panel-overlay">
            <AgentPanel
              agent={agentPanel.agent}
              building={agentPanel.building}
              agentStates={agentStates}
              onClose={closeAgentPanel}
              onAgentUpdated={reload.loadAgents}
            />
          </div>
        )}

        {/* Menú principal como overlay */}
        {showMenu && (
          <div className="hk-game-menu-overlay">
            <MenuView
              agentsCount={agents.length}
              businessCount={ventures.length}
              pendingCount={pending.length}
              messagesCount={messages.length}
              runtimeOn={runtimeOn}
              connected={wsConnected}
              clock={clock}
              onToggleRuntime={toggleRuntime}
              onNavigate={(s) => {
                setShowMenu(false);
                if (s === 'menu') return;
                setScreen(s);
              }}
            />
            <button className="hk-game-menu-close" onClick={() => setShowMenu(false)} aria-label="Cerrar menú">
              ✕ CERRAR
            </button>
          </div>
        )}
      </div>

      <Toast message={toast} />
    </div>
  );
}