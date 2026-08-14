# BLOQUE 0 — Cierre de Decisiones Fundacionales

> Categoría: **diseño fundacional** — cierra `AgentRuntimeState`, `ModelRouter`, Quality Floors, coste, feedback y revisión antes de implementar.
> Estado: 🔒 **CONGELADO (2026-08-13)** — aprobado por Jorge. Las 6 decisiones y las 7 trampas (L1–L7) quedan como decisiones arquitectónicas del sistema, con invariantes (§G) explícitamente separadas de lo configurable/evolucionable (§H). Genera [[ADR-007 - AgentRuntimeState]], [[ADR-008 - ModelRouter y AIProvider]], [[ADR-009 - Hokage Cadena de Orquestación]], [[ADR-010 - Quality Floors, Coste y Revisión]].
> Fuentes: [[HOKAGE_OS_MASTER_SPEC]], [[HOKAGE_AGENT_OPERATING_MODEL]], [[HOKAGE_WORLD_ENGINE_SPEC]], [[HOKAGE_MIGRATION_AND_DEPLOYMENT_SPEC]], [[Auditoría de Arquitectura - 2026-08-13]] y código real.
> **No implementa nada.** Formato: para cada decisión importante — decisión · motivo · alternativas · por qué se descartan · impacto futuro.

---

## 0. Análisis crítico primero: 7 sitios donde el diseño "obvio" nos limitaría

Antes del diseño, lo que pediste: dónde una decisión aparentemente razonable **nos encierra**. Estas 7 gobiernan todo lo demás.

| # | Trampa (lo "obvio") | Por qué limita | Decisión que la evita |
|---|---|---|---|
| **L1** | `AgentRuntimeState` = un **enum plano** | No puede representar "WORKING **y** con una decisión pendiente" ni "RESEARCHING **y** con error previo" — condiciones concurrentes reales | **Estado primario (enum) + modificadores (flags)** |
| **L2** | Resolver agente por rol **1:1** (`SELECT id FROM agents WHERE role=?`, como hoy) | Bloquea "muchos agentes", "agentes creados por Jorge", "especializaciones" — habría que rehacer selección y mundo | La **selección devuelve candidatos (lista ≥1) y elige**, aunque hoy haya uno por rol |
| **L3** | `ModelRouter` alimentado por **señales ad-hoc** | Cada nuevo tipo de tarea/modelo rompe el router | Un contrato **`TaskProfile` estructurado** que Hokage produce al descomponer |
| **L4** | Modelos como **constantes en código** (`AGENT_MODELS`, `MODEL_PRICES`, `TOOL_CAPABLE_MODELS`) | Añadir modelo/proveedor = cambio de código | **Catálogo de modelos como DATO** (capacidades, precio, tier, contexto, fuerzas) |
| **L5** | Asumir que existe una **señal de "calidad del output"** | No existe y es difícil; si el diseño la da por hecha, se bloquea | Señal **por capas**: checks baratos deterministas → revisión por 2º modelo → feedback humano; scorer aprendido se aplaza |
| **L6** | `AgentRuntimeState` **persistido** como tabla mutable | Se convierte en **segunda fuente de verdad** (viola las 5 capas de D) | **Derivado** de work_items/runs/decisions + runtime en memoria; sin tabla de estado nueva en v1 |
| **L7** | Pricing/capacidades del modelo en `aiService` | Duplicación al añadir `AIProvider` | El **catálogo/proveedor** posee precio y capacidades; el dominio no |

Todo el diseño de abajo respeta estas 7. Ninguna cierra decisiones abiertas de C/D salvo donde se indica.

---

## Ω. Hokage es una CADENA DE ORQUESTACIÓN, no un ModelRouter

> Comprobación añadida y **congelada** 2026-08-13 a petición de Jorge. Gobierna todo lo demás: el ModelRouter (§B) es **una etapa** de una cadena de decisión superior que Hokage posee.

