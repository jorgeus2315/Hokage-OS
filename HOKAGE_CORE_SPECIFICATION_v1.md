# HOKAGE CORE SPECIFICATION v1

**Estado:** Documento de congelación arquitectónica. No es aspiracional — cada decisión aquí está verificada contra el código real a 2026-08-04, no contra lo que algún documento anterior dijo que "debería" existir.

**Por qué existe:** Jorge pidió parar de construir features hasta cerrar las decisiones fundamentales, antes de diseñar un Setup Wizard que automatice la configuración inicial de Hokage OS. Este documento es esa auditoría, convertida en especificación oficial.

**Relación con otros documentos:**
- `ARCHITECTURE.md` (raíz) y `docs/specs/FRONTEND_WORLD_ENGINE.md` contienen diseño real y valioso — de hecho, resuelven en principio más de la mitad de los temas de este documento. Pero describen una versión anterior del sistema (5 agentes con roles que ya no existen — Diseñador, Tesorero, Vendedor —, una tabla `agent_tasks` que nunca se implementó, `businesses` en vez de `ventures`) y llevan sin tocarse desde el 2026-08-02, antes de la mitad del trabajo de esta sesión. **Este documento tiene prioridad donde contradiga a los anteriores.** Las partes de `ARCHITECTURE.md` que siguen vivas se citan y ratifican explícitamente abajo; las que quedan obsoletas se marcan como tal.
- `docs/adr/`, `docs/decisions/`, `docs/architecture/` existen como carpetas pero están completamente vacías — nunca se usaron. Este documento ocupa ese hueco.
- `CLAUDE.md` (raíz, checked into el repo) sigue siendo la fuente de verdad para reglas operativas del día a día (skills, checklist, flujo de sesión) — este documento no lo sustituye, lo complementa a nivel de núcleo.

**Leyenda:**
- 🔒 **CONGELADO** — decisión cerrada. No se re-discute sin una razón nueva y de peso.
- 🆕 **DECISIÓN NUEVA** — no existía ninguna decisión previa sobre esto; se fija aquí por primera vez.
- ⚠️ **REQUIERE TU CONFIRMACIÓN** — propongo una decisión definitiva, pero cambia el rumbo del producto lo suficiente como para que la valides explícitamente antes de que se empiece a construir sobre ella.

---

## Índice

