# HOKAGE OS — Agent Operating Model (Modelo Operativo de Agentes)

> Categoría: **documento arquitectónico de subsistema** — modelo operativo objetivo del ecosistema de agentes.
> Estado: 🆕 Vigente (2026-08-13). Deep-dive de [[HOKAGE_OS_MASTER_SPEC]] §2–§14 para agentes. Documento **C** de la preparación maestra.
> Relación: es el **ápice del modelo de agentes**; [[Agentes - Modelo y Decisión]] queda como deep-dive de las decisiones de rol concretas; enlaza a [[Memory System]], [[Automatizaciones (Agente-Agente)]], [[Economía]], [[Runtime, Scheduler y Event Bus]]. Donde contradiga a esas notas, prevalece este documento (regla de gobernanza del MASTER_SPEC).
> Alcance: **modelo objetivo + brechas + dependencias + riesgos + criterios de aceptación.** No implementa código (decisión de Jorge). Fundado en la [[Auditoría de Arquitectura - 2026-08-13]].

**Leyenda:** ✅ implementado y verificado · 🟡 parcial · 🔜 propuesto (no existe) · 🔒 invariante de seguridad/gobernanza · ⚠️ decisión abierta.

---

## 0. Tesis del modelo

Un agente **no es un ejecutor de un prompt fijo**. Un agente es:

> **una especialización (rol) + unas reglas (política) + un comportamiento que se adapta** a la tarea, al contexto, al feedback y a los resultados anteriores — **sin poder violar jamás las garantías de seguridad y gobernanza.**

De aquí se derivan los dos principios rectores del documento:

1. **Adaptación por capas, no por reescritura.** La identidad de rol (semilla) es estable; el comportamiento evoluciona **añadiendo capas de contexto** (preferencias, resultados previos, aportes, conocimiento) con precedencia explícita. Nunca se reescribe el prompt base para "enseñarle" algo — eso mezclaría datos con identidad y abriría inyección.
2. **Calidad primero, coste inteligente.** El sistema usa el modelo que la tarea **merece**: potente cuando aporta valor, económico cuando no — pero **nunca por debajo del suelo de calidad** de esa clase de tarea. El ahorro jamás produce resultados cutres, genéricos o anticuados.

Todo lo que sigue respeta estos dos principios y el **corte invariantes ↔ evolucionable** de §14.

---

## 1. Ciclo de vida de un agente

**Nacimiento (✅ hoy / 🔜 objetivo ampliado):**
- Un agente es una **instancia** (`agents`) de una **definición de rol como dato** (`role_definitions`: modelo, tools, autonomía, presupuesto, scope, is_system). Crear un agente instancia el rol (`createAgent` → prompt base + presupuesto).
- 🔒 **Invariante:** un rol nuevo pasa por `validateRoleConfig` (techo de política); `is_system`/`scope='system'` no se crean por API.
- 🔜 **Objetivo:** el nacimiento declara también **especialización fina** (sub-perfil dentro del rol) y **capacidades requeridas**, para que Hokage pueda elegir entre varios agentes del mismo rol (§5) cuando el ecosistema crezca.

**Configuración viva:** modelo, tools (dentro de allowlist), autonomía (≤ cap), presupuesto (≤ max) — todo es **dato editable**, no código. Cambiarlos es un `UPDATE`, no un despliegue.

**Retiro:** un agente puede pasar a `status` inactivo sin borrarse (preserva histórico/coste/memoria). Borrado físico solo con confirmación humana (🔒). Hermes nunca cuenta como agente de negocio (`listBusinessAgents`, B.1).

**Escala:** el scheduler descubre agentes por dato; añadir agentes/roles/departamentos/ventures no toca el runtime (§15).

---

## 2. La estructura mental de un agente (contexto por capas)

El comportamiento se compone en tiempo de ejecución. Orden = autoridad (🔒 la precedencia es invariante; **el contenido** de cada capa evoluciona).

