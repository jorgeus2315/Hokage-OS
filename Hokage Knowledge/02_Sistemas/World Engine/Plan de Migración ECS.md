> 📋 **PLAN DE MIGRACIÓN — vivo, se marca fase a fase, no es una decisión congelada.** Aprobado por Jorge antes de empezar cada fase, no de golpe. Analiza `frontend/src/world/` (`WorldEngine.ts`, `WorldCanvas.tsx`, `types.ts`, `index.ts`) y `frontend/src/hooks/useWorldState.ts` tal como existen hoy (2026-08-05), verificado línea a línea, no contra la documentación previa — hay divergencias reales entre lo que [[Frontend World Engine]] describía y lo que el código hace, anotadas explícitamente abajo.

## 0. Objetivo y restricciones no negociables

Migrar a un ECS real (`EntityStore` + `ComponentStore` + `Systems` + `Registries` + `Events`) sin:
- Reescritura masiva de una sola vez.
- Romper la API pública: `WorldCanvas({ hub, rooms, tokens, events })` y `useWorldState({ departments, agents, runs, pending, liveEvents, onEnterBuilding })` **no cambian su forma** salvo que una fase concreta lo justifique explícitamente (se marca como excepción, no como regla).
- Ningún paso deja el proyecto sin compilar o sin funcionar visualmente igual que hoy.
- Patrón: **Strangler Fig** — el motor nuevo crece en paralelo, inerte al principio; cada fase migra **una sola responsabilidad** desde el closure monolítico de `WorldCanvas.tsx` hacia un System nuevo; el código viejo se apaga solo cuando el nuevo camino está verificado visualmente; el borrado final es su propia fase, no un efecto colateral de las anteriores.

**Tres requisitos añadidos por Jorge al aprobar el plan (2026-08-05), vigentes para todas las fases:**
1. [[Baseline de Comportamiento - World Engine]] — línea base numérica exacta, se usa para validar cada fase.
2. La API pública de `WorldEngine` (`createEntity`/`destroyEntity`/`addComponent`/`removeComponent`/`getComponent`/`hasComponent`/`getEntitiesWith`/`addSystem`/`dispatch`/`tick`/`clear`) se fija **completa desde la Fase 0** y no vuelve a cambiar de forma en fases posteriores, aunque la implementación interna crezca.
3. El `setInterval` por agente de `useWorldState.ts` (`atHub`/`roomWander`) se mantiene tal cual por compatibilidad — no se sustituye todavía, queda documentado en el propio código que un scheduler centralizado o un sistema de comportamiento del ECS lo reemplazará en una fase posterior explícita.

---

## 1. Mapa exacto: qué línea pertenece a qué pieza del ECS objetivo

Verificado contra el código real, no contra el diseño de hace unos días.

| Pieza objetivo | Estado real hoy | Dónde vive |
|---|---|---|
| `EntityStore` | 🔴 No existe | — |
| `ComponentStore` | 🔴 No existe | — |
| `MovementSystem` | 🟡 Existe, aislado, pero como clase legacy no-ECS | `WorldEngine.ts` completo (57 líneas: `Map<id,WorldNode>`, `upsert/setTarget/tick`, lerp `EASE=0.06`, trail cada `TRAIL_EVERY=5` frames) |
| `AnimationSystem` | 🔴 No existe como pieza — disperso | `WorldCanvas.tsx`: glow del hub (línea 451), glow/fill/bottom-bar/pulse ring de sala (509-555), ring pulsante de token (656-674), scan line (677-687) — **10 bloques de matemática de seno inline**, cada uno repitiendo el patrón `0.5 + 0.5*Math.sin(t*N)` |
| `CameraSystem` | 🔴 No existe como pieza — vive fuera del ticker | `WorldCanvas.tsx` líneas 325-371 (`onPointerDown/Move/Up`, `onWheel`) + `fitScene()` (399-419) — handlers DOM crudos que mutan `world.position`/`world.scale` directamente, nunca pasan por el ticker |
| `SelectionSystem` | 🔴 No existe — solo "click routing" | `withClick()` (39-46) adjunta `pointertap` → llama `__onClick` (guardado con `Object.assign`, no un componente real). **Cero estado de selección/hover** — el click dispara navegación directa, no hay "entidad seleccionada" en ningún sitio |
| `TTLSystem` | 🔴 No existe genérico — un solo caso hardcodeado | `WorldCanvas.tsx` 689-721: array `ripples: Ripple[]` con `startMs`, se filtra por `age >= 1` — es un TTL, pero solo sirve a ripples, no es reutilizable |
| `RenderSyncSystem` | 🟡 Existe el patrón, duplicado, no generalizado | `WorldCanvas.tsx` 476-563 (rooms) y 566-593 (tokens) — **el mismo algoritmo copiado dos veces**: `Set` de ids vistos este frame + `Map` de gráficos Pixi, crea/actualiza/destruye por diff |
| `ParticleSystem` (preparado) | 🔴 No existe como entidades — todo procedural | Los "data pulses" de los spokes (461-473) se **calculan cada frame desde `t`**, nunca se spawean/despawean como entidades. Los ripples (689-721) sí tienen ciclo de vida pero no son "partículas" genéricas |
| `DepartmentRegistry` | 🟡 Existe a medias, acoplado a React | `useWorldState.ts` 41-52: `ROOM_POS` calcula posición desde `pos_x`/`pos_y` si existen, si no, ángulo sobre un círculo de radio fijo (`ROOM_RADIUS=400`) — **no usa `position_locked`** (columna añadida en la sesión anterior, código no la lee todavía) y no tiene ningún modelo de anillos/distritos |
| `VisualKindRegistry` | 🔴 No existe — 3 funciones hardcodeadas | `buildHub()` (78-121), `buildRoom()` (123-220), `buildToken()` (222-282) — construyen gráficos Pixi por tipo fijo, sin registro, sin extensibilidad |
| `AnimationRegistry` | 🔴 No existe — no hay tabla de reacciones | El mapeo evento→efecto vive **inline** en `useWorldState.ts` 112-123 (`rippleEvents`): resuelve `agent → role → room`, produce un único tipo de comando (`RippleEvent`). No hay vocabulario `WorldCommand`, no hay `registerReaction()` |
| `Events` (Event Adapter tipado) | 🟡 Existe la idea, sin tipar | `liveEvents: WsEvent[]` (crudo del bus) entra a `useWorldState`, se traduce a `RippleEvent[]`. Es un Event Adapter real, pero no produce el vocabulario `WorldCommand` cerrado que describía el diseño original — produce un solo tipo de salida |

**Hallazgo adicional, fuera del ECS pero relevante para el orden de migración:** `useWorldState.ts` líneas 82-110 — `atHub` y `roomWander` son **N `setInterval` independientes, uno por agente**, con `Math.random()`, actualizando `useState` de React (dispara re-render de `GameLayout` en cada disparo de cada timer). Es el "deambular ocioso" que el diseño ya aceptaba como excepción cosmética — pero implementado como el mismo antipatrón de scheduling que el propio backend ya rechazó una vez (`AgentRuntime` §2). No es parte del ECS per se, pero cualquier migración de `MovementSystem`/`AnimationSystem` lo toca de cerca — se decide explícitamente en la Fase 1 si se hereda tal cual o se corrige al mudarlo.

---

## 2. Arquitectura de archivos objetivo

```
frontend/src/world/
  ecs/
    EntityStore.ts        # Map<EntityId, Set<ComponentKind>> + creación/destrucción
    ComponentStore.ts      # Map<ComponentKind, Map<EntityId, ComponentData>>
    components.ts          # Position, Motion, Visual, Status, TTL, Render, Selectable...
    System.ts               # interface System { update(world: WorldContext, dt: number): void }
  systems/
    MovementSystem.ts
    AnimationSystem.ts
    CameraSystem.ts
    SelectionSystem.ts
    TTLSystem.ts
    RenderSyncSystem.ts
    ParticleSystem.ts
  registries/
    DepartmentRegistry.ts   # posición/layout — consumidor futuro de position_locked
    VisualKindRegistry.ts   # 'hub' | 'room' | 'token' | futuros
    AnimationRegistry.ts    # tabla de reacciones evento → efecto
  events/
    WorldCommand.ts          # vocabulario cerrado, mismo espíritu que AgentEventType
    EventAdapter.ts          # WsEvent[] → WorldCommand[]
  WorldEngine.ts             # NUEVO — orquesta EntityStore+Systems+Registries. Sustituye al actual.
  WorldCanvas.tsx            # se ADELGAZA en cada fase — al final: bootstrap Pixi + host div + engine.tick()
  types.ts                  # se conserva — HubDescriptor/RoomDescriptor/TokenDescriptor siguen siendo el contrato externo
  index.ts
```

