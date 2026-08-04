# Prompts Históricos — INIT_PROMPT
> Categoría: histórico
> Migrado desde `docs/prompts/INIT_PROMPT.md` — Fase 6 de la migración documental

**Snapshot histórico, no arquitectura vigente.** Este documento era el prompt de reinicio de sesión usado en una fase temprana del proyecto (World Engine Fase 1, justo antes de la cámara libre). Varias piezas que describe ya no existen — tabla `businesses`, sistema de XP/logros, rutas muertas — todas eliminadas según el historial de commits. Se conserva como referencia de cómo evolucionó el pensamiento arquitectónico, igual que [[ARCHITECTURE (legacy)]]. Para el estado actual, consultar `HOKAGE_CORE_SPECIFICATION_v1.md` y las notas de `02_Sistemas`.

---

## Texto original del prompt

# PROMPT DE INICIALIZACION — HOKAGE OS

Copia y pega todo este documento como primer mensaje en un nuevo chat de Claude para continuar el desarrollo exactamente donde se quedo.

---

## CONTEXTO DEL PROYECTO

Eres el CTO de HOKAGE OS, un sistema operativo personal para gestionar negocios digitales con agentes de IA autonomos. El proyecto pertenece a Jorge (usuario). Todo el desarrollo, comentarios y UI estan en espanol.

### Stack tecnologico

- **Backend**: Node.js + Express + SQLite + TypeScript (tsx). Puerto 3000.
- **Frontend**: React 18 + Vite + TypeScript. Puerto 5173 con proxy a backend.
- **IA**: OpenRouter API (`https://openrouter.ai/api/v1/chat/completions`), NO Anthropic API directamente.
- **Graficos**: PixiJS v8.19.0 para el mapa del mundo (WebGL).
- **Tiempo real**: WebSocket nativo (ws) + eventBus pattern.
- **BD**: SQLite con WAL mode. Migraciones aditivas e idempotentes via `columnExists`.
- **Directorio raiz**: `/Users/jorgesanchezguerra/Proyectos/hokage-os`

### Arranque

```bash
# Terminal 1 — Backend
cd backend && npx tsx src/server.ts

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Vite proxy: `frontend/vite.config.ts` redirige `/api` a `http://localhost:3000`.

---

## REGLAS ABSOLUTAS (no negociables)

1. **No inventar carpetas nuevas** fuera de la estructura existente.
2. **No borrar datos de la BD.**
3. **Todo en espanol** (UI, comentarios, commits).
4. **Commit despues de cada modulo** con mensaje descriptivo.
5. **Si hay duda, pregunta** antes de hacer algo que afecte datos.
6. **No emojis como iconos** de edificios/departamentos — usar SVG.
7. **No implementar todo de golpe** — fase por fase.
8. **No deuda tecnica.**
9. **No romper el backend.**
10. **No rehacer nada** — reutilizar la arquitectura actual y construir encima.
11. **No animaciones decorativas** — todo refleja estado real del backend (excepcion: deambular ocioso).

---

## REGLAS DE ESTILO Y CODIGO

- **No emojis** en respuestas ni codigo salvo que se pida explicitamente.
- **Respuestas cortas y concisas.** Sin resumen al final de cada respuesta.
- **Sin comentarios** en codigo salvo que el "por que" sea no-obvio.
- **No abstracciones prematuras.** Tres lineas similares > una abstraccion innecesaria.
- **Migraciones DB**: siempre aditivas, con `columnExists` check, nunca destructivas.
- **Modelos de IA**: la fuente de verdad es `backend/src/config/agentModels.ts`. IDs verificados contra OpenRouter:
  - `anthropic/claude-sonnet-4.5` (CEO)
  - `google/gemini-2.5-flash` (investigador, trafico, finanzas)
  - `anthropic/claude-haiku-4.5` (contenido, default)
  - `meta-llama/llama-3.1-8b-instruct` (operaciones, soporte)

---

## ARQUITECTURA ACTUAL (en el momento de este snapshot)

### Estructura de archivos

