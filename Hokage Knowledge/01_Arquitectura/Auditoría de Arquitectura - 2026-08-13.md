# Auditoría de Arquitectura — 2026-08-13

> Categoría: **auditoría de estado** (foto verificada contra código, no decisión de arquitectura).
> Estado: 🆕 Vigente — extiende y actualiza a [[Auditoría de Arquitectura - 2026-08-06]] (aquella dio 6.5/10 con research de subagentes; esta es la auditoría maestra post-F12+B.1 que funda la preparación maestra). Base del [[HOKAGE_OS_MASTER_SPEC]].
> Fecha: 2026-08-13 · Base: `main` @ `238d57b` (F12 + B.1 cerradas).
> Método: lectura directa de código y schema. Cada afirmación está anclada a un fichero real (rutas `file` inline). No se asume que el código sea correcto por funcionar, ni que la visión sea correcta por estar escrita (§25 del brief).

---

## 0. Cómo leer este documento

Cinco bloques:

1. **Cuadro de salud** — estado por dominio, de un vistazo.
2. **Lo que YA está bien** — código funcional que NO se debe destruir (§20).
3. **Hallazgos por dominio** — con severidad y evidencia.
4. **Conflictos visión ↔ arquitectura** — donde tu intención choca con el diseño actual (§25).
5. **Mapa documental + convención** y **mapa ACTUAL → OBJETIVO + clasificación de cambios**.

Severidades: **🔴 CRÍTICO** (bloquea la visión o la seguridad) · **🟠 IMPORTANTE** (deuda que crecerá) · **🟡 MEJORA** (calidad) · **⚪ FUTURO** (condicional a volumen real).

---

## 1. Cuadro de salud por dominio

| Dominio | Estado | Veredicto corto |
|---|---|---|
| Seguridad (auth, CSRF, secrets, system.exec) | 🟢 Fuerte | Bien construido. Pocas notas menores. |
| Política de capacidades (rolePolicy) | 🟢 Fuerte | Techo real que el LLM no puede superar. |
| Presupuesto por venture | 🟢 Sólido | Techo duro atómico, sin locks globales. |
| Aislamiento por venture (memoria/coste) | 🟢 Sólido | Scope estricto verificado. |
| Orquestación (Hokage descompone→despacha) | 🟢 Bueno | Autoridad central real; falta valor-esperado. |
| Jerarquía de contexto | 🟠 Parcial | 6 de 12 fuentes de §4; sin feedback ni conocimiento. |
| Autonomía 0–3 | 🟢 Bueno | Compuerta correcta; solo por-rol, no por-agente. |
| Model routing / proveedor IA | 🔴 Insuficiente | Modelo estático por rol; OpenRouter hardcodeado. |
| Feedback → conocimiento (§5) | 🔴 Ausente | No existe. |
| Comunicación entre agentes (§8) | 🟠 Débil | Solo memoria por recencia; sin enrutado dirigido. |
| Hermes como Kernel (§3) | 🟠 En curso | B.1 hecha; B.2/B.3 pendientes. |
| Event bus | 🟠 Limitado | In-process; eventos de negocio, no de estado de agente. |
| World Engine / estado visual (§12) | 🔴 Inventado | El frontend fabrica estado y movimiento. |
| Preparación VPS (§11) | 🟢 Buena base | Sin paths locales; falta config de deploy. |
| Documentación (§17) | 🔴 Fragmentada | 5 numeraciones de fase; raíz vs vault duplicados. |

---

## 2. Lo que YA está bien — no destruir (§20)

Código funcional, con criterio, que la transformación debe **conservar y construir encima**, no reescribir:

