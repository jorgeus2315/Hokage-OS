# HOKAGE OS — World Engine Spec (Representación Visual del Runtime)

> Categoría: **documento arquitectónico de subsistema** — el World Engine como proyección visual del estado REAL del Runtime.
> Estado: 🆕 Vigente (2026-08-13). Documento **D** de la preparación maestra. Deep-dive de [[HOKAGE_OS_MASTER_SPEC]] §18–§19, apoyado en [[HOKAGE_AGENT_OPERATING_MODEL]] (documento C).
> Relación: **ápice del clúster World Engine.** Reconcilia [[Frontend World Engine]], [[Frontend - Decisiones v2]], [[Crecimiento de la Ciudad - World Engine]], [[Plan de Migración ECS]], [[Baseline de Comportamiento - World Engine]], [[Ciclo Día-Noche - World Engine]] bajo un principio único: **el mundo no inventa estado.** Donde contradiga a esas notas, prevalece este documento.
> Alcance: modelo objetivo + auditoría del código actual (reutilizable vs deuda) + migración incremental + dependencias + riesgos. **No implementa código** (decisión de Jorge). Fundado en la [[Auditoría de Arquitectura - 2026-08-13]] (§3.5, C5).

**Leyenda:** ✅ existe y se conserva · 🟡 existe pero es deuda · 🔜 propuesto · 🔒 invariante · ⚠️ decisión abierta.

---

## 0. Tesis

El mundo de Hokage OS es un **videojuego de gestión (tycoon)** cuya cada píxel en movimiento corresponde a **algo real que ocurre en el Runtime**. No es una animación decorativa ni un dashboard disfrazado de mapa.

Dos hechos fundan este documento:

1. **El motor de render ya está bien construido.** El ECS (`world/ecs/`), sus sistemas, el bridge y los registries son reutilizables casi por completo (§3). No hay que reescribir el World Engine.
2. **Lo que falta está aguas arriba.** Hoy no existe un **estado de Runtime real por agente**; el frontend lo **inventa** (`useWorldState.ts`: `setInterval` + `Math.random()`, heurísticas de tiempo). El trabajo de D no es rehacer el mundo — es **definir el contrato de estado real que lo alimenta** y **borrar la simulación inventada**.

> **Principio rector (🔒, ratifica [[Núcleo - Arquitectura del Core]] §0):** si algo se mueve en el mundo es porque un estado o evento REAL del backend lo dijo. El frontend nunca fabrica actividad.

---

## 1. Las cinco capas (y por qué ninguna es fuente de verdad de otra)

El requisito central de D: separar cinco capas y **prohibir** que una se convierta accidentalmente en fuente de verdad de otra.

| # | Capa | Qué es | Dónde vive | Autoridad |
|---|---|---|---|---|
| 1 | **Fuente de verdad** | Datos durables: agents, work_items, decisions, ventures, costes, memoria | SQLite (`db/init.ts`) | La única verdad persistente |
| 2 | **Estado de Runtime** | Proyección operativa en vivo: `activeAgents`, work_item en curso por agente, tool activa, fase, y el **`AgentRuntimeState`** derivado | `agentRuntime.ts` (memoria) + BD | Derivada de 1 + ejecución; **proyección, no verdad** |
| 3 | **Event Bus** | Transporte de **cambios** (deltas) de estado y actividad | `eventBus.ts` → WS | Transporte, no almacén |
| 4 | **World Engine** | Modelo **visual**: entidades/componentes (Position, Motion, Visual, Animation…) derivados de 2/3 | `world/ecs/` (frontend) | Estado de render, **no de negocio** |
| 5 | **Presentación** | Píxeles: containers/graphics PIXI | `world/visuals/`, `WorldCanvas.tsx` | Salida pura |

**Reglas de no-contaminación (🔒):**
- **4 nunca es fuente de verdad de 2.** La `Position`/`Motion` de un token es **derivada** del estado de su agente; si el ECS y el Runtime discrepan, gana el Runtime. El mundo no "recuerda" un estado que el backend ya no reporta.
- **5 nunca calcula estado.** La presentación dibuja lo que el World Engine le da; no infiere "working" ni inventa movimiento.
- **3 nunca persiste** (su log en `event_log` es un consumidor más — [[ADR-003 - Event Bus]]).
- **2 es proyección, no segunda verdad.** `AgentRuntimeState` se **deriva** de la fuente de verdad + la ejecución; no se edita por fuera ni se guarda como si fuera autoritativo (se puede reconstruir desde 1 en cualquier momento).
- **El frontend (4/5) jamás inventa 2.** Cero `Math.random()`/`setInterval` como origen de estado.