`types.ts` **no se toca** hasta que todas las fases estén verificadas — es el contrato con `useWorldState`/`GameLayout` y con `WorldCanvas`. Los tipos de componente internos (`components.ts`) son una capa nueva, no sustituyen a los descriptores públicos.

---

## 3. Fases — orden de migración, de menor a mayor riesgo

### Fase 0 — Scaffolding inerte ✅ completada (2026-08-05)

Creados `ecs/EntityStore.ts`, `ecs/ComponentStore.ts`, `ecs/components.ts`, `ecs/System.ts`, `ecs/WorldEngine.ts` (orquestador, API pública definitiva), `ecs/types.ts`, `ecs/index.ts`, `events/WorldCommand.ts`, `events/index.ts`. **Nada se conecta todavía** — ni `WorldCanvas.tsx` ni `useWorldState.ts` importan una sola línea de esto, verificado por grep antes de cerrar la fase.

**Ajuste respecto al plan original:** el nuevo `WorldEngine` (orquestador) vive en `ecs/WorldEngine.ts`, no en `world/WorldEngine.ts` — ese path sigue siendo el archivo legacy, todavía en uso real por `WorldCanvas.tsx`, y no se toca hasta la Fase 1. En la Fase 1, al conectar `WorldCanvas.tsx` al motor nuevo, se decide si se relocaliza `ecs/WorldEngine.ts` a `world/WorldEngine.ts` (sustituyendo el legacy, que se borra en la Fase 9) o si se deja donde está y solo cambia el import — decisión de esa fase, no de esta.

`systems/` y `registries/` **no se crearon vacíos** — se crean en la Fase 2 (primer System real, primer Registry real) para no tener carpetas sin contenido esperando; no cambia nada del plan, es un detalle de cuándo aparece la carpeta.

**Requisitos añadidos por Jorge, incorporados:**
1. [[Baseline de Comportamiento - World Engine]] creada antes de escribir código.
2. La API pública de `WorldEngine` (ver Fase 0, §2 de este documento) quedó fijada en `ecs/WorldEngine.ts` — no se toca de aquí en adelante salvo necesidad real descubierta en una fase posterior, que se documentaría aquí como excepción explícita.
3. `useWorldState.ts` conserva `atHub`/`roomWander` exactamente igual, con un comentario nuevo explicando por qué y cuándo se sustituirá.

- **Archivos afectados:** 9 nuevos (`frontend/src/world/ecs/*`, `frontend/src/world/events/*`), 1 modificado (`frontend/src/hooks/useWorldState.ts`, solo comentario, cero lógica).
- **Dependencias:** ninguna.
- **Checklist de validación:**
  - [x] `npx tsc --noEmit` limpio (los archivos nuevos compilan solos, sin consumidores)
  - [x] `npm run dev` arranca igual que antes — cero cambio visual, cero cambio de comportamiento (nada usa el código nuevo todavía)
  - [x] Verificado por grep: ningún archivo fuera de `world/ecs/` y `world/events/` importa el código nuevo
  - [x] `git diff` de `WorldCanvas.tsx`/`WorldEngine.ts` (legacy)/`world/index.ts`/`types.ts` vacío

### Fase 1 — `MovementSystem`

**Estado: revisión técnica ✅ · implementación ✅ · validación visual ✅** (confirmada por Jorge en conversación, 2026-08-05).

Migrada la lógica exacta de `WorldEngine.ts` (lerp `EASE=0.06`, trail `TRAIL_EVERY=5`/`TRAIL_MAX=7`) a `systems/MovementSystem.ts`, operando sobre componentes `Position`/`Motion` del `ecs/WorldEngine.ts` de la Fase 0 — nunca importa `pixi.js`, nunca conoce `color`/`label`.

**Ajuste respecto al plan original, necesario y documentado:** `WorldCanvas.tsx` **no llama directamente al `ecs/WorldEngine.ts`**. `WorldCanvas.tsx` muta en el sitio el objeto que devuelve `engine.get(id)` (`node.color = color`) esperando que esa mutación persista en `engine.all()` — un ECS con componentes desacoplados de PIXI/color/label rompería esa semántica si `WorldCanvas` hablara con él directamente sin un intermediario. Se creó `WorldEngineBridge.ts`: misma API pública exacta que el legacy (`upsert/setTarget/get/all/remove/clear/tick`, mismo shape `WorldNode`, misma semántica de "objeto mutable, la mutación persiste"), pero por dentro delega el movimiento a `MovementSystem` sobre el ECS real. `pos`/`target`/`trail` del `WorldNode` que expone son las **mismas referencias de objeto** que los componentes `Position`/`Motion` — `MovementSystem` las muta en sitio, nunca las reemplaza, así que `get()`/`all()` siempre reflejan el último `tick()`. `color`/`label` no son componentes ECS todavía (eso es `VisualComponent`, Fase 2) — el bridge los sigue gestionando como en el legacy.

**Decisión tomada:** el "deambular ocioso" (`atHub`/`roomWander`, `setInterval` por agente en `useWorldState.ts`) **se dejó exactamente igual**, con un comentario nuevo documentando que se sustituirá en una fase posterior — tal como pidió Jorge al aprobar la fase. No se tocó ninguna línea de lógica en `useWorldState.ts`, solo el comentario.

- **Archivos creados:** `world/systems/MovementSystem.ts`, `world/systems/index.ts`, `world/WorldEngineBridge.ts`.
- **Archivos modificados:** `world/WorldCanvas.tsx` (una sola línea: el import de `WorldEngine` pasa de `./WorldEngine` a `./WorldEngineBridge` — cero cambios de lógica, verificado con `git diff`), `hooks/useWorldState.ts` (un comentario, cero lógica).
- **`world/WorldEngine.ts` (el legacy, 57 líneas) no se tocó** — sigue compilando, sin usar, como red de seguridad hasta la Fase 9.
- **Dependencias:** Fase 0.

**Revisión técnica ✅ (2026-08-05, sin cambios de código):** releídos los 4 archivos en fresco, contrastadas las 9 llamadas reales de `WorldCanvas.tsx` a `engine.*` una por una contra el bridge. Confirmado: `MovementSystem` replica la matemática legacy verbatim (constantes, orden trail→lerp, orden x→y); el bridge satisface las 9 llamadas con firma/forma/semántica de mutación idénticas; sin desincronización posible entre `WorldNode` y los componentes ECS (`pos`/`target`/`trail` se mutan siempre en sitio, nunca se reemplaza la referencia — verificado en los tres puntos de escritura: `upsert`, `setTarget`, `MovementSystem.update`); sin fugas de memoria (`remove()` limpia `nodes` + todas las stores de componentes); coste de rendimiento extra real pero no crítico a la escala actual (más operaciones de `Map` por entidad que el acceso directo del legacy, un objeto `WorldContext` nuevo por frame) — mismo riesgo ya aceptado en el plan original, no una sorpresa. Nota no bloqueante para Fase 3: `ecs.elapsedSec` hoy es un contador de frames (el bridge llama `tick(1)`), no tiempo real — sin efecto porque ningún System lo lee todavía; a decidir cuando `AnimationSystem` lo necesite.

- **Checklist de validación:**
  - [x] `npx tsc --noEmit` limpio
  - [x] `git diff` de `WorldCanvas.tsx` — una sola línea (el import)
  - [x] Backend + frontend arrancan sin errores; Vite transforma los 3 módulos nuevos sin error (200 OK); sin errores en logs tras varios ciclos de runtime real
  - [x] Revisión técnica línea a línea (movimiento, compatibilidad del bridge, divergencias, referencias compartidas, memoria/rendimiento) — ver arriba
  - [x] **Validación visual manual — confirmada por Jorge en navegador:** movimiento, llegada a destino, trails, FPS, selección, cámara, consola sin errores — contra [[Baseline de Comportamiento - World Engine]].

### Fase 2 — `RenderSyncSystem` + `VisualKindRegistry`

**Estado: implementación ✅ · validación visual ✅** (confirmada por Jorge en conversación, 2026-08-05, tras la limitación real explicada abajo).