- **Capa de seguridad (F6/F10).** `evaluateAuth` puro y testeable (`backend/src/config/session.ts`); doble credencial (cookie HttpOnly / token de máquina) con comparación en tiempo constante; CSRF por Origin + `SameSite=Lax`; bind a `127.0.0.1` (`backend/src/server.ts`); WS autenticado por subprotocolo (no en URL); `buildSafeExecEnv` con denylist + patrón que impide a `system.exec` leer secretos (`backend/src/config/security.ts`). Es seguridad real, no decorativa.
- **Política de capacidades como código** (`backend/src/config/rolePolicy.ts`). `GRANTABLE_TOOLS`, `SYSTEM_ONLY_TOOLS`, `MAX_AUTONOMY=2`, `validateRoleConfig` como punto único. El LLM propone; el runtime decide. Exactamente el "policy layer" que pides en §10.
- **Presupuesto por venture** (`backend/src/services/ventureBudget.ts`): techo duro `allocated − real − reserved`, reserva atómica por un solo UPDATE condicional (concurrency-safe sin locks). Más `ventureOverRealBudget` como defensa en profundidad en `askAgent`.
- **Aislamiento por venture**: memoria de negocio y `agent_memory` con scope estricto por `venture_id` (`backend/src/services/contextComposer.ts`, `backend/src/services/memoryService.ts`). Un agente en V2 no ve lo de V1.
- **Jerarquía de confianza en el contexto** (`backend/src/services/contextComposer.ts`): Global > Rol > Venture > Memoria, con nota anti-inyección explícita. La base de §4 está bien planteada.
- **Orquestador** (`backend/src/services/hokageOrchestrator.ts`): Hokage descompone una orden (LLM) → `validatePlan` determinista → despacha solo a roles de negocio activos (excluye ceo/hermes) → work_items → cierre de fase → replan en fallo. Autoridad central real (§9), no mini-planners por agente.
- **Auditoría/observabilidad** (F9): `audit_logs` + `event_log`, con sanitización (nunca argumentos ni output de tools).
- **B.0/B.1 de Hermes**: la separación de scope ya existe a nivel de rol y `listBusinessAgents()` la propaga sin romper nada.

---

## 3. Hallazgos por dominio

### 3.1 Model routing y proveedor de IA — 🔴 CRÍTICO (§6, §21)

**Estado real:** el modelo de un agente se resuelve estáticamente: `agent.model override > roleDef.model > AI_MODEL > DEFAULT_MODEL` (`backend/src/services/aiService.ts`). Un rol = un modelo fijo. **No existe selección por complejidad/calidad de la tarea.** El proveedor está cableado: `OPENROUTER_BASE` y `fetch` directo a openrouter.ai en `askAgent` y `callAIJson`; los precios están hardcodeados en `MODEL_PRICES` (`backend/src/services/aiService.ts`).

**Por qué es insuficiente:** tu §6 pide que Hokage elija modelo por tarea (sencilla→barato, estratégica→potente, crítica→revisión por segundo modelo). Hoy eso es imposible sin editar la config del rol. Y §21 pide "cambiar proveedor sin rediseñar agentes" — hoy el proveedor está soldado a `aiService`.

**Consecuencia:** o todos los agentes usan un modelo caro (derroche) o uno barato (resultados cutres) — precisamente el dilema que §6 quiere resolver dinámicamente.

**Dirección objetivo:** una capa `ModelRouter` (elige modelo por `{taskKind, complexity, criticality, budgetLeft}`) + un `AIProvider` como interfaz (OpenRouter una implementación). `askAgent`/`callAIJson` dejan de conocer el proveedor. Los precios pasan a ser dato del provider, no constantes.

### 3.2 Feedback → conocimiento — 🔴 CRÍTICO (§5)

**Estado real:** **no existe.** Hay `memory_entries` (memoria de negocio) y `agent_memory` (privada), pero ninguna ruta que capture feedback de Jorge y lo clasifique en {puntual, preferencia temporal, preferencia persistente, regla de proyecto, aprendizaje experimental}. No hay tabla de preferencias ni mecanismo de promoción controlada de feedback a regla.

**Consecuencia:** hoy "esto no me gusta / quiero algo más premium" solo puede afectar a la tarea en curso. El sistema no aprende de ti sin crear memoria basura, que es justo lo que §5 exige evitar.

**Dirección objetivo:** un `FeedbackService` + tabla `preferences` (scope: global/venture/rol/agente; tipo; confianza; origen; caducidad). Feedback entra como evento → se clasifica (propuesta del LLM + gate) → solo se promueve a preferencia persistente/regla con umbral o confirmación. El `ContextComposer` gana una capa **[PREFERENCIAS]** entre Rol y Venture.

