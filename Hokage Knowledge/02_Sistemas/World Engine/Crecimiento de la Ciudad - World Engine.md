> 🔒 **CONGELADO — arquitectura completa, sin cambios al modelo de datos del backend.** Noveno sistema de la fase de diseño, cierra (junto a [[Ciclo Día-Noche - World Engine]]) la arquitectura del World Engine antes de continuar el frontend, decisión de Jorge 2026-08-05. Extiende [[Frontend World Engine|§4.1]] ("N departamentos en anillos concéntricos") con un modelo de fases explícito.

## Por qué importa

`departments` ya es una tabla real (Fase 3 implementada, ver [[ADR-001 - World Engine]]) con `pos_x`/`pos_y` en unidades de mundo. Pero el layout actual asume implícitamente "un anillo alrededor del hub" — no define qué pasa cuando ese anillo se llena, ni cómo el mapa llega a sentirse como la "ciudad empresarial" que pide [[VISION|VISION.md]] (plantas, campus, caminos entre edificios) sin tener que rehacerse.

## Principio de diseño — el crecimiento es un algoritmo de layout, nunca una columna nueva

`departments` no cambia: `pos_x`/`pos_y` siguen siendo la única fuente de posición, con el mismo significado que ya tienen hoy desde la Fase 2 (cámara libre) — coordenadas de mundo. Lo que se añade es un **`WorldLayoutEngine`** puramente de frontend que decide dónde va cada departamento **cuando no hay una posición manual ya guardada**. Esto reutiliza directamente el flujo ya previsto en [[Frontend World Engine|Fase 7, modo edición]]: arrastrar un departamento persiste su `pos_x`/`pos_y` en la tabla (override manual); si nunca se ha arrastrado, el layout lo calcula. Ningún dato nuevo — un algoritmo que decide un valor por defecto para un campo que ya existe.

```typescript
// frontend/src/world/layoutEngine.ts
interface LayoutNode {
  departmentId: number;
  ring: number;        // 0 = hub, 1, 2, 3...
  district: string;    // 'core' por defecto — ver Fase 3 abajo
  x: number; y: number; // computado, o el override manual si existe
}

function computeLayout(departments: Department[]): LayoutNode[]
```

## Fases de crecimiento

### Fase A — Anillos concéntricos (hoy)

El hub (Torre Hokage) en el centro; los departamentos se distribuyen en un anillo a radio fijo, espaciados por ángulo (`360 / N`, generalización directa del pentágono actual). Cuando el anillo alcanza una capacidad cómoda (constante configurable, no un número mágico disperso — p.ej. 10-12 antes de que los edificios se amontonen visualmente), el siguiente departamento abre un segundo anillo a mayor radio. Esto ya es, en espíritu, lo que [[Frontend World Engine|§4.1]] describía — aquí se congela como algoritmo explícito con un límite de capacidad, no "N anillos indefinidos sin criterio".

### Fase B — Distritos o islas conectadas (cuando el espacio de anillos se agota)

Cuando los anillos concéntricos dejan de ser legibles (demasiados departamentos, demasiado lejos del hub), el `WorldLayoutEngine` abre un **distrito nuevo**: un clúster separado de departamentos con su propio centro local, conectado al hub principal por un camino — visual, no una nueva jerarquía de datos. `district` en `LayoutNode` es una etiqueta puramente de layout (por defecto `'core'`); el camino que conecta distritos es responsabilidad del **Renderer**, no del Event Adapter ni del backend — una primitiva visual más, del mismo vocabulario cerrado ya definido en [[Frontend World Engine|§6]] (círculo, rect, icono, partícula — aquí se añade "camino/línea", misma familia de primitivas seguras).

**Umbral de disparo, no construido preventivamente:** el paso de Fase A a Fase B se dispara cuando el número real de departamentos supere la capacidad de un anillo cómodo — hoy son 7, muy lejos del umbral. No se construye la lógica de distritos hasta que haga falta un segundo distrito real, mismo principio de "disparador explícito" que ya rige el resto de la especificación (§11.2, §4).

### Fase C — Campus especializados (futuro, sin tocar el modelo de datos)

Un campus es una **agrupación visual con tema propio** (p.ej. un distrito que agrupa Laboratorio + futuros departamentos de IA, con su propia paleta de fondo) — se construye enteramente sobre el mismo campo `district` de `LayoutNode`, asignado por un manifiesto de layout en frontend (`districtId` por `department.key`, similar al registro de `DepartmentRegistry` de §6), nunca por una columna nueva en `departments`. Si algún día un distrito necesita persistir su asignación (para que sobreviva a un recálculo de layout, o para que el modo edición lo mueva), **esa es la señal explícita de añadir `departments.district` como migración aditiva** — no antes.

## Departamentos permanentes, ventures dentro — sin cambios

Ratifica [[ADR-006 - Multi-Venture]] sin modificarlo: los edificios son los departamentos, permanentes; un venture nuevo nunca crea un edificio — se gestiona dentro del departamento correspondiente vía paneles internos (mismo patrón ya fijado para Tienda en [[Frontend - Decisiones v2|§13 v3]]: listado de tiendas dentro de un único edificio Tienda). El `WorldLayoutEngine` no sabe qué es un venture — solo posiciona departamentos.

## Consecuencias a 2-3 años

Con el layout como algoritmo puro sobre datos que ya existen, Hokage OS puede crecer de 7 a 30 departamentos sin que nadie reescriba el mapa — el `WorldLayoutEngine` recalcula anillos/distritos automáticamente, y cualquier posición ajustada a mano por Jorge (Fase 7) se respeta como override permanente. El riesgo conocido: si el número de departamentos crece mucho más rápido que la capacidad visual de un distrito, la heurística de "cuándo abrir un distrito nuevo" puede necesitar ajuste — se revisita con datos reales de cuántos departamentos existen, no antes.

---

## Relacionado

- [[Frontend World Engine]]
- [[Frontend - Decisiones v2]]
- [[ADR-001 - World Engine]]
- [[ADR-006 - Multi-Venture]]
- [[Ciclo Día-Noche - World Engine]]
- [[INDEX]]
