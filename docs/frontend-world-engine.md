# HOKAGE OS — Arquitectura del Frontend: World Engine
## Documento técnico v1.0 (diseño, sin implementación)

Complementa `docs/architecture.md` (backend/orquestación). Este documento cubre
solo el frontend: cómo pasa de ser un dashboard con pantallas a ser una
**representación visual en vivo del backend**.

---

## 0. Principio rector

> El frontend no tiene estado propio de negocio. Es una **proyección** del
> estado del backend. Todo lo que se ve en pantalla es la respuesta a un
> evento que ya ocurrió en el servidor.

Esto tiene una consecuencia de diseño estricta: **ninguna pantalla debe
inventar datos ni lógica de negocio**. Si algo se mueve en la interfaz, es
porque un evento del backend dijo que se moviera. Si no hay evento, no hay
movimiento — nunca se simula actividad falsa para "que se vea vivo" (con una
única excepción cosmética y explícita: el deambular ocioso de un agente sin
tarea activa, que es decoración de presencia, no información).

Esto también fija la respuesta a "qué tecnología": React sigue gestionando
*estado y estructura* (qué pantallas existen, formularios, listas, texto).
Una capa nueva —el **World Engine**— gestiona *el mundo vivo*: posiciones,
animaciones, partículas, todo lo que debe correr a 60fps con independencia de
cuándo React decide re-renderizar.

---

## 1. Panorama general

```text
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND (existente)                     │
│  eventBus.ts → WebSocket  +  REST (/api/agents, /api/decisions…) │
└───────────────────────────────┬─────────────────────────────────┘
                                 │ eventos crudos (JSON)
                                 ▼
                      ┌─────────────────────┐
                      │    EVENT ADAPTER     │  ← única pieza que conoce
                      │  (backend → mundo)   │    el formato del backend
                      └──────────┬──────────┘
                                 │ WorldCommand[]
                                 ▼
                      ┌─────────────────────┐
                      │    WORLD ENGINE      │  ← ECS + tick loop,
                      │ (Entities, Systems,  │    independiente de React
                      │  Animation Director) │
                      └──────────┬──────────┘
                     ┌───────────┴───────────┐
                     ▼                       ▼
           ┌──────────────────┐   ┌───────────────────────┐
           │   RENDERER (Pixi)│   │   REACT SHELL (DOM)   │
           │  el mundo vivo:  │   │  menús, chat, forms,  │
           │  departamentos,  │   │  listas, alertas,     │
           │  agentes, paquetes│   │  todo lo "de leer"    │
           └──────────────────┘   └───────────────────────┘
                     └───────────┬───────────┘
                                 ▼
                        Un único árbol DOM
                (el canvas de Pixi vive dentro de un
                 componente React, como una isla)
```

Cuatro piezas nuevas, cero reescritura del backend:

| Pieza | Responsabilidad | Vive en |
|---|---|---|
| **Event Adapter** | Traduce eventos del backend a comandos del mundo | frontend, capa fina |
| **World Engine** | Estado del mundo vivo (ECS) + reloj de simulación | frontend, motor puro (sin JSX) |
| **Renderer (Pixi)** | Dibuja el mundo cada frame | frontend, un componente React "isla" |
| **React Shell** | Todo lo que no es el mundo vivo (menús, chat, formularios) | frontend, como hoy |

---

## 2. El World Engine

### 2.1 Por qué no es React state

React re-renderiza en respuesta a cambios de estado; no está pensado para
animar docenas de entidades independientes de forma continua. Si el "agente
caminando" vive en `useState`, cada frame de movimiento dispara un
re-render de componente, con reconciliación de por medio — funciona para 7
fichas moviéndose cada varios segundos (lo que hay hoy en `MapView.tsx`), se
cae en cuanto hay paquetes, documentos, partículas de dinero y errores
apareciendo simultáneamente varias veces por minuto durante meses.

El World Engine es un **bucle de simulación independiente** (su propio
`requestAnimationFrame`), con un patrón **ECS (Entity-Component-System)**:

- **Entity**: un id. Nada más. Un agente, un departamento, un paquete, un
  documento, una partícula de dinero, una alerta — todo es una entidad.
