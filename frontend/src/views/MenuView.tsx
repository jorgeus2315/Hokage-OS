import type { Screen } from '../shared/types';
import { Bar, Led } from '../shared/ui';
import { IconMap, IconComms, IconMissions, IconAlert, IconCrew, IconChevron } from '../shared/icons';

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

  const navItems: Array<{ icon: JSX.Element; title: string; desc: string; badge?: number; screen: Screen }> = [
    { icon: <IconMap />, title: 'Ecosistema', desc: 'Mapa con edificios y agentes', screen: 'map' },
    { icon: <IconComms />, title: 'Ship Comms', desc: 'Mensajes entre agentes en vivo', badge: messagesCount, screen: 'comms' },
    { icon: <IconMissions />, title: 'Misiones', desc: 'Progreso, nivel y logros', screen: 'missions' },
    { icon: <IconAlert />, title: 'Alertas', desc: 'Decisiones pendientes de aprobar', badge: pendingCount, screen: 'alerts' },
    { icon: <IconCrew />, title: 'Ship Crew', desc: 'Estado de todo el equipo', screen: 'crew' },
  ];

  return (
    <div className="hk-menu-wrap">
      <div className="hk-menu">
        <div className="hk-menu-header">
          <div className="hk-menu-title">
            <em>Hokage</em> OS
          </div>
          <div className="hk-menu-sub">Tu empresa digital autónoma</div>
        </div>

        <div className="hk-panel hk-mb-16">
          <div className="hk-commander">
            <div className="hk-commander-id">
              <div className="hk-avatar">J</div>
              <div>
                <div className="hk-commander-name">Jorge</div>
                <div className="hk-commander-role">Comandante · Nv.{level}</div>
              </div>
            </div>
            <div className="hk-commander-xp">
              {xp} / {xpNext} XP
            </div>
          </div>
          <Bar pct={xpPct} />
        </div>

        <div className="hk-stats-row">
          <div className="hk-stat-tile">
            <div className="hk-stat-num">{agentsCount}</div>
            <div className="hk-stat-label">Agentes</div>
          </div>
          <div className="hk-stat-tile">
            <div className="hk-stat-num">{businessCount}</div>
            <div className="hk-stat-label">Negocios</div>
          </div>
          <div className="hk-stat-tile">
            <div className={`hk-stat-num${pendingCount > 0 ? ' hk-stat-num--alert' : ''}`}>{pendingCount}</div>
            <div className="hk-stat-label">Alertas</div>
          </div>
        </div>

        <div className="hk-panel hk-runtime-toggle hk-mb-16">
          <div>
            <div className="hk-runtime-label">Modo autónomo</div>
            <div className="hk-runtime-sub">Agentes trabajando solos</div>
          </div>
          <div className="hk-flex hk-gap-8">
            <Led state={runtimeOn ? 'on' : 'idle'} />
            <button className={`hk-btn hk-btn--sm${runtimeOn ? ' hk-btn--ghost-danger' : ' hk-btn--primary'}`} onClick={onToggleRuntime}>
              {runtimeOn ? 'Detener' : 'Iniciar'}
            </button>
          </div>
        </div>

        <div className="hk-nav-list">
          {navItems.map((item) => (
            <button className="hk-nav-item" key={item.screen} onClick={() => onNavigate(item.screen)}>
              <span className="hk-nav-item-icon">{item.icon}</span>
              <div>
                <div className="hk-nav-item-title">{item.title}</div>
                <div className="hk-nav-item-desc">{item.desc}</div>
              </div>
              {!!item.badge && <span className="hk-badge hk-badge--ember">{item.badge}</span>}
              <span className="hk-nav-item-chevron">
                <IconChevron />
              </span>
            </button>
          ))}
        </div>

        <div className="hk-menu-footer">
          {clock} · v0.5.0 · WS <Led state={connected ? 'on' : 'alert'} />
        </div>
      </div>
    </div>
  );
}
