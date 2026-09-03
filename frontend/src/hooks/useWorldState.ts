import { useEffect, useRef } from 'react';
import type { Agent, AgentRun, Building, Decision, WsEvent, AgentRuntimeState } from '../shared/types';
import { BUILDINGS } from '../shared/constants';
import type { HubDescriptor, RoomDescriptor, TokenDescriptor, RippleEvent } from '../world/types';
import { adaptEvents, commandsToRippleEvents } from '../world/events';
import { computeLayout } from '../world/layoutEngine';
import { COLOR } from '../world/visuals/palette';
import { agentStateStore } from '../world/state/AgentStateStore';
import { worldModelClient } from '../world/client/WorldModelClient';

function roleColor(role: string, depts: Building[]): number {
  const dept = depts.find((b) => b.role === role);
  return dept ? Number(dept.color.replace('#', '0x')) : COLOR.inkDim;
}

const WORLD_CENTER = { x: 1000, y: 1000 };
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
  agentStates,
  onEnterBuilding,
}: {
  departments?: Building[];
  agents: Agent[];
  runs: AgentRun[];
  pending: Decision[];
  liveEvents: WsEvent[];
  agentStates: Record<number, AgentRuntimeState>;
  onEnterBuilding: (b: Building) => void;
}): WorldState {
  const allDepts = departments && departments.length > 0 ? departments : BUILDINGS;
  const HUB = allDepts.find((b) => b.is_hub || b.id === 'hokage') ?? allDepts[0];
  const ROOMS = allDepts.filter((b) => !b.is_hub && b.id !== 'hokage');

  // Track if we've hydrated from initial_snapshot to avoid re-hydrating from departments
  const hydratedFromSnapshotRef = useRef(false);

  // Hydrate AgentStateStore from backend snapshot (agentStates prop)
  // This runs on every render but AgentStateStore deduplicates by signature
  useEffect(() => {
    const states = Object.values(agentStates);
    if (states.length > 0) {
      agentStateStore.hydrate(states);
    }
  }, [agentStates]);

  // Hydrate WorldModelClient from initial_snapshot (world_entities + world_relations)
  // Falls back to legacy department derivation if snapshot data not available
  useEffect(() => {
    // WorldModelClient will be hydrated from initial_snapshot in useAppData
    // via the handleWsEvent callback when initial_snapshot arrives.
    // This effect is a no-op if already hydrated from snapshot.
    // We keep it as a fallback for initial renders before WS connects.

    // Check if we already have world data (hydrated from snapshot)
    const hasWorldData = worldModelClient.getRooms().length > 0 || worldModelClient.getBuildings().length > 0;
    if (hasWorldData && hydratedFromSnapshotRef.current) {
      return; // Already hydrated from snapshot
    }

    // Fallback: build minimal world snapshot from departments (legacy)
    // This ensures the world works even before WS connects or if snapshot lacks world
    const entities = [
      // Hub
      {
        id: Number((HUB.db_id ?? (HUB.id.replace(/\D/g, '') || 1))),
        kind: 'building',
        name: HUB.name,
        parentId: null,
        refKind: null,
        refId: null,
        ventureId: null,
        posX: HUB.pos_x ?? WORLD_CENTER.x,
        posY: HUB.pos_y ?? WORLD_CENTER.y,
        status: 'active',
        attributes: { is_hub: true },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      // Rooms
      ...ROOMS.map((b, i) => ({
        id: Number((b.db_id ?? (b.id.replace(/\D/g, '') || (i + 10)))),
        kind: 'room',
        name: b.name,
        parentId: Number(HUB.db_id ?? (HUB.id.replace(/\D/g, '') || 1)),
        refKind: 'department',
        refId: Number((b.db_id ?? (b.id.replace(/\D/g, '') || (i + 10)))),
        ventureId: null,
        posX: b.pos_x ?? null,
        posY: b.pos_y ?? null,
        status: 'active',
        attributes: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      // Characters (one per agent)
      ...agents.map((a) => ({
        id: a.id + 1000, // offset to avoid collision
        kind: 'character',
        name: a.name,
        parentId: null,
        refKind: 'agent',
        refId: a.id,
        ventureId: a.venture_id ?? null,
        posX: null,
        posY: null,
        status: 'active',
        attributes: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    ];

    const relations = agents
      .filter((a) => {
        const room = ROOMS.find((b) => b.role === a.role);
        return room !== undefined;
      })
      .map((a) => {
        const room = ROOMS.find((b) => b.role === a.role)!;
        return {
          id: Date.now() + a.id, // deterministic enough for now
          fromId: a.id + 1000,
          toId: Number((room.db_id ?? (room.id.replace(/\D/g, '') || 10))),
          kind: 'works_in',
          attributes: {},
          createdAt: new Date().toISOString(),
        };
      });

    worldModelClient.hydrate({ entities, relations });
  }, [HUB, ROOMS, agents]);

  // Listen for WorldModelClient hydration from initial_snapshot (via useAppData)
  useEffect(() => {
    const unsubscribe = worldModelClient.subscribe(() => {
      // Mark that we've been hydrated from snapshot
      if (worldModelClient.getRooms().length > 0 || worldModelClient.getBuildings().length > 0) {
        hydratedFromSnapshotRef.current = true;
      }
    });
    return unsubscribe;
  }, []);

  // Build room positions from WorldModelClient (authoritative) with layoutEngine fallback
  const ROOM_POS: Record<string, { x: number; y: number }> = {};
  for (const room of worldModelClient.getRooms()) {
    const pos = worldModelClient.getPosition(room.id);
    if (pos) {
      ROOM_POS[String(room.id)] = pos;
    }
  }
  // Fallback to layoutEngine for rooms without positions
  const roomsWithoutPos = ROOMS.filter((b) => !ROOM_POS[b.id]);
  if (roomsWithoutPos.length > 0) {
    for (const node of computeLayout(roomsWithoutPos)) {
      ROOM_POS[node.departmentId] = { x: node.x, y: node.y };
    }
  }

  const lastRunFor = (agentId: number) => runs.find((r) => r.agent_id === agentId);
  const isWorking = (agentId: number) => agentStates[agentId]?.primary === 'WORKING';
  const isJustActed = (agentId: number) => {
    const last = lastRunFor(agentId);
    return !!last && Date.now() - new Date(last.started_at).getTime() < JUST_ACTED_MS;
  };
  const calcActivityLevel = (agentId: number): number => agentStates[agentId]?.activity ?? 0;
  const hasRecentError = (agentId: number): boolean => agentStates[agentId]?.modifiers.hasError ?? false;

  // EventAdapter needs CharacterLookup for movement commands
  const characters = agents.map((a) => ({
    id: a.id + 1000,
    agentId: a.id,
  }));

  const rippleEvents: RippleEvent[] = commandsToRippleEvents(
    adaptEvents(liveEvents, agents, ROOMS, characters)
  );

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

  // Token targets are now determined by BehaviorSystem based on AgentRuntimeState.
  // This hook only provides the INITIAL position for upsert. BehaviorSystem will
  // mutate Motion.target each tick. No atHub, no roomWander, no Math.random, no timers.
  const tokens: TokenDescriptor[] = agents.map((a) => {
    // Initial position: hub orbit (deterministic by agent id)
    const hubPos = worldModelClient.getHub() ? worldModelClient.getPosition(worldModelClient.getHub()!.id) : WORLD_CENTER;
    const center = hubPos ?? WORLD_CENTER;
    const agentIndex = agents.findIndex((ag) => ag.id === a.id);
    const angle = (agentIndex * (360 / Math.max(agents.length, 1)) + 20) * (Math.PI / 180);
    const TOKEN_ORBIT = 220;
    const initialX = center.x + TOKEN_ORBIT * Math.cos(angle);
    const initialY = center.y + TOKEN_ORBIT * Math.sin(angle);

    const st = agentStates[a.id];
    const working = isWorking(a.id);

    return {
      id: String(a.id),
      x: initialX,
      y: initialY,
      label: a.name,
      role: a.role,
      color: roleColor(a.role, allDepts),
      working,
      justActed: isJustActed(a.id),
      action: lastRunFor(a.id)?.action,
      model: a.model,
      primary: st?.primary,
      kind: st?.currentTask?.kind,
      hasError: st?.modifiers.hasError ?? false,
      awaitingApproval: st?.modifiers.awaitingApproval ?? false,
      onClick: undefined, // Room click handled by token click if in room
    };
  });

  return { hub, rooms, tokens, rippleEvents, allDepts, HUB, ROOMS };
}