```
objetivo
 → comprensión de la tarea
 → selección de especialización/agente(s)   (capacidad → candidatos, L2)
 → contexto necesario                        (ContextComposer, C §2)
 → información reutilizable                   (dedup: resultados previos/memoria)
 → herramientas necesarias                    (por capacidad, dentro de política)
 → TaskProfile                                (§B.2)
 → selección de modelo                        (ModelRouter, §B — UNA etapa)
 → ejecución
 → evaluación                                 (señal de calidad, §F)
 → diagnóstico → remediación si procede       (escalera, §F)
 → resultado / detenerse si ya cumple el estándar
```

> **Decisión Ω.1 · La cadena es el contrato superior; el ModelRouter es una pieza.**
> **Motivo:** la calidad máxima nace de buenas decisiones en TODA la cadena, no solo del modelo. **Alternativas:** (a) Hokage = ModelRouter — descartada: reduce el sistema a un selector de modelo, pierde comprensión/contexto/colaboración/evaluación; (b) cada agente orquesta su parte — descartada: mini-planners, viola la autoridad única de orquestación. **Impacto:** cada etapa es un componente sustituible; mejorar el routing no toca la comprensión ni la evaluación.

### Piezas componibles (agente · modelo · proveedor · herramienta · venture)
Todas son **dato** o viven **tras interfaz**; añadir una **no toca el núcleo de Hokage**:
- **Agente/especialización** = fila en `role_definitions` + instancia en `agents`.
- **Modelo** = fila en el catálogo (§B.3). **Proveedor** = implementación de `AIProvider` (§B.1).
- **Herramienta** = registro en el registry (contrato `Tool`). **Venture** = fila en `ventures` (aislada).

> **Decisión Ω.2 · Crear agentes/especializaciones NO modifica el núcleo de Hokage.**
> La cadena resuelve por **capacidad requerida**, no por agente fijo. Un agente nuevo se descubre por dato (su `role_definition` declara capacidad/tools/scope); la selección lo considera candidato automáticamente. **Alternativas:** (a) un branch/handler por agente en Hokage — descartada: rework por cada agente; (b) prompt gigante con todos los agentes — descartada: no escala. **Impacto:** N agentes, agentes creados por Jorge y especializaciones nuevas, todo por dato.

### Verificación L2 — la unidad de trabajo del Runtime NO cambia para soportar composición
La unidad es un **Task** (`work_item`) con: capacidad requerida (→ candidatos), `TaskProfile`, spec de contexto, dependencias y fase. Con eso, **todo** lo siguiente se expresa **sin cambiar el contrato fundamental** del Runtime (`work_items` + `agent_id` + fase + dependencia + seam `decisionResolvers`):

| Composición futura | Cómo, sin tocar el contrato |
|---|---|
| Un agente | selección devuelve 1 candidato |
| Varios agentes | varios Tasks (misma/distinta capacidad) |
| Secuenciales | Tasks con dependencia / fases (**ya existe**) |
| En paralelo | Tasks en la misma fase sin dependencia (**ya existe**) |
| Revisión por otro agente | un Task `kind='review'` que depende de la salida del Task revisado |
| Especialista temporal | agente creado on-demand desde una `role_definition` y retirado; la selección lo trata como candidato cualquiera |

> **Decisión Ω.3 · Colaboración, revisión y paralelismo son Tasks-con-dependencias, no primitivas nuevas del Runtime.**
> **Motivo:** mantener estable el contrato del Runtime mientras la composición crece. **Alternativas:** (a) primitivas dedicadas (pipeline/parallel/review como conceptos del runtime) — descartada: infla el núcleo; (b) orquestación ad-hoc por caso — descartada: inconsistente. **Impacto:** el Runtime de hoy ya soporta conceptualmente toda la evolución de L2; solo falta que la **selección devuelva candidatos** y que Hokage **emita la cadena** — ninguno cambia el contrato.

🔒 **Invariante Ω:** la cadena de orquestación es el contrato; el ModelRouter es **una etapa**; la composición (multi/secuencial/paralelo/revisión/temporal) se expresa como **Tasks con dependencias**; añadir agente/modelo/proveedor/tool/venture es **añadir dato/impl, nunca editar el núcleo de Hokage**.

---

## A. `AgentRuntimeState` definitivo

### A.1 Contrato