---

## 2. Auditoría del código actual: qué se conserva, cambia, elimina, construye

Flujo actual (verificado):

```
Backend → useAppData (WS snapshot + REST)
  → useWorldState.ts  [❌ INVENTA estado: isWorking=heurística de tiempo; atHub/roomWander=setInterval+Math.random]
  → descriptores (Hub/Room/Token/RippleEvent)
  → WorldCanvas.tsx → WorldEngine (bridge) → ECS (systems) → PIXI
```

### 2.1 ✅ CONSERVAR (reutilizable, bien construido)
- **ECS núcleo** `world/ecs/` — `WorldEngine`, `EntityStore`, `ComponentStore`, `components.ts` (Position, Motion, Visual, Render, Animation, Ttl, Particle, Selectable). API congelada, extensible (`ComponentKind` es string → componente nuevo sin tocar stores), **desacoplado de PIXI** (`RenderComponent.container: unknown`). Excelente base.
- **Sistemas** `world/systems/` — Movement, RenderSync, Animation, TTL, Particle, Selection, Camera. Bien factorizados.
- **Bridge** `world/WorldEngineBridge.ts` — fachada limpia descriptores↔ECS (`upsert`/`setTarget`/`ensureVisual`/`animate`/`spawnParticle`/`setSelectable`). Es el seam correcto.
- **Registries** `world/registries/` — VisualKind/Animation/ParticleEffect. **Este es el mecanismo de extensibilidad** que pide el brief (nuevos tipos visuales/animaciones/efectos sin tocar el motor).
- **Adaptador de eventos** `world/events/` — `WorldCommand` (vocabulario cerrado) + `EventAdapter` (bus→comando: agente→rol→sala). Patrón correcto; hoy solo `'ripple'`, se **extiende** (§6), no se reemplaza.
- **`layoutEngine.ts`** — posiciona salas desde `position_locked`.
- `Math.random()` en `WorldEngineBridge:220` = id de partícula → **no es deuda**. `app.ticker` en `WorldCanvas:140` = loop de render → **correcto**.

### 2.2 🟡 ELIMINAR / REEMPLAZAR (deuda: estado inventado)
- **`useWorldState.ts:87-119`** — `atHub`/`roomWander` con `setInterval` por agente + `Math.random()`. Es la **posición/movimiento fabricados**. El propio código lo marca "DEUDA CONOCIDA". → **Eliminar**; el movimiento pasa a derivarse del estado real (§7).
- **`useWorldState.ts:55-72`** — `isWorking`/`calcActivityLevel`/`isJustActed` **infieren** estado desde `agent_runs.started_at` (heurística de tiempo). → **Reemplazar** por lectura de `AgentRuntimeState` (§4).

### 2.3 🔜 CONSTRUIR (lo que falta, aguas arriba)
- **`AgentRuntimeState`** real en backend + su contrato WS (§4). **Es el habilitador.**
- **Eventos de ciclo de vida** finos en el bus (§6).
- **`useWorldState` → mapeador puro** estado real → descriptores (sin inventar).
- **Extender `WorldCommand`** más allá de `'ripple'` (transiciones de estado, actividad de tool, hand-off, resultado) (§6).

> **Conclusión de la auditoría:** ~85% del World Engine se conserva. La migración es **quirúrgica y segura**: añadir el contrato de estado, borrar la simulación, extender el vocabulario. No es una reescritura.

---

## 3. El contrato que falta: `AgentRuntimeState`

El corazón de D. La capa 2 debe **poseer y exponer** un estado de ciclo de vida por agente, del que el mundo (capa 4) es proyección.

### 3.1 Vocabulario de estado (🔒 se congela en D)
Un conjunto **cerrado** (como `AgentEventType`/`WorldCommand`):

`IDLE · THINKING · RESEARCHING · WORKING · WAITING · REVIEWING · COMMUNICATING · MOVING · BLOCKED · AWAITING_APPROVAL · COMPLETED · ERROR`

Y dos estados **de conexión** (capa de proyección, §17), no de agente: `UNKNOWN` (sin estado aún) · `STALE` (última señal caducada por desconexión).

