# Informe de Revisión Visual/Espacial — Frontend Hokage OS

**Fecha:** 2026-08-21  
**Contexto:** Revisión de solo lectura del estado actual del frontend vs. visión consolidada de Edificios y decisiones de interfaz congeladas. Sin cambios de código.

---

## 1. YA EXISTE ✅

### 1.1 Mapa del Ecosistema (PixiJS + ECS) — `frontend/src/world/`

| Componente | Estado | Detalles |
|------------|--------|----------|
| **WorldCanvas.tsx** | Completo, producción | Motor ECS completo con `WorldEngineBridge`, `RenderSyncSystem`, `ParticleSystem`, `TTLSystem`. Ciclo de vida React + PIXI.Application bien encapsulado. |
| **CameraSystem** | Completo | Pan (drag), zoom (wheel), fitScene automático al montar, límites suaves. |
| **Hub (Torre Hokage)** | Completo | Elipse orbital dibujada cada frame, label/sublabel, glow animado via `engine.animate('hub')`, click handler para abrir consola. |
| **Salas (Departamentos)** | Completo | `ensureVisual('room')` crea/actualiza contenedores Pixi. Animación: alert dot, active dot, glow, barra de actividad, pulse ring — todo en `visuals/room.ts`. |
| **Tokens (Agentes)** | Completo | Movimiento suave (`setTarget` + `engine.tick()`), trails, ring/ringOuter pulsante, burbuja de acción (`justActed`), name badge. Color cambia working/idle. |
| **Spokes + Paquetes de datos** | Completo | Grosor y alpha de spokes proporcionales a `activityLevel` (derivado de work_items in_progress). Paquetes: `numPackets = round(4 * a)`, speed variable. **Sin actividad → sin paquetes** (regla Fase 3 D3 respetada). |
| **Ripples (Eventos WS)** | Completo | `spawnParticle('ripple')` en coordenadas de la sala. Color por tipo: error=ember, done=signal, else=amber. TTL 1.8s. |
| **Minimapa** | Completo | Esquina inferior derecha. Hub (ember), salas (color dept), tokens (estado), viewport rectángulo. Escala automática con padding. |
| **Scan line** | Completo | Línea barrido horizontal cada 12s, alpha muy bajo (0.025/0.045). Efecto atmosférico, no informativo. |
| **Visuals centralizados** | Completo | `COLOR` object en `visuals/index.ts`: void, panel, line, signal, ember, amber, good, minimapBg, minimapViewport. `hashOffset` para desfasaje determinista. |

**Veredicto:** El mapa **ya es un entorno vivo**. Refleja estado real (activityLevel, working, pending, hasError, eventos WS) sin inventar flujo. Arquitectura ECS limpia, separa render de lógica.

---

### 1.2 Vista de Edificio (BuildingView) — `frontend/src/views/BuildingView.tsx`

| Aspecto | Estado | Detalles |
|---------|--------|----------|
| **Arquitectura data-driven** | Completa | `sectionsForBuilding(building)` resuelve secciones por `building.type` y `building.role` via `buildingSectionRegistry`. **Cero condicionales building-specific**. |
| **Registry de secciones** | Completo | `buildingSectionRegistry.ts`: mapa `role → sections[]` con `ceo`, `finanzas`, `investigador`, `contenido`, `system`. Cada sección declara: `id`, `label`, `panel` (componente), `variant?`, `weight?`. |
| **Paneles laterales (izq/der)** | Completos | 9 paneles implementados y funcionando con datos reales: |

| Panel | Ubicación | Datos reales | Estado |
|-------|-----------|--------------|--------|
| `ChatPanel` | Izq/Der | WS `agent.chat` + historial API | ✅ Markdown, streaming, input |
| `LiveFeedPanel` | Izq/Der | WS `agent.*` + `work_item.*` + `decision.*` | ✅ LED indicadores, filtros, auto-scroll |
| `StatsPanel` | Izq/Der | API `/agents/:id/stats` | ✅ Grid: success rate, tokens, coste, work_items, decisions |
| `PipelinePanel` | Centro | API `/agents/:id/work-items` | ✅ Flow bar (queued→running→done), cards con fase/rol/título/estado |
| `OutputsPanel` | Centro | API `/agents/:id/outputs` | ✅ Tabs: market trends / content items, variantes all/market/content |
| `BankPanel` | Centro | API `/ventures/:id/budget` | ✅ Budget bars (allocated/reserved/real/available), % usado, warning 80% |
| `TerminalPanel` | Centro | API `/hermes/runs` | ✅ Exec runs history, stdout/stderr, exit code, duración |
| `SystemStatusPanel` | Centro | WS `runtime.status` + API | ✅ Runtime status, agentes activos, métricas agregadas |
| `AlertsPanel` | Centro | API `/decisions` | ✅ Decisiones pending, botones Aprobar/Rechazar, badge contador |

