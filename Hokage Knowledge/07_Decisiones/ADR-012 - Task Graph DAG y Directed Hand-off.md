# ADR-012 — Task Graph DAG y Directed Hand-off
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado (2026-08-15)
> Sintetizado desde [[BLOQUE_0_DECISIONES_FUNDACIONALES]] §D (y [[HOKAGE_AGENT_OPERATING_MODEL]] §5) — cierre del Bloque 1.

---

## Contexto

El modelo actual de tareas en `hokage_tasks` usa **`phase` (INTEGER)** como proxy de dependencia: la fase N solo se despacha cuando la N-1 terminó OK. Esto es un **DAG lineal encubierto** con tres limitaciones críticas:

1. **Sin fan-out/fan-in real**: una tarea no puede tener múltiples predecesoras ni múltiples sucesoras.
2. **Sin hand-off dirigido**: el output de una tarea no se pasa explícitamente a la siguiente; el orquestador reconstruye contexto desde `result` (string libre).
3. **Sin `review_of`**: no hay forma de modelar "tarea B revisa el trabajo de tarea A" — solo fases secuenciales.

El Bloque 0 exige:
- **L·1**: clave de dominio estable — `hokage_tasks.role` ya usa `role_definitions.key`.
- **L·9** (ADR-009): Hokage es **única autoridad de orquestación** — el grafo vive en su ledger, no en el runtime de agentes.
- **L·10** (ADR-010): Quality Floors — una tarea de revisión (`review_of`) debe poder bloquear/retroalimentar.

---

## Decisión

Reemplazar `phase` por un **grafo dirigido acíclico (DAG) explícito** con tres tipos de arista: `depends_on`, `handoff`, `review_of`. El grafo se persiste en tabla `task_edges`; `hokage_tasks.phase` se **mantiene como campo derivado (topological order)** para compatibilidad y UI, pero **no es la fuente de verdad**.

### 1. Tipos de arista (EdgeType)

```typescript
// src/types/index.ts — NUEVO
export type TaskEdgeType = 'depends_on' | 'handoff' | 'review_of';

export interface TaskEdge {
  id: number;
  command_id: number;              // scope: todas las aristas de un command
  from_task_id: number;            // predecesora
  to_task_id: number;              // sucesora
  type: TaskEdgeType;
  payload?: string;                // JSON: para handoff = claves a pasar; para review_of = criterios
  created_at: string;
}

/*
  depends_on  — to_task no empieza hasta que from_task.status = 'completed'.
                Sin transferencia de datos explícita (contexto implícito via venture/memory).

  handoff     — to_task empieza cuando from_task.completed Y recibe payload estructurado.
                payload = JSON con keys a extraer del result de from_task y inyectar en prompt de to_task.
                Ejemplo: {"keys": ["keywords", "outline"], "template": "Keywords: {{keywords}}\nOutline: {{outline}}"}
                El orquestador resuelve el template y lo pasa como `context.handoff` al work_item.

  review_of   — to_task es una REVISIÓN del trabajo de from_task.
                from_task.status = 'completed' → to_task se despacha con role='reviewer' (o role original + flag).
                to_task recibe: context.review_of = {task_id, result, criteria: payload.criteria}.
                to_task produce: verdict (pass|fail|needs_changes), feedback, score.
                Si verdict = 'fail' o 'needs_changes' → from_task vuelve a 'dispatched' (retry) con feedback inyectado.
                Máximo 2 ciclos de review por tarea (tope duro, configurable en role_definitions.max_review_cycles default 2).
*/
```

### 2. Tabla `task_edges` (NUEVA)

```sql
CREATE TABLE IF NOT EXISTS task_edges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id      INTEGER NOT NULL REFERENCES hokage_commands(id) ON DELETE CASCADE,
  from_task_id    INTEGER NOT NULL REFERENCES hokage_tasks(id) ON DELETE CASCADE,
  to_task_id      INTEGER NOT NULL REFERENCES hokage_tasks(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('depends_on','handoff','review_of')),
  payload         TEXT NOT NULL DEFAULT '{}',   -- JSON, ver TaskEdge.payload
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_edges_command ON task_edges(command_id);
CREATE INDEX idx_task_edges_from ON task_edges(from_task_id);
CREATE INDEX idx_task_edges_to ON task_edges(to_task_id);
-- Unicidad: no dos aristas iguales entre mismos nodos del mismo tipo
CREATE UNIQUE INDEX idx_task_edges_unique ON task_edges(command_id, from_task_id, to_task_id, type);
```

### 3. `hokage_tasks` — columnas nuevas (migración aditiva)