### 3.3 Jerarquía de contexto incompleta — 🟠 IMPORTANTE (§4)

**Estado real:** `composeSystemContext` compone Global → Rol → Venture → agent_memory → memoria de negocio + reglas anti-inyección. Cubre **6 de las 12 fuentes** que enumeras en §4.

**Faltan como capa de contexto:** (7) feedback histórico, (8) resultados anteriores de tareas, (9) información compartida por otros agentes de forma dirigida, (5) conocimiento/biblioteca de referencias. Además la memoria se inyecta por **recencia** (`LIMIT 10`), no por relevancia — no escala (a 100 hechos, los 10 más recientes ≠ los 10 más útiles).

**Dirección objetivo:** capas nuevas [PREFERENCIAS], [RESULTADOS PREVIOS], [APORTES DE OTROS AGENTES], [CONOCIMIENTO]; recuperación por relevancia (FTS ya disponible en SQLite) en lugar de solo recencia.

### 3.4 Comunicación entre agentes — 🟠 IMPORTANTE (§8)

**Estado real:** los agentes comparten estado por dos vías: `memory_entries` (memoria de negocio del venture) y el event bus. **No hay enrutado dirigido de información** ("he encontrado esto, es relevante para el diseñador" → el sistema decide si llega al diseñador). El `to` del `AgentEvent` existe (`backend/src/config/eventBus.ts`) pero no se usa como canal de entrega selectiva a contexto.

**Consecuencia:** o todo agente del venture ve toda la memoria de negocio (contra "evitar copiar todo el contexto a todos", §8), o la información no llega. No hay término medio inteligente.

**Dirección objetivo:** un concepto de "aporte dirigido" (hand-off) con permisos: un agente marca un hallazgo con destinatario/relevancia; Hokage (o una regla) decide su entrega; entra en el contexto del receptor bajo [APORTES DE OTROS AGENTES], no en un broadcast global.

### 3.5 World Engine: el frontend inventa el estado — 🔴 CRÍTICO (§12, §13, §20)

**Estado real — el hallazgo más importante para tu visión de mundo vivo:** en `frontend/src/hooks/useWorldState.ts` el estado visual se **fabrica en el cliente**:

- `isWorking` = "última run hace < 5 min" (heurística de tiempo, no señal real del runtime) (`frontend/src/hooks/useWorldState.ts`).
- Posición/movimiento de los agentes = **`setInterval` por agente + `Math.random()`** (`frontend/src/hooks/useWorldState.ts`); el propio código lo marca "DEUDA CONOCIDA, MANTENIDA A PROPÓSITO".
- `activityLevel` = buckets de tiempo desde la última run.

**El backend no tiene un modelo de estado de agente que el mundo pueda renderizar.** El `agents.status` es un `idle/working` mínimo; no existen los estados ricos que pides (IDLE/WORKING/RESEARCHING/THINKING/WAITING/REVIEWING/COMMUNICATING/MOVING/BLOCKED/ERROR/AWAITING_APPROVAL/COMPLETED). El runtime SÍ tiene la verdad (work_items con estado, `activeAgents: Set`, event stream) pero **no la expone como estado de ciclo de vida por agente.**

**Consecuencia:** el mundo actual es una animación decorativa desconectada del backend — exactamente lo que §12/§20 prohíben. Ningún pulido visual posterior lo arregla: el problema es que no hay verdad que mostrar.

**Dirección objetivo (habilitador nº1 de todo el tycoon):** el backend debe **poseer** un estado de runtime por agente, derivado de work_items + `activeAgents` + eventos, y publicarlo como contrato (snapshot + deltas por WebSocket). El frontend deja de inventar: se limita a renderizar `AgentRuntimeState`. Esto elimina el `Math.random()` y hace verdadero el "no inventar estados".

### 3.6 Event bus — 🟠 IMPORTANTE / ⚪ FUTURO (§17, §11)

**Estado real:** `HokageBus` extiende `EventEmitter`, historial in-memory (100), persistencia a `event_log` vía suscriptor (`backend/src/config/eventBus.ts`). Los ~24 tipos de evento son de **negocio/orquestación** (trend/content/decision/sale/hokage.*), no de **ciclo de vida de agente** (los estados del §12 no se emiten).