---

### 1.3 Layout Principal — `frontend/src/views/GameLayout.tsx`

| Componente | Estado |
|------------|--------|
| **PanelRegistry** | Completo — registro declarativo de paneles left/right/center/bottom con `weight`, `minWidth`, `defaultOpen`. |
| **OverlayRegistry** | Completo — overlays full-screen: `building`, `objectives`, `hokage-console`. `openOverlay()`/`closeOverlay()` con ESC y click fuera. |
| **WorldCanvas integration** | Completo — recibe `hub`, `rooms`, `tokens`, `events` del estado global (WebSocket + initial_snapshot). |
| **Responsive** | Completo — CSS Grid con `grid-template-areas`, breakpoints en 1200px / 900px. Paneles colapsables a iconos. |

---

### 1.4 HUD Superior — `frontend/src/shared/GameHUD.tsx`

| Elemento | Estado |
|----------|--------|
| **Stats globales** | ✅ Agentes activos, work items running, decisiones pendientes, coste sesión, runtime badge. |
| **Alertas dropdown** | ✅ Contador badge, lista últimas 5 decisiones pending, click → abre AlertsPanel en overlay. |
| **Hokage Direct Input** | ✅ Input estilo terminal, envía a `/hokage/command`, muestra estado última orden. |
| **Ventura selector** | ✅ Dropdown con budget indicator (verde/ámbar/rojo según %). |
| **Auth user** | ✅ Badge operador, logout. |

---

### 1.5 Consola Hokage — `frontend/src/views/HokageConsoleView.tsx` (Fase 10 / C5-C.2)

| Feature | Estado |
|---------|--------|
| **Nueva orden + venture** | ✅ Textarea + selector venture, botón "Ejecutar orden". |
| **Lista órdenes sesión** | ✅ Sidebar izquierdo, click selecciona, persiste en estado local. |
| **Detalle orden** | ✅ Plan (fases/tareas), status badges, briefing resultado. |
| **Gate aprobación (C5-C.2)** | ✅ `awaiting_approval` → notice ámbar + botones "Aprobar plan" / "Rechazar". |
| **Auto-carga awaiting_approval** | ✅ Al montar: `api.hokageCommands('awaiting_approval')` + autoselección. |
| **Presupuesto venture** | ✅ BudgetRow: Asignado/Reservado/Real/Disponible con acento en disponible. |
| **Auditoría** | ✅ Filtro por tipo, venture, 60 eventos, tabla monospace. |
| **Polling fallback** | ✅ 5s interval mientras no terminal (red de seguridad WS). |

---

### 1.6 Autenticación y Arranque — `frontend/src/App.tsx`

| Flujo | Estado |
|-------|--------|
| **BootView** | ✅ Pantalla negra, texto terminal, barra progreso roja, carga `initial_snapshot` + WS. |
| **Auth flow** | ✅ `checking` → `in` (cookie HttpOnly) / `out` (LoginView). Sin VITE_ADMIN_TOKEN en bundle. |
| **LoginView** | ✅ Input password, error handling, Enter para submit. |

---

### 1.7 Tipografía y Tema CSS — `frontend/index.html` + `frontend/src/styles.css`

> **Corrección (2026-08-21, post-Slice 1):** el archivo real es `src/styles.css` (no `src/index.css`), y la paleta viva es la **desaturada**, no los hex aspiracionales de `CLAUDE.md` (`#00ff88`/`#00ccff`/`#ffcc00`). El código manda; `styles.css` (CSS vars) y `world/visuals/palette.ts` (`COLOR` de PixiJS) comparten exactamente estos valores.

