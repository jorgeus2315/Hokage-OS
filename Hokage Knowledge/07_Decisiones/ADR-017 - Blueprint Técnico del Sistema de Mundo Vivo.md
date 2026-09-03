# ADR-017 — Blueprint Técnico del Sistema de Mundo Vivo

> Categoría: decisión de arquitectura (blueprint implementable)
> Estado: ⏳ Propuesto — segunda pasada de [[ADR-016 - Hokage como Jarvis - Asistente Omnicapaz y Mundo Generativo]]. Sin implementación. 2026-09-01.
> Objetivo: dejar el sistema de mundo vivo (personajes animados, movimiento con propósito, generación de assets, edición por Hokage) suficientemente definido para construirlo por fases **sin rehacer el frontend**.

---

## 0. Hallazgo de auditoría y garantía arquitectónica

El frontend **ya es un ECS bien separado** — construir el mundo vivo es EXTENDERLO, no tirarlo:

| Pieza que ya existe | Archivo | Qué aporta al mundo vivo |
|---|---|---|
| ECS (entidades + componentes + sistemas) | `frontend/src/world/ecs/` | Entidades data-driven; el ECS **no conoce PIXI** (`Render.container: unknown`) |
| `MovementSystem` (lerp hacia `target` + trail) | `world/systems/MovementSystem.ts` | **Movimiento con propósito ya posible**: mover = fijar un `target` real, no random |
| `VisualKindRegistry` (kind→create/update Pixi) | `world/registries/VisualKindRegistry.ts` | Costura de skin: cambiar `token` (círculo) por `character` (sprite) es registrar una entrada |
| `AnimationRegistry` / `AnimationSystem` | `world/registries/`, `world/systems/` | Animaciones separadas del dibujo |
| `WorldCommand` (unión cerrada) + `EventAdapter` | `world/events/` | Puente backend→mundo extensible: añadir un acontecimiento = añadir variante |
| `AgentRuntimeState` (primary+modifiers, PURO) | `backend/src/services/agentRuntimeState.ts` | El backend ya emite **estado semántico sin coordenadas** (ADR-007) |
| WS snapshot + deltas (`agent.state.changed`) | `backend/src/server.ts`, `hooks/useWorldState.ts` | Realtime ya montado |
| `departments` (salas), `agents`, `assets` (tabla) | `backend/src/db/init.ts` | Base de datos del World Model ya empezada |

**Garantía (invariante §12):** *el backend emite SEMÁNTICA (estructura, estado, intención); el frontend posee la PRESENTACIÓN (coordenadas, sprites, animación, movimiento).* Mientras se respete esto y todo nuevo entre por **registro / componente / comando / dato**, ninguna de las capacidades futuras (personajes, generación, movimiento, edición por Hokage) obliga a reescribir. Ese es el criterio de aceptación de todo lo que sigue.

### Invariantes inquebrantables (criterio de aceptación de toda fase)

- **I1 · Separación lógica/presentación** (§12): el backend emite semántica (estructura, estado, intención); el frontend posee la presentación (coords, sprites, animación). El backend **nunca** conoce coordenadas ni sprites.
- **I2 · Verdad Visual — el mundo representa actividad REAL del sistema, nunca decorativa ni aleatoria.** Todo lo que se mueve, anima, aparece o interactúa corresponde a un **hecho real**: un estado derivado (`AgentRuntimeState`), un evento del bus, un `work_item`, un mensaje, una decisión, una venta. **Prohibido** movimiento/animación decorativo o `Math.random` que no represente un hecho real. Un token quieto significa *no hay trabajo*; un personaje que camina significa *recibió trabajo en otra sala*; una burbuja de "hablando" significa *hay un mensaje real entre dos agentes*. (Coherente con `agentRuntimeState.ts` — *"NUNCA working porque han pasado < X min"* — y con VISION.md — *"todo debe ser funcional, no decorativo"*.) Si un elemento visual no puede trazarse a un hecho del sistema, no debe existir.
- **I3 · Todo el contenido del mundo vive en DATOS, nunca en React.** Personajes, edificios, salas, objetos, comportamientos e interacciones son **datos + registros**; React solo monta el lienzo y el shell de paneles. Por eso Hokage puede crear/editar cualquier parte del mundo con tools sobre datos, sin tocar un solo componente.