**Diseño real, con un ajuste de fondo sobre lo planeado:** `RenderSyncSystem` no solo tiene `update(ctx, dt)` (el System genérico) — tiene un método `ensure(id, kind, data, components)` **síncrono**, llamado directamente por el bridge, no solo desde `tick()`. Motivo: el código de animación que se queda en `WorldCanvas.tsx` (Fase 3 todavía) necesita leer los refs Pixi **en la misma pasada** en que hoy se crean — si la creación solo pasara por `update()`/`tick()`, habría un frame de desfase (el handle no existiría todavía cuando el código de animación intenta leerlo). `update()` sigue existiendo como barrido genérico/red de seguridad, pero en la práctica el bridge llama a `ensure()` directamente por entidad. `VisualKindHandle.create()`/`.update()` reciben ahora los mismos datos (`VisualUpdateData`) porque la sala fija su color en construcción, no después — otro ajuste real, no estaba en el boceto original.

**No se creó `MinimapRenderSystem`** — descartado tras revisar el código real: el minimapa no tiene patrón create/update/destroy (redibuja puntos desde cero cada frame sobre un único `Graphics`), no encaja con lo que `RenderSyncSystem` generaliza. Se queda en `WorldCanvas.tsx`, sin tocar.

**z-order resuelto exactamente como se planeó:** `world.sortableChildren = true`, hub/sala/token con `zIndex` 1/2/3. Las 6 capas de fondo (grid/trail/scan/ripple/orbit/spokes) se quedan en el 0 implícito — nunca se les puso zIndex, así que mantienen su orden relativo de siempre y siguen por debajo de las entidades sin tocarlas.

**Extracción de patrones duplicados:** `buildHub`/`buildRoom`/`buildToken` movidos verbatim a `visuals/hub.ts`/`room.ts`/`token.ts` — ni un trazo, alpha o número cambiado, verificado grep tras grep contra el original. El patrón `seenRooms`/`seenTokens` + Map local, duplicado dos veces en el código viejo, ya no existe como tal — sustituido por `ensureVisual`/`ensureTokenVisual` + un único `Set<string>` de ids conocidos para las salas (los tokens reutilizan `engine.all()`, que Fase 1 ya expone).

**Archivos creados:**
- `world/visuals/palette.ts` — paleta `COLOR` extraída, fuente única (antes duplicada implícitamente si se hubiera copiado)
- `world/visuals/shared.ts` — `makeText`/`withClick`/`octPoly` extraídos
- `world/visuals/hub.ts`, `room.ts`, `token.ts` — construcción Pixi verbatim + wrapper `VisualKindDefinition`
- `world/visuals/index.ts` — `registerCoreVisualKinds()`
- `world/registries/VisualKindRegistry.ts` + `index.ts`
- `world/systems/RenderSyncSystem.ts`

**Archivos modificados:**
- `world/ecs/components.ts` — `VisualComponent` gana `sublabel?: string` (hub/sala lo necesitaban, no estaba en el boceto de Fase 0)
- `world/WorldEngineBridge.ts` — añadidos `ensureVisual`/`ensureTokenVisual`/`getVisualHandle`/`removeVisual`; `remove()` (Fase 1) gana una línea (`renderSync.destroy(...)`) para no dejar containers huérfanos ahora que los tokens también son entidades de render; `clear()` gana el re-registro de `renderSync`; constructor pasa a requerir `worldContainer: PIXI.Container`. **Los métodos de movimiento de la Fase 1 no cambian una línea de lógica**, verificado.
- `world/systems/index.ts` — exporta `RenderSyncSystem`
- `world/WorldCanvas.tsx` — reescritura completa del archivo (no se podía hacer por edits parciales dado el alcance), pero cada fórmula de animación es una copia literal, solo cambia el acceso a las refs (`c.__x` → `refs.x`). `engine` se construye ahora después de `world` (antes era lo primero); nuevo `engineRef` a nivel de `useEffect` para que el cleanup pueda seguir llamando a `clear()` (antes `engine` vivía en el mismo scope que el cleanup, ahora vive dentro del IIFE async).

**`world/WorldEngine.ts` (legacy) sigue intacto y sin usar.**

**Limitación real de la validación visual, no un bloqueo:** hoy `/api/departments` solo devuelve Torre Hokage (`active=1`) — el resto siguen en niebla desde la migración de la sesión anterior (Hallazgo 2, `position_locked`/`active=0`), y La Fundación (que los revelaría) no existe todavía. Esto significa que **el código de salas (creación/actualización/destrucción vía `ensureVisual`/`removeVisual`) compila y corre, pero no se ha ejercitado visualmente en un navegador real** — solo el hub y los tokens de agentes son visibles hoy. Para probar salas de verdad, hace falta reactivar 1-2 departamentos a mano (`UPDATE departments SET active=1 WHERE key IN (...)`) antes de la validación en navegador.

- **Dependencias:** Fase 1.
- **Checklist de validación:**
  - [x] `npx tsc --noEmit` limpio
  - [x] Backend + frontend arrancan sin errores; Vite transforma los 10 módulos nuevos/modificados sin error (200 OK); sin errores en logs tras varios ciclos de runtime real
  - [x] **Validación visual manual — confirmada por Jorge en navegador**, con los 7 departamentos reactivados: z-order idéntico, glow/pulse/barra de actividad de sala sin cambios, tokens sin cambios, minimapa sincronizado, contra [[Baseline de Comportamiento - World Engine]].
  - [ ] Sin fugas de memoria — destruir y re-montar `WorldCanvas` varias veces (navegar fuera y volver al mapa) no acumula containers Pixi huérfanos (revisar con `app.stage.children.length` en consola)

### Fase 3 — `AnimationSystem` + `AnimationRegistry`

**Estado: implementación ✅ · validación visual ⏳ pendiente** (2026-08-05). `tsc` limpio, `simplify`/`find-bugs` aplicados, servidores arrancan sin errores.

**Diseño real — se hicieron las dos pasadas de una vez, no en dos tiempos como preveía el plan original:** en vez de "trasladar literal primero, generalizar a registry después", se construyó directamente `AnimationRegistry` (mismo patrón exacto que `VisualKindRegistry` de la Fase 2 — tabla `kind → behavior`) porque el coste de hacerlo bien a la primera era el mismo que hacerlo dos veces. `AnimationBehavior = (refs, state, t) => void`, un `hubAnimation`/`roomAnimation`/`tokenAnimation` por tipo visual, registrados en `registerCoreAnimations()`.

**Decisión de timing, la más importante de la fase:** `AnimationSystem` **no usa `ctx.elapsedSec`** (el contador de frames del bridge, `tick(1)` — ver nota no bloqueante de la Fase 1). Usa `performance.now()/1000`, calculado una vez por frame en `WorldCanvas.tsx` exactamente como hacía el código original, pasado como parámetro `t` explícito. Usar `elapsedSec` habría introducido una regresión real de velocidad/fase en las animaciones — descartado antes de escribir código, no encontrado después.

**Mismo patrón síncrono que `RenderSyncSystem.ensure()` (Fase 2), por el mismo motivo:** `AnimationSystem.animate(kind, refs, state, t)` se llama directamente desde el bridge (`WorldEngine.animate(id, state, t)`), en la misma pasada por entidad donde `WorldCanvas.tsx` ya animaba antes — no espera a `tick()`. `update(ctx, dt)` existe como barrido genérico (interfaz `System`) pero no recorre nada en la práctica: ninguna entidad tiene un componente `Animation` real añadido al `ComponentStore` — el estado de animación (`pending`/`active`/`hasError`/`working`/`justActed`/`action`) se pasa efímero en cada llamada directa, igual que `RenderSyncSystem.update()` tampoco es el camino primario desde la Fase 2. No se persiste `AnimationComponent` — decisión deliberada, no queda nada que migrar a un componente real hasta que algo necesite leer animación fuera de esta única pasada por frame.

**Reparto de responsabilidad, no 1:1 con el "10 bloques" original:** la burbuja de acción del token (`tip`/`bubble`, texto truncado a 20 caracteres) se movió a `tokenAnimation` junto con `ring`/`ringOuter` — depende del mismo estado por-frame (`working`/`justActed`) aunque no use `Math.sin`. La scan line (efecto global, no por-entidad) y los data pulses de los spokes (siguen leyendo `hashOffset()`, ahora importado de `visuals/shared.ts` en vez de redefinido localmente) **se quedan en `WorldCanvas.tsx`** — no son animación de una entidad ECS, son overlays a nivel de escena.