```ts
interface AgentRuntimeState {
  agentId: number;
  ventureId: number | null;         // venture del trabajo ACTUAL (null = ninguno)
  primary: AgentPrimaryState;       // qué hace en PRIMER plano (enum cerrado)
  modifiers: {                      // condiciones de FONDO concurrentes (L1)
    awaitingApproval: boolean;      // tiene ≥1 Decision suya en 'proposed'
    hasError: boolean;              // último run/tarea con error
    blocked: boolean;               // bloqueada por dependencia/fase
    reviewing: boolean;             // sometida a quality gate
  };
  currentTask?: {                   // relación con tareas/runs
    workItemId: number;
    kind: string;                   // TaskKind (ver B)
    tool?: string;                  // tool activa (research/content/…)
    startedAt: string;              // ISO
  };
  activity: number;                 // 0..1, derivado de señales reales (nunca Math.random)
  since: string;                    // desde cuándo en este primary
  updatedAt: string;                // sello de captura
  source: 'runtime';                // SIEMPRE backend (invariante)
}
```

**Estados primarios (cerrado, ordenable a futuro):**
`IDLE · THINKING · RESEARCHING · WORKING · WAITING · REVIEWING · COMMUNICATING · MOVING · COMPLETED · ERROR`
Estados **de conexión** (capa de proyección del frontend, NO del agente): `UNKNOWN · STALE`.
`AWAITING_APPROVAL` y `BLOCKED` se representan como **primario** cuando son la condición dominante (nada más activo) **o** como **modificador** cuando el agente sigue trabajando en otra cosa — el mundo pinta primario + badges.

> **Decisión A.1 · Estado primario + modificadores.**
> **Motivo:** condiciones concurrentes reales (L1). **Alternativas:** (a) enum plano — descartada: no representa concurrencia; (b) lista de estados sin jerarquía — descartada: el mundo no sabría qué pintar como dominante. **Impacto futuro:** un agente nuevo o una capacidad nueva añade un modificador o un primario sin romper el contrato; el World Engine mapea primario→visual y modificador→badge (D §5).

### A.2 Derivación (backend, fuente de verdad)

| Señal real | → primary / modifier |
|---|---|
| sin work_item activo | IDLE |
| work_item `in_progress`, antes de tool | THINKING |
| tool de lectura activa | RESEARCHING |
| tool operacional activa | WORKING |
| bloqueado por dependencia | BLOCKED (o modifier.blocked) |
| quality gate en curso (F) | REVIEWING / modifier.reviewing |
| hand-off dirigido en curso (C §5) | COMMUNICATING |
| transición de sala | MOVING |
| work_item `done` (ventana breve) | COMPLETED |
| error de runtime | ERROR / modifier.hasError |
| Decision suya en `proposed` | modifier.awaitingApproval |
| activity = f(work_items activos, recencia real) | 0..1 |

> **Decisión A.2 · Derivar, no persistir (L6).**
> **Motivo:** evitar una segunda fuente de verdad (5 capas de D). **Alternativas:** (a) tabla mutable `agent_runtime_state` — descartada: drift + viola D; (b) event-sourcing puro — descartada: sobreingeniería para v1. **Impacto futuro:** si hace falta HISTÓRICO de transiciones (observabilidad), se añade un log **append-only** `agent_state_events` (como `event_log`), nunca una tabla mutable. El estado se **recalcula** desde tablas durables → correcto tras reinicio por diseño.

### A.3 Eventos y payloads

- `agent.state.changed { agentId, ventureId, from, to, workItemId?, tool?, at }` (delta primario).
- `agent.modifier.changed { agentId, modifier, value, at }` (badge de fondo).
- Ambos por el Event Bus → WebSocket (contrato de bus intacto, ADR-003).

### A.4 Transiciones válidas (guía, no candado rígido)
`IDLE → THINKING → {RESEARCHING|WORKING} → {WAITING|REVIEWING|COMPLETED|ERROR} → IDLE`; `MOVING` intercala {IDLE↔WORKING} como representación; `COMMUNICATING` puede intercalarse en cualquier tarea activa. Transiciones no listadas se registran como anomalía (audit), no se bloquean (para no frenar capacidades nuevas).

