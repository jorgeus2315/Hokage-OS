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

### Sistema de eventos (Event Bus)

**Contrato inquebrantable, ya eliminado el único punto que lo violaba (`addEvent()`, código muerto borrado esta sesión):** el bus (`HokageBus extends EventEmitter`) es **estrictamente en memoria**, con un `history[]` de las últimas 100 entradas. Nunca escribe a SQL. Si el proceso reinicia, el historial de eventos se pierde — eso es aceptado por diseño (la verdad de fondo vive en las tablas de dominio: `decisions`, `work_items`, `messages`, no en el log de eventos).

Vocabulario cerrado de eventos (`AgentEventType` en `eventBus.ts`): `trend.detected`, `content.created`, `content.ready`, `decision.created/approved/rejected`, `sale.made`, `alert.triggered`, `agent.task.start/done/error`, `report.daily`, `system.error`, `objective.created/approved/achieved`. Añadir un evento nuevo es añadir un valor al union type — nunca un canal nuevo.

**Regla dura:** cualquier reacción visual a un evento (ver §13, Mapa) se define como tabla de reacciones, nunca como `if`/`switch` disperso. Esto ya estaba bien diseñado en `FRONTEND_WORLD_ENGINE.md §3.3` y sigue siendo la decisión correcta, aunque el "Animation Director" formal descrito ahí no se ha extraído todavía como módulo — hoy vive, parcialmente, como lógica ad-hoc en `useWorldState.ts`. **Deuda reconocida, no bloqueante.**

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

Una fila en `agents` (id, name, role, status, model, venture_id — sin usar, capabilities — sin usar) + una fila activa en `agent_prompts` +, opcionalmente, una fila en `agent_schedules` si su rol está en `AUTONOMOUS_TASKS`. 8 agentes reales hoy: ceo, investigador, contenido, trafico, finanzas, operaciones, soporte, hermes (pausado).

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

🆕 **DECISIÓN NUEVA** — no existía ningún concepto de "Knowledge System" antes de este documento. Solo existe `agent_memory`: pares clave-valor por agente (máx sin límite duro hoy, aunque `ARCHITECTURE.md` menciona 50 como límite deseado — no implementado), con `UNIQUE(agent_id, key)`.

### Por qué importa

`CLAUDE.md` pone como ejemplo explícito de lo que SÍ es prioritario: "memoria semántica que permite a Hokage recordar por qué fracasó algo hace 6 meses." Eso no existe hoy — `agent_memory` es memoria *privada* de cada agente, sin capacidad de búsqueda semántica ni de compartirse entre agentes.

### Alternativas

**A. Mantener memoria puramente por-agente, clave-valor** (lo que hay hoy)
- Ventajas: ya funciona, cero infraestructura nueva, coste cero.
- Inconvenientes: el Explorador no puede beneficiarse de algo que el Tesorero aprendió. No hay noción de "por qué fracasó X" — solo hechos sueltos, sin razonamiento ni búsqueda por similitud.

**B. Base de conocimiento compartida con embeddings (vector store)**
- Ventajas: búsqueda semántica real, memoria compartida entre todos los agentes y ventures, exactamente lo que describe la filosofía.
- Inconvenientes: infraestructura nueva completa (embeddings, un vector store — SQLite no lo hace nativamente sin una extensión), coste de generar embeddings en cada escritura, y sobre-ingeniería clara para 8 agentes y 1 venture.

**C. Híbrido — `agent_memory` se queda como contexto de trabajo privado por agente; se añade una tabla nueva `knowledge_entries` (venture-scoped, no agent-scoped) para hechos que cualquier agente debería poder consultar, con búsqueda por palabra clave (SQLite FTS5) en vez de embeddings**
- Ventajas: resuelve el caso real ("por qué fracasó algo hace 6 meses" es un hecho del *negocio*, no de un agente concreto) sin la complejidad de un vector store. FTS5 es SQLite nativo, cero dependencias nuevas.
- Inconvenientes: búsqueda por palabra clave es más torpe que semántica — "fracasó" no encuentra "no funcionó" a menos que ambos términos estén indexados.