```sql
-- phase se mantiene (derivado), pero añade:
ALTER TABLE hokage_tasks ADD COLUMN depends_on_count INTEGER NOT NULL DEFAULT 0;   -- caché: nº de depends_on entrantes
ALTER TABLE hokage_tasks ADD COLUMN handoff_input TEXT;                            -- JSON resuelto del handoff entrante
ALTER TABLE hokage_tasks ADD COLUMN review_cycles INTEGER NOT NULL DEFAULT 0;      -- cuántas review_of ha sufrido
ALTER TABLE hokage_tasks ADD COLUMN review_verdict TEXT;                           -- 'pass'|'fail'|'needs_changes' (último)
ALTER TABLE hokage_tasks ADD COLUMN review_feedback TEXT;                          -- feedback del reviewer
```

### 4. Validación de DAG (en `validatePlan` — determinista, sin LLM)

```typescript
// src/config/taskGraph.ts — NUEVO
export interface ValidatedTaskGraph {
  tasks: HokageTask[];           // ya validados individualmente
  edges: TaskEdge[];             // ya validados
  topologicalOrder: number[];    // task_ids en orden de ejecución
  phases: Map<number, number>;   // task_id → phase (nivel topológico)
  hasReviewCycles: boolean;      // true si hay edges type='review_of'
}

export function validateTaskGraph(tasks: HokageTask[], edges: TaskEdge[]): ValidatedTaskGraph {
  // 1. Todos los task_ids existen en tasks y pertenecen al mismo command_id
  // 2. No auto-loops (from === to)
  // 3. No aristas duplicadas (unique index lo garantiza en BD, pero validamos temprano)
  // 4. **DAG check**: Kahn's algorithm — detectar ciclos. Si hay ciclo → throw con camino.
  // 5. Para cada edge type='review_of': from_task.role ≠ to_task.role (revisor distinto) OBLIGATORIO.
  // 6. Para cada edge type='handoff': payload.keys[] no vacío, template válido (handlebars simple).
  // 7. Calcular topologicalOrder y phases (nivel = longest path from roots).
  // 8. Actualizar tasks[i].phase = phases[task_id] (campo derivado para UI).
  // 9. Calcular depends_on_count por tarea (entrantes type='depends_on').
  
  return { tasks, edges, topologicalOrder, phases, hasReviewCycles: ... };
}
```

### 5. Dispatch en `hokageOrchestrator.ts` — `dispatchPhase` → `dispatchReadyTasks`

```typescript
// REEMPLAZA dispatchPhase (basado en phase) POR:
async function dispatchReadyTasks(commandId: number): Promise<void> {
  // 1. Leer tasks + edges del command
  // 2. Calcular readySet: tasks WHERE status='pending' AND depends_on_count = 0
  //    (para tareas con handoff: also verificar que from_task tiene result)
  // 3. Para cada ready task:
  //    a. Resolver handoff_input si hay edges entrantes type='handoff' desde completed tasks
  //    b. Seleccionar agente via agentSelector.select (ADR-011)
  //    c. Crear work_item con context.handoff = handoff_input resuelto
  //    d. Actualizar task: status='dispatched', agent_id, work_item_id, handoff_input
  // 4. Emitir event 'tasks.dispatched' con array de task_ids
}

// Advance logic (cuando work_item completa):
async function onWorkItemComplete(workItemId: number, result: any): Promise<void> {
  const task = await getTaskByWorkItem(workItemId);
  await updateTask(task.id, { status: 'completed', result: JSON.stringify(result) });
  
  // 1. Decrementar depends_on_count de sucesoras (edges type='depends_on' FROM this)
  // 2. Para edges type='handoff' FROM this: resolver template → escribir handoff_input en to_task
  // 3. Para edges type='review_of' FROM this: crear/despachar review task si review_cycles < max
  // 4. Si TODAS las tareas del command completadas (o failed terminal) → finalizeCommand
}
```

### 6. Review Cycle (semántica `review_of`)

```typescript
// En onWorkItemComplete, para cada edge type='review_of' WHERE from_task_id = completedTask.id:
async function spawnReview(edge: TaskEdge, fromTask: HokageTask): Promise<void> {
  const toTask = await getTask(edge.to_task_id);
  if (toTask.review_cycles >= getMaxReviewCycles(toTask.role)) {
    // Tope alcanzado → marcar from_task como 'failed' con error "max review cycles"
    await updateTask(fromTask.id, { status: 'failed', error: 'Max review cycles exceeded' });
    return;
  }
  
  // Preparar contexto de revisión
  const reviewContext = {
    review_of: {
      task_id: fromTask.id,
      title: fromTask.title,
      result: JSON.parse(fromTask.result || '{}'),
      criteria: JSON.parse(edge.payload || '{}').criteria || 'Calidad general, completitud, alineación con objetivo'
    },
    handoff: toTask.handoff_input  // hereda handoff de la tarea original si existe
  };
  
  // Despachar to_task (que ya existe en el plan) con context.review_of
  await dispatchSingleTask(toTask.id, reviewContext);
  await updateTask(toTask.id, { 
    status: 'dispatched', 
    review_cycles: toTask.review_cycles + 1 
  });
}

// Cuando review task completa:
async function onReviewComplete(reviewTaskId: number, result: any): Promise<void> {
  const reviewTask = await getTask(reviewTaskId);
  const edge = await getReviewEdge(reviewTaskId);  // edge donde to_task_id = reviewTaskId
  const targetTask = await getTask(edge.from_task_id);
  
  const verdict = result.verdict;  // 'pass' | 'fail' | 'needs_changes'
  await updateTask(reviewTaskId, { 
    status: 'completed', 
    result: JSON.stringify(result),
    review_verdict: verdict,
    review_feedback: result.feedback 
  });
  
  if (verdict === 'pass') {
    // Target task ya está completed → nada más, continúa el grafo
    return;
  }
  
  // verdict = 'fail' o 'needs_changes' → reintentar target task
  await updateTask(targetTask.id, {
    status: 'pending',           // vuelve a cola
    work_item_id: null,
    agent_id: null,
    error: result.feedback,      // feedback inyectado para el retry
    review_cycles: targetTask.review_cycles + 1
  });
  // El próximo dispatchReadyTasks lo recogerá
}
```