### A.5 Ciclo de vida operativo
- **Reinicio:** se recalcula desde work_items/decisions durables + reconciliación de `in_progress` huérfanos (E-pre). Sin pérdida, sin invención.
- **Desconexión:** el frontend marca STALE (último snapshot atenuado). Nunca fabrica actividad (invariante D §15).
- **Error:** primary=ERROR / modifier.hasError → dispara la escalera de remediación (F).

**Relaciones:** tareas/runs (A.2) · World Engine (única entrada; D §3-5) · WebSocket (snapshot + deltas; D §14).

---

## B. `ModelRouter` inicial + `AIProvider`

### B.1 Las tres piezas

```
Hokage (descompone) ── produce ──► TaskProfile (estructurado)
                                        │
Model Catalog (DATO) ───────────► ModelRouter (política DETERMINISTA) ──► modelo elegido (+ ¿revisión?)
                                        │
AIProvider (interfaz) ◄── ejecuta la llamada, aísla el proveedor (L7)
```

### B.2 `TaskProfile` (contrato de entrada, L3)

```ts
interface TaskProfile {
  kind: TaskKind;                          // research|content|strategy|analysis|review|classify|bulk|conversation|code|design
  complexity: 'low'|'medium'|'high';
  importance: 'low'|'medium'|'high'|'critical';   // = valor/criticidad
  needs: { reasoning?: boolean; creativity?: boolean; research?: boolean; tools?: boolean; longContext?: boolean };
  risk: 'low'|'medium'|'high';             // irreversible/público/gasto
  timeSensitivity?: 'normal'|'urgent';
}
```

> **Decisión B.2 · Hokage produce un `TaskProfile` estructurado; el router elige.**
> **Motivo:** coherente con el invariante "el LLM propone, el runtime decide" (como `validatePlan`). **Alternativas:** (a) modelo fijo por rol (hoy) — descartada: no cumple la visión; (b) el LLM elige el modelo libremente — descartada: impredecible, puede saltarse política/presupuesto, coste no acotado; (c) heurística por longitud de prompt — descartada: burda. **Impacto futuro:** el propio `TaskProfile` es mejorable por feedback (E) e historial; un tipo de tarea nuevo = un `TaskKind` nuevo (dato), no código.

### B.3 Model Catalog (DATO, L4/L7)

```ts
interface ModelDescriptor {
  id: string; provider: string; tier: 'S'|'A'|'B';
  price: { in: number; out: number };      // el catálogo posee el precio, no aiService
  contextWindow: number; supportsTools: boolean;
  strengths: { reasoning: number; creativity: number; research: number; speed: number }; // 0..1
  status: 'ready'|'deprecated';
}
```

Añadir modelo/proveedor = **una fila**. `AIProvider` (interfaz) ejecuta la llamada; OpenRouter es una implementación.

### B.4 Decisión del router (determinista)
1. `requiredTier = max(qualityFloor(kind, importance), tierByComplexity, tierByNeeds)` (suelo duro, §C).
2. Filtrar catálogo: `tier ≥ requiredTier`, `supportsTools` si `needs.tools`, `contextWindow ≥ estimado`, `strengths` sobre umbral de la dimensión dominante.
3. Elegir el **más barato** que cumpla — nunca por debajo del suelo. Presupuesto agotado → bloquea (techo duro).
4. `importance='critical'` → además programa **revisión** por un modelo distinto (§F).

### B.5 Matriz inicial (kind × importance → tier mínimo) — punto de partida, afinable

| TaskKind | low | medium | high | critical |
|---|---|---|---|---|
| classify / bulk | B | B | A | A |
| research | B | A | S | S |
| content (cara al cliente) | A | A | S | S+rev |
| strategy | S | S | S | S+rev |
| analysis | B | A | S | S |
| review (quality gate) | A | S | S | S |
| code | A | A | S | S |
| design / creative | A | A | S | S+rev |
| conversation (Hokage↔Jorge) | A | A | S | S |

(`S+rev` = tier S + revisión por 2º modelo.) Tiers hoy: **S**=`claude-sonnet-4.5` · **A**=`claude-haiku-4.5`/`gemini-2.5-flash` · **B**=`gemini-flash-1.5`/`llama-3.1-8b`.

