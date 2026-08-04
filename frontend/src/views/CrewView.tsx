import type { Agent, AgentRun, Building } from '../shared/types';
import { ROLES } from '../shared/types';
import { Panel, Led } from '../shared/ui';
import { BuildingGlyph } from '../shared/icons';

export function CrewView({
  agents,
  runs,
  buildings,
  onEnterBuilding,
}: {
  agents: Agent[];
  runs: AgentRun[];
  buildings: Building[];
  onEnterBuilding: (b: Building) => void;
}) {
  return (
    <div>
      <div className="hk-flex hk-gap-8 hk-mb-16">
        <Led state="on" />
        <span className="hk-eyebrow" style={{ color: 'var(--good)' }}>
          STATION ONLINE · {agents.length} AGENTES
        </span>
      </div>
      {agents.map((a) => {
        const lastRun = runs.filter((r) => r.agent_id === a.id)[0];
        const building = buildings.find((b) => b.role === a.role);
        return (
          <Panel
            key={a.id}
            interactive={!!building}
            className="hk-mb-16"
            onClick={() => building && onEnterBuilding(building)}
            style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14 }}
          >
            <div className="hk-building-agent-avatar" style={{ background: 'var(--ember)', width: 38, height: 38, fontSize: 15 }}>
              {a.name[0]}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{a.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{ROLES[a.role] || a.role}</div>
              {lastRun && (
                <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
                  {lastRun.action} · {new Date(lastRun.started_at).toLocaleTimeString('es-ES')}
                </div>
              )}
            </div>
            {building && (
              <div style={{ width: 26, height: 26, color: 'var(--ink-faint)' }}>
                <BuildingGlyph glyph={building.glyph} />
              </div>
            )}
            <Led state="on" />
          </Panel>
        );
      })}
    </div>
  );
}