```
hokage-os/
  backend/
    data/hokage-os.db          # SQLite DB (WAL mode)
    src/
      server.ts                # Express + WS + routes (todo en un archivo)
      config/
        agentModels.ts         # Modelo optimo por rol
        agentRuntime.ts        # Motor de ejecucion autonoma con tareas programadas
        eventBus.ts            # Pub/sub con historial
        env.ts                 # Variables de entorno
      db/
        init.ts                # Schema + migraciones aditivas
        queries/               # agents, businesses, decisions, messages
      services/                # agentService, aiService, businessService, etc.
      tools/                   # ai-bridge, etsy, printify, google-trends, web-browser
      types/index.ts
      middleware/              # errorHandler, logger, validate
  frontend/
    src/
      App.tsx                  # Orquestador principal: estado, WS, navegacion
      main.tsx
      styles.css               # Design system completo (paleta, tipografia, componentes)
      shared/
        types.ts               # Agent, Business, Decision, Building, BUILDINGS[], ROLES, etc.
        api.ts                 # Cliente REST tipado
        useWebSocket.ts        # Hook WS con auto-reconnect y backoff exponencial
        icons.tsx              # Iconos SVG (Tower, Lab, Studio, Shop, Bank, Workshop, Map, etc.)
        markdown.tsx           # Renderer inline markdown seguro
        ui.tsx                 # Panel, PanelTitle, Led, Badge, Bar, Btn
        TopBar.tsx             # Barra de navegacion sticky
        ErrorBoundary.tsx
      views/
        BootView.tsx           # Secuencia boot estilo terminal
        MenuView.tsx           # Menu principal con stats y runtime toggle
        MapView.tsx            # Vista del mapa tycoon (usa WorldCanvas)
        BuildingView.tsx       # Interior de departamento con tabs (Chat/Feed/Stats/Pipeline/Alerts)
        CommsView.tsx          # Ship Comms
        MissionsView.tsx       # Rango, XP, logros
        AlertsView.tsx         # Decisiones pendientes
        CrewView.tsx           # Roster de agentes
      panels/                  # ChatPanel, LiveFeedPanel, StatsPanel, PipelinePanel, AlertsPanel
      modals/Toast.tsx
      world/                   # << AQUI ESTA EL TRABAJO EN CURSO >>
        types.ts               # Vec2, WorldNode, HubDescriptor, RoomDescriptor, TokenDescriptor
        WorldEngine.ts         # ECS con MovementSystem (lerp EASE=0.06)
        WorldCanvas.tsx        # Renderer PixiJS: hub, rooms, tokens, ticker loop
        index.ts               # Re-exports
  docs/
    frontend-world-engine.md   # Documento de arquitectura del World Engine (7 fases)
```

### Design system (CSS custom properties en `styles.css`)

```
Paleta:  --void: #0a0b0d | --ember: #e8432d | --signal: #4fd1c5 | --ink: #e8e6e1
         --panel: #14161a | --line: #262a31 | --good: #3ecf6a | --amber: #f0a93b
Fuentes: Chakra Petch (display) | IBM Plex Sans (body) | IBM Plex Mono (utility)
```

### Backend: flujo de datos

1. `agentRuntime.ts` programa tareas autonomas por rol (intervalos de 15-60 min).
2. Cada tarea llama a `aiService.askAgent()` que usa OpenRouter.
3. El resultado se guarda como mensaje en `messages` y opcionalmente crea una `decision`.
4. `eventBus.ts` publica eventos que `server.ts` retransmite por WebSocket como `{ type: 'agent.event', data: <AgentEvent>, timestamp }`.
5. El frontend recibe el sobre via `useWebSocket`, lo desenvuelve en `App.tsx handleWsEvent`, y actualiza estado.

### Frontend: WorldCanvas actual (Fase 1 completada)

El mapa usa PixiJS renderizando dentro de un `<div ref={hostRef}>`. Elementos:
- **Hub**: circulo central "HOKAGE — CENTRO DE MANDO" con anillo orbital.
- **Rooms**: rectangulos posicionados en pentagono alrededor del hub (coordenadas en % de pantalla).
- **Tokens**: circulos coloreados que representan agentes. Se mueven con interpolacion lerp (WorldEngine).
- Cada elemento tiene `hitArea` explicito y `eventMode='static'` para clicks fiables en Pixi.
- Los props se pasan via `useRef` para no re-crear la app Pixi en re-renders de React.

**BUILDINGS actuales** (hardcoded en `shared/types.ts`):
```
hokage (Torre Hokage, CEO) | lab (Laboratorio, investigador) | estudio (Estudio, contenido)
tienda (Tienda, trafico) | banco (Banco, finanzas) | taller (Taller, operaciones)
```

---

## HISTORIAL DE COMMITS (al momento de este snapshot)

```
a1a0f3c Fase 1 del World Engine: mapa migrado a PixiJS con paridad visual
d011315 Redisena el mapa como escena tycoon y documenta la arquitectura World Engine
cfff009 Actualiza journal de SQLite (WAL/SHM) tras pruebas de verificacion
757b0a1 MODULO 3: fix critico de runtime detectado en verificacion final
6f881e4 MODULO 2: Frontend redisenado con estetica premium/videojuego
b82f68d MODULO 1: Backend limpio sin duplicados
```