**Dos consecuencias:**
- Para el World Engine faltan eventos finos de estado de agente (habilita 3.5).
- Es **in-process**: un `EventEmitter` no cruza procesos. En VPS con varios workers/PM2-cluster (§11), el bus no propagaría. Hoy es correcto (un proceso); es un techo conocido para escala (⚪, ya anticipado en G.2).

### 3.7 Coste sin valor-esperado — 🟠 IMPORTANTE (§7)

**Estado real:** el coste está bien medido (estimado y real, por agente y por venture; `agent_costs`, `agent_budgets`, `ventureBudget`). Existen **dos ejes de presupuesto** (por-rol mensual $20 y por-venture asignado) — no es doble verdad, miden cosas distintas, pero debe documentarse para no confundir.

**Falta:** el "valor esperado de la tarea" (§7). El presupuesto es un techo duro, no una priorización por valor. No hay señal de "esta tarea cara vale la pena / esta barata es inútil".

**Dirección objetivo:** una noción de prioridad/valor en el work_item que el router y el scheduler usen para decidir modelo y orden — no solo el techo.

### 3.8 Autonomía por-rol, no por-agente — 🟡 MEJORA (§4)

`autonomyForAgent` devuelve `role_definitions.default_autonomy` (`backend/src/services/agentAutonomy.ts`); el override por-agente está anotado como futuro. §4 lista la autonomía como propiedad del agente. Gap menor, ya previsto.

### 3.9 `TOOL_EFFECTS` hardcodeado — 🟡 MEJORA (§21 extensibilidad)

La clasificación read/operational/approval de cada tool vive en un mapa aparte (`backend/src/config/rolePolicy.ts`), no en la definición de la tool. Un plugin nuevo cae a `operational` por defecto (conservador-seguro) pero su efecto no es declarativo. Para el plugin system (§21) el efecto debería ser un campo de la `Tool`.

### 3.10 Hermes / Runtime — 🟠 EN CURSO (§3)

B.1 cerrada (frontera de datos). Pendiente y ya auditado en B.0: **B.2** (kernel sin voz + crear `system.status` —que **no existe** hoy, solo `GET /api/health`— + superficie de comando que sustituye al chat como disparador de `system.exec`) y **B.3** (`departments.type`, Panel de Sistema, retirar `role==='hermes'` del frontend). Riesgo principal ya documentado: el único disparador de `system.exec` es chatear con la fila-agente de Hermes.

### 3.11 Seguridad — 🟢 con notas menores (§10)

Fuerte (ver §2). Notas:
- **Session store en memoria** (`backend/src/config/session.ts`): reinicio del backend = re-login (aceptable, documentado); pero **no comparte entre procesos** → si algún día PM2 cluster, romperá. Nota para §11.
- **Higiene de secretos correcta**: `.env` y `*.db` ignorados por `backend/.gitignore`/`frontend/.gitignore`; nada sensible trackeado. El `.gitignore` raíz no los repite (podría, por claridad), pero no hay riesgo real.
- Etsy/Shopify/Printify son **stubs** en el registry — cuando se conecten APIs reales, entra en juego Secret Management v2 (C.6) y SSRF sobre `web.browser` (ya hay `ssrfGuard.ts`).

### 3.12 Preparación VPS — 🟢 Buena base (§11)

Sin paths `/Users/` en código; `REPO_ROOT` se resuelve por `import.meta.url`; bind a loopback; env requerido validado al arrancar. **Falta** (no bloqueante ahora): config de deploy (PM2/nginx/TLS), y resolver los dos techos de proceso único (session store + event bus in-process) antes de cluster. `system.exec` exige usuario Linux dedicado sin sudo (ya anotado en código).

### 3.13 Driver SQLite: documentación miente — 🟡 MEJORA (A.7)

El código usa `sqlite3` (async) (`backend/src/db/init.ts`); `CLAUDE.md` (global) afirma `better-sqlite3`. Discrepancia de documentación, no bug. Decisión pendiente: corregir el doc (recomendado) o migrar el driver (solo si el volumen lo justifica).