| Regla | Cumplimiento |
|-------|--------------|
| **Chakra Petch** (títulos/agentes) | ✅ `@import` + `--font-display` variable |
| **IBM Plex Mono** (datos/código) | ✅ `@import` + `--font-mono` variable |
| **Paleta sci-fi (real)** | ✅ CSS custom properties: `--void #0a0b0d`, `--panel #14161a`, `--line #262a31`, `--ember #e8432d`, `--signal #4fd1c5`, `--amber #f0a93b`, `--good #3ecf6a`, `--ink #e8e6e1`, `--ink-dim #8a8d93` |
| **Colores por rol** | ✅ Fuente única en `styles.css`: `--role-ceo #e8432d`, `--role-investigador #4fd1c5`, `--role-contenido #c77dff`, `--role-trafico #f0a93b`, `--role-finanzas #3ecf6a`, `--role-operaciones #4f8cff`, `--role-soporte #a0aec0` (+ `--role-unknown` fallback). Coinciden con `departments`/`BUILDINGS`. |
| **Glow effects** | ✅ `--ember-glow`, `--signal-glow`, `--amber-*` para text-shadow/box-shadow |
| **Sin Tailwind/emotion** | ✅ Solo inline styles + CSS modules + custom properties |

---

## 2. FALTA ❌

### 2.1 Representación Visual de Agentes en el Mapa

| Brecha | Descripción |
|--------|-------------|
| **Identidad visual por rol** | Todos los tokens usan el mismo diamante + label inicial. No hay diferenciación visual entre Explorador, Escritor, Tráfico, Finanzas, Operaciones, Soporte. Solo color working/idle (ember/signal). |
| **Avatar/icono de agente** | No existe. El mapa muestra "E", "E", "T", "F", "O", "S" — indistinguibles a golpe de vista. |
| **Estado "pensando" vs "ejecutando"** | Solo `working` (boolean). No hay distinción visual entre planificando/ejecutando/esperando. **Corrección (2026-08-21):** aunque `AgentPrimaryState` declara 10 estados, el backend (`agentRuntimeState.ts`) hoy solo emite **4** — `WORKING`, `IDLE`, `COMPLETED`, `ERROR`. Una distinción visual "pensando vs ejecutando" requiere trabajo de backend, no solo frontend. Y `currentTask.tool` está declarado pero **nunca se puebla**. |
| **Historial de movimiento** | Los trails existen pero son puramente estéticos (fade). No comunican "vino de X, va a Y". |

### 2.2 Live Feed — Contenido Rico

| Brecha | Descripción |
|--------|-------------|
| **Payloads truncados** | `LiveFeedPanel` muestra `event.payload` como JSON stringificado truncado a 120 chars. No hay vistas especializadas por tipo de evento (ej. `work_item.started` → mostrar fase/rol/título; `agent.llm_call` → modelo/tokens/coste; `decision.created` → resumen decisión). |
| **Correlación visual** | No hay linking: click en evento de LiveFeed → abre panel correspondiente / destaca token en mapa / abre BuildingView en sección relevante. |
| **Filtros avanzados** | Solo por tipo (agent/work_item/decision/hermes). Falta: por agente, por venture, por severidad, por tiempo. |

### 2.3 Pipeline — Visibilidad de Dependencias

| Brecha | Descripción |
|--------|-------------|
| **Grafo de dependencias** | `PipelinePanel` muestra lista plana de work_items con fase. No visualiza qué tareas esperan a cuáles (DAG). |
| **Cuello de botella** | No hay indicador visual de "tarea bloqueando a N otras" o "camino crítico". |
| **Tiempo estimado** | No hay ETA por tarea ni por fase completa. |

### 2.4 Chat — Contexto y Acciones

| Brecha | Descripción |
|--------|-------------|
| **Acciones rápidas** | No hay botones "Pedir plan", "Ver outputs", "Ver memoria", "Ejecutar tool" inline en el chat. Solo input libre. |
| **Referencias cruzadas** | Mensajes del agente no linkean a work_items, decisions, outputs mencionados. |
| **Historial persistente por edificio** | El chat se reinicia al cambiar de edificio (estado local en BuildingView). No hay persistencia cross-session vía backend. |

### 2.5 BankPanel — Multi-Venture

| Brecha | Descripción |
|--------|-------------|
| **Vista consolidada** | Solo muestra 1 venture a la vez. No hay dashboard "Todas las ventures" con barras comparativas, alertas globales 80%/100%. |
| **Proyección** | No hay "burn rate" semanal/mensual ni "días de runway" calculados. |

