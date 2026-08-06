import { useState, useEffect, useRef } from 'react';
import type { Agent, AgentRun, Building, Decision, WsEvent } from '../shared/types';
import { BUILDINGS } from '../shared/constants';
import type { HubDescriptor, RoomDescriptor, TokenDescriptor, RippleEvent } from '../world/types';
import { adaptEvents, commandsToRippleEvents } from '../world/events';
import { computeLayout } from '../world/layoutEngine';

const WORLD_CENTER = { x: 1000, y: 1000 };
const TOKEN_ORBIT = 220;
const RECENT_MS = 5 * 60 * 1000;
const JUST_ACTED_MS = 30_000;

export interface WorldState {
  hub: HubDescriptor;
  rooms: RoomDescriptor[];
  tokens: TokenDescriptor[];
  rippleEvents: RippleEvent[];
  allDepts: Building[];
  HUB: Building;
  ROOMS: Building[];
}

export function useWorldState({
  departments,
  agents,
  runs,
  pending,
  liveEvents,
  onEnterBuilding,
}: {
  departments?: Building[];
  agents: Agent[];
  runs: AgentRun[];
  pending: Decision[];
  liveEvents: WsEvent[];
  onEnterBuilding: (b: Building) => void;
}): WorldState {
  const allDepts = departments && departments.length > 0 ? departments : BUILDINGS;
  const HUB = allDepts.find((b) => b.is_hub || b.id === 'hokage') ?? allDepts[0];
  const ROOMS = allDepts.filter((b) => !b.is_hub && b.id !== 'hokage');

  // Fase 8 del Plan de Migración ECS: la posición de cada sala ya no se
  // calcula inline aquí — pasa por WorldLayoutEngine (world/layoutEngine.ts),
  // que conecta position_locked (antes ignorado por el frontend, ver
  // shared/api.ts) y el modelo de anillos congelado en "Crecimiento de la
  // Ciudad - World Engine". Con los 7 departamentos reales de hoy (todos
  // con pos_x/pos_y ya guardados), el resultado es idéntico al cálculo
  // anterior — el motor solo entra en juego para salas sin posición.
  const ROOM_POS: Record<string, { x: number; y: number }> = {};
  for (const node of computeLayout(ROOMS)) {
    ROOM_POS[node.departmentId] = { x: node.x, y: node.y };
  }

  const lastRunFor = (agentId: number) => runs.find((r) => r.agent_id === agentId);
  const isWorking = (agentId: number) => {
    const last = lastRunFor(agentId);
    return !!last && Date.now() - new Date(last.started_at).getTime() < RECENT_MS;
  };
  const isJustActed = (agentId: number) => {
    const last = lastRunFor(agentId);
    return !!last && Date.now() - new Date(last.started_at).getTime() < JUST_ACTED_MS;
  };
  const calcActivityLevel = (agentId: number): number => {
    const last = lastRunFor(agentId);
    if (!last) return 0;
    const ms = Date.now() - new Date(last.started_at).getTime();
    if (ms < 5 * 60_000) return 1.0;
    if (ms < 15 * 60_000) return 0.72;
    if (ms < 60 * 60_000) return 0.42;
    if (ms < 3 * 60 * 60_000) return 0.2;
    return 0.06;
  };
  const hasRecentError = (agentId: number): boolean => {
    const last = lastRunFor(agentId);
    return !!last && (last.status === 'error' || last.status === 'failed');
  };

  // DEUDA CONOCIDA, MANTENIDA A PROPÓSITO (ver Plan de Migración ECS, Fase 0,
  // 2026-08-05): atHub/roomWander usan un setInterval independiente POR
  // AGENTE — el mismo antipatrón de scheduling que el backend ya rechazó una
  // vez para AgentRuntime (§2, "timer independiente por agente... se
  // abandonó porque no daba visibilidad de cola"). No se sustituye en esta
  // fase — la migración ECS empieza por Fase 0 (scaffolding inerte) y este
  // comportamiento se mantiene por compatibilidad hasta que MovementSystem
  // (o un futuro sistema de comportamiento/scheduler centralizado) lo
  // absorba explícitamente en una fase posterior, no como efecto colateral.
  const [atHub, setAtHub] = useState<Record<number, boolean>>({});
  const runsRef = useRef(runs);
  runsRef.current = runs;

  useEffect(() => {
    const timers = agents.map((a) => {
      const stagger = 2500 + ((a.id * 733) % 4000);
      return setInterval(() => {
        setAtHub((prev) => {
          const last = runsRef.current.find((r) => r.agent_id === a.id);
          const working = !!last && Date.now() - new Date(last.started_at).getTime() < RECENT_MS;
          if (working) return prev[a.id] === false ? prev : { ...prev, [a.id]: false };
          return { ...prev, [a.id]: Math.random() < 0.5 };
        });
      }, 4000 + stagger);
    });
    return () => timers.forEach(clearInterval);
  }, [agents]);

  const [roomWander, setRoomWander] = useState<Record<number, { dx: number; dy: number }>>({});
  useEffect(() => {
    if (!agents.length) return;
    const timers = agents.map((a) => {
      const interval = 3200 + ((a.id * 613) % 2800);
      return setInterval(() => {
        setRoomWander((prev) => ({
          ...prev,
          [a.id]: { dx: (Math.random() - 0.5) * 60, dy: (Math.random() - 0.5) * 28 },
        }));
      }, interval);
    });
    return () => timers.forEach(clearInterval);
  }, [agents]);

  // Fase 7 del Plan de Migración ECS: la traducción WsEvent → RippleEvent ya
  // no vive inline aquí — pasa por el vocabulario cerrado WorldCommand
  // (adaptEvents) y su mapeo de vuelta al contrato público (commandsToRippleEvents).
  // Misma lógica exacta (agente→rol→sala, descarta sin sala), ahora en
  // world/events/, reutilizable si mañana existe una segunda fuente de
  // comandos. La forma de salida hacia WorldCanvas no cambia: sigue siendo
  // RippleEvent[].
  const rippleEvents: RippleEvent[] = commandsToRippleEvents(adaptEvents(liveEvents, agents, ROOMS));

  const hub: HubDescriptor = {
    label: 'HOKAGE',
    sublabel: 'CENTRO DE MANDO',
    x: HUB.pos_x ?? WORLD_CENTER.x,
    y: HUB.pos_y ?? WORLD_CENTER.y,
    onClick: () => onEnterBuilding(HUB),
  };

  const rooms: RoomDescriptor[] = ROOMS.map((b) => {
    const agent = agents.find((a) => a.role === b.role);
    const pos = ROOM_POS[b.id] ?? { x: WORLD_CENTER.x, y: WORLD_CENTER.y };
    const agentWorking = !!agent && isWorking(agent.id);
    const currentAction = agent ? lastRunFor(agent.id)?.action : undefined;
    return {
      id: b.id,
      x: pos.x,
      y: pos.y,
      label: b.name,
      sublabel: agentWorking && currentAction ? currentAction : (agent?.name || '—'),
      pending: pending.some((d) => d.agent_id === agent?.id),
      active: agentWorking,
      activityLevel: agent ? calcActivityLevel(agent.id) : 0,
      hasError: agent ? hasRecentError(agent.id) : false,
      color: Number(b.color.replace('#', '0x')),
      onClick: () => onEnterBuilding(b),
    };
  });

  const resolved = agents.map((a) => {
    const room = ROOMS.find((b) => b.role === a.role);
    const working = isWorking(a.id);
    const home = !working && (!room || atHub[a.id] !== false);
    return { agent: a, room, working, home };
  });
  const hubAgents = resolved.filter((r) => r.home);

  const tokens: TokenDescriptor[] = resolved.map(({ agent: a, room, working, home }) => {
    let target: { x: number; y: number };
    if (home) {
      const idx = hubAgents.findIndex((r) => r.agent.id === a.id);
      const angle = (idx * (360 / Math.max(hubAgents.length, 1)) + 20) * (Math.PI / 180);
      target = {
        x: WORLD_CENTER.x + TOKEN_ORBIT * Math.cos(angle),
        y: WORLD_CENTER.y + TOKEN_ORBIT * Math.sin(angle),
      };
    } else {
      const rp = ROOM_POS[room!.id] ?? { x: WORLD_CENTER.x, y: WORLD_CENTER.y };
      const w = roomWander[a.id] ?? { dx: 0, dy: 0 };
      target = { x: rp.x + w.dx, y: rp.y + w.dy };
    }
    return {
      id: String(a.id),
      x: target.x,
      y: target.y,
      label: a.name,
      working,
      justActed: isJustActed(a.id),
      action: lastRunFor(a.id)?.action,
      onClick: room ? () => onEnterBuilding(room) : undefined,
    };
  });

  return { hub, rooms, tokens, rippleEvents, allDepts, HUB, ROOMS };
}
