// Extraído verbatim de WorldCanvas.tsx (const COLOR) — Fase 2 del Plan de
// Migración ECS. Fuente única: WorldCanvas.tsx importa esta misma paleta en
// vez de mantener una copia local, para que un tipo visual nuevo (Fase 2+)
// y el resto del canvas (grid/trail/scan/ripple/orbit/spokes/minimapa, que
// se quedan en WorldCanvas.tsx) nunca puedan divergir en un hex.
export const COLOR = {
  void: 0x0a0b0d,
  panel: 0x12141a,
  line: 0x1e2229,
  ember: 0xe8432d,
  emberDim: 0x7a2418,
  signal: 0x4fd1c5,
  amber: 0xf0a93b,
  good: 0x3ecf6a,
  ink: 0xe8e6e1,
  inkFaint: 0x4a4d53,
  inkDim: 0x8a8d93,
  minimapBg: 0x0d0e11,
  minimapViewport: 0x4fd1c5,
};
