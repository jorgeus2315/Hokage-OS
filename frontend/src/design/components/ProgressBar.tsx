import { toneColor, type ColorTone } from '../tokens';

export function ProgressBar({
  pct,
  tone = 'ember',
  label,
  animated = true,
}: {
  pct: number;
  tone?: ColorTone;
  label?: string;
  animated?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const hex = toneColor[tone];
  return (
    <div className="hk-ds-progress">
      {label && (
        <div className="hk-ds-progress-label">
          <span>{label}</span>
          <span className="hk-mono">{Math.round(clamped)}%</span>
        </div>
      )}
      <div className="hk-ds-progress-track">
        <div
          className={`hk-ds-progress-fill${animated ? ' hk-ds-progress-fill--animated' : ''}`}
          style={{ width: `${clamped}%`, background: `linear-gradient(90deg, ${hex}55, ${hex})`, boxShadow: `0 0 8px ${hex}88` }}
        />
      </div>
    </div>
  );
}
