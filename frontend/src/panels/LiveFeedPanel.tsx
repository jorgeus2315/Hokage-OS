import type { WsEvent } from '../shared/types';
import { Led } from '../shared/ui';

function ledFor(type: string) {
  if (type.includes('error')) return 'alert' as const;
  if (type.includes('done') || type.includes('approved')) return 'on' as const;
  return 'signal' as const;
}

function toneFor(type: string) {
  if (type.includes('error')) return 'var(--ember)';
  if (type.includes('done') || type.includes('approved')) return 'var(--good)';
  return 'var(--signal)';
}

export function LiveFeedPanel({ events }: { events: WsEvent[] }) {
  if (events.length === 0) {
    return <div className="hk-feed-empty">Sin actividad reciente. Ejecuta al agente o activa el modo autónomo.</div>;
  }
  return (
    <div className="hk-feed">
      {events.map((e, i) => (
        <div className="hk-feed-item" key={i}>
          <div className="hk-feed-dot">
            <Led state={ledFor(e.type)} />
          </div>
          <div>
            <div className="hk-feed-type" style={{ color: toneFor(e.type) }}>
              {e.type}
            </div>
            <div className="hk-feed-meta">
              {e.from ? `${e.from} · ` : ''}
              {e.timestamp ? new Date(e.timestamp).toLocaleTimeString('es-ES') : ''}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