### Decisión para Hokage OS

**Elegido: C, y solo cuando exista un segundo venture o una segunda fuente real de "fracasos" que registrar.** Hoy, con un venture y sin integración de ventas real, no hay todavía hechos de negocio que valga la pena centralizar — construir `knowledge_entries` ahora sería anticipar un problema que no existe todavía. **No se construye en v1.** Se congela la decisión de *forma* (C, no B) para que cuando llegue el momento no haya que rediscutir vector-store-sí-o-no.

### Consecuencias a 2-3 años

Si Hokage gestiona 3+ negocios con historial real de decisiones y resultados, la ausencia de una capa de conocimiento compartido significa que Hokage (el CEO) no puede razonar "esto ya lo intentamos con el venture anterior y falló por X" — pierde exactamente la ventaja competitiva que `CLAUDE.md` promete. Esa es la señal de disparo para construir C.

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

## 9. Hermes — papel exacto

🔒 **CONGELADO**, ratificando y formalizando la decisión de esta sesión.

### Definición oficial

Hermes es el **único agente del sistema con acceso a ejecución de comandos de sistema** (`system.exec`). No es un agente de negocio (no atiende clientes, no genera contenido, no analiza mercado) — es infraestructura interna, tratada como un servicio de sistema con interfaz de agente.

**Regla dura que se congela aquí explícitamente, no estaba escrita en ningún sitio hasta ahora:**

> `system.exec` (o cualquier capacidad equivalente de ejecutar comandos reales en la máquina) **nunca se duplica en otro agente**. Toda necesidad de "tocar el sistema" — de cualquier agente, de cualquier automation, de cualquier plugin futuro — pasa por Hermes, exclusivamente. Nunca se le da esa capacidad directamente a Finanzas, a Operaciones, ni a ningún agente de negocio, por conveniente que parezca en el momento.

Motivo: es la única forma de mantener una única superficie de auditoría y un único punto donde la regla "siempre pide aprobación" se hace cumplir. Duplicarla en dos sitios es duplicar el riesgo de que uno de los dos se implemente peor.

### Estado actual

Pausado (`agents.status = 'paused'`, `departments.active = 0` para su sala) — construido y probado de extremo a extremo, sin caso de uso real todavía (ningún agente autónomo necesita hoy tocar el sistema de archivos; Jorge ya tiene terminal propia y a Claude Code). Se reactiva cuando exista un disparador real y concreto — ver memoria `project-hermes-pausado`.

### Consecuencias a 2-3 años

Si Hokage OS crece hacia automatización de despliegue, gestión de VPS, o tareas de mantenimiento delegadas a agentes (ver §11), Hermes es la pieza que ya está lista para eso — el trabajo de diseño de seguridad ya está hecho. La alternativa (cada agente con su propio acceso ad-hoc) es exactamente el tipo de deuda de seguridad silenciosa que este documento existe para prevenir.

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

🔒 **CONGELADO** — diseño completo, sustituye la versión anterior de esta sección (que solo fijaba la regla de no escribir `.env` por HTTP; esto es el mecanismo entero detrás de esa regla).

#### Por qué importa

Hoy solo existen 2 secretos (`OPENROUTER_API_KEY`, `ADMIN_TOKEN`), gestionados a mano. El Setup Wizard (§12.3) y los Business Modules (§8.4) van a necesitar credenciales de Etsy, Shopify, GitHub, futuros servidores MCP (§8.5) y lo que venga — sin un diseño explícito, cada integración nueva reinventaría su propia forma de pedir, guardar y usar una clave.

#### El problema de fondo que hay que resolver

Hay **dos tipos de secreto completamente distintos**, y tratarlos igual es el error que hay que evitar desde el diseño:

1. **Secretos estáticos** (`OPENROUTER_API_KEY`, un GitHub PAT, la mayoría de API keys): no rotan solos. Un humano los pega una vez y no vuelven a cambiar hasta que él decide rotarlos.
2. **Credenciales OAuth2 con refresh** (Etsy, Shopify — ambas usan OAuth2 en su API real): el `access_token` caduca en horas y se renueva automáticamente con un `refresh_token`. Esto **no puede vivir solo en `.env`** — algo tiene que escribir el token renovado en algún sitio, automáticamente, sin intervención humana, potencialmente varias veces al día.

Diseñar un único mecanismo para ambos fuerza una mala solución en uno de los dos casos. Se diseñan como dos piezas relacionadas, no una.

#### Alternativas

**A. Todo en `.env`, sin excepción** (lo que hay hoy, extendido a más variables)
- Ventajas: cero superficie nueva, cero cifrado que gestionar, ya es el patrón establecido.
- Inconvenientes: no resuelve el caso OAuth (no hay dónde escribir el token renovado sin editar el fichero por código, algo que ya se prohibió explícitamente). No escala bien más allá de un puñado de claves — cada integración nueva exige acceso a fichero, en local y en el VPS.

**B. Todos los secretos cifrados en SQLite, el Wizard los escribe vía formulario**
- Ventajas: autoservicio completo — pegar clave, probar conexión, listo, sin tocar ficheros ni SSH al VPS.
- Inconvenientes: **contradice tu instrucción explícita** ("el Wizard nunca debe escribir directamente... mediante HTTP" — esto se extiende en espíritu a cualquier escritura de secretos vía HTTP, no solo al fichero `.env` literal). Además introduce un problema circular real: para cifrar secretos en BD hace falta una clave maestra, y esa clave maestra tiene que vivir en algún sitio — vuelve a ser `.env`, solo que ahora protegiendo algo más grande. Más superficie de ataque (la BD, que hoy no contiene ningún secreto, pasaría a contenerlos todos) sin resolver el problema, solo moverlo.

**C. Híbrido — estáticos en `.env` (nunca escritos por la app), OAuth en una tabla cifrada nueva (escrita solo por el propio backend, nunca por una request que reciba un valor pegado por un humano)**
- Ventajas: respeta la instrucción al pie de la letra sin excepción para el caso estático (que es la mayoría de los secretos). Resuelve el caso OAuth de la única forma que realmente funciona (renovación automática necesita almacenamiento que la app pueda escribir sola). El cifrado se limita a lo que de verdad lo necesita — no cifra `OPENROUTER_API_KEY` innecesariamente.
- Inconvenientes: dos mecanismos en vez de uno — más superficie conceptual que memorizar. Se mitiga con un único punto de entrada (`GET /api/secrets`) que presenta ambos de forma uniforme de cara al Wizard, aunque por debajo funcionen distinto.

#### Decisión para Hokage OS: C

### Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│  secret_definitions (SQLite) — METADATA, nunca valores           │
│  id · label · kind ('static_env' | 'oauth2') · env_var           │
│  required · docs_url · last_validated_at · last_validation_ok    │
└─────────────────────────────────────────────────────────────────┘
        │ kind='static_env'                    │ kind='oauth2'
        ▼                                       ▼
┌───────────────────────┐          ┌─────────────────────────────────┐
│  process.env (.env)   │          │  oauth_tokens (SQLite, cifrado)  │
│  el operador lo edita │          │  access_token_enc · refresh_..   │
│  a mano, siempre      │          │  expires_at · scope              │
└───────────────────────┘          │  escrito SOLO por el propio      │
                                    │  backend (callback OAuth +       │
                                    │  refresco silencioso)            │
                                    └─────────────────────────────────┘