- **Component**: datos puros adjuntos a una entidad. `Position`, `Motion`
  (origen/destino/progreso/easing), `Visual` (qué sprite o forma), `Status`
  (idle/working/error), `TTL` (para entidades transitorias como un paquete
  que desaparece al llegar), `Label`.
- **System**: una función que cada tick recorre las entidades con ciertos
  componentes y las actualiza. `MovementSystem` avanza `Motion.progress`;
  `AnimationSystem` decide el frame de sprite según `Status`; `TTLSystem`
  destruye entidades caducadas; `ParticleSystem` genera/despuebla efectos.

```text
World Engine (tick ~60/s)
 ├── EntityStore            (Map<id, Entity>)
 ├── Systems (en orden)
 │    1. IntentSystem        aplica WorldCommands entrantes de este tick
 │    2. MovementSystem      interpola posiciones (agentes, paquetes, docs)
 │    3. AnimationSystem     resuelve qué clip/estado visual toca
 │    4. ParticleSystem      nace/muere de partículas (monedas, chispas)
 │    5. TTLSystem           destruye entidades transitorias caducadas
 └── snapshot()              → estado inmutable que lee el Renderer
```

El React Shell y el Renderer **leen** del World Engine (snapshot de solo
lectura); nunca lo mutan directamente. La única entrada son
`WorldCommand`s que llegan del Event Adapter (o, más adelante, de un panel
de debug/autor).

### 2.2 Reconciliación con la verdad del backend

Los eventos WS son el **camino rápido** (animación inmediata); las
respuestas REST (`/api/agents`, `/api/agent-runs`, `/api/decisions`, que ya
existen) son la **verdad de fondo**. Si se cae el WebSocket y se pierde un
evento, el polling periódico que ya tiene `App.tsx` corrige el estado real;
el World Engine debe poder recibir una "foto completa" y reconciliar
posiciones sin saltos bruscos (interpola hacia la posición correcta en vez
de teletransportar). Esto ya es, en espíritu, lo que hace hoy
`useWebSocket` + polling de 15s — el World Engine formaliza ese patrón en
vez de dejarlo disperso en `App.tsx`.

---

## 3. De evento de backend a animación

### 3.1 El vocabulario ya existe

`backend/src/config/eventBus.ts` ya define un vocabulario cerrado de
eventos (`AgentEventType`): `trend.detected`, `content.created`,
`content.ready`, `decision.created`, `decision.approved`,
`decision.rejected`, `sale.made`, `alert.triggered`, `agent.task.start`,
`agent.task.done`, `agent.task.error`, `report.daily`, `system.error`. No
hace falta inventar un bus nuevo — hace falta **una tabla que traduzca cada
uno en una reacción visual**, en vez de si/switch repartidos por
componentes (que es como está hoy: `handleWsEvent` en `App.tsx` con ifs
sueltos).

### 3.2 Event Adapter

Única pieza que conoce el formato exacto del WebSocket (el sobre
`{type, data, timestamp}`, y que `agent.event` trae un `AgentEvent`
anidado en `data`). Traduce cada evento crudo a un **WorldEvent**
canónico, estable de cara al motor:

```text
WorldEvent = {
  kind: string          // 'AGENT_WORKING' | 'MONEY_IN' | 'DOCUMENT_SPAWN' | ...
  agent?: string        // nombre del agente origen
  department?: string   // resuelto vía Directory (agente → depto)
  payload: unknown
  ts: number
}
```

Si mañana el backend renombra un evento o añade quince nuevos, **solo se
toca el Event Adapter** — el World Engine y el Renderer no saben que
`sale.made` existe; solo saben que existe `MONEY_IN`.

### 3.3 Animation Director (tabla, no código)

```text
reaction('AGENT_WORKING')   → statusChange(agent, 'working') + glow(department)
reaction('AGENT_IDLE')      → statusChange(agent, 'idle')
reaction('AGENT_ERROR')     → alertFlare(agent) + statusChange(agent, 'error')
reaction('DECISION_RAISED') → spawnEntity('alert-badge', at: department)
reaction('SALE_MADE')       → spawnParticles('coin', from: department, to: HUB)
reaction('CONTENT_CREATED') → spawnEntity('document', from: 'estudio', to: HUB)
reaction('TREND_DETECTED')  → spawnEntity('signal-ping', at: 'laboratorio')
reaction('SYSTEM_ERROR')    → globalAlert('critical')
```