## 1. World Model (definición de datos)

El World Model es la **estructura lógica** del mundo, en datos, editable. Fuente de verdad en backend; el frontend la interpreta.

| Entidad | Hoy | Extensión |
|---|---|---|
| **buildings** | `departments` (type business/system) | `building`: contiene rooms; `position` = hint de layout (dato, no lógica) |
| **rooms** | `departments` (una sala = un dept) | `room` con `building_id`, `kind`, capacidad, `slots` (workstations) |
| **agents/characters** | `agents` + roles | `character`: identidad + `skin_id` + `home_room_id` + estado |
| **objects** | — | `object`: prop/interactuable (mesa, servidor, terminal) con `room_id` + interacción opcional |
| **assets** | tabla `assets` (mínima) | ver §6: sprite/tileset/portrait con versión + metadatos |
| **animations** | `AnimationRegistry` | clips por estado (idle/walk/work/talk) referenciados por skin |
| **interactions** | — | `interaction`: agente↔agente / agente↔objeto (tipo + participantes + efecto visual). Se dispara por hechos reales (mensaje, handoff), no por reloj |
| **behaviors** | `AgentRuntimeState`→visual (implícito) | `behavior` (primera clase): reglas de un personaje/sala en **datos** — rutinas, `allowed_rooms` (salas por las que puede desplazarse), qué anim/acción por estado, con qué objetos interactúa. Es lo que consume el `BehaviorSystem` (§4); editable por Hokage sin código |
| **positions** | `layoutEngine` (frontend) | layout **autorado** opcional como dato de world-config; el runtime de negocio NUNCA lee coords |
| **states** | `AgentRuntimeState` | vocabulario extendido (§2) |
| **relationships** | implícito (rol→dept, agent→venture) | explícito: character→home_room, room→building, agent→agent (handoff/report) |

Regla: el World Model define *"la sala Investigación existe, el agente A trabaja ahí, el objeto Servidor está en esa sala"* — **nunca** *"el token está en x=412, y=300"*.

**Cobertura y edición por Hokage (I3).** El World Model puede representar TODO lo que pediste, y cada entidad tiene su **tool de edición** (§7) — Hokage edita datos hablando, React nunca:

| Entidad | Representable | Tool de Hokage (edición sin código) |
|---|---|---|
| edificios | `building` (+ layout hint) | `world.place_building` |
| habitaciones | `room` (building_id, slots) | `world.create_room` |
| personajes | `character` (skin, home_room, estado) | `character.create`, `skin.set` |
| objetos | `object` (room_id, interacción) | `world.add_object` |
| relaciones | `relationship` (character→room, agent→agent…) | `world.link` |
| comportamientos | `behavior` (rutinas, `allowed_rooms`, acción por estado) | `world.set_behavior`, `world.link_rooms` |
| interacciones | `interaction` (agente↔agente / ↔objeto) | `world.define_interaction` |
| estética/assets | `asset` + mapeo de skin | `asset.generate`, `skin.set` |

React solo monta el lienzo y el shell de paneles: **jamás contiene personajes, salas, objetos, comportamientos ni interacciones**. Todo se resuelve desde datos + registros → "editar el mundo" = "editar datos", y por eso Hokage puede hacerlo por lenguaje natural (§7), siempre con permisos/aprobación/presupuesto.

## 2. Estado vivo (backend → frontend)

Ya existe: `deriveAgentRuntimeState` produce `primary` (WORKING/IDLE/ERROR/COMPLETED) + `modifiers` (awaitingApproval, hasError, blocked*, reviewing*) + `currentTask` + `ventureId`, y `stage9` emite `agent.state.changed` por WS solo si cambió (dedupe por `stateSignature`). (*`blocked`/`reviewing` están hoy stubbed — GAP K.4.)

