# ROADMAP HOKAGE OS
> Actualizado: 2026-08-16  
> Referencia: ARCHITECTURE.md v2.0 · ADR-011 (Agent Registry) · ADR-012 (Task Graph DAG) · docs/research/world-engine/  
> Commits de referencia: `6b0c4eb` (ADR-011 + ADR-012) · `555666d` (Agent Runtime ↔ ADR-011, claims unificados)

---

## Estado actual — lo que existe

### Infraestructura ✅
- Backend: Node.js v22 + Express + TypeScript + SQLite + WebSocket
- Frontend: React + Vite + TypeScript + PixiJS
- Agentes con prompts reales en BD (207–276 chars)
- Event Bus (HokageBus) operativo con broadcast WebSocket
- Tool Runtime construido (registry, runtime, manager, types, base) — **conectado** a `aiService.ts` (function calling con OpenRouter)
- Agent Registry + selección por capabilities + claim/release atómico (ADR-011)
- Orquestación DAG de tareas: dependencies, handoffs, review cycles, replanning (ADR-012)

### Frontend ✅
- MapView con edificios y tokens de agentes con animaciones
- BuildingView con 5 pestañas (Chat, Feed, Stats, Pipeline, Alertas)
- WebSocket conectado, recibe eventos del backend
- CrewView, AlertsView operativas

### Deuda técnica — estado tras `6b0c4eb` / `555666d`

| Problema original | Impacto | Estado real (verificado en código) |
|----------|---------|--------|
| `agent_schedules` PK era `agent_role TEXT` | Bloqueaba multi-business | ✅ migrado a `agent_id INTEGER PRIMARY KEY REFERENCES agents(id)` |
| Tool pipeline desconectado (0 imports desde aiService.ts) | Agentes sin herramientas | ✅ conectado — `aiService.ts` importa `tools/registry` y ejecuta el loop de function calling |
| Decision → ejecución no cerraba el loop | Aprobaciones sin efecto | ✅ `stage7_closeDecisionLoop` crea work_item `decision_execution` (P9) para `decisions.status='approved'` |
| No existía tabla `work_items` | Sin scheduler real | ✅ existe con modelo completo (tipos, estados, `locked_at`, `ttl_minutes`, `retry_count`, `venture_id`, `model`) |
| bcrypt + jsonwebtoken instalados, sin usar | Dependencias muertas | ✅ ya no están en `package.json` |
| Faltaba UNIQUE en `agent_memory(agent_id, key)` | Duplicados posibles | ✅ `CREATE UNIQUE INDEX … ON agent_memory(agent_id, venture_id, key)` (aislado por venture, F8) |
| Event Bus persiste a SQLite en algunos paths | ¿Viola su contrato? | 🟡 `history[]` sigue in-memory, pero `bus.publish` invoca `recordBusEvent` (audit saneado en SQLite) por evento — confirmar si es sidecar deliberado o deuda a limpiar |

---

## Fase 1 — Scheduler real ✅ COMPLETADA (y superada por ADR-011 / ADR-012)

> **Objetivo original:** el runtime pasa de setInterval a un scheduler basado en work_items con tick de etapas fijas.  
> **Estado:** implementado en `6b0c4eb` (ADR-011 + ADR-012) y `555666d` (Agent Runtime ↔ ADR-011). El scheduler real **ya no es "algo por construir desde cero"**: ejecuta work_items con `claimAgent` como gate atómico de exclusión, y la orquestación DAG de Hokage está operativa. La exclusión mutua vive en la BD, no en memoria.

### ✅ COMPLETADO

