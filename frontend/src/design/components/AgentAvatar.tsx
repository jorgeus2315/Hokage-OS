import { roleColor, colors } from '../tokens';

export function AgentAvatar({
  name,
  role,
  size = 'md',
}: {
  name: string;
  role: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const hex = roleColor[role] ?? colors.inkDim;
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className={`hk-ds-avatar hk-ds-avatar--${size}`}
      style={{ background: `linear-gradient(155deg, ${hex}, ${hex}99)`, boxShadow: `0 0 10px ${hex}55` }}
      title={`${name} · ${role}`}
    >
      {initial}
    </span>
  );
}
