> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §7. Congelado.

## Automatizaciones (agente → agente)

🔒 **CONGELADO** — ya es real, probado, con CRUD completo construido esta sesión (`PUT`/`DELETE /api/automations/:id`, formulario en `VenturesView`).

Modelo: tabla `automations` (`trigger_event → action_agent_role`, con `action_context_template` y `requires_approval`), consumida por `agentRuntime.ts` stage1. Es el mecanismo real de "un agente dispara a otro" — no hay ni debe haber un segundo mecanismo paralelo.

**Deuda reconocida, no bloqueante:** `automations.venture_id` existe y se escribe, pero ningún formulario ofrece elegir un venture (ver [[Modelo Multi-Venture]]). Hoy toda automation es implícitamente global. Se resuelve como efecto colateral de cerrar ese sistema, no como trabajo aparte.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Runtime, Scheduler y Event Bus]] — stage1 del runtime consume esta tabla
- [[Modelo Multi-Venture]] — deuda pendiente de `venture_id` en automations