**Scheduler / Runtime autónomo** — `agentRuntime.ts`
- `work_items` como cola real (tabla con modelo completo; ver tabla de deuda arriba).
- Tick de etapas fijas en `pollTick()`: `stage1` drenar bus → `stage2` asignar → `stage3` ejecutar (+ persistir resultado inline) → `stage4` TTL → `stage7` cerrar loop de decisión → `stage8` métricas → `stage9` broadcast de estado.
- **`claimAgent` como GATE ATÓMICO `pending → in_progress`** (identidad del claim = `work_item.id`), sin ventana SELECT-comprobar+UPDATE.
- **`releaseAgent` en éxito y error** (`stage3`), **TTL requeue/cancel** (`stage4`), **presupuesto** (`stage2`) y **cancelación de comando** (Hokage).
- **`cleanupExpiredClaims` una vez por tick** (red anti-deadlock: resetea `availability` tras expiración sin release).
- **Ejecución coordinada** entre runtime autónomo, Hokage y endpoints manuales (`/run`, `/ask`) sobre **una única primitiva** de exclusión.
- `activeAgents` **ya NO es barrera de exclusión** → solo métrica derivada efímera; la exclusión durable vive en `agents.claimed_by_task`.
- Migración `agent_schedules` → PK `agent_id`.
- Cierre del loop **decisión → acción**: `stage7` crea work_item `decision_execution` (P9) para decisiones aprobadas.

**Agent Registry + selección** — ADR-011 (🔒 congelado 2026-08-16) · `agentSelector.ts` · 33 tests
- Agent Registry (capa de dato entre `role_definitions` y `agents`).
- Capabilities atómicas (vocabulario cerrado) + **selección por matching determinista** (`selectAgent`, no creación implícita).
- Tipos de agente (`permanent | temporary | reviewer`) + **disponibilidad** (`availability`).
- **Claim/release atómico** + **lifecycle de claims** (`claimed_by_task`, `claim_expires_at`, `cleanupExpiredClaims`).

**Orquestación DAG** — ADR-012 (🔒 congelado 2026-08-15) · `taskGraph.ts` + `hokageOrchestrator.ts` · 13 tests
- **DAG explícito** de tareas (`task_edges`: `depends_on`, `handoff`, `review_of`); `phase` queda como orden topológico derivado, no fuente de verdad.
- **Dispatch de tareas READY** (`depends_on_count === 0`) vía `dispatchReadyTasks`.
- **Directed hand-offs** (payload estructurado propagado del `result` de la predecesora al prompt de la sucesora).
- **Review cycles / verdicts** (`review_of`, `max_review_cycles`).
- **Replanning** acotado del supervisor ante fallo (tope `MAX_REPLANS`).

### 🟡 PENDIENTE / DEUDA (real, verificada — no inventada)
- **Caminos legacy vivos:** `dispatchPhase` / `advanceCommand` (dispatch por fase) conviven con el dispatch DAG (`dispatchReadyTasks`). Consolidar o retirar el camino fase-based.
- **Etapas del runtime sin consolidar:** la Etapa 5 va *inline* dentro de `stage3` y la Etapa 6 (pipeline derivado) vive en el drenaje de bus de `stage1`; la numeración `stage1..stage9` tiene huecos y conviene nombrarla/estructurarla explícitamente.
- **Event Bus ↔ SQLite:** `bus.publish` escribe un audit saneado por evento (`recordBusEvent`). Confirmar el contrato: ¿sidecar de auditoría deliberado o escritura a eliminar? (ver tabla de deuda).
- **Métricas / observabilidad:** `stage8` solo hace `console.log` de contadores de cola; no hay métricas persistidas ni endpoint de observabilidad del runtime.
- **3 tests pre-existentes en rojo** en `hokageOrchestrator.db.test.ts` (`#6` dependencias, `#7/#8` continuación segura, `#13` replanificación) — integración del DAG, **ajenos a los claims**; fallan idénticos desde `6b0c4eb` (probado con `git stash`). No se tocan en este ciclo.

---

## Fase 2 — Tool Pipeline real

> **Objetivo:** los agentes llaman a herramientas reales via function calling con OpenRouter.  
> **Criterio de éxito:** el Explorador ejecuta TrendsTool y el resultado aparece en su agent_memory.

### 2.1 — Conexión aiService ↔ tools/registry
- [ ] Importar ToolRegistry en aiService.ts
- [ ] Construir function schemas desde los tools disponibles del agente (ya existe el schema en tools/)
- [ ] Implementar el loop de function calling:
  ```
  OpenRouter responde con tool_calls
    → registry.execute(toolName, params)
    → resultado vuelve como tool_result al LLM
    → LLM genera respuesta final
  ```

