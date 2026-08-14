# ADR-007 — AgentRuntimeState
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado (2026-08-13)
> Sintetizado desde [[BLOQUE_0_DECISIONES_FUNDACIONALES]] §A (y [[HOKAGE_WORLD_ENGINE_SPEC]] §3) — cierre del Bloque 0.

---

## Contexto

El frontend **inventaba** el estado del mundo (`useWorldState.ts`: `setInterval`+`Math.random()`, heurísticas de tiempo) porque el backend **no expone un estado de ciclo de vida por agente**. Sin ese contrato, el World Engine no puede ser real (C5 de la [[Auditoría de Arquitectura - 2026-08-13]]).

## Decisión

Se define `AgentRuntimeState` como **proyección derivada** en el backend (fuente de verdad), no persistida como tabla mutable:

- **Estado primario** (enum cerrado): `IDLE·THINKING·RESEARCHING·WORKING·WAITING·REVIEWING·COMMUNICATING·MOVING·COMPLETED·ERROR`.
- **Modificadores** concurrentes (flags de fondo): `awaitingApproval·hasError·blocked·reviewing` — resuelven condiciones simultáneas (trampa **L1**: un enum plano no representa "WORKING **y** con decisión pendiente").
- **`currentTask`** (workItemId, kind, tool, startedAt), `activity` 0..1 derivado de señales reales, `ventureId`, `since`, `updatedAt`, `source:'runtime'`.
- **Derivado** de `work_items`/`agent_runs`/`decisions` + `activeAgents` (trampa **L6**: persistir sería una 2ª fuente de verdad). Estados de conexión `UNKNOWN·STALE` son de la capa de proyección del frontend, no del agente.
- Transporte: eventos `agent.state.changed`/`agent.modifier.changed` por el Event Bus → WebSocket (snapshot + deltas).
- Reinicio: se recalcula desde tablas durables + reconciliación de `in_progress` huérfanos. Desconexión: STALE, nunca inventar. Error: dispara la escalera de remediación (ADR-010).

## Alternativas consideradas

- **Enum plano** — descartada: no expresa concurrencia (L1).
- **Tabla mutable `agent_runtime_state`** — descartada: drift + segunda fuente de verdad, viola las 5 capas de [[HOKAGE_WORLD_ENGINE_SPEC]] (L6).
- **Event-sourcing puro** — descartada: sobreingeniería para v1; si hace falta histórico de transiciones se añade un log **append-only** (como `event_log`).

## Consecuencias

Estado fiel al Runtime, reconstruible tras reinicio, sin invención. Un agente/capacidad nueva añade un modificador o primario sin romper el contrato. El World Engine mapea primario→visual y modificador→badge. Riesgo aceptado: la granularidad de `activity`/transiciones depende de la instrumentación del runtime — afinable, no bloqueante. Disparador de revisión: si surge necesidad real de histórico de estados → añadir log append-only.

## Relacionado

- [[BLOQUE_0_DECISIONES_FUNDACIONALES]]
- [[HOKAGE_WORLD_ENGINE_SPEC]] · [[HOKAGE_AGENT_OPERATING_MODEL]]
- [[Resumen Ejecutivo - Decisiones Congeladas]] · [[INDEX]]