### 3.2 Derivación (⚠️ mapeo exacto = dependencia a cerrar con C)
`AgentRuntimeState` se **deriva** (no se inventa) de señales reales:

| Señal real (capa 1/2) | Estado |
|---|---|
| Sin work_item activo, en `activeAgents`=no | IDLE |
| work_item `in_progress`, antes de primera tool | THINKING |
| tool de lectura activa (`web.browser`/`google.trends`) | RESEARCHING |
| tool operacional activa (`content.create`…) | WORKING |
| work_item bloqueado por dependencia/otra fase | WAITING |
| tarea de revisión de la salida de otro (quality gate, C §10) | REVIEWING |
| hand-off dirigido en curso (C §5) | COMMUNICATING |
| transición de sala (representación de cambio de contexto) | MOVING |
| work_item `failed`/reintentos agotados sin replan | BLOCKED |
| Decision del agente en `proposed` (pendiente de Jorge) | AWAITING_APPROVAL |
| work_item `done` (ventana breve) | COMPLETED |
| error técnico del runtime | ERROR |

🔒 **Invariante:** la derivación vive en el **backend** (capa 2), no en el frontend. El mundo recibe el estado ya resuelto. **Dependencia (documentar, no cerrar arbitrariamente):** el mapeo fino tool→estado y los umbrales dependen de decisiones abiertas de C (§21.5 resultados pobres, §21 relevancia). D **fija el vocabulario y el principio**; el mapeo exacto se cierra junto con C antes de implementar (§20).

### 3.3 Transporte (🔜)
- **Snapshot** al conectar: `runtime_state_snapshot` (estado por agente) + `work_queue_snapshot`, cada uno con `capturedAt`.
- **Deltas** por WS: evento `agent.state.changed { agentId, from, to, workItemId?, tool?, at }` (nuevo tipo de bus, §6).
- El mundo aplica snapshot→base, deltas→incrementos. Nunca deriva estado de timestamps.

---

## 4. Entidades y componentes del mundo

Mapeo entidad de negocio → entidad ECS (extiende lo existente, no lo rompe):

| Entidad del mundo | Origen (verdad) | Entidad/Componentes ECS | Estado |
|---|---|---|---|
| **Hub (Torre Hokage)** | department `is_hub` | entity + Visual('hub') + Position | ✅ |
| **Departamento/Sala** | `departments` (type, role, pos) | entity + Visual('room') + Position + (pending marker) | ✅ / 🔜 tipo |
| **Agente (token)** | `agents` (business) + `AgentRuntimeState` | entity + Position + Motion + Visual('token') + **RuntimeState (🔜)** + Animation | 🟡→🔜 |
| **Zona** (agrupación de deptos por venture/función) | venture / grupo funcional | entity visual contenedora (🔜) | 🔜 |
| **Partícula/efecto** | evento del bus | entity + Particle + Ttl | ✅ |
| **Enlace de colaboración** | hand-off dirigido (C §5) | entity efímera + Particle-flow (🔜) | 🔜 |

**Componente nuevo (🔜) `RuntimeStateComponent { state: AgentState; activity: number; workItemId?; tool?; since }`** — lo escribe el mapeador desde el snapshot/deltas; los sistemas de animación/movimiento lo leen. `activity` (0–1) se deriva de señales reales (work_items activos del agente), **no** de `Math.random`.

🔒 **Invariante de escala:** un tipo de entidad nuevo = un `VisualKind` + (opcional) un componente. No toca el motor (§18).

---

## 5. Estados visuales, transiciones y ambientación (identidad Hokage)

Estética: sci-fi/terminal premium con la paleta **void/ember/signal**, Chakra Petch (títulos), IBM Plex Mono (datos), glow neón, corner brackets ([[design-system]]). Cada estado tiene **entrada → loop → salida**, con ease (nunca teleporta).

