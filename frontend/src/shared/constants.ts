import type { Building } from './types';

export const BUILDINGS: Building[] = [
  { id: 'hokage', name: 'Torre Hokage', desc: 'Centro de mando', role: 'ceo', glyph: 'tower', color: '#e8432d' },
  { id: 'lab', name: 'Laboratorio', desc: 'Investigación de mercado', role: 'investigador', glyph: 'lab', color: '#4fd1c5' },
  { id: 'estudio', name: 'Estudio', desc: 'Fábrica de contenido', role: 'contenido', glyph: 'studio', color: '#c77dff' },
  { id: 'tienda', name: 'Tienda', desc: 'Sala de ventas', role: 'trafico', glyph: 'shop', color: '#f0a93b' },
  { id: 'banco', name: 'Banco', desc: 'Sala financiera', role: 'finanzas', glyph: 'bank', color: '#3ecf6a' },
  { id: 'taller', name: 'Taller', desc: 'Sala técnica', role: 'operaciones', glyph: 'workshop', color: '#4f8cff' },
];
