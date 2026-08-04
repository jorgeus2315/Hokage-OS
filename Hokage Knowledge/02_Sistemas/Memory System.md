> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §6. Congelado — v3.

## Knowledge System y Memoria

🔒 **CONGELADO — v3, arquitectura completa lista para implementar.** Elegido como el siguiente sistema del roadmap tras comparar cuatro candidatos (Memory System, Founder Profile, Secret Management, Hermes v2) contra el filtro de [[Núcleo - Arquitectura del Core|§0]] y contra dependencias reales — ver razonamiento completo en [[Resumen Ejecutivo - Decisiones Congeladas|el resumen ejecutivo (§16)]]. Esta versión corrige una imprecisión de la v2: el texto anterior asumía que `memory.write` (construido en la Fase 3 de [[Runtime, Scheduler y Event Bus|§2]]) se podía reutilizar tal cual añadiéndole un parámetro `category`. Verificado contra el código real, eso mezclaría dos semánticas de escritura incompatibles en una sola tool — se corrige aquí (ver "Dos escrituras, dos tools" más abajo).

### Por qué importa (sin cambios respecto a v1/v2)

`CLAUDE.md`: "memoria semántica que permite a Hokage recordar por qué fracasó algo hace 6 meses." `agent_memory` (lo único que existe hoy) es privada por agente — no sirve para esto. Jorge, al reabrir esta sección: *"No memoria de chat. Memoria empresarial. Debe recordar: decisiones, errores, intentos, investigaciones, resultados, aprendizajes, contexto."*

### Idea central: captura automática, no solo agentes que se acuerdan de escribir

Pedirle a un agente que "recuerde escribir en la memoria" es frágil — se olvida. La mayoría de las 7 categorías que pide Jorge ya son un efecto colateral de datos que el sistema **ya genera**: una decisión rechazada ya tiene `reasoning`; un `work_item` cancelado tras 3 reintentos ya es un error. La memoria empresarial se construye enganchando esos momentos, no inventando un flujo nuevo de "agente escribe recuerdo" como único mecanismo.

### Prerrequisito real, no opcional: threading estructural de `venture_id`

Verificado contra el código: hoy **no existe ningún campo `ventureId` estructural** entre `stage3_executeAgents()` y el resto del pipeline — solo el prefijo de texto `[VENTURE: nombre]` que se antepone al prompt (ver [[Modelo Multi-Venture]]). `AgentTask` (`agentRuntime.ts`) no tiene el campo; `askAgent()` (`aiService.ts`) no lo recibe; `ToolContext` (`tools/base.ts`) todavía conserva el campo **`businessId`**, un resto literal de antes del rename a `ventures` — nunca se usa, ningún tool lo lee.

Sin esto, `memory_entries` no puede filtrar por venture en la lectura — el sistema o no puede scopear la memoria por negocio (rompiendo el propósito del campo `venture_id` que Jorge ya pidió), o cada tool futuro que necesite venture reinventa su propio hack para conseguirlo (`decision.create` ya no lo necesitó porque hereda el mismo vacío que tenía el marcador — pero Memory System sí lo necesita porque **lee**, no solo escribe).

**Se cierra aquí, una vez, para que no se repita en cada tool futuro:**
1. `AgentTask.ventureId?: number | null` — nuevo campo.
2. `stage3_executeAgents()` ya tiene `item.venture_id` en memoria (línea 443) — se pasa a `runAgent()` además de seguir prefijando el texto `[VENTURE: ...]` (no se retira el prefijo, sigue siendo la señal que el modelo lee; el campo estructural es para que el *código*, no el modelo, sepa el venture).
3. `askAgent(agentId, userMessage, ventureId?)` — nuevo parámetro opcional.
4. `ToolContext.ventureId?: number | null` — sustituye a `businessId` (que se retira, cero llamadores hoy — mismo patrón de limpieza que `ToolRuntime`/`manager.ts` en la auditoría de esta sesión).
5. El único punto donde se construye `ToolContext` hoy (`aiService.ts`, dentro del loop de `tool_calls`: `registry.execute(toolId, args, { agentId })`) pasa a incluir `ventureId`.