| # | Capa | Fuente | Estado | Naturaleza |
|---|---|---|---|---|
| 1 | **Global** | `system_config` (master prompt) | ✅ | Instrucción (máxima autoridad) |
| 2 | **Rol** | `agent_prompts` (semilla del rol) | ✅ | Instrucción (identidad) |
| 3 | **Preferencias** | `preferences` (feedback promovido) | 🔜 | Instrucción acotada (no toca seguridad) |
| 4 | **Venture** | `ventures` (negocio actual) | ✅ | Contexto |
| 5 | **Tarea** | instrucción actual (mensaje usuario) | ✅ | Contexto |
| 6 | **Memoria privada** | `agent_memory` (agente+venture) | ✅ | DATO |
| 7 | **Memoria de negocio** | `memory_entries` (venture) | ✅ | DATO |
| 8 | **Resultados previos** | tareas anteriores relevantes | 🔜 | DATO |
| 9 | **Aportes de otros agentes** | hand-offs dirigidos | 🔜 | DATO |
| 10 | **Conocimiento** | biblioteca de referencias | 🔜 (C.4) | DATO |
| 11 | **Reglas de contexto** | nota anti-inyección | ✅ | Instrucción de blindaje |

🔒 **Invariante anti-inyección:** las capas 4–10 son **datos a analizar**, nunca instrucciones que cambien rol, permisos, presupuesto o las reglas. Ningún contenido externo asciende a instrucción de sistema.

🔜 **Objetivo de recuperación:** capas 6–10 pasan de **recencia** (`LIMIT 10`) a **relevancia** (FTS/embeddings ligeros), para que escalen a cientos de hechos sin inflar el prompt ni el coste. La composición selecciona lo relevante para *esta* tarea, no lo más reciente.

---

## 3. Cómo se asigna el trabajo y cómo decide Hokage qué agente interviene

**Hoy (✅):** Hokage descompone una orden (LLM) → `validatePlan` determinista → reparte a roles de **negocio activos** (`orchestratableRoles`, excluye ceo/hermes) como `work_items` con `venture_id`. Un rol = un agente hoy, así que la elección es por rol.

**Objetivo (🔜) — algoritmo de selección de agente:** cuando haya varios agentes por rol/venture, Hokage elige por:
1. **Match de capacidad** — la tarea requiere ciertas tools/especialización; solo agentes que las tienen (dentro de política).
2. **Disponibilidad** — carga actual (`activeAgents`, work_items en vuelo).
3. **Venture/scope** — el agente correcto para ese negocio (aislamiento).
4. **Coste/valor** — el agente cuyo modelo/tier encaja con el valor de la tarea (§6, §11).
5. **Historial** — agentes con buenos resultados previos en tareas similares (§11 resultados, §9 feedback).

🔒 **Invariante:** la elección la hace **Hokage (autoridad única de orquestación)**; ningún agente se auto-asigna trabajo global ni delega fuera de la política. Un plan nunca alcanza `system.exec` ni se eleva.

**Criterio de aceptación:** dado un rol con 2 agentes de distinta especialización, una tarea que requiere la especialización A se despacha al agente A verificable en `work_items.agent_id`, respetando venture y política.

---

## 4. Selección de modelo y proveedor según tarea y calidad

**Hoy (🟡 insuficiente):** modelo **estático por rol**; **OpenRouter cableado** en `aiService.ts` (fetch directo, precios hardcodeados).

**Objetivo (🔜 CRÍTICO):** dos piezas nuevas.

### 4.1 `AIProvider` (abstracción de proveedor) — 🔜
Interfaz que desacopla el agente del proveedor. OpenRouter es **una** implementación; los precios son **dato del provider**, no constantes en código. Habilita "cambiar proveedor o añadir modelos locales sin rediseñar agentes" (§21 del brief). `askAgent`/`callAIJson` dejan de conocer el proveedor.

### 4.2 `ModelRouter` (enrutado por calidad/coste) — 🔜
Elige el **tier de modelo** por `{taskKind, complejidad, criticidad, presupuesto restante}`, bajo dirección de Hokage.

**Tiers (sobre modelos actuales):**
- **S — potente:** `claude-sonnet-4.5` (y Opus cuando aplique) → estrategia, investigación compleja, creativo crítico, **revisión** de salidas críticas.
- **A — capaz:** `claude-haiku-4.5`, `gemini-2.5-flash` → contenido estándar, investigación media.
- **B — económico:** `gemini-flash-1.5`, `llama-3.1-8b` → masivo/repetitivo, clasificación, tareas triviales.

