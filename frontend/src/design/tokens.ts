// Fuente de verdad en JS de las mismas custom properties definidas en styles.css.
// Cualquier cambio de paleta debe reflejarse en ambos lugares.
// BUILDINGS se importa desde shared/constants cuando se necesite el listado completo.
export const colors = {
  void: '#0a0b0d',
  voidDeep: '#050506',
  panel: '#14161a',
  panelRaised: '#1c1f24',
  panelHover: '#22262c',
  line: '#262a31',
  lineBright: '#383d46',

  ember: '#e8432d',
  emberDim: '#7a2418',
  emberGlow: 'rgba(232, 67, 45, 0.35)',

  signal: '#4fd1c5',
  signalDim: '#1f5851',
  signalGlow: 'rgba(79, 209, 197, 0.3)',

  amber: '#f0a93b',
  amberDim: '#6b4c17',

  good: '#3ecf6a',
  goodDim: '#1e5c33',

  ink: '#e8e6e1',
  inkDim: '#8a8d93',
  inkFaint: '#4a4d53',
} as const;

export type ColorTone = 'ember' | 'signal' | 'amber' | 'good';

export const toneColor: Record<ColorTone, string> = {
  ember: colors.ember,
  signal: colors.signal,
  amber: colors.amber,
  good: colors.good,
};

// Un color por departamento/rol — debe coincidir con BUILDINGS en shared/types.ts.
export const roleColor: Record<string, string> = {
  ceo: colors.ember,
  investigador: colors.signal,
  contenido: '#c77dff',
  trafico: colors.amber,
  finanzas: colors.good,
  operaciones: '#4f8cff',
  soporte: colors.inkDim,
};

export const font = {
  display: "'Chakra Petch', sans-serif",
  body: "'IBM Plex Sans', sans-serif",
  mono: "'IBM Plex Mono', monospace",
} as const;

export const fontSize = {
  xs: 10,
  sm: 11,
  base: 13,
  md: 14,
  lg: 17,
  xl: 22,
  xxl: 28,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 40,
} as const;

export const radius = {
  sm: 3,
  pill: 20,
} as const;

// Presets de glow — reutilizados por GlowText, ProgressBar, StatusDot y TerminalCard.
export const glow = {
  text: (hex: string) => `0 0 12px ${hex}66, 0 0 24px ${hex}33`,
  box: (hex: string) => `0 0 8px ${hex}55`,
  boxStrong: (hex: string) => `0 0 16px ${hex}80`,
} as const;
