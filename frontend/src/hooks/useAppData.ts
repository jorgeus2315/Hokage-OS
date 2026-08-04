import { useState, useEffect, useCallback, useRef } from 'react';
import type { Agent, Decision, Achievement, AgentRun, CommMsg, WsEvent, Building, Venture, Objective, MetricsSummary } from '../shared/types';
import { api, useWebSocket } from '../shared';

const EMPTY_METRICS: MetricsSummary = { ai_cost_today_usd: 0, messages_today: 0, pending_decisions: 0, urgent_decisions: 0 };

export type AppData = {
  agents: Agent[];
  ventures: Venture[];
  decisions: Decision[];
  achievements: Achievement[];
  runs: AgentRun[];
  messages: CommMsg[];
  liveEvents: WsEvent[];
  departments: Building[];
  objectives: Objective[];
  metrics: MetricsSummary;
  xp: number;
  level: number;
  runtimeOn: boolean;
  pending: Decision[];
  wsConnected: boolean;
  reload: {
    loadAgents: () => Promise<void>;
    loadVentures: () => Promise<void>;
    loadDecisions: () => Promise<void>;
    loadAchievements: () => Promise<void>;
    loadRuns: () => Promise<void>;
    loadMessages: () => Promise<void>;
    loadProgress: () => Promise<void>;
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
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [messages, setMessages] = useState<CommMsg[]>([]);
  const [liveEvents, setLiveEvents] = useState<WsEvent[]>([]);
  const [departments, setDepartments] = useState<Building[]>([]);
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);
  const [runtimeOn, setRuntimeOn] = useState(false);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [metrics, setMetrics] = useState<MetricsSummary>(EMPTY_METRICS);

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
      };
      if (snap.agents)       setAgents(snap.agents);
      if (snap.decisions)    setDecisions(snap.decisions);
      if (snap.recent_events) setLiveEvents(snap.recent_events.slice(0, 50));
      if (snap.departments)  setDepartments(
        snap.departments.map((d: any) => ({
          id: d.key, name: d.name, desc: d.desc, role: d.role,
          glyph: d.glyph, color: d.color, db_id: d.id,
          pos_x: d.pos_x, pos_y: d.pos_y, is_hub: d.is_hub === 1,
        }))
      );
      return;
    }

    if (envelope.type === 'agent.event' && envelope.data && typeof envelope.data === 'object') {
      const inner: WsEvent = { ...(envelope.data as WsEvent), _cid: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
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
    loadAchievements();
    loadRuns();
    loadMessages();
    loadProgress();
    loadRuntimeStatus();
    loadObjectives();
    loadMetrics();
    const t = setInterval(loadMetrics, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = decisions.filter((d) => d.status === 'proposed' || d.status === 'pending');

  return {
    agents, ventures, decisions, achievements, runs, messages, liveEvents,
    departments, objectives, metrics, xp, level, runtimeOn, pending, wsConnected,
    reload: { loadAgents, loadVentures, loadDecisions, loadAchievements, loadRuns, loadMessages, loadProgress, loadDepartments, loadRuntimeStatus, loadObjectives, loadMetrics },
  };
}