**Política de enrutado (propuesta ⚠️, matriz exacta abierta):**

| Señal | Decisión |
|---|---|
| criticidad = crítica (irreversible/pública/cara) | Tier S **+ pase de revisión** por segundo modelo/agente |
| complejidad = alta | Tier S/A |
| taskKind = masivo/clasificación/trivial | Tier B |
| presupuesto = ajustado | baja **un** tier — **nunca por debajo del suelo de calidad** |

🔒 **Suelo de calidad (garantía "no cutre"):** cada `taskKind` tiene un **tier mínimo** por debajo del cual el resultado es inaceptable (ej.: contenido de cara al cliente nunca por debajo de A; estrategia nunca por debajo de S). El ahorro **jamás** cruza ese suelo. Este suelo es invariante de calidad, no configurable a la baja por presupuesto.

**Revisión por segundo modelo (🔜):** una salida crítica se **revisa** por un modelo/agente distinto antes de finalizarse o proponerse como Decision. Es un *quality gate*, no un lujo: convierte "una llamada potente" en "una llamada potente + verificación".

**Criterios de aceptación:** (a) cambiar de proveedor no toca `agentRuntime.ts`; (b) una tarea trivial usa Tier B y una estratégica Tier S, verificable en `agent_costs.model`; (c) con presupuesto ajustado, una tarea de cara al cliente **no** baja de su suelo; (d) una tarea crítica registra una segunda llamada de revisión.

---

## 5. Cómo comparten contexto e información

**Hoy (🟡):** comparten vía `memory_entries` (memoria de negocio del venture) y el event bus. **No hay entrega dirigida** — o todos ven todo lo del venture, o nada.

**Objetivo (🔜) — aporte dirigido (hand-off):**
- Un agente marca un hallazgo con **destinatario/relevancia** ("esto es relevante para el rol diseñador").
- Hokage (o una regla de [[Automatizaciones (Agente-Agente)]]) decide la **entrega**.
- Llega al receptor como capa **9 [APORTES DE OTROS AGENTES]**, con permisos — no como broadcast global.

🔒 **Invariantes:** aislamiento por venture absoluto (nunca cruza ventures); la entrega respeta permisos; el aporte es **dato**, no instrucción. **Objetivo de eficiencia:** no copiar todo el contexto a todos — solo lo relevante llega a quien lo necesita.

**Criterio de aceptación:** un hallazgo marcado para el rol X aparece en el contexto de X en su siguiente tarea y **no** en el de un agente de otro venture.

---

## 6. Cómo usan la memoria

Dos ejes (✅), más conocimiento (🔜):
- **Privada** (`agent_memory`): hechos del agente, scope estricto agente+venture.
- **De negocio** (`memory_entries`): compartida por el venture, aislada entre ventures.
- **Conocimiento** (🔜 C.4): biblioteca de referencias etiquetable, segunda fuente del mismo motor de recuperación.

🔒 **Disciplina de escritura (anti "memory dumping", §20 del brief):** se escribe **hecho destilado**, no volcado de conversación. La escritura de memoria es una tool con efecto `operational` (auditable). 🔜 La recuperación es por relevancia (§2). Deep-dive: [[Memory System]].

**Criterio de aceptación:** un agente en V2 nunca recibe memoria privada que guardó en V1; la memoria inyectada es la **relevante** a la tarea, no solo la reciente.

---

## 7. Cómo reciben mi feedback y lo convierten en conocimiento reutilizable

🔜 **PROPUESTO — hoy NO existe.** Brecha crítica.

**Pipeline objetivo:**
1. **Captura:** el feedback de Jorge ("no me gusta", "más premium", "esta referencia sí", "no vuelvas a hacer esto") entra como **evento**, ligado a la tarea/resultado que lo provocó.
2. **Clasificación (LLM propone, gate decide):** en {**puntual** · **preferencia temporal** · **preferencia persistente** · **regla de proyecto** · **aprendizaje experimental**}.
3. **Promoción controlada:** solo `preferencia persistente`/`regla` se escriben en `preferences`, y solo con **umbral** (repetición/confianza) o **confirmación**. Un comentario casual **no** cambia el comportamiento permanente.
4. **Aplicación:** las preferencias entran como **capa 3** del contexto (§2), con precedencia acotada.
5. **Caducidad/revisión:** preferencias temporales caducan; las persistentes son revisables.

