# HOKAGE OS — Master Spec (Referencia Maestra)

> Categoría: **referencia arquitectónica de alto nivel** — documento ápice del proyecto.
> Estado: 🆕 Vigente (2026-08-13) — consolida y **sustituye como ápice** a [[Especificación Funcional de Producto - v1]], [[Núcleo - Arquitectura del Core]] y `HOKAGE_CORE_SPECIFICATION_v1.md` (raíz). Esos siguen vivos como **deep-dives**; donde contradigan a este documento, prevalece este.
> Origen: preparación maestra (brief de Jorge, 2026-08-13), tras cerrar F12 + B.1. Fundado en la [[Auditoría de Arquitectura - 2026-08-13]] (código verificado; vive en el vault, redirect mínimo en raíz).
> Regla: este documento describe **qué ES el sistema** (invariantes y contratos), no cómo se secuencia el trabajo (eso es [[Master Roadmap - v1]]). No inventa decisiones: todo lo no implementado está marcado 🔜 PROPUESTO.

**Leyenda de estado:** ✅ implementado y verificado · 🟡 parcial · 🔜 propuesto (aún no existe) · 🔒 invariante · ⚠️ decisión abierta.

---

## Cómo leer este documento

Es el **mapa maestro**. Cada sección resume el contrato de un subsistema en pocas líneas y enlaza a su nota de detalle. Si buscas el "cómo" profundo de un sistema, sigue el wikilink. Si buscas "qué es verdad hoy vs. qué es objetivo", mira las etiquetas de estado. Un segundo modelo que entre después debe poder leer solo este documento y saber exactamente qué está construido y qué falta (§24 del brief).

---

## 1. Qué es Hokage OS

Hokage OS es un **sistema operativo de agentes de IA** para crear y desarrollar negocios digitales, representado como un **mundo vivo de gestión (tycoon/simulación)**. No es un dashboard ni un chatbot de comandos: es un sistema que piensa con Jorge, ejecuta mediante agentes autónomos y solo interrumpe cuando necesita una decisión humana real.

**Modelo mental (🔒 invariante):**
- **Backend = cerebro.** Toda la lógica y el estado viven aquí.
- **Frontend = proyección.** El mundo visual refleja estado real del backend; **nunca inventa datos ni lógica** (ver §18, §19).
- **Agentes = empleados** que trabajan aunque nadie mire.
- **Hokage = socio estratégico** que coordina.
- **Hermes = kernel/runtime** que ejecuta y observa.
- **Event Bus = sistema nervioso** que conecta sin acoplar.

Deep-dives: [[VISION]] · [[Núcleo - Arquitectura del Core]] · [[Especificación Funcional de Producto - v1]].

**Capas reales (✅):** `rutas (server.ts) → servicios (services/*) → db (db/init.ts)`, con `runtime (agentRuntime.ts) → aiService → proveedor IA` y `bus (eventBus.ts) → WebSocket`. Una sola fuente de rutas (`server.ts`), una sola fuente de schema (`db/init.ts`), tipos centralizados (`types/index.ts` / `shared/types.ts`).

---

## 2. Qué es Hokage

Hokage es el **motor de razonamiento y coordinación** — la única IA con la que Jorge conversa. Es el rol `ceo` (`scope='business'`, `is_system=true`, modelo `claude-sonnet-4.5`).

**Qué hace (✅ [[Agentes - Modelo y Decisión]], `hokageOrchestrator.ts`):** recibe una orden en lenguaje natural → la descompone en un plan (LLM) → lo valida de forma **determinista** (`validatePlan`) → reparte trabajo real a agentes de negocio como `work_items` → coordina fases → replanifica ante fallos → decide siguientes pasos → pide aprobación humana cuando la política lo exige.

**Autoridad central (🔒 invariante):** ningún agente de negocio crea su propio sistema de planificación. Hokage es la única autoridad de orquestación. Un plan **nunca** puede alcanzar `system.exec` ni elevarse por encima de la política (`orchestratableRoles()` excluye `ceo` y `hermes`).

