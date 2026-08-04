> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §2. Congelado.

## Runtime, Scheduler y Sistema de eventos

🔒 **CONGELADO** — el diseño real (verificado en `agentRuntime.ts`) diverge del [[ARCHITECTURE (legacy)]] §5 original (que describía un scheduler con "8 etapas" más elaborado, con locking TTL configurable por tabla `work_items` con más columnas). Lo que existe y funciona hoy:

### Runtime

Un único `AgentRuntime` (`config/agentRuntime.ts`) con un tick de **poll cada 10s**, no un scheduler por-agente con timers independientes. Cada tick ejecuta, en orden fijo:

1. Drenar eventos del bus → crear `work_items` según `automations` activas.
2. Asignar trabajo: agentes con `agent_schedules` vencido → nuevo `work_item` autónomo. Bloquear `pending` → `in_progress` (máx 5 por tick, respetando presupuesto).
3. Ejecutar hasta 3 `work_items` `in_progress` → llamar al LLM → persistir resultado.
4. Comprobar TTLs expirados → devolver a `pending` o cancelar tras 3 reintentos.
5. Cerrar el loop de decisiones aprobadas sin ejecución pendiente.
6. Métricas + auto-expirar decisiones de +48h.

**Esto sobrevive reinicios de forma parcial**: `agent_schedules.next_run_at` persiste en SQLite (no en memoria), así que un reinicio no pierde el timer — pero el propio bucle de polling (`setTimeout` recursivo) sí se detiene si el proceso muere, y no hay supervisor de proceso todavía (ver [[Seguridad, Permisos y VPS]] §11.3).

### Scheduler — decisión de diseño

**Elegido:** poll centralizado cada 10s sobre una cola en SQLite (`work_items`), no un timer por agente. Alternativas descartadas:
- *Timer independiente por agente* (`setInterval` por rol): es lo que había en versiones anteriores del proyecto (mencionado en `docs/prompts/INIT_PROMPT.md`, ver [[Prompts Históricos - INIT_PROMPT|INIT_PROMPT histórico]]) — se abandonó porque no daba visibilidad de cola ni permitía priorización cruzada entre agentes.
- *Cron externo (node-cron, Bull/Redis)*: exceso de infraestructura para el volumen actual (8 agentes, ciclos de 15-60 min). Se revisita solo si el número de agentes crece a decenas o si se necesita distribuir el runtime entre varios procesos (ver [[Escalabilidad]]).

**Consecuencia a 2-3 años:** un poll de 10s con hasta 5 asignaciones y 3 ejecuciones por tick tiene techo natural alrededor de un par de docenas de agentes activos simultáneos antes de que la latencia de cola se note. Ese es el límite conocido y aceptado para v1 — no se over-diseña un scheduler distribuido que hoy no hace falta.

### Regla permanente — `AgentRuntime` es la única autoridad de tareas periódicas

🔒 **CONGELADO.** Añadida en la auditoría de arquitecto del 2026-08-05 (Hallazgo 3): ningún sistema crea su propio `setInterval`/poller independiente. Todo proceso periódico — sincronización de [[Economía v2 - Sistema Financiero|Economía v2]], futuras integraciones, mantenimiento, limpieza — se registra en `AgentRuntime` mediante una interfaz común (una etapa más de su tick, o un registro de "jobs" del que `AgentRuntime` es el único disparador), nunca como un timer paralelo.

**Por qué:** es exactamente el antipatrón que ya se rechazó una vez para el scheduling por-agente ("timer independiente por agente... se abandonó porque no daba visibilidad de cola ni permitía priorización cruzada"). Varios timers independientes escribiendo en SQLite sin coordinación arriesgan contención de escritura (`SQLITE_BUSY`) y pierden la visibilidad de cola única que motivó centralizar el scheduler en primer lugar.

**Consecuencia:** cuando se implemente el `FinanceSyncService` de [[Economía v2 - Sistema Financiero|Economía v2]] (hoy solo diseñado), no nace como un `setInterval` propio — se integra en el tick de `AgentRuntime`. Esta regla gobierna cualquier proceso periódico futuro, no solo ese caso.

### Contraste contra investigación previa del proyecto (nuevo en esta ronda)