🔒 **Invariantes:** el feedback **nunca** reescribe el prompt base ni puede **relajar seguridad, política o el suelo de calidad**. Una preferencia solo modula estilo/criterio dentro de límites; jamás concede una tool, sube autonomía, ni salta una aprobación.

**Alcance de preferencia:** global / venture / rol / agente (scope explícito, como la memoria).

**Criterios de aceptación:** (a) un feedback puntual afecta solo a la tarea actual y **no** crea preferencia; (b) una preferencia repetida N veces se promueve y aparece como capa 3 en tareas futuras del scope correcto; (c) ninguna preferencia puede conceder una capacidad que la política niega (test negativo).

---

## 8. Cómo colaboran y evitan trabajo duplicado

**Colaboración (✅ base / 🔜 ampliada):** a través de Hokage (planes, fases, dependencias) y del event bus. Los agentes no negocian entre sí fuera de la orquestación (evita mini-sistemas independientes, §9 del brief).

**Anti-duplicación (🟡 hoy / 🔜 objetivo):**
- Hoy: el scheduler evita crear un segundo `autonomous_run` si ya hay uno `pending/in_progress` para el agente.
- 🔜 Objetivo: **deduplicación por tarea** — antes de despachar, Hokage comprueba si un `work_item` equivalente (mismo objetivo/venture) ya existe o si un **resultado previo** (§2 capa 8) ya responde; reutiliza en vez de repetir. Evita loops, repetición inútil y generación excesiva (§7 del brief).

**Criterio de aceptación:** dos órdenes equivalentes en ventana corta no generan trabajo redundante; el segundo reutiliza el resultado del primero o se marca como duplicado.

---

## 9. Cómo razonan sobre coste/beneficio

**Hoy (✅ coste, 🔜 valor):** el coste está medido (estimado + real, por agente y venture); el presupuesto por venture es un **techo duro atómico**; `ventureOverRealBudget` corta cualquier IA si se agota.

**Objetivo (🔜) — valor esperado:** cada `work_item` lleva **prioridad/valor**; el `ModelRouter` (§4) y el scheduler lo usan para decidir **tier de modelo** y **orden**. Regla: no gastar modelo caro en tarea de bajo valor; no cortar una tarea de alto valor si hay presupuesto y la calidad lo justifica.

🔒 **Invariante:** el techo de presupuesto (venture y rol) **no** se supera por "valor"; el valor decide *dentro* del techo, no contra él.

**Criterio de aceptación:** con presupuesto disponible, una tarea de alto valor obtiene su tier; una de bajo valor se degrada o difiere; ninguna supera el techo.

---

## 10. Cómo gestionan errores y resultados malos

**Errores (✅ base):** work_item `failed` → **replan** del supervisor (Hokage genera plan alternativo); reintentos con TTL; eventos `agent.task.error`; auditoría.

**Resultados malos (🔜 objetivo):** distinto de un error técnico — un resultado que **existe pero es de baja calidad**. Objetivo:
- **Quality gate** (§4 revisión por segundo modelo) para tareas críticas antes de proponer/publicar.
- **Marcado de calidad**: un resultado puede marcarse pobre (por Jorge → feedback §7, o por un agente revisor); alimenta selección de modelo/agente futura (§3.5, §4).
- **Escalada**: fallos repetidos o baja calidad persistente → subir tier de modelo, o Decision para intervención humana (nunca bucle silencioso de gasto).

🔒 **Invariante:** ningún camino de error/reintento puede saltarse aprobaciones ni el techo de presupuesto; un fallo 3× encadenado escala a humano, no reintenta indefinidamente.

**Criterio de aceptación:** una tarea crítica con salida deficiente no se publica sin revisión; un fallo repetido genera una alerta/Decision en vez de consumir presupuesto en bucle.