**Objetivo (🔜):** que Hokage dirija también la **selección de modelo** (§11) y el **valor esperado** de cada tarea (§12), no solo el reparto.

---

## 3. Qué es Hermes

Hermes es el **Kernel / Runtime del sistema**, no un agente de negocio. Personifica el motor que ejecuta a los agentes, observa el estado y realiza operaciones de sistema.

**Decisión vigente (🔒, [[Redefinición de Principios Fundamentales - 2026-08-06]]):** Hermes **no** tiene personalidad conversacional ni recibe tareas de negocio. `HOKAGE_CORE_SPECIFICATION_v1.md §9.1` (Hermes como agente con voz/sala/chat) queda **⚠️ OBSOLETO** frente a esta decisión — pendiente de reconciliación documental controlada.

**Responsabilidades:** runtime, ejecución controlada (`system.exec`, siempre *propose→approve→run*, nunca directo), estado operativo, observabilidad, seguridad de ejecución.

**Estado de la separación (Fase B, [[Master Roadmap - v1]]):**
- ✅ **B.1** — frontera de datos: `role_definitions.scope='system'` es la fuente canónica; `listBusinessAgents()` excluye a Hermes; `listAgents()`/`getAgent()` se conservan para resolución interna; `system.exec`, `exec_runs`, `audit_logs` intactos.
- 🔜 **B.2** — kernel sin voz: crear `system.status` (hoy **no existe**; solo `GET /api/health`), superficie de comando que sustituya al chat como disparador de `system.exec`, retirar prompt/modelo conversacional.
- 🔜 **B.3** — `departments.type` (Negocio/Sistema), "Sala de Máquinas" → **Panel de Sistema**, retirar `role==='hermes'` del frontend.

**Invariante:** la fila histórica de Hermes en `agents` **permanece** durante B (integridad referencial); su retirada física es decisión posterior y opcional. Deep-dive: [[Hermes y Claude - Los Dos Motores]] · [[Arquitectura de Voz - Hermes]].

---

## 4. Qué es un agente

Un agente es una **instancia** (`agents`: id, name, role, status, model, venture_id) gobernada por una **definición de rol como dato** (`role_definitions`: modelo, tools, autonomía por defecto, presupuesto, scope, is_system).

**Propiedades del agente (✅ salvo lo marcado):** rol · capacidades/tools (por rol) · objetivos (vía work_items/objetivos) · restricciones (política) · presupuesto (por-rol + por-venture) · modelo · contexto (compuesto por capas) · memoria (privada + de negocio) · estado · permisos · nivel de autonomía (🟡 por-rol, no por-agente) · resultados anteriores (🔜 no en contexto) · feedback (🔜 no existe) · relaciones con otros agentes (🔜 sin enrutado dirigido).

**El agente NO queda anclado a su prompt inicial (principio, §4 del brief):** su identidad de rol es el `base_prompt` sembrado, pero el comportamiento se compone en tiempo de ejecución (ver §8). La evolución se logra **añadiendo capas** (preferencias, resultados, aportes), no reescribiendo el prompt base. Hoy faltan esas capas → es una brecha 🔜, no un principio roto.

Deep-dive: [[Agentes - Modelo y Decisión]]. Detalle operativo en el futuro documento **AGENT_OPERATING_MODEL** (documento C).

---

## 5. Qué es una venture

Una venture es un **negocio** (`ventures`: name, type, status, goal, revenue_target_usd, budget_allocated_usd, budget_spent_usd, activated_at). Es la unidad de aislamiento del sistema.

**Contratos (✅):**
- **Aislamiento** ([[Modelo Multi-Venture]], ADR-006): memoria de negocio y `agent_memory` con scope estricto por `venture_id`. Un agente en V2 no ve datos de V1.
- **Presupuesto duro** (§12): techo por venture, reserva atómica.
- **Activación** (F12): una venture aprobada nace con presupuesto pero **inerte**; `ventureActivation` cierra el lazo F11→operación de forma idempotente (`activated_at`).
- **Invariante (🔒):** los departamentos son estables; un negocio nuevo se organiza dentro de los departamentos existentes, nunca crea uno propio (ADR-006).

---