| Estado | Lenguaje visual (propuesta 🔜, afinable en implementación) |
|---|---|
| IDLE | Token orbita el hub, atenuado, sin glow. Sala en reposo (dim). |
| THINKING | Token en sala/hub; puntos de "pensamiento" cian pulsando lento sobre él. |
| RESEARCHING | Anillo cian con línea de escaneo; partículas de datos entrando. |
| WORKING | Anillo verde-neón pulsante estable; goteo de partículas signal. |
| WAITING | Anillo ámbar discontinuo; token quieto; sin partículas. |
| REVIEWING | Doble anillo cian junto a la salida revisada; glifo de revisión. |
| COMMUNICATING | Flujo de partículas entre dos tokens (hand-off, §10). |
| MOVING | Token en tránsito hub↔sala; trail intensificado. |
| BLOCKED | Anillo rojo discontinuo; token quieto; sin actividad. |
| AWAITING_APPROVAL | Badge ámbar de decisión pendiente; marcador en la sala; enlaza a Alertas. |
| COMPLETED | Destello breve de doble anillo ember + partícula de resultado hacia el hub; vuelve a IDLE. |
| ERROR | Glow rojo + parpadeo glitch + glifo de alerta; borde de sala destella rojo. |
| UNKNOWN/STALE | Token neutro atenuado + overlay "desconectado/desactualizado" (§17). |

**Transiciones:** un cambio de estado dispara la animación de entrada del nuevo y la salida del anterior; el `AnimationSystem` + `AnimationRegistry` ya soportan esto (una animación por `VisualKind`/estado). **Ambientación (🔜):** [[Ciclo Día-Noche - World Engine]] se ata a la hora real; la densidad de partículas/actividad de una sala se ata a sus **work_items activos reales**, no a un reloj decorativo.

---

## 6. Eventos que alimentan el mundo (extender el vocabulario)

El `EventAdapter` traduce eventos del bus a `WorldCommand`. Hoy solo `'ripple'`. Se **extiende** el union (patrón ya previsto en `WorldCommand.ts`):

| `WorldCommand` (🔜) | Origen (evento de bus) | Efecto visual |
|---|---|---|
| `ripple` ✅ | cualquier evento en una sala | onda en la sala |
| `agentState` 🔜 | `agent.state.changed` | cambia el estado visual del token (§5) |
| `toolActivity` 🔜 | `tool.started/completed` | glifo/partícula de la tool activa |
| `handoff` 🔜 | aporte dirigido (C §5) | flujo entre dos tokens |
| `result` 🔜 | work_item `done` / entregable | partícula de resultado hacia el hub/sala |
| `decisionPending` 🔜 | `decision.created` | badge AWAITING_APPROVAL |

🔒 **Invariante:** el vocabulario es **cerrado**; añadir un comando es añadir una variante, nunca un canal nuevo. El `EventAdapter` no conoce tipos de nivel app (tipado estructural — ya es así).

---

## 7. Movimiento como representación, no como fuente de verdad

Decisión de Jorge (documento C, MASTER_SPEC §18): **representación**, no literal en v1.

**Regla (🔒):** el `target` de un token lo fija el **estado**, no el azar:
- IDLE → órbita del hub. WORKING/RESEARCHING → posición de su departamento. MOVING → interpolación entre ambos. AWAITING_APPROVAL → cerca del hub.
- El `MovementSystem` interpola `Position→target` (ease frame-based, ya existe). Se elimina el `setInterval`/`Math.random` de `useWorldState`.

**Preparado para movimiento literal futuro (🔜, §18):** cuando exista "agente ubicado físicamente en el departamento X" como estado real (C §3/§5), basta con que el mapeador fije `target` a la sala real y añada un estado de ocupación; el contrato de render **no cambia**. El movimiento literal es un dato nuevo, no un motor nuevo.

---

## 8. Actividad sin ruido; evitar cuadrados vacíos, puntos flotantes y animación sin sentido

Reglas de diseño (🔒 principios, parámetros ⚠️ afinables):
- **Todo elemento visual se ata a una entidad o evento real.** No hay partículas ni animaciones "de relleno". Una sala **inactiva** está **atenuada y quieta**, con su etiqueta — nunca un cuadrado vacío animado.
- **Presupuesto de densidad por sala:** la cantidad de partículas/efectos es proporcional a los **work_items activos reales**, con **tope**. Superado el tope, se **agrega** (un glifo "N tareas" en vez de N efectos).
- **Sin puntos flotantes sin significado:** cada token = un agente real; cada partícula = un evento/flujo real; cada glow = un estado real.
- **Jerarquía de atención:** lo crítico (ERROR, AWAITING_APPROVAL) domina; lo rutinario (IDLE) se atenúa. El ojo va a lo que importa.
- **Legibilidad primero:** la estética premium nunca tapa la lectura; etiquetas legibles, contraste suficiente, no saturar con glow.