Esto es literalmente una tabla (JSON o un objeto TS), no un `switch`
disperso. Añadir una reacción nueva es añadir una fila, nunca tocar el
motor. Esto es lo que responde directamente a los ejemplos que diste:

| Lo que pides | WorldEvent | Efecto visual |
|---|---|---|
| Llega un pedido | `ORDER_RECEIVED` | aparece un paquete en Tienda, viaja a Banco |
| Agente investigando | `AGENT_WORKING` (rol=investigador) | sprite del agente en Laboratorio pasa a animación "trabajando" |
| Se crea contenido | `CONTENT_CREATED` | aparece un documento que viaja de Estudio al hub |
| Entra dinero | `SALE_MADE` / `report.daily` con ingreso | partículas de moneda fluyendo hacia Banco |
| Ocurre un error | `system.error` / `agent.task.error` | alerta real: flash rojo + badge persistente, no un toast que desaparece solo |

### 3.4 Contrato de "alerta real"

Un error no es un toast de 3 segundos. Es una entidad `Alert` persistente
con TTL infinito hasta que Jorge la resuelve (aprobar/rechazar/descartar) —
igual que ya existe el modelo de `decisions` pendientes. El World Engine no
inventa esto: refleja el estado de `decisions`/`alert.triggered` tal cual
vive en el backend.

---

## 4. Departamentos

### 4.1 De array estático a registro de datos

Hoy `BUILDINGS` es un array hardcodeado en `shared/types.ts` (6 edificios,
1 agente cada uno). Para "Marketing, Desarrollo, Finanzas, Ventas, Tiendas,
Laboratorio IA, Automatizaciones..." creciendo con el tiempo, un
departamento debe ser un **registro de datos**, no código:

```text
department = {
  id, name, icon,           // identidad + glifo SVG (ya existen los del mapa actual)
  agent_roles: string[],    // qué roles del backend viven aquí (0, 1 o varios)
  layout_hint?: {x,y}       // opcional; si no está, el motor lo calcula
}
```

Vive en una tabla `departments` (nueva, backend) con un endpoint
`GET/POST /api/departments`. El frontend deja de tener una lista fija: la
pide, y el World Engine coloca tantos departamentos como existan. Esto
generaliza el pentágono que ya construí en `MapView.tsx`
(`360 / ROOMS.length`) a **N departamentos**, con anillos concéntricos si
crecen más allá de lo que cabe cómodo en uno solo.

### 4.2 Varios agentes por departamento

Un departamento con 3 agentes asignados los agrupa en su propio micro-anillo
alrededor de la puerta del departamento (mismo patrón que ya usé para
agrupar fichas alrededor del hub, aplicado localmente a cada sala).

---

## 5. Tecnología gráfica

| Opción | Veredicto |
|---|---|
| DOM/CSS (lo que hay hoy) | Sirve para 6-10 elementos con transición simple. No aguanta paquetes + documentos + partículas + docenas de agentes en paralelo sin degradar. |
| SVG | Bueno para iconografía estática (los glifos de departamento se quedan en SVG). Malo para cientos de elementos animados a la vez: sigue siendo DOM por debajo. |
| Canvas 2D a mano | Rinde, pero obliga a reinventar batching, easing, z-order, partículas — un motor de juego artesanal. |
| **PixiJS (WebGL)** | **Elegida.** Sprite batching, `ParticleContainer` nativo, filtros (glow), ticker propio, miles de sprites a 60fps, interop con React trivial (un `<canvas>` montado una vez en un `useEffect`, nunca vuelve a re-renderizar por React). |

**Arquitectura híbrida, no "todo Pixi":**

- El **mundo vivo** (el mapa de departamentos, agentes, paquetes,
  partículas) se dibuja en un único `<WorldCanvas/>` de Pixi.
