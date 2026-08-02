import { useState, useEffect, useCallback } from 'react';
import type { Agent, Business, Decision, Achievement, AgentRun, CommMsg, WsEvent, Building } from '../shared/types';
import { api, useWebSocket } from '../shared';

export type AppData = {
  agents: Agent[];
  businesses: Business[];
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
    loadBusinesses: () => Promise<void>;
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
  const [businesses, setBusinesses] = useState<Business[]>([]);
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

  const handleWsEvent = useCallback((envelope: { type: string; data?: unknown }) => {
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
    loadBusinesses();
    loadDecisions();
    loadAchievements();
    loadRuns();
    loadMessages();
    loadProgress();
    loadRuntimeStatus();
    const pollTimer = setInterval(() => {
      loadDecisions();
      loadRuns();
    }, 15000);
    return () => clearInterval(pollTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = decisions.filter((d) => d.status === 'proposed' || d.status === 'pending');

  return {
    agents, businesses, decisions, achievements, runs, messages, liveEvents,
    departments, xp, level, runtimeOn, pending, wsConnected,
    reload: { loadAgents, loadBusinesses, loadDecisions, loadAchievements, loadRuns, loadMessages, loadProgress, loadDepartments, loadRuntimeStatus },
  };
}
