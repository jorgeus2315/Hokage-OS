import type { Building, BuildingSection } from '../shared/types';

// Fase 9 (mecanismo A1) — qué pestañas tiene cada sala, resuelto por DATO (lookup por
// type/rol), nunca por `if (building.id === ...)`. Es el análogo a nivel de sección del
// PanelRegistry de layout (que sigue montando la sala como una entrada 'building-panel'):
// aquí no se decide DÓNDE va el panel, sino QUÉ secciones declara cada tipo de sala.
//
// Evolución a Fase 16: este mapa estático por rol se sustituye por la configuración de
// `departments.type` servida desde backend, sin rehacer BuildingView — el consumidor solo
// llama a sectionsForBuilding(). Hoy el dato vive en código; mañana en la BD.

export interface SectionTab {
  id: BuildingSection;
  label: string;
}

// Sala de negocio genérica (fallback). Chat pasa a Debug (C6 Fase 10): rename + no default.
const BASE: SectionTab[] = [
  { id: 'chat', label: 'Debug' },
  { id: 'outputs', label: 'Outputs' },
  { id: 'feed', label: 'Live Feed' },
  { id: 'stats', label: 'Stats' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'alerts', label: 'Alertas' },
  { id: 'config', label: 'Configurar' },
];

// Sala de sistema / Sala de Máquinas (Hermes, kernel) — Fase 8. Sin Chat (C2).
const SYSTEM: SectionTab[] = [
  { id: 'system', label: 'Sistema' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'stats', label: 'Stats' },
  { id: 'alerts', label: 'Alertas' },
];

// Sets curados por rol (Fase 9). Panel especializado primero (tab por defecto); en salas de
// negocio el Chat va al final como Debug (P4 → C6 Fase 10). Torre Hokage (ceo) es la
// EXCEPCIÓN: su Chat es el flujo conversacional principal (C1), primero y por defecto, no
// Debug. Congelados en [[Edificios - Definición Consolidada 2026-08-18]] §1.1.
const BY_ROLE: Record<string, SectionTab[]> = {
  // Torre Hokage: centro de mando. Sistema reutiliza SystemStatusPanel (Fase 8), datos reales
  // de /api/runtime/status + /api/metrics/summary. "Preguntas rápidas" diferido a C.5.
  ceo: [
    { id: 'chat', label: 'Chat' },
    { id: 'system', label: 'Sistema' },
    { id: 'feed', label: 'Live Feed' },
    { id: 'alerts', label: 'Alertas' },
    { id: 'config', label: 'Configurar' },
  ],
  finanzas: [
    { id: 'finance', label: 'Finanzas' },
    { id: 'stats', label: 'Stats' },
    { id: 'alerts', label: 'Alertas' },
    { id: 'config', label: 'Configurar' },
    { id: 'chat', label: 'Debug' },
  ],
  investigador: [
    { id: 'trends', label: 'Tendencias' },
    { id: 'feed', label: 'Live Feed' },
    { id: 'stats', label: 'Stats' },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'alerts', label: 'Alertas' },
    { id: 'config', label: 'Configurar' },
    { id: 'chat', label: 'Debug' },
  ],
  contenido: [
    { id: 'gallery', label: 'Contenido' },
    { id: 'feed', label: 'Live Feed' },
    { id: 'stats', label: 'Stats' },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'alerts', label: 'Alertas' },
    { id: 'config', label: 'Configurar' },
    { id: 'chat', label: 'Debug' },
  ],
};

// Fuente única de las secciones de una sala. Prioridad: tipo 'system' > rol curado > base.
export function sectionsForBuilding(building: Building): SectionTab[] {
  if (building.type === 'system') return SYSTEM;
  return BY_ROLE[building.role] ?? BASE;
}

// Sección inicial al entrar = primer tab declarado por la sala (data-driven, sin condicional
// por tipo/rol en el llamador).
export function defaultSectionFor(building: Building): BuildingSection {
  return sectionsForBuilding(building)[0].id;
}
