import type { Building } from './types';

// Estos hex se quedan literales a propósito — NO se pueden convertir a var(--x):
// useWorldState.ts hace `Number(b.color.replace('#', '0x'))` para obtener el color
// numérico que consume PixiJS, y un string CSS var() no sobrevive esa conversión.
// Siguen duplicando los mismos valores que db/init.ts::seedDepartments() (backend)
// — esa duplicación cruzada frontend/backend queda fuera de alcance de la Fase 1
// de UI Implementation Plan.md (solo consolidación de fuentes de estilo en frontend).
export const BUILDINGS: Building[] = [
  { id: 'hokage', name: 'Torre Hokage', desc: 'Centro de mando', role: 'ceo', glyph: 'tower', color: '#e8432d' },
  { id: 'lab', name: 'Laboratorio', desc: 'Investigación de mercado', role: 'investigador', glyph: 'lab', color: '#4fd1c5' },
  { id: 'estudio', name: 'Estudio', desc: 'Fábrica de contenido', role: 'contenido', glyph: 'studio', color: '#c77dff' },
  { id: 'tienda', name: 'Tienda', desc: 'Sala de ventas', role: 'trafico', glyph: 'shop', color: '#f0a93b' },
  { id: 'banco', name: 'Banco', desc: 'Sala financiera', role: 'finanzas', glyph: 'bank', color: '#3ecf6a' },
  { id: 'taller', name: 'Taller', desc: 'Sala técnica', role: 'operaciones', glyph: 'workshop', color: '#4f8cff' },
];