Extensión (nuevas transiciones **semánticas**, nunca visuales):
- Rellenar `blocked` (espera de dependencia del DAG) y `reviewing` (quality gate) — cierran los GAPs.
- Señales para `talking` (mensaje agente↔agente por el bus), `moving` (derivable en frontend: `currentTask.room ≠ home_room`), `thinking` (sub-estado opcional de WORKING antes del primer tool result).
- El contrato NO cambia: el backend dice *"A pasó a WORKING en work_item 42 de la venture V, sala Investigación"*; el frontend decide caminar, animar y burbujear.

## 3. Sistema de eventos (qué evento del backend se vuelve acontecimiento visual)

`EventAdapter.adaptEvents` ya traduce eventos del bus → `WorldCommand` (resuelve agente→rol→sala). Se extiende a una **tabla de mapeo dato-driven** evento→acontecimiento:

| Evento del bus | Acontecimiento en el mundo |
|---|---|
| `agent.task.start` | el personaje camina a su workstation + anim `work` |
| `agent.state.changed` (WORKING/IDLE/…) | cambia la animación/estado del personaje |
| `content.created`, `trend.detected` | pop de icono sobre la sala + ripple |
| `decision.created` | icono de alerta sobre el edificio (awaitingApproval) |
| `decision.approved` | efecto de "aprobado" + el ejecutor arranca |
| mensaje agente↔agente (`messages` internal) | interacción `talk` (dos personajes se acercan) |
| `sale.received` | pop de dinero en el Banco |
| `agent.task.error` | estado `error` + efecto |

Implementación: crece la unión `WorldCommand` (hoy solo `ripple`) y el `switch` de `EventAdapter` — exactamente el punto de extensión que su propio comentario anticipa.

## 4. Sistema de movimiento (con causa real, nunca random)

`MovementSystem` ya interpola hacia `target`. Falta la **causa**: un `BehaviorSystem` (frontend) que traduzca estado+mundo → target:

```
trabajo recibido (agent.state → WORKING, currentTask.room = R)
  → BehaviorSystem fija target = workstation libre en R
  → MovementSystem lo lleva (lerp existente)
  → al llegar: AnimationSystem pone anim 'work'
  → resultado (state → COMPLETED): target = spot de descanso / home
  → interacción 'talk': target = punto de encuentro con el otro agente
```

`BehaviorSystem` es **determinista** (estado → destino), sin `Math.random`. El movimiento decorativo actual (si lo hubiera) se retira. Ningún destino se inventa: sale del World Model (dónde está la sala/objeto) + el estado del agente.

## 5. Sistema de personajes (sin hardcodear en React)

Hoy un agente es `tokenVisualKind` (formas geométricas, `world/visuals/token.ts`). Extensión:
- **`characterVisualKind`**: un `VisualKindDefinition` basado en `PIXI.AnimatedSprite`, registrado en `VisualKindRegistry` junto a (o en vez de) `token`.
- **Componente `Character`** (nuevo, ECS): `{ skinId, clip, facing }` — datos, no PIXI.
- **Skin → spritesheet** vía un **registro/mapa de skins** (dato): `rol|agente → asset de sprite`. La animación (idle/walk/work/talk) la elige `AnimationSystem` según el estado visual del agente.
- React **solo monta el canvas** (`WorldCanvas.tsx`); personajes, sprites y animaciones viven en ECS + registros + datos. Nada de sprites en JSX.

## 6. Sistema de assets (futuro `asset.generate`, storage, versiones, sustitución sin código)

La tabla `assets` ya existe (mínima). Se extiende a un **almacén de assets de skin**:
- Campos: `id`, `kind` (sprite/tileset/portrait), `skin`, `target` (rol/sala/mundo), `version`, `metadata` (rejilla, paleta, nº frames, tamaños), `uri`, `checksum`, `status` (draft/approved/active).
- **Storage**: fichero en disco de la VPS (luego object storage); la BD guarda metadatos + uri.
- **Sustitución sin código**: cambiar la skin = cambiar el `asset` activo en el mapa de skins (dato) → el frontend recarga el sprite por `uri` vía el registro. Versionado = varias filas por target, una `active`.
- **`asset.generate`** (§7): prompt → proveedor de imagen → pipeline de normalización (downscale a rejilla, quantize a paleta, quitar fondo, empaquetar spritesheet) → alta como asset `draft` → aprobación → `active`.