**Bug heredado, preservado a propósito:** `diamond.rotation = Math.sin(t * 6) * 0.0` en `tokenAnimation` (visuals/token.ts) siempre evalúa a `0` — código muerto en el original. Se migró verbatim, sin "arreglarlo", porque la regla de la fase es paridad exacta, no limpieza.

**Casts de tipado — un matiz real encontrado con `find-bugs`/`simplify`, no obvio de antemano:** los `refs` (formas `{glow: Graphics}`, `{ring, ringOuter, ...}`) aceptan un cast simple `as {...}` sobre `Record<string, unknown>`, igual que ya hacían `update()` de `hub.ts`/`room.ts`/`token.ts` desde la Fase 2. Los `state` (`RoomAnimationState`, `TokenAnimationState` — objetos con campos primitivos obligatorios) **no** — TypeScript rechaza el cast simple (`TS2352: neither type sufficiently overlaps`) y exige `as unknown as`. Verificado empíricamente compilando ambas variantes, no asumido.

- **Archivos creados:** `world/systems/AnimationSystem.ts`, `world/registries/AnimationRegistry.ts`.
- **Archivos modificados:**
  - `world/registries/index.ts` — exporta `AnimationRegistry`.
  - `world/systems/index.ts` — exporta `AnimationSystem`.
  - `world/visuals/shared.ts` — gana `hashOffset()` (movida desde `WorldCanvas.tsx`, antes duplicada localmente).
  - `world/visuals/hub.ts`, `room.ts`, `token.ts` — cada uno gana su `xAnimation: AnimationBehavior` (y `RoomAnimationState`/`TokenAnimationState` en room/token), junto al `xVisualKind` ya existente de la Fase 2.
  - `world/visuals/index.ts` — `registerCoreAnimations()`, mismo patrón que `registerCoreVisualKinds()`.
  - `world/WorldEngineBridge.ts` — nuevo método `animate(id, state, t)`; `AnimationSystem`/`AnimationRegistry` añadidos al constructor y a `clear()`. **Los métodos de movimiento (Fase 1) y de render (Fase 2) no cambian una línea de lógica**, verificado.
  - `world/WorldCanvas.tsx` — los 3 bloques de animación por-entidad (hub/sala/token, ~90 líneas en total) sustituidos por llamadas a `engine.animate(...)`; `hashOffset` local eliminado en favor del import desde `./visuals`; interfaces `HubRefs`/`RoomRefs` eliminadas (ya no se leen refs directamente en `WorldCanvas.tsx` para esas dos animaciones). El resto del archivo (scan line, ripples, minimapa, cámara, sincronización de posición/tint/label de token) no se tocó.
- **`world/WorldEngine.ts` (legacy) sigue intacto y sin usar.**
- **Dependencias:** Fase 2.
- **Checklist de validación:**
  - [x] `npx tsc --noEmit` limpio
  - [x] Backend + frontend arrancan sin errores; Vite transforma `WorldCanvas.tsx` y el grafo de imports sin error (200 OK en `/` y en el módulo); `/api/departments` sigue devolviendo los 7 departamentos activos, sin relación con este cambio (verificación de no-regresión)
  - [x] Revisión `find-bugs`: sin bugs reales — fórmulas y orden de llamada (antes/después de `engine.tick()`) comparados línea a línea contra el original
  - [x] Revisión `simplify`: casts `as unknown as` innecesarios en `refs` simplificados a `as` donde el compilador lo permite; sin duplicación, sin problemas de altitud
  - [ ] **Validación visual manual — pendiente de Jorge en navegador:** pulsos de hub/sala/token con el mismo timing y amplitud que antes; sala con error (`hasError`) sigue en ámbar con su pulso; sala con decisión pendiente sigue con `alertDot` parpadeante; burbuja de acción del token aparece/desaparece igual que antes — contra [[Baseline de Comportamiento - World Engine]]. No se elimina código legacy hasta confirmar esto.

### Fase 4 — `TTLSystem` + `ParticleSystem`

**Estado: implementación ✅ · validación visual ⏳ pendiente** (2026-08-05). `tsc` limpio, servidores arrancan sin errores.

**`TTLSystem` genérico, tal como pedía Jorge:** no sabe nada de partículas ni de ripples — cualquier entidad con el componente `Ttl` (ya definido desde la Fase 0, reutilizado sin modificar su forma) se autodestruye cuando `performance.now() >= expiresAtMs`. Es el primer System reutilizable fuera del dominio de render/animación: cualquier futura entidad temporal (un toast, un highlight momentáneo) lo usa gratis.

**Registro de efectos reutilizable, tal como pedía Jorge:** `ParticleEffectRegistry` (`registries/ParticleEffectRegistry.ts`), mismo patrón exacto que `VisualKindRegistry` (Fase 2) y `AnimationRegistry` (Fase 3) — tabla `kind → función de dibujo`. Hoy solo `'ripple'` está registrado (`visuals/particles.ts`), pero un efecto nuevo se añade sin tocar `ParticleSystem`.

**Componente nuevo, mínimo por diseño:** `ParticleComponent { kind, color, startMs }` — no guarda una duración redundante; la edad (0→1) se deriva en el momento de dibujar a partir de `startMs` y el `expiresAtMs` del `Ttl` emparejado (`age = (now - startMs) / (expiresAtMs - startMs)`).

**Decisión de arquitectura no trivial — dónde vive el `Graphics` de partículas:** a diferencia de `RenderSyncSystem` (que crea y añade sus propios containers Pixi al `worldContainer`), `ParticleSystem` **no crea ni posiciona su `Graphics`** — lo recibe ya construido. `WorldCanvas.tsx` sigue creando `rippleGfx` exactamente donde lo creaba antes (mismo `world.addChild(gridGfx, trailGfx, scanGfx, rippleGfx, orbit, spokes)`, mismo orden) y se lo pasa al constructor de `WorldEngine`. Motivo: las 6 capas de fondo comparten `zIndex` 0 implícito, así que su orden relativo de dibujo depende del orden de `addChild` — si `ParticleSystem` creara su propio `Graphics` dentro del constructor del motor (que se ejecuta en un punto distinto del código), `rippleGfx` cambiaría de posición relativa a `gridGfx`/`trailGfx`/`scanGfx`, una regresión visual real y silenciosa (el riesgo "Z-order silencioso" del §4 de este documento, aplicado por primera vez a un caso concreto).

**Mismo patrón síncrono que Fases 2-3, con el mismo motivo — sin necesidad de leerlo de vuelta esta vez:** `TTLSystem.prune()` y `ParticleSystem.draw()` se llaman directamente desde el bridge (`WorldEngine.syncParticles()`), en el mismo punto exacto del frame donde `WorldCanvas.tsx` dibujaba los ripples antes (después de la scan line, tras procesar los eventos nuevos). A diferencia de `ensure()`/`animate()`, aquí nadie necesita leer nada de vuelta — `syncParticles()` solo dibuja — pero se mantuvo el mismo patrón síncrono en vez de depender del barrido automático de `tick()` para no introducir un frame de retardo entre `spawnParticle()` (procesa el evento nuevo) y que el ripple aparezca dibujado. `update(ctx, dt)` existe en ambos Systems por contrato de la interfaz `System` y de hecho SÍ hace el mismo trabajo (a diferencia del `update()` verdaderamente dormant de `RenderSyncSystem`/`AnimationSystem`, porque aquí sí hay entidades `Ttl`/`Particle` reales) — se ejecuta también automáticamente dentro de `engine.tick()`, de forma redundante pero inofensiva: cualquier `draw()` de en medio del frame queda sobreescrito por el `syncParticles()` explícito antes de que Pixi presente el frame.

**No se creó `MinimapRenderSystem` en esta fase** (ya descartado en la Fase 2, sigue sin encajar con el patrón create/update/destroy). Los data pulses de los spokes **se quedan procedurales, sin migrar a partículas**, tal como preveía el plan original — no tienen ciclo de vida propio, forzarlos a entidades sería complejidad sin beneficio.

**Archivos creados:**
- `world/systems/TTLSystem.ts`
- `world/systems/ParticleSystem.ts`
- `world/registries/ParticleEffectRegistry.ts`
- `world/visuals/particles.ts` — `rippleEffect`, extraído verbatim del bucle de ripples de `WorldCanvas.tsx`