---

## 9. Inspección sin saturar la escena (los 3 niveles)

Mapea a MASTER_SPEC §13 (World / Operation / System):

| Nivel | Qué muestra | Cómo se accede |
|---|---|---|
| **1 · World** (siempre visible) | Salas, hub, tokens, estado por color/animación, densidad de actividad | La escena |
| **2 · Operation** (al seleccionar) | Tarea actual, progreso, agentes implicados, coste, decisiones de esa sala/agente | click en sala/token → panel lateral |
| **3 · System** (bajo demanda) | Contexto, memoria, modelo, tools, permisos, eventos, logs, config | overlay/menú contextual en el panel |

**Visible directo:** identidad de sala/agente, estado, actividad. **Bajo interacción:** el resto — hover (tooltip breve: estado + tarea), click (panel Operation), menú contextual/overlays activables (actividad, presupuesto, pipeline, salud por sala — ya previstos en [[Frontend World Engine]]). **Complejidad disponible, no expuesta permanentemente** (MASTER_SPEC §13).

---

## 10. Colaboración entre agentes

Cuando un agente hace un **aporte dirigido** (C §5), el mundo lo muestra como un **flujo** (comando `handoff`, §6): partículas de origen→destino entre los dos tokens, breve, con color de la señal. No es broadcast: solo aparece cuando hay una entrega real y permitida. Estado COMMUNICATING en ambos extremos durante el flujo. 🔒 Nunca cruza ventures (aislamiento).

---

## 11. Actividad de herramientas y resultados/entregables

- **Tool activa (🔜):** `toolActivity` muestra un glifo del tipo de tool sobre el token (lupa=research, pluma=contenido, terminal=system). Ata a `tool.started/completed` (ya auditados en `registry.ts`, sin exponer args/output — §15 seguridad).
- **Resultado/entregable (🔜):** `result` lanza una partícula hacia el hub/sala y, si aplica, marca un entregable inspeccionable en el panel Operation (nivel 2). Si el resultado se marca **pobre** (C §21.5, decisión abierta), el mundo puede atenuarlo/marcarlo — **cuando esa señal exista**; D no la exige (se mantiene la decisión C abierta).

---

## 12. Escalabilidad visual (muchos agentes, departamentos, ventures)

- **Clustering/LOD:** con muchos agentes por sala, se agregan en un glifo con recuento; al hacer zoom se despliegan. Tokens lejanos/al alejar cámara → render simplificado.
- **Multi-venture:** el mundo filtra por venture o muestra una **vista de conjunto** (zonas por venture). Aislamiento visual = aislamiento de datos.
- **Departamentos nuevos:** `layoutEngine` + modelo de anillos ([[Crecimiento de la Ciudad - World Engine]]) ya posiciona salas nuevas sin recolocar a mano.
- **Presupuesto de escena:** tope global de partículas/animaciones; se prioriza lo crítico y se agrega lo rutinario. El mundo sigue legible con 5 o 50 agentes.

---

## 13. Rendimiento PixiJS/ECS

- **Culling por viewport** (CameraSystem ya calcula `fitScene`): no dibujar lo fuera de cámara.
- **Pooling de partículas** (TTLSystem ya poda; añadir reuso de objetos para evitar GC churn).
- **Sin allocaciones por frame** en el hot path; mutar en sitio (el bridge ya lo hace: `setTarget` muta `node.target`).
- **Tope de partículas y de tokens animados**; LOD para el resto.
- **Tick frame-based hoy** (dt=1); si a futuro hace falta consistencia entre framerates, migrar a time-based es local al `MovementSystem`/`AnimationSystem` (nota, no bloqueante).
- **Una sola pasada de estado por frame:** snapshot/deltas se aplican fuera del ticker; el ticker solo interpola/dibuja.

---

## 14. Sincronización WS/REST y recuperación tras reconexión

- **Al conectar:** el backend envía snapshots (agents/decisions/departments ya ✅; añadir `runtime_state_snapshot` + `work_queue_snapshot` 🔜), cada uno con `capturedAt`. WS es la **fuente de tiempo real**; REST solo para arranque/detalle, **nunca en paralelo** como segunda verdad (MASTER_SPEC; [[Frontend - Decisiones v2]]).
- **En vivo:** deltas por WS (`agent.state.changed`, etc.).
- **Reconexión:** al reconectar, se **re-solicita snapshot** y se **reconcilia por reemplazo** (no merge adivinado). Los deltas perdidos durante la caída se resuelven con el snapshot nuevo, no reconstruyéndolos.