## 6. Cómo se asigna trabajo

Flujo (✅ `hokageOrchestrator.ts` + `agentRuntime.ts`):

```
Orden NL de Jorge → Hokage descompone (LLM) → validatePlan (determinista)
  → work_items (por fase, por rol de negocio activo, con venture_id)
  → Scheduler (stage2) despacha a agentes de NEGOCIO (listBusinessAgents)
  → agente ejecuta (askAgent → tools) → resultado → agent_runs/work_items
  → cierre de fase → replan en fallo → Decision si la política lo exige
```

- Los `work_items` tienen tipo (`autonomous_run` | `event_triggered` | `decision_execution`) y estado (`pending`→`in_progress`→`done`/`failed`).
- El scheduler es un **FSM de 8 etapas** con `activeAgents: Set` (ver §16), no un `setInterval` por agente.
- 🔜 **Falta** el "valor esperado" que priorice qué se ejecuta y con qué modelo (§11, §12).

---

## 7. Cómo funciona la autonomía

Cuatro niveles (✅ `rolePolicy.ts`, `agentAutonomy.ts`), como **compuerta** que solo restringe capacidades ya concedidas, nunca las amplía:

| Nivel | Nombre | Efecto |
|---|---|---|
| 0 | Observador | Solo tools de lectura; sin acciones ni decisiones. |
| 1 | Proponente | Trabaja y propone; decisiones quedan pendientes de Jorge. |
| 2 | Operativo | Como 1 + auto-aprueba SUS decisiones **no críticas** (no gasto, no publicación/financiero/legal, sin `entity_type`, riesgo no alto). |
| 3 | Autónomo | Reservado a roles de sistema; **no concedible por API** (`MAX_AUTONOMY=2`). |

**Mapa a §9 del brief:** AUTOMÁTICO = Nivel 2 no-crítico · REQUIERE REVISIÓN/APROBACIÓN = Decision pendiente · PROHIBIDO = política (`GRANTABLE_TOOLS`/`SYSTEM_ONLY_TOOLS`). El Nivel 3 de categorías (gasto/publicación/sistema) **siempre** es humano.

🟡 Autonomía es hoy **por-rol** (`default_autonomy`); el override por-agente es 🔜 (§24).

---

## 8. Cómo funciona la memoria

Dos ejes (✅ [[Memory System]]):
1. **Privada por agente** (`agent_memory`, `[LO QUE SÉ]`): KV de hechos, scope estricto por `agent_id` **Y** `venture_id`.
2. **De negocio** (`memory_entries`, `[MEMORIA DEL NEGOCIO]`): compartida por los agentes de un venture, aislada entre ventures.

Ambas se inyectan como **DATOS** (no reglas) por el `ContextComposer`, bajo la nota anti-inyección.

**Jerarquía de contexto (✅, orden = autoridad):** Global (`system_config`, master prompt) > Rol (`agent_prompts`) > Venture > Memoria privada > Memoria de negocio > `[REGLAS DE CONTEXTO]`.

**Brechas 🔜 (§3.3 de la auditoría):** cubre 6 de las 12 fuentes de §4. Faltan capas de **preferencias** (§9), **resultados previos**, **aportes dirigidos de otros agentes** (§10) y **conocimiento** (biblioteca). Además la recuperación es por **recencia** (`LIMIT 10`), no por relevancia — no escala; objetivo: recuperación FTS por relevancia.

---

## 9. Cómo funciona el feedback

🔜 **PROPUESTO — hoy NO existe.** Es la brecha crítica C4 de la auditoría.

**Diseño objetivo (propuesta, requiere tu aprobación):**
- `FeedbackService` + tabla `preferences` (scope: global/venture/rol/agente; tipo; confianza; origen; caducidad).
- El feedback de Jorge entra como evento → se **clasifica** (propuesta del LLM + gate humano/umbral) en {puntual · preferencia temporal · preferencia persistente · regla de proyecto · aprendizaje experimental}.
- Solo se **promueve** a preferencia persistente/regla con confirmación o umbral — nunca un comentario casual cambia el comportamiento permanente (§5 del brief: "aprender sin crear memoria basura").
- El `ContextComposer` gana una capa `[PREFERENCIAS]` entre Rol y Venture.