- **Todo lo demás** (menú, chat con el agente, listas de alertas,
  formularios, Ship Comms) sigue siendo DOM/React tal cual está hoy —
  es texto, necesita ser accesible y seleccionable, y no necesita 60fps.
- Los dos comparten un solo estado (el World Engine para el mundo;
  `App.tsx`/hooks para el resto), pero nunca se pisan: abrir el interior de
  un departamento es una transición de React Shell (como hoy), no algo que
  Pixi tenga que renderizar.

Esto es el mismo patrón que usan Figma, Miro o cualquier editor
"canvas + chrome": WebGL para lo que se mueve mucho, DOM para lo que se lee.

---

## 6. Extensibilidad: que cualquier agente añada elementos visuales sin romper nada

Tres registros, todos con la misma forma (registrar = validar contra un
esquema + insertar; nunca sobreescribir en silencio; un fallo de una
entidad no tira el frame loop entero):

```text
WorldEngine.registerVisualKind({
  kind: 'package',
  visual: { sprite: 'package.png' } | { shape: 'rect', ... }, // primitivas seguras
  states: ['spawn', 'travel', 'arrive', 'despawn'],
})

AnimationDirector.registerReaction({
  eventKind: 'ORDER_RECEIVED',
  effect: spawnAndTravel('package', from: 'tienda', to: 'banco'),
})

DepartmentRegistry.register({ id: 'automatizaciones', name: 'Automatizaciones', ... })
```

Reglas duras para que esto no se convierta en un desastre con el tiempo:

1. **Aditivo, nunca destructivo**: registrar una clave que ya existe se
   rechaza con un aviso, no sobreescribe silenciosamente.
2. **Validado por esquema**: un manifiesto incompleto se rechaza entero,
   nunca se aplica a medias.
3. **Fallo aislado**: si una entidad custom lanza un error al dibujarse, el
   motor la oculta y sigue — nunca detiene el resto del mundo por una pieza
   rota.
4. **Vocabulario visual cerrado, no código libre**: nuevas formas se
   componen con primitivas seguras (círculo, rect, icono desde path,
   partícula, etiqueta) — nunca inyectando JS/Pixi arbitrario desde fuera.
   Esto es lo que hace seguro el punto 6 de más abajo.

---

## 7. Que una IA pueda ampliar la interfaz sola, con el tiempo

Esto es una consecuencia directa de las secciones 4 y 6, no una pieza
nueva: si departamentos, reacciones y tipos visuales **ya son datos** (filas
en BD, no TypeScript), entonces "una IA amplía la interfaz" se reduce a
"una IA inserta filas en tablas que el frontend ya escucha" —
exactamente el mismo principio que `docs/architecture.md` §16 aplica a
modelos y tools, extendido a lo visual.

```text
Agente/IA  →  POST /api/departments | /api/visual-kinds | /api/event-reactions
                            │
                            ▼
              World Engine recarga sus registros
                (mismo canal WS/REST que ya usa para todo)
```

Salvaguardas para que esto sea seguro sin supervisión humana constante:

- **Sandboxing de vocabulario**: como en §6, la IA compone con primitivas
  seguras, nunca con código ejecutable inyectado en el cliente.
- **Canary + rollback instantáneo**: un manifiesto nuevo se valida contra
  su esquema y se prueba en aislado antes de sustituir al vigente; si falla
  al primer render, el motor vuelve automáticamente al manifiesto anterior
  (igual que un feature flag). Nunca hay una ventana en la que la interfaz
  quede rota para Jorge.
- **Auditoría**: cada alta de departamento/reacción/tipo visual queda en
  `audit_logs` (ya existe la tabla) — quién (qué agente) añadió qué y
  cuándo, igual que cualquier otra acción del sistema.

Esto es explícitamente una capacidad de **fase futura** (ver hoja de ruta),
no algo a construir ahora — pero el motivo de diseñar los registros como
datos desde el principio es precisamente dejar la puerta abierta sin tener
que reescribir nada cuando llegue ese momento.

---

## 8. Qué cambia respecto a lo que ya existe hoy

No se tira nada; se reubica:

