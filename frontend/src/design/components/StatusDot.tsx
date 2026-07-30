export type DotStatus = 'online' | 'warning' | 'error' | 'idle';

const STATUS_COLOR: Record<DotStatus, string> = {
  online: '#3ecf6a',
  warning: '#f0a93b',
  error: '#e8432d',
  idle: '#4a4d53',
};

export function StatusDot({ status = 'idle', label }: { status?: DotStatus; label?: string }) {
  const hex = STATUS_COLOR[status];
  const pulsing = status === 'online' || status === 'warning' || status === 'error';
  return (
    <span className="hk-ds-statusdot-wrap">
      <span
        className={`hk-ds-statusdot${pulsing ? ' hk-ds-statusdot--pulse' : ''}`}
        style={{ background: hex, boxShadow: `0 0 6px ${hex}` }}
      />
      {label && <span className="hk-ds-statusdot-label hk-mono">{label}</span>}
    </span>
  );
}