### 2.6 BuildingView — Secciones Faltantes por Rol

| Rol | Secciones actuales | Secciones esperadas (visión consolidada) | Faltantes |
|-----|-------------------|------------------------------------------|-----------|
| **ceo (Hokage)** | Chat, LiveFeed, Stats, Pipeline, Alerts | + Objectives, Decisions Log, Strategic Memos | Objectives, Decisions Log, Strategic Memos |
| **finanzas** | Chat, LiveFeed, Stats, Bank, Alerts | + Forecasts, Invoices, P&L, Tax Calendar | Forecasts, Invoices, P&L, Tax Calendar |
| **investigador** | Chat, LiveFeed, Stats, Pipeline, Outputs, Alerts | + Trends Library, Keyword Board, Competitor Tracker | Trends Library, Keyword Board, Competitor Tracker |
| **contenido** | Chat, LiveFeed, Stats, Pipeline, Outputs, Alerts | + Content Calendar, SEO Scorecard, Publishing Queue | Content Calendar, SEO Scorecard, Publishing Queue |
| **system (Operaciones/Soporte)** | Chat, LiveFeed, Stats, Terminal, SystemStatus, Alerts | + Logs Aggregator, Deploy History, Health Checks, Incident Timeline | Logs Aggregator, Deploy History, Health Checks, Incident Timeline |

### 2.7 Mapa — Capas de Información

| Brecha | Descripción |
|--------|-------------|
| **Overlay de métricas** | No hay toggle para mostrar: coste acumulado por sala, tokens consumidos, success rate, nº decisiones pending — como heatmap o labels sobre salas. |
| **Rutas de tokens** | No se ven las "rutas habituales" (Hokage → Investigador → Escritor → Tráfico). Solo posición instantánea. |
| **Zonas de venture** | Los ventures no tienen representación espacial. Todo está en el mismo mapa. |

### 2.8 Hokage Console — Profundidad

| Brecha | Descripción |
|--------|-------------|
| **Historial de órdenes cross-session** | Solo órdenes de la sesión actual + `awaiting_approval` del backend. No hay "Ver todo el historial" con paginación/filtros. |
| **Drill-down a tarea individual** | Click en tarea del plan → no abre detalle de work_item (logs, LLM calls, tools usados, output). |
| **Replan manual** | No hay botón "Forzar replan" ni "Editar plan antes de aprobar". |

---

## 3. REUTILIZABLE ♻️

| Activo | Por qué es reutilizable | Uso recomendado |
|--------|------------------------|-----------------|
| **WorldEngine / ECS Bridge** | Arquitectura limpia, desacoplada de React. `ensureVisual`, `animate`, `spawnParticle`, `tick` son genéricos. | Base para cualquier entidad visual futura (nuevos tipos de nodo, partículas, efectos). |
| **buildingSectionRegistry** | Data-driven puro. Añadir rol/sección = 1 entrada en el mapa. Sin tocar BuildingView. | **El patrón canonical** para cualquier vista contextual futura. |
| **PanelRegistry / OverlayRegistry** | Declarativos, tipados, hot-reload friendly. | Cualquier panel u overlay nuevo se registra en 1 línea. |
| **LiveFeedPanel (core)** | Filtros, LED, auto-scroll, virtualización implícita (max 200 items). | Extender con `renderers` por tipo de evento en lugar de JSON genérico. |
| **StatsPanel (grid)** | Layout responsivo, badges statusTone, formato números. | Reutilizar para cualquier dashboard de métricas (venture, agente, global). |
| **PipelinePanel (flow bar + cards)** | Separación visual fases, status badges, empty state. | Base para "Objective Pipeline" o "Content Pipeline" futuros. |
| **BankPanel (budget bars)** | Lógica % usado, warning 80%, danger 100%, formato USD. | Aplicar a venture budgets, department budgets, campaign budgets. |
| **TerminalPanel (exec runs)** | Tabla monospace, expandible stdout/stderr, color exit code. | Reutilizar para "Agent LLM Calls Log", "Tool Executions Log". |
| **Color system (visuals/COLOR)** | Única fuente de verdad. Cambiar paleta = 1 archivo. | **No duplicar colores en componentes**. |
| **statusTone() helper** | Mapea status string → tone semántico (good/signal/dim/amber/ember). | Usar en **cualquier** badge de estado en toda la app. |
| **WebSocket event typing** | `WsEnvelope` + discriminated union por `event.type`. | Extender con nuevos tipos sin romper consumidores. |