---

## C. Quality Floors

**Definición:** un **tier mínimo por categoría** por debajo del cual el ahorro **no puede** bajar. Es una **restricción del sistema, no una preferencia** (invariante).

- Suelo = la columna de la matriz B.5 para cada `kind` a cada `importance` — con un **mínimo de sistema por categoría** que ni la config puede rebajar (p.ej. content cara-al-cliente nunca < A; strategy nunca < S).
- **Cuándo económico (B):** classify/bulk/tareas triviales sin `needs`.
- **Cuándo medio (A):** contenido/investigación/análisis estándar.
- **Cuándo premium (S):** estrategia, alta complejidad, creativo/razonamiento crítico, o `importance≥high`.
- **Cuándo 2º modelo (revisión):** `importance='critical'` o `risk='high'` o categoría marcada (publicación/financiero/legal).
- **Cuándo repetir:** solo con diagnóstico (F), nunca repetición ciega.
- **Cuándo escalar tier:** output por debajo del estándar detectado (F) + presupuesto disponible.

> **Decisión C · El suelo de calidad es una restricción, no una opción.**
> **Motivo:** "el ahorro nunca produce resultados cutres". **Alternativas:** (a) calidad como preferencia configurable a la baja — descartada: rompe la garantía; (b) sin suelo, solo presupuesto — descartada: llevaría a modelo barato en tareas que lo merecen. **Impacto futuro:** los valores del suelo son configurables **hacia arriba** por categoría; el mínimo de sistema es invariante.

---

## D. Política de coste

**Regla:** *máxima calidad dentro del coste racional de la tarea.* Concretada:

1. **Techo duro** (venture + rol) — invariante; el valor decide **dentro**, nunca contra él.
2. **Dentro del techo:** el router elige el tier que la tarea **merece** (suelo + complejidad + importancia), y luego el modelo **más barato** de ese tier.
3. **¿Merece un modelo más potente?** Escala un tier cuando `importance≥high` **y** (`complexity=high` **o** `needs.reasoning/creativity`) **y** el presupuesto lo permite. No escala para tareas de bajo valor.
4. **Estimar:** coste (catálogo B.3), valor/importancia (**campo del `TaskProfile`**, lo pone Hokage — no un ROI computado especulativo), presupuesto disponible (`ventureBudget`), riesgo de desperdicio (repetición/duplicación).
5. **Evitar llamadas innecesarias / duplicadas:** dedup por **resultado previo** + **work_item equivalente** antes de despachar (depende de A `AgentRuntimeState` + C-6 relevancia + C-5 hand-off). Cap de tool-turns ya existe (`MAX_TOOL_TURNS=3`).

> **Decisión D · Importancia como campo declarado, no ROI computado.**
> **Motivo:** un ROI real es especulativo y frágil. **Alternativas:** (a) ROI computado — descartada: falsa precisión; (b) todo al presupuesto sin valor — descartada: gasta igual en lo trivial y lo crítico. **Impacto futuro:** la importancia se afina con historial/feedback; si algún día hay señal de valor real (ingresos por tarea), se incorpora como entrada extra, sin rediseñar.

---

## E. Sistema de feedback

**Pipeline:** `captura → clasificación → evidencia → validación → promoción`.

1. **Captura:** evento ligado a la tarea/resultado concreto que lo provocó.
2. **Clasificación (LLM propone):** {puntual · preferencia temporal · preferencia persistente · regla de proyecto · aprendizaje experimental}.
3. **Evidencia:** debe referenciar el resultado concreto; **sin evidencia → solo puntual**.
4. **Validación (gate determinista):** persistente/regla requieren **umbral** (N repeticiones coherentes) **o** confirmación explícita de Jorge.
5. **Promoción:** a `preferences` (scope global/venture/rol/agente; confianza; caducidad). Entra como **capa 3** del contexto (C §2).