**Archivos modificados:**
- `world/ecs/components.ts` — `ComponentKinds.Particle` nuevo; `ParticleComponent` nuevo; `TtlComponent` (ya existía desde la Fase 0) reutilizado sin cambiar su forma.
- `world/registries/index.ts`, `world/systems/index.ts` — exportan `ParticleEffectRegistry`/`TTLSystem`/`ParticleSystem`.
- `world/visuals/index.ts` — `registerCoreParticleEffects()`, mismo patrón que `registerCoreVisualKinds()`/`registerCoreAnimations()`.
- `world/WorldEngineBridge.ts` — constructor gana un segundo parámetro (`particleGfx: PIXI.Graphics`); nuevos métodos `spawnParticle(kind, pos, color, durationMs)` y `syncParticles()`. **Los métodos de movimiento (Fase 1), render (Fase 2) y animación (Fase 3) no cambian una línea de lógica**, verificado.
- `world/WorldCanvas.tsx` — el array `ripples: Ripple[]` y el bucle de dibujo de ripples (~25 líneas) sustituidos por `engine.spawnParticle(...)` + `engine.syncParticles()`; `rippleGfx` se sigue creando en el mismo sitio exacto; `new WorldEngine(world)` pasa a `new WorldEngine(world, rippleGfx)`, movido a después de la creación de `rippleGfx` (sin efecto en z-order — `RenderSyncSystem`/`ParticleSystem` no hacen `addChild` en sus constructores); `RW`/`RH` (solo usados por el dibujo de ripples) eliminados por quedar sin uso (`noUnusedLocals` en `tsconfig.json`).
- **No se tocó `MovementSystem.ts`, `RenderSyncSystem.ts`, `AnimationSystem.ts`, ni el código de cámara (`onPointerDown/Move/Up`, `onWheel`, `fitScene`) — verificado explícitamente, condición puesta por Jorge al aprobar la fase.**

**`world/WorldEngine.ts` (legacy) sigue intacto y sin usar.**

- **Dependencias:** Fase 2 (RenderSync ya sabe crear/destruir entidades genéricas; el mismo `worldContainer` se sigue pasando al constructor, ahora junto a `rippleGfx`).
- **Checklist de validación:**
  - [x] `npx tsc --noEmit` limpio
  - [x] Backend + frontend arrancan sin errores; Vite transforma `WorldCanvas.tsx`, `WorldEngineBridge.ts`, `TTLSystem.ts` y `ParticleSystem.ts` sin error (200 OK); `/api/departments` sigue devolviendo los 7 departamentos activos, sin relación con este cambio (verificación de no-regresión)
  - [x] Verificado por lectura: `MovementSystem.ts`/`RenderSyncSystem.ts`/`AnimationSystem.ts` y el código de cámara/selección no tienen diffs en esta fase
  - [ ] **Validación visual manual — pendiente de Jorge en navegador:** un evento real del bus (aprobar una decisión, completar un work item) sigue disparando el ripple en la sala correcta, con el mismo timing de fade (1800ms, dos anillos escalonados, offset 0.28); el ripple se sigue dibujando en el mismo z-order relativo a grid/trail/scan/orbit/spokes; ripples viejos se limpian sin acumulación tras varios minutos con el runtime activo — contra [[Baseline de Comportamiento - World Engine]]. No se elimina código legacy hasta confirmar esto.

**Deuda técnica resuelta (2026-08-06):** `TTLSystem`/`ParticleSystem` se ejecutaban dos veces por frame. Causa: ambos `implements System` (requisito de la interfaz: `update(ctx, dt)`) y estaban registrados vía `ecs.addSystem(...)`, así que `engine.tick()` los invocaba automáticamente cada frame — a diferencia de `RenderSyncSystem`/`AnimationSystem`, cuyo `update()` es genuinamente inerte (nunca hay entidades con la combinación de componentes que barren), aquí `Ttl`/`Particle` sí tienen entidades reales (las crea `spawnParticle()`), así que ese barrido automático hacía trabajo real: podaba y redibujaba. El bridge además llamaba a `prune()`/`draw()` explícitamente desde `syncParticles()`, en el punto correcto del frame — dos fuentes de verdad para la misma responsabilidad.

Corrección: se dejó de registrar `ttl`/`particles` vía `ecs.addSystem()` — nunca estaba pensado que corrieran por el barrido automático de `tick()`, solo por la llamada síncrona. Al quedar `update(ctx, dt)` genuinamente inalcanzable, se eliminó junto con `implements System` en ambas clases (verificado que nada lee `.name` ni depende de la interfaz en ningún otro punto del código). `engine.tick()` vuelve a ejecutar exactamente los mismos 3 systems que al cerrar la Fase 3 (`movement`, `renderSync`, `animation`) — su registro, orden y comportamiento no cambian una línea. `syncParticles()` sigue en el mismo sitio exacto del frame; `prune()`/`draw()` aparecen ahora una única vez en todo `WorldEngineBridge.ts` (verificado por grep), ambas dentro de `syncParticles()`. Sin cambio visual: el dibujo que llegaba a pantalla siempre fue el de la última llamada antes de que Pixi presentara el frame — eliminar la llamada automática de en medio no cambia qué se ve, solo elimina el trabajo duplicado. Sin reestructuración de arquitectura ni complejidad añadida: es una desregistración de 4 líneas + limpieza del código ahora muerto, no un rediseño.

- **Archivos modificados:** `world/systems/TTLSystem.ts`, `world/systems/ParticleSystem.ts` (ambos pierden `implements System`/`update()`), `world/WorldEngineBridge.ts` (constructor y `clear()` dejan de registrar `ttl`/`particles`).
- **Validado:** `npx tsc --noEmit` limpio; backend+frontend arrancan sin errores, todos los módulos 200 OK vía Vite; `/api/departments` sin regresión (7/7 activos); confirmado por grep que `prune()`/`draw()` solo se llaman una vez cada uno, ambas dentro de `syncParticles()`; confirmado por lectura que `MovementSystem.ts`/`RenderSyncSystem.ts`/`AnimationSystem.ts` y el código de cámara no tienen diffs.
- **Cerrada.** No queda deuda técnica conocida pendiente antes de la Fase 5.

### Fase 5 — `CameraSystem`

**Estado: implementación ✅ · validación visual ⏳ pendiente** (2026-08-06). `tsc` limpio, servidores arrancan sin errores.

**Decisión de arquitectura, consultada antes de implementar (no es la que dice literalmente el texto original de esta sección):** el plan original decía "guarda su estado en el `EntityStore`/contexto del motor". Se confirmó con Jorge no hacerlo así — la cámara es una única instancia global, nunca un conjunto de entidades sobre las que barrer, así que modelarla como entidad/componente ECS solo añadiría una capa de indirección (`getComponent`/`addComponent` en cada evento DOM) sin ningún beneficio real: nada hace `getEntitiesWith()` sobre cámaras, no hay sweep genérico posible. `CameraSystem` es una clase plana con campos privados, inyectada con `host` (y `world` después, vía `setWorld()`), exactamente el mismo criterio de responsabilidad que `RenderSyncSystem`/`ParticleSystem` ya usan — y el mismo criterio que cerró la deuda técnica de la Fase 4 (no registrar maquinaria ECS que nada necesita). **No implementa la interfaz `System` ni se registra vía `ecs.addSystem()`.**

**`world` nullable, fijado después vía `setWorld()` — necesario para preservar el comportamiento exacto, no una elección arbitraria:** los listeners DOM se enganchan de forma síncrona al montar el componente, ANTES de que `app.init()` (asíncrono) resuelva y exista el `PIXI.Container` `world` — exactamente igual que el código legacy, que ya guardaba esto con `worldRef?.position.x ?? 0` / `if (!worldRef) return`. Si `CameraSystem` exigiera `world` en el constructor, habría que construirlo dentro del IIFE async y enganchar los listeners más tarde — un cambio real de timing, aunque imperceptible en la práctica. Se optó por preservar la estructura exacta: `camera = new CameraSystem(host)` se construye fuera del IIFE (síncrono, como antes), `camera.setWorld(world)` se llama dentro, en el mismo punto donde antes se asignaba `worldRef = world`.

