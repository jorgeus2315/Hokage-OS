import { useState, useEffect, useCallback, useRef } from 'react';
import type { Agent, Decision, AgentRun, CommMsg, WsEvent, Building, Venture, Objective, MetricsSummary, AgentRuntimeState } from '../shared/types';
import { api, useWebSocket } from '../shared';

const EMPTY_METRICS: MetricsSummary = { ai_cost_today_usd: 0, messages_today: 0, pending_decisions: 0, urgent_decisions: 0 };

export type AppData = {
  agents: Agent[];
  ventures: Venture[];
  decisions: Decision[];
  runs: AgentRun[];
  messages: CommMsg[];
  liveEvents: WsEvent[];
  departments: Building[];
  objectives: Objective[];
  metrics: MetricsSummary;
  agentStates: Record<number, AgentRuntimeState>;  // K.4: estado real por agentId (fuente: backend)
  runtimeOn: boolean;
  pending: Decision[];
  wsConnected: boolean;
  reload: {
    loadAgents: () => Promise<void>;
    loadVentures: () => Promise<void>;
    loadDecisions: () => Promise<void>;
    loadRuns: () => Promise<void>;
    loadMessages: () => Promise<void>;
    loadDepartments: () => Promise<void>;
    loadRuntimeStatus: () => Promise<void>;
    loadObjectives: () => void;
    loadMetrics: () => Promise<void>;
  };
};

export function useAppData(): AppData {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ventures, setVentures] = useState<Venture[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [messages, setMessages] = useState<CommMsg[]>([]);
  const [liveEvents, setLiveEvents] = useState<WsEvent[]>([]);
  const [departments, setDepartments] = useState<Building[]>([]);
  const [runtimeOn, setRuntimeOn] = useState(false);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [metrics, setMetrics] = useState<MetricsSummary>(EMPTY_METRICS);
  const [agentStates, setAgentStates] = useState<Record<number, AgentRuntimeState>>({});

  const loadAgents = useCallback(async () => {
    const data = await api.agents();
    if (data) setAgents(data);
  }, []);
  const loadVentures = useCallback(async () => {
    const data = await api.ventures();
    if (data) setVentures(data);
  }, []);
  const loadDecisions = useCallback(async () => {
    const data = await api.decisions();
    if (data) setDecisions(data);
  }, []);
  const loadRuns = useCallback(async () => {
    const data = await api.agentRuns();
    if (data) setRuns(data);
  }, []);
  const loadMessages = useCallback(async () => {
    const data = await api.messages();
    if (data) setMessages(data);
  }, []);
  const loadDepartments = useCallback(async () => {
    const data = await api.departments();
    if (data && data.length > 0) setDepartments(data);
  }, []);
  const loadRuntimeStatus = useCallback(async () => {
    const data = await api.runtimeStatus();
    if (data) setRuntimeOn(data.running);
  }, []);
  const loadMetrics = useCallback(async () => {
    const data = await api.metricsSummary();
    if (data) setMetrics(data);
  }, []);
  const objectivesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadObjectives = useCallback(() => {
    if (objectivesTimer.current) clearTimeout(objectivesTimer.current);
    objectivesTimer.current = setTimeout(async () => {
      const data = await api.objectives();
      if (data) setObjectives(data);
    }, 800);
  }, []);

  const handleWsEvent = useCallback((envelope: { type: string; data?: unknown }) => {
    // Snapshot inicial: sustituye el estado REST con datos frescos del servidor
    if (envelope.type === 'initial_snapshot' && envelope.data && typeof envelope.data === 'object') {
      const snap = envelope.data as {
        agents?: Agent[];
        decisions?: Decision[];
        departments?: Building[];
        recent_events?: WsEvent[];
        agent_states?: AgentRuntimeState[];
        ventures?: Venture[];
        runs?: AgentRun[];
      };
      if (snap.agents)       setAgents(snap.agents);
      if (snap.decisions)    setDecisions(snap.decisions);
      // Roadmap Fase 3 (D1): globales del primer paint desde el snapshot. REST (loadVentures/
      // loadRuns en el mount) sigue como fallback y reconciliación; no se elimina.
      if (snap.ventures)     setVentures(snap.ventures);
      if (snap.runs)         setRuns(snap.runs);
      if (snap.agent_states) setAgentStates(Object.fromEntries(snap.agent_states.map((s) => [s.agentId, s])));
      if (snap.recent_events) setLiveEvents(snap.recent_events.slice(0, 50));
      if (snap.departments)  setDepartments(
        snap.departments.map((d: any) => ({
          id: d.key, name: d.name, desc: d.desc, role: d.role,
          glyph: d.glyph, color: d.color, db_id: d.id,
          pos_x: d.pos_x, pos_y: d.pos_y, is_hub: d.is_hub === 1,
          // Fase 8: sin esto, building.type queda undefined tras conectar el WS y la
          // Sala de Máquinas dejaría de detectarse como 'system' (regresión Fase 7→8).
          type: d.type ?? 'business',
        }))
      );
      return;
    }

    if (envelope.type === 'agent.event' && envelope.data && typeof envelope.data === 'object') {
      const inner: WsEvent = { ...(envelope.data as WsEvent), _cid: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      // K.4: delta de estado real. El backend es la fuente de verdad; aquí solo se almacena.
      if (inner.type === 'agent.state.changed') {
        const st = inner.payload?.state as AgentRuntimeState | undefined;
        if (st) setAgentStates((prev) => ({ ...prev, [st.agentId]: st }));
        return;   // no es un evento de feed; no engrosar liveEvents
      }
      setLiveEvents((prev) => [inner, ...prev].slice(0, 50));
      if (inner.type === 'decision.created') { loadDecisions(); loadMetrics(); }
      if (inner.type === 'agent.task.done' || inner.type === 'agent.task.start' || inner.type === 'agent.task.error') loadRuns();
    if (inner.type === 'objective.achieved' || inner.type === 'objective.created' || inner.type === 'objective.approved') loadObjectives();
      return;
    }
    if (envelope.type === 'message.new') { loadMessages(); loadMetrics(); }
    if (envelope.type === 'decision.new' || envelope.type === 'decision.approved' || envelope.type === 'decision.rejected') { loadDecisions(); loadMetrics(); }
  }, [loadDecisions, loadRuns, loadMessages, loadObjectives, loadMetrics]);

  const wsConnected = useWebSocket(handleWsEvent);

  useEffect(() => {
    loadDepartments();
    loadAgents();
    loadVentures();
    loadDecisions();
    loadRuns();
    loadMessages();
    loadRuntimeStatus();
    loadObjectives();
    loadMetrics();
    const t = setInterval(loadMetrics, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = decisions.filter((d) => d.status === 'proposed' || d.status === 'pending');

  return {
    agents, ventures, decisions, runs, messages, liveEvents,
    departments, objectives, metrics, agentStates, runtimeOn, pending, wsConnected,
    reload: { loadAgents, loadVentures, loadDecisions, loadRuns, loadMessages, loadDepartments, loadRuntimeStatus, loadObjectives, loadMetrics },
  };
}
