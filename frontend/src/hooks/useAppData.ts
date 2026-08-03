import { useState, useEffect, useCallback } from 'react';
import type { Agent, Decision, Achievement, AgentRun, CommMsg, WsEvent, Building, Venture } from '../shared/types';
import { api, useWebSocket } from '../shared';

export type AppData = {
  agents: Agent[];
  ventures: Venture[];
  decisions: Decision[];
  achievements: Achievement[];
  runs: AgentRun[];
  messages: CommMsg[];
  liveEvents: WsEvent[];
  departments: Building[];
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
      const inner = envelope.data as WsEvent;
      setLiveEvents((prev) => [inner, ...prev].slice(0, 50));
      if (inner.type === 'decision.created') loadDecisions();
      if (inner.type === 'agent.task.done' || inner.type === 'agent.task.start' || inner.type === 'agent.task.error') loadRuns();
      return;
    }
    if (envelope.type === 'message.new') loadMessages();
    if (envelope.type === 'decision.new' || envelope.type === 'decision.approved' || envelope.type === 'decision.rejected') loadDecisions();
  }, [loadDecisions, loadRuns, loadMessages]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = decisions.filter((d) => d.status === 'proposed' || d.status === 'pending');

  return {
    agents, ventures, decisions, achievements, runs, messages, liveEvents,
    departments, xp, level, runtimeOn, pending, wsConnected,
    reload: { loadAgents, loadVentures, loadDecisions, loadAchievements, loadRuns, loadMessages, loadProgress, loadDepartments, loadRuntimeStatus },
  };
}
