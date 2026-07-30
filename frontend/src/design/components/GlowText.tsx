import type { ReactNode, ElementType } from 'react';
import { toneColor, type ColorTone } from '../tokens';

export function GlowText({
  children,
  tone = 'ember',
  as: Tag = 'span',
  size,
  className = '',
}: {
  children: ReactNode;
  tone?: ColorTone;
  as?: ElementType;
  size?: number;
  className?: string;
}) {
  const hex = toneColor[tone];
  return (
    <Tag
      className={`hk-ds-glowtext ${className}`}
      style={{ color: hex, fontSize: size, textShadow: `0 0 12px ${hex}66, 0 0 24px ${hex}33` }}
    >
      {children}
    </Tag>
  );
}