> **Decisión E · Ningún comentario aislado se vuelve regla global.**
> **Motivo:** aprender sin memoria basura. **Alternativas:** (a) feedback→regla inmediata — descartada: contamina; (b) ignorar feedback — descartada: no aprende. **Impacto futuro:** conflictos entre preferencias se resuelven por **especificidad + recencia**; se marcan, no se fusionan en silencio.
>
> 🔒 **Invariante (tu MAYÚSCULA):** el feedback **NUNCA** modifica automáticamente invariantes de seguridad, políticas, presupuestos ni permisos. Una preferencia solo modula estilo/criterio dentro de límites.

---

## F. Sistema de revisión y resultados pobres

**Señal de calidad (por capas, L5):**
1. **Barata/determinista:** output vacío/demasiado corto, viola schema, error de tool. (Aplicable ya.)
2. **Revisión por 2º modelo:** para `critical`/`risk=high` — un modelo distinto evalúa antes de finalizar/proponer.
3. **Feedback humano:** Jorge marca "pobre" (→ E).

**Escalera de remediación (diagnóstico, NO repetición ciega):**

| Diagnóstico | Acción |
|---|---|
| Tarea ambigua / contexto pobre | Reintentar con **contexto enriquecido** (memoria/resultados relevantes) |
| Modelo insuficiente (output superficial) | **Escalar tier** + reintentar |
| Enfoque/tool equivocado | **Cambiar estrategia** → micro-replan de Hokage |
| Irreducible / alto riesgo | **Solicitar revisión humana** (Decision) |
| Fallo repetido (3×) | **Parar + alertar** — nunca bucle |

Cada remediación está acotada por presupuesto (invariante) y se audita.

> **Decisión F · Remediación diagnóstica y acotada.**
> **Motivo:** "falló → repetir lo mismo" desperdicia y no mejora. **Alternativas:** (a) retry ciego — descartada; (b) siempre escalar a S — descartada: caro y no siempre es el problema. **Impacto futuro:** la señal de calidad evoluciona de checks baratos a un evaluador más rico sin cambiar la escalera.

---

## G. Decisiones INVARIANTES (se congelan con este bloque)

1. Backend es la **fuente de verdad** de `AgentRuntimeState`; el frontend nunca inventa.
2. **El LLM propone** (TaskProfile/plan/clasificación); **el runtime decide** (modelo/aprobación/promoción) de forma determinista.
3. **Quality floor por categoría es una restricción dura**, no opcional.
4. **Techos de presupuesto** (venture + rol) nunca se superan por lógica de valor/calidad.
5. **Feedback/preferencias nunca** tocan seguridad, política, presupuesto, permisos ni autonomía.
6. **Selección de modelo data-driven** (catálogo); proveedor tras `AIProvider`; sin acoplamiento de proveedor en el dominio.
7. `AgentRuntimeState` es **proyección derivada**, no segunda fuente de verdad.
8. **Remediación diagnóstica y acotada**, jamás bucle/retry ciego.
9. **Selección devuelve candidatos** (L2): nunca se asume 1 agente por rol en la lógica.
10. **Aislamiento por venture** en estado, coste, selección, feedback y mundo.

---

## H. Decisiones CONFIGURABLES (evolucionan por dato/config/feedback)

- Matriz del `ModelRouter` (kind×importance→tier) y valores de quality floor (≥ mínimo de sistema).
- **Catálogo de modelos** (añadir modelos/proveedores).
- Umbrales de coste/escalado, de promoción de feedback, y de disparo de revisión.
- Políticas de remediación y `TaskKind`s.
- Estados/modificadores nuevos y su lenguaje visual.

---

## I. Posibles limitaciones futuras (honestas)

1. **La señal de calidad de output es el eslabón débil** (L5): hasta tener un evaluador rico, la auto-remediación depende de checks baratos + revisión + feedback. No bloquea, pero limita la sofisticación inicial.
2. **El router es tan bueno como el `TaskProfile`** (garbage-in): un perfil pobre → routing pobre. Mitigación: el perfil es revisable/mejorable por feedback e historial.
3. **Un agente por rol hoy** (L2): mitigado si la selección devuelve lista desde el día 1; si no se hace así, es rework.
4. **`activity` 0..1 y transiciones finas** dependen del detalle de instrumentación del runtime — afinables, no bloqueantes.
5. **Coste del profiling** (tokens extra por perfil): mitigado porque el perfil es estructurado y se produce en la descomposición que Hokage ya hace.

