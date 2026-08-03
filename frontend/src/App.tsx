import { useState, useCallback } from 'react';
import type { ChatMsg, Building, Screen, BuildingSection } from './shared';
import { api, TopBar } from './shared';
import { useAppData } from './hooks/useAppData';
import { BootView, MenuView, MapView, BuildingView, CommsView, MissionsView, AlertsView, CrewView, VenturesView, ObjectivesView } from './views';
import { Toast } from './modals';

export default function App() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [activeBuilding, setActiveBuilding] = useState<Building | null>(null);
  const [section, setSection] = useState<BuildingSection>('chat');
  const [chatByAgent, setChatByAgent] = useState<Record<number, ChatMsg[]>>({});
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [toast, setToast] = useState('');

  const {
    agents, ventures, achievements, runs, messages, liveEvents,
    departments, objectives, xp, level, runtimeOn, pending, wsConnected, reload,
  } = useAppData();

  const show = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 3000);
  }, []);

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
      [agent.id]: [...(p[agent.id] || []), { role: 'agent', text, time: new Date().toLocaleTimeString('es-ES'), agentName: agent.name }],
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
    setTimeout(() => {
      reload.loadMessages();
      reload.loadRuns();
    }, 3000);
  }

  function enterBuilding(b: Building) {
    setActiveBuilding(b);
    setSection('chat');
    setScreen('building');
  }

  const xpNext = level * 1000;

  if (screen === 'boot') return <BootView onDone={() => setScreen('menu')} />;

  if (screen === 'menu') {
    return (
      <div className="hk-app">
        <MenuView
          level={level}
          xp={xp}
          xpNext={xpNext}
          agentsCount={agents.length}
          businessCount={ventures.length}
          pendingCount={pending.length}
          messagesCount={messages.length}
          runtimeOn={runtimeOn}
          connected={wsConnected}
          clock={new Date().toLocaleTimeString('es-ES', { hour12: false })}
          onToggleRuntime={toggleRuntime}
          onNavigate={setScreen}
        />
        <Toast message={toast} />
      </div>
    );
  }

  const titleFor: Record<Screen, string> = {
    boot: '',
    menu: '',
    map: 'Ecosistema',
    building: activeBuilding?.name || '',
    crew: 'Ship Crew',
    missions: 'Misiones',
    alerts: 'Alertas',
    comms: 'Ship Comms',
    ventures: 'Ventures',
    objetivos: 'Objetivos',
  };

  const buildingAgent = activeBuilding ? agents.find((a) => a.role === activeBuilding.role) : undefined;
  const pendingForAgent = buildingAgent ? pending.filter((d) => d.agent_id === buildingAgent.id) : [];

  return (
    <div className="hk-app">
      <TopBar
        title={titleFor[screen]}
        screen={screen}
        connected={wsConnected}
        clock={new Date().toLocaleTimeString('es-ES', { hour12: false })}
        pendingCount={pending.length}
        onBack={() => setScreen('map')}
        onMenu={() => setScreen('menu')}
        onAlerts={() => setScreen('alerts')}
      />
      <div className="hk-shell" style={{ maxWidth: screen === 'building' || screen === 'comms' ? 1180 : 760 }}>
        {screen === 'map' && (
          <MapView
            departments={departments}
            agents={agents}
            runs={runs}
            pending={pending}
            liveEvents={liveEvents}
            messagesCount={messages.length}
            connected={wsConnected}
            objectivesCount={objectives.filter((o) => o.status === 'active' || o.plan?.status === 'proposed').length}
            onEnterBuilding={enterBuilding}
            onGoComms={() => setScreen('comms')}
            onGoAlerts={() => setScreen('alerts')}
            onGoCrew={() => setScreen('crew')}
            onGoObjetivos={() => setScreen('objetivos')}
          />
        )}

        {screen === 'building' && activeBuilding && (
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
            pendingForAgent={pendingForAgent}
            onApprove={approve}
            onReject={reject}
            onRunNow={runNow}
          />
        )}

        {screen === 'objetivos' && (
          <ObjectivesView objectives={objectives} onReload={reload.loadObjectives} />
        )}
        {screen === 'ventures' && <VenturesView ventures={ventures} />}
        {screen === 'comms' && <CommsView agents={agents} messages={messages} liveEvents={liveEvents} />}
        {screen === 'missions' && <MissionsView level={level} xp={xp} xpNext={xpNext} achievements={achievements} />}
        {screen === 'alerts' && <AlertsView pending={pending} agents={agents} onApprove={approve} onReject={reject} onExpireAll={expireAll} />}
        {screen === 'crew' && <CrewView agents={agents} runs={runs} onEnterBuilding={enterBuilding} />}
      </div>
      <Toast message={toast} />
    </div>
  );
}