**`fitScene(hub, rooms, screenW, screenH)` recibe los datos como parámetros, no los lee de un closure:** `CameraSystem` no conoce React ni `propsRef` — el call site (`WorldCanvas.tsx`) sigue leyendo `propsRef.current.hub`/`propsRef.current.rooms` exactamente donde lo hacía antes, evitando el mismo bug de closure obsoleto que el código original ya evitaba (si React re-renderiza mientras `app.init()` todavía no resuelve). Mantiene `CameraSystem` libre de acoplamiento a React, consistente con "el frontend nunca debe hacer lógica de negocio" — aquí a la inversa: un System no debe conocer el framework de UI que lo rodea.

**Referencia de función estable para add/removeEventListener:** `onPointerDown`/`onPointerMove`/`onPointerUp`/`onWheel` son class properties de tipo arrow function (no métodos de prototipo) — necesario para que `host.addEventListener(..., camera.onPointerDown)` y `host.removeEventListener(..., camera.onPointerDown)` en el cleanup apunten exactamente a la misma referencia de función por instancia, sin `.bind()` manual.

**Archivos creados:**
- `world/systems/CameraSystem.ts` — `ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_STEP`/`PAN_THRESHOLD` movidos aquí (antes en `WorldCanvas.tsx`); `onPointerDown`/`onPointerMove`/`onPointerUp`/`onWheel`/`fitScene()` extraídos verbatim.

**Archivos modificados:**
- `world/systems/index.ts` — exporta `CameraSystem`.
- `world/WorldCanvas.tsx` — los 4 handlers DOM sueltos + `fitScene()` + `panState`/`dragStart`/`worldStart`/`pendingPointerId`/`worldRef` (todo el estado de cámara) sustituidos por `const camera = new CameraSystem(host)` + `camera.setWorld(world)` + `camera.fitScene(...)` + los 4 `host.addEventListener/removeEventListener` apuntando a `camera.onX`. `worldRef` eliminado por completo (quedó sin uso — el minimapa ya leía `world.position`/`world.scale` directamente desde la constante local del IIFE, no desde `worldRef`, así que no necesitaba reemplazo). **`MovementSystem.ts`, `RenderSyncSystem.ts`, `AnimationSystem.ts`, `TTLSystem.ts`, `ParticleSystem.ts` no tienen diffs esta fase**, verificado.

**`world/WorldEngine.ts` (legacy) sigue intacto y sin usar.**

- **Dependencias:** Fase 0 solamente.
- **Checklist de validación:**
  - [x] `npx tsc --noEmit` limpio
  - [x] Backend + frontend arrancan sin errores; Vite transforma `WorldCanvas.tsx` y `CameraSystem.ts` sin error (200 OK); `/api/departments` sin regresión (7/7 activos)
  - [x] Verificado por grep: sin referencias residuales a `worldRef`/`ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_STEP`/`PAN_THRESHOLD`/`panState`/`pendingPointerId` en `WorldCanvas.tsx`
  - [x] Verificado que `MovementSystem.ts`/`RenderSyncSystem.ts`/`AnimationSystem.ts`/`TTLSystem.ts`/`ParticleSystem.ts` no se tocaron esta fase
  - [ ] **Validación visual manual — pendiente de Jorge en navegador:** pan con arrastre, zoom con rueda centrado en el cursor, `fitScene()` inicial, límites de zoom (`ZOOM_MIN=0.25`, `ZOOM_MAX=2.5`) — comportamiento idéntico contra [[Baseline de Comportamiento - World Engine]]. No se elimina código legacy hasta confirmar esto.

### Fase 6 — `SelectionSystem`

**Estado: implementación ✅ · validación visual ⏳ pendiente** (2026-08-06). `tsc` limpio, servidores arrancan sin errores.

**Alcance mínimo respetado:** el click sigue disparando exactamente el `onClick` de siempre — sin hover, sin multi-selección, sin highlight nuevo. Cambia solo quién escucha `pointertap` y cómo guarda el callback, no qué pasa al hacer click.

**Componente `Selectable` real, no solo el nombre de la fase:** desde la Fase 0, `ecs/components.ts` ya declaraba `SelectableComponent { onClick? }` con un comentario apuntando exactamente a esta fase — se usa tal cual, sin cambiar su forma. El patrón `Object.assign(container, { __onClick })` (una propiedad string sin tipar, guardada directamente sobre el container Pixi) desaparece por completo, sustituido por `ComponentStore.getComponent<SelectableComponent>(id, ComponentKinds.Selectable)`.

**Dónde se engancha el listener — la decisión no trivial de la fase:** `withClick()` (ahora `makeInteractive()`, ver abajo) se llama dentro de `create()` de cada tipo visual (`hub.ts`/`room.ts`/`token.ts`), que **no recibe el id de la entidad** (`VisualUpdateData` no lo tiene). El listener `pointertap`, en cambio, necesita saber a qué entidad pertenece el container para poder leer su componente `Selectable` por id. Se resolvió sin tocar `RenderSyncSystem.ts` ni `VisualKindRegistry.ts`: el bridge (`setSelectable()`) comprueba `!this.ecs.hasComponent(id, ComponentKinds.Selectable)` — si es la primera vez que ve esta entidad con selección, llama a `SelectionSystem.bind(handle.container, id, components)` (que sí conoce el id, porque vive en el bridge, no en `create()`); llamadas posteriores solo reescriben el componente. Mismo criterio que ya usa `setVisualComponent()` para distinguir "primera vez" de "actualización", sin añadir una rama nueva a `RenderSyncSystem.ensure()`.

**`makeInteractive()` sustituye a `withClick()` en `visuals/shared.ts`:** ya no engancha `pointertap` — solo deja el container listo para recibir eventos (`eventMode='static'`, `cursor='pointer'`). Renombrado (no solo vaciado) porque `withClick` habría sido un nombre engañoso una vez que dejó de enganchar el click. Actualizado en los 3 call sites (`hub.ts`, `room.ts`, `token.ts`).

**`SelectionSystem` NO implementa la interfaz `System` ni se registra vía `ecs.addSystem()`** — mismo criterio que `CameraSystem`/`TTLSystem`/`ParticleSystem`: no hay ningún barrido por-frame que hacer, solo un `bind()` que se llama una vez por container y una lectura del componente en el momento del click. Consistente con el criterio que cerró la deuda técnica de la Fase 4.

**Limpieza de `Selectable` al destruir una entidad — gratis, sin código nuevo:** `destroyEntity()` (en `ecs/WorldEngine.ts`) ya llama a `components.removeAllForEntity(id)`, que borra el componente `Selectable` junto con el resto — no hizo falta añadir limpieza específica en `removeVisual()`/`remove()`. Si una sala desaparece y reaparece más tarde, `ensureVisual()` crea una entidad y un container Pixi nuevos desde cero, y `setSelectable()` vuelve a hacer `bind()` sobre ese container nuevo — mismo comportamiento que el `withClick()` original, que también recreaba el binding en cada `buildRoom()` nuevo.

**Archivos creados:**
- `world/systems/SelectionSystem.ts`

**Archivos modificados:**
- `world/visuals/shared.ts` — `withClick()` → `makeInteractive()`, pierde el `pointertap`/`__onClick`.
- `world/visuals/hub.ts`, `room.ts`, `token.ts` — import y call site actualizados a `makeInteractive()`. Sin más cambios.
- `world/systems/index.ts` — exporta `SelectionSystem`.
- `world/WorldEngineBridge.ts` — nuevo método `setSelectable(id, onClick)`. **Los métodos de movimiento (Fase 1), render (Fase 2), animación (Fase 3) y partículas (Fase 4) no cambian una línea de lógica**, verificado.
- `world/WorldCanvas.tsx` — los 3 `Object.assign(handle.container, { __onClick: ... })` (hub/sala/token) sustituidos por `engine.setSelectable(id, onClick)`; las variables `hubHandle`/`handle` que solo existían para esa línea se eliminan (quedaban sin uso — `noUnusedLocals` en `tsconfig.json`).
- **`MovementSystem.ts`, `RenderSyncSystem.ts`, `AnimationSystem.ts`, `TTLSystem.ts`, `ParticleSystem.ts`, `CameraSystem.ts`, `VisualKindRegistry.ts` — cero diffs esta fase**, verificado.

**`world/WorldEngine.ts` (legacy) sigue intacto y sin usar.**