```

#### 1. Definiciones — código, no formulario

Cada integración declara qué secretos necesita **donde ya vive su propio código** (mismo principio que el contrato de `Tool`, §8.2 — nunca un formulario genérico desconectado de quién realmente consume la clave):

```typescript
// tools/index.ts, junto a cada Tool
export const EtsyTool_secrets: SecretDefinition[] = [
  { id: 'etsy_oauth', label: 'Etsy (OAuth)', kind: 'oauth2',
    docsUrl: 'https://www.etsy.com/developers/register',
    validate: async () => { /* llamada de lectura mínima a la API de Etsy */ } },
];
```

Al arrancar, `initSchema()` sincroniza estas definiciones con la tabla `secret_definitions` (`INSERT OR REPLACE`, igual patrón que ya sincroniza `agents.model` contra `agentModels.ts` en cada boot) — **la tabla nunca diverge de lo que el código realmente espera**, porque se regenera de la fuente de verdad cada vez.

#### 2. Secretos estáticos — `.env`, sin excepción

`env_var` apunta al nombre de la variable (`OPENROUTER_API_KEY`, `GITHUB_PAT`...). El backend solo **lee** `process.env[env_var]` para saber si está presente — **nunca la escribe, nunca la recibe por HTTP.** Si el Wizard necesita esta clave, el flujo es exactamente el ya fijado: instrucción textual + botón "ya lo añadí, verificar conexión", que dispara `validate()` server-side contra el valor que el proceso ya tiene cargado en memoria — el navegador nunca envía ni recibe el valor de la clave en ningún momento.

#### 3. Credenciales OAuth2 — la única excepción real, y por qué no rompe la regla

Etsy y Shopify exigen el flujo estándar OAuth2: el usuario autoriza en la web del proveedor, que redirige de vuelta con un `code` de un solo uso. **Ese `code` sí llega por HTTP — es inevitable, es cómo funciona OAuth2 en todo el ecosistema** — pero es categóricamente distinto de "el Wizard te deja pegar tu API key en un campo de texto": el `code` no es la credencial, es un ticket de un solo uso que el backend intercambia server-to-server por los tokens reales. El usuario nunca ve ni transmite el secreto en sí.

```
Jorge → GET /api/secrets/etsy_oauth/oauth/start   (requireAdmin)
      → redirect a Etsy con client_id + redirect_uri
Etsy  → el usuario autoriza
      → redirect a GET /api/secrets/etsy_oauth/oauth/callback?code=...
Backend → intercambia code por access_token + refresh_token (llamada server-to-server)
        → cifra ambos (AES-256-GCM, clave en OAUTH_ENCRYPTION_KEY del .env)
        → guarda en oauth_tokens
        → nunca los expone de vuelta al navegador
```

`OAUTH_ENCRYPTION_KEY` es en sí misma un secreto estático — vive en `.env`, protege solo esta tabla. Es cifrado con alcance mínimo (solo lo que de verdad rota y hay que persistir), no cifrado del sistema entero — coherente con no sobre-construir.

**Renovación:** cuando un Tool que necesita el token lo pide (`oauthTokenService.getValidAccessToken('etsy_oauth')`), el servicio comprueba `expires_at`; si está vencido, usa el `refresh_token` para pedir uno nuevo a Etsy, lo re-cifra y actualiza la fila — transparente para el Tool, que nunca sabe si hubo renovación.

#### 4. Consumo — los Tools nunca gestionan secretos por su cuenta

- Secreto estático: el Tool lee `process.env.MI_VAR` directamente, igual que hoy.
- Secreto OAuth: el Tool llama a `oauthTokenService.getValidAccessToken(id)` y recibe el access token vigente, sin saber si hubo refresco.

Ninguna otra capa del sistema (agentes, rutas, frontend) toca un valor de secreto jamás — ni siquiera cifrado.

#### 5. Validación

Cada `SecretDefinition` declara un `validate()` opcional: una llamada de solo lectura mínima al proveedor (OpenRouter: comprobar créditos; Etsy: `getUser()`; GitHub: `GET /user`). `POST /api/secrets/:id/validate` (requireAdmin) la ejecuta y persiste `last_validated_at`/`last_validation_ok` en `secret_definitions` — es lo que enciende el botón "✓ Conectado" en el Wizard.

#### 6. API expuesta (toda `requireAdmin` salvo el callback)

```
GET  /api/secrets                     → [{ id, label, kind, required, present, last_validated_at, last_validation_ok }]
                                          (present = booleano; JAMÁS un valor)