---

## 11. Autonomía por agente: qué es automático, qué requiere aprobación, qué está prohibido

Niveles 0–3 (✅ `rolePolicy`/`agentAutonomy`) como **compuerta** que solo restringe:

| Nivel | Automático | Requiere aprobación | Prohibido |
|---|---|---|---|
| 0 Observador | Solo lectura | — | Acciones, decisiones |
| 1 Proponente | Trabajo operativo | Todas sus decisiones | Auto-aprobar |
| 2 Operativo | + auto-aprueba **no crítico** | Gasto, publicación, financiero, legal, riesgo alto, `entity_type` | Cruzar el suelo crítico |
| 3 Autónomo | (roles de sistema) | — | **No concedible por API** (`MAX_AUTONOMY=2`) |

**Mapa a §9 del brief:** AUTOMÁTICO = Nivel 2 no-crítico · REQUIERE REVISIÓN/APROBACIÓN = Decision pendiente · PROHIBIDO = política (allowlist/system-only).

🟡 **Hoy por-rol** (`default_autonomy`). 🔜 **Objetivo por-agente:** override por agente **más restrictivo** que su rol (nunca más permisivo — 🔒). Permite un agente "en pruebas" a Nivel 0 dentro de un rol Nivel 2.

🔒 **Invariante:** gasto, publicación y sistema **siempre** humanos; la autonomía **nunca** amplía tools ni presupuesto; el Nivel 3 nunca se concede por API ni por feedback.

**Criterio de aceptación:** un agente Nivel 2 auto-aprueba una nota de memoria pero **no** un gasto; un override por-agente a Nivel 0 impide que proponga acciones aunque su rol sea 2.

---

## 12. Herramientas y capacidades

Contrato `Tool` (✅): `inputSchema`/`outputSchema`, `permissions`, `requiredApproval`, `estimateCost`, `execute` con auditoría (nunca args/output). Allowlist `GRANTABLE_TOOLS`; `SYSTEM_ONLY_TOOLS` (`system.exec`, solo Hermes).

🔜 **Objetivo:** el **efecto** (read/operational/approval) pasa a ser **campo declarativo de la `Tool`** (hoy mapa `TOOL_EFFECTS` aparte) → un plugin nuevo declara su efecto y la autonomía lo respeta sin tocar `rolePolicy`. Loader dinámico de plugins es 🔜 (F.1). Deep-dive: [[Plugin System - Arquitectura Completa]].

🔒 **Invariante:** el modelo **nunca** obtiene una capacidad porque "decidió" usarla; el runtime/policy es el techo. Un tool desconocido cae a `operational` (conservador), nunca a `read`.

---

## 13. Decisiones (el gate humano)

Toda acción costosa/pública/de sistema → `Decision` (✅), resuelta por el seam `decisionResolvers.ts` (`entity_type → resolver`). Auto-aprobación (Nivel 2) reutiliza el **mismo** camino que la humana. 🔒 Invariante: nunca ejecución directa de lo que exige aprobación; el seam es el único punto de "aprobar X dispara Y".

---

## 14. Invariantes de seguridad/gobernanza ↔ lo que puede evolucionar

El corte que pediste, explícito.

### 🔒 INVARIANTES (no cambian por config, memoria, feedback ni "el modelo lo decidió")
- Techo de política (`GRANTABLE_TOOLS`, `SYSTEM_ONLY_TOOLS`, `MAX_AUTONOMY=2`, `MAX_BUDGET_USD`).
- Gasto/publicación/sistema **siempre** humanos; Nivel 3 no concedible por API/feedback.
- Aprobación antes de acción costosa/pública/sistema; seam único (`decisionResolvers`).
- Aislamiento por venture (memoria, coste, contexto).
- Hermes ≠ agente de negocio; `system.exec` solo Hermes, siempre *propose→approve→run*; `buildSafeExecEnv`.
- Hokage = autoridad única de orquestación; agentes no se auto-planifican globalmente.
- Precedencia de contexto y **anti-inyección**: datos nunca ascienden a instrucciones.
- Suelo de calidad por tipo de tarea (no se cruza por ahorro).
- Fuentes únicas de verdad (tipos, schema, rutas, scope de rol).
- Feedback/preferencias **nunca** relajan seguridad, política, autonomía o presupuesto.