[[Prison Architect - Arquitectura de Sistemas Complejos|Prison Architect]] y [[RimWorld - Arquitectura de Simulación|Rimworld]] son investigación real, ya existente en el repo, nunca cruzada contra esta sección hasta ahora — un fallo de la v1 de este documento, no una omisión consciente. Contrastadas contra el código real:

| Recomendación investigada | Estado |
|---|---|
| R1 — evento genera work item directamente | ✅ Ya implementado (`stage1_drainBusEvents`) |
| R2 — locking In-Progress con TTL | ✅ Ya implementado (`locked_at`/`ttl_minutes`) |
| R3 — prioridades explícitas en cola | ✅ Ya implementado (`work_items.priority`) |
| R4 — dos umbrales de salud del agente | ✅ Ya implementado (`agent_budgets` 80%/100%) |
| R5 — verificar que el agente tiene las tools antes de asignar | ❌ No implementado — gap real, pequeño, no bloqueante |
| R6 — aging de work items (starvation) | Correctamente diferido — "cuando la cola tenga volumen real" |
| R7 — overlays de datos activables en el mapa | ❌ No implementado — ver [[Frontend - Decisiones v2]], ahora sí incorporado al documento |

R1-R4 confirman que el Runtime ya sigue, sin que se supiera explícitamente hasta hoy, patrones investigados con rigor. R5 y R7 quedan anotadas como deuda de diseño conocida, no crítica.

### Sistema de eventos (Event Bus)

**Contrato inquebrantable, ya eliminado el único punto que lo violaba (`addEvent()`, código muerto borrado esta sesión):** el bus (`HokageBus extends EventEmitter`) es **estrictamente en memoria**, con un `history[]` de las últimas 100 entradas. Nunca escribe a SQL. Si el proceso reinicia, el historial de eventos se pierde — eso es aceptado por diseño (la verdad de fondo vive en las tablas de dominio: `decisions`, `work_items`, `messages`, no en el log de eventos).

Vocabulario cerrado de eventos (`AgentEventType` en `eventBus.ts`): `trend.detected`, `content.created`, `content.ready`, `decision.created/approved/rejected`, `sale.made`, `alert.triggered`, `agent.task.start/done/error`, `report.daily`, `system.error`, `objective.created/approved/achieved`. Añadir un evento nuevo es añadir un valor al union type — nunca un canal nuevo.

**Regla dura:** cualquier reacción visual a un evento (ver [[Frontend - Decisiones v2]], Mapa) se define como tabla de reacciones, nunca como `if`/`switch` disperso. Esto ya estaba bien diseñado en [[Frontend World Engine]] §3.3 y sigue siendo la decisión correcta, aunque el "Animation Director" formal descrito ahí no se ha extraído todavía como módulo — hoy vive, parcialmente, como lógica ad-hoc en `useWorldState.ts`. **Deuda reconocida, no bloqueante.**

### De marcadores de texto a Tool Calling — decisión de esta ronda

🔒 **CONGELADO.** Encontrado en la auditoría crítica final pre-lanzamiento ([[Resumen Ejecutivo - Decisiones Congeladas|§16]] — "un problema encontrado, no cero") y aceptado por Jorge sin reservas.

**El problema, verificado en código:** todo efecto estructurado que un agente dispara — crear una `Decision`, reportar una tendencia, registrar contenido creado, escribir en `agent_memory` — pasa hoy por `agentRuntime.ts` líneas 208-251 buscando patrones `[DECISION: ...]`, `[TENDENCIA: ...]`, `[CONTENIDO: ...]`, `[MEMORIA: ...]` sobre el texto libre de la respuesta del LLM, con `matchAll`/`match`. **Esto convive, en el mismo codebase, con un mecanismo estrictamente mejor que ya funciona:** `aiService.ts` implementa function-calling real de OpenRouter (`tool_calls`, `registry.execute()`) para `system.exec`, `google.trends`, `web.browser`. Un marcador mal formateado no genera error ni log — el efecto simplemente no ocurre, sin traza. [[Memory System|§6]] (Memory System v2) iba a añadir un quinto marcador (`[APRENDIZAJE: ...]`) sobre el mismo patrón frágil, justo cuando se estaba a punto de construir más encima.