---

## 4. PRIMER SLICE VISUAL RECOMENDADO 🎯

**Objetivo:** Conseguir que el mapa se sienta "vivo y operativo" con el mínimo esfuerzo, aprovechando lo ya construido.

### Slice 1: Identidad Visual de Agentes en el Mapa ✅ IMPLEMENTADO (2026-08-21)

Archivos reales tocados (corrige nombres inventados del plan original — no existían `visuals/COLOR.ts` ni `types/agent.ts`):

| Tarea | Archivos reales | Estado |
|-------|-----------------|--------|
| **A. Monograma por rol** (no icono SVG) | `world/WorldCanvas.tsx` (`ROLE_LETTER`, letra única por rol) | ✅ |
| **B. Color de cuerpo por rol** = color de departamento (no paleta nueva) | `hooks/useWorldState.ts` (`roleColor`, fallback `inkDim`), `world/types.ts` (`TokenDescriptor.color`) | ✅ |
| **C. Tooltip rico al hover** (solo datos reales) | `world/WorldCanvas.tsx` (contenedor `app.stage` + `pointerover/out`) | ✅ |
| **D. Leyenda fija discreta** | `world/WorldCanvas.tsx` (contenedor `app.stage`, esquina inferior izquierda) | ✅ |

**Decisiones aplicadas:**
- **Paleta de roles = colores de departamento** (`departments`/`BUILDINGS`, ya alineados con las CSS vars `--role-*` de `styles.css`). No se inventó ninguna paleta. Fallback `COLOR.inkDim` para `soporte`/`hermes` (sin departamento).
- **Cuerpo = identidad, anillo/burbuja = estado.** El color del token dejó de codificar `working` (que sigue en el anillo pulsante y el minimapa).
- **Iconografía = monograma tipográfico**, no pictograma SVG. Los iconos de `icons.tsx` son stroke-based a 24px con `currentColor`; no downscalan legibles a ~13px en PixiJS ni se pueden inyectar como React en el canvas → pictograma descartado por desproporción, monograma incluido.

**Entregable verificable (honesto):** al abrir el mapa, cada agente se distingue por color de rol + monograma + leyenda sin clicar. El hover muestra **solo datos reales**: nombre, rol, estado (`WORKING/IDLE/COMPLETED/ERROR`), tipo de tarea (`currentTask.kind`), modelo y flags de error/aprobación. **No** muestra `tool` ni estados finos (el backend no los emite).

---

### Slice 2: Live Feed — Renderers por Tipo de Evento (2 días)

| Tarea | Archivos | Esfuerzo |
|-------|----------|----------|
| **A. EventRenderer registry** | Nuevo `frontend/src/panels/EventRenderers.ts` | Medio |
| **B. Renderers: `work_item.*`, `agent.llm_call`, `decision.*`, `hermes.*`** | Idem | Medio |
| **C. Click handler → deep link (abre BuildingView / destaca token)** | `LiveFeedPanel.tsx` + `GameLayout.tsx` | Medio |

**Por qué segundo:** El LiveFeed es el "monitor de pulso" del sistema. Hoy muestra ruido (JSON). Mañana muestra señal accionable.

---

### Slice 3: BuildingView — Secciones Faltantes Críticas (3-4 días)

**Prioridad por impacto en autonomía de Hokage:**

1. **ceo → Objectives + Decisions Log** (Hokage necesita ver sus objetivos y decisiones históricas)
2. **finanzas → Forecasts + P&L** (Presupuesto sin proyección = ciego)
3. **investigador → Trends Library + Keyword Board** (Outputs del Explorador necesitan curación)
4. **contenido → Content Calendar + SEO Scorecard** (Pipeline de publicación real)
5. **system → Health Checks + Incident Timeline** (Operaciones necesita visibilidad)

**Patrón:** Cada sección = 1 panel nuevo (reusando `StatsPanel`/`PipelinePanel`/`OutputsPanel` como base) + 1 entrada en `buildingSectionRegistry`.

---

## 5. FUERA DE ALCANCE POR AHORA 🚫