## 7. Edición mediante Hokage (lenguaje natural → cambios seguros del World Model)

Hokage (LLM) convierte intención → **tool calls** validadas contra el esquema del World Model + permisos + presupuesto + aprobación (reutiliza tool-calling [[ADR-005 - Tool Runtime y Plugin Contract]] + [[ADR-015 ...]]):

Ejemplo *"crea un departamento de Investigación en este edificio, 3 personajes, esta estética, estas tools, que se muevan entre estas dos salas"* se descompone en:
- `world.create_room({ building, kind:'research' })`
- `character.create({ room, count:3, skin })` (×3)
- `skin.set({ target, skin })` / `asset.generate({...})`
- `agent.assign_tools({ agent, tools:[...] })`
- `world.link_rooms({ a, b })` (define un camino de movimiento permitido)

Guardarraíles: validación de esquema, autonomía por rol, `requiredApproval` para lo costoso/irreversible, presupuesto (generar imagen cuesta → `agent_costs` + reserva), y auditoría. Hokage nunca escribe React ni coordenadas — escribe **World Model (datos)**; el frontend re-interpreta.

## 8. Renderer/frontend vs backend (responsabilidades)

| Frontend (renderer) | Backend |
|---|---|
| coordenadas, sprites, animaciones, cámara, minimapa | estructura del World Model (rooms/agents/objects/relationships) |
| interpolación de movimiento, `BehaviorSystem`, partículas | estado derivado del agente (`AgentRuntimeState`) |
| layout (posiciones desde el layout lógico/autorado) | eventos del bus, lógica de negocio |
| interpretar World Model + estado → visual | presupuesto/aprobación, almacén de assets (metadatos) |

El backend **nunca** depende de coords ni sprites (ADR-007 + §12).

## 9. Persistencia (durable vs efímero)

- **Persistir (backend, durable)**: estructura del World Model (buildings/rooms/characters/objects/relationships/skin-mappings), metadatos+ficheros de assets, layout **autorado** (si Hokage "coloca aquí"), y el negocio (work_items, decisions, costs).
- **Efímero (recalculable, no se persiste)**: posición en píxeles exacta, fase de animación, trail, partículas, cámara, movimiento en vuelo, y **`AgentRuntimeState`** (derivado — ADR-007: *"el estado NO se persiste, recalculable tras reinicio"*).
- Distinción clave: **layout autorado = dato persistido** (config del mundo); **posición-píxel viva = efímera**.

## 10. Realtime (sincronizar el mundo con el estado real)

Ya existe: `initial_snapshot` (agents, departments, agent_states, work_items, ventures, recent_events) + deltas (`agent.state.changed`, decisiones…). Extensión:
- Emitir **deltas de World Model** (nueva sala/personaje/skin) como eventos de mundo.
- El mapeo evento→acontecimiento (§3) convierte eventos del bus en cambios visuales.
- Contrato: **snapshot = mundo completo; deltas = incremental semántico**. El frontend aplica snapshot → construye entidades ECS → aplica deltas. Nunca coords por el cable.

## 11. Extensibilidad (añadir sin rehacer)

Cada eje es una entrada de registro/dato — patrón ya establecido en el repo:

| Añadir… | Se hace registrando… |
|---|---|
| tipo visual (edificio/personaje/objeto) | entrada en `VisualKindRegistry` |
| animación | entrada en `AnimationRegistry` |
| acontecimiento de mundo | variante en `WorldCommand` + caso en `EventAdapter` |
| componente/comportamiento | componente ECS + `System` |
| skin/asset | fila en el almacén de assets + mapeo |
| sala/personaje/departamento | dato en el World Model |

## 12. Separación lógica/presentación (invariante inquebrantable)