| Hoy (`frontend/src/...`) | Pasa a ser |
|---|---|
| `shared/types.ts` → `BUILDINGS` (array fijo) | `departments` en BD + `DepartmentRegistry` en el motor |
| `views/MapView.tsx` → `useState atHub` + `setInterval` para deambular | `MovementSystem` del World Engine |
| `App.tsx` → `handleWsEvent` con ifs sueltos | `Event Adapter` + `AnimationDirector` (tabla) |
| Iconos SVG de edificios (`shared/icons.tsx`) | Se conservan tal cual como parte del manifiesto visual de cada departamento |
| Paleta/tipografía HUD ya construida (graphite + ember + signal, Chakra Petch) | Se conserva como el "tema" visual por defecto que corre sobre el World Engine — el trabajo de diseño no se pierde, se convierte en datos del motor |
| Chat, Alertas, Ship Comms, Misiones (DOM/React) | Sin cambios de tecnología — siguen siendo React Shell |

---

## 9. Hoja de ruta de ejecución (v2 — plan por fases)

Reemplaza el esbozo anterior con un plan concreto, pensado para que **cada
fase termine con la app funcionando de punta a punta** (compila, arranca,
se puede comitear) antes de empezar la siguiente. Ninguna fase reescribe
`views/`, `panels/`, `shared/` ni `modals/` — todo lo que ya existe
(Chat, Alertas, Ship Comms, Misiones, el backend entero) sigue funcionando
igual durante todo el proceso. Solo cambia lo que hay dentro del mapa.

### Fase 0 — Hecho
Diseño arquitectónico (este documento) + mapa tycoon actual en DOM/CSS
(`MapView.tsx`): hub + 5 salas en pentágono + fichas que deambulan o se
quedan fijas trabajando. Este es el **contrato visual y funcional mínimo**
que la Fase 1 debe igualar antes de añadir nada nuevo.

### Fase 1 — World Engine mínimo, paridad visual
**Objetivo:** mover el mapa de DOM a PixiJS sin añadir ni una función
nueva. Es el paso de más riesgo técnico (paradigma de render nuevo), así
que se aísla de cualquier feature nueva.

- Añadir dependencia `pixi.js`.
- Nuevo módulo `frontend/src/world/` (entidades, componentes, sistemas,
  `WorldCanvas.tsx`) — carpeta nueva pero aditiva, no toca nada existente.
- `WorldCanvas` sustituye el `<div className="hk-scene">` de `MapView`;
  reutiliza el mismo `onEnterBuilding` que ya usan `BuildingView` y el
  resto — cero cambios en `App.tsx`.
- Arte: formas/iconos simples (lo que ya hay), todavía sin pixel-art.
- **Hecho cuando:** el mapa se ve y se comporta igual que hoy, corriendo
  sobre Pixi.

### Fase 2 — Cámara libre y mundo "infinito"
- Pan (arrastrar) + zoom (rueda/pellizco) sobre el `Container` de Pixi.
- Coordenadas de departamento pasan de `%` de pantalla a unidades de mundo
  fijas (para que el mapa pueda crecer sin recalcular todo).
- Minimapa simple en una esquina (como en la referencia).
- **Hecho cuando:** se puede navegar libremente el mismo mapa de la Fase 1.

### Fase 3 — Departamentos como datos, no como array fijo
- Tabla `departments` nueva (migración aditiva, mismo patrón que ya usa
  `db/init.ts` para `agents.model`) + `GET/POST /api/departments`.
- Se siembra con los 6 actuales **más** los que pediste (Shopify, Etsy,
  Fiverr, Automatizaciones, Recursos Humanos, Servidores...) — los que
  todavía no tienen agente asignado se muestran igualmente, en estado
  "sin operar" (el diseño de §4.1 ya contempla 0 agentes por depto).
- El layout deja de ser "un pentágono de 5" y pasa a "N departamentos en
  anillos concéntricos".
- **Hecho cuando:** añadir un departamento es una fila en BD, no un
  despliegue de frontend.