Cambio pequeño, aditivo, no rompe ningún tool existente (todos ignoran campos de contexto que no usan) — pero es el que hace posible todo lo que sigue. Se implementa como el primer paso de esta fase, antes de las tools nuevas.

### Dos escrituras, dos tools — no una sola con un parámetro

`agent_memory` (lo que ya existe) es una tabla **clave-valor con upsert** — "lo que sé", se sobrescribe. `memory_entries` (lo nuevo) es un **log append-only** — "lo que aprendí", nunca se sobrescribe, cada entrada es un hecho distinto aunque se repita el tema. Son dos semánticas de escritura incompatibles (`UPDATE ... ON CONFLICT` vs `INSERT` puro). Meterlas en una tool con un parámetro `scope` que cambia el comportamiento de fondo es exactamente el tipo de ambigüedad que la migración de [[Runtime, Scheduler y Event Bus|§2]] se propuso eliminar — un tool, un propósito, un contrato claro (mismo principio que ya rige `trend.report`/`content.create`/`decision.create`).

**`memory.write` (Fase 3, ya construido) no se toca.** Sigue siendo la memoria privada por agente, sin cambios.

**`memory.remember` — tool nueva**, disponible a los mismos 6 roles tool-capable que el resto de las tools migradas (`operaciones`/`soporte` no participan en captura activa — consistente, ya no reciben ninguna otra tool tampoco):

```typescript
// tools/types.ts
export interface MemoryRememberInput {
  category: 'error' | 'attempt' | 'research' | 'learning' | 'context';
  // 'decision' y 'result' se excluyen aquí a propósito — esas dos categorías
  // solo las escribe la captura automática (ver abajo), nunca un agente a mano,
  // para que no compitan dos fuentes de verdad sobre el mismo hecho.
  title: string;
  content: string;
}
export interface MemoryRememberOutput {
  memoryId: number;
}
```

`execute(input, ctx)`: usa `ctx.ventureId` (del prerrequisito de arriba) directo — no hace falta que el agente lo declare, el sistema ya lo sabe por el `work_item` que lo invocó. Mismo patrón de log que el resto: `[TOOL:memory.remember] <agente> → memory_entries :: <categoria>/<título>`.

### Schema

```sql
CREATE TABLE memory_entries (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  venture_id           INTEGER REFERENCES ventures(id),  -- NULL = memoria de instalación
  category             TEXT NOT NULL,  -- decision|error|attempt|research|result|learning|context
  title                TEXT NOT NULL,
  content              TEXT NOT NULL,
  source_agent_id      INTEGER REFERENCES agents(id),    -- NULL si lo escribió el sistema o Jorge
  related_entity_type  TEXT,   -- 'decision' | 'objective' | 'work_item' | 'claude_consultation'
  related_entity_id    INTEGER,
  created_at           TEXT DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE memory_entries_fts USING fts5(title, content, content=memory_entries);
```

Sin cambios respecto a v2: se descarta explícitamente un vector store — sobre-ingeniería para el volumen real de hoy. La tabla FTS5 **no se usa para la inyección automática en el prompt** (ver "Lectura" abajo) — existe para un futuro endpoint de búsqueda manual, se construye ahora porque no cuesta nada crearla junto a la tabla base, no porque haya una feature que la consuma todavía.

### Captura automática — puntos de enganche verificados contra el código real, uno por uno

