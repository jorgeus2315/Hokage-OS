// WorldLayoutEngine — Fase 8 del Plan de Migración ECS (opcional, primera
// feature real que el ECS hace posible, no parte estricta del refactor).
// Implementa exactamente lo congelado en "Crecimiento de la Ciudad - World
// Engine" (bóveda, 02_Sistemas/World Engine): Fase A del diseño (anillos
// concéntricos con umbral de capacidad). Fases B/C (distritos/campus) NO
// se construyen aquí — disparador explícito todavía no alcanzado (7
// departamentos hoy, muy lejos del umbral de 12 por anillo).
//
// `departments` no cambia de esquema — pos_x/pos_y siguen siendo la única
// fuente de posición. Este motor decide un valor por defecto SOLO cuando
// no hay uno ya guardado ni bloqueado. El modo de arrastre que persiste
// una posición manual (Fase 7 del roadmap original de World Engine, no de
// esta migración ECS) no se construye aquí — sigue pendiente, fuera de
// alcance de esta fase.
//
// Nombre y firma (`computeLayout`, `LayoutNode`) tal como los fija el
// diseño congelado — no el nombre `DepartmentRegistry` que usaba el
// boceto original de esta fase (escrito un día antes de que ese diseño se
// cerrara); se sigue la versión más reciente y más específica, no la más
// vieja, mismo criterio que ya aplicó la Fase 5 al desviarse del texto
// original sobre dónde vive el estado de la cámara.

const WORLD_CENTER = { x: 1000, y: 1000 };
const RING_BASE_RADIUS = 400;
const RING_STEP = 260; // separación radial entre anillos sucesivos
const RING_CAPACITY = 12; // constante configurable, no un número mágico disperso — Fase A del diseño congelado

// Forma mínima estructural — world/ no importa Building de shared/types,
// mismo criterio ya establecido en EventAdapter.ts (Fase 7).
export interface DepartmentInput {
  id: string;
  pos_x?: number;
  pos_y?: number;
  position_locked?: boolean;
}

export interface LayoutNode {
  departmentId: string;
  ring: number;      // 1, 2, 3... (0 se reserva conceptualmente al hub, que no pasa por este motor)
  district: string;  // 'core' — Fases B/C no disparadas todavía
  x: number;
  y: number;
}

export function computeLayout(departments: DepartmentInput[]): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  const toCompute: DepartmentInput[] = [];

  for (const dept of departments) {
    const hasStoredPos = dept.pos_x !== undefined && dept.pos_y !== undefined;
    if (dept.position_locked || hasStoredPos) {
      // Posición bloqueada o ya guardada — el motor nunca la sobreescribe.
      // Mismo comportamiento exacto que useWorldState.ts tenía inline antes
      // de esta fase para "pos_x/pos_y definidos" — hoy los 7 departamentos
      // reales caen aquí, cero cambio visual.
      nodes.push({
        departmentId: dept.id,
        ring: 1,
        district: 'core',
        x: dept.pos_x ?? WORLD_CENTER.x,
        y: dept.pos_y ?? WORLD_CENTER.y,
      });
    } else {
      toCompute.push(dept);
    }
  }

  // Fase A — anillos concéntricos: los departamentos sin posición guardada
  // ni bloqueada se reparten en el anillo actual hasta RING_CAPACITY, y
  // abren un anillo nuevo a mayor radio al superarla. No alcanzable con el
  // volumen real de hoy — construido para cuando sí lo sea. Cuando
  // toCompute.length <= RING_CAPACITY, el resultado es idéntico a la
  // fórmula de un único anillo que useWorldState.ts ya usaba (ángulo
  // -90 + 360/N * i, radio fijo).
  toCompute.forEach((dept, idx) => {
    const ring = Math.floor(idx / RING_CAPACITY) + 1;
    const indexInRing = idx % RING_CAPACITY;
    const countInThisRing = Math.min(RING_CAPACITY, toCompute.length - (ring - 1) * RING_CAPACITY);
    const angle = (-90 + (360 / countInThisRing) * indexInRing) * (Math.PI / 180);
    const radius = RING_BASE_RADIUS + (ring - 1) * RING_STEP;
    nodes.push({
      departmentId: dept.id,
      ring,
      district: 'core',
      x: WORLD_CENTER.x + radius * Math.cos(angle),
      y: WORLD_CENTER.y + radius * Math.sin(angle),
    });
  });

  return nodes;
}