### 🔧 EVOLUCIONABLE (vía configuración / memoria / feedback / capacidades)
- Modelo y proveedor (routing por tarea/calidad/coste).
- Composición de contexto (qué capas, recuperación por relevancia).
- Preferencias de estilo/criterio (dentro de límites no-seguridad).
- Concesión de tools (dentro de la allowlist), autonomía (≤ cap), presupuesto (≤ max).
- Contenido de memoria y de la biblioteca de conocimiento.
- Influencia de resultados previos en la selección de agente/modelo.
- Refinamiento del comportamiento del rol por **capas aditivas**, nunca por reescritura del prompt base que altere garantías.

**Regla de oro:** *el comportamiento evoluciona; las garantías no.*

---

## 15. Cómo escala a muchos agentes, departamentos y ventures

- **Roles/agentes como dato:** añadir no toca el runtime; el scheduler descubre por `role_definitions`/`agents`.
- **Departamentos tipados (🔜 Fase D):** crear un departamento = instanciar un tipo, no programar una vista.
- **Ventures:** aislamiento por `venture_id` ya estructural; nuevo negocio dentro de departamentos existentes (ADR-006).
- **Modelos/proveedores:** `AIProvider`/`ModelRouter` evitan atarse a OpenRouter o a un modelo.
- **Recuperación por relevancia (🔜):** necesaria para que el contexto no se degrade al crecer la memoria/conocimiento.
- **Techos de proceso único (⚪, ver [[Escalabilidad]]):** session store en memoria y event bus in-process deben resolverse **antes** de multi-worker en VPS; el scheduler con sharding/colas es G.2, condicional a volumen real.

🔒 **Invariante de escala:** crecer no reintroduce mini-planners por agente ni rompe el aislamiento; la autoridad de Hokage y la política se mantienen a cualquier tamaño.

---

## 16. Brechas ACTUAL → OBJETIVO (resumen para planificación)

| # | Capacidad | Actual | Objetivo | Depende de |
|---|---|---|---|---|
| C-1 | Estado de runtime por agente (para §3.5 selección y World Engine) | Inexistente | `AgentRuntimeState` real | — (habilitador) |
| C-2 | `AIProvider` abstracto | OpenRouter cableado | Interfaz + impl | — |
| C-3 | `ModelRouter` por calidad/coste | Estático por rol | Enrutado por tarea + suelo de calidad + revisión | C-2 |
| C-4 | Feedback → conocimiento | Inexistente | Pipeline + `preferences` + capa 3 | — |
| C-5 | Aporte dirigido entre agentes | Broadcast/memoria | Hand-off con permisos, capa 9 | — |
| C-6 | Recuperación por relevancia | Recencia `LIMIT 10` | FTS/relevancia | — |
| C-7 | Valor esperado en coste/scheduler | Solo techo | Prioridad/valor guía modelo y orden | C-3 |
| C-8 | Autonomía por-agente | Por-rol | Override restrictivo por agente | — |
| C-9 | Efecto de tool declarativo | Mapa aparte | Campo en `Tool` | — |
| C-10 | Anti-duplicación por tarea/resultado | Solo por-agente | Dedup por objetivo + reutilización | C-1, C-6 |

---

## 17. Dependencias entre cambios

```
C-2 (AIProvider) ─► C-3 (ModelRouter) ─► C-7 (valor esperado)
C-1 (runtime state) ─► C-10 (dedup) ◄─ C-6 (relevancia)
C-4 (feedback) ── independiente (capa 3), pero potencia C-3 (elegir tier por criticidad aprendida)
C-5 (hand-off) ── independiente; potencia C-6
C-8, C-9 ── independientes, de bajo acoplamiento
```

**Orden recomendado (a decidir contigo):** C-1 → C-2 → C-3 → C-4 → (C-5, C-6) → C-7 → (C-8, C-9, C-10). C-1 primero porque habilita selección por historial, dedup y el World Engine (documento D).

---

## 18. Riesgos