POST /api/secrets/:id/validate        → dispara validate()
GET  /api/secrets/:id/oauth/start     → redirect al proveedor (solo kind='oauth2')
GET  /api/secrets/:id/oauth/callback  → recibe el `code`, intercambia, cifra, guarda (público — lo llama el proveedor, no Jorge; protegido por el `state` de OAuth, no por ADMIN_TOKEN)
```

`GET /api/secrets` es la fuente real detrás de lo que §12.1 (System Profile) ya prometía ("variables de entorno presentes, sin exponer valores") — ahora con estado de validación, no solo presencia.

#### 7. Desarrollo local vs VPS/producción

Estructuralmente idéntico — la única diferencia es cómo llega el fichero:

| | Local | VPS |
|---|---|---|
| Dónde vive `.env` | `backend/.env`, gitignored | `.env` en el servidor, nunca en el repo, copiado por Jorge (`scp`/editor SSH) |
| Cómo se aplica un cambio | Reiniciar `tsx` a mano | `pm2 restart hokage-backend` (§11.3) |
| `oauth_tokens` | Misma tabla SQLite, mismo fichero `.db` | Igual — viaja con el resto de la BD, ya cifrada en reposo |
| `OAUTH_ENCRYPTION_KEY` | Una en `.env` local (puede diferir de producción sin problema — son bases de datos distintas) | Una en `.env` del VPS, generada una vez, nunca reutilizada entre entornos |

**Regla dura:** `.env` nunca se commitea, nunca viaja por HTTP, nunca lo genera el Wizard — se mantiene un `.env.example` (sin valores, solo nombres + comentario, regenerado desde `secret_definitions` para que nunca quede desactualizado) como única ayuda automatizada.

#### Consecuencias a 2-3 años

Añadir una integración nueva (un Business Module completo, §8.4) es: declarar su `SecretDefinition` junto a su `Tool`, y listo — aparece sola en `GET /api/secrets`, el Wizard la detecta sin cambios propios. Si algún día se adopta MCP (§8.5), un servidor MCP que necesite credenciales usa exactamente el mismo mecanismo — no hace falta un tercer sistema. El único coste real que se paga por adelantado es la tabla `oauth_tokens` cifrada — pequeña, acotada, justificada por un problema real (rotación automática) y no por "cifrar por si acaso".

### 11.3 VPS y despliegue

🔒 **CONGELADO**, ya bien decidido en `ARCHITECTURE.md §11` y `Roadmap.md`: Hetzner CX22, PM2 (proceso vivo + reinicio automático — resuelve el problema de "el runtime no sobrevive reinicios" señalado en §2), Nginx + Certbot, SQLite ahora, PostgreSQL cuando se supere ~2 negocios activos o 10 agentes (umbral ya fijado en `Roadmap.md`, se ratifica). No requiere ninguna decisión nueva — solo ejecución, pendiente de que Jorge cree el servidor.

---

## 12. Configuración inicial: Wizard, Founder Profile, System Profile

🆕 **DECISIÓN NUEVA** — ninguno de estos tres conceptos existía antes de este documento. Se definen aquí por primera vez, y su definición es la pieza que faltaba para poder diseñar el Wizard en una sesión futura.

### 12.1 System Profile

Snapshot de configuración de **esta instalación concreta** de Hokage OS — no de Jorge, no de un negocio. Responde: ¿qué integraciones están conectadas?, ¿qué agentes están activos/pausados?, ¿qué límites de presupuesto rigen?, ¿es un entorno de desarrollo o producción?

No es una tabla nueva — es una **vista de solo lectura sobre datos que ya existen**: `agents.status`, `departments.active`, `agent_budgets`, y el estado de secretos que ya expone `GET /api/secrets` (§11.2 — presencia y validación, nunca valores). Se expone como un único endpoint (`GET /api/system/profile`) que agrega estas fuentes. **Es exactamente lo que un Wizard necesita leer al arrancar para no volver a preguntar algo que ya se sabe.**

### 12.2 Founder Profile

Datos estructurados sobre Jorge que Hokage (el agente CEO) usa para personalizar su razonamiento estratégico — objetivos personales, tolerancia al riesgo, estilo de comunicación preferido, lecciones de negocios anteriores. Es la contraparte "humana" del Knowledge System (§6): mientras `knowledge_entries` (cuando exista) guarda hechos sobre *negocios*, el Founder Profile guarda hechos sobre *el fundador*.

**v1: una tabla simple `founder_profile` (key-value, igual patrón que `agent_memory`, sin necesidad de nada más sofisticado)**, poblada la primera vez que el Wizard de primer arranque hace sus preguntas ("¿cuál es tu objetivo económico?", "¿cuánto riesgo estás dispuesto a asumir?"), y ampliable después desde una conversación normal con Hokage — no hace falta un formulario dedicado más allá del arranque inicial.

### 12.3 Setup Wizard — alcance definitivo

Dado que este es exactamente el punto que quedó abierto antes de este documento, se fija aquí una decisión definitiva en vez de dejarlo pendiente:

**El Wizard son dos flujos separados que comparten infraestructura, no uno solo:**

1. **Fresh Install Wizard** — se dispara la primera vez que arranca un Hokage OS sin `founder_profile` poblado. Pide: nombre, objetivo económico inicial (alimenta el primer `Objective` del Goal System), confirmación de los 8 agentes por defecto (nombre/modelo se pueden dejar por defecto o tocar ahí mismo — reutiliza `ConfigView`, no construye nada nuevo). Termina creando el primer `venture`.
2. **New Venture Wizard** — disponible en cualquier momento desde `ConfigView` o el menú principal. Crea un `venture` nuevo, opcionalmente un `Objective` con `venture_id` (requiere §3 resuelto), y pregunta si algún canal (§8.4) necesita configurarse.

**Bloqueante explícito antes de construir el flujo 2: §3 debe estar resuelto** (los 3 puntos de implementación mínima) — si no, "crear un segundo venture" crea una fila huérfana que ningún agente sabrá usar, exactamente el riesgo que motivó este documento entero.

**El flujo 1 se puede construir ya, sin esperar a §3** — no depende de multi-venture, solo de que exista `founder_profile` (tabla nueva, trivial) y de reutilizar lo que ya existe (`ConfigView`, `POST /api/ventures`).

---

## 13. Frontend: Mapa, HUD, Terminal, las 7 vistas

🔒 **CONGELADO** el diseño y la mayor parte de la implementación — verificado en vivo, no solo leído en docs.

### Mapa (World Engine)

`FRONTEND_WORLD_ENGINE.md` describe 7 fases; el estado real verificado hoy **ya supera lo que el propio documento marca como "pendiente"**: Fase 2 (cámara libre: pan, zoom, minimapa) está implementada y confirmada en `WorldCanvas.tsx` pese a que el documento la marca como "siguiente". Fase 3 (departamentos como datos) está hecha. Fase 4 (agentes con estado visual real — `activityLevel`, `hasError`) está hecha. Fase 5 (eventos reales → animación) está parcialmente hecha (salas "respiran" según actividad real, hay ripples). **Acción de bajo coste, no bloqueante: actualizar la tabla de fases de ese documento a la realidad — está desactualizada, no incorrecta en su diseño.**

### HUD

`GameHUD.tsx` — barra superior persistente. Tras la limpieza de esta sesión ya no muestra nada decorativo: agentes conectados, alertas (con pulso visual si hay una urgente — riesgo alto, importe, o +24h esperando), mensajes, coste de IA de hoy, objetivos activos, crew, acceso a configuración. Cada número mostrado tiene una consulta real detrás — ninguno es estático. Esta es la barra de invariantes: **cualquier tile nueva que se añada aquí debe pasar la misma regla — si el dato no cambia con el estado real del backend, no entra al HUD.**

### Terminal

Es la UI de Hermes (§9), no un concepto de frontend independiente — pausada junto con el agente. `TerminalPanel.tsx` ya construido: historial de comandos con estado, stdout/stderr, exit code.

### Las 7 vistas

Confirmado en el tipo `Screen` real: **Mapa, Crew, Alertas, Comms, Ventures, Objetivos, Config.** (`boot`, `menu` y `building` son pantallas de transición/detalle, no vistas de primer nivel — de ahí que sean 7 y no 10.) Cada una sigue el mismo patrón: overlay sobre el mapa, nunca una navegación que abandone el mundo vivo. **Regla que se congela: una vista nueva se añade a este mismo patrón de overlay — nunca como una ruta/pantalla separada del mapa.**

---

## 14. Escalabilidad

🔒 **CONGELADO**, síntesis de los umbrales ya fijados en distintos puntos de este documento y de `Roadmap.md`:

| Límite conocido | Umbral | Qué hacer al llegar |
|---|---|---|
| SQLite → PostgreSQL | 2+ negocios activos simultáneos o 10+ agentes | Ya decidido en `Roadmap.md`, sin trabajo adicional de diseño |
| Scheduler centralizado → distribuido | Cola con latencia perceptible, decenas de agentes | Revisitar §2 — no antes |
| Roles de agente: código → datos | El día que se pida un rol nuevo sin tocar TypeScript | Revisitar §4 — no antes |
| Memoria por-agente → Knowledge System compartido | 3+ ventures con historial real que comparar | Revisitar §6 — no antes |
| Tool interface propio → MCP | Integraciones externas > ~15-20 | Revisitar §8.5 — no antes |
| Permisos single-owner → multi-usuario | Un segundo fundador usa Hokage OS | Revisitar §11.1 — no antes |

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

Arquitectura en capas del Core · Runtime/Scheduler/Event Bus · Contrato de Tool como sistema de plugins · Diseño de plugins visuales del mapa · Papel exclusivo de Hermes para ejecución de sistema · Modelo de economía (agent_costs/agent_budgets/ventures) · VPS y despliegue · Diseño del World Engine y las 7 vistas · **Modelo multi-venture, implementado y verificado** (§3) · **Sistema de permisos single-owner sin hardcode** (§11.1, implementado) · **Arquitectura de gestión de secretos** (§11.2 — estáticos en `.env` nunca escritos por la app, OAuth2 en tabla cifrada escrita solo por el propio backend).

### Decidido aquí por primera vez (🆕)

Definición de Business Module (composición, no mecanismo nuevo) · Postura sobre MCP (no adoptar en v1, dejar la puerta abierta — sus credenciales usarían el mismo mecanismo de §11.2 el día que se adopte) · Founder Profile y System Profile (qué son, cómo se construyen) · Alcance definitivo del Setup Wizard (dos flujos: Fresh Install + New Venture) · Postura sobre Knowledge System (diseño C, no construir todavía) · Arquitectura completa de Secret Management (definiciones como código sincronizadas a BD, estáticos vs OAuth2, la excepción legítima del callback OAuth explicada).

### Ya no queda ninguna decisión ⚠️ pendiente de confirmación

Las tres del cierre anterior — multi-venture, permisos, secretos — están confirmadas y las dos primeras ya implementadas. Secretos queda especificado pero **no implementado todavía** (este documento es solo el diseño, tal como se pidió).

### Bloqueante real para el Setup Wizard

El **Fresh Install Wizard** se puede diseñar y construir ya. El **New Venture Wizard** ya no está bloqueado por el modelo multi-venture (§3, resuelto) — el único trabajo previo real que le queda es implementar §11.2 (`secret_definitions`, `oauth_tokens`, las rutas de `/api/secrets`) si el primer venture nuevo necesita conectar un canal con credenciales propias.