---

## 15. Comportamiento sin conexión / estados desconocidos o desactualizados

🔒 **Nunca inventar actividad durante una desconexión.**
- **WS caído:** el mundo entra en modo **STALE** — muestra el último estado conocido **atenuado**, con overlay "Desconectado del Runtime · última señal hh:mm". Los agentes **no** siguen "trabajando" ni moviéndose como si nada.
- **UNKNOWN:** un agente sin `AgentRuntimeState` aún = neutro/IDLE marcado desconocido, **no** se asume working.
- **STALE por antigüedad:** si un estado supera un umbral sin refresco, se marca desactualizado (mismo tratamiento visual).
- Al recuperar conexión: resync (snapshot) → estados vuelven a real.

---

## 16. Seguridad y aislamiento en la capa visual

- El WS ya autentica (cookie/token — MASTER_SPEC §15). El snapshot/deltas respetan **aislamiento por venture**: el mundo de un venture no filtra estado de otro.
- La actividad de tool se muestra **sin** exponer argumentos/output (coherente con la auditoría de `registry.ts`, que nunca registra args/output).
- La presentación no recibe secretos ni datos sensibles; solo estado y metadatos de actividad.

---

## 17. Extensibilidad futura (preparado desde ya)

- **Nuevos estados/animaciones/efectos:** vía `VisualKindRegistry`/`AnimationRegistry`/`ParticleEffectRegistry` — sin tocar el motor. (Ya es así.)
- **Nuevos tipos de entidad:** nuevo `VisualKind` + componente ECS.
- **Movimiento literal:** dato de ocupación real + `target` a la sala; contrato de render intacto (§7).
- **Nuevos departamentos/ventures/N agentes:** data-driven + LOD/clustering (§12).
- **Nuevos comandos de mundo:** variante en el union `WorldCommand`.

🔒 **Invariante de extensibilidad:** crecer el mundo es **añadir datos/registros**, no reescribir el motor ni introducir estado inventado.

---

## 18. Migración ACTUAL → OBJETIVO (incremental y segura)

Cada paso deja el mundo compilando y funcionando. Reutiliza el ECS; no reescribe.

| Paso | Qué | Toca | Riesgo |
|---|---|---|---|
| **D-1** | `AgentRuntimeState` en backend (derivación §3.2) + `runtime_state_snapshot` en el WS | `agentRuntime.ts`, `server.ts`, `eventBus.ts` | Bajo (aditivo, solo lectura) |
| **D-2** | Evento `agent.state.changed` (deltas) | `eventBus.ts`, `agentRuntime.ts` | Bajo |
| **D-3** | `useWorldState` → mapeador PURO estado→descriptores; **eliminar `setInterval`/`Math.random`** y heurísticas de tiempo | `useWorldState.ts` | Medio (cambia la fuente del movimiento; validación visual con Jorge) |
| **D-4** | `RuntimeStateComponent` + estados visuales §5 en `AnimationRegistry` | `world/ecs`, `world/visuals`, `world/registries` | Bajo (aditivo por registry) |
| **D-5** | Extender `WorldCommand` (`agentState`/`toolActivity`/`handoff`/`result`) + `EventAdapter` | `world/events/` | Bajo |
| **D-6** | STALE/UNKNOWN + reconexión por reemplazo | `useWebSocket`, `useAppData`, mundo | Medio |
| **D-7** | LOD/clustering + presupuesto de escena | `world/systems`, `CameraSystem` | Medio (cuando crezca N) |

🔒 **Garantía de migración:** D-1/D-2 (backend, aditivos) van **antes** que D-3 (borrar la simulación). En ningún punto el mundo queda sin fuente: primero existe el estado real, luego se desconecta el inventado. Nada de reescritura big-bang.

---

## 19. Dependencias entre A (MASTER_SPEC), C (AGENT_OPERATING_MODEL) y D