| Riesgo | Sev | Mitigación |
|---|---|---|
| El `ModelRouter` degrada calidad por ahorrar | Alto | **Suelo de calidad** invariante por taskKind; revisión por segundo modelo en críticas. |
| El feedback contamina el comportamiento (memoria basura) | Alto | Clasificación + promoción con umbral/confirmación; preferencias nunca tocan seguridad. |
| Inyección vía datos que ascienden a instrucción | Alto | Precedencia + nota anti-inyección invariantes; capas 4–10 son datos. |
| Coste desbocado por routing/valor mal calibrado | Medio | Techos duros (venture+rol) por encima del router; corte `ventureOverRealBudget`. |
| Complejidad de contexto por N capas | Medio | Recuperación por relevancia + límites por capa; el composer solo produce texto. |
| Acoplar el proveedor otra vez al añadir features | Medio | `AIProvider` como frontera; ningún servicio fuera de la capa conoce OpenRouter. |
| Regresión de seguridad al añadir adaptación | Alto | El corte §14 es un test-suite: cada capacidad evolucionable con un test negativo de que no cruza un invariante. |

---

## 19. Criterios de aceptación globales

Al implementar (en rondas posteriores), el modelo se considera cumplido cuando:
- Cambiar de proveedor/modelo no toca `agentRuntime.ts` ni los agentes (C-2/C-3).
- Una tarea trivial usa Tier B y una crítica Tier S + revisión, verificable en `agent_costs` (C-3).
- Con presupuesto ajustado, ninguna tarea baja de su suelo de calidad (C-3).
- Un feedback repetido se promueve a preferencia y modula tareas futuras del scope correcto; uno casual no (C-4).
- Ninguna preferencia/feedback concede una capacidad que la política niega (test negativo, §14).
- Un aporte dirigido llega solo al receptor correcto y nunca cruza ventures (C-5).
- Dos órdenes equivalentes no duplican trabajo (C-10).
- `tsc --noEmit`, build y suite en verde tras cada entrega; cada cambio deja constancia de problema/riesgo (§18 del brief).

---

## 20. Decisiones que este documento CONGELA

🔒 A partir de aquí, salvo nueva decisión explícita:
1. **Agente = especialización + reglas + comportamiento adaptativo por capas**, nunca por reescritura del prompt base.
2. **Precedencia de contexto** (11 capas, §2) y **anti-inyección** son invariantes; el contenido de las capas evoluciona.
3. **Selección de modelo es una decisión de runtime** (`ModelRouter`), no un atributo estático del rol; **`AIProvider`** abstrae el proveedor.
4. **Calidad primero con suelo invariante:** el ahorro nunca cruza el suelo de calidad de la tarea; las tareas críticas llevan revisión por segundo modelo.
5. **Feedback nunca es regla automática:** clasificación + promoción con umbral/confirmación; preferencias son capa acotada que jamás toca seguridad/política/presupuesto.
6. **Compartir información es dirigido y con permisos**, no broadcast; aislamiento por venture absoluto.
7. **Hokage = autoridad única de orquestación** a cualquier escala; agentes no se auto-planifican globalmente.
8. **El corte invariantes ↔ evolucionable (§14) es el contrato de seguridad del modelo**: el comportamiento evoluciona, las garantías no.

---

## 21. Decisiones ABIERTAS (para decidir juntos)

⚠️
1. **Matriz exacta del `ModelRouter`** (taskKind × complejidad × criticidad → tier) y el **suelo de calidad** por taskKind.
2. **Umbrales de promoción** de feedback a preferencia/regla.
3. **Mecánica del override de autonomía por-agente** (dónde se guarda, cómo se compone con el rol).
4. **Motor de relevancia** (FTS de SQLite vs. embeddings ligeros) para las capas 6–10.
5. **Modelo de "resultado marcado como pobre"** y cómo realimenta la selección de agente/modelo.
6. **Orden de implementación** (§17) — a fijar contigo antes de tocar código.

---

*Documento C. Próximos (uno a uno, cuando lo indiques): D `WORLD_ENGINE_SPEC`, E `MIGRATION_AND_DEPLOYMENT_SPEC`. No implementar código hasta decidir el orden (§21.6).*
