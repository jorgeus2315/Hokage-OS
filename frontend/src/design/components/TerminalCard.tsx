import type { ReactNode, CSSProperties } from 'react';
import { toneColor, type ColorTone } from '../tokens';

export function TerminalCard({
  title,
  tone,
  children,
  className = '',
}: {
  title?: string;
  tone?: ColorTone;
  children: ReactNode;
  className?: string;
}) {
  const accentHex = tone ? toneColor[tone] : undefined;
  return (
    <div
      className={`hk-ds-terminal ${tone ? 'hk-ds-terminal--accent' : ''} ${className}`}
      style={accentHex ? ({ '--hk-ds-accent': accentHex } as CSSProperties) : undefined}
    >
      {title && (
        <div className="hk-ds-terminal-title hk-mono">
          <span className="hk-ds-terminal-dot" />
          {title}
        </div>
      )}
      <div className="hk-ds-terminal-body">{children}</div>
    </div>
  );
}
