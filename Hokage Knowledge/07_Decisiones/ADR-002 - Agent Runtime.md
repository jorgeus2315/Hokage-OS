# ADR-002 — Agent Runtime
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado, implementado
> Sintetizado desde `HOKAGE_CORE_SPECIFICATION_v1.md` §2 — Fase 7 de la migración documental

---

## Contexto

Los agentes de Hokage OS necesitan ejecutarse de forma autónoma, con presupuesto acotado y sin bloquear el proceso principal. `ARCHITECTURE.md §5` (original) describía un scheduler más elaborado de "8 etapas" con locking TTL configurable. El código real (`agentRuntime.ts`), verificado directamente, diverge de ese diseño original — y esa divergencia es la decisión que se congela aquí.

## Decisión

**Un único `AgentRuntime` con poll centralizado cada 10s sobre una cola en SQLite (`work_items`)**, no un timer independiente por agente. Cada tick ejecuta, en orden fijo:

1. Drenar eventos del bus → crear `work_items` según `automations` activas.
2. Asignar trabajo: agentes con `agent_schedules` vencido → nuevo `work_item` autónomo. Bloquear `pending` → `in_progress` (máx. 5 por tick, respetando presupuesto).
3. Ejecutar hasta 3 `work_items` `in_progress` → llamar al LLM → persistir resultado.
4. Comprobar TTLs expirados → devolver a `pending` o cancelar tras 3 reintentos.
5. Cerrar el loop de decisiones aprobadas sin ejecución pendiente.
6. Métricas + auto-expirar decisiones de +48h.

`agent_schedules.next_run_at` persiste en SQLite, no en memoria — un reinicio no pierde el timer. Pero el propio bucle de polling (`setTimeout` recursivo) sí se detiene si el proceso muere, y no hay supervisor de proceso todavía (ver §11, VPS).

## Alternativas consideradas

**Timer independiente por agente** (`setInterval` por rol) — lo que existía en versiones anteriores del proyecto (`docs/prompts/INIT_PROMPT.md`, ver [[Prompts Históricos - INIT_PROMPT]]). Descartado: no daba visibilidad de cola ni permitía priorización cruzada entre agentes.

**Cron externo** (node-cron, Bull/Redis) — descartado por exceso de infraestructura para el volumen actual (8 agentes, ciclos de 15-60 min). Se revisita solo si el número de agentes crece a decenas o si se necesita distribuir el runtime entre varios procesos (ver [[Escalabilidad]]).

## Contraste contra investigación de motores de simulación

`docs/research/world-engine/prison-architect.md` y `rimworld.md` — investigación real del proyecto, nunca antes cruzada contra esta sección — se contrastaron contra el código real:

| Recomendación investigada | Estado |
|---|---|
| R1 — evento genera work item directamente | ✅ Ya implementado (`stage1_drainBusEvents`) |
| R2 — locking In-Progress con TTL | ✅ Ya implementado (`locked_at`/`ttl_minutes`) |
| R3 — prioridades explícitas en cola | ✅ Ya implementado (`work_items.priority`) |
| R4 — dos umbrales de salud del agente | ✅ Ya implementado (`agent_budgets` 80%/100%) |
| R5 — verificar que el agente tiene las tools antes de asignar | ❌ No implementado — gap real, pequeño, no bloqueante |
| R6 — aging de work items (starvation) | Correctamente diferido — "cuando la cola tenga volumen real" |
| R7 — overlays de datos activables en el mapa | ❌ No implementado — ver [[ADR-001 - World Engine]] |

R1-R4 confirman que el Runtime ya sigue, sin que se supiera explícitamente hasta esta auditoría, patrones investigados con rigor en [[RimWorld - Arquitectura de Simulación]] y [[Prison Architect - Arquitectura de Sistemas Complejos]]. R5 y R7 quedan anotadas como deuda de diseño conocida, no crítica.

## Consecuencias

Un poll de 10s con hasta 5 asignaciones y 3 ejecuciones por tick tiene techo natural alrededor de un par de docenas de agentes activos simultáneos antes de que la latencia de cola se note. Ese es el límite conocido y aceptado para v1 — no se sobre-diseña un scheduler distribuido que hoy no hace falta. Si el número de agentes crece a decenas, o el runtime necesita distribuirse entre procesos, esta es la señal para revisar cron externo (ver [[Escalabilidad]]).

## Relacionado

- [[Runtime, Scheduler y Event Bus]]
- [[ADR-003 - Event Bus]]
- [[ADR-005 - Tool Runtime y Plugin Contract]]
- [[RimWorld - Arquitectura de Simulación]]
- [[Prison Architect - Arquitectura de Sistemas Complejos]]
- [[Escalabilidad]]
- [[Resumen Ejecutivo - Decisiones Congeladas]]
- [[INDEX]]