### Fase 4 — Agentes visibles con estados (arte placeholder)
- Sistema de animación real (estados idle/working/error → clip), con
  sprites geométricos simples por ahora — **decisión pendiente tuya**: el
  pixel-art de la referencia necesita sprites reales (comprados,
  encargados o generados), y quiero que se decida antes de esta fase, no
  durante. El sistema se construye para que el arte se pueda enchufar
  después sin tocar código (es justo lo que permite el registro de
  "visual kinds" de §6).
- **Hecho cuando:** cada agente se distingue visualmente por su estado
  real, con el motor de animación ya desacoplado del arte final.

### Fase 5 — Eventos reales → animación (aquí deja de ser decorativo)
- Se implementan el Event Adapter y el Animation Director de §3 sobre el
  vocabulario que **ya existe** en `eventBus.ts` (nada nuevo en backend
  salvo, si hace falta, emitir `sale.made` desde el flujo de negocio real
  cuando exista — hoy no hay integración de ventas real, así que ese
  evento aún no se dispara desde ningún sitio).
- Paquete viaja en `sale.made`, documento viaja en `content.created`,
  agente camina a su sala en `agent.task.start`/`done`, badge de alerta en
  `decision.created`, partícula de dinero en ingresos.
- **Hecho cuando:** dejar la pantalla abierta unos minutos con el runtime
  activo muestra actividad real, nunca inventada.

### Fase 6 — Vista de departamento y ficha de agente
- Clicar una sala/agente en Pixi abre lo que **ya existe**:
  `BuildingView` + `ChatPanel`/`StatsPanel`/`PipelinePanel`/`AlertsPanel`
  — solo cambia el disparador (Pixi en vez de un div).
- Dos paneles nuevos que son casi gratis porque el backend ya los expone:
  **Memoria** (`GET /api/agent-memory/:id`, ya existe) y **Herramientas**
  (`GET /api/tools`, ya existe).
- Vistas específicas por tipo de departamento (catálogo de Shopify, logs
  del Laboratorio IA...) **requieren integraciones que hoy no existen**
  (no hay conector de Shopify/Etsy/Fiverr en el backend). Esas salas usan
  la vista genérica hasta que la integración real se construya —
  nunca se rellenan con datos falsos.
- **Hecho cuando:** toda la información de un departamento/agente que ya
  tenemos backend para mostrar, se ve desde el mapa nuevo.

### Fase 7 — Modo edición
- Arrastrar para mover un departamento (persiste en la tabla de la Fase
  3), formulario para añadir departamento, añadir agente (reutiliza
  `POST /api/agents`, ya existe), redimensionar sala.
- **Hecho cuando:** reorganizar el mundo no requiere tocar código —
  mismo principio de "configuración sobre código" de `architecture.md` §16.

### Por qué este orden
Cada fase es la base estricta de la siguiente (motor → cámara → datos →
personajes → eventos → paneles → edición), y cada una deja el sistema
comiteable y funcionando. La Fase 1 es intencionalmente la más aburrida
(cero features nuevas) porque es la que más puede salir mal — mejor
descubrirlo ahí que mezclado con diez cosas nuevas a la vez.

### Decisiones ya tomadas (2026-07-25)

1. **Arte pixel-art (Fase 4):** se genera con un modelo de imagen (familia
   Gemini "Nano Banana"), no se compra asset pack ni se dibuja a mano.
   Nota técnica: hoy esta sesión de Claude no tiene una herramienta de
   generación de imagen nativa disponible — para que esto sea real hace
   falta exponerlo como una **tool más del sistema de agentes** (igual que
   `EtsyTool`/`PrintifyTool` en `backend/src/tools/`): una `ImageGenTool`
   que llama a la API de Gemini con una API key propia. Esto se monta en
   la Fase 4, cuando se decida esa API key — no bloquea las fases 1-3.
2. **Shopify / Etsy / Fiverr:** no son departamentos propios. Son
   **canales de venta dentro de Tienda** (el departamento que ya existe,
   ligado al agente de Tráfico). Cuando la Fase 3 haga los departamentos
   de datos, Tienda lleva un campo `channels: ['shopify','etsy','fiverr']`
   en vez de generar tres salas nuevas en el mapa.
3. **Orden de arranque:** Fase 1, tal como está descrita arriba. Empieza
   ahora.