0. [Principio rector](#0-principio-rector)
1. [Arquitectura del Core](#1-arquitectura-del-core)
2. [Runtime, Scheduler y Sistema de eventos](#2-runtime-scheduler-y-sistema-de-eventos)
3. [Modelo multi-venture](#3-modelo-multi-venture)
4. [Agentes](#4-agentes)
5. [Goal System](#5-goal-system)
6. [Knowledge System y Memoria](#6-knowledge-system-y-memoria)
7. [Automatizaciones (agente → agente)](#7-automatizaciones-agente--agente)
8. [Business Modules, Integraciones, Plugins y MCP](#8-business-modules-integraciones-plugins-y-mcp)
9. [Hermes — papel exacto](#9-hermes--papel-exacto)
10. [Economía](#10-economía)
11. [Seguridad, Permisos, Secretos y VPS](#11-seguridad-permisos-secretos-y-vps)
12. [Configuración inicial: Wizard, Founder Profile, System Profile](#12-configuración-inicial-wizard-founder-profile-system-profile)
13. [Frontend: Mapa, HUD, Terminal, las 7 vistas](#13-frontend-mapa-hud-terminal-las-7-vistas)
14. [Escalabilidad](#14-escalabilidad)
15. [Recetas: añadir negocio / agente / plugin](#15-recetas-añadir-negocio--agente--plugin)
16. [Resumen ejecutivo](#16-resumen-ejecutivo)

---

## 0. Principio rector

🔒 **CONGELADO** — ya establecido en `docs/specs/FRONTEND_WORLD_ENGINE.md §0` y en `CLAUDE.md`, se ratifica sin cambios:

> El frontend no tiene estado propio de negocio. Es una proyección del estado del backend. Ninguna pantalla inventa datos ni lógica de negocio. Si algo se mueve en la interfaz es porque un evento del backend dijo que se moviera.

A esto se añade el principio que gobernó la sesión de limpieza previa a este documento, y que se congela aquí formalmente:

> **Toda decisión de arquitectura debe responder cinco preguntas antes de construirse:** ¿aporta valor?, ¿es coherente?, ¿complica la experiencia?, ¿duplica algo?, ¿cómo afecta dentro de tres años? Si existe una solución más simple, se elige esa. Hokage OS es un sistema elegante, no un catálogo de funciones.

---

## 1. Arquitectura del Core

🔒 **CONGELADO** — verificado contra el código real, no contra el `ARCHITECTURE.md` original (que describe una capa de tools con `ZodSchema` y clases `BaseTool` que nunca existieron; el código real usa un `Tool` interface más simple con `inputSchema`/`outputSchema` como objetos planos — ese es el contrato real y el que se congela).

### Capas (backend)

```
rutas (server.ts)  →  servicios (services/*.ts)  →  db (db/init.ts, run/get/all)
                    ↘  runtime (config/agentRuntime.ts)  →  aiService.ts  →  OpenRouter
                    ↘  bus en memoria (config/eventBus.ts)  →  WebSocket broadcast
```

- **Un único fichero de rutas** (`server.ts`). No hay routers separados — se intentó una vez (`routes/progress.ts`) y se retiró en esta sesión precisamente porque era la única excepción al patrón. **Regla fija: toda ruta HTTP vive en `server.ts`.**
- **Servicios son la única capa que toca SQL.** Las rutas nunca escriben SQL directo salvo consultas triviales de un solo `SELECT`/`UPDATE` sin lógica (ventures, assets, automations siguen este patrón más laxo hoy — ver §8, es una inconsistencia menor, no se resuelve en v1).
- **`db/init.ts` es la única fuente del schema.** Las migraciones son siempre aditivas (`ALTER TABLE ... ADD COLUMN`, con `columnExists()` de guarda) o `CREATE TABLE IF NOT EXISTS`. Nunca se borra una columna en código — si una tabla queda huérfana, se elimina explícitamente con confirmación humana (como se hizo con las 8 tablas legacy de esta sesión), nunca mediante una migración automática.
- **El punto de extensión para "aprobar X dispara Y real" es `decisionResolvers.ts`.** Mapa `entity_type → resolver`, no `if` sueltos en las rutas. Cualquier decisión futura que necesite ejecutar algo real tras la aprobación de Jorge (nuevo negocio, nuevo plugin, lo que sea) se registra ahí. **Este es el seam central de todo el sistema de aprobación — cualquier feature de auto-configuración que necesite "Jorge aprueba X" pasa por aquí, no inventa su propio mecanismo.**

### Capas (frontend)

```
useAppData.ts (hook único de datos)  →  GameLayout.tsx (orquestador)  →  vistas (views/*.tsx)  →  paneles (panels/*.tsx)
```

- Un único hook (`useAppData`) es la fuente de todo el estado remoto. Las vistas no hacen fetch propio salvo datos que solo ellas necesitan (`OutputsPanel`, `TerminalPanel`, `ConfigView` hacen su propio polling porque su dato no es global).
- El **World Engine** (PixiJS) vive aislado del React Shell — ver §13. Nunca se mezclan: el mundo vivo se pinta en un único `<WorldCanvas/>`, todo lo demás es DOM.

### Lo que nunca cambia (ratificado de `ARCHITECTURE.md §12`, sigue siendo cierto)

- La estructura de carpetas del backend (`config/`, `db/`, `services/`, `tools/`, `types/`).
- El contrato del Event Bus: emit → listen, nunca persistencia a SQL (ver §2).
- Los tipos centralizados en `types/index.ts` (backend) y `shared/types.ts` (frontend) — nunca duplicados en otro fichero.
- El patrón de aprobación para acciones costosas, públicas o de sistema: se crea una `Decision`, nunca se ejecuta directo.

---

## 2. Runtime, Scheduler y Sistema de eventos

🔒 **CONGELADO** — el diseño real (verificado en `agentRuntime.ts`) diverge del `ARCHITECTURE.md §5` original (que describía un scheduler con "8 etapas" más elaborado, con locking TTL configurable por tabla `work_items` con más columnas). Lo que existe y funciona hoy:

### Runtime

Un único `AgentRuntime` (`config/agentRuntime.ts`) con un tick de **poll cada 10s**, no un scheduler por-agente con timers independientes. Cada tick ejecuta, en orden fijo:

1. Drenar eventos del bus → crear `work_items` según `automations` activas.
2. Asignar trabajo: agentes con `agent_schedules` vencido → nuevo `work_item` autónomo. Bloquear `pending` → `in_progress` (máx 5 por tick, respetando presupuesto).
3. Ejecutar hasta 3 `work_items` `in_progress` → llamar al LLM → persistir resultado.
4. Comprobar TTLs expirados → devolver a `pending` o cancelar tras 3 reintentos.
5. Cerrar el loop de decisiones aprobadas sin ejecución pendiente.
6. Métricas + auto-expirar decisiones de +48h.

**Esto sobrevive reinicios de forma parcial**: `agent_schedules.next_run_at` persiste en SQLite (no en memoria), así que un reinicio no pierde el timer — pero el propio bucle de polling (`setTimeout` recursivo) sí se detiene si el proceso muere, y no hay supervisor de proceso todavía (ver §11, VPS).

### Scheduler — decisión de diseño

**Elegido:** poll centralizado cada 10s sobre una cola en SQLite (`work_items`), no un timer por agente. Alternativas descartadas:
- *Timer independiente por agente* (`setInterval` por rol): es lo que había en versiones anteriores del proyecto (mencionado en `docs/prompts/INIT_PROMPT.md`) — se abandonó porque no daba visibilidad de cola ni permitía priorización cruzada entre agentes.
- *Cron externo (node-cron, Bull/Redis)*: exceso de infraestructura para el volumen actual (8 agentes, ciclos de 15-60 min). Se revisita solo si el número de agentes crece a decenas o si se necesita distribuir el runtime entre varios procesos (ver §14, Escalabilidad).

**Consecuencia a 2-3 años:** un poll de 10s con hasta 5 asignaciones y 3 ejecuciones por tick tiene techo natural alrededor de un par de docenas de agentes activos simultáneos antes de que la latencia de cola se note. Ese es el límite conocido y aceptado para v1 — no se over-diseña un scheduler distribuido que hoy no hace falta.

### Contraste contra investigación previa del proyecto (nuevo en esta ronda)

`docs/research/world-engine/prison-architect.md` y `rimworld.md` son investigación real, ya existente en el repo, nunca cruzada contra esta sección hasta ahora — un fallo de la v1 de este documento, no una omisión consciente. Contrastadas contra el código real:

| Recomendación investigada | Estado |
|---|---|
| R1 — evento genera work item directamente | ✅ Ya implementado (`stage1_drainBusEvents`) |
| R2 — locking In-Progress con TTL | ✅ Ya implementado (`locked_at`/`ttl_minutes`) |
| R3 — prioridades explícitas en cola | ✅ Ya implementado (`work_items.priority`) |
| R4 — dos umbrales de salud del agente | ✅ Ya implementado (`agent_budgets` 80%/100%) |
| R5 — verificar que el agente tiene las tools antes de asignar | ❌ No implementado — gap real, pequeño, no bloqueante |
| R6 — aging de work items (starvation) | Correctamente diferido — "cuando la cola tenga volumen real" |
| R7 — overlays de datos activables en el mapa | ❌ No implementado — ver §13, ahora sí incorporado al documento |

R1-R4 confirman que el Runtime ya sigue, sin que se supiera explícitamente hasta hoy, patrones investigados con rigor. R5 y R7 quedan anotadas como deuda de diseño conocida, no crítica.

### Sistema de eventos (Event Bus)

**Contrato inquebrantable, ya eliminado el único punto que lo violaba (`addEvent()`, código muerto borrado esta sesión):** el bus (`HokageBus extends EventEmitter`) es **estrictamente en memoria**, con un `history[]` de las últimas 100 entradas. Nunca escribe a SQL. Si el proceso reinicia, el historial de eventos se pierde — eso es aceptado por diseño (la verdad de fondo vive en las tablas de dominio: `decisions`, `work_items`, `messages`, no en el log de eventos).

Vocabulario cerrado de eventos (`AgentEventType` en `eventBus.ts`): `trend.detected`, `content.created`, `content.ready`, `decision.created/approved/rejected`, `sale.made`, `alert.triggered`, `agent.task.start/done/error`, `report.daily`, `system.error`, `objective.created/approved/achieved`. Añadir un evento nuevo es añadir un valor al union type — nunca un canal nuevo.

**Regla dura:** cualquier reacción visual a un evento (ver §13, Mapa) se define como tabla de reacciones, nunca como `if`/`switch` disperso. Esto ya estaba bien diseñado en `FRONTEND_WORLD_ENGINE.md §3.3` y sigue siendo la decisión correcta, aunque el "Animation Director" formal descrito ahí no se ha extraído todavía como módulo — hoy vive, parcialmente, como lógica ad-hoc en `useWorldState.ts`. **Deuda reconocida, no bloqueante.**

### De marcadores de texto a Tool Calling — decisión de esta ronda

🔒 **CONGELADO.** Encontrado en la auditoría crítica final pre-lanzamiento (§16 — "un problema encontrado, no cero") y aceptado por Jorge sin reservas.

**El problema, verificado en código:** todo efecto estructurado que un agente dispara — crear una `Decision`, reportar una tendencia, registrar contenido creado, escribir en `agent_memory` — pasa hoy por `agentRuntime.ts` líneas 208-251 buscando patrones `[DECISION: ...]`, `[TENDENCIA: ...]`, `[CONTENIDO: ...]`, `[MEMORIA: ...]` sobre el texto libre de la respuesta del LLM, con `matchAll`/`match`. **Esto convive, en el mismo codebase, con un mecanismo estrictamente mejor que ya funciona:** `aiService.ts` implementa function-calling real de OpenRouter (`tool_calls`, `registry.execute()`) para `system.exec`, `google.trends`, `web.browser`. Un marcador mal formateado no genera error ni log — el efecto simplemente no ocurre, sin traza. §6 (Memory System v2) iba a añadir un quinto marcador (`[APRENDIZAJE: ...]`) sobre el mismo patrón frágil, justo cuando se estaba a punto de construir más encima.

**Decisión:** los 4 marcadores existentes se migran a Tools reales sobre el mecanismo de function-calling ya construido (§8.2) — no se inventa infraestructura nueva, se deja de tener dos caminos donde debe haber uno. El futuro `[APRENDIZAJE: ...]` de §6 nace directamente como tool (`memory.remember`, distinta de `memory.write` — ver §6 v3 para el porqué de separarlas), nunca como marcador nuevo.

**Hallazgo que corrige el orden inicial, verificado en `agentModels.ts`:** no todos los agentes pueden migrar. `TOOL_CAPABLE_MODELS` excluye explícitamente `meta-llama/llama-3.1-8b-instruct` ("no soporta tools de forma fiable") — el modelo real de `operaciones` y `soporte`. `MEMORIA` y `DECISION` los emite, en teoría, cualquiera de los 8 roles (van en el bloque genérico de instrucciones que se añade a toda tarea); `TENDENCIA` y `CONTENIDO` los emite en la práctica un único rol cada uno (`investigador` y `contenido`), ambos en modelos tool-capable. Consecuencia: `TENDENCIA` y `CONTENIDO` se pueden retirar del todo (regex borrado, cero rastro); `MEMORIA` y `DECISION` **no** — para `operaciones`/`soporte` el marcador de texto sigue siendo, permanentemente, el único camino posible mientras sigan en Llama 3.1 8B. Eso no es una limitación de la migración, es una realidad del modelo — se deja anotada aquí en vez de disimulada como "fallback temporal".

**Migración incremental, no reescritura.** Plan detallado entregado y confirmado con Jorge fuera de este documento; resumen operativo:

| Orden | Marcador → Tool | Por qué en esta posición | Retirada del regex |
|---|---|---|---|
| 1 | `[TENDENCIA: ...]` → `trend.report` | Un único rol (`investigador`, tool-capable) — valida el patrón base sin la complejidad del split de modelos. | Total, una vez verificado |
| 2 | `[CONTENIDO: ...]` → `content.create` | Un único rol (`contenido`, tool-capable, familia de modelo distinta a la de #1) — segunda prueba del patrón. | Total, una vez verificado |
| 3 | `[MEMORIA: k=v]` → `memory.write` | Bajo radio de impacto (privado, invisible para Jorge) pero primero en exigir el diseño de doble camino permanente (6 roles a tool, 2 a regex). | Parcial — permanece para `operaciones`/`soporte` |
| 4 | `[DECISION: ...]` → `decision.create` | Mayor superficie y el más visible para Jorge (alimenta Alertas) — se migra último, reutilizando el patrón de doble camino ya probado en #3. | Parcial — permanece para `operaciones`/`soporte` |

**Compatibilidad hacia atrás durante la transición (obligatoria, no opcional):** al migrar cada marcador, el tool nuevo se añade y el prompt del rol correspondiente se actualiza para pedir la tool en vez del marcador — pero **el parseo regex del marcador viejo no se borra todavía**. Ambos caminos conviven. Solo se retira el regex de ese marcador, para los roles tool-capable, cuando se verifique en `agent_runs`/`work_items` reales un número de invocaciones correctas consecutivas por tool call (no por marcador) — nunca antes. Para `operaciones`/`soporte` el regex de `MEMORIA`/`DECISION` no se retira nunca mientras sigan en un modelo sin tool-calling. Un módulo (= un marcador) completo, verificado y commiteado antes de pasar al siguiente, igual que el resto de este proyecto.

**Regla permanente añadida por Jorge al aceptar el plan, no limitada a esta migración:** a partir de esta decisión, ningún sistema nuevo puede introducir un mecanismo alternativo de comunicación estructurada entre agentes y runtime. Toda acción estructurada (crear una fila, disparar un evento, pedir aprobación) pasa por Tool Calling — nunca por un nuevo formato de texto libre parseado a mano. Esto gobierna, en concreto, el futuro Memory System v2 (§6, ya alineado: `memory.write` nace como tool) y cualquier Business Module (§8.4) que necesite que un agente dispare un efecto nuevo.

**Reglas de calidad fijadas para las 4 fases (Jorge, al confirmar el plan):**
1. Compatibilidad hacia atrás: ninguna fase puede romper a los roles que siguen en marcador.
2. Un único mecanismo al finalizar, para todo rol que soporte Tool Calling — `operaciones`/`soporte` quedan fuera de esa exigencia por no soportarlo, no es una excepción a la regla sino su alcance explícito.
3. Observabilidad: cada tool nuevo deja log propio (`[TOOL:<id>] ...`) además del log ya automático del bus (`[BUS] ...`) y del registro en `agent_runs`.
4. Contratos tipados: `inputSchema`/`outputSchema` + tipos TS en `tools/types.ts`, mismo patrón que los tools existentes — ninguna excepción.
5. Documentación: este documento se actualiza al cerrar cada fase, no al final de las cuatro.

### Fase 1 — `trend.report` — ✅ completada y verificada (2026-08-04)

Implementada exactamente según el plan: `TrendReportTool` (`tools/index.ts`), tipos en `tools/types.ts`, registrada en `tools/registry.ts`, añadida a `AGENT_TOOLS.investigador` (`agentModels.ts`). El regex de `[TENDENCIA: ...]` en `agentRuntime.ts` se mantiene intacto.

**Hallazgo real de la verificación, no anticipado en el plan:** con ambos mecanismos disponibles a la vez (tool + instrucción del marcador en el bloque genérico de formato), el modelo (`gemini-2.5-flash`) prefería el marcador viejo incluso pidiéndole explícitamente que usara la tool — confirma, con evidencia, la preocupación de fondo de toda esta migración. **Fix aplicado:** el bloque `INSTRUCCIONES DE FORMATO` de `runAgent()` pasa a construirse dinámicamente por rol (`toolsForRole()`) — un rol con la tool disponible deja de ver la instrucción del marcador equivalente. El regex de compatibilidad se queda como red de seguridad silenciosa, no como camino ofrecido activamente. **Este mismo ajuste se reutiliza sin cambios en las Fases 2-4.**

Verificado con ejecución real (`POST /api/agents/2/run`, sin datos de prueba dejados en la BD): log `[TOOL:trend.report] Explorador → trend.detected :: <keyword>`, fila real en `market`, evento `trend.detected` publicado en el bus, automation `Tendencia → Escritor` disparada exactamente igual que con el marcador — cero regresión en el pipeline existente.

### Fase 2 — `content.create` — ✅ completada y verificada (2026-08-04)

Mismo patrón exacto que Fase 1, aplicado a `contenido` (Escritor, `claude-haiku-4.5`): `ContentCreateTool` (`tools/index.ts` + `types.ts` + `registry.ts`), añadida a `AGENT_TOOLS.contenido`, línea `[CONTENIDO: ...]` retirada del bloque de formato solo para ese rol (misma función `formatLines` de Fase 1, extendida). La tarea autónoma de `contenido` pide la tool para la parte de contenido, **pero mantiene sin tocar la instrucción `[DECISION: Publicar contenido SEO — keyword]`** — DECISION es Fase 4, fuera de alcance aquí.

**Sin hallazgos nuevos que reporten un comportamiento emergente distinto al de Fase 1** — el ajuste de prompt por rol descubierto en Fase 1 se generalizó sin fricción: la tool se invocó correctamente a la primera, sin que el modelo recurriera al marcador viejo en ningún momento de la verificación. Esto confirma, no descubre, el patrón — no se abre una entrada nueva en memoria persistente por esto (regla de este documento: memoria solo para decisiones con impacto arquitectónico, no para confirmaciones repetidas de un patrón ya registrado).

Verificado con ejecución real (`POST /api/agents/3/run`): log `[TOOL:content.create] Escritor → content.created :: fase2-verify-token`, fila real en `content`, evento `content.created` publicado, automation `Contenido → Tráfico` disparada igual que antes. Dato de prueba limpiado de la BD tras verificar.

### Fase 3 — `memory.write` — ✅ completada y verificada (2026-08-04)

Primera fase que activa de verdad el camino dual: `memory.write` se añade a `AGENT_TOOLS` de los 6 roles tool-capable (`ceo`, `investigador`, `contenido`, `trafico`, `finanzas`, `hermes`) — `operaciones`/`soporte` (Llama 3.1 8B) no la reciben y siguen en `[MEMORIA: k=v]` de forma permanente, tal como se fijó al cerrar esta migración. El bloque `INSTRUCCIONES DE FORMATO` de `runAgent()` deja de ofrecer la línea del marcador solo a los roles que ya tienen la tool — mismo mecanismo de Fases 1-2, generalizado sin cambios de diseño.

**Mejora de observabilidad real, no solo formal:** el regex viejo descartaba en silencio una clave mal formada (sin snake_case). `MemoryWriteTool.execute()` valida el formato y devuelve un error explícito al propio modelo dentro del resultado de la tool — el agente puede verlo y reintentar en el mismo turno. Es la primera vez que la migración entrega una mejora de comportamiento, no solo de arquitectura.

**Hallazgo real de diseño, no anticipado en el plan — reportado antes de continuar, como pidió Jorge:** `writeAgentMemory()` vivía en `aiService.ts`, que importa `tools/registry.ts` → `tools/index.ts`. Si `MemoryWriteTool` hubiera importado esa función directamente desde `aiService.ts`, se cerraba un ciclo de imports (`aiService.ts → tools/registry.ts → tools/index.ts → aiService.ts`). **Fix:** la función se extrajo a un fichero nuevo y mínimo, `services/agentMemoryService.ts`, sin dependencia hacia `tools/`; `aiService.ts` la re-exporta para no romper a los importadores existentes (`agentRuntime.ts`). **Regla general que se deja anotada aquí para no redescubrirla:** cualquier Tool nuevo que necesite invocar una función que hoy vive dentro de `aiService.ts` corre el mismo riesgo de ciclo — se resuelve igual, extrayendo esa función a su propio servicio sin dependencia hacia `tools/`, antes de que el Tool la importe.

**Verificación real, con las dos ramas del camino dual probadas por separado:**
- Rol tool-capable (`investigador`, `POST /api/agents/2/run`): log `[TOOL:memory.write] Explorador → agent_memory :: <clave>`, fila real en `agent_memory` con el valor correcto.
- Rol sin tool-calling (`operaciones`, Llama 3.1 8B, mismo endpoint): el marcador `[MEMORIA: ...]` sigue disponible en su prompt (verificado por código, sin cambios), y el rol ya tiene **257 filas históricas** en `agent_memory` escritas por esa vía en su ciclo autónomo normal — la ejecución manual de prueba con un prompt ad-hoc dio una respuesta de baja calidad (propio de Llama 3.1 8B con instrucciones atípicas), no una regresión: no es lo mismo "el modelo es limitado" que "la migración rompió algo", y aquí es lo primero, confirmado con datos históricos, no solo con la ejecución de prueba.

Datos de prueba limpiados tras verificar.

### Fase 4 — `decision.create` — ✅ completada y verificada (2026-08-04) — última fase del plan

Mismo alcance de roles que `memory.write` (los 6 tool-capable; `operaciones`/`soporte` permanecen en `[DECISION: ...]` por diseño, no por transición). Se tocaron las dos tareas autónomas que pedían el marcador explícitamente — `ceo` y `contenido` (esta última ya migrada a `content.create` en Fase 2, ahora pide también `decision.create` en la misma tarea) — sin tocar ninguna otra parte de su texto.

**Verificación de los cuatro puntos que pidió Jorge antes de cerrar la fase:**
1. **Sin ciclo de dependencias nuevo:** `decisionService.ts` solo importa `db/init.ts` y tipos — confirmado por inspección directa, no por suposición. `tools/index.ts → decisionService.ts` no tiene camino de vuelta hacia `tools/`.
2. **Comportamiento actual preservado — eventos, alertas, automatizaciones:** verificado con ejecución real combinando Fase 2 + Fase 4 en el mismo turno (`contenido` llamando a `content.create` y `decision.create` seguidos) — el bus publica `content.created` y `decision.created` igual que antes, la automation `Contenido → Tráfico` se dispara igual, el `status` de la Decision sigue naciendo `proposed` (la tool no aprueba nada, solo crea — la aprobación real sigue siendo 100% de Jorge), la categoría se sigue infiriendo automáticamente (`inferCategory()`, sin cambios), y la deduplicación de `decisionService.createDecision()` se hereda gratis, no se reimplementó.
3. **Threading por venture:** verificado que **no hay regresión porque no había nada que regresar** — el `venture_id` de las decisiones creadas por marcador tampoco se thread hoy (el contexto de venture es solo un prefijo de texto `[VENTURE: nombre]` en el prompt, nunca un campo estructurado que llegue a `AgentTask`/`ToolContext`, ver §3). `decision.create` preserva exactamente ese mismo estado — ni mejor ni peor que el marcador. Cerrar esto de verdad es trabajo de §3, no de esta migración.
4. **`operaciones`/`soporte` siguen compatibles:** confirmado con datos históricos (32 y 18 decisiones ya creadas por esos roles vía marcador, en su ciclo autónomo normal, sin tocar) más inspección de código — el bloque de formato solo deja de ofrecer `[DECISION: ...]` a los roles con `decision.create` en `AGENT_TOOLS`, y esos dos roles tienen la lista vacía.

**Hallazgo real, detenido y corregido antes de cerrar la fase, tal como pidió Jorge:** el regex viejo capturaba automáticamente los primeros 300 caracteres de la respuesta completa como `description` — Jorge siempre tenía contexto en Alertas, aunque el agente no "pensara" en escribirlo. La primera versión de `decision.create` tenía `description` como campo **opcional** — en la verificación, una decisión creada sin descripción explícita quedó con `description = NULL`, una regresión real de información respecto al marcador. **No es una limitación de Tool Calling como mecanismo** — es que una tool no tiene "texto libre alrededor" que capturar gratis; cualquier campo que antes acompañaba al marcador sin que el agente lo pidiera ahora hay que exigirlo explícitamente en el schema. **Fix:** `description` pasa a ser **obligatorio** en el input de la tool. Efecto colateral verificado y positivo, no solo neutro: con el campo obligatorio, `ceo` (Sonnet 4.5) rechazó crear una decisión de prueba deliberadamente vacía de contexto ("una decisión sin descripción clara es ruido, Jorge no puede aprobar algo que no entiende el porqué") y, al dársele contexto real, produjo una `description` más útil y mejor estructurada que el recorte crudo de 300 caracteres que daba el regex. **Regla general para cualquier Tool futura:** antes de dar por migrado un marcador, listar qué campos venían "gratis" del texto libre alrededor (contexto, tono, detalle) y decidir explícitamente si el schema de la tool los hace obligatorios — nunca asumir que se rellenan solos.

**Estado real de la migración al cerrar la Fase 4 — honesto, no optimista:** las 4 tools existen, están conectadas, y los 6 roles tool-capable ya no reciben la instrucción del marcador correspondiente en el prompt. **Pero el regex de compatibilidad no se ha borrado de ningún marcador todavía** — cada fase se verificó con 1-3 ejecuciones manuales reales, no con el criterio completo fijado en el plan ("N ejecuciones autónomas consecutivas reales, sin caída al marcador"). Retirar el regex de `TENDENCIA`/`CONTENIDO` (los dos que pueden quedar en cero rastro) es una decisión aparte, deliberadamente no tomada aquí — se recomienda dejar correr el sistema en ciclo autónomo real un tiempo antes de borrar la red de seguridad, y retirar entonces con datos de producción, no de verificación manual.

**Verificado con ejecución real:** tool en `ceo` (id 1) y combinación `content.create`+`decision.create` en `contenido` (id 3) en el mismo turno — ambas con log propio, fila real, evento del bus y automation disparada. Datos de prueba limpiados de la BD tras cada verificación.

**Consecuencia si no se hace:** cada sistema nuevo (Memory System, Business Modules, paneles por sala) seguiría el reflejo de "añadir un marcador más" en vez de "añadir un tool" — la migración se volvería más cara cuanto más se tardara.

---

## 3. Modelo multi-venture

⚠️ **REQUIERE TU CONFIRMACIÓN** — esta es la decisión más grande de todo el documento, y la más urgente si el Wizard va a "crear un negocio nuevo".

### Por qué importa

Todo lo que un Setup Wizard automatizaría para un segundo negocio depende de esto. Hoy solo ha existido un venture ("Minimal Designs") desde el primer día — el modelo nunca se ha ejercitado con dos.

### Estado real verificado

`ARCHITECTURE.md §15` ya documenta una respuesta — **"Los departamentos son invariables — solo cambia el contenido que procesan. Esto permite que el ecosistema gestione múltiples negocios simultáneamente sin código nuevo"**, con un ciclo de vida de 12 fases terminando en "Fase 12 — Nuevo negocio: los agentes existentes amplían su contexto." Es una decisión de diseño real y buena.

**Pero el código no la implementa.** Evidencia:
- `agents.venture_id`, `decisions.venture_id`, `work_items.venture_id` existen como columnas (migraciones aditivas) pero **ningún código escribe nunca un valor en ellas** — verificado: `DecisionCreatePayload` no tiene campo `venture_id`; las 3 llamadas a `createWorkItem()` en `agentRuntime.ts` nunca pasan `businessId`.
- `objectives` **no tiene columna `venture_id` en absoluto** — el Goal System es implícitamente de un solo negocio.
- `assets` y `automations` sí escriben `venture_id`, pero solo porque sus rutas POST lo aceptan del body — ningún formulario del frontend construido hasta ahora ofrece elegir un venture (porque solo hay uno).

### Alternativas

**A. Un agente sirve a todos los ventures, con contexto por tarea** (lo que documenta `ARCHITECTURE.md §15`)
- Ventajas: cero coste de infraestructura por venture nuevo; "Escritor" sigue siendo un único agente con una única personalidad/prompt, que recibe contexto de qué venture está atendiendo en cada `work_item`/`decision`. Escala a N ventures sin crear N agentes.
- Inconvenientes: requiere que **todo** el pipeline (creación de decisions, work_items, objectives) empiece a threading `venture_id` de verdad — hoy no lo hace en ningún punto real. El agente necesita cargar "qué venture es este" en cada ejecución, no solo en la UI.

**B. Un set de agentes por venture** (cada venture "clona" sus propios 8 agentes)
- Ventajas: aislamiento total — presupuesto, memoria y prompt de un negocio nunca se filtran a otro. Conceptualmente más simple de razonar por venture individual.
- Inconvenientes: contradice explícitamente la filosofía ya escrita en `CLAUDE.md` ("cada nuevo negocio reutiliza la misma infraestructura... los agentes existentes se reutilizan con nuevo contexto"). Multiplica coste de OpenRouter linealmente por negocio sin necesidad. Con 3 negocios ya son 24 agentes que gestionar, programar y pagar.

**C. Híbrido — agentes compartidos por defecto, con opción de agente dedicado cuando un venture lo justifique**
- Ya está semi-anticipado en `ARCHITECTURE.md §15, Fase 11 (Escalado)`: "contratar un agente especializado nuevo" como Decision de alto nivel cuando un negocio crece.
- Ventajas: lo mejor de A y B — barato por defecto, con vía de escape cuando un venture concreto lo necesite.
- Inconvenientes: es el modelo más difícil de razonar y el que más código nuevo pide (hay que decidir cuándo un agente es "compartido" vs "dedicado" y cómo convive con el scheduler).

### Decisión para Hokage OS

**Elegido: A, con la implementación mínima que le falta para ser real — no B, no C todavía.**

Los agentes son proveedores de servicio compartidos por rol; un venture es un registro de datos + un ámbito de presupuesto/objetivos, no un conjunto de agentes propio. Esto ya estaba decidido en principio en `ARCHITECTURE.md §15` y en `CLAUDE.md` — lo único que cambia aquí es hacerlo **verificable**, no solo escrito:

1. **Añadir `objectives.venture_id`** (migración aditiva, nullable — un objetivo sin venture sigue siendo válido, es "global").
2. **`createDecision()` y `createWorkItem()` deben aceptar y persistir `venture_id`** cuando el contexto lo tenga (hoy los tipos ni siquiera lo permiten).
3. **El contexto de cada `work_item`/prompt debe declarar explícitamente para qué venture trabaja** cuando aplique — igual que hoy ya declara `[OBJETIVO]` o el título de una decisión aprobada.
4. La opción C (agente dedicado) queda como lo que ya es: una Decision de alto nivel que Jorge aprueba manualmente cuando un venture lo justifique — **no se automatiza en v1**, y el Wizard nunca la ofrece como opción de creación inicial.

C es el techo a futuro (ya está bien pensado en `ARCHITECTURE.md §15` Fase 11), no algo que construir ahora.

### Consecuencias a 2-3 años

Si se congela A y se implementan los 3 puntos de arriba: el Wizard de "nuevo negocio" es barato de construir (crear fila en `ventures`, opcionalmente un objetivo con `venture_id`) y el sistema escala a N negocios sin tocar el runtime. Si se deja como está (columnas fantasma, sin threading real), cualquier Wizard que prometa "segundo negocio" construye sobre una mentira — el negocio se crearía, pero ningún agente sabría nunca a cuál está sirviendo, y el trabajo de todos los negocios se mezclaría en las mismas colas sin distinción, exactamente el mismo tipo de bug de coherencia que ya se corrigió en `AlertsView`/`CrewView` esta sesión.

---

## 4. Agentes

🔒 **CONGELADO**, con una advertencia explícita marcada abajo.

### Qué es un agente hoy (verificado)

Una fila en `agents` (id, name, role, status, model, venture_id — sin usar, capabilities — sin usar) + una fila activa en `agent_prompts` +, opcionalmente, una fila en `agent_schedules` si su rol está en `AUTONOMOUS_TASKS`. 8 agentes reales hoy: ceo, investigador, contenido, trafico, finanzas, operaciones, soporte, hermes (pausado en BD todavía — §9.1 especifica su reactivación como coordinador permanente, pendiente de implementar).

### La decisión que ya está tomada, y su coste

`ARCHITECTURE.md §12` ya dice: "Añadir un nuevo agente: 3. Registrar en `agentRuntime.ts` su intervalo y sus tools disponibles." **Es decir: el comportamiento de un agente (qué tarea autónoma corre, cada cuánto, qué modelo usa por defecto, qué tools tiene) es código TypeScript (`AGENT_MODELS`, `AGENT_TOOLS`, `AUTONOMOUS_TASKS`), no datos.** El *nombre*, *rol* y *prompt* sí son datos (`POST /api/agents` acepta cualquier `role` libre) — pero un agente con un rol no registrado en esos tres mapas se queda en modo chat-only para siempre, sin trabajo autónomo, sin aviso.

Esto ya era una decisión implícita del proyecto, no una desviación mía. Se congela explícitamente ahora con su consecuencia:

**⚠️ Esto bloquea a un Wizard que prometa "crea un agente con un rol completamente nuevo".** Un Wizard puede, hoy, configurar los 8 roles que ya existen (nombre, modelo, prompt — exactamente lo que `ConfigView` ya hace). No puede, sin trabajo adicional, dar de alta un rol nuevo con comportamiento autónomo propio sin tocar TypeScript.

### Decisión para Hokage OS

**v1: se mantiene el comportamiento como código.** No se convierte `AUTONOMOUS_TASKS`/`AGENT_MODELS`/`AGENT_TOOLS` en tablas todavía — sería construir infraestructura de "roles como datos" para un caso de uso (crear roles completamente nuevos desde un Wizard) que nadie ha pedido de forma concreta y que añade una capa de indirección (validación de tarea, de intervalo, de tools disponibles, todo tendría que re-validarse en runtime en vez de en tiempo de compilación).

**El Wizard v1 configura agentes existentes, no crea roles nuevos.** Si en el futuro se necesita un rol nuevo, sigue el proceso manual ya documentado en `ARCHITECTURE.md §12` — que sigue siendo válido y no necesita reescritura.

### Consecuencias a 2-3 años

Si Hokage OS crece hacia "cualquiera puede definir un agente con un propósito nuevo sin tocar código", este es el primer sitio que hay que convertir en datos — con un `role_definitions` table (task template, intervalo, modelo por defecto, tools permitidas). Se deja anotado como el disparador claro de cuándo revisar esta decisión: **el día que alguien pida crear un rol de agente que hoy no existe, sin escribir TypeScript, se reabre esta sección — no antes.**

---

## 5. Goal System

🔒 **CONGELADO**, con la corrección de §3 ya incorporada (`venture_id` pendiente de añadir).

El Goal System (`objectives` → `obj_plans` → `obj_milestones` → `work_items.milestone_id`) es real, probado, y ya se autocorrigió esta sesión: los objetivos financieros ya no se marcan `achieved` automáticamente sin verificación (ver el fix de `objectiveService.ts` — un objetivo con criterio de ingresos pasa por `pending_review` + Decision de confirmación humana, usando el mismo patrón `entity_type`/`entity_id` que gobierna todo el sistema de aprobación).

**Decisión que se congela aquí:** ese patrón de detección por regex (`REVENUE_PATTERN` sobre título/criterio) es un parche honesto, no una verificación real de ingresos — y se mantiene así hasta que exista una integración de ventas real (ver §8). No se over-diseña una verificación "inteligente" de objetivos antes de que haya datos reales que verificar contra algo.

---

## 6. Knowledge System y Memoria

🔒 **CONGELADO — v3, arquitectura completa lista para implementar.** Elegido como el siguiente sistema del roadmap tras comparar cuatro candidatos (Memory System, Founder Profile, Secret Management, Hermes v2) contra el filtro de §0 y contra dependencias reales — ver razonamiento completo en el resumen ejecutivo (§16). Esta versión corrige una imprecisión de la v2: el texto anterior asumía que `memory.write` (construido en la Fase 3 de §2) se podía reutilizar tal cual añadiéndole un parámetro `category`. Verificado contra el código real, eso mezclaría dos semánticas de escritura incompatibles en una sola tool — se corrige aquí (ver "Dos escrituras, dos tools" más abajo).

### Por qué importa (sin cambios respecto a v1/v2)

`CLAUDE.md`: "memoria semántica que permite a Hokage recordar por qué fracasó algo hace 6 meses." `agent_memory` (lo único que existe hoy) es privada por agente — no sirve para esto. Jorge, al reabrir esta sección: *"No memoria de chat. Memoria empresarial. Debe recordar: decisiones, errores, intentos, investigaciones, resultados, aprendizajes, contexto."*

### Idea central: captura automática, no solo agentes que se acuerdan de escribir

Pedirle a un agente que "recuerde escribir en la memoria" es frágil — se olvida. La mayoría de las 7 categorías que pide Jorge ya son un efecto colateral de datos que el sistema **ya genera**: una decisión rechazada ya tiene `reasoning`; un `work_item` cancelado tras 3 reintentos ya es un error. La memoria empresarial se construye enganchando esos momentos, no inventando un flujo nuevo de "agente escribe recuerdo" como único mecanismo.

### Prerrequisito real, no opcional: threading estructural de `venture_id`

Verificado contra el código: hoy **no existe ningún campo `ventureId` estructural** entre `stage3_executeAgents()` y el resto del pipeline — solo el prefijo de texto `[VENTURE: nombre]` que se antepone al prompt (§3). `AgentTask` (`agentRuntime.ts`) no tiene el campo; `askAgent()` (`aiService.ts`) no lo recibe; `ToolContext` (`tools/base.ts`) todavía conserva el campo **`businessId`**, un resto literal de antes del rename a `ventures` — nunca se usa, ningún tool lo lee.

Sin esto, `memory_entries` no puede filtrar por venture en la lectura — el sistema o no puede scopear la memoria por negocio (rompiendo el propósito del campo `venture_id` que Jorge ya pidió), o cada tool futuro que necesite venture reinventa su propio hack para conseguirlo (`decision.create` ya no lo necesitó porque hereda el mismo vacío que tenía el marcador — pero Memory System sí lo necesita porque **lee**, no solo escribe).

**Se cierra aquí, una vez, para que no se repita en cada tool futuro:**
1. `AgentTask.ventureId?: number | null` — nuevo campo.
2. `stage3_executeAgents()` ya tiene `item.venture_id` en memoria (línea 443) — se pasa a `runAgent()` además de seguir prefijando el texto `[VENTURE: ...]` (no se retira el prefijo, sigue siendo la señal que el modelo lee; el campo estructural es para que el *código*, no el modelo, sepa el venture).
3. `askAgent(agentId, userMessage, ventureId?)` — nuevo parámetro opcional.
4. `ToolContext.ventureId?: number | null` — sustituye a `businessId` (que se retira, cero llamadores hoy — mismo patrón de limpieza que `ToolRuntime`/`manager.ts` en la auditoría de esta sesión).
5. El único punto donde se construye `ToolContext` hoy (`aiService.ts`, dentro del loop de `tool_calls`: `registry.execute(toolId, args, { agentId })`) pasa a incluir `ventureId`.

Cambio pequeño, aditivo, no rompe ningún tool existente (todos ignoran campos de contexto que no usan) — pero es el que hace posible todo lo que sigue. Se implementa como el primer paso de esta fase, antes de las tools nuevas.

### Dos escrituras, dos tools — no una sola con un parámetro

`agent_memory` (lo que ya existe) es una tabla **clave-valor con upsert** — "lo que sé", se sobrescribe. `memory_entries` (lo nuevo) es un **log append-only** — "lo que aprendí", nunca se sobrescribe, cada entrada es un hecho distinto aunque se repita el tema. Son dos semánticas de escritura incompatibles (`UPDATE ... ON CONFLICT` vs `INSERT` puro). Meterlas en una tool con un parámetro `scope` que cambia el comportamiento de fondo es exactamente el tipo de ambigüedad que la migración de §2 se propuso eliminar — un tool, un propósito, un contrato claro (mismo principio que ya rige `trend.report`/`content.create`/`decision.create`).

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
- **Objetivo confirmado alcanzado** → `objectiveService.ts`, en los dos puntos reales de cierre: `closeMilestoneOnResult()` (camino automático, objetivos no financieros) y `markObjectiveAchieved()` (camino de confirmación humana, objetivos financieros — ver §5). `category='result'`.
- **Consulta a Claude respondida** (§9.2) → **no es un hook de código, es entrada manual.** Nuevo endpoint mínimo `POST /api/memory/learning` (`requireAdmin`) que Jorge (o yo, en su nombre, en una sesión como esta) llama para registrar la respuesta junto a la Decision original. `category='learning'`, `related_entity_type='claude_consultation'`.
- **Objetivo abandonado — NO se engancha, hallazgo honesto:** verificado por grep contra todo `backend/src/`: ningún código pone jamás `objectives.status = 'abandoned'`. Es un valor del tipo `ObjectiveStatus` que nunca se alcanza en la práctica. No se construye un hook para un estado que no existe — si en el futuro se añade una acción real de "abandonar objetivo", el hook se añade entonces, no antes.

### Lectura — simple a propósito, no búsqueda semántica

En `aiService.ts::askAgent()`, junto al bloque `[LO QUE SÉ]` ya existente (memoria privada, `agent_memory`), un segundo bloque `[MEMORIA DEL NEGOCIO]`:

```sql
SELECT category, title, content FROM memory_entries
WHERE venture_id = ? OR venture_id IS NULL
ORDER BY created_at DESC LIMIT 8
```

**Decisión de diseño explícita:** no se usa `memory_entries_fts` para esto. Una búsqueda por relevancia necesitaría una query de texto que hoy no existe de forma natural en el flujo (el agente no "pregunta" nada, solo recibe contexto) — construir un derivador de términos de búsqueda a partir de una tarea ad-hoc es la clase de sobre-ingeniería que este documento ya rechazó una vez (vector store, en la v1). Recencia acotada (8 entradas, mismo límite que ya usa `[LO QUE SÉ]`) es simple, predecible, y barata en tokens — coherente con la disciplina de coste de §10. FTS5 queda lista para el día que exista un panel de "buscar en memoria" real (§13, candidato futuro, no de esta fase) — ahí sí hay una query de texto genuina que buscar.

### API de lectura (para un futuro panel — no bloquea el resto de la fase)

```
GET  /api/memory?venture_id=N&category=X&limit=50   (requireAdmin)
POST /api/memory/learning                            (requireAdmin — captura manual de consultas a Claude)
```

### Retención

Sin poda en v1 — miles de filas son triviales para SQLite, y borrar memoria contradice el propósito del sistema. Umbral ya anotado en §14 si el volumen real algún día lo justifica.

### Consecuencias a 2-3 años

Con captura automática desde ya, el historial de "qué se intentó y por qué falló" empieza a acumularse desde el primer venture, no desde el segundo — cuando llegue un segundo o tercer negocio, Hokage ya tiene años de contexto real que consultar, no una memoria vacía que empezó tarde. El threading de `venture_id` cerrado aquí como prerrequisito deja de ser un hack que cada tool futura reinventa — `memory.remember` es el primer consumidor, pero cualquier tool posterior que necesite saber "para qué venture trabajo" lo hereda gratis.

---

## 7. Automatizaciones (agente → agente)

🔒 **CONGELADO** — ya es real, probado, con CRUD completo construido esta sesión (`PUT`/`DELETE /api/automations/:id`, formulario en `VenturesView`).

Modelo: tabla `automations` (`trigger_event → action_agent_role`, con `action_context_template` y `requires_approval`), consumida por `agentRuntime.ts` stage1. Es el mecanismo real de "un agente dispara a otro" — no hay ni debe haber un segundo mecanismo paralelo.

**Deuda reconocida, no bloqueante:** `automations.venture_id` existe y se escribe, pero ningún formulario ofrece elegir un venture (ver §3) — hoy toda automation es implícitamente global. Se resuelve como efecto colateral de cerrar §3, no como trabajo aparte.

---

## 8. Business Modules, Integraciones, Plugins y MCP

Estos cuatro temas comparten la misma pregunta de fondo — **"cómo entra código o capacidad nueva al sistema sin que Jorge tenga que tocar TypeScript"** — así que se resuelven juntos, con una única arquitectura que los cubre a todos.

### 8.1 Integraciones (Etsy, Shopify, Google Trends...)

🔒 **CONGELADO**, ratificando una decisión ya tomada dos veces (en `ARCHITECTURE.md §9` y en `FRONTEND_WORLD_ENGINE.md §9, "Decisiones ya tomadas"`):

> Shopify/Etsy/Fiverr no son departamentos propios. Son **canales de venta dentro de un venture** — no generan salas nuevas en el mapa ni agentes nuevos.

Estado real: **ninguna integración de venta existe todavía.** `EtsyTool`/`ShopifyTool`/`PrintifyTool` son *stubs* (`status: 'stub'`, `execute()` devuelve error explicando que falta la API key) — código de contrato ya escrito, cero conexión real. `GoogleTrendsTool` y `WebBrowserTool` sí son reales y funcionan hoy. Esto es Fase 6 del `Roadmap.md`, todavía no alcanzada.

### 8.2 El contrato de Tool — ya es el mecanismo de plugin

🔒 **CONGELADO.** El `Tool` interface (`tools/base.ts`) ya es, de facto, el sistema de plugins de Hokage OS: `id`, `inputSchema`/`outputSchema`, `execute(input, ctx)`, registrado en `tools/registry.ts`, descubierto automáticamente por el LLM vía function-calling. Añadir un tool nuevo es añadir un fichero + una línea en el registry — cero cambios en `aiService.ts` ni en rutas. **Esto ya es la respuesta a "Plugins" para capacidades que un agente invoca activamente** (como `SystemExecTool` de Hermes).

**Hallazgo de seguridad ya corregido esta sesión, se ratifica aquí como regla permanente:** `permissions`/`requiredApproval` en el `Tool` interface son **metadata informativa, nunca aplicada por ninguna capa de plataforma** (`ToolRuntime`/`manager.ts` que sí los hacían cumplir se borraron esta sesión por estar completamente muertos — cero llamadores). **Cualquier tool que necesite una garantía real de aprobación debe implementarla dentro de su propio `execute()`**, como hace `SystemExecTool` (nunca ejecuta directo, siempre crea una Decision). Esto no es una limitación a resolver — es la decisión correcta: la garantía de seguridad vive donde se puede verificar, no en un campo de configuración que cualquiera puede rellenar con falsa sensación de seguridad.

### 8.3 Plugins visuales (mapa) — ya diseñado, no implementado

🔒 **CONGELADO** el diseño, sin implementar todavía. `FRONTEND_WORLD_ENGINE.md §6-7` ya especifica un modelo completo: `WorldEngine.registerVisualKind()`, `AnimationDirector.registerReaction()`, `DepartmentRegistry.register()` — todo como datos validados por esquema, aditivo nunca destructivo, con fallo aislado (una entidad rota no tira el frame loop) y vocabulario visual cerrado (primitivas seguras: círculo, rect, icono, partícula — nunca JS/Pixi arbitrario inyectado). Es un diseño sólido y se ratifica sin cambios. Explícitamente marcado en su propio documento como "fase futura" — sigue siéndolo aquí.

### 8.4 Business Modules — la pieza que faltaba nombrar

🆕 **DECISIÓN NUEVA.** Un "Business Module" no es un mecanismo nuevo — es una composición de los tres anteriores:

```
Business Module = { canal (dato: platform dentro de un venture)
                   + Tool(s) que registra (mecanismo de §8.2, ya existe)
                   + Automations que siembra por defecto (tabla ya existe, §7) }
```

Ejemplo concreto: un "Módulo Etsy" = el campo `platform: 'etsy'` en un venture/asset (ya soportado) + `EtsyTool` implementado de verdad (hoy stub) + una automation por defecto tipo "Tendencia → Escritor" ya sembrada (ya existe el patrón, `seedAutomations()`).

**No hace falta un sistema de "instalación de módulos" nuevo.** Un Business Module se activa insertando filas — el mismo principio de "configuración sobre código" que gobierna todo lo demás en este documento.

### 8.5 MCP

⚠️ **REQUIERE TU CONFIRMACIÓN**, con recomendación clara.

Hokage OS (el runtime de agentes) no usa MCP hoy — `aiService.ts` habla directo con OpenRouter usando function-calling nativo. MCP es, hoy, solo la forma en que *yo* (Claude Code) me conecto a herramientas — no tiene relación con el runtime de Hokage.

**Alternativas:**
- **A. Adoptar MCP como mecanismo de tools de los agentes** — sustituir `tools/registry.ts` por un cliente MCP que hable con servidores MCP externos.
  - Ventajas: cualquier servidor MCP de terceros se conecta sin escribir una clase `Tool` nueva; ecosistema en crecimiento activo.
  - Inconvenientes: MCP añade una capa de transporte (proceso separado o HTTP) y de protocolo que hoy no hace falta para 5 tools internos; se pierde el control fino sobre coste/latencia que da tener el `Tool` interface propio; es infraestructura para un problema (conectar *muchos* proveedores externos) que Hokage no tiene todavía (tiene 1-2 integraciones reales pendientes, no 20).
- **B. Mantener el `Tool` interface propio, sin MCP** (lo que hay hoy).
  - Ventajas: simple, ya funciona, cero dependencias nuevas.
  - Inconvenientes: cada integración nueva requiere escribir una clase, no se puede simplemente "enchufar" un servidor MCP de terceros.
- **C. Interface propio como está, con un `MCPAdapterTool` opcional el día que haga falta** — un único tool cuyo `execute()` internamente hace de puente a un servidor MCP, sin migrar los demás.

**Decisión para Hokage OS: B ahora, con la puerta de C dejada abierta.** No se adopta MCP en el runtime de agentes en v1 — sería infraestructura para una escala (docenas de integraciones externas) que Hokage no tiene. El `Tool` interface actual ya cumple exactamente el mismo propósito con menos piezas móviles. Si en el futuro aparece un servidor MCP de terceros genuinamente útil (por ejemplo, un MCP de Etsy ya publicado por alguien), se envuelve en un tool propio (C) en vez de migrar todo el sistema.

**Consecuencia a 2-3 años:** si el número de integraciones externas crece más allá de lo que un puñado de clases `Tool` puede mantener cómodamente (aprox. 15-20), esta es la señal para revisar A en serio.

---

## 9. Los dos motores: Hermes y Claude

🔒 **CONGELADO — v2.** Reemplaza la versión anterior de esta sección. Jorge cuestionó explícitamente el diseño original de Hermes por no coincidir con la visión real del producto ("Hermes y Claude deben ser los dos motores principales del ecosistema") — no era una reactivación pendiente, era una decisión mal dimensionada desde el principio. Se corrige aquí, con la razón documentada, no disimulada.

### 9.1 Hermes — de utilidad estrecha a coordinador permanente

**Lo que estaba mal en la v1:** definí a Hermes como "el único agente con acceso a `system.exec`, infraestructura interna, sin caso de uso real" — y lo pausé. Eso confunde **una herramienta que Hermes tiene** con **lo que Hermes es**. Mientras tanto, el verdadero coordinador del ecosistema — el que ya asigna trabajo, vigila presupuestos, cierra el loop de decisiones — es `AgentRuntime`: una clase de TypeScript sin nombre, sin sala, sin voz, invisible para Jorge salvo como infraestructura. `VISION.md` pide una empresa que se sienta viva incluso desconectado; una clase anónima no puede hablar contigo sobre cómo va el día. Un agente con nombre, sí.

**Definición oficial v2:** Hermes es la **personificación del Runtime/Scheduler** — el proceso que ya corre 24/7 (§2), ahora con presencia real: nombre, sala, y capacidad de que Jorge le pregunte "¿cómo va todo?" y reciba un estado operativo de verdad, no una sala vacía con una terminal.

- **Reactivado**, no pausado — `agents.status` vuelve a activo, `departments.active = 1` para su sala. El disparador que faltaba en la v1 (ver memoria `project-hermes-pausado`) ya existe: coordinar y reportar es un caso de uso real desde el primer día, independiente de si `system.exec` llega a usarse.
- **Tarea autónoma nueva** (mismo patrón que los demás roles en `AUTONOMOUS_TASKS`, §2): cada ciclo, Hermes reporta a Ship Comms un resumen operativo real — work items procesados, decisiones pendientes, presupuesto consumido, agentes con errores recientes. Es la traducción conversacional de R7 (§2 — overlays de datos del mapa, investigado en `prison-architect.md`, nunca implementado): si el mapa todavía no muestra esas capas visualmente, Hermes ya puede **decirlas**.
- **Tool nueva:** `system.status` — de solo lectura, sin aprobación (no ejecuta nada, solo agrega lo que `/api/runtime/status` y `/api/metrics/summary` ya calculan). Es lo que Hermes usa para responder con datos reales, no inventados, cuando Jorge le pregunta cómo va el sistema.
- **`system.exec` se queda exactamente como estaba especificado** (§9.1 anterior, sin cambios): siempre pide aprobación, nunca se duplica en otro agente. Esa regla no dependía de que Hermes fuera estrecho o amplio — sigue siendo correcta tal cual.
- **Su sala dedicada** (antes "Sala de Máquinas") es candidata natural al primer panel especializado por-sala de §13 — un panel de "Estado del Sistema" en vivo, no solo el historial de comandos que ya tenía.

**Regla dura que sigue vigente sin cambios:** ninguna capacidad de ejecutar comandos reales se duplica en otro agente — pasa por Hermes exclusivamente, sea cual sea su alcance.

### 9.2 Claude — motor de razonamiento profundo, no un agente más de la cola

**Por qué no es lo mismo que el CEO/Hokage con Sonnet.** El agente `ceo` ya usa `claude-sonnet-4.5` (§4) para tareas estratégicas rutinarias, dentro del mismo ciclo de trabajo que cualquier otro agente. Lo que Jorge pide es distinto: razonamiento de **arquitectura, investigación y evolución del sistema** — exactamente el tipo de trabajo de esta conversación, no una tarea más en `work_items`.

**Decisión de diseño — por qué no es un Tool normal:** un Tool que cualquier agente invoca dentro de su propio ciclo (como llamaría a `google.trends`) trataría "consultar a Claude" como una llamada de API más, con la misma falta de fricción que cualquier otra. Pero lo que describe Jorge — arquitectura, evolución del sistema — es exactamente el tipo de decisión que este documento entero insiste en que pase por aprobación humana antes de actuar. Automatizarlo del todo repetiría el error que motivó pausar mal a Hermes: construir algo amplio sin el freno correcto.

**Elegido: consulta como Decision, no como Tool automático.**

```
Cualquier agente (o Hermes, al reportar) detecta que necesita razonamiento
que su propio modelo no puede dar con confianza
  → createDecision({ entity_type: 'claude_consultation', title, description: la pregunta })
  → Jorge la ve en Alertas, con la pregunta completa
  → Jorge trae la consulta a una sesión de Claude Code (como esta)
  → la respuesta se registra de vuelta — memory_entries (§6) con category='learning',
    entity_type/entity_id apuntando a la Decision original
```

No hay integración de API nueva que construir — Jorge ya es el puente, literalmente en esta misma conversación. Lo único que falta es el **hueco estructurado**: el tipo de Decision, y dónde aterriza la respuesta (Memory System, §6, ya diseñado, ahora con un consumidor real más).

**Lo que esto NO es, explícitamente:** no es el backend llamando a la API de Claude de forma autónoma para modificar su propio código (eso existe técnicamente — Claude API / Agent SDK — pero es un sistema auto-modificable, una categoría de riesgo completamente distinta que merece su propia decisión dedicada, no colarse dentro de "añadir Claude"). Si algún día se quiere ese nivel de automatización, es una sección nueva de este documento, con su propio análisis de alternativas — no una extensión silenciosa de esta.

### Consecuencias a 2-3 años

Hermes deja de ser una pieza "lista para cuando haga falta" y pasa a ser, desde ya, la voz operativa diaria del sistema — exactamente lo que separa un sistema operativo de un panel de agentes con un mapa bonito encima. Claude queda como el escalón de razonamiento que ningún modelo barato puede sustituir, sin haber construido una integración de API que hoy sería prematura y de riesgo desproporcionado al beneficio.

---

## 10. Economía

🔒 **CONGELADO** el modelo real (diverge de `ARCHITECTURE.md §13`, que describe columnas y tablas — `business_budgets`, límite diario además de mensual, `agent_run_id` en `agent_costs` — que no existen en el schema real). Lo que existe y se congela:

- `agent_costs` (agent_id, work_item_id, tokens_in/out, llm_cost_usd, tool_cost_usd) — registrado tras cada `askAgent()`.
- `agent_budgets` (agent_id, monthly_limit_usd, current_month_usd, status) — **solo límite mensual, no diario.** `stage2_assignWork` bloquea la asignación si `status='paused'` o si se supera el 100%; avisa (log) a partir del 80%. No crea automáticamente una Decision de "ampliar presupuesto" — el `ARCHITECTURE.md` original lo describía, no se implementó, y **se decide aquí no implementarlo en v1**: un log de aviso al 80% es suficiente para un solo operador humano (Jorge) que ya revisa el sistema activamente. Se automatiza el día que haya suficientes agentes/ventures como para que revisar manualmente deje de ser viable.
- No existe `business_budgets` como tabla separada — el ROI/presupuesto por venture vive directamente en `ventures.budget_allocated_usd`/`budget_spent_usd`/`revenue_target_usd`. Es más simple que el diseño original de dos tablas y se ratifica como la decisión correcta (un venture ya es su propio ámbito de presupuesto, no hace falta una tabla satélite).
- Endpoint `GET /api/metrics/summary` (nuevo esta sesión) da coste-de-hoy agregado — construido con SQL nativo (`julianday()`) precisamente para evitar el bug de zona horaria que `new Date()` en Node introduce al parsear timestamps de SQLite (documentado y corregido en el propio commit). **Regla de código que se congela:** cualquier cálculo de antigüedad/fecha sobre timestamps de SQLite se hace en SQL, nunca con `new Date(sqlite_timestamp)` en JS.

---

## 11. Seguridad, Permisos, Secretos y VPS

### 11.1 Sistema de permisos

⚠️ **REQUIERE TU CONFIRMACIÓN.**

**Estado real:** no existe ningún sistema de permisos. Hay un único `ADMIN_TOKEN` (bearer, comparación de string) que gatea todas las rutas de mutación. No hay usuarios, no hay roles humanos, no hay distinción entre "Jorge" y "cualquiera con el token". Hallazgo concreto: `approveDecision(id, 'Jorge')` — el string `'Jorge'` está **hardcodeado como literal** en el código de aprobación, no es un valor de configuración.

**Alternativas:**
- **A. Single-owner permanente** — Hokage OS es y seguirá siendo de un único operador (Jorge). El `ADMIN_TOKEN` es suficiente para siempre.
- **B. Multi-usuario con roles** — construir un sistema de cuentas, roles (owner/operador/viewer), permisos por venture.
- **C. Single-owner ahora, diseñado para no bloquear multi-usuario después** — no se construye B, pero se deja de hardcodear "Jorge" como string literal, se pasa a un valor de configuración (`OWNER_NAME` o similar), y cualquier tabla nueva que registre "quién hizo X" usa ese valor de config, no un literal.

**Decisión para Hokage OS: C.** B es sobre-ingeniería completa para el uso actual (un fundador, un sistema). A es correcto en espíritu pero deja una trampa concreta (el string hardcodeado) que cuesta cero arreglar ahora y mucho arreglar después si alguna vez se necesita.

**Consecuencia a 2-3 años:** si Hokage OS se convierte en un producto que otros fundadores usan (no solo Jorge), B se vuelve obligatorio — y el coste de migrar desde C es mucho menor que desde A, porque C ya no tiene el nombre de Jorge cableado en la lógica de negocio.

### 11.2 Secretos y credenciales

🔒 **CONGELADO — v2, definitiva.** Jorge aceptó el diseño base (v1, abajo conservado como fundamento) y pidió reforzarlo con tres principios de crecimiento antes de darlo por cerrado. Los tres son compatibles — se evaluaron, no se aceptaron a ciegas — con un límite honesto anotado explícitamente donde correspondía, no disimulado.

#### Por qué importa

Hoy solo existen 2 secretos (`OPENROUTER_API_KEY`, `ADMIN_TOKEN`), gestionados a mano. El Setup Wizard (§12.3) y los Business Modules (§8.4) van a necesitar credenciales de Etsy, Shopify, GitHub, futuros servidores MCP (§8.5) y lo que venga.

#### El problema de fondo (fundamento v1, sigue vigente)

Hay **dos tipos de secreto completamente distintos**:

1. **Estáticos** (`OPENROUTER_API_KEY`, un GitHub PAT): no rotan solos.
2. **OAuth2 con refresh** (Etsy, Shopify): el `access_token` caduca en horas y se renueva solo con un `refresh_token` — no puede vivir en `.env`, algo tiene que escribirlo automáticamente.

**Alternativas evaluadas (sin cambios respecto a la v1):** A (todo en `.env`) no resuelve OAuth. B (todo cifrado en SQLite, el Wizard escribe vía formulario) contradice la instrucción explícita de no escribir secretos por HTTP y además crea un problema circular (la clave maestra que cifraría la BD tiene que vivir en algún sitio — vuelve a ser `.env`, protegiendo algo más grande). **C — híbrido — sigue siendo la decisión correcta**, ahora reforzada con tres capas que la hacen sustituible, capaz y multi-venture sin reescribirse.

#### Los tres principios, evaluados

**1. `SecretProvider` — todo el sistema depende de una interfaz, nunca de `.env` directamente.**
Compatible, y corrige un defecto real de la v1: ahí los secretos estáticos se leían con `process.env` directo desde cada Tool, mientras que los OAuth pasaban por un servicio — dos caminos de consumo distintos para el mismo concepto. Se unifican en una única interfaz.

**2. Agentes y Tools piden capacidades (`ai`, `etsy`, `shopify`, `github`), nunca secretos concretos.**
Compatible — es una capa que se coloca encima de `SecretProvider`, no lo sustituye. Beneficio inmediato no pedido pero gratis: si mañana cambia el proveedor de IA, ningún Tool que pida la capacidad `ai` se entera.

**3. Los secretos deben poder pertenecer a un Workspace/Venture, no al servidor.**
Compatible **con un límite explícito**: solo tiene sentido para credenciales **OAuth2** (que ya tienen un sitio propio en la app donde vivir cifradas). Un secreto **estático no puede ser de-venture** — no existe un `.env` por venture, y forzarlo por HTTP violaría la regla ya fijada. Etsy y Shopify, las dos integraciones nombradas, son ambas OAuth2 — el límite no afecta a ningún caso real de hoy. "Workspace" no se construye como tabla nueva: hoy Workspace = la instalación única (igual que en el resto de este documento, §11.1 ya fijó single-owner) — el diseño deja el hueco (`scope`) para que un `workspace_id` se añada después de forma aditiva, exactamente como se hizo con `venture_id` en el resto del Core, sin que eso sea trabajo de hoy.

#### Arquitectura (v2)

```
                    ┌─────────────────────────────────────┐
   Tools/Agentes →  │  CapabilityResolver                  │   Principio 2
                    │  resolve('etsy', { ventureId })      │
                    └──────────────────┬────────────────────┘
                                       │ mira qué SecretDefinition respalda la capability
                    ┌──────────────────▼────────────────────┐
                    │  secret_definitions (SQLite)           │
                    │  id · label · capability · kind        │
                    │  scope ('installation'|'venture')      │
                    │  env_var · required · docs_url          │
                    └──────────────────┬────────────────────┘
                                       │
                    ┌──────────────────▼────────────────────┐
   Principio 1  →   │  SecretProvider (interfaz)              │
                    │  getStatic(envVar)                      │
                    │  getDynamic(defId, ventureId)            │
                    │  setDynamic(defId, ventureId, value)     │  ← solo el propio backend
                    └───────┬──────────────────────┬──────────┘
                            │ kind='static'         │ kind='oauth2'
                            ▼                       ▼
                  ┌──────────────────┐   ┌──────────────────────────┐
                  │ LocalEnvProvider │   │ secret_values (cifrado)   │  Principio 3
                  │ → process.env    │   │ definition_id · venture_id│
                  │ (scope siempre   │   │ (NULL=instalación)        │
                  │  'installation') │   │ value_enc · expires_at     │
                  └──────────────────┘   └──────────────────────────┘
```

Implementaciones futuras de `SecretProvider` (Docker secrets, Vault, AWS Secrets Manager) sustituyen `LocalEnvProvider` entero sin que `CapabilityResolver`, `secret_definitions` ni un solo Tool cambien una línea — es exactamente la garantía que pedía el principio 1.

#### 1. Capacidades — lo único que agentes y Tools conocen

```typescript
// config/capabilities.ts
interface Capability {
  id: string;                 // 'ai' | 'etsy' | 'shopify' | 'github'
  secretDefinitionId: string; // qué definición la resuelve
  scope: 'installation' | 'venture';
}

interface CapabilityResolver {
  resolve(capabilityId: string, ctx?: { ventureId?: number }): Promise<string | null>;
}
```

Un `Tool` nunca llama a `secretProvider.get('etsy_oauth')`. Llama a `capabilities.resolve('etsy', { ventureId: ctx.ventureId })`. El resolver mira qué `SecretDefinition` respalda `'etsy'`, y según su `scope`, delega en `SecretProvider.getStatic()` o `getDynamic(defId, ventureId)`. El Tool nunca sabe si detrás hay `.env`, una tabla cifrada, o Vault.

#### 2. `SecretProvider` — la interfaz que hace todo lo demás sustituible

```typescript
// config/secretProvider.ts
interface SecretProvider {
  getStatic(envVar: string): string | null;
  getDynamic(definitionId: string, ventureId: number | null): Promise<{ value: string; expiresAt?: string } | null>;
  setDynamic(definitionId: string, ventureId: number | null, value: { value: string; expiresAt?: string }): Promise<void>;
}
```

`LocalEnvProvider` (única implementación en v1): `getStatic` lee `process.env`; `getDynamic`/`setDynamic` leen/escriben `secret_values` cifrado (AES-256-GCM, clave en `OAUTH_ENCRYPTION_KEY` del `.env`, alcance mínimo — solo protege esta tabla, no el sistema entero). `setDynamic` **nunca lo invoca una ruta HTTP que reciba un valor de un formulario** — solo el callback OAuth (ver abajo) y el refresco silencioso.

#### 3. Definiciones — código, con `capability` y `scope` explícitos

```typescript
// tools/index.ts, junto a cada Tool — mismo principio que el contrato de Tool, §8.2
export const EtsySecretDefinition: SecretDefinition = {
  id: 'etsy_oauth', label: 'Etsy (OAuth)', capability: 'etsy',
  kind: 'oauth2', scope: 'venture',   // cada venture conecta SU PROPIA tienda Etsy
  docsUrl: 'https://www.etsy.com/developers/register',
  validate: async (ctx) => { /* llamada de lectura mínima a la API de Etsy */ },
};

export const GithubSecretDefinition: SecretDefinition = {
  id: 'github_pat', label: 'GitHub', capability: 'github',
  kind: 'static', scope: 'installation',   // Hermes/despliegue no es de un venture
  envVar: 'GITHUB_PAT',
};
```

Al arrancar, `initSchema()` sincroniza estas definiciones con `secret_definitions` (`INSERT OR REPLACE`, mismo patrón que ya sincroniza `agents.model` contra `agentModels.ts`) — la tabla nunca diverge del código.

#### 4. OAuth2 — la única excepción real a "nunca por HTTP", y ahora venture-aware

Etsy y Shopify redirigen con un `code` de un solo uso — inevitable en OAuth2, y categóricamente distinto de "pegar una API key en un formulario": el `code` no es la credencial, es un ticket que el backend cambia server-to-server.

```
Jorge → GET /api/secrets/etsy_oauth/oauth/start?venture_id=3   (requireAdmin)
      → redirect a Etsy (el `venture_id` viaja en el `state` firmado del OAuth)
Etsy  → el usuario autoriza
      → redirect a GET /api/secrets/etsy_oauth/oauth/callback?code=...&state=...
Backend → valida state → recupera venture_id=3
        → intercambia code por tokens (server-to-server)
        → SecretProvider.setDynamic('etsy_oauth', 3, { value, expiresAt })
        → nunca expone los tokens de vuelta al navegador
```

Cada venture conecta su propia tienda Etsy de forma independiente — `secret_values` tiene `UNIQUE(definition_id, venture_id)`, así que el venture 1 y el venture 2 tienen filas separadas, cifradas por separado. **Renovación**: `getDynamic` comprueba `expires_at`; si venció, usa el `refresh_token` para pedir uno nuevo y llama a `setDynamic` con el resultado — transparente para el Tool.

#### 5. Validación

`validate(ctx?)` en cada `SecretDefinition` — para las `scope='venture'` recibe `{ ventureId }`. `POST /api/secrets/:id/validate?venture_id=N` (requireAdmin) la ejecuta y persiste el resultado junto al valor (en `secret_values` si es de venture, en `secret_definitions` si es de instalación).

#### 6. API expuesta (toda `requireAdmin` salvo el callback)

```
GET  /api/secrets?venture_id=N          → estado de todas las definiciones aplicables
                                            (globales siempre + las de venture si se pasa venture_id)
                                            { id, label, capability, kind, scope, present, last_validated_at, last_validation_ok }
                                            — JAMÁS un valor
POST /api/secrets/:id/validate?venture_id=N
GET  /api/secrets/:id/oauth/start?venture_id=N    (solo kind='oauth2')
GET  /api/secrets/:id/oauth/callback              (público — lo llama el proveedor; protegido por `state`, no por ADMIN_TOKEN)
```

Sigue siendo la fuente real detrás de §12.1 (System Profile): ahora con `capability`, `scope` y venture opcional.

#### 7. Desarrollo local vs VPS/producción

Sin cambios respecto a la v1: `.env` nunca se commitea, nunca viaja por HTTP, nunca lo genera el Wizard. `secret_values` viaja con el resto de la BD SQLite (ya cifrada en reposo). `OAUTH_ENCRYPTION_KEY` es distinta por entorno, generada una vez, nunca reutilizada. Aplicar un cambio en `.env`: reinicio manual en local, `pm2 restart hokage-backend` en VPS (§11.3). Se mantiene `.env.example` regenerado desde `secret_definitions` (solo las `scope='installation'`, nunca las de venture — esas no tienen entrada en `.env`).

#### Consecuencias a 2-3 años

Una integración nueva declara su `Capability` + `SecretDefinition` junto a su `Tool` — aparece sola en `GET /api/secrets`, ningún Tool existente cambia. Sustituir el backend de secretos (Vault, AWS Secrets Manager) es escribir una clase nueva que implemente `SecretProvider` — cero cambios en `CapabilityResolver`, Tools o rutas. Un segundo, tercer o vigésimo venture conecta su propia Etsy/Shopify sin coordinación entre ellos — cada uno con sus propias filas cifradas, sin que el código sepa ni le importe cuántos hay. El único límite que el diseño no resuelve — un secreto estático de-venture — es exactamente el tipo de problema que no existe todavía: el día que aparezca (una integración sin OAuth2 que necesite credenciales distintas por negocio), la señal de disparo es clara y ya está anotada aquí, no descubierta a medio construir.

### 11.3 VPS y despliegue

🔒 **CONGELADO**, ya bien decidido en `ARCHITECTURE.md §11` y `Roadmap.md`: Hetzner CX22, PM2 (proceso vivo + reinicio automático — resuelve el problema de "el runtime no sobrevive reinicios" señalado en §2), Nginx + Certbot, SQLite ahora, PostgreSQL cuando se supere ~2 negocios activos o 10 agentes (umbral ya fijado en `Roadmap.md`, se ratifica). No requiere ninguna decisión nueva — solo ejecución, pendiente de que Jorge cree el servidor.

---

## 12. Configuración inicial: Wizard, Founder Profile, System Profile

Ninguno de estos tres conceptos existía antes de este documento. §12.2 (Founder Profile) ya tiene arquitectura completa (🔒 v2, ver abajo); §12.1 y §12.3 quedan en 🆕, definidos pero sin el mismo nivel de detalle todavía — candidatos de una fase de diseño posterior.

### 12.1 System Profile

Snapshot de configuración de **esta instalación concreta** de Hokage OS — no de Jorge, no de un negocio. Responde: ¿qué integraciones están conectadas?, ¿qué agentes están activos/pausados?, ¿qué límites de presupuesto rigen?, ¿es un entorno de desarrollo o producción?

No es una tabla nueva — es una **vista de solo lectura sobre datos que ya existen**: `agents.status`, `departments.active`, `agent_budgets`, y el estado de secretos que ya expone `GET /api/secrets` (§11.2 — presencia y validación, nunca valores). Se expone como un único endpoint (`GET /api/system/profile`) que agrega estas fuentes. **Es exactamente lo que un Wizard necesita leer al arrancar para no volver a preguntar algo que ya se sabe.**

### 12.2 Founder Profile

🔒 **CONGELADO — v2, arquitectura completa lista para implementar.** Elegido como segundo sistema de la fase de diseño (ver §16, metodología diseñar→revisar→congelar). La v1 de esta sección (un párrafo) quedaba corta del mismo rigor que ya tiene Memory System v3 (§6) — se completa aquí: schema, mecanismo de escritura, alcance de lectura, y una corrección de scope real encontrada al diseñarlo en detalle.

**Qué es:** datos estructurados y **estables** sobre Jorge que Hokage (el agente `ceo`) usa para personalizar su razonamiento estratégico — tolerancia al riesgo, estilo de comunicación preferido, objetivo económico actual. Es la contraparte "humana" del Memory System (§6): mientras `memory_entries` guarda hechos sobre *negocios*, el Founder Profile guarda rasgos sobre *el fundador*.

**Corrección de scope, encontrada al diseñar (no estaba en la v1):** "lecciones de negocios anteriores" — mencionado en la v1 como parte del Founder Profile — **no vive aquí**. Un rasgo estable ("mi tolerancia al riesgo es media") y una lección puntual ("en 2023 el negocio X fracasó porque Y") son cosas de naturaleza distinta: la primera tiene *un* valor vigente que se sobrescribe, la segunda es narrativa que se acumula sin límite. Eso último ya tiene un mecanismo — es exactamente lo que `memory_entries` (§6) ya modela con `category='learning'`, `venture_id=NULL` (memoria de instalación, no de un negocio concreto), `source_agent_id=NULL` (lo escribió Jorge, no un agente). Inventar un segundo almacén para el mismo tipo de hecho habría repetido el error que ya se corrigió una vez en Memory System v3 (dos semánticas de escritura mezcladas en un solo sitio). Founder Profile se queda estrictamente para **rasgos con un único valor vigente**, no para historia.

**Schema:**

```sql
CREATE TABLE founder_profile (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now'))
);
```

Mismo patrón que `agent_memory` (clave-valor, upsert), pero sin `agent_id` — no hace falta, hay un único fundador (consistente con el modelo single-owner ya congelado en §11.1). **Vocabulario de claves sugerido, no cerrado por un enum** (permite añadir rasgos nuevos sin migración): `risk_tolerance`, `communication_style`, `economic_goal`, `founder_name`. Igual que `memory.remember` (§6), la clave se valida por formato (snake_case) en la tool, no por una lista fija — añadir un rasgo nuevo es escribir una clave nueva, no tocar código.

**Escritura — tool nueva, no una reutilización de otra:** `founder.remember({key, value})`. Mismo principio ya aplicado dos veces en esta fase de diseño (§2, §6): una tool, un propósito. No reutiliza `memory.remember` (semántica de log, no de rasgo estable) ni `memory.write` (memoria privada por agente, no del fundador). Upsert por `key` (`ON CONFLICT(key) DO UPDATE`), mismo patrón exacto que `writeAgentMemory()`.

- **Disponible solo al rol `ceo`** — es el único rol cuyo prompt lee este perfil (ver Lectura, abajo); dar la tool a un rol que nunca la consulta crea una escritura huérfana. Si en el futuro otro rol tiene una necesidad concreta de leer/escribir esto, se reabre esta decisión con esa necesidad real delante — no antes.
- Cumple la regla permanente fijada al cerrar la migración de §2: toda escritura estructurada nueva nace en Tool Calling, nunca en un marcador ni en un mecanismo alternativo.

**Lectura:** en `aiService.ts::askAgent()`, un bloque `[PERFIL DEL FUNDADOR]` — **solo cuando `agentRow?.role === 'ceo'`**, no en los otros 7 roles (coste de tokens innecesario para agentes cuyo prompt nunca lo usa, mismo criterio de disciplina de §10). Formato igual que `[LO QUE SÉ]`: `SELECT key, value FROM founder_profile ORDER BY key` (tabla pequeña por naturaleza — un puñado de rasgos, nunca miles de filas — no hace falta `LIMIT` ni orden por recencia).

**Tres caminos de escritura, uno solo de verdad (el resto llaman al mismo):**
1. **Conversación normal con Hokage** — la tool `founder.remember`, disponible desde ya, sin depender de nada más.
2. **API directa** — `GET /api/founder-profile` / `PUT /api/founder-profile/:key` (`requireAdmin`), para un futuro panel de ajustes donde Jorge edite sus rasgos a mano sin pasar por una conversación. Llama al mismo servicio (`setFounderProfile()`) que usa la tool — nunca hay dos implementaciones del upsert.
3. **Fresh Install Wizard** (§12.3, no diseñado todavía en detalle) — cuando exista, sus preguntas de arranque llaman al mismo `setFounderProfile()`. **Founder Profile no depende del Wizard para ser útil** — el camino 1 ya funciona el día que se implemente esta sección, con o sin Wizard. Se corrige así la v1, que ataba la primera población al Wizard sin necesidad real de esa dependencia.

### Consecuencias a 2-3 años

Rasgos estables sobre Jorge se acumulan desde la primera conversación, no desde que exista un Wizard — igual que Memory System v3 evita "memoria vacía que empezó tarde" para negocios, esto evita lo mismo para el fundador. Si algún día Founder Profile necesita historizar cambios (saber que la tolerancia al riesgo de Jorge cambió de 'media' a 'baja' en una fecha concreta, no solo el valor actual), eso es una razón real para versionar la tabla — no se construye ahora sin esa necesidad concreta delante.

### 12.3 Setup Wizard — alcance definitivo

Dado que este es exactamente el punto que quedó abierto antes de este documento, se fija aquí una decisión definitiva en vez de dejarlo pendiente:

**El Wizard son dos flujos separados que comparten infraestructura, no uno solo:**

1. **Fresh Install Wizard** — se dispara la primera vez que arranca un Hokage OS sin `founder_profile` poblado. Pide: nombre, objetivo económico inicial (alimenta el primer `Objective` del Goal System), confirmación de los 8 agentes por defecto (nombre/modelo se pueden dejar por defecto o tocar ahí mismo — reutiliza `ConfigView`, no construye nada nuevo). Termina creando el primer `venture`.
2. **New Venture Wizard** — disponible en cualquier momento desde `ConfigView` o el menú principal. Crea un `venture` nuevo, opcionalmente un `Objective` con `venture_id` (requiere §3 resuelto), y pregunta si algún canal (§8.4) necesita configurarse — para canales OAuth2 (Etsy, Shopify), esto es literalmente el botón "conectar" de §11.2 con `venture_id` ya fijado al del venture recién creado, cada uno con sus propias credenciales sin pisar las de otro venture.

**Bloqueante explícito antes de construir el flujo 2: §3 debe estar resuelto** (los 3 puntos de implementación mínima) — si no, "crear un segundo venture" crea una fila huérfana que ningún agente sabrá usar, exactamente el riesgo que motivó este documento entero.

**El flujo 1 se puede construir ya, sin esperar a §3** — no depende de multi-venture, solo de que exista `founder_profile` (tabla nueva, trivial) y de reutilizar lo que ya existe (`ConfigView`, `POST /api/ventures`).

---

## 13. Frontend: Mapa, HUD, Terminal, las 7 vistas, paneles por sala

🔒 **CONGELADO — v2.** La v1 daba por cerrado el patrón de sala genérica sin haber contrastado contra `VISION.md` completo. Jorge lo cuestionó y confirmó reabrirlo — se corrige aquí.

### Mapa (World Engine)

`FRONTEND_WORLD_ENGINE.md` describe 7 fases; el estado real verificado **ya supera lo que el propio documento marca como "pendiente"**: Fase 2 (cámara libre: pan, zoom, minimapa), Fase 3 (departamentos como datos) y Fase 4 (agentes con estado visual real) están hechas. Fase 5 (eventos reales → animación) parcial. **Acción de bajo coste, no bloqueante: actualizar la tabla de fases de ese documento a la realidad.**

**Hallazgo nuevo, de `docs/research/world-engine/prison-architect.md` (investigación real del proyecto, nunca antes cruzada contra este documento):** la recomendación **R7 — overlays de datos activables** (actividad, presupuesto, pipeline, salud, visualización directa del modelo de datos) está identificada como valiosa desde hace días y **nunca se incorporó aquí ni se construyó**. Es la forma más literal de "el mapa no debe ser decoración" — que Hermes (§9.1) ya empieza a resolver **hablado**, pero el mapa debería resolverlo **visualmente**. Se anota como el siguiente candidato real del World Engine, no bloqueante para lo que sigue, pero no se vuelve a perder de vista.

### HUD

`GameHUD.tsx` — barra superior persistente, sin nada decorativo tras la limpieza de esta sesión: cada número mostrado tiene una consulta real detrás. **Regla que se congela: cualquier tile nueva debe pasar la misma prueba — si el dato no cambia con el estado real del backend, no entra al HUD.**

### Salas: paneles especializados por tipo de departamento

`VISION.md` (documento fundacional, releído completo en esta ronda) es explícito y mucho más ambicioso que lo que la v1 de este documento congeló: *"Sala Desarrollo: terminal real, logs reales, commits. Sala Diseño: Figma, versiones. Sala Tienda: catálogo real, pedidos reales, ventas. Todo debe ser funcional. No decorativo."* Cada sala es una experiencia distinta, no una skin sobre el mismo panel.

Lo construido hasta ahora (`BuildingView` con 7 pestañas idénticas en todas las salas — Chat/Outputs/Feed/Stats/Pipeline/Alertas/Config) es honesto con el backend pero no es esa ambición. Se corrige con un **registro de paneles por tipo de sala**, mismo principio que ya rige Tools (§8.2) y Capabilities (§11.2) — extensión por datos/registro, nunca por `if` acumulados en `BuildingView.tsx`:

```typescript
// frontend/src/panels/roomPanels.ts
interface RoomPanel {
  departmentKey: string;                         // 'hermes' | 'banco' | 'tienda' | ...
  label: string;
  component: React.ComponentType<{ agent: Agent; building: Building }>;
}
```

Las 7 pestañas genéricas **se quedan** como base común (chat, alertas y configuración son legítimamente iguales en cualquier sala) — los paneles del registro se **añaden** encima, nunca las sustituyen. `TerminalPanel.tsx` (hoy un caso especial hardcodeado en `BuildingView.tsx` solo para `role === 'hermes'`) es, sin saberlo, el primer ejemplo de este patrón — se generaliza al registro en vez de quedarse como la única excepción.

**Regla dura, honesta, para no repetir el error de la capa de XP eliminada esta sesión:** un panel especializado **solo se construye cuando hay dato real detrás**. Verificado sala por sala:

| Sala | Panel especializado | Estado |
|---|---|---|
| Hermes | Estado del sistema en vivo (§9.1 — cola, presupuesto, salud) | **Construible ya** — reutiliza `/api/runtime/status` + `/api/metrics/summary` |
| Banco (Finanzas) | Presupuesto y coste real por venture | **Construible ya** — reutiliza `agent_costs`/`ventures`, ya expuesto |
| Laboratorio (Explorador) | Tendencias detectadas | **Ya existe** — es `OutputsPanel` filtrado a `market` |
| Estudio (Escritor) | Contenido creado | **Ya existe** — es `OutputsPanel` filtrado a `content` |
| Tienda (Tráfico) | Catálogo, pedidos, ventas reales | **Bloqueado** — no hay integración de Etsy/Shopify (§8.1, Fase 6). No se construye una versión con datos falsos mientras tanto. |
| Taller (Operaciones) | Salud de sistemas | Candidato, sin dato específico más allá de lo que ya cubre Stats — no urgente |

### Terminal

UI de Hermes (§9.1) — ya no pausada. `TerminalPanel.tsx` (historial de comandos, stdout/stderr, exit code) se mantiene y pasa a ser el primer panel registrado en `roomPanels.ts`, junto al nuevo panel de Estado del Sistema.

### Las 7 vistas

Sin cambios: **Mapa, Crew, Alertas, Comms, Ventures, Objetivos, Config**, todas overlay sobre el mapa. **Regla que se congela: una vista nueva se añade a este mismo patrón — nunca como ruta separada.**

---

## 14. Escalabilidad

🔒 **CONGELADO**, síntesis de los umbrales ya fijados en distintos puntos de este documento y de `Roadmap.md`:

| Límite conocido | Umbral | Qué hacer al llegar |
|---|---|---|
| SQLite → PostgreSQL | 2+ negocios activos simultáneos o 10+ agentes | Ya decidido en `Roadmap.md`, sin trabajo adicional de diseño |
| Scheduler centralizado → distribuido | Cola con latencia perceptible, decenas de agentes | Revisitar §2 — no antes |
| Roles de agente: código → datos | El día que se pida un rol nuevo sin tocar TypeScript | Revisitar §4 — no antes |
| `memory_entries` sin poda → con poda/archivado | Volumen real empieza a afectar el tamaño de la BD o el coste de la lectura por turno (§6) | Revisitar §6 — no antes |
| Tool interface propio → MCP | Integraciones externas > ~15-20 | Revisitar §8.5 — no antes |
| Permisos single-owner → multi-usuario | Un segundo fundador usa Hokage OS | Revisitar §11.1 — no antes |
| API sin paginación → `limit`/`offset`/filtro por venture | 2+ ventures activos simultáneos (coincide con el umbral de Postgres) | Paginar `agents`/`decisions`/`ventures`/`objectives`/`messages`, filtrar `useAppData.ts` por venture activo |
| Cero tests automatizados → smoke-test mínimo | Antes de la siguiente migración de BD que toque tablas con FK (ya causó una regresión real esta sesión) | Un test del ciclo Decision→approve→work_item + verificación post-migración, no cobertura amplia |

Esta tabla es, deliberadamente, la forma de evitar sobre-construir: cada fila es una decisión ya tomada sobre **cuándo** revisar algo, no una promesa de construirlo ahora.

---

## 15. Recetas: añadir negocio / agente / plugin

Síntesis operativa de las decisiones de arriba, en el mismo formato que `ARCHITECTURE.md §12` (que sigue siendo válido en estructura, se actualiza aquí en contenido).

### Añadir un negocio nuevo

1. `POST /api/ventures` (ya existe).
2. Si aplica, crear un `Objective` con `venture_id` (una vez resuelto §3).
3. Si el negocio usa un canal nuevo (Etsy, Shopify...), ver "añadir un Business Module" abajo.
4. No se toca código — los agentes existentes atienden el venture nuevo via contexto (§3).

### Añadir un agente nuevo (rol ya existente en `AGENT_MODELS`/`AGENT_TOOLS`/`AUTONOMOUS_TASKS`)

1. `POST /api/agents` con el rol existente.
2. `PUT /api/agents/:id/prompt` con su personalidad.
3. Crear su `department` si necesita sala propia en el mapa.

### Añadir un rol de agente completamente nuevo (comportamiento nuevo)

Requiere tocar código hoy (§4) — no automatizable en v1: registrar en `AGENT_MODELS`, `AGENT_TOOLS`, `AUTONOMOUS_TASKS`.

### Añadir un plugin (tool nuevo que un agente puede invocar)

1. Clase `Tool` nueva en `tools/index.ts` (contrato en `tools/base.ts`, §8.2).
2. Registrar en `tools/registry.ts`.
3. Añadir su id a `AGENT_TOOLS` para el rol que lo use.
4. Si necesita garantía de aprobación real, implementarla dentro de su propio `execute()` (nunca confiar en `requiredApproval` como si fuera aplicado por la plataforma — no lo es).

### Añadir un Business Module

Ver §8.4 — es composición de lo anterior (canal + Tool + Automations por defecto), no un mecanismo nuevo.

---

## 16. Resumen ejecutivo

### Congelado sin más discusión (🔒)

Arquitectura en capas del Core · Runtime/Scheduler/Event Bus (contrastado contra investigación previa del proyecto — R1-R4 ya implementadas) · Contrato de Tool como sistema de plugins · Diseño de plugins visuales del mapa · Modelo de economía (agent_costs/agent_budgets/ventures) · VPS y despliegue · **Modelo multi-venture, implementado y verificado** (§3) · **Sistema de permisos single-owner sin hardcode** (§11.1, implementado) · **Arquitectura de gestión de secretos v2** (§11.2 — `SecretProvider`, capacidades, scope por venture) · **Hermes y Claude como los dos motores del ecosistema v2** (§9 — Hermes personifica el Runtime y coordina permanentemente; Claude como consulta profunda estructurada vía Decision, no API automática) · **Registro de paneles especializados por sala** (§13 — reabierto tras contrastar contra VISION.md completo) · **Migración de marcadores de texto a Tool Calling, implementada** (§2 — MEMORIA/TENDENCIA/CONTENIDO/DECISION son Tools reales) · **Memory System v3, arquitectura completa lista para implementar** (§6 — elegido como siguiente sistema tras comparar contra Founder Profile/Secret Management/Hermes v2; dos tools distintas para dos semánticas de escritura, `venture_id` estructural como prerrequisito cerrado, puntos de enganche verificados contra código real) · **Founder Profile v2, arquitectura completa lista para implementar** (§12.2 — segundo sistema de la fase de diseño; tool `founder.remember` dedicada, lectura acotada al rol `ceo`, "lecciones de negocios anteriores" redirigidas a `memory_entries` en vez de duplicar almacenamiento).

### Metodología de la fase de diseño (fijada por Jorge, gobierna el resto de esta ronda y las siguientes)

Tras cerrar la migración de §2, Jorge fijó un modo de trabajo explícito para lo que queda del roadmap: **diseñar completamente un sistema → revisarlo críticamente → congelarlo → pasar al siguiente**, manteniendo siempre distinción clara entre "sistema diseñado" y "sistema implementado" — sin escribir código durante esta fase. Sistemas objetivo antes de cerrarla: Memory System (✅), Founder Profile (✅), Secret Management (✅, ya congelado en una ronda anterior), Hermes v2 (✅, ya congelado), Plugin System, Wizard. **Cuando los 5-6 estén diseñados, la fase termina** — a partir de ahí el modo de trabajo por defecto es solo construir, reabriendo un diseño únicamente ante un problema arquitectónico crítico real, no por mejora incremental. Razón explícita de Jorge: evitar el bucle de "mejoramos otra vez el diseño" que nunca termina en producto.

### Decidido aquí por primera vez (🆕)

Definición de Business Module · Postura sobre MCP (no adoptar en v1) · System Profile (§12.1) · Alcance definitivo del Setup Wizard (§12.3, definido pero sin el mismo nivel de detalle que Memory System/Founder Profile todavía — candidato de esta fase de diseño).

### Pausa estratégica de esta ronda — qué cambió y por qué

Antes de seguir implementando, Jorge pidió una relectura completa contra `VISION.md` y la investigación ya existente en el proyecto (`docs/research/world-engine/`). Encontró — y yo confirmé, no rechacé — dos decisiones de la v1 que no coincidían con la visión real:

1. **Hermes estaba mal dimensionado.** Diseñado como utilidad estrecha y pausada; debía ser el coordinador permanente del ecosistema. Corregido en §9.1.
2. **El patrón de sala genérica no cumplía `VISION.md`.** El documento pedía salas radicalmente distintas entre sí desde el primer día; la v1 congeló un patrón único de 7 pestañas sin haber leído `VISION.md` completo antes de hacerlo. Corregido en §13, con la regla explícita de no construir paneles con datos falsos (Tienda queda bloqueada hasta Fase 6, no simulada).

También se incorporó investigación del propio proyecto (`prison-architect.md`, `rimworld.md`) que nunca se había cruzado contra el documento — confirmando que el Runtime ya sigue R1-R4 sin que se supiera, y dejando R5/R7 anotadas.

### Auditoría crítica final pre-lanzamiento — un hallazgo real, no cero

Antes de autorizar implementación del resto del sistema, se hizo la pregunta explícita: *¿existe alguna decisión que dentro de 1-2 años obligue a reconstruir algo importante?* Respuesta honesta: **sí, una** — el sistema de marcadores de texto (`[DECISION:]`, `[TENDENCIA:]`, `[CONTENIDO:]`, `[MEMORIA:]`) que hoy convive, de forma inconsistente, con el mecanismo de Tool Calling ya construido y funcionando (§8.2). Jorge aceptó la recomendación sin reservas: **migración incremental y compatible hacia atrás de los 4 marcadores a Tools reales, en el orden TENDENCIA → CONTENIDO → MEMORIA → DECISION** — ver §2, "De marcadores de texto a Tool Calling". `operaciones`/`soporte` corren en un modelo sin tool-calling fiable (Llama 3.1 8B) — para ellos el regex de `MEMORIA`/`DECISION` no se retira nunca, no es un detalle menor. El resto de riesgos encontrados en esa auditoría (ausencia de paginación en la API, cero tests automatizados, `decisions.entity_type/entity_id` sin integridad referencial, acoplamiento a OpenRouter en `aiService.ts`) se evaluaron como deuda gestionable con disparador explícito, no como bombas de relojería — ya incorporados a §14.

### Migración marcadores → Tool Calling — ✅ completada (4/4 fases, 2026-08-04)

Las cuatro fases (`trend.report`, `content.create`, `memory.write`, `decision.create`) están construidas, conectadas y verificadas con ejecución real, cada una en su propio commit, siguiendo exactamente la disciplina fijada al aprobar el plan — ver §2 para el detalle completo de cada fase, incluidos dos hallazgos reales encontrados y corregidos durante la construcción (el riesgo de ciclo de imports con `aiService.ts`, y el campo `description` que dejó de venir "gratis" al migrar de texto libre a tool). **Estado honesto, no optimista:** los 6 roles tool-capable ya no reciben la instrucción del marcador migrado en el prompt, pero el regex de compatibilidad sigue en el código para los 4 marcadores — retirarlo del todo (posible solo para `TENDENCIA`/`CONTENIDO`) es una decisión aparte, pendiente de datos de producción reales, no tomada en esta ronda. `operaciones`/`soporte` (Llama 3.1 8B) se quedan en `MEMORIA`/`DECISION` por marcador de forma permanente, por diseño.

### Elección del siguiente sistema — Memory System v2, no Founder Profile

Con la migración cerrada, tocaba decidir qué sistema construir a continuación mientras el sistema acumula evidencia real de la migración (fase de estabilización, sin más cambios al Runtime por ahora). Jorge propuso Founder Profile como candidato; se comparó contra los otros tres sistemas ya especificados pero no implementados (Memory System, Secret Management, Hermes v2) contra el filtro de 4 preguntas de §0 y contra dependencias externas reales — no se aceptó la sugerencia sin más, como pide la directriz de arquitecto-jefe.

**Ganador: Memory System v2.** Es el único que cumple dos de las cuatro preguntas de §0 con fuerza (mejores decisiones autónomas, menos intervención de Jorge) y no depende de nada externo (FTS5 nativo). Founder Profile solo cumple una (comprende mejor a Jorge) y su alcance es más estrecho (principalmente el razonamiento del CEO). Secret Management depende de integraciones que todavía no existen (Fase 6, sin fecha) y necesita credenciales reales de terceros para verificarse de verdad — no solo diseño. Decisivo además: la Fase 3 de la migración de marcadores (§2) construyó, sin buscarlo, la mitad del mecanismo de escritura que Memory System necesita (`memory.write` ya existe) — aprovechar ese momentum directamente pesó más que "es lo que propuse primero".

**§6 se reescribió como v3, arquitectura completa lista para implementar** — no solo el schema de la v2, sino los puntos de enganche exactos verificados contra el código real (incluye un hallazgo honesto: "objetivo abandonado" nunca se dispara en el código actual, no se construye ese hook), la corrección de un error de diseño de la v2 (`memory.write` no se reutiliza con un parámetro — nace una tool nueva, `memory.remember`, porque mezclar upsert-privado con log-empresarial en una sola tool repetía justo el tipo de ambigüedad que la migración de §2 eliminó), y el cierre de un prerrequisito real que se venía posponiendo: `venture_id` pasa a ser un campo estructural en `AgentTask`/`ToolContext` (hoy solo existe como texto `[VENTURE: ...]`), necesario porque Memory System **lee** por venture, no solo escribe.

### Ya no queda ninguna decisión ⚠️ pendiente de confirmación

Todas las de esta ronda y las anteriores están resueltas. Lo que queda es **diseño ya especificado pero no implementado**: Memory System v3 (§6, siguiente en la cola de implementación), Secret Management completo, Hermes v2, paneles por sala.

### Bloqueante real para el Setup Wizard

Sin cambios: el **Fresh Install Wizard** se puede construir ya. El **New Venture Wizard** depende de implementar §11.2 si el primer venture nuevo necesita credenciales propias.
