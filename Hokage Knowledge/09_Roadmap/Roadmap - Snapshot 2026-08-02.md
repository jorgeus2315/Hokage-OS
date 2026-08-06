> **Snapshot histórico, no roadmap vigente.** Migrado desde `Roadmap.md` (raíz del repo) — Fase 8 de la migración documental, 2026-08-05. **Sustituido formalmente por [[Master Roadmap - v1]] el 2026-08-06** — ese es el plan de trabajo vigente a partir de ahora. Se conserva este documento porque su Fase 4 (Etsy) y Fase 5 (VPS) siguen siendo reales y ya están incorporadas al nuevo roadmap (F.2 y G.1 respectivamente).
>
> Predata la congelación completa de arquitectura (`HOKAGE_CORE_SPECIFICATION_v1.md`, [[Resumen Ejecutivo - Decisiones Congeladas]], los 10 sistemas diseñados el 2026-08-04/05). Varias de sus fases ya se resolvieron de forma distinta a como las describe este documento — el scheduler real tiene 6 pasos, no 8 etapas (ver [[Runtime, Scheduler y Event Bus]]); el modelo multi-negocio se resolvió sin `business_id` (ver [[ADR-006 - Multi-Venture]]). **La numeración de fases de este documento (1-6) tampoco coincide con la que usa el resto del proyecto (0-10, ver `CLAUDE.md`)** — inconsistencia real, heredada, no resuelta aquí; se conserva tal cual para no fabricar una reconciliación que no está confirmada.
>
> **Lo que sigue siendo cierto y vigente:** Fase 4 (integración Etsy) y Fase 5 (VPS Hetzner + PM2 + Nginx) continúan pendientes tal cual se describen — ver [[Escalabilidad]] y [[Seguridad, Permisos y VPS]] para el estado actual de esos mismos puntos.

---

# ROADMAP HOKAGE OS
> Actualizado: 2026-08-02  
> Referencia: ARCHITECTURE.md v2.0 · docs/research/world-engine/

---

## Estado actual — lo que existe

### Infraestructura ✅
- Backend: Node.js v22 + Express + TypeScript + SQLite + WebSocket
- Frontend: React + Vite + TypeScript + PixiJS
- Agentes con prompts reales en BD (207–276 chars)
- Event Bus (HokageBus) operativo con broadcast WebSocket
- Tool Runtime construido (registry, runtime, manager, types, base) — desconectado

### Frontend ✅
- MapView con edificios y tokens de agentes con animaciones
- BuildingView con 5 pestañas (Chat, Feed, Stats, Pipeline, Alertas)
- WebSocket conectado, recibe eventos del backend
- CrewView, AlertsView operativas

### Deuda técnica activa 🔴

| Problema | Impacto | Sección ARCH |
|----------|---------|-------------|
| `agent_schedules` PK es `agent_role TEXT` | Bloquea multi-business | §10 |
| Tool pipeline desconectado (0 imports desde aiService.ts) | Agentes sin herramientas | §9 |
| Decision → ejecución no cierra el loop | Aprobaciones sin efecto | §6 |
| Event Bus persiste a SQLite en algunos paths | Viola su contrato | §7 |
| No existe tabla `work_items` | Sin scheduler real | §5 |
| bcrypt + jsonwebtoken instalados, nunca usados | Dependencias muertas | §11 |
| UNIQUE constraint falta en agent_memory(agent_id, key) | Duplicados posibles | §10 |

---

## Fase 1 — Scheduler real

> **Objetivo:** el runtime de agentes pasa de setInterval a un scheduler basado en work items con tick de 8 etapas fijas y active agents set.  
> **Criterio de éxito:** los agentes ejecutan, sus resultados persisten en work_items y las decisiones aprobadas disparan automáticamente la ejecución.

### 1.1 — Migración de agent_schedules
- [ ] PK: `agent_role TEXT PRIMARY KEY` → `agent_id INTEGER PRIMARY KEY REFERENCES agents(id)`
- [ ] Actualizar agentRuntime.ts para usar agent_id en todas las consultas de schedule

### 1.2 — Tabla work_items
- [ ] Crear tabla en init.ts (schema en ARCHITECTURE.md §5)
- [ ] Tipos: `autonomous_run` | `event_triggered` | `decision_execution` | `delegated`
- [ ] Estados: `pending` | `in_progress` | `done` | `failed` | `cancelled`
- [ ] Locking: campo `locked_at` + TTL de 30 minutos por defecto

### 1.3 — Tick con 8 etapas fijas
- [ ] Refactorizar `pollTick()` en agentRuntime.ts con las 8 etapas nombradas
- [ ] Active agents set: `Set<number>` que controla quién se procesa este ciclo
- [ ] Etapa 1: eventos del bus → work_items `event_triggered`
- [ ] Etapa 2: escanear cola → asignar, marcar `in_progress` con `locked_at`
- [ ] Etapa 3: ejecutar async con timeout = TTL
- [ ] Etapa 4: verificar TTL expirados → devolver a `pending`
- [ ] Etapa 5: recoger resultados → actualizar work_items + agent_runs
- [ ] Etapa 6: generar work_items derivados (pipeline Explorador → Diseñador → Vendedor)
- [ ] Etapa 7: decisions `approved` sin work_item de ejecución → crear uno con P9
- [ ] Etapa 8: actualizar agent_costs + agent_budgets

### 1.4 — Cierre del loop decisión → acción
- [ ] Cuando `decisions.status = 'approved'`: Etapa 7 crea work_item `{ type: 'decision_execution', priority: 9 }`
- [ ] El agente emisor de la decision es el receptor del work_item de ejecución

### 1.5 — Limpieza de deuda técnica
- [ ] Eliminar bcrypt y jsonwebtoken del package.json
- [ ] Añadir `UNIQUE(agent_id, key)` en agent_memory
- [ ] Drop tablas muertas: achievements, agent_progress, tools (schema legacy)
- [ ] Event Bus: eliminar cualquier escritura a SQLite — solo in-memory history[]

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

---

## Relacionado

- [[Resumen Ejecutivo - Decisiones Congeladas]]
- [[Runtime, Scheduler y Event Bus]]
- [[ADR-006 - Multi-Venture]]
- [[Escalabilidad]]
- [[Handoff Histórico - 2026-08-03]]
- [[INDEX]]