### 7. Compatibilidad y migración

- **`phase` no se borra**: se recalcula en `validatePlan` y se escribe en `hokage_tasks.phase` para que la UI siga funcionando (agrupación visual por fases).
- **Planes legacy** (solo `phase` sin edges): `validatePlan` genera edges `depends_on` implícitos `phase N → phase N+1` para mantener comportamiento actual.
- **Migración aditiva**: solo añade `task_edges` tabla y columnas en `hokage_tasks`. Datos existentes intactos.

---

## Alternativas consideradas

| Alternativa | Por qué no |
|-------------|------------|
| Mantener `phase` como única dependencia | No permite fan-out (una tarea alimenta a 3), ni handoff explícito, ni review_of. |
| Grafo en memoria (no persistido) | Pierde estado al reiniciar; no auditable; Hokage no puede re-planificar sobre grafo parcial. |
| `depends_on` como array JSON en `hokage_tasks` | No permite metadata por arista (payload de handoff, criteria de review), no consultable por SQL. |
| Arista única tipo `depends` con flags | Mezcla semánticas distintas; `handoff` y `review_of` tienen comportamiento runtime diferente. |

---

## Consecuencias

1. **Hokage sigue siendo única autoridad**: el grafo vive en `hokage_commands`/`hokage_tasks`/`task_edges`. El `agentRuntime` solo ejecuta `work_items` que le llegan.
2. **`validatePlan` es el guardián**: cualquier plan del LLM pasa por validación determinista de DAG antes de persistir. Plan inválido = rechazo con error explicativo.
3. **Review cycles acotados**: tope duro (default 2) evita bucles infinitos. Configurable por rol en `role_definitions.max_review_cycles`.
4. **Handoff = contrato de datos**: `payload.template` obliga a definir qué pasa entre tareas. Elimina "contexto implícito perdido".
5. **Fases derivadas**: UI agrupa por `phase` (nivel topológico), pero la ejecución sigue el DAG real. Una fase puede tener tareas que corren en paralelo (mismo level, sin depends_on entre ellas).

---

## Estado de implementación (diseño aprobado, no autorizado para código)

**Archivos a crear/modificar:**
- `src/types/index.ts` — `TaskEdgeType`, `TaskEdge`, `ValidatedTaskGraph`
- `src/config/taskGraph.ts` — `validateTaskGraph` (Kahn + reglas semánticas)
- `src/db/init.ts` — migración: `CREATE TABLE task_edges` + columnas en `hokage_tasks`
- `src/services/hokageOrchestrator.ts` — `dispatchPhase` → `dispatchReadyTasks` + `onWorkItemComplete` con lógica de edges
- `src/services/roleService.ts` — `role_definitions.max_review_cycles` (default 2) en seeds y validación
- `src/config/roleSeeds.ts` — añadir `max_review_cycles` a roles que lo necesiten (reviewer, ceo)

**Tests requeridos (antes de cableado):**
- `validateTaskGraph` — DAG válido, ciclo detectado, review_of sin reviewer distinto, handoff payload inválido
- `dispatchReadyTasks` — tasks en paralelo (mismo level), handoff resuelto, review cycle spawn
- `onWorkItemComplete` — depends_on decrement, handoff propagation, review pass/fail/needs_changes
- Migración idempotente — tabla nueva, columnas nuevas, datos legacy generan edges implícitos

---

## Relacionado

- [[BLOQUE_0_DECISIONES_FUNDACIONALES]] · [[HOKAGE_AGENT_OPERATING_MODEL]] · [[ADR-009 - Hokage Cadena de Orquestación]]
- [[ADR-010 - Quality Floors, Coste y Revisión]] · [[ADR-011 - Agent Registry y Capability-based Selection]]
- [[ADR-014 - Result Evaluation y Diagnostic Remediation]] · [[Resumen Ejecutivo - Decisiones Congeladas]] · [[INDEX]]