import type { ReactNode } from 'react';

export function Panel({
  children,
  accent,
  interactive,
  className = '',
  onClick,
  style,
}: {
  children: ReactNode;
  accent?: boolean;
  interactive?: boolean;
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const cls = [
    'hk-panel',
    accent ? 'hk-panel--accent' : '',
    interactive ? 'hk-panel--interactive' : '',
    className,
  ].filter(Boolean).join(' ');
  const interactiveProps = interactive && onClick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        },
      }
    : {};
  return (
    <div className={cls} onClick={onClick} style={style} {...interactiveProps}>
      {children}
    </div>
  );
}

type LedState = 'on' | 'alert' | 'idle' | 'signal';

export function Led({ state = 'idle' }: { state?: LedState }) {
  return <span className={`hk-led hk-led--${state}`} />;
}

type BadgeTone = 'ember' | 'signal' | 'amber' | 'good' | 'dim';

export function Badge({ children, tone = 'dim', style }: { children: ReactNode; tone?: BadgeTone; style?: React.CSSProperties }) {
  return <span className={`hk-badge hk-badge--${tone}`} style={style}>{children}</span>;
}

export function Bar({ pct, signal }: { pct: number; signal?: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="hk-bar">
      <div className={`hk-bar-fill${signal ? ' hk-bar-fill--signal' : ''}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
