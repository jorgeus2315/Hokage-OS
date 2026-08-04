# ADR-003 — Event Bus
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado, implementado
> Sintetizado desde `HOKAGE_CORE_SPECIFICATION_v1.md` §2 — Fase 7 de la migración documental

---

## Contexto

Hokage OS necesita un mecanismo de comunicación entre el Runtime (backend) y el frontend, y entre agentes entre sí, sin acoplar directamente quién genera un evento con quién lo consume (§8, modelo mental: "Event Bus: sistema nervioso, conecta sin acoplar"). Existía un único punto que violaba el contrato de "solo memoria" — `addEvent()`, código muerto que escribía a SQL — eliminado en la sesión de limpieza previa a este documento.

## Decisión

**El bus (`HokageBus extends EventEmitter`) es estrictamente en memoria**, con un `history[]` de las últimas 100 entradas. Nunca escribe a SQL. Si el proceso reinicia, el historial de eventos se pierde — aceptado por diseño: la verdad de fondo vive en las tablas de dominio (`decisions`, `work_items`, `messages`), no en el log de eventos.

**Vocabulario cerrado de eventos** (`AgentEventType` en `eventBus.ts`): `trend.detected`, `content.created`, `content.ready`, `decision.created/approved/rejected`, `sale.made`, `alert.triggered`, `agent.task.start/done/error`, `report.daily`, `system.error`, `objective.created/approved/achieved`. Añadir un evento nuevo es añadir un valor al union type — nunca un canal nuevo.

**Regla dura:** cualquier reacción visual a un evento (mapa, §13) se define como tabla de reacciones, nunca como `if`/`switch` disperso. Ya especificado en `FRONTEND_WORLD_ENGINE.md §3.3` — el "Animation Director" formal todavía no se extrajo como módulo (deuda reconocida, ver [[ADR-001 - World Engine]]).

## De marcadores de texto a Tool Calling — decisión relacionada de esta misma sección

Encontrado en la auditoría crítica final pre-lanzamiento: todo efecto estructurado que un agente disparaba (crear una `Decision`, reportar una tendencia, registrar contenido, escribir en `agent_memory`) pasaba por `agentRuntime.ts` buscando patrones `[DECISION: ...]`, `[TENDENCIA: ...]`, `[CONTENIDO: ...]`, `[MEMORIA: ...]` sobre texto libre — un mecanismo estrictamente peor que el function-calling real de OpenRouter que ya funcionaba para otros tools. Un marcador mal formateado no generaba error ni log; el efecto simplemente no ocurría, sin traza.

**Decisión:** los 4 marcadores se migraron a Tools reales sobre el mecanismo de function-calling ya construido — `trend.report`, `content.create`, `memory.write`, `decision.create` — completado en 4 fases (2026-08-04), con compatibilidad hacia atrás obligatoria durante la transición. Detalle completo de la migración, incluidos los hallazgos reales de cada fase, en [[ADR-005 - Tool Runtime y Plugin Contract]].

**Regla permanente que nace de esta decisión:** ningún sistema nuevo puede introducir un mecanismo alternativo de comunicación estructurada entre agentes y runtime. Toda acción estructurada pasa por Tool Calling — nunca por un nuevo formato de texto libre parseado a mano.

## Consecuencias

- El bus permanece simple y desacoplado — cualquier módulo nuevo (frontend, agente, futuro plugin) puede suscribirse sin coordinación previa con el emisor.
- La pérdida de historial en cada reinicio es aceptable porque el bus nunca fue la fuente de verdad — pero cualquier feature futura que asuma persistencia del bus (p. ej. "reproducir eventos pasados") necesita un mecanismo distinto, no extender el bus.
- La regla de Tool Calling único cierra la puerta a que futuros sistemas (Memory System, Business Modules) reintroduzcan el patrón de marcador de texto — cualquier propuesta que lo haga contradice esta decisión explícitamente.

## Relacionado

- [[Runtime, Scheduler y Event Bus]]
- [[ADR-002 - Agent Runtime]]
- [[ADR-005 - Tool Runtime y Plugin Contract]]
- [[Resumen Ejecutivo - Decisiones Congeladas]]
- [[INDEX]]