- **Dependencias:** Fase 2 (componente `Render`/container ya gestionado por `RenderSyncSystem`).
- **Checklist de validación:**
  - [x] `npx tsc --noEmit` limpio
  - [x] Backend + frontend arrancan sin errores; Vite transforma `WorldCanvas.tsx`, `WorldEngineBridge.ts` y `SelectionSystem.ts` sin error (200 OK); `/api/departments` sin regresión (7/7 activos)
  - [x] Verificado por grep: sin referencias residuales a `withClick`/`__onClick` en código real (solo comentarios explicativos que citan el patrón anterior)
  - [x] Verificado que `RenderSyncSystem.ts`/`VisualKindRegistry.ts` y el resto de Systems protegidos no tienen diffs esta fase
  - [ ] **Validación visual manual — pendiente de Jorge en navegador:** click en hub/sala/token navega exactamente igual que hoy (mismo `onEnterBuilding`); los `onClick` reflejan siempre el callback más reciente tras cambiar de venture o recargar datos — contra [[Baseline de Comportamiento - World Engine]]. No se elimina código legacy hasta confirmar esto.

### Fase 7 — `Events` tipados + `EventAdapter`

**Estado: implementación ✅ · validación visual ⏳ pendiente** (2026-08-06). `tsc` limpio, servidores arrancan sin errores.

**Desviación real respecto al texto original de esta sección, justificada:** el boceto (escrito en la Fase 0, antes de que `AnimationRegistry` tomara su forma real en la Fase 3) proponía enganchar la reacción vía `AnimationRegistry.registerReaction()`. Con `AnimationRegistry` ya construido y su propósito ya fijado (`kind → AnimationBehavior` para animar refs Pixi de una entidad, Fase 3), reutilizarlo para "evento de bus → efecto" habría mezclado dos responsabilidades bajo un mismo nombre — exactamente lo que la regla "un tool, un propósito" de [[ADR-005 - Tool Runtime y Plugin Contract]] ya prohíbe para el backend. Se optó por **no** crear un segundo Registry tampoco: con una única variante real (`'ripple'`) hoy, un Registry para un solo caso habría sido la misma sobre-ingeniería que ya se evitó al cerrar la deuda técnica de la Fase 4 — una función plana (`commandsToRippleEvents`) es la forma honesta. Se convierte en tabla/Registry el día que exista una segunda variante real, no antes.

**`WorldCommand` deja de ser un placeholder genérico:** gana su primera variante real, `RippleCommand { kind: 'ripple', id, eventType, roomId }`, sustituyendo `{ kind: string; payload?: Record<string, unknown> }`. La firma pública que la consume (`WorldEngine.dispatch(command: WorldCommand)`, ya fijada desde la Fase 0) no cambia — sigue sin tener un consumidor real (nada llama a `dispatch()` ni lee `ctx.commands` todavía); esta fase no fuerza esa integración, sería alcance fuera de lo pedido.

**`world/` sigue sin conocer tipos de nivel app:** `EventAdapter.ts` no importa `WsEvent`/`Agent`/`Building` de `shared/types` — acepta formas mínimas estructurales (`EventSource`/`AgentLookup`/`RoomLookup`), mismo criterio ya establecido en `CameraSystem.fitScene()` (Fase 5). `liveEvents`/`agents`/`ROOMS` (tipados con `shared/types`) encajan por tipado estructural sin cast.

**Archivos creados:**
- `world/events/EventAdapter.ts` — `adaptEvents()` (extraído verbatim de la traducción que vivía inline en `useWorldState.ts`) + `commandsToRippleEvents()`.

**Archivos modificados:**
- `world/events/WorldCommand.ts` — de placeholder genérico a `RippleCommand`/`WorldCommand` real.
- `world/events/index.ts` — exporta `EventAdapter`.
- `hooks/useWorldState.ts` — la traducción inline `liveEvents → RippleEvent[]` (12 líneas) sustituida por `commandsToRippleEvents(adaptEvents(liveEvents, agents, ROOMS))`. **Es la única fase que toca `useWorldState.ts` de forma no trivial**, tal como preveía el plan. El contrato público de `useWorldState` (`rippleEvents: RippleEvent[]` en la salida) no cambia una línea — `useAppData`/`GameLayout` no se tocan.

- **Dependencias:** Fase 4 (ya completada).
- **Checklist de validación:**
  - [x] `npx tsc --noEmit` limpio
  - [x] Backend + frontend arrancan sin errores; Vite transforma `useWorldState.ts`, `EventAdapter.ts` sin error (200 OK)
  - [x] Verificado por lectura: la lógica de resolución agente→rol→sala es idéntica a la que reemplaza, extraída verbatim
  - [ ] **Validación visual manual — pendiente de Jorge en navegador:** los mismos eventos reales (venta, decisión, error) siguen produciendo el mismo ripple en la misma sala que antes.

### Fase 8 (opcional, fuera del alcance estricto de "migración ECS") — `WorldLayoutEngine` real + `position_locked`

**Estado: implementación ✅ · validación visual ⏳ pendiente** (2026-08-06). `tsc` limpio, servidores arrancan sin errores. **No es parte del refactor — es la primera feature real que el ECS nuevo hace posible**, tal como preveía el plan.

**Nombre real, tomado del diseño congelado posterior, no del boceto de esta sección:** el diseño "[[Crecimiento de la Ciudad - World Engine]]" (🔒 congelado el 2026-08-05, un día después de escribirse este boceto) fija el nombre exacto `frontend/src/world/layoutEngine.ts` / `computeLayout(departments): LayoutNode[]` — no `registries/DepartmentRegistry.ts`. Se sigue el diseño más reciente y más específico, mismo criterio que ya aplicó la Fase 5 al desviarse del texto original sobre dónde vive el estado de la cámara.

**Hallazgo real encontrado al implementar, no anticipado:** `position_locked` ya lo enviaba el backend en `/api/departments` (verificado por curl esta misma sesión) pero el frontend lo descartaba en silencio — ni `Building` (`shared/types.ts`) ni la transformación en `shared/api.ts` lo declaraban. Corregido como parte de esta fase (no es alcance nuevo, es cerrar el hueco que hacía falta cerrar para que `position_locked` significara algo).

**Fase A únicamente (anillos concéntricos), tal como fija el diseño congelado.** Fases B (distritos) y C (campus) no se construyen — disparador explícito no alcanzado (7 departamentos reales hoy, muy lejos del umbral de `RING_CAPACITY = 12` por anillo).

**Cero cambio visual, verificado con datos reales, no solo razonado:** los 7 departamentos reales tienen `pos_x`/`pos_y` ya guardados (confirmado por curl a `/api/departments` en esta sesión) — todos caen en la rama "posición ya guardada" de `computeLayout()`, que devuelve esas coordenadas sin tocarlas, exactamente como hacía la rama equivalente del código que sustituye. El propio `position_locked=0` en los 7 no cambia nada hoy porque `hasStoredPos` ya es `true` para todos — el campo queda conectado y correcto, listo para cuando el modo de arrastre (Fase 7 del roadmap original de World Engine, no de esta migración) empiece a escribir `position_locked=1`.

**Archivos creados:**
- `world/layoutEngine.ts` — `LayoutNode`, `DepartmentInput` (forma mínima estructural, mismo criterio que `EventAdapter.ts`), `computeLayout()`.

**Archivos modificados:**
- `shared/types.ts` — `Building` gana `position_locked?: boolean`.
- `shared/api.ts` — `departments()` deja de descartar `position_locked` del payload real del backend.
- `world/index.ts` — exporta `layoutEngine`.
- `hooks/useWorldState.ts` — el cálculo inline de `ROOM_POS` (ángulo sobre un único anillo, sin `position_locked`) sustituido por `computeLayout(ROOMS)`. `ROOM_RADIUS` eliminado por quedar sin uso (`noUnusedLocals`).

- **Dependencias:** Fase 0-7 estables (per la regla del propio plan — no se mezcla con el refactor).
- **Checklist de validación:**
  - [x] `npx tsc --noEmit` limpio
  - [x] Backend + frontend arrancan sin errores; `/api/departments` confirma los 7 departamentos con `pos_x`/`pos_y`/`position_locked` reales, inspeccionados uno a uno
  - [x] Verificado con datos reales (no solo razonado): los 7 caen en la rama "posición ya guardada", cero cambio de coordenadas
  - [ ] **Validación visual manual — pendiente de Jorge en navegador:** el mapa se ve exactamente igual que antes de esta fase — contra [[Baseline de Comportamiento - World Engine]].

### Fase 9 — Limpieza final

**Estado: implementación ✅** (2026-08-06). Solo se borra/limpia código aquí, tal como fija el plan.

