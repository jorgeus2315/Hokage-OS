import { useEffect, useRef, useState } from 'react';
import type { Agent, AgentRun, Decision, WsEvent, Building } from '../shared/types';
import { BUILDINGS } from '../shared/types';
import { Led } from '../shared/ui';
import { IconComms, IconAlert, IconCrew } from '../shared/icons';
import { WorldCanvas } from '../world';

const WORLD_CENTER = { x: 1000, y: 1000 };
const ROOM_RADIUS = 400;
const TOKEN_ORBIT = 220;
const TOKEN_ROOM_OFFSET = 50;

const RECENT_MS = 5 * 60 * 1000;
const JUST_ACTED_MS = 30_000;

export function MapView({
  departments: departmentsProp,
  agents,
  runs,
  pending,
  liveEvents,
  messagesCount,
  connected,
  onEnterBuilding,
  onGoComms,
  onGoAlerts,
  onGoCrew,
}: {
  departments?: Building[];
  agents: Agent[];
  runs: AgentRun[];
  pending: Decision[];
  liveEvents: WsEvent[];
  messagesCount: number;
  connected: boolean;
  onEnterBuilding: (b: Building) => void;
  onGoComms: () => void;
  onGoAlerts: () => void;
  onGoCrew: () => void;
}) {
  const allDepts = departmentsProp && departmentsProp.length > 0 ? departmentsProp : BUILDINGS;
  const HUB = allDepts.find((b) => b.is_hub || b.id === 'hokage') ?? allDepts[0];
  const ROOMS = allDepts.filter((b) => !b.is_hub && b.id !== 'hokage');

  const ROOM_POS: Record<string, { x: number; y: number }> = {};
  ROOMS.forEach((room, i) => {
    if (room.pos_x !== undefined && room.pos_y !== undefined) {
      ROOM_POS[room.id] = { x: room.pos_x, y: room.pos_y };
    } else {
      const angle = (-90 + (360 / ROOMS.length) * i) * (Math.PI / 180);
      ROOM_POS[room.id] = { x: WORLD_CENTER.x + ROOM_RADIUS * Math.cos(angle), y: WORLD_CENTER.y + ROOM_RADIUS * Math.sin(angle) };
    }
  });

  const lastRunFor = (agentId: number) => runs.find((r) => r.agent_id === agentId);
  const isWorking = (agentId: number) => {
    const last = lastRunFor(agentId);
    return !!last && Date.now() - new Date(last.started_at).getTime() < RECENT_MS;
  };
  const isJustActed = (agentId: number) => {
    const last = lastRunFor(agentId);
    return !!last && Date.now() - new Date(last.started_at).getTime() < JUST_ACTED_MS;
  };

  // Cada agente deambula entre el centro de mando y su sala; si tiene una
  // ejecución reciente se queda fijo en su sala (está trabajando de verdad).
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

  return (
    <div className="hk-map-layout">
      <div className="hk-map-rail">
        <div>
          <div className="hk-flex hk-gap-8" style={{ marginBottom: 10 }}>
            <Led state="on" />
            <span className="hk-rail-title" style={{ marginBottom: 0, color: 'var(--good)' }}>
              SHIP CREW · {agents.length}
            </span>
          </div>
          {agents.map((a) => {
            const building = allDepts.find((b) => b.role === a.role);
            const lastRun = lastRunFor(a.id);
            return (
              <div
                className="hk-crew-row"
                key={a.id}
                onClick={() => building && onEnterBuilding(building)}
                role={building ? 'button' : undefined}
                tabIndex={building ? 0 : undefined}
                onKeyDown={(e) => {
                  if (building && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onEnterBuilding(building);
                  }
                }}
              >
                <Led state={isJustActed(a.id) ? 'signal' : isWorking(a.id) ? 'alert' : 'on'} />
                <div>
                  <div className="hk-crew-row-name">{a.name}</div>
                  <div className="hk-crew-row-action">{lastRun?.action || 'En espera'}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hk-quickrow" style={{ flexDirection: 'column' }}>
          <button className="hk-btn hk-btn--block" onClick={onGoComms}>
            <IconComms /> Ship Comms {messagesCount > 0 ? `(${messagesCount})` : ''}
          </button>
          <button className={`hk-btn hk-btn--block${pending.length > 0 ? ' hk-btn--ghost-danger' : ''}`} onClick={onGoAlerts}>
            <IconAlert /> Alertas {pending.length > 0 ? `(${pending.length})` : ''}
          </button>
          <button className="hk-btn hk-btn--block" onClick={onGoCrew}>
            <IconCrew /> Equipo
          </button>
        </div>

        <div style={{ textAlign: 'center', fontSize: 10, color: connected ? 'var(--good)' : 'var(--ember)', fontFamily: 'var(--font-mono)' }}>
          WS {connected ? '● conectado' : '○ desconectado'}
        </div>
      </div>

      <div className="hk-map-center">
        <WorldCanvas
          hub={{ label: 'HOKAGE', sublabel: 'CENTRO DE MANDO', x: HUB.pos_x ?? WORLD_CENTER.x, y: HUB.pos_y ?? WORLD_CENTER.y, onClick: () => onEnterBuilding(HUB) }}
          rooms={ROOMS.map((b) => {
            const agent = agents.find((a) => a.role === b.role);
            const pos = ROOM_POS[b.id];
            const agentWorking = !!agent && isWorking(agent.id);
            const currentAction = agent ? lastRunFor(agent.id)?.action : undefined;
            return {
              id: b.id,
              x: pos.x,
              y: pos.y,
              label: b.name,
              // Muestra la acción actual si el agente está trabajando
              sublabel: agentWorking && currentAction ? currentAction : (agent?.name || '—'),
              pending: pending.some((d) => d.agent_id === agent?.id),
              active: agentWorking,
              color: Number(b.color.replace('#', '0x')),
              onClick: () => onEnterBuilding(b),
            };
          })}
          tokens={(() => {
            const resolved = agents.map((a) => {
              const room = ROOMS.find((b) => b.role === a.role);
              const working = isWorking(a.id);
              const home = !working && (!room || atHub[a.id] !== false);
              return { agent: a, room, working, home };
            });
            const hubAgents = resolved.filter((r) => r.home);

            return resolved.map(({ agent: a, room, working, home }) => {
              let target: { x: number; y: number };
              if (home) {
                const idx = hubAgents.findIndex((r) => r.agent.id === a.id);
                const angle = (idx * (360 / Math.max(hubAgents.length, 1)) + 20) * (Math.PI / 180);
                target = {
                  x: WORLD_CENTER.x + TOKEN_ORBIT * Math.cos(angle),
                  y: WORLD_CENTER.y + TOKEN_ORBIT * Math.sin(angle),
                };
              } else {
                const rp = ROOM_POS[room!.id];
                target = { x: rp.x, y: rp.y + TOKEN_ROOM_OFFSET };
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
          })()}
        />
      </div>

      <div className="hk-map-rail">
        <div>
          <div className="hk-rail-title">EVENTOS EN VIVO</div>
          {liveEvents.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>Sin eventos todavía.</div>
          ) : (
            liveEvents.slice(0, 8).map((e, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--ink-dim)', marginBottom: 7 }}>
                <span
                  style={{
                    fontWeight: 600,
                    color: e.type?.includes('error') ? 'var(--ember)' : e.type?.includes('done') ? 'var(--good)' : 'var(--signal)',
                  }}
                >
                  {e.type}
                </span>
                {e.from && <div style={{ color: 'var(--ink-faint)', fontSize: 10 }}>{e.from}</div>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