---

## 4. Conflictos entre tu visión y la arquitectura actual (§25)

Donde tu intención choca con el diseño existente. Los señalo con su consecuencia y una propuesta — no los resuelvo en silencio.

### C1 — "Los agentes se desplazan al departamento correspondiente" vs. "un agente = un rol = una sala fija"

Tu §12 describe agentes que **se mueven** entre departamentos según la tarea. El modelo actual ata cada agente a un rol y cada rol a una sala fija (`frontend/src/hooks/useWorldState.ts` `agents.find(a => a.role === b.role)`). El movimiento es una metáfora, no un hecho.

**Decisión necesaria:** ¿el movimiento es (a) **literal** — una tarea "ubica" a un agente trabajando en un departamento concreto, con estado MOVING real — o (b) una **representación** del estado de la tarea (el agente "va" a Investigación cuando investiga, vuelve al hub cuando termina)? Recomiendo (b) para v1 (más barato, igual de expresivo) con el estado real de 3.5 como fuente, dejando (a) como futuro. Es tu decisión de producto.

### C2 — "El agente no queda limitado por su prompt inicial" vs. identidad de rol como `base_prompt` estático

§4 quiere agentes que evolucionen. El `ContextComposer` ya añade capas (bien), pero la **identidad de rol** sigue siendo un `agent_prompts.content` sembrado y estático. Sin la capa de preferencias/feedback (3.2) y sin resultados previos (3.3), el agente sí queda anclado a su semilla.

**Propuesta:** la evolución no se hace reescribiendo el prompt base, sino añadiendo las capas [PREFERENCIAS] y [RESULTADOS PREVIOS] con precedencia clara. El prompt base define identidad; las capas definen aprendizaje. Sin nueva fuente de verdad.

### C3 — "Máxima calidad con gasto inteligente" vs. modelo estático por rol

§6 exige routing dinámico; la arquitectura fija el modelo por rol (3.1). No se puede cumplir §6 sin la capa `ModelRouter`. Conflicto directo → CRÍTICO.

### C4 — "El sistema aprende de mí sin crear memoria basura" vs. no existe capa de feedback

§5 es un requisito de primera clase; hoy no tiene ninguna implementación (3.2). Conflicto directo → CRÍTICO.

### C5 — "La interfaz visualiza estado real" vs. estado fabricado con `Math.random()`

§12/§20 explícitos; el frontend inventa (3.5). Conflicto directo → CRÍTICO. Es el prerrequisito del "segundo modelo" que llevará el World Engine (§24): sin estado real, ese modelo pulirá una simulación falsa.

### C6 — Cinco numeraciones de fase vs. "una convención única para que nunca vuelva a ocurrir" (§17)

Ya generó confusión real (una "F13" que no existe). Conflicto de gobernanza → CRÍTICO documental. Ver §5 de este documento.

---

## 5. Mapa documental + convención propuesta (§17)

### 5.1 Estado actual — fragmentación real

**Raíz del repo (9):** `ARCHITECTURE.md`, `VISION.md`, `HOKAGE_CORE_SPECIFICATION_v1.md`, `Roadmap.md`, `handoff.md`, `CLAUDE.md`, + 3 sin trackear (`Codebase Audit Registry.md`, `Deployment & Migration Plan.md`, `UI Implementation Plan.md`).
**Vault `Hokage Knowledge/` (~48):** 01_Arquitectura (incl. `ARCHITECTURE (legacy).md`), 02_Sistemas (World Engine, Interfaz), 03_Agentes, 05_Negocios, 07_Decisiones (ADR-001…006), 09_Roadmap (`Master Roadmap - v1.md`, snapshots), etc.

**Duplicación/contradicción detectada:**
- `ARCHITECTURE.md` (raíz) ↔ `01_Arquitectura/ARCHITECTURE (legacy).md` (vault).
- `Roadmap.md` (raíz, snapshot 2-ago) — **el propio Master Roadmap lo declara superado**, pero sigue en raíz como si fuera vigente.
- 5 esquemas de "fase": Roadmap 1–6 · Spec §2 Tool-Calling 1–4 · Master Roadmap **A–G** · UI Implementation Plan 10–14 · git **Fase 1–12** (+ ya "Fase B.1").