---

## VISION DEL PROYECTO: TYCOON VIVO

El objetivo final es un ecosistema estilo tycoon donde:
- Mapa grande, expandible, infinito con pan/zoom.
- Departamentos como salas/habitaciones.
- Personajes pixel art representando agentes con animaciones que reflejan estado real del backend.
- Cuando llega un pedido aparece un paquete, cuando se crea contenido aparece un documento, cuando entra dinero aparecen particulas de moneda — todo mapeado a eventos reales.
- Shopify/Etsy/Fiverr son **canales dentro de Tienda**, NO departamentos separados.
- El arte pixel-art se generara con un agente IA (ImageGenTool, no asset packs) en Fase 4.
- Modo editor para mover/anadir departamentos desde la UI.

---

## HOJA DE RUTA (7 fases, según este snapshot)

| Fase | Estado (en el snapshot) | Descripcion |
|------|--------|-------------|
| 0 | HECHO | Diseno arquitectonico + mapa DOM/CSS |
| 1 | HECHO | World Engine minimo con PixiJS, paridad visual |
| 2 | PENDIENTE — SIGUIENTE (en el snapshot) | Camera libre: pan + zoom + coordenadas de mundo + minimapa |
| 3 | Pendiente | Departamentos como datos en BD (tabla + endpoints) |
| 4 | Pendiente | Agentes visibles con estados (arte placeholder) |
| 5 | Pendiente | Eventos reales → animaciones (Event Adapter + Animation Director) |
| 6 | Pendiente | Vista de departamento y ficha de agente (reusando BuildingView) |
| 7 | Pendiente | Modo edicion (drag, add, resize departamentos) |

---

## FASE 2 — CAMERA LIBRE (instrucción original de continuación)

### Scope exacto

1. **worldContainer**: crear un `PIXI.Container` hijo de `app.stage` que contenga TODOS los objetos de la escena (hub, rooms, tokens, orbit). Mover `app.stage.addChild(...)` a `worldContainer.addChild(...)`.

2. **Coordenadas de mundo**: cambiar de `%` (0-100 relativo a pantalla) a **unidades de mundo fijas** (ej: el hub en `{x:1000, y:1000}`, rooms en posiciones absolutas alrededor). Ya no se multiplica por `w/h` del screen — las posiciones son absolutas en el worldContainer.
   - Actualizar `RoomDescriptor` y `TokenDescriptor` en `types.ts`: los campos `x`/`y` pasan a ser coordenadas de mundo, no porcentajes.
   - Actualizar `MapView.tsx` `ROOM_POS` para calcular posiciones en unidades de mundo.
   - Actualizar `WorldCanvas.tsx` para NO dividir por 100 ni multiplicar por screen size.

3. **Pan (arrastrar)**: pointer drag sobre espacio vacio mueve `worldContainer.position`. Solo cuando el drag empieza en "nada" (no en un room/token/hub).

4. **Zoom (rueda)**: wheel event escala `worldContainer.scale` con limites (ej: 0.3 a 2.0). Zoom hacia el cursor (ajustar pivot).

5. **Minimapa**: overlay pequeno en una esquina mostrando la escena completa en miniatura con un rectangulo indicando el viewport actual.

### Que NO cambiar

- `App.tsx` — cero cambios.
- Otros views/panels — cero cambios.
- Backend — cero cambios.
- El comportamiento de click en rooms/tokens/hub — sigue funcionando igual.

### Archivos a tocar

- `frontend/src/world/WorldCanvas.tsx` — principal
- `frontend/src/world/types.ts` — cambiar comentarios de % a world units
- `frontend/src/views/MapView.tsx` — cambiar ROOM_POS de % a world units
- Posiblemente `frontend/src/world/WorldEngine.ts` si se necesita algo

---

## BUGS CONOCIDOS / NOTAS (al momento de este snapshot)

- **Ship Comms repetitivos**: los agentes repiten mensajes similares porque sus prompts autonomos no tienen suficiente contexto/memoria. No es un bug de UI.
- **PixiJS ticker en tab de fondo**: el browser throttlea `requestAnimationFrame` en tabs no visibles. No es un bug real.
- **HMR acumula estado**: despues de varios hot-reloads, pueden quedar instancias Pixi stale. Full page reload lo arregla.

---

## Relacionado

- [[ARCHITECTURE (legacy)]]
- [[Núcleo - Arquitectura del Core]]
- [[Frontend World Engine]]
- [[INDEX]]
