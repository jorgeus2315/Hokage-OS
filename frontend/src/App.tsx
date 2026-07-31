import { useState, useEffect, useCallback } from 'react';
import type { Agent, Business, Decision, Achievement, AgentRun, CommMsg, WsEvent, WsEnvelope, ChatMsg, Building, Screen, BuildingSection } from './shared';
import { BUILDINGS } from './shared';
import { api, useWebSocket, TopBar } from './shared';
import { BootView, MenuView, MapView, BuildingView, CommsView, MissionsView, AlertsView, CrewView } from './views';
import { Toast } from './modals';

export default function App() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [messages, setMessages] = useState<CommMsg[]>([]);
  const [liveEvents, setLiveEvents] = useState<WsEvent[]>([]);
  const [clock, setClock] = useState('');
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);
  const [runtimeOn, setRuntimeOn] = useState(false);
  const [toast, setToast] = useState('');
  const [departments, setDepartments] = useState<Building[]>(BUILDINGS);

  const [activeBuilding, setActiveBuilding] = useState<Building | null>(null);
  const [section, setSection] = useState<BuildingSection>('chat');
  const [chatByAgent, setChatByAgent] = useState<Record<number, ChatMsg[]>>({});
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const pending = decisions.filter((d) => d.status === 'proposed' || d.status === 'pending');
  const show = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 3000);
  }, []);

  const loadAgents = useCallback(async () => {
    const data = await api.agents();
    if (data) setAgents(data);
  }, []);
  const loadBusinesses = useCallback(async () => {
    const data = await api.businesses();
    if (data) setBusinesses(data);
  }, []);
  const loadDecisions = useCallback(async () => {
    const data = await api.decisions();
    if (data) setDecisions(data);
  }, []);
  const loadAchievements = useCallback(async () => {
    const data = await api.achievements();
    if (data) setAchievements(data);
  }, []);
  const loadRuns = useCallback(async () => {
    const data = await api.agentRuns();
    if (data) setRuns(data);
  }, []);
  const loadMessages = useCallback(async () => {
    const data = await api.messages();
    if (data) setMessages(data);
  }, []);
  const loadProgress = useCallback(async () => {
    const data = await api.progress();
    if (data && data.length > 0) {
      setXp(data[0].xp);
      setLevel(data[0].level);
    }
  }, []);
  const loadDepartments = useCallback(async () => {
    const data = await api.departments();
    if (data && data.length > 0) setDepartments(data);
  }, []);

  const loadRuntimeStatus = useCallback(async () => {
    const data = await api.runtimeStatus();
    if (data) setRuntimeOn(data.running);
  }, []);

  // El backend envía siempre el sobre { type, data, timestamp }.
  // Para 'agent.event' el AgentEvent real (con su propio type/from/payload) viaja en `data`.
  const handleWsEvent = useCallback(
    (envelope: WsEnvelope) => {
      if (envelope.type === 'agent.event' && envelope.data && typeof envelope.data === 'object') {
        const inner = envelope.data as WsEvent;
        setLiveEvents((prev) => [inner, ...prev].slice(0, 50));
        if (inner.type === 'decision.created') loadDecisions();
        if (inner.type === 'agent.task.done' || inner.type === 'agent.task.start' || inner.type === 'agent.task.error') loadRuns();
        return;
      }
      if (envelope.type === 'message.new') loadMessages();
      if (envelope.type === 'decision.new' || envelope.type === 'decision.approved' || envelope.type === 'decision.rejected') loadDecisions();
    },
    [loadMessages, loadDecisions, loadRuns]
  );

  const wsConnected = useWebSocket(handleWsEvent);

  useEffect(() => {
    loadDepartments();
    loadAgents();
    loadBusinesses();
    loadDecisions();
    loadAchievements();
    loadRuns();
    loadMessages();
    loadProgress();
    loadRuntimeStatus();
    const clockTimer = setInterval(() => setClock(new Date().toLocaleTimeString('es-ES', { hour12: false })), 1000);
    const pollTimer = setInterval(() => {
      loadDecisions();
      loadRuns();
    }, 15000);
    return () => {
      clearInterval(clockTimer);
      clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    loadMessages();
  }

  async function approve(id: number) {
    await api.approve(id);
    loadDecisions();
    show('Decisión aprobada');
  }
  async function reject(id: number) {
    await api.reject(id);
    loadDecisions();
    show('Decisión rechazada');
  }
  async function toggleRuntime() {
    if (runtimeOn) await api.runtimeStop();
    else await api.runtimeStart();
    setRuntimeOn(!runtimeOn);
    show(runtimeOn ? 'Runtime detenido' : 'Runtime iniciado');
  }
  async function runNow() {
    const agent = activeBuilding && agents.find((a) => a.role === activeBuilding.role);
    if (!agent) return;
    await api.runNow(agent.id);
    show(`${agent.name} ejecutando…`);
    setTimeout(() => {
      loadMessages();
      loadRuns();
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
          businessCount={businesses.length}
          pendingCount={pending.length}
          messagesCount={messages.length}
          runtimeOn={runtimeOn}
          connected={wsConnected}
          clock={clock}
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
  };

  const buildingAgent = activeBuilding ? agents.find((a) => a.role === activeBuilding.role) : undefined;
  const runsForAgent = buildingAgent ? runs.filter((r) => r.agent_id === buildingAgent.id) : [];
  const decisionsForAgent = buildingAgent ? decisions.filter((d) => d.agent_id === buildingAgent.id) : [];
  const pendingForAgent = buildingAgent ? pending.filter((d) => d.agent_id === buildingAgent.id) : [];
  const messagesForAgent = buildingAgent ? messages.filter((m) => m.sender_id === buildingAgent.id) : [];

  return (
    <div className="hk-app">
      <TopBar
        title={titleFor[screen]}
        screen={screen}
        connected={wsConnected}
        clock={clock}
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
            onEnterBuilding={enterBuilding}
            onGoComms={() => setScreen('comms')}
            onGoAlerts={() => setScreen('alerts')}
            onGoCrew={() => setScreen('crew')}
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
            runs={runsForAgent}
            decisions={decisionsForAgent}
            pendingForAgent={pendingForAgent}
            messagesForAgent={messagesForAgent}
            onApprove={approve}
            onReject={reject}
            onRunNow={runNow}
          />
        )}

        {screen === 'comms' && <CommsView agents={agents} messages={messages} liveEvents={liveEvents} />}

        {screen === 'missions' && <MissionsView level={level} xp={xp} xpNext={xpNext} achievements={achievements} />}

        {screen === 'alerts' && <AlertsView pending={pending} agents={agents} onApprove={approve} onReject={reject} />}

        {screen === 'crew' && <CrewView agents={agents} runs={runs} onEnterBuilding={enterBuilding} />}
      </div>
      <Toast message={toast} />
    </div>
  );
}