### 5.2 Jerarquía de fuente de verdad propuesta

```
FUENTE DE VERDAD (canónica, 1 sitio)
  └─ HOKAGE_OS_MASTER_SPEC.md          ← qué ES el sistema (invariantes, contratos)
       ├─ DOCUMENTOS ARQUITECTÓNICOS   ← cómo funciona cada subsistema (specs C/D/E)
       │    · HOKAGE_AGENT_OPERATING_MODEL.md
       │    · HOKAGE_WORLD_ENGINE_SPEC.md
       │    · HOKAGE_MIGRATION_AND_DEPLOYMENT_SPEC.md
       ├─ ROADMAP                       ← Master Roadmap A–G (único plan)
       ├─ DECISIONES (ADR)             ← 07_Decisiones/ADR-*
       ├─ DOCUMENTACIÓN OPERATIVA       ← handoff, runbooks
       └─ NOTAS HISTÓRICAS             ← snapshots, legacy (marcados OBSOLETO, no borrados)
```

### 5.3 Convención de numeración única (resuelve C6)

- **Se adopta el eje A–G del Master Roadmap** como único esquema de planificación. Ya está en marcha: el último commit es "Fase **B.1**".
- **La numeración git F1–F12 se congela** como historial. Se añade al MASTER_SPEC una **tabla de equivalencia** F1–F12 → A/C/§spec (retroactiva, sin reescribir historia).
- **Cada commit futuro referencia una entrega del Master Roadmap** (ej. `B.2`, `C.6`). Se retira el esquema numérico.
- **`Roadmap.md` (raíz) pasa a ser un redirect** de una línea al Master Roadmap (no se borra; deja de competir como fuente).
- **Regla:** cualquier funcionalidad nueva encaja en una entrega A–G antes de codificarse (ya es la regla del Master Roadmap; se eleva a invariante).

### 5.4 Decisión abierta bloqueante (para ti)

**¿Dónde vive la fuente de verdad canónica: raíz del repo o el vault `Hokage Knowledge/`?** Tu brief nombra ficheros en raíz; tu regla histórica y la memoria dicen "Obsidian es la fuente, nunca duplicar". Crear 5 `.md` en raíz junto a un vault de 48 docs **empeoraría** la fragmentación que §17 quiere resolver. → **Necesito tu decisión antes de generar A/C/D/E** (ver §7). Este documento de auditoría (B) lo he puesto en raíz por ser un artefacto de trabajo net-new y estar nombrado explícitamente.

---

## 6. Mapa ACTUAL → OBJETIVO y clasificación de cambios