- **Decisión aprobada/rechazada** → en `decisionResolvers.ts::resolveDecisionApproval()` / `resolveDecisionRejection()` **directamente** (no en cada resolver de `entity_type` por separado — estas dos funciones ya son el punto único por el que pasa *toda* decisión, es el seam correcto). `category='decision'`, `content` = `decision.reasoning` (ya existe), `related_entity_type='decision'`.
- **`work_item` cancelado tras 3 reintentos** → `stage4_checkTTLs()` (`agentRuntime.ts:511`). **Cambio de forma necesario, no solo "engancharse":** hoy es un `UPDATE ... WHERE ...` masivo sin `SELECT` previo — no hay fila que capturar. Se reescribe como `SELECT` de las filas afectadas → `UPDATE` de esas filas por id → loop de captura, mismo patrón que ya usan `createContent`/`createMarket` (insertar, releer por id). `category='error'`.
- **Objetivo confirmado alcanzado** → `objectiveService.ts`, en los dos puntos reales de cierre: `closeMilestoneOnResult()` (camino automático, objetivos no financieros) y `markObjectiveAchieved()` (camino de confirmación humana, objetivos financieros — ver [[Goal System]]). `category='result'`.
- **Consulta a Claude respondida** (ver [[Hermes y Claude - Los Dos Motores|§9.2]]) → **no es un hook de código, es entrada manual.** Nuevo endpoint mínimo `POST /api/memory/learning` (`requireAdmin`) que Jorge (o yo, en su nombre, en una sesión como esta) llama para registrar la respuesta junto a la Decision original. `category='learning'`, `related_entity_type='claude_consultation'`.
- **Objetivo abandonado — NO se engancha, hallazgo honesto:** verificado por grep contra todo `backend/src/`: ningún código pone jamás `objectives.status = 'abandoned'`. Es un valor del tipo `ObjectiveStatus` que nunca se alcanza en la práctica. No se construye un hook para un estado que no existe — si en el futuro se añade una acción real de "abandonar objetivo", el hook se añade entonces, no antes.

### Lectura — simple a propósito, no búsqueda semántica

En `aiService.ts::askAgent()`, junto al bloque `[LO QUE SÉ]` ya existente (memoria privada, `agent_memory`), un segundo bloque `[MEMORIA DEL NEGOCIO]`:

```sql
SELECT category, title, content FROM memory_entries
WHERE venture_id = ? OR venture_id IS NULL
ORDER BY created_at DESC LIMIT 8
```

**Decisión de diseño explícita:** no se usa `memory_entries_fts` para esto. Una búsqueda por relevancia necesitaría una query de texto que hoy no existe de forma natural en el flujo (el agente no "pregunta" nada, solo recibe contexto) — construir un derivador de términos de búsqueda a partir de una tarea ad-hoc es la clase de sobre-ingeniería que este documento ya rechazó una vez (vector store, en la v1). Recencia acotada (8 entradas, mismo límite que ya usa `[LO QUE SÉ]`) es simple, predecible, y barata en tokens — coherente con la disciplina de coste de [[Economía|§10]]. FTS5 queda lista para el día que exista un panel de "buscar en memoria" real (ver [[Frontend - Decisiones v2|§13]], candidato futuro, no de esta fase) — ahí sí hay una query de texto genuina que buscar.

### API de lectura (para un futuro panel — no bloquea el resto de la fase)

```
GET  /api/memory?venture_id=N&category=X&limit=50   (requireAdmin)
POST /api/memory/learning                            (requireAdmin — captura manual de consultas a Claude)
```

### Retención

Sin poda en v1 — miles de filas son triviales para SQLite, y borrar memoria contradice el propósito del sistema. Umbral ya anotado en [[Escalabilidad|§14]] si el volumen real algún día lo justifica.

### Consecuencias a 2-3 años

Con captura automática desde ya, el historial de "qué se intentó y por qué falló" empieza a acumularse desde el primer venture, no desde el segundo — cuando llegue un segundo o tercer negocio, Hokage ya tiene años de contexto real que consultar, no una memoria vacía que empezó tarde. El threading de `venture_id` cerrado aquí como prerrequisito deja de ser un hack que cada tool futura reinventa — `memory.remember` es el primer consumidor, pero cualquier tool posterior que necesite saber "para qué venture trabajo" lo hereda gratis.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Runtime, Scheduler y Event Bus]] — Tool Calling, mecanismo que hereda `memory.remember`
- [[Modelo Multi-Venture]] — prerrequisito de threading de `venture_id`
- [[Goal System]] — objetivo alcanzado como punto de captura automática
- [[Founder Profile y La Fundación]] — contraparte "humana" de este sistema, y primer escritor automático (Fase 5 de La Fundación)
- [[Hermes y Claude - Los Dos Motores]] — consulta a Claude como punto de captura manual
- [[ADR-004 - Memory System]]
- [[Escalabilidad]] — umbral de poda/archivado