**Invariante de diseño:** el feedback nunca reescribe el prompt base; se añade como capa con precedencia clara.

---

## 10. Cómo se comparte información

Hoy (🟡): vía `memory_entries` (compartida por venture) y el event bus. **No hay enrutado dirigido** — o todos los agentes del venture ven la memoria de negocio, o la información no llega.

**Objetivo (🔜, §8 del brief):** concepto de **aporte dirigido** (hand-off) con permisos: un agente marca un hallazgo con destinatario/relevancia; Hokage (o una regla) decide su entrega; entra en el contexto del receptor bajo `[APORTES DE OTROS AGENTES]`, no en un broadcast global. Evita copiar todo el contexto a todos (eficiencia) sin dejar la información aislada.

---

## 11. Cómo se seleccionan modelos

Hoy (🟡 insuficiente, C3 de la auditoría): el modelo se resuelve **estáticamente** por rol (`agent.model > roleDef.model > AI_MODEL > DEFAULT_MODEL`), y **OpenRouter está cableado** en `aiService.ts` (`fetch` directo, precios hardcodeados en `MODEL_PRICES`).

**Objetivo (🔜 CRÍTICO, §6/§21 del brief):**
- **`AIProvider`** como interfaz (OpenRouter una implementación; los precios son dato del provider). `askAgent`/`callAIJson` dejan de conocer el proveedor → "cambiar de proveedor sin rediseñar agentes".
- **`ModelRouter`** que elige modelo por `{taskKind, complejidad, criticidad, presupuesto restante}`, dirigido por Hokage. Tarea trivial → barato; investigación/estrategia → potente; tarea crítica → posibilidad de revisión por segundo modelo/agente.

**Modelos por rol hoy (✅ `agentModels.ts`):** ceo `claude-sonnet-4.5`; contenido/hermes `claude-haiku-4.5`; investigador/trafico/finanzas `gemini-2.5-flash`; operaciones/soporte `llama-3.1-8b`.

---

## 12. Cómo se controla el coste

Dos ejes de presupuesto (✅, **no** es doble verdad — miden cosas distintas):
1. **Por-rol/agente** (`agent_budgets`, `MAX_BUDGET_USD=20`/mes): límite mensual por agente.
2. **Por-venture** (`ventureBudget.ts`): techo duro `allocated − real − reserved`, con **reserva atómica** (un solo UPDATE condicional, concurrency-safe sin locks). Defensa en profundidad: `ventureOverRealBudget` bloquea cualquier llamada IA si el coste real alcanzó el tope.

Coste medido: estimado (`estimateCallCostUsd`/`estimateTaskCostUsd`) y real (`agent_costs`: tokens_in/out, llm_cost_usd, tool_cost_usd), por agente y por venture.

**Brecha 🔜 (§7 del brief):** falta el **valor esperado** de la tarea — el presupuesto es un techo, no una priorización por valor. Objetivo: prioridad/valor en el `work_item` que guíe modelo (§11) y orden (§6). Deep-dive: [[Economía]] · [[Economía v2 - Sistema Financiero]].

---

## 13. Cómo funcionan las herramientas

Contrato `Tool` (✅ `tools/base.ts`): `id, name, description, category, status, permissions, requiredApproval, inputSchema, outputSchema, estimateCost, execute`. Registry (`tools/registry.ts`) con `execute` que audita (nombre, duración, estado — nunca argumentos ni output).

**Tools actuales:** `web.browser`, `google.trends`, `trend.report`, `content.create`, `memory.write`, `memory.remember`, `decision.create`, `system.exec` (solo Hermes), + stubs Etsy/Shopify/Printify.

**Política (🔒 `rolePolicy.ts`):** `GRANTABLE_TOOLS` (allowlist), `SYSTEM_ONLY_TOOLS` (`system.exec`). El efecto (read/operational/approval) gobierna la autonomía. 🟡 El efecto está hoy en un mapa aparte (`TOOL_EFFECTS`), no en la definición de la tool → objetivo 🔜: campo declarativo en `Tool` para el plugin system.