---

## J. Riesgos arquitectónicos

| Riesgo | Mitigación |
|---|---|
| Complejidad del router creciendo sin control | Empezar con la matriz B.5 pequeña; evolucionar por config, no por código |
| Pricing/capacidades duplicados (L7) | El **catálogo** los posee; `aiService` no |
| Proyección de estado incorrecta bajo concurrencia | Derivar de tablas durables + runtime **singleton** (E §0) |
| Preferencias contradictorias | Resolución por especificidad+recencia; marcado, no fusión silenciosa |
| Sobreingeniería (state store, scorer, ROI) | YAGNI explícito: derivar estado, checks baratos, importancia declarada |
| Acoplar el proveedor otra vez al añadir features | `AIProvider` como única frontera; prohibido `fetch` a OpenRouter fuera de la impl |

---

## K. Orden exacto de implementación (del Bloque 0 al arranque del Bloque 1)

**Fase de contratos (sin cambio de comportamiento):**
- **K.1** `AIProvider` (interfaz) + **Model Catalog** como dato (mueve `AGENT_MODELS`/`MODEL_PRICES`/`TOOL_CAPABLE_MODELS` a datos). OpenRouter = una impl. *(L4/L7)*
- **K.2** Tipos `TaskProfile` y `AgentRuntimeState` + estados/modificadores (solo tipos).
- **K.3** `qualityFloor()` + `ModelRouter` deterministas (matriz B.5 como dato), con tests — **aún no conectados** al runtime (verificables en aislado).

**Arranque del Bloque 1 (comportamiento, ya con luz verde aparte):**
- **K.4** Derivación de `AgentRuntimeState` (A.2) + snapshot/deltas WS.
- **K.5** Conectar `ModelRouter` en `aiService.askAgent` (Hokage empieza a emitir `TaskProfile` en la descomposición).
- **K.6** Escalera de revisión/remediación (F) sobre señales baratas + revisión en `critical`.
- **K.7** Feedback pipeline (E) + capa `[PREFERENCIAS]`.

*(K.1-K.3 son aditivos y sin riesgo: se pueden preparar y testear sin alterar el comportamiento actual. El salto de comportamiento empieza en K.4, tras tu visto bueno.)*

---

## Compatibilidad con MASTER_SPEC / C / D / E (verificación explícita)

| Invariante de origen | ¿Compatible? |
|---|---|
| MASTER_SPEC §19 / D: frontend no inventa estado | ✅ A.1/A.2 backend como fuente; STALE/UNKNOWN en frontend |
| MASTER_SPEC / C: "LLM propone, runtime decide" | ✅ B.2 TaskProfile + router determinista; E clasifica/gate |
| C §14: comportamiento evoluciona, garantías no | ✅ G (invariantes) vs H (configurables) |
| C §4: AIProvider/ModelRouter | ✅ B (los concreta) |
| C §7/E: feedback nunca toca seguridad | ✅ E invariante |
| C §10/F: remediación diagnóstica | ✅ F escalera |
| D 5 capas / estado derivado | ✅ A.2 (L6) proyección, no 2ª verdad |
| D vocabulario cerrado de estado | ✅ A.1 amplía con modificadores sin romperlo |
| E §0/§7.4: runtime singleton, interfaces limpias | ✅ router/selección en el runtime singleton; catálogo/AIProvider como frontera |
| ADR-006 / aislamiento por venture | ✅ G.10 |

**Sin contradicciones detectadas.** Las decisiones abiertas de C/D que este bloque **necesitaba** cerrar (mapeo de estado, matriz inicial, floors, coste, feedback, revisión) quedan **propuestas aquí**; las que no necesitaba (motor de relevancia exacto, autonomía por-agente, evaluador de calidad rico) **siguen abiertas**.

---

*Bloque 0 **CONGELADO** (2026-08-13). ADRs 007-010 registrados. K.1-K.3 (aditivo, sin cambio de comportamiento) preparados; K.4+ requiere revisión y luz verde explícita. Sin push.*