- Backend = SEMÁNTICA: *estructura + estado + intención*. Nunca coords, sprites ni detalles visuales.
- Frontend = PRESENTACIÓN: interpreta el World Model + `AgentRuntimeState` en coords/sprites/anim.
- La frontera es `AgentRuntimeState` + World Model + `WorldCommand`. Respetarla es lo que garantiza que **nunca haya que rehacer el frontend** para meter personajes, generación, movimiento o edición.

## 13. Roadmap (fases pequeñas y ordenadas)

Cada fase EXTIENDE; ninguna reescribe. `NO todavía` acota el alcance.

**F0 — World Model canónico (datos).** *Objetivo:* esquema de rooms/characters/objects/relationships/skin-mapping. *Archivos:* `backend/src/db/init.ts` (migraciones aditivas), un `worldModelService`, tipos en `src/types/index.ts`. *Dependencias:* ninguna. *Tests:* validación de esquema + CRUD. *NO todavía:* sprites, generación.

**F1 — Puente estado→comportamiento (movimiento con propósito).** *Objetivo:* `BehaviorSystem` que mapea `AgentRuntimeState` + World Model → `target` de movimiento y estado visual, con el `MovementSystem` existente. *Archivos:* `world/systems/BehaviorSystem.ts`, componente `Character`/`AgentVisualState`, extensión `EventAdapter`. *Dependencias:* F0. *Tests:* mapeo estado→destino (puro, sin PIXI). *NO todavía:* sprites (siguen geométricos), generación.

**F2 — Personajes por sprite + registro de skins.** *Objetivo:* `characterVisualKind` (`AnimatedSprite`) + registro de skins (dato) + una skin de prueba (assets libres). *Archivos:* `world/visuals/character.ts`, registro de skins, cargador de assets. *Dependencias:* F0, F1. *Tests:* cambiar skin → sprite correcto. *NO todavía:* generación, edición de HUD.

**F3 — Completar estado backend.** *Objetivo:* rellenar `blocked`/`reviewing`; añadir señales `talking`/`moving`. *Archivos:* `agentRuntimeState.ts`, `eventBus`/`EventAdapter`. *Dependencias:* F1. *Tests:* derivar blocked/talking (puros). *NO todavía:* generación.

**F4 — Almacén de assets + modelo de skins.** *Objetivo:* extender tabla `assets` + mapeo de skins + versiones/metadatos. *Archivos:* `assetsService`, migración, `src/types`. *Dependencias:* F2. *Tests:* CRUD de assets + resolución de skin activa. *NO todavía:* tool de generación.

**F5 — `asset.generate` + proveedor de imagen + pipeline.** *Objetivo:* spike generativo tras presupuesto/aprobación. *Archivos:* `tools/index.ts` (asset.generate), entrada de proveedor de imagen en `aiProvider`, pipeline de normalización. *Dependencias:* F4, [[ADR-015 ...]]. *Tests:* proveedor mock → asset draft → aprobación → active (determinista, sin red). *NO todavía:* edición completa por NL.

**F6 — Tools de edición de mundo por Hokage.** *Objetivo:* `world.create_room`/`character.create`/`skin.set`/`world.link_rooms`/`agent.assign_tools`, validadas. *Archivos:* `tools/index.ts`, `worldModelService`. *Dependencias:* F0, F4, F5. *Tests:* intención (mock LLM) → mutaciones validadas + aprobación. *NO todavía:* editar HUD/comportamiento por NL.

**F7+ — Interacciones, objetos, animaciones ricas, HUD editable, voz.** Cada una es registro/dato adicional (§11).

## Relacionado
- [[ADR-016 - Hokage como Jarvis - Asistente Omnicapaz y Mundo Generativo]] — visión de producto.
- [[ADR-007 - AgentRuntimeState]] — estado derivado (la frontera semántica).
- [[ADR-001 - World Engine]] · [[ADR-005 - Tool Runtime y Plugin Contract]] · [[ADR-008 - ModelRouter y AIProvider]] · [[ADR-015 - Presupuesto y Costes - Fuente Única de Verdad e Idempotencia]] · [[VISION.md]] · [[INDEX]]