### 2.2 — TrendsTool real (primera herramienta)
- [ ] Implementar búsqueda real de Google Trends (scraping público, sin API de pago)
- [ ] Output: `{ keyword, volume, trend: 'up'|'stable'|'down', relatedQueries[] }`
- [ ] Coste: $0

### 2.3 — Presupuestos y límites
- [ ] Crear tablas `agent_costs` y `agent_budgets` en BD (schema en ARCHITECTURE.md §13)
- [ ] `canAgentRun()` verifica presupuesto en Etapa 2 del scheduler antes de asignar
- [ ] Umbral de acción (80%): log de advertencia
- [ ] Umbral de fallo (100%): bloquear + crear Decision `{ type: 'budget_request' }`

### 2.4 — Registro de costes
- [ ] Registrar tokens (input + output) en `agent_costs` tras cada ejecución
- [ ] Registrar coste de tool calls en `agent_costs.tool_cost_usd`
- [ ] El Tesorero lee `agent_costs` como fuente de sus reportes

---

## Fase 3 — Frontend definitivo

> **Objetivo:** el frontend es una ventana fiel al estado real del backend, en tiempo real, con el estilo visual definitivo.  
> **Criterio de éxito:** abrir Hokage OS sin tocar nada durante 5 minutos y ver actividad real del sistema.

### 3.1 — WebSocket como fuente única de verdad
- [ ] Al conectar: backend envía snapshot completo del estado inicial
- [ ] Eliminar el polling REST para estado inicial (no REST + WebSocket en paralelo)
- [ ] Tipos de snapshot: `agent_state_snapshot`, `work_queue_snapshot`, `pipeline_snapshot`, `recent_events_snapshot`
- [ ] Cada snapshot incluye `timestamp` de cuando fue capturado

### 3.2 — MapView definitivo (PixiJS)
- [ ] Edificios con forma específica por departamento
- [ ] Tokens con animaciones de estado (idle orbita HQ, working anillo pulsa, done doble anillo ámbar)
- [ ] Spokes con partículas: densidad proporcional a actividad real (work_items activos)
- [ ] Overlays activables: actividad actual, presupuesto, pipeline, salud por sala

### 3.3 — BuildingView por sala con datos reales
- [ ] Chat directo con el agente (conectado al runtime real, guarda en `messages`)
- [ ] Live Feed: últimos 20 eventos del bus filtrados por sala, en tiempo real
- [ ] Stats: datos reales desde BD (métricas específicas por sala)
- [ ] Pipeline: work_items de este agente por estado (pendientes / activos / completados)
- [ ] Alertas: decisions pendientes de este agente con título, razonamiento y coste

### 3.4 — AlertsView funcional
- [ ] Decisions pendientes con razonamiento completo
- [ ] Botón Aprobar: `PATCH /decisions/:id { status: 'approved' }` → Etapa 7 crea work_item
- [ ] Botón Rechazar: `PATCH /decisions/:id { status: 'rejected' }` + motivo
- [ ] Badge rojo en crew rail actualizado en tiempo real por WebSocket

### 3.5 — Polish visual
- [ ] Paleta void/ember/signal aplicada consistentemente en todos los componentes
- [ ] Tipografía: Chakra Petch para títulos/nombres, IBM Plex Mono para datos
- [ ] Glow effects en elementos activos (box-shadow neón verde/cyan)
- [ ] Boot screen: fondo negro, texto terminal, barra de progreso roja

---

## Fase 4 — Primer negocio real (Etsy)

> **Objetivo:** el pipeline completo tendencia → publicación funciona end-to-end en Etsy.  
> **Criterio de éxito:** primera venta real generada por agentes, registrada en el Banco en tiempo real.

### 4.1 — EtsyTool real
- [ ] OAuth 2.0 con Etsy API v3, credenciales en .env
- [ ] Read: `getListings()`, `getOrders()`, `getReviews()`, `getListingAnalytics()`
- [ ] Write (requieren Decision aprobada): `createListing()`, `updateListing()`, `createReply()`