**Hallazgo real durante la limpieza, más allá de lo previsto:** el patrón `Object.assign(container, { __label, __glow, ... })` no solo vivía en el `WorldCanvas.tsx` original (ya eliminado en la Fase 2) — sobrevivía **dentro** de `visuals/hub.ts`/`room.ts`/`token.ts` como mecanismo interno para pasar refs desde `buildXContainer()` hasta el wrapper `create()` (guardar en el container, leer de vuelta con un cast `as unknown as {...}`). `room.ts` incluso mezclaba los dos patrones a la vez (unos refs devueltos directos, otros vía `Object.assign`) — inconsistencia real, no solo cosmética. Corregido en los tres archivos: `buildXContainer()` devuelve los refs directamente en su tipo de retorno; `create()` los desestructura sin cast. Mismo comportamiento exacto, cero indirección innecesaria.

**Lo que se eliminó:**
- `frontend/src/world/WorldEngine.ts` (el legacy, 57 líneas) — sustituido por completo desde la Fase 1, sin uso desde entonces, confirmado por grep antes de borrar.
- Su export en `world/index.ts` (`export * from './WorldEngine'`) — confirmado por grep que nada fuera de `world/` importaba el barrel `world/index.ts`, así que no hizo falta actualizar ningún consumidor.
- El patrón `Object.assign(container, {__x})` + cast, en los tres archivos de `visuals/` (ver hallazgo arriba).

**Lo que se dejó exactamente como estaba, por regla explícita del plan:**
- `atHub`/`roomWander` (`setInterval` por agente) en `useWorldState.ts` — la Fase 1 no decidió migrarlo, ninguna fase posterior lo decidió tampoco. Per la regla de esta misma sección ("si se dejó tal cual deliberadamente, no se borra aquí sin esa decisión explícita"), sigue vivo, con su comentario de deuda conocida intacto. Sigue siendo candidato real para un `BehaviorSystem`/scheduler centralizado futuro, ahora fuera del alcance de esta migración ECS — ver [[Master Roadmap - v1]].

**Checklist de validación de cierre — con una desviación honesta, no oculta:**
- [x] `grep -r "WorldEngine" frontend/src/world` — el archivo viejo (`world/WorldEngine.ts`) no existe; los matches restantes son `world/ecs/WorldEngine.ts` (el orquestador ECS real, correcto) y `WorldEngineBridge.ts` (el bridge, correcto)
- [x] `grep -r "__label\|__glow\|__ring"` (y el resto de nombres `__x` de los tres tipos visuales) `frontend/src/world` — sin coincidencias de código real, solo un comentario en `ecs/components.ts` que documenta el patrón ya sustituido
- [x] `npx tsc --noEmit` limpio
- [ ] **`WorldCanvas.tsx` por debajo de ~100 líneas — NO alcanzado, 374 líneas, y no se fuerza.** El objetivo de ~100 líneas se escribió en la Fase 0, antes de que las Fases 2-6 confirmaran, con razonamiento explícito cada vez, qué se queda legítimamente fuera del ECS: grid, trail, scan line, spokes/data-pulses y minimapa son overlays de escena, no animación por-entidad — no encajan en ningún System sin forzar el patrón (ya se descartó explícitamente un `MinimapRenderSystem` en la Fase 2 por este motivo). Reducir `WorldCanvas.tsx` por debajo de 100 líneas exigiría mover esa lógica a algún sitio de todas formas, no eliminarla — y hacerlo solo para cumplir un número estimado antes de conocer el alcance real sería la misma sobre-ingeniería que el resto de esta migración ha evitado activamente. Las 374 líneas reflejan el alcance legítimo que sigue siendo de escena, no deuda sin migrar.
  - [x] Backend + frontend arrancan sin errores; Vite transforma todos los módulos tocados sin error (200 OK); `/api/departments` sin regresión (7/7 activos, posiciones intactas)
  - [ ] **Sesión completa de humo en navegador — pendiente de Jorge:** navegar todas las vistas, entrar/salir de 3+ salas, dejar correr 5 minutos con el runtime activo, sin errores de consola ni fugas de memoria visibles. No hay herramienta de navegador disponible en esta sesión para hacerlo de forma automática.

**Nota de honestidad sobre validaciones visuales previas:** las Fases 3, 4, 5 y 6 quedan con su casilla de validación visual manual todavía sin marcar en este documento — las Fases 1 y 2 sí fueron confirmadas explícitamente por Jorge en conversación en su momento (y se marcan aquí, ver arriba), pero no hay confirmación equivalente registrada para 3-6. La instrucción de cerrar las Fases 7-9 se trata como autorización para avanzar pese a esas casillas pendientes — no como una confirmación retroactiva que no ocurrió. Con las Fases 7-9 ya cerradas y los 7 departamentos reales visibles simultáneamente, una única sesión de validación visual completa (en vez de fase por fase, con departamentos parcialmente en niebla como pasaba en la Fase 2) es ahora la mejor oportunidad real de validar todo el motor de una vez.

---

## 4. Riesgos generales de toda la migración (no específicos de una fase)

1. **Z-order silencioso.** Pixi dibuja por orden de `addChild`; el ECS reparte esa responsabilidad entre systems que corren en secuencias distintas. Mitigación ya integrada en la Fase 2: `zIndex` explícito, nunca implícito.
2. **`propsRef.current` es el mecanismo que evita que React re-renderice el canvas Pixi en cada frame.** Cualquier System que lea props debe seguir leyendo la versión más reciente sin capturar un valor obsoleto en closure — auditar explícitamente en cada fase que toque cómo se leen `hub`/`rooms`/`tokens`/`events`.
3. **Identidad de callbacks (`onClick`) cambia en cada render de React** (son arrow functions nuevas cada vez) — el ECS debe seguir leyendo el callback más reciente cada frame/click, no cachear el de cuando la entidad se creó. Riesgo concreto en la Fase 6.
4. **Sin tests automatizados ni regresión visual con snapshot** — la validación de cada fase es manual (comparación visual, grabación de pantalla, `webapp-testing` skill). Es el nivel de rigor real disponible hoy; no se inventa infraestructura de testing nueva como parte de esta migración salvo que se pida aparte.
5. **El trail de movimiento es dependiente de frame-count (`frame % 5`), no de tiempo real** — si el ticker cambia de cadencia en el futuro (throttling, `requestAnimationFrame` con FPS distinto), el espaciado visual del trail cambia. Se hereda tal cual en la Fase 1, no se corrige aquí — es un comportamiento preexistente, no una regresión de la migración.
6. **Doble inicialización en desarrollo (React StrictMode)** — el guard `destroyed` ya existe y debe preservarse literalmente en cada fase que toque el `useEffect` de `WorldCanvas`.

---

## 5. Qué se reutiliza verbatim (sin reescribir la lógica, solo reubicarla)

- Lerp + trail de `WorldEngine.tick()` → núcleo de `MovementSystem`.
- `buildHub`/`buildRoom`/`buildToken` → factories registradas en `VisualKindRegistry`, contenido interno intacto.
- Matemática de pan/zoom/`fitScene()` → `CameraSystem`, sin tocar las fórmulas.
- Patrón `seenX` + `Map` de reconciliación → algoritmo único dentro de `RenderSyncSystem`.
- Fórmulas de pulso (`0.5 + 0.5*Math.sin(t*N)` × 10 variantes) → cuerpo de `AnimationSystem`, primera pasada verbatim.
- Ciclo de vida de `ripples` (age/1800ms, dos anillos) → `TTLSystem`/`ParticleSystem`.
- `toMmX`/`toMmY` (transformación de coordenadas del minimapa) → `MinimapRenderSystem`.
- `hashOffset()` → utilidad compartida, se queda igual.
- `HubDescriptor`/`RoomDescriptor`/`TokenDescriptor`/`RippleEvent` (`types.ts`) → contrato externo, no se toca.

## 6. Qué debe eliminarse al final (Fase 9, no antes)

- `WorldEngine.ts` viejo.
- El closure monolítico del ticker en `WorldCanvas.tsx`.
- `Object.assign(container, {__x})` como mecanismo de guardar referencias.
- `atHub`/`roomWander` vía `setInterval` — condicionado a la decisión tomada en la Fase 1.

---

## Relacionado

- [[Frontend World Engine]]
- [[Frontend - Decisiones v2]]
- [[Crecimiento de la Ciudad - World Engine]]
- [[Ciclo Día-Noche - World Engine]]
- [[ADR-001 - World Engine]]
- [[INDEX]]