**Plugin loader dinámico (🔜, F.1):** el registry es estático; el loader llega cuando crezcan las tools. Deep-dive: [[Plugin System - Arquitectura Completa]] · [[ADR-005 - Tool Runtime y Plugin Contract]].

---

## 14. Cómo funcionan las decisiones

Toda acción costosa, pública o de sistema **no se ejecuta directo**: se crea una `Decision` (✅ `decisionService.ts`). El **seam central** es `decisionResolvers.ts` — mapa `entity_type → resolver`, no `if` sueltos. Cualquier "aprobar X dispara Y real" (nuevo negocio, plugin, exec) se registra ahí.

Flujo: `createDecision` → pendiente → Jorge (o auto-aprobación Nivel 2) aprueba/rechaza → `resolveDecisionApproval/Rejection` → efecto real + evento `decision.approved/rejected` → stage7 del runtime cierra el lazo. Auto-aprobación reutiliza **el mismo camino** que la humana (no hay segundo mecanismo). 🔒 Invariante.

---

## 15. Cómo funciona la seguridad

Fuerte (✅ F6/F10, [[Seguridad, Permisos y VPS]]):
- **Auth dual:** sesión (cookie HttpOnly, store en memoria) o token de máquina (`x-admin-token`/Bearer), comparados en **tiempo constante**. El token nunca viaja al cliente.
- **CSRF:** mutaciones por sesión exigen Origin de confianza + `SameSite=Lax`. Gate global secure-by-default en `/api/*`.
- **Rate limits:** general 120/min, ask 20/min, runtime 10/min, login 10/min.
- **WebSocket:** autenticado en `verifyClient` (cookie o token en subprotocolo, no en URL).
- **Red:** bind a `127.0.0.1`; expuesto solo tras nginx/túnel.
- **`system.exec`:** `buildSafeExecEnv` elimina secretos del proceso hijo (denylist + patrón `*_KEY/TOKEN/SECRET/...`); requiere usuario Linux dedicado sin sudo.
- **Capacidades:** limitadas por el **policy layer** (`rolePolicy`), no por lo que el modelo decida. 🔒 Ningún agente hace algo solo porque el LLM lo decidió.
- **Secretos:** `.env`/`*.db` ignorados por git; nada sensible trackeado. [[Gestión de Secretos y Capabilities]] (C.6) para credenciales de terceros reales.

Notas 🟡: session store en memoria (reinicio = re-login; no cruza procesos — ver §20). Etsy/Shopify son stubs (SSRF vía `ssrfGuard` ya existe para `web.browser`).

---

## 16. Cómo funciona el runtime

`agentRuntime.ts` (✅): FSM de **8 etapas** con `activeAgents: Set`, no timers por agente. Etapas: (1) drenar eventos del bus → work_items; (2) garantizar schedules + asignar/bloquear pending (sobre `listBusinessAgents`); (3) ejecutar con timeout; (4) TTL expirados → re-pending; (5) recoger resultados; (6) work_items derivados; (7) decisions aprobadas → ejecución; (8) costes/presupuesto.

**Hermes personifica este runtime (§3).** Deep-dive: [[Runtime, Scheduler y Event Bus]] · [[ADR-002 - Agent Runtime]].

🔜 Objetivo runtime: **poseer y exponer el estado de ciclo de vida por agente** (ver §19), que hoy no existe como contrato.

---

## 17. Cómo funciona el event bus

`HokageBus extends EventEmitter` (✅ `eventBus.ts`): `publish`/`subscribe`/`getHistory`, historial in-memory (100), **persistencia a `event_log` vía suscriptor** (no forma parte del contrato del bus). ~24 tipos de evento (negocio + orquestación).

**Contrato (🔒, ADR-003):** emit → listen; el bus **nunca persiste a SQL por sí mismo** (el `event_log` es un consumidor más). El frontend recibe eventos por WebSocket broadcast.