| # | Cambio | Actual | Objetivo | Clase |
|---|---|---|---|---|
| 1 | **Estado de runtime por agente** | Frontend inventa (time+random) | Backend posee `AgentRuntimeState`, contrato WS; frontend solo renderiza | 🔴 CRÍTICO |
| 2 | **Gobernanza documental** | 5 numeraciones, raíz vs vault | 1 fuente de verdad, A–G, tabla de equivalencia, redirects | 🔴 CRÍTICO |
| 3 | **AIProvider abstracto** | OpenRouter soldado en aiService | Interfaz `AIProvider`; OpenRouter una impl; precios como dato del provider | 🔴 CRÍTICO |
| 4 | **ModelRouter** | Modelo fijo por rol | Selección por `{taskKind, complejidad, criticidad, presupuesto}` que Hokage dirige | 🟠 IMPORTANTE |
| 5 | **Feedback → conocimiento** | No existe | `FeedbackService` + `preferences` + promoción controlada + capa de contexto | 🔴 CRÍTICO |
| 6 | **Fase B (Hermes kernel)** | B.1 hecha | B.2 (system.status + comando runtime) + B.3 (departments.type, Panel Sistema) | 🟠 IMPORTANTE |
| 7 | **Enrutado de info entre agentes** | Memoria compartida por recencia | Aporte dirigido con permisos + capa [APORTES] | 🟠 IMPORTANTE |
| 8 | **Contexto por relevancia** | `LIMIT 10` por recencia | Recuperación FTS por relevancia; capas [RESULTADOS PREVIOS]/[CONOCIMIENTO] | 🟠 IMPORTANTE |
| 9 | **Efecto de tool declarativo** | Mapa hardcodeado | Campo en la definición de `Tool` | 🟡 MEJORA |
| 10 | **Autonomía por-agente** | Solo por-rol | Override por-agente sobre el rol | 🟡 MEJORA |
| 11 | **Valor-esperado en cost/scheduler** | Solo techo duro | Prioridad/valor en work_item que guía modelo y orden | 🟡 MEJORA |
| 12 | **Eventos de ciclo de vida de agente** | Eventos de negocio | Emisión de estados (RESEARCHING/THINKING/…) para el mundo | 🟡 MEJORA |
| 13 | **Fase D (interfaz OS)** | PanelRegistry parcial | Registry de paneles + departamentos tipados + barra superior | 🟡 MEJORA |
| 14 | **Driver SQLite / CLAUDE.md** | Doc dice better-sqlite3 | Corregir doc (o migrar si el volumen lo pide) | 🟡 MEJORA |
| 15 | **Bus cross-process + durable** | In-process EventEmitter | Cola/broker solo cuando haya multi-worker | ⚪ FUTURO |
| 16 | **Session store compartido** | En memoria | Store persistente/compartido solo si PM2 cluster | ⚪ FUTURO |
| 17 | **Plugin loader dinámico (F.1)** | Registry estático | Discover/install/enable cuando crezcan las tools | ⚪ FUTURO |
| 18 | **Knowledge System (C.4)** | No existe | Biblioteca de referencias integrada en el composer | ⚪ FUTURO |
| 19 | **VPS deploy (G.1)** | Solo local | Hetzner + PM2 + nginx + TLS (requiere servidor de Jorge) | ⚪ FUTURO |

### 6.1 Orden recomendado (dependencias)

1. **#2 Gobernanza documental** (desbloquea entender el sistema; barato; §24).
2. **#1 Estado de runtime por agente** + **#12 eventos** (habilitador del World Engine; el "segundo modelo" lo necesita).
3. **#3 AIProvider** → **#4 ModelRouter** (§6, §21).
4. **#5 Feedback → conocimiento** (§5) — puede ir en paralelo a 2/3.
5. **#6 Fase B.2/B.3** (cierra Hermes-kernel).
6. **#7/#8 contexto** → luego #9/#10/#11 (mejoras).
7. Fase D, luego FUTURO condicional.

---

## 7. Decisiones abiertas — necesito tu criterio antes de seguir

1. **Ubicación de la fuente de verdad documental** (raíz vs vault) — §5.4. Bloquea generar A/C/D/E sin empeorar la fragmentación.
2. **C1 — Movimiento de agentes**: ¿literal (agente se ubica en el depto) o representación del estado de tarea? Recomiendo representación para v1.
3. **Alcance de esta ronda**: los 5 documentos son grandes y de máxima calidad. Propongo entregarlos **de uno en uno** (empezando por MASTER_SPEC), para que revises cada uno, en vez de 5 borradores a la vez. ¿De acuerdo?
4. **Primer cambio estructural a implementar** tras los docs: recomiendo **#1 (estado de runtime por agente)** por ser el habilitador de tu visión de mundo vivo y no romper nada (aditivo: nuevo contrato de lectura).

---

## 8. Qué NO se tocará sin aprobación explícita

Nada de código en esta fase de auditoría. Y cuando se implemente: no se borra la fila de Hermes, no se rompe `system.exec`, no se elimina memoria histórica, no se destruye código funcional para "modernizar", no se introduce segunda fuente de verdad, no se rompe aislamiento por venture ni seguridad. Cada cambio estructural dejará constancia de qué problema resuelve y qué riesgo evita (§18).

---

*Fin del documento B (auditoría). Documentos A (MASTER_SPEC), C (AGENT_OPERATING_MODEL), D (WORLD_ENGINE_SPEC) y E (MIGRATION_AND_DEPLOYMENT_SPEC) se generan tras resolver la decisión §7.1.*
