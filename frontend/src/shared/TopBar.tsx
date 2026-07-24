import type { Screen } from './types';
import { IconBack } from './icons';
import { Led } from './ui';

export function TopBar({
  title,
  screen,
  connected,
  clock,
  pendingCount,
  onBack,
  onMenu,
  onAlerts,
}: {
  title: string;
  screen: Screen;
  connected: boolean;
  clock: string;
  pendingCount: number;
  onBack: () => void;
  onMenu: () => void;
  onAlerts: () => void;
}) {
  return (
    <div className="hk-topbar">
      <div className="hk-topbar-left">
        {screen !== 'map' && (
          <button className="hk-iconbtn" onClick={onBack} aria-label="Volver al ecosistema">
            <IconBack />
          </button>
        )}
        <span className="hk-brand">
          <em>Hokage</em> OS <span className="hk-topbar-sep">·</span> {title}
        </span>
      </div>
      <div className="hk-topbar-right">
        <Led state={connected ? 'on' : 'alert'} />
        {pendingCount > 0 && (
          <button className="hk-btn hk-btn--sm hk-btn--ghost-danger" onClick={onAlerts}>
            {pendingCount} alertas
          </button>
        )}
        <span className="hk-topbar-clock">{clock}</span>
        <button className="hk-btn hk-btn--sm" onClick={onMenu}>
          Menú
        </button>
      </div>
    </div>
  );
}