**Brechas:**
- 🔜 Faltan eventos finos de **ciclo de vida de agente** (los estados de §19) para el mundo.
- ⚪ **In-process:** un `EventEmitter` no cruza procesos → techo conocido si algún día hay multi-worker (§20). Deep-dive: [[Runtime, Scheduler y Event Bus]].

---

## 18. Cómo debería funcionar el World Engine

El mundo (PixiJS + ECS, aislado del React Shell — [[Frontend World Engine]], [[Plan de Migración ECS]]) debe ser la **representación fiel del estado real** del backend.

**Problema actual (🔴 C5 de la auditoría):** el frontend **inventa** el estado — "working" es una heurística de tiempo y el **movimiento es `setInterval` + `Math.random()`** (`useWorldState.ts`, marcado como deuda por el propio código). El backend no tiene un modelo de estado de agente que el mundo pueda renderizar.

**Objetivo (🔜 CRÍTICO — habilitador nº1):** el backend **posee** un `AgentRuntimeState` por agente (derivado de work_items + `activeAgents` + eventos) y lo publica como contrato (snapshot + deltas por WebSocket). El frontend deja de inventar: renderiza el estado real. Esto elimina el `Math.random()`.

**Movimiento (⚠️→decidido: representación, C1):** el agente "va" a un departamento cuando su estado de tarea lo indica y vuelve al hub al terminar, dirigido por el estado real. Movimiento **literal** (agente ubicado físicamente en otro depto) queda como futuro. Detalle en el futuro documento **WORLD_ENGINE_SPEC** (documento D). Deep-dives: [[Frontend - Decisiones v2]] · [[Crecimiento de la Ciudad - World Engine]] · [[Baseline de Comportamiento - World Engine]].

---

## 19. Cómo debe representarse el estado visual

Los estados visuales deben proceder del **runtime real**, no de una simulación independiente (🔒 principio, §0 del Núcleo).

**Contrato objetivo `AgentRuntimeState` (🔜 propuesta):** cada agente expone un estado de un vocabulario cerrado:

`IDLE · WORKING · RESEARCHING · THINKING · WAITING · REVIEWING · COMMUNICATING · MOVING · BLOCKED · ERROR · AWAITING_APPROVAL · COMPLETED`

Derivación (propuesta): del tipo/estado del `work_item` en curso + la tool activa + `activeAgents` + decisions pendientes del agente. Se emite como evento de ciclo de vida (§17) y se incluye en el snapshot inicial. El frontend mapea estado→visual (animación, posición, glow), sin heurísticas ni azar.

⚠️ El vocabulario exacto y su derivación es una **decisión abierta** a cerrar en el documento D.

---

## 20. Cómo se prepara para VPS

Base buena (✅): sin paths `/Users/` en código; `REPO_ROOT` por `import.meta.url`; bind a loopback; env requerido validado al arrancar; `.env`/`*.db` ignorados.