### 4.2 — Pipeline automatizado completo
- [ ] Explorador detecta tendencia (TrendsTool) → `bus.emit('trend.detected')` → work_item para Diseñador
- [ ] Diseñador genera contenido → Decision `{ type: 'publish', amount: 0, risk: 'low' }`
- [ ] Jorge aprueba → Etapa 7 crea work_item `decision_execution` para Vendedor (P9)
- [ ] Vendedor llama `EtsyTool.createListing()` → `bus.emit('content.published')`
- [ ] Tesorero registra en agent_costs + actualiza business_budgets.revenue

### 4.3 — Revenue en tiempo real
- [ ] Vendedor monitoriza pedidos Etsy cada ciclo (work_item `autonomous_run` cada 45 min)
- [ ] Cada venta: `bus.emit('sale.received', { amount, platform, productId })`
- [ ] Banco: contador de revenue en edificio actualizándose via WebSocket

### 4.4 — Test de 30 minutos
- [ ] Abrir Hokage OS · No tocar nada · Esperar 30 min
- [ ] ✓ Conversaciones entre agentes en Ship Comms
- [ ] ✓ Work items procesados visibles en Pipeline tabs
- [ ] ✓ Explorador ha analizado tendencias
- [ ] ✓ Actividad visible en el mapa (spokes con partículas)
- [ ] ✓ Sin intervención de Jorge

---

## Fase 5 — Producción 24/7

> **Objetivo:** el sistema corre solo en VPS sin supervisión de Jorge.

### 5.1 — VPS Hetzner CX22
- [ ] Ubuntu 24.04 · 2 vCPU · 4GB RAM · 40GB SSD (~4€/mes)
- [ ] PM2 para mantener procesos vivos con reinicio automático
- [ ] Nginx como proxy inverso + SSL termination
- [ ] Let's Encrypt (Certbot) renovación automática

### 5.2 — Monitorización
- [ ] Health check endpoint `GET /health` con estado de agentes y work_items activos
- [ ] PM2 logs con rotación automática
- [ ] Notificación Telegram cuando el proceso cae o un agente falla 3 veces seguidas

### 5.3 — Shopify integration
- [ ] ShopifyTool con Shopify Admin API + credenciales OAuth en .env
- [ ] El Vendedor gestiona Etsy + Shopify en paralelo (business_id diferencia el contexto)
- [ ] Revenue de ambas plataformas consolida en el Banco

---

## Fase 6 — Multi-negocio y escalado

> **Objetivo:** el ecosistema gestiona más de un negocio sin código nuevo.

### 6.1 — Multi-business support
- [ ] `work_items.business_id` separa contexto por negocio
- [ ] `agent_schedules` con `business_id` permite que el mismo rol opere en múltiples negocios
- [ ] El Explorador monitoriza keywords por negocio independientemente
- [ ] El Tesorero reporta P&L por negocio separado

### 6.2 — Agentes adicionales
- [ ] Agente de Soporte al Cliente (dedicado cuando el negocio crezca)
- [ ] Agente de Diseño Generativo (imágenes de producto con AI, requiere budget aprobado)
- [ ] Cada nuevo agente = registro en `agents` + prompt en `agent_prompts` + sala en `departments`
- [ ] No se toca código del runtime — el scheduler lo descubre automáticamente

### 6.3 — Migración a PostgreSQL (si aplica)
- [ ] Migrar si se superan 2 negocios activos simultáneos o 10 agentes
- [ ] El schema de tablas no cambia — solo el driver de BD
- [ ] Mantener SQLite en desarrollo, PostgreSQL en producción

---

## Criterios de éxito del proyecto

| Criterio | Fase objetivo |
|----------|--------------|
| Scheduler con work_items y 8 etapas | Fase 1 |
| Agentes usando herramientas reales (TrendsTool) | Fase 2 |
| Frontend refleja estado real sin polling REST | Fase 3 |
| Pipeline tendencia → publicación end-to-end | Fase 4 |
| Primera venta real generada por agentes | Fase 4 |
| Jorge solo abre Hokage OS para aprobar/rechazar | Fase 4 |
| Sistema 24/7 en VPS sin supervisión | Fase 5 |
| Revenue mensual > coste del ecosistema | Fase 5–6 |
| Segundo negocio activo sin código nuevo | Fase 6 |
