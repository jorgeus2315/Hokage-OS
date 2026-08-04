import type { Screen } from '../shared/types';
import { Led } from '../shared/ui';
import { IconMap, IconComms, IconMissions, IconAlert, IconCrew, IconChevron, IconVenture, IconConfig } from '../shared/icons';

const NAV_ITEMS: Array<{ screen: Screen; title: string; desc: string; icon: JSX.Element; color: string; featured?: boolean }> = [
  { screen: 'map',      title: 'Ecosistema', desc: 'Mapa táctico · Edificios y agentes en tiempo real', icon: <IconMap />,     color: 'var(--ember)', featured: true },
  { screen: 'ventures', title: 'Ventures',   desc: 'Iniciativas económicas · Assets · Pipeline rules',  icon: <IconVenture />, color: 'var(--signal)' },
  { screen: 'comms',    title: 'Ship Comms', desc: 'Canal de comunicación entre agentes',               icon: <IconComms />,   color: 'var(--signal)' },
  { screen: 'missions', title: 'Misiones',   desc: 'Progreso · Nivel · Logros desbloqueados',           icon: <IconMissions />,color: 'var(--amber)' },
  { screen: 'alerts',   title: 'Alertas',    desc: 'Decisiones pendientes de aprobación',               icon: <IconAlert />,   color: 'var(--ember)' },
  { screen: 'crew',     title: 'Ship Crew',  desc: 'Estado y actividad de cada agente',                 icon: <IconCrew />,    color: 'var(--good)' },
  { screen: 'config',   title: 'Configuración', desc: 'Prompt maestro global · Gestión de agentes',     icon: <IconConfig />,  color: 'var(--ink)' },
];

export function MenuView({
  level,
  xp,
  xpNext,
  agentsCount,
  businessCount,
  pendingCount,
  messagesCount,
  runtimeOn,
  connected,
  clock,
  onToggleRuntime,
  onNavigate,
}: {
  level: number;
  xp: number;
  xpNext: number;
  agentsCount: number;
  businessCount: number;
  pendingCount: number;
  messagesCount: number;
  runtimeOn: boolean;
  connected: boolean;
  clock: string;
  onToggleRuntime: () => void;
  onNavigate: (s: Screen) => void;
}) {
  const xpPct = Math.min(100, (xp / xpNext) * 100);

  const badgeFor = (screen: Screen): number | undefined => {
    if (screen === 'alerts') return pendingCount || undefined;
    if (screen === 'comms') return messagesCount || undefined;
    return undefined;
  };

  return (
    <div className="hk-ps4-menu">
      {/* ── Left sidebar ── */}
      <div className="hk-ps4-sidebar">
        <div className="hk-ps4-brand">
          <span className="hk-ps4-brand-em">HOKAGE</span>
          <span className="hk-ps4-brand-os"> OS</span>
        </div>

        {/* Commander card */}
        <div className="hk-ps4-commander">
          <div className="hk-ps4-avatar">J</div>
          <div>
            <div className="hk-ps4-cmd-name">JORGE</div>
            <div className="hk-ps4-cmd-rank">COMANDANTE · NV.{level}</div>
          </div>
        </div>

        {/* XP bar */}
        <div className="hk-ps4-xp">
          <div className="hk-ps4-xp-track">
            <div className="hk-ps4-xp-fill" style={{ width: `${xpPct}%` }} />
          </div>
          <div className="hk-ps4-xp-label">{xp} / {xpNext} XP</div>
        </div>

        {/* Stats */}
        <div className="hk-ps4-stats">
          <div className="hk-ps4-stat">
            <div className="hk-ps4-stat-value">{agentsCount}</div>
            <div className="hk-ps4-stat-key">AGENTES</div>
          </div>
          <div className="hk-ps4-stat">
            <div className="hk-ps4-stat-value">{businessCount}</div>
            <div className="hk-ps4-stat-key">VENTURES</div>
          </div>
          <div className={`hk-ps4-stat${pendingCount > 0 ? ' hk-ps4-stat--alert' : ''}`}>
            <div className="hk-ps4-stat-value">{pendingCount}</div>
            <div className="hk-ps4-stat-key">ALERTAS</div>
          </div>
        </div>

        {/* Runtime toggle */}
        <div className="hk-ps4-runtime">
          <div className="hk-ps4-runtime-status">
            <Led state={runtimeOn ? 'on' : 'idle'} />
            <span>{runtimeOn ? 'AUTÓNOMO' : 'PAUSADO'}</span>
          </div>
          <button
            className={`hk-btn hk-btn--sm${runtimeOn ? ' hk-btn--ghost-danger' : ' hk-btn--primary'}`}
            onClick={onToggleRuntime}
          >
            {runtimeOn ? 'Detener' : 'Iniciar'}
          </button>
        </div>

        {/* Footer */}
        <div className="hk-ps4-footer">
          <span>{clock}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            WS <Led state={connected ? 'on' : 'alert'} /> · v0.5.0
          </span>
        </div>
      </div>

      {/* ── Navigation panels ── */}
      <div className="hk-ps4-panels">
        <div className="hk-ps4-panels-label">SISTEMAS OPERATIVOS</div>

        {NAV_ITEMS.map((item) => {
          const badge = badgeFor(item.screen);
          return (
            <button
              key={item.screen}
              className={`hk-ps4-panel${item.featured ? ' hk-ps4-panel--featured' : ''}`}
              style={{ '--accent': item.color } as React.CSSProperties}
              onClick={() => onNavigate(item.screen)}
            >
              <div className="hk-ps4-panel-accent" />
              <div className="hk-ps4-panel-icon">{item.icon}</div>
              <div className="hk-ps4-panel-content">
                <div className="hk-ps4-panel-title">{item.title}</div>
                <div className="hk-ps4-panel-desc">{item.desc}</div>
                {item.featured && (
                  <div className="hk-ps4-panel-meta">
                    {agentsCount} agentes activos
                    {pendingCount > 0 && <span className="hk-ps4-panel-meta-alert"> · {pendingCount} alertas</span>}
                  </div>
                )}
              </div>
              {badge ? <span className="hk-badge hk-badge--ember">{badge}</span> : null}
              <span className="hk-ps4-panel-chevron"><IconChevron /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