| Tema | Razón | Revisar en |
|------|-------|------------|
| **Designer Agent (Fase 8)** | Requiere que Hokage proponga cambios de UI → necesita memoria semántica + capacidad de escribir código frontend + gate de aprobación Jorge. Arquitectura actual no lo soporta. | Fase 8 (post-Fase 7 pipeline completo) |
| **VPS Hetzner + Deploy 24/7 (Fase 9)** | Infra, no frontend. Requiere CI/CD, secrets management, PM2, Nginx, Let's Encrypt. | Fase 9 |
| **Notificaciones Telegram (Fase 10)** | Canal externo, requiere bot token, chat_id, retry logic, rate limits. | Fase 10 |
| **Etsy API / Printify (Fase 6/7)** | Integraciones reales con secretos, OAuth, webhooks. `mcp-builder` skill pendiente. | Fase 6 |
| **Multi-venture spatial zones** | Requiere rediseño del mapa (agrupar salas por venture). Rompe `buildingSectionRegistry` actual. | Post-Fase 7 cuando ventures > 1 activos |
| **Persistencia chat cross-session** | Requiere backend: tabla `building_chat_messages` + API + WS sync. Hoy chat es efímero por diseño (Fase 4). | Cuando Jorge lo pida explícitamente |
| **Grafo de dependencias visual (DAG)** | Complejidad algorítmica + layout automático. `PipelinePanel` actual cubre 80% del valor. | Cuando work_items > 50 concurrentes |
| **Agent memory UI (semantic search)** | Backend `agent_memory` existe (Fase 10) pero solo readonly. UI de búsqueda semántica = feature completa. | Fase 10+ |

---

## 6. VERIFICACIÓN: ARQUITECTURA DATA-DRIVEN ⚙️

| Principio | Cumplimiento | Evidencia |
|-----------|--------------|-----------|
| **Frontend sin lógica de negocio** | ✅ | BuildingView solo llama `sectionsForBuilding()` y renderiza paneles. Paneles llaman `api.*` y consumen WS. Cero `if (building.id === 'x')`. |
| **Registro centralizado de secciones** | ✅ | `buildingSectionRegistry.ts` = única fuente de verdad. Añadir sección = 1 línea en el mapa. |
| **Panel/Overlay registries** | ✅ | `PanelRegistry.register()`, `OverlayRegistry.register()` — declarativos, tipados. |
| **Tipos centralizados** | ✅ | `frontend/src/shared/types.ts` + backend `src/types/index.ts` compartidos via build. |
| **Event Bus → WS → Frontend** | ✅ | `WsEnvelope` tipado, `GameLayout` distribuye a `WorldCanvas` (eventos→ripples) y `LiveFeedPanel` (eventos→lista). |
| **Hokage self-modification ready** | 🟡 Parcial | **Listo:** OverlayRegistry permite inyectar vistas nuevas en runtime. PanelRegistry permite añadir paneles. **Falta:** API para registrar componentes desde backend (Designer Agent), sandbox de ejecución, gate de aprobación Jorge. |

---

## 7. RESUMEN EJECUTIVO

| Métrica | Valor |
|---------|-------|
| **Mapa (WorldCanvas)** | 95% completo — entorno vivo, data-driven, ECS limpio |
| **BuildingView** | 70% completo — arquitectura perfecta, faltan secciones por rol |
| **Paneles** | 85% completos — 9/9 paneles core funcionando con datos reales |
| **Hokage Console** | 90% completa — gate aprobación (C5-C.2) verificado E2E |
| **Data-driven architecture** | ✅ Sólida — registries, types, WS typing alineados |
| **Deuda visual crítica** | Identidad de agentes en mapa (tokens indistinguibles) |
| **Primer slice recomendado** | **Identidad visual de agentes en mapa** (2-3 días, alto impacto, bajo riesgo) |

---

**Conclusión:** El frontend **ya es una representación visual fiel del backend**. No hay "fachada vacía". El mapa late con datos reales. Los paneles muestran métricas reales. El gate de aprobación funciona end-to-end.

El siguiente paso visual de alto valor es **hacer que los agentes sean reconocibles en el mapa** — transforma la experiencia de "ver puntos moverse" a "ver a mi equipo trabajando". Todo lo demás (secciones faltantes, Live Feed rico, pipeline DAG) se construye sobre la arquitectura ya validada.

**Esperando instrucciones para proceder con Slice 1 o ajustar prioridades.**