```
A (MASTER_SPEC §18/§19) ── principio "no inventar estado", contrato AgentRuntimeState
        │
C ──────┼─ C-1 (estado de runtime por agente) ES el D-1 de aquí  ◄── habilitador compartido
        ├─ C §5 (hand-off dirigido)      → D §10 (COMMUNICATING/handoff)
        ├─ C §10 (quality gate/revisión) → D REVIEWING
        ├─ C §21.5 (resultado pobre)     → D §11 (render opcional, NO exigido)
        └─ C §4 (tools activas)          → D §11 (toolActivity)
        ▼
D ── consume el estado real; NO cierra decisiones de C salvo el vocabulario de estado (§3.1),
     que D congela por ser prerrequisito duro del mundo; el mapeo fino (§3.2) se cierra con C.
```

**Dependencia dura que D revela (documentada, no cerrada arbitrariamente):** el World Engine **no puede** ser real sin `AgentRuntimeState` (C-1/D-1). Por tanto **C-1 es el primer cambio estructural de todo el proyecto** — habilita a la vez la selección de agente por historial (C §3), la deduplicación (C §10) y todo D. Las demás decisiones abiertas de C (ModelRouter, quality floors, feedback, autonomía por-agente, relevancia, resultados pobres) **siguen abiertas**; D no las necesita cerradas para arrancar.

---

## 20. Orden de implementación propuesto (NO ejecutar aún)

Combinando C y D, por dependencia y valor:

1. **D-1 / C-1 — `AgentRuntimeState` real** (backend, aditivo). Habilitador nº1. Cierra el mapeo fino §3.2 con Jorge antes de codificar.
2. **D-2 — eventos de estado** (deltas).
3. **D-3 — `useWorldState` puro + borrar simulación.** Aquí muere el `Math.random`/`setInterval`.
4. **D-4/D-5 — estados visuales + comandos extendidos.**
5. **B.2/B.3 — cerrar Hermes-kernel** (Panel de Sistema encaja como un `VisualKind` tipo 'system', §17).
6. **C-2/C-3 — `AIProvider`/`ModelRouter`** (independiente del mundo; en paralelo).
7. **D-6 — reconexión/STALE.**
8. Resto de C (feedback, hand-off→D §10, valor esperado) y D-7 (escala) según prioridad.

⚠️ El orden se **fija contigo** antes de tocar código.

---

## 21. Decisiones que D CONGELA (🔒)

1. **El mundo es proyección del Runtime real; nunca inventa estado.** Cero `Math.random`/`setInterval` como fuente. El `useWorldState` actual es deuda a eliminar.
2. **Separación estricta de 5 capas** (§1) con la regla de no-contaminación: ninguna es fuente de verdad de otra; ante discrepancia mundo↔runtime, gana el runtime.
3. **El ECS actual se conserva** (`world/ecs`, sistemas, bridge, registries, event adapter). La migración es aditiva/quirúrgica, no una reescritura.
4. **Vocabulario cerrado de estado** (§3.1, 12 estados + UNKNOWN/STALE) y **vocabulario cerrado de `WorldCommand`** extendido por variantes.
5. **Movimiento = representación del estado** (target fijado por estado), preparado para movimiento literal futuro sin cambiar el contrato de render.
6. **Todo elemento visual se ata a una entidad/evento real**; densidad proporcional a actividad real con tope y agregación; salas inactivas atenuadas, no animadas vacías.
7. **Sin conexión = STALE atenuado, nunca actividad fabricada**; UNKNOWN ≠ working.
8. **La derivación de estado vive en el backend** (capa 2), no en el frontend.
9. **La extensibilidad es data-driven** (registries + componentes), no reescritura del motor.

---

## 22. Decisiones que siguen ABIERTAS (⚠️)

**Propias de D:**
1. **Mapeo fino tool→estado y umbrales** de `AgentRuntimeState` (§3.2) — se cierra junto con C.
2. **Lenguaje visual exacto** por estado (§5) — afinable en implementación/validación visual con Jorge.
3. **Parámetros de densidad/LOD/clustering** (§12) y topes de escena.
4. **Umbral de "STALE por antigüedad"** (§15).

**De C, que permanecen abiertas (no cerradas por D):** matriz del `ModelRouter` y quality floors · umbrales de promoción de feedback · autonomía por-agente · motor de relevancia · modelo de "resultado pobre". D solo **consume** sus resultados cuando existan; render de resultado-pobre es opcional (§11).

---

*Documento D. Siguiente (cuando lo indiques): E `MIGRATION_AND_DEPLOYMENT_SPEC`. No implementar código hasta fijar el orden (§20).*