**Decisión:** los 4 marcadores existentes se migran a Tools reales sobre el mecanismo de function-calling ya construido (ver [[Plugin System - Arquitectura Completa]] §8.2) — no se inventa infraestructura nueva, se deja de tener dos caminos donde debe haber uno. El futuro `[APRENDIZAJE: ...]` de [[Memory System|§6]] nace directamente como tool (`memory.remember`, distinta de `memory.write` — ver esa nota para el porqué de separarlas), nunca como marcador nuevo.

**Hallazgo que corrige el orden inicial, verificado en `agentModels.ts`:** no todos los agentes pueden migrar. `TOOL_CAPABLE_MODELS` excluye explícitamente `meta-llama/llama-3.1-8b-instruct` ("no soporta tools de forma fiable") — el modelo real de `operaciones` y `soporte`. `MEMORIA` y `DECISION` los emite, en teoría, cualquiera de los 8 roles (van en el bloque genérico de instrucciones que se añade a toda tarea); `TENDENCIA` y `CONTENIDO` los emite en la práctica un único rol cada uno (`investigador` y `contenido`), ambos en modelos tool-capable. Consecuencia: `TENDENCIA` y `CONTENIDO` se pueden retirar del todo (regex borrado, cero rastro); `MEMORIA` y `DECISION` **no** — para `operaciones`/`soporte` el marcador de texto sigue siendo, permanentemente, el único camino posible mientras sigan en Llama 3.1 8B. Eso no es una limitación de la migración, es una realidad del modelo — se deja anotada aquí en vez de disimulada como "fallback temporal".

**Migración incremental, no reescritura.** Plan detallado entregado y confirmado con Jorge fuera de este documento; resumen operativo:

| Orden | Marcador → Tool | Por qué en esta posición | Retirada del regex |
|---|---|---|---|
| 1 | `[TENDENCIA: ...]` → `trend.report` | Un único rol (`investigador`, tool-capable) — valida el patrón base sin la complejidad del split de modelos. | Total, una vez verificado |
| 2 | `[CONTENIDO: ...]` → `content.create` | Un único rol (`contenido`, tool-capable, familia de modelo distinta a la de #1) — segunda prueba del patrón. | Total, una vez verificado |
| 3 | `[MEMORIA: k=v]` → `memory.write` | Bajo radio de impacto (privado, invisible para Jorge) pero primero en exigir el diseño de doble camino permanente (6 roles a tool, 2 a regex). | Parcial — permanece para `operaciones`/`soporte` |
| 4 | `[DECISION: ...]` → `decision.create` | Mayor superficie y el más visible para Jorge (alimenta Alertas) — se migra último, reutilizando el patrón de doble camino ya probado en #3. | Parcial — permanece para `operaciones`/`soporte` |

**Compatibilidad hacia atrás durante la transición (obligatoria, no opcional):** al migrar cada marcador, el tool nuevo se añade y el prompt del rol correspondiente se actualiza para pedir la tool en vez del marcador — pero **el parseo regex del marcador viejo no se borra todavía**. Ambos caminos conviven. Solo se retira el regex de ese marcador, para los roles tool-capable, cuando se verifique en `agent_runs`/`work_items` reales un número de invocaciones correctas consecutivas por tool call (no por marcador) — nunca antes. Para `operaciones`/`soporte` el regex de `MEMORIA`/`DECISION` no se retira nunca mientras sigan en un modelo sin tool-calling. Un módulo (= un marcador) completo, verificado y commiteado antes de pasar al siguiente, igual que el resto de este proyecto.

**Regla permanente añadida por Jorge al aceptar el plan, no limitada a esta migración:** a partir de esta decisión, ningún sistema nuevo puede introducir un mecanismo alternativo de comunicación estructurada entre agentes y runtime. Toda acción estructurada (crear una fila, disparar un evento, pedir aprobación) pasa por Tool Calling — nunca por un nuevo formato de texto libre parseado a mano. Esto gobierna, en concreto, el futuro Memory System v2 ([[Memory System]], ya alineado: `memory.write` nace como tool) y cualquier Business Module ([[Plugin System - Arquitectura Completa]] §8.4) que necesite que un agente dispare un efecto nuevo.

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
3. **Threading por venture:** verificado que **no hay regresión porque no había nada que regresar** — el `venture_id` de las decisiones creadas por marcador tampoco se thread hoy (el contexto de venture es solo un prefijo de texto `[VENTURE: nombre]` en el prompt, nunca un campo estructurado que llegue a `AgentTask`/`ToolContext`, ver [[Modelo Multi-Venture]]). `decision.create` preserva exactamente ese mismo estado — ni mejor ni peor que el marcador. Cerrar esto de verdad es trabajo de [[Modelo Multi-Venture]], no de esta migración.
4. **`operaciones`/`soporte` siguen compatibles:** confirmado con datos históricos (32 y 18 decisiones ya creadas por esos roles vía marcador, en su ciclo autónomo normal, sin tocar) más inspección de código — el bloque de formato solo deja de ofrecer `[DECISION: ...]` a los roles con `decision.create` en `AGENT_TOOLS`, y esos dos roles tienen la lista vacía.

**Hallazgo real, detenido y corregido antes de cerrar la fase, tal como pidió Jorge:** el regex viejo capturaba automáticamente los primeros 300 caracteres de la respuesta completa como `description` — Jorge siempre tenía contexto en Alertas, aunque el agente no "pensara" en escribirlo. La primera versión de `decision.create` tenía `description` como campo **opcional** — en la verificación, una decisión creada sin descripción explícita quedó con `description = NULL`, una regresión real de información respecto al marcador. **No es una limitación de Tool Calling como mecanismo** — es que una tool no tiene "texto libre alrededor" que capturar gratis; cualquier campo que antes acompañaba al marcador sin que el agente lo pidiera ahora hay que exigirlo explícitamente en el schema. **Fix:** `description` pasa a ser **obligatorio** en el input de la tool. Efecto colateral verificado y positivo, no solo neutro: con el campo obligatorio, `ceo` (Sonnet 4.5) rechazó crear una decisión de prueba deliberadamente vacía de contexto ("una decisión sin descripción clara es ruido, Jorge no puede aprobar algo que no entiende el porqué") y, al dársele contexto real, produjo una `description` más útil y mejor estructurada que el recorte crudo de 300 caracteres que daba el regex. **Regla general para cualquier Tool futura:** antes de dar por migrado un marcador, listar qué campos venían "gratis" del texto libre alrededor (contexto, tono, detalle) y decidir explícitamente si el schema de la tool los hace obligatorios — nunca asumir que se rellenan solos.

**Estado real de la migración al cerrar la Fase 4 — honesto, no optimista:** las 4 tools existen, están conectadas, y los 6 roles tool-capable ya no reciben la instrucción del marcador correspondiente en el prompt. **Pero el regex de compatibilidad no se ha borrado de ningún marcador todavía** — cada fase se verificó con 1-3 ejecuciones manuales reales, no con el criterio completo fijado en el plan ("N ejecuciones autónomas consecutivas reales, sin caída al marcador"). Retirar el regex de `TENDENCIA`/`CONTENIDO` (los dos que pueden quedar en cero rastro) es una decisión aparte, deliberadamente no tomada aquí — se recomienda dejar correr el sistema en ciclo autónomo real un tiempo antes de borrar la red de seguridad, y retirar entonces con datos de producción, no de verificación manual.

**Verificado con ejecución real:** tool en `ceo` (id 1) y combinación `content.create`+`decision.create` en `contenido` (id 3) en el mismo turno — ambas con log propio, fila real, evento del bus y automation disparada. Datos de prueba limpiados de la BD tras cada verificación.

**Consecuencia si no se hace:** cada sistema nuevo (Memory System, Business Modules, paneles por sala) seguiría el reflejo de "añadir un marcador más" en vez de "añadir un tool" — la migración se volvería más cara cuanto más se tardara.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Núcleo - Arquitectura del Core]] — capas backend que este sistema implementa
- [[Memory System]] — hereda directamente el mecanismo de Tool Calling fijado aquí
- [[Plugin System - Arquitectura Completa]] — contrato de Tool (§8.2) referenciado en toda esta nota
- [[Modelo Multi-Venture]] — threading de `venture_id` pendiente, mencionado en Fase 4
- [[ADR-002 - Agent Runtime]] · [[ADR-003 - Event Bus]]
- [[Escalabilidad]] — umbral de cuándo revisitar el scheduler centralizado