**Pendiente (🔜, G.1, no bloqueante ahora):** config de deploy (PM2, nginx, TLS/Let's Encrypt), backups, rotación de logs. Componentes que necesitará la VPS: backend, frontend estático, SQLite (→ Postgres si escala), runtime/scheduler, WebSocket, reverse proxy, TLS, almacenamiento, logs, variables de entorno, proveedor de modelos.

**Dos techos de proceso único a resolver antes de multi-worker (⚪):** session store en memoria (§15) y event bus in-process (§17). Detalle en el futuro documento **MIGRATION_AND_DEPLOYMENT_SPEC** (documento E). Deep-dive: [[Seguridad, Permisos y VPS]] · [[Escalabilidad]].

---

## 21. Qué cosas están prohibidas

🔒 **Invariantes negativos** (del brief §20 + reglas del repo):
- El frontend **no** inventa estado ni hace lógica de negocio.
- Hermes **no** es agente de negocio; **no** se rompe `system.exec`.
- **No** se duplica lógica entre Hokage y Hermes, ni entre frontend/backend.
- **No** todos los agentes usan el mismo modelo; **no** todos ven todo; **no** cada agente decide globalmente.
- **No** se borran datos históricos ni se destruye código funcional para "modernizar".
- **No** se crea una segunda fuente de verdad; **no** se rompe el aislamiento por venture ni la seguridad.
- **No** hay agentes que gasten presupuesto sin justificar ni hagan llamadas por hacerlas.
- **No** se hardcodean secretos; **no** se crea un departamento por negocio (ADR-006).

---

## 22. Qué cosas son invariantes

🔒 **Contratos que no cambian sin una decisión explícita (ADR):**
- Estructura de carpetas del backend (`config/`, `db/`, `services/`, `tools/`, `types/`).
- Contrato del Event Bus: emit → listen, nunca persistencia a SQL en el bus (§17).
- Tipos centralizados (`types/index.ts` / `shared/types.ts`), nunca duplicados.
- Una sola fuente de rutas (`server.ts`) y de schema (`db/init.ts`); migraciones **aditivas**.
- Patrón de aprobación: acción costosa/pública/sistema → `Decision`, nunca directo; seam en `decisionResolvers.ts` (§14).
- `role_definitions.scope` como fuente canónica system/business; policy layer como techo (§13, §15).
- Aislamiento por venture (§5).

---

## 23. Qué partes son extensibles

Diseñado para crecer **sin reescribir** (§21 del brief):
- **Roles** como dato (`role_definitions`) — nuevo rol de negocio = fila + validación de política.
- **Agentes** — instancias desde un rol; el scheduler los descubre.
- **Ventures** — nuevo negocio dentro de departamentos existentes (ADR-006).
- **Tools** — nuevo tool en el registry (loader dinámico 🔜, F.1).
- **Modelos/proveedores** — vía `AIProvider`/`ModelRouter` 🔜 (§11).
- **Autonomía / capacidades / presupuesto** — configurables por rol dentro del techo de política.
- **Departamentos** — plantillas tipadas 🔜 (Fase D). Deep-dive: [[Recetas - Añadir Negocio]].

---

## 24. Qué decisiones todavía están abiertas

⚠️ Decisiones que faltan por cerrar (no se han inventado; se listan como abiertas):

1. **Movimiento de agentes** — ✅ decidido: **representación** del estado (no literal en v1).
2. **Fuente de verdad documental** — ✅ decidido: **vault** canónico; raíz con redirects; auditoría de código como artefacto de trabajo en raíz.
3. **Override de autonomía por-agente** (además del por-rol) — abierto.
4. **Migración de driver SQLite** (`sqlite3` async → `better-sqlite3`) o corregir `CLAUDE.md` — abierto (recomendado: corregir doc).
5. **Política concreta del `ModelRouter`** — matriz taskKind/complejidad/criticidad → modelo — abierto (documento C/D).
6. **Umbrales de promoción de feedback** a preferencia/regla — abierto (§9).
7. **Vocabulario y derivación exacta de `AgentRuntimeState`** — abierto (documento D).
8. **Momento de VPS** (G.1) y de multi-worker — condicional; requiere servidor de Jorge.
9. **Reconciliación documental de `§9.1`** (Hermes-agente) — pendiente, controlada.

---

## Relación con otros documentos (gobernanza)

- **Ápice:** este documento.
- **Deep-dives de sistema:** las notas de `02_Sistemas/*` y `03_Agentes/*` (siguen vigentes; se actualizan como documentos C/D/E en las próximas rondas).
- **Plan de trabajo:** [[Master Roadmap - v1]] (eje A–G, único esquema de fases; la numeración git F1–F12 queda congelada como historial).
- **Auditoría de código:** [[Auditoría de Arquitectura - 2026-08-13]] (vault; foto verificada con rutas `file` inline; redirect mínimo en raíz).
- **Superados como ápice** (conservados como deep-dive/histórico): [[Especificación Funcional de Producto - v1]], [[Núcleo - Arquitectura del Core]], `HOKAGE_CORE_SPECIFICATION_v1.md`.

*Documento A (MASTER_SPEC). Siguientes en la ronda "uno a uno": C (AGENT_OPERATING_MODEL), D (WORLD_ENGINE_SPEC), E (MIGRATION_AND_DEPLOYMENT_SPEC) — actualizando los clústeres existentes del vault, no creando islas.*
