# ARCHITECTURE — HOKAGE OS
> Fuente de verdad para el desarrollo. Actualizar aquí antes de tocar código.

---

## Índice

1. [Filosofía y visión](#1-filosofía-y-visión)
2. [El ecosistema en capas](#2-el-ecosistema-en-capas)
3. [El motor del mundo — World Engine](#3-el-motor-del-mundo--world-engine)
4. [Los agentes — empleados digitales](#4-los-agentes--empleados-digitales)
5. [El Scheduler — motor de agentes](#5-el-scheduler--motor-de-agentes)
6. [El núcleo de decisiones](#6-el-núcleo-de-decisiones)
7. [El Bus de eventos](#7-el-bus-de-eventos)
8. [Las salas — departamentos funcionales](#8-las-salas--departamentos-funcionales)
9. [Capa de integración — Tools](#9-capa-de-integración--tools)
10. [Modelo de datos](#10-modelo-de-datos)
11. [Infraestructura y operación](#11-infraestructura-y-operación)
12. [Reglas de expansión](#12-reglas-de-expansión)
13. [Economía del ecosistema](#13-economía-del-ecosistema)
14. [Relaciones entre agentes](#14-relaciones-entre-agentes)
15. [Ciclo de vida de un negocio](#15-ciclo-de-vida-de-un-negocio)
16. [Filosofía visual](#16-filosofía-visual)

---

## 1. Filosofía y visión

### El contrato fundamental

Hokage OS **no es un panel de administración**.

Es un ecosistema vivo donde equipos de agentes de IA trabajan de forma autónoma para crear, gestionar y hacer crecer negocios reales. La sensación debe ser la de dirigir una empresa dentro de un videojuego tipo Tycoon (RimWorld, Game Dev Tycoon, Factorio).

**Cuando Jorge abre Hokage OS debe ver:**
- Conversaciones apareciendo entre agentes
- Pedidos llegando a la tienda
- El Explorador publicando una nueva tendencia detectada
- El Banco actualizando el revenue en tiempo real
- El Estudio proponiendo un rediseño de interfaz

Jorge no programa. No ejecuta tareas. **Solo toma las grandes decisiones.**

### Qué hace Jorge

| Acción | Frecuencia |
|--------|-----------|
| Crear un nuevo negocio | Puntual |
| Contratar un nuevo agente | Puntual |
| Asignar presupuesto a una sala | Puntual |
| Aprobar o rechazar decisiones de gasto | Cuando hay alertas |
| Hablar directamente con un agente | Cuando quiere |
| Aprobar publicaciones importantes | Cuando hay alertas |

**Todo lo demás lo hace la IA.**

### Qué NO es Hokage OS

- ❌ Un dashboard con tablas y filtros
- ❌ Un chatbot donde Jorge escribe comandos
- ❌ Una app SaaS genérica con sidebar y formularios
- ❌ Un sistema donde Jorge tiene que ejecutar tareas manualmente

### El test de calidad

> *"¿Puedo abrir Hokage OS, no hacer nada durante 30 minutos, y cuando vuelva ver que ha pasado algo útil?"*

Si la respuesta es sí, el sistema funciona. Si no, algo está roto.

---

## 2. El ecosistema en capas

El sistema tiene 4 capas. Cada una tiene una responsabilidad única y no invade la de arriba ni la de abajo.

```
┌─────────────────────────────────────────────────────────┐
│  CAPA 4 — MUNDO VISUAL (Frontend / PixiJS)              │
│  Lo que Jorge ve: mapa, salas, agentes en movimiento    │
│  React + PixiJS + WebSocket                             │
├─────────────────────────────────────────────────────────┤
│  CAPA 3 — AGENTES (Agent Runtime)                       │
│  Empleados digitales que piensan, deciden y actúan      │
│  Node.js + OpenRouter + SQLite (memoria)                │
├─────────────────────────────────────────────────────────┤
│  CAPA 2 — BUS DE EVENTOS (Event Bus)                    │
│  Sistema nervioso: conecta agentes sin acoplarlos       │
│  EventEmitter (HokageBus) + WebSocket broadcast         │
├─────────────────────────────────────────────────────────┤
│  CAPA 1 — INTEGRACIONES (Tools)                         │
│  APIs externas: Etsy, Shopify, Google Trends, etc.      │
│  Clientes HTTP con OAuth, rate limiting y retry         │
└─────────────────────────────────────────────────────────┘
```

### Flujo de datos — el loop completo

```
[Explorador detecta tendencia en Google Trends]
       ↓
  bus.emit('trend.detected', { keyword, volume, score })
       ↓
[Estudio recibe el evento → pide al LLM crear contenido]
       ↓
  Decision creada en SQLite { status: 'proposed', amount: 0 }
       ↓
[WebSocket broadcast → frontend muestra alerta en tiempo real]
       ↓
[Jorge aprueba en BuildingView]
       ↓
[Tienda publica en Etsy/Shopify via Tool]
       ↓
  bus.emit('content.published', { url, platform })
       ↓
[Banco registra el gasto, actualiza proyección]
```

### Principio de separación

- El **frontend** nunca llama directamente a herramientas externas
- Los **agentes** nunca escriben HTML ni actualizan componentes React
- El **bus** nunca persiste datos — solo emite y escucha
- Los **tools** nunca tienen lógica de negocio — solo son adaptadores

---

## 3. El motor del mundo — World Engine

### Responsabilidad

Gestionar la posición y movimiento de todos los "tokens" (agentes) en el mapa con interpolación suave, sin saltos.

### Arquitectura

```
WorldEngine (clase singleton por sesión)
├── nodes: Map<id, WorldNode>       ← posición actual + target + trail
├── tick(): void                    ← llamado por el loop PixiJS (~60fps)
└── upsert / setTarget / remove     ← API pública

WorldNode {
  id: string
  pos: Vec2       ← posición interpolada actual (lo que PixiJS renderiza)
  target: Vec2    ← destino (calculado por MapView según estado del agente)
  trail: Vec2[]   ← últimas 7 posiciones (para la estela de movimiento)
  color: number   ← hex del departamento al que pertenece
  label: string   ← nombre del agente
}
```

### Constantes de diseño

| Constante | Valor | Significado |
|-----------|-------|-------------|
| `EASE` | `0.06` | Suavidad del movimiento. 0 = instantáneo, 1 = nunca llega |
| `TRAIL_EVERY` | `5` frames | Frecuencia de captura de puntos de estela |
| `TRAIL_MAX` | `7` puntos | Longitud máxima del rastro visual |

### Comportamiento de los tokens en el mapa

Un agente (token) tiene 3 posibles ubicaciones:

```
1. EN ESPERA  → orbita alrededor del Hokage HQ
               ángulo = (idx * 360/totalEnEspera) + 20°
               radio = TOKEN_ORBIT (220 px mundo)

2. TRABAJANDO → fijo en su sala (a TOKEN_ROOM_OFFSET=50 bajo el centro)
               anillo ember pulsando lentamente

3. ACABA DE ACTUAR (< 30s) → en su sala
               doble anillo amber + rotación del diamante
```

### Mundo fijo y snapshots inmutables

Hokage OS tiene un mundo deliberadamente pequeño y fijo: exactamente N departamentos en posiciones conocidas desde el inicio. No hay generación procedural ni chunk loading. Esto hace innecesaria la arquitectura de chunks de Factorio — el modelo de RimWorld (arrays planos, mundo de tamaño fijo, O(1) para cualquier lookup) es la referencia correcta.

La comunicación entre backend y frontend sigue el principio de **snapshot inmutable**: cada mensaje WebSocket que el backend envía al frontend es un objeto con estado congelado en el momento de su generación (con timestamp). El frontend nunca accede al estado en vivo mientras el backend lo modifica — trabaja siempre sobre el último snapshot recibido. Esto elimina las race conditions entre el ciclo del scheduler y las lecturas del frontend.

### Extensión futura

Para el mapa con zoom libre y cámara desplazable, WorldEngine necesitará coordenadas de mundo sin límite de pantalla y culling de edificios fuera del viewport. La interpolación no cambia — solo el sistema de coordenadas.

---

## 4. Los agentes — empleados digitales

### Qué es un agente

Un agente es una entidad persistente en SQLite con:
- Un **rol** que define su especialidad
- Un **prompt de sistema** con su personalidad (tabla `agent_prompts`)
- **Memoria** de sus acciones pasadas (tabla `agent_memory`)
- Un **ciclo de ejecución** autónomo con intervalo propio

Los agentes no son chatbots. Son empleados que trabajan aunque Jorge no esté mirando.

### Anatomía

```typescript
// Tabla agents (SQLite)
interface Agent {
  id: number
  name: string          // "Yuki", "Kira", "Rex" — nombre propio, no genérico
  role: string          // 'ceo' | 'explorador' | 'diseñador' | 'finanzas' | 'trafico'
  status: string        // 'active' | 'idle' | 'working' | 'waiting_approval'
  model: string         // modelo OpenRouter asignado a este agente
  created_at: string
}

// Tabla agent_prompts (SQLite) — personalidad del agente
interface AgentPrompt {
  agent_id: number
  role: string
  system_prompt: string  // personalidad, objetivos, forma de hablar, límites
  updated_at: string
}
```

### Ciclo de vida de un agente

```
[IDLE] → timer dispara cada N minutos
         ↓
[WORKING] → lee memoria reciente (últimas 10 entradas de agent_memory)
            → construye prompt con contexto real del negocio
            → llama a OpenRouter con function schemas de sus tools
            ↓
         ¿necesita aprobar?
         /            \
      NO               SÍ
      ↓                ↓
   ejecuta         crea Decision en SQLite
   tool/acción     emite 'decision.created'
      ↓            Jorge aprueba → continúa
   guarda en       Jorge rechaza → aprende
   agent_memory
      ↓
[IDLE] → espera siguiente ciclo
```

### Los 5 agentes (Fase 1)

| Agente | Sala | Modelo | Intervalo | Trabajo autónomo |
|--------|------|--------|-----------|-----------------|
| **Hokage** | HQ | claude-sonnet-4-5 | Siempre disponible | Coordina, responde a Jorge, resume estado global |
| **Explorador** | Laboratorio | gemini-flash-1.5 | 30 min | Busca tendencias, detecta oportunidades, emite eventos |
| **Diseñador** | Estudio | claude-haiku-4-5 | 60 min | Crea contenido, propone cambios de UI, genera assets |
| **Tesorero** | Banco | gemini-flash-1.5 | 15 min | Monitoriza revenue, genera reportes, detecta anomalías |
| **Vendedor** | Tienda | gemini-flash-1.5 | 45 min | Gestiona catálogo, publica, optimiza SEO, responde reseñas |

### El Diseñador — caso especial

El agente Diseñador tiene un poder único: puede proponer cambios a la interfaz de Hokage OS mismo.

```
Diseñador observa → "el mapa tarda en cargar, propongo reducir trail_max"
                              ↓
                   crea Decision { type: 'ui_change', payload: { config } }
                              ↓
                   Jorge aprueba → cambio se aplica en settings
```

Esto hace que Hokage OS sea auto-mejorable. El sistema aprende de su propio uso.

### Memoria de agentes

Antes de cada ejecución, el runtime inyecta contexto:

```typescript
// En aiService.askAgent() — construir contexto antes del LLM call
const recentMemory = db.all(
  'SELECT key, value FROM agent_memory WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10',
  [agent.id]
)
const recentRuns = db.all(
  'SELECT action, status FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 5',
  [agent.id]
)
// → se incluye en el mensaje de sistema como contexto estructurado
```

---

---

## 5. El Scheduler — motor de agentes

### Principio

Solo los agentes con trabajo activo consumen ciclos de CPU. El scheduler no itera sobre todos los agentes en cada ciclo — mantiene un **active agents set** y procesa únicamente ese set.

Un agente **entra** en el set activo cuando:
- Se le asigna un work item
- El Event Bus emite un evento que le concierne
- Un timer de ejecución programada expira

Un agente **sale** del set activo cuando:
- Su work item llega a estado terminal (completado / fallado / cancelado)
- No tiene eventos pendientes ni timers activos
- Está en cooldown hasta la próxima ejecución programada

El coste del scheduler es O(agentes activos), no O(agentes totales). Con 7 agentes y 2–3 activos en un momento dado, el scheduler es prácticamente gratuito en CPU.

### Tick con orden fijo — 8 etapas

Cada ciclo del agent runtime ejecuta estas etapas **en orden fijo e inmutable**. El orden garantiza que los resultados de un agente estén disponibles para otros en el siguiente ciclo, no en el mismo, eliminando race conditions por diseño.

```
Etapa 1: Procesar eventos del Event Bus pendientes
         → convierte eventos de negocio en work_items de tipo 'event_triggered'
         → ejemplo: trend.detected → work_item para Diseñador

Etapa 2: Escanear cola de work_items pendientes
         → ordena por priority DESC, created_at ASC
         → asigna items pending a agentes disponibles en el active set
         → marca item como 'in_progress', registra locked_at

Etapa 3: Ejecutar agentes con work_items asignados
         → async con timeout = TTL del work_item (defecto: 30 min)
         → resultado se colecta en Etapa 5, no bloquea el ciclo

Etapa 4: Verificar TTL de work_items In-Progress
         → WHERE status='in_progress' AND locked_at < NOW - ttl_minutes
         → items expirados vuelven a 'pending' con retry_count + 1
         → si retry_count >= 3, marcar como 'failed' y crear alerta

Etapa 5: Recoger resultados de ejecuciones completadas
         → actualizar work_items.status, work_items.result
         → actualizar agent_runs con result + cost

Etapa 6: Generar work_items derivados de resultados
         → el output de un agente puede ser input del siguiente
         → ejemplo: Diseñador completa → work_item para Vendedor si Decision aprobada

Etapa 7: Evaluar decisions aprobadas por Jorge
         → WHERE decisions.status='approved' AND no existe work_item de ejecución
         → crear work_item { type: 'decision_execution', priority: 9 }
         → esto cierra el loop aprobación → acción

Etapa 8: Actualizar métricas y presupuestos
         → incrementar tokens consumidos en agent_costs
         → decrementar budget disponible en agent_budgets
         → si presupuesto ≥ 80%: alerta. Si ≥ 100%: bloquear + Decision budget_request
```

### Work items — la unidad atómica de trabajo

Los work items son el mecanismo de persistencia del scheduler. Lo que el Event Bus emite (efímero), el work item lo convierte en trabajo rastreable y recuperable.

```sql
CREATE TABLE work_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id         INTEGER NOT NULL REFERENCES agents(id),
  business_id      INTEGER REFERENCES businesses(id),
  type             TEXT NOT NULL,
  -- 'autonomous_run'     → ejecución autónoma por timer
  -- 'event_triggered'    → generado por un evento del bus
  -- 'decision_execution' → generado por aprobación de Jorge
  -- 'delegated'          → tarea enviada de un agente a otro
  priority         INTEGER NOT NULL DEFAULT 6,
  -- 9: decisión aprobada por Jorge (máxima urgencia)
  -- 8: evento urgente (venta, alerta crítica)
  -- 7: work item de pipeline activo
  -- 6: ejecución autónoma programada
  -- 5: análisis periódico de fondo
  status           TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled'
  context          TEXT,            -- JSON: contexto completo para el agente
  result           TEXT,            -- JSON: resultado producido
  locked_at        TEXT,            -- timestamp de cuando se marcó in_progress
  ttl_minutes      INTEGER DEFAULT 30,
  retry_count      INTEGER DEFAULT 0,
  created_at       TEXT DEFAULT (datetime('now')),
  resolved_at      TEXT
);

CREATE INDEX idx_work_items_agent_status ON work_items(agent_id, status);
CREATE INDEX idx_work_items_priority ON work_items(priority DESC, created_at ASC);
```

### Sistema de prioridades con aging

Para evitar starvation de work items de baja prioridad, la prioridad efectiva en la Etapa 2 se calcula como:

```
prioridad_efectiva = priority + floor(minutos_en_cola / 10)
```

Un work item de prioridad 5 que lleva 30 minutos en cola tiene prioridad efectiva 8 — equivalente a un evento urgente. Esto garantiza que ningún trabajo válido quede bloqueado indefinidamente.

### Dos umbrales para métricas de agente

Las métricas de salud de los agentes (presupuesto, tasa de error) tienen dos umbrales separados, no uno:

- **Umbral de acción (80%):** el agente toma medidas preventivas autónomamente (reduce frecuencia, usa modelo más barato si disponible)
- **Umbral de fallo (100%):** Jorge recibe una Decision de tipo `budget_request`. El agente no se cancela — se pausa hasta aprobación

La ventana entre ambos umbrales evita que cualquier fluctuación menor genere alertas, pero garantiza que los problemas reales lleguen a Jorge.

### Locking In-Progress con TTL

Un work item marcado `in_progress` solo puede ser tomado por un agente. Si el agente falla (timeout de OpenRouter, crash del proceso Node.js), el work item no queda bloqueado indefinidamente — la Etapa 4 lo detecta y lo devuelve a `pending`. Esto es el equivalente del In-Progress locking de Prison Architect aplicado al scheduler de agentes.

---

## 6. El núcleo de decisiones

### La regla de oro

> **Si una acción cuesta dinero o es pública, requiere aprobación de Jorge. Todo lo demás, el agente decide solo.**

### Matriz de autonomía

| Acción | Autonomía | Ejemplo |
|--------|-----------|---------|
| Leer datos externos | Total | Buscar tendencias en Google |
| Guardar en memoria | Total | Registrar análisis completado |
| Emitir eventos al bus | Total | Notificar tendencia detectada |
| Comunicarse con otro agente | Total | Escribir mensaje en Ship Comms |
| Crear un draft de contenido | Total | Redactar descripción de producto |
| Generar un reporte | Total | Reporte financiero semanal |
| **Publicar contenido** | **Aprobación** | Subir producto a Etsy |
| **Gastar dinero** | **Aprobación** | Contratar servicio externo |
| **Modificar configuración** | **Aprobación** | Cambiar interfaz de Hokage OS |
| **Contratar agente nuevo** | **Aprobación** | Añadir agente de soporte |

### Schema de Decision

```typescript
interface Decision {
  id: number
  agent_id: number
  title: string              // "Publicar 3 productos en Etsy"
  description: string        // qué va a hacer exactamente
  reasoning: string          // por qué lo propone
  amount: number | null      // coste estimado en USD (null si es gratis)
  risk_level: 'low' | 'medium' | 'high'
  status: 'proposed' | 'approved' | 'rejected' | 'executed'
  created_at: string
}
```

### Flujo de aprobación

```
Decision { status: 'proposed' }
    ↓
WebSocket → frontend muestra badge rojo en Alertas
    ↓
Jorge abre AlertsView
    ↓
Lee: título, descripción, razonamiento, coste
    ↓
APRUEBA → status: 'approved' → agente ejecuta la acción → status: 'executed'
RECHAZA → status: 'rejected' → agente registra en memoria "propuesta rechazada: [motivo]"
```

---

## 7. El Bus de eventos

### Responsabilidad

Conectar agentes entre sí y con el frontend **sin que se conozcan directamente**.

El bus es el sistema nervioso de Hokage OS. Sin él, cada agente sería una isla.

### Implementación

```typescript
// config/eventBus.ts
class HokageBus extends EventEmitter {
  private history: BusEvent[] = []  // últimos 100 eventos

  emit(event: string, payload: unknown): boolean {
    this.history.push({ event, payload, ts: Date.now() })
    if (this.history.length > 100) this.history.shift()
    // broadcast a todos los clientes WebSocket conectados
    wsServer.broadcast({ type: 'agent.event', data: { type: event, payload } })
    return super.emit(event, payload)
  }
}

export const bus = new HokageBus()
bus.setMaxListeners(50)
```

### Catálogo de eventos

| Evento | Emisor | Consumidor | Payload |
|--------|--------|-----------|---------|
| `trend.detected` | Explorador | Diseñador, Vendedor | `{ keyword, volume, score }` |
| `content.created` | Diseñador | Vendedor | `{ type, draft, assets[] }` |
| `content.published` | Vendedor | Tesorero | `{ platform, url, productId }` |
| `sale.received` | Vendedor | Tesorero, Hokage | `{ amount, platform, product }` |
| `decision.created` | Cualquiera | Frontend (alerta) | `{ decisionId, agentId, title }` |
| `decision.approved` | Runtime | Agente emisor | `{ decisionId }` |
| `report.generated` | Tesorero | Hokage | `{ period, revenue, expenses }` |
| `ui.change.proposed` | Diseñador | Frontend (alerta) | `{ component, change, reason }` |
| `agent.task.start` | Runtime | Frontend (LED activo) | `{ agentId, action }` |
| `agent.task.done` | Runtime | Frontend (LED ok) | `{ agentId, action, result }` |
| `agent.task.error` | Runtime | Frontend (LED error) | `{ agentId, action, error }` |

### Contrato de eventos

- Todo evento tiene `snake.case` con punto como separador
- El payload siempre es un objeto, nunca un primitivo
- **El bus NO persiste eventos a SQLite.** La persistencia es responsabilidad del receptor del evento: si un agente necesita tracking, crea un `work_item` en BD. El bus es fire-and-forget; los `work_items` son el mecanismo de persistencia del scheduler
- El historial en memoria (`history[]`) existe solo para depuración — máximo 100 eventos, descartados al reiniciar
- El WebSocket broadcast incluye todos los eventos para que el frontend siempre esté actualizado
- **Eventos → work_items:** la Etapa 1 del scheduler escucha el bus y convierte eventos de negocio relevantes en work_items para el agente receptor. Esto cierra el loop entre un evento efímero y una tarea rastreable

---

## 8. Las salas — departamentos funcionales

### Qué es una sala

Una sala es la representación visual y funcional de un departamento. Tiene:
- Un **agente** que vive en ella
- Un **edificio** en el mapa (PixiJS)
- Una **vista de detalle** cuando Jorge entra (BuildingView)
- **Datos reales** en pantalla — nunca decorativos

### Las 5 salas — Fase 1

#### 🏯 Hokage HQ — Centro de mando

| Campo | Valor |
|-------|-------|
| ID | `hokage` |
| Agente | Hokage (CEO) |
| Color | `#e8432d` (ember) |
| Posición | Centro del mapa |

**Qué hace el agente:** Coordina al equipo, responde a Jorge, genera resúmenes de estado global, toma decisiones de alto nivel.

**Qué ve Jorge al entrar:**
- Chat directo con Hokage
- Estado de todos los agentes en tiempo real
- Decisiones pendientes de aprobación
- Revenue del día vs. objetivo

---

#### 🔬 Laboratorio — Investigación de mercado

| Campo | Valor |
|-------|-------|
| ID | `laboratorio` |
| Agente | Explorador |
| Color | `#4fd1c5` (cyan) |
| Modelo | `gemini-flash-1.5` |
| Intervalo | 30 min |

**Qué hace el agente:** Analiza Google Trends, detecta nichos, evalúa competencia, emite `trend.detected` cuando encuentra algo accionable.

**Qué ve Jorge al entrar:**
- Últimas tendencias detectadas (keyword, volumen, score)
- Historial de análisis con timestamp
- Gráfico de evolución de los keywords seguidos
- Chat con el Explorador para pedir análisis específicos

---

#### 🎨 Estudio — Diseño y contenido

| Campo | Valor |
|-------|-------|
| ID | `estudio` |
| Agente | Diseñador |
| Color | `#c77dff` (violeta) |
| Modelo | `claude-haiku-4-5` |
| Intervalo | 60 min |

**Qué hace el agente:** Crea descripciones de producto, propone mejoras de UX a Hokage OS, genera ideas de contenido basadas en las tendencias del Explorador.

**Qué ve Jorge al entrar:**
- Contenido en borrador esperando aprobación
- Propuestas de cambio de interfaz (con vista previa)
- Historial de contenido publicado
- Chat con el Diseñador para pedir un tipo de contenido concreto

**Poder especial:** Las propuestas de UI change aparecen con un diff visual de qué cambiaría. Jorge aprueba → el cambio se aplica.

---

#### 🏦 Banco — Gestión económica

| Campo | Valor |
|-------|-------|
| ID | `banco` |
| Agente | Tesorero |
| Color | `#3ecf6a` (verde) |
| Modelo | `gemini-flash-1.5` |
| Intervalo | 15 min |

**Qué hace el agente:** Monitoriza revenue de Shopify y Etsy, detecta anomalías (venta inusualmente alta, gasto inesperado), genera reportes financieros, alerta si el margen cae.

**Qué ve Jorge al entrar:**
- Revenue hoy / esta semana / este mes
- Gasto en APIs (OpenRouter, herramientas externas)
- Margen neto estimado
- Últimas transacciones en tiempo real
- Reporte del Tesorero con análisis y recomendaciones

---

#### 🛍️ Tienda — Ventas y marketing

| Campo | Valor |
|-------|-------|
| ID | `tienda` |
| Agente | Vendedor |
| Color | `#f0a93b` (amber) |
| Modelo | `gemini-flash-1.5` |
| Intervalo | 45 min |

**Qué hace el agente:** Gestiona el catálogo activo en Etsy/Shopify, optimiza títulos y descripciones para SEO, responde reseñas negativas (con aprobación), publica nuevos productos cuando el Diseñador los crea.

**Qué ve Jorge al entrar:**
- Catálogo activo con thumbnails, precio y ventas
- Pedidos recientes
- Métricas por producto (vistas, conversión, favoritos)
- Chat con el Vendedor para pedir cambios de catálogo

---

### Estructura de BuildingView (cuando Jorge entra)

Cada sala tiene 5 pestañas:

```
[CHAT] [FEED EN VIVO] [STATS] [PIPELINE] [ALERTAS]

CHAT     → conversación directa con el agente de la sala
FEED     → últimos 20 eventos del bus relacionados con esta sala
STATS    → métricas específicas de esta sala (diferente por sala)
PIPELINE → tareas en cola, en progreso, completadas
ALERTAS  → decisiones pendientes de aprobación de este agente
```

---

## 9. Capa de integración — Tools

### Responsabilidad

Adaptadores hacia APIs externas. Los tools son tontos: reciben parámetros, llaman a la API, devuelven datos estructurados. **Sin lógica de negocio.**

### Contrato de tool

```typescript
// tools/base.ts
interface Tool {
  name: string
  description: string           // el LLM lee esto para saber cuándo usarlo
  parameters: ZodSchema         // validación de inputs
  execute(params: unknown): Promise<ToolResult>
}

interface ToolResult {
  ok: boolean
  data?: unknown
  error?: string
  cost?: number                 // en USD, para tracking en Banco
}
```

### Tools — Fase 1

| Tool | API | Operaciones read | Operaciones write (requieren aprobación) |
|------|-----|------------------|----------------------------------------|
| `EtsyTool` | Etsy API v3 | Leer ventas, pedidos, reviews | Crear/editar listado, responder review |
| `ShopifyTool` | Shopify Admin API | Leer pedidos, productos | Publicar producto, actualizar precio |
| `TrendsTool` | Google Trends (unofficial) | Buscar keywords, volumen | — (solo lectura) |
| `WebBrowserTool` | Playwright/Puppeteer | Buscar info pública | — (solo lectura) |

### Pipeline de function calling

```
agentRuntime llama a askAgent()
    ↓
aiService construye messages + function schemas de los tools disponibles
    ↓
OpenRouter responde con tool_calls si el LLM quiere usar un tool
    ↓
aiService ejecuta: registry.execute(toolName, params)
    ↓
resultado vuelve al LLM como tool_result
    ↓
LLM genera respuesta final con la información del tool
    ↓
si la respuesta implica acción de write → crear Decision
```

---

## 10. Modelo de datos

### Tablas activas

```sql
-- Agentes del sistema
agents (id, name, role, status, model, created_at)

-- Personalidad y prompt de cada agente (data stage — inmutable en runtime)
agent_prompts (id, agent_id, role, system_prompt, updated_at)

-- Memoria de cada agente (máx 50 entradas por agente)
agent_memory (id, agent_id, key, value, created_at)
-- UNIQUE(agent_id, key) — no puede haber duplicados de la misma clave por agente
-- key ejemplos: 'last_trend_analyzed', 'competitor_found', 'content_approved'

-- Historial de ejecuciones
agent_runs (id, agent_id, action, status, result, cost, started_at, finished_at)

-- SCHEDULER: unidad atómica de trabajo (ver §5 para schema completo)
work_items (id, agent_id, business_id, type, priority, status, context, result,
            locked_at, ttl_minutes, retry_count, created_at, resolved_at)

-- SCHEDULER: timer de ejecución programada por agente
-- NOTA: PK es agent_id (INTEGER), NO agent_role (TEXT) — el role puede repetirse en multi-business
agent_schedules (agent_id INTEGER PRIMARY KEY, interval_minutes, last_run_at, next_run_at)

-- Decisiones que requieren aprobación
decisions (id, agent_id, title, description, reasoning, amount, risk_level, status, created_at)
-- Cuando status cambia a 'approved' → Etapa 7 del scheduler crea work_item de ejecución

-- Tareas delegadas entre agentes (Tipo 2 de comunicación, ver §14)
agent_tasks (id, from_agent_id, to_agent_id, title, context, priority, status,
             result, blocked_reason, created_at, resolved_at)

-- Mensajes entre agentes y con Jorge
messages (id, sender_id, receiver_id, content, channel, created_at)

-- Negocios activos
businesses (id, name, channel, category, status, target_revenue, current_revenue)

-- Departamentos/salas del mapa
departments (id, name, desc, role, color, pos_x, pos_y, is_hub)
```

### Tablas a eliminar (código muerto)

```sql
-- achievements, agent_progress, tools (schema legacy)
-- Existen en schema pero ningún servicio las escribe
-- Eliminar en próxima migración
```

### Índices necesarios

```sql
CREATE INDEX idx_agent_memory_agent ON agent_memory(agent_id);
CREATE INDEX idx_agent_runs_agent ON agent_runs(agent_id);
CREATE INDEX idx_decisions_status ON decisions(status);
CREATE INDEX idx_messages_sender ON messages(sender_id);
-- UNIQUE constraint en memoria para evitar duplicados
CREATE UNIQUE INDEX idx_agent_memory_key ON agent_memory(agent_id, key);
```

---

## 11. Infraestructura y operación

### Desarrollo local

```
Backend  → localhost:3000  (Node.js + tsx, hot reload)
Frontend → localhost:5173  (Vite + React)
WebSocket → ws://localhost:3000
BD       → backend/data/hokage-os.db (SQLite, WAL mode)
```

### VPS Hetzner CX22 (Fase 6)

```
2 vCPU · 4GB RAM · 40GB SSD · Ubuntu 24.04
PM2       → mantiene backend vivo, reinicio automático
Nginx     → proxy inverso + SSL termination
Certbot   → Let's Encrypt renovación automática
SQLite    → ahora · PostgreSQL cuando escale
```

### Variables de entorno requeridas

```bash
PORT=3000
OPENROUTER_API_KEY=...       # nunca hardcodeado, siempre desde .env
FRONTEND_URL=https://...     # para CORS en producción
ETSY_API_KEY=...             # OAuth Etsy
SHOPIFY_API_KEY=...          # OAuth Shopify
ADMIN_TOKEN=...              # Bearer token para endpoints de mutación
```

### Problema crítico: el runtime no sobrevive reinicios

Los `setInterval` viven en memoria. Si Node.js se cae, los agentes dejan de ejecutarse.

**Solución Fase 1:** Scheduler basado en SQLite.

```sql
-- Nueva tabla: agent_schedules
CREATE TABLE agent_schedules (
  agent_id INTEGER PRIMARY KEY,
  interval_minutes INTEGER NOT NULL,
  last_run_at TEXT,
  next_run_at TEXT NOT NULL
);
```

Al arrancar el backend, el runtime lee `next_run_at` de cada agente y programa los timers correctamente. Si ya debería haber corrido (next_run_at < NOW), corre inmediatamente.

---

## 12. Reglas de expansión

### Añadir un nuevo negocio

1. Crear registro en tabla `businesses`
2. Crear credenciales OAuth del canal (Etsy / Shopify / etc.)
3. Añadir las credenciales al `.env`
4. No se toca ningún otro archivo — los agentes existentes detectan el nuevo negocio via DB

### Añadir un nuevo agente

1. Crear registro en tabla `agents` con role único
2. Crear entrada en `agent_prompts` con su personalidad
3. Registrar en `agentRuntime.ts` su intervalo y sus tools disponibles
4. Crear su sala en `departments` con posición en el mapa
5. Añadir su edificio en el mapa (WorldCanvas detecta nuevos departments)

### Añadir una nueva sala

1. Crear registro en `departments`
2. WorldCanvas renderiza automáticamente el nuevo edificio
3. Añadir sección de stats específica en BuildingView si la sala necesita métricas propias

### Añadir un nuevo tool

1. Crear clase en `tools/` que extiende `BaseTool`
2. Registrar en `tools/registry.ts`
3. Añadir al array de tools disponibles del agente que lo usará en `agentRuntime.ts`
4. El LLM lo descubre automáticamente via function schemas

### Lo que NUNCA cambia

- La arquitectura de carpetas de backend (`agents/`, `config/`, `db/`, `routes/`, `services/`, `tools/`, `types/`)
- El contrato del Event Bus (emit → listen)
- Los tipos centralizados en `types/index.ts`
- El patrón de aprobación para acciones costosas o públicas

---

---

## 13. Economía del ecosistema

### Principio

Toda acción de un agente tiene un coste medible. El sistema conoce en todo momento cuánto cuesta mantener el ecosistema y cuánto está generando. El Banco (sección 7) es la sala que expone esta información a Jorge.

### Coste por ejecución de agente

Cada vez que `agentRuntime` ejecuta un ciclo de un agente, se registra un coste en la tabla `agent_costs`. El coste tiene dos componentes:

```
coste_ejecucion = coste_modelo + coste_tools
```

**Coste por modelo (OpenRouter — verificar precios actuales en dashboard):**

| Agente | Modelo | Coste input (aprox.) | Coste output (aprox.) |
|--------|--------|---------------------|----------------------|
| Hokage | claude-sonnet-4-5 | $3.00 / M tokens | $15.00 / M tokens |
| Diseñador | claude-haiku-4-5 | $0.25 / M tokens | $1.25 / M tokens |
| Explorador | gemini-flash-1.5 | $0.075 / M tokens | $0.30 / M tokens |
| Tesorero | gemini-flash-1.5 | $0.075 / M tokens | $0.30 / M tokens |
| Vendedor | gemini-flash-1.5 | $0.075 / M tokens | $0.30 / M tokens |

**Coste por tool use:**

| Tool | Coste por llamada |
|------|------------------|
| TrendsTool | $0.00 (scraping, sin API de pago) |
| EtsyTool (read) | $0.00 (incluido en plan API) |
| EtsyTool (write) | $0.00 (incluido en plan API) |
| ShopifyTool (read) | $0.00 (incluido en plan) |
| ShopifyTool (write) | $0.00 (incluido en plan) |
| WebBrowserTool | $0.001 por página (Playwright hosting si aplica) |

El campo `tool_cost_usd` se actualiza en `agent_costs` tras cada llamada a `registry.execute()`.

### Schema de economía

```sql
-- Coste de cada ejecución de agente
CREATE TABLE agent_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_run_id  INTEGER NOT NULL REFERENCES agent_runs(id),
  agent_id      INTEGER NOT NULL REFERENCES agents(id),
  business_id   INTEGER REFERENCES businesses(id),  -- a qué negocio imputa el coste
  model         TEXT NOT NULL,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  model_cost_usd  REAL DEFAULT 0,
  tool_calls    INTEGER DEFAULT 0,
  tool_cost_usd   REAL DEFAULT 0,
  total_cost_usd  REAL GENERATED ALWAYS AS (model_cost_usd + tool_cost_usd) STORED,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Presupuesto por agente — límites de gasto
CREATE TABLE agent_budgets (
  agent_id          INTEGER PRIMARY KEY REFERENCES agents(id),
  daily_limit_usd   REAL NOT NULL DEFAULT 0.50,
  monthly_limit_usd REAL NOT NULL DEFAULT 10.00,
  spent_today_usd   REAL NOT NULL DEFAULT 0,
  spent_month_usd   REAL NOT NULL DEFAULT 0,
  last_daily_reset  TEXT,
  last_month_reset  TEXT
);

-- Presupuesto por negocio — separación contable
CREATE TABLE business_budgets (
  business_id        INTEGER PRIMARY KEY REFERENCES businesses(id),
  monthly_limit_usd  REAL NOT NULL DEFAULT 50.00,
  spent_month_usd    REAL NOT NULL DEFAULT 0,
  revenue_month_usd  REAL NOT NULL DEFAULT 0,
  last_reset         TEXT
);
```

### Presupuestos por defecto — Fase 1

| Agente | Límite diario | Límite mensual | Justificación |
|--------|--------------|----------------|---------------|
| Hokage | $0.50 | $15.00 | Modelo caro, se usa solo cuando Jorge habla |
| Explorador | $0.20 | $5.00 | Muchas ejecuciones, modelo barato |
| Diseñador | $0.30 | $8.00 | Haiku, ejecuciones largas |
| Tesorero | $0.10 | $3.00 | Solo lectura de datos, prompts cortos |
| Vendedor | $0.20 | $5.00 | Ejecuciones frecuentes, modelo barato |
| **Total ecosistema** | **$1.30/día** | **$36/mes** | Coste base de operación |

### Sistema de límites y aprobación

Antes de cada ejecución, `agentRuntime` evalúa:

```typescript
async function canAgentRun(agentId: number): Promise<{ allowed: boolean; reason?: string }> {
  const budget = db.get('SELECT * FROM agent_budgets WHERE agent_id = ?', agentId)
  resetIfNewDay(budget)  // reset spent_today_usd si cambió el día

  if (budget.spent_today_usd >= budget.daily_limit_usd) {
    // Crear Decision en lugar de ejecutar
    createDecision({
      agent_id: agentId,
      title: `Límite diario alcanzado — solicita ampliar presupuesto`,
      description: `Ha gastado $${budget.spent_today_usd.toFixed(3)} de $${budget.daily_limit_usd} permitidos hoy.`,
      risk_level: 'low',
      amount: budget.daily_limit_usd  // solicita duplicar el límite
    })
    return { allowed: false, reason: 'daily_limit_reached' }
  }
  return { allowed: true }
}
```

Si un agente alcanza su límite diario, **no se cancela el agente** — se crea una Decision de tipo `budget_request` con el coste adicional solicitado. Jorge la aprueba o rechaza.

### ROI y métricas financieras

El Tesorero calcula el ROI del ecosistema cada vez que ejecuta:

```
ROI = (revenue_month_usd - spent_month_usd) / spent_month_usd × 100

Ejemplo:
  Revenue Shopify + Etsy este mes: $450
  Coste OpenRouter este mes: $28
  Coste herramientas: $2
  ROI = (450 - 30) / 30 × 100 = 1400%
```

Estas métricas se almacenan en `business_budgets.revenue_month_usd` y se actualizan cada vez que llega un evento `sale.received` del bus. El Banco los muestra en tiempo real.

### Lo que el Banco muestra con estos datos

- Coste de hoy / coste de este mes (por agente y total)
- Revenue de hoy / este mes (Etsy + Shopify en tiempo real)
- ROI actual del ecosistema
- Alerta si un agente está cerca de su límite (≥80%)
- Histórico de costes por día (últimos 30 días)
- Desglose: cuánto cuesta el modelo vs. cuánto cuestan los tools

---

## 14. Relaciones entre agentes

### Principio

Los agentes no trabajan en silo. Se comunican, se bloquean, se desbloquean y comparten contexto como un equipo real. El Event Bus (sección 6) es el canal principal, pero para tareas concretas que requieren respuesta existe un sistema de delegación estructurado.

### Los tres tipos de comunicación

#### Tipo 1 — Broadcast (uno a todos)

El agente emite un evento al bus. Cualquier agente suscrito lo recibe. No espera respuesta.

```
Explorador → bus.emit('trend.detected', { keyword: 'minimalist posters', volume: 8200 })
                 ↓ (automático)
Diseñador recibe → comienza a generar contenido
Vendedor recibe  → evalúa si tiene stock relacionado
```

Cuándo usarlo: descubrimientos, actualizaciones de estado, eventos del sistema.

#### Tipo 2 — Tarea delegada (uno a uno, con respuesta)

Un agente crea una tarea en la tabla `agent_tasks` dirigida a otro agente específico. El receptor la detecta en su próxima ejecución, la procesa y actualiza el resultado.

```sql
CREATE TABLE agent_tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent_id  INTEGER NOT NULL REFERENCES agents(id),
  to_agent_id    INTEGER NOT NULL REFERENCES agents(id),
  title          TEXT NOT NULL,
  context        TEXT NOT NULL,  -- JSON con toda la información necesaria
  priority       TEXT DEFAULT 'normal',  -- 'urgent' | 'normal' | 'low'
  status         TEXT DEFAULT 'pending', -- 'pending' | 'in_progress' | 'done' | 'blocked' | 'cancelled'
  result         TEXT,           -- JSON con la respuesta del agente receptor
  blocked_reason TEXT,           -- por qué está bloqueado (si status = 'blocked')
  created_at     TEXT DEFAULT (datetime('now')),
  resolved_at    TEXT
);
```

#### Tipo 3 — Conversación directa (mensaje en Ship Comms)

Los agentes pueden enviarse mensajes que Jorge también puede leer. Se usa para actualizaciones de estado, preguntas y negociaciones sobre una tarea. Persiste en la tabla `messages` con `channel = 'agent-to-agent'`.

### Grafo de relaciones

No todos los agentes se comunican con todos. Las relaciones son intencionales:

```
Explorador ──broadcast──► Diseñador      (tendencias detectadas)
Explorador ──broadcast──► Vendedor       (oportunidades de mercado)
Explorador ──broadcast──► Tesorero       (datos de mercado para análisis)

Diseñador  ──delegación──► Vendedor      (producto listo para publicar)
Diseñador  ──broadcast──►  Hokage        (propuesta de cambio de UI)

Vendedor   ──broadcast──►  Tesorero      (venta recibida, gasto realizado)
Vendedor   ──delegación──► Diseñador     (necesita nueva imagen de producto)

Tesorero   ──broadcast──►  Hokage        (reporte financiero, alerta de gasto)
Tesorero   ──delegación──► Vendedor      (ajustar precio de producto con bajo margen)

Hokage     ──delegación──► Cualquiera    (cuando Jorge da una instrucción directa)
Hokage     ──broadcast──►  Todos         (cuando Jorge cambia estrategia global)
```

### Bloqueo y desbloqueo

Un agente se bloquea cuando necesita información de otro agente para continuar y no puede avanzar sin ella.

```typescript
// El Diseñador necesita las tendencias actuales antes de crear contenido
// pero el Explorador aún no ha ejecutado este ciclo

const task = db.get(
  'SELECT * FROM agent_tasks WHERE to_agent_id = ? AND status = ?',
  [designerId, 'pending']
)

if (!task) {
  // No hay tarea pendiente — crea una para el Explorador y se bloquea
  db.run(
    'INSERT INTO agent_tasks (from_agent_id, to_agent_id, title, context, priority) VALUES (?,?,?,?,?)',
    [designerId, exploradorId, 'Necesito tendencias actuales', JSON.stringify({ category: 'minimalist' }), 'urgent']
  )
  db.run(
    'UPDATE agents SET status = ? WHERE id = ?',
    ['waiting_for_peer', designerId]
  )
  bus.emit('agent.blocked', { agentId: designerId, waitingFor: exploradorId, reason: 'trends_needed' })
  return  // el Diseñador no ejecuta nada más este ciclo
}
```

El Explorador, en su próxima ejecución, detecta la tarea urgente y la procesa primero. Cuando actualiza `status = 'done'`, el bus emite `agent.unblocked` y el Diseñador vuelve a su ciclo normal en el siguiente tick.

### Herencia de contexto

Cuando un agente completa una tarea y crea la siguiente en la cadena, **transfiere el contexto acumulado**. El receptor hereda todo lo que el emisor sabe.

```typescript
// El Explorador termina su análisis y delega al Diseñador
const explorerResult = {
  keyword: 'minimalist canvas prints',
  volume: 12400,
  competition: 'medium',
  avgPrice: 28.50,
  topColors: ['#E8E8E0', '#2C2C2C', '#F5F0E8'],
  suggestedFormats: ['8x10', '11x14', '16x20']
}

db.run(`
  INSERT INTO agent_tasks (from_agent_id, to_agent_id, title, context, priority)
  VALUES (?, ?, ?, ?, ?)
`, [
  exploradorId,
  diseñadorId,
  'Crear 3 descripciones de producto para nueva colección minimalista',
  JSON.stringify({
    trend: explorerResult,       // el Diseñador sabe exactamente qué investigó el Explorador
    businessId: 1,               // a qué negocio aplica
    requestedBy: 'autonomous'    // o 'jorge' si vino de una instrucción directa
  }),
  'normal'
])
```

El Diseñador no necesita investigar de nuevo. Empieza desde donde terminó el Explorador.

### Ejemplos completos de flujo entre departamentos

#### Ejemplo A — Pipeline completo: tendencia → producto publicado

```
[Explorador · ciclo autónomo · 14:30]
  Lee Google Trends → detecta "minimalist canvas prints" con volumen creciente
  Guarda en agent_memory: key='last_trend', value=JSON(resultado)
  bus.emit('trend.detected', { keyword, volume: 12400, score: 87 })
       ↓
[Diseñador · recibe evento]
  Genera 3 descripciones de producto + título SEO optimizado
  Crea Decision { title: 'Publicar 3 productos nuevos en Etsy', amount: 0, risk: 'low' }
  bus.emit('decision.created', { decisionId: 42 })
       ↓
[Frontend · WebSocket · tiempo real]
  Badge rojo aparece en alertas de Jorge
       ↓
[Jorge · aprueba la Decision]
  status → 'approved'
  bus.emit('decision.approved', { decisionId: 42 })
       ↓
[Vendedor · recibe aprobación]
  Llama a EtsyTool.createListing() × 3
  bus.emit('content.published', { platform: 'etsy', count: 3, urls: [...] })
       ↓
[Tesorero · recibe evento]
  Registra gasto: $0 (publicar en Etsy es gratis)
  Actualiza business_budgets.revenue_month_usd cuando lleguen ventas
  Emite reporte en Ship Comms: "3 nuevos productos publicados. Revenue potencial: $85/semana."
```

#### Ejemplo B — Agente bloqueado: el Vendedor necesita una imagen nueva

```
[Vendedor · ciclo autónomo · 16:00]
  Revisa catálogo → detecta producto con CTR bajo (0.8%)
  Analiza: la imagen principal es de baja calidad
  No puede mejorar la imagen solo (fuera de su especialidad)
  → Crea agent_task dirigida al Diseñador:
    { title: 'Regenerar imagen principal del producto #47', priority: 'normal',
      context: { productId: 47, currentCTR: 0.008, platform: 'etsy' } }
  → Actualiza su status: 'waiting_for_peer'
  → Continúa con otras tareas del ciclo (no se queda completamente paralizado)
       ↓
[Diseñador · próxima ejecución · 17:00]
  Lee agent_tasks pendientes dirigidas a él
  Encuentra la tarea del Vendedor (priority: 'normal')
  Genera nueva descripción visual + prompt para generación de imagen
  Crea Decision { title: 'Generar nueva imagen para producto #47', amount: 0.02 }
       ↓
[Jorge · aprueba]
       ↓
[Diseñador · ejecuta]
  Llama a imagen generativa, guarda asset
  Actualiza agent_task: status='done', result=JSON({ assetUrl, prompt })
  bus.emit('asset.ready', { productId: 47, assetUrl })
       ↓
[Vendedor · recibe evento / próxima ejecución]
  Actualiza la imagen en Etsy via ShopifyTool/EtsyTool
  Su status vuelve a 'active'
```

#### Ejemplo C — Anomalía financiera: el Tesorero alerta a Hokage

```
[Tesorero · ciclo · 09:00]
  Lee ventas de Etsy de las últimas 24h: $0
  Compara con promedio de los últimos 7 días: $45/día
  Detecta anomalía: 100% de caída en revenue
  No puede diagnosticar el problema solo (está fuera de su sala)
  → Crea agent_task para Hokage: { title: 'Investigar caída de revenue', priority: 'urgent',
      context: { revenueHoy: 0, promedioSemanal: 45, posiblesCausas: ['listing suspendido', 'API error'] } }
  → bus.emit('alert.critical', { from: 'tesorero', message: 'Revenue en 0 hoy' })
       ↓
[Hokage · recibe tarea urgente]
  Lee contexto del Tesorero
  Llama a EtsyTool.getListingStatus() para cada producto
  Detecta: el listing principal fue suspendido por Etsy (política de imágenes)
  → Crea Decision { title: 'Corregir listing suspendido #23 en Etsy', risk: 'high' }
  → Envía mensaje a Jorge via Ship Comms con diagnóstico completo
       ↓
[Jorge · revisa, aprueba]
       ↓
[Hokage · corrige el listing]
  bus.emit('issue.resolved', { type: 'listing_suspended', productId: 23 })
  El Tesorero registra la incidencia en memoria para futuras detecciones
```

---

## 15. Ciclo de vida de un negocio

### Principio

Cualquier negocio creado dentro de Hokage OS sigue siempre la misma arquitectura de fases. Los departamentos son invariables — solo cambia el contenido que procesan. Esto permite que el ecosistema gestione múltiples negocios simultáneamente sin código nuevo.

### Las 12 fases

#### Fase 1 — Idea
**Quién:** Jorge + Hokage

Jorge habla con Hokage y describe el concepto. Hokage hace preguntas de validación inicial: ¿qué vende?, ¿a quién?, ¿en qué plataforma?, ¿cuál es el precio objetivo?

Al terminar, Hokage crea el registro en la tabla `businesses` con `status = 'ideation'` y encola el primer análisis para el Explorador.

#### Fase 2 — Investigación
**Quién:** Laboratorio (Explorador)

El Explorador recibe el contexto del negocio y ejecuta:
- Análisis de keywords relacionados (TrendsTool)
- Estudio de competidores en la plataforma objetivo (WebBrowserTool)
- Estimación de volumen de mercado y precios de referencia

Resultado: reporte estructurado guardado en `agent_memory` + delegación al Banco para validación.

#### Fase 3 — Validación
**Quién:** Banco (Tesorero)

El Tesorero recibe el reporte del Explorador y evalúa viabilidad financiera:
- Margen estimado (precio venta - coste producción - comisiones plataforma)
- Proyección de revenue a 30/60/90 días si el Explorador alcanza sus estimaciones de tráfico
- Presupuesto mínimo necesario para arrancar

Si el margen es positivo: `businesses.status = 'validated'`
Si el margen es negativo: crea Decision con informe para que Jorge decida si continúa.

#### Fase 4 — Branding
**Quién:** Estudio (Diseñador)

El Diseñador recibe el contexto del negocio + datos de mercado del Explorador y propone:
- Nombre del negocio (si no lo tiene)
- Paleta de colores
- Tono de comunicación (formal, minimalista, premium, casual...)
- Keywords de posicionamiento

Todo queda como Decision `{ type: 'branding', risk: 'low' }` para que Jorge apruebe. No se aplica nada sin su visto bueno.

#### Fase 5 — Diseño de producto
**Quién:** Estudio (Diseñador)

Aprobado el branding, el Diseñador crea:
- Imágenes del producto siguiendo la paleta aprobada
- Descripciones principales en el tono de comunicación elegido
- Variantes (tamaños, colores, formatos según la plataforma)

Resultado: assets + copys guardados en la tarea delegada al Vendedor.

#### Fase 6 — Automatización
**Quién:** Todos los agentes

Antes de publicar nada, cada agente configura sus rutinas para este negocio:
- Explorador: añade los keywords del negocio a su monitorización semanal
- Tesorero: crea `business_budgets` con límites y objetivos de revenue
- Vendedor: registra las credenciales de la plataforma objetivo (requiere aprobación de Jorge)
- Hokage: actualiza su contexto global con el nuevo negocio

#### Fase 7 — Publicación
**Quién:** Tienda (Vendedor)

El Vendedor publica los primeros productos en la plataforma objetivo usando los assets del Diseñador.

Cada publicación es una Decision `{ type: 'publish', amount: 0, risk: 'low' }`. Una vez aprobada, ejecuta la llamada a la API de la plataforma.

`businesses.status = 'active'`
bus.emit('business.launched', { businessId, platform, productCount })

#### Fase 8 — Ventas
**Quién:** Tienda (Vendedor) + Banco (Tesorero)

El Vendedor monitoriza pedidos entrantes via EtsyTool/ShopifyTool. Cada venta dispara:
- bus.emit('sale.received', { amount, platform, productId })
- Tesorero actualiza revenue en tiempo real
- Banco muestra el incremento en la sala de Finanzas

#### Fase 9 — Atención al cliente
**Quién:** Tienda (Vendedor)

El Vendedor revisa reviews y mensajes de compradores en cada ciclo. Si detecta una reseña negativa:
- Analiza el problema
- Redacta una respuesta
- Crea Decision `{ type: 'customer_reply', risk: 'medium' }` con la respuesta para que Jorge la apruebe
- Si es positiva, la responde automáticamente con agradecimiento genérico (sin aprobación)

#### Fase 10 — Optimización
**Quién:** Laboratorio + Banco + Tienda

Cada 7 días, el Explorador reevalúa los keywords del negocio. El Tesorero analiza qué productos tienen mejor margen. El Vendedor recibe las recomendaciones y propone ajustes de precio, nuevas variantes o eliminación de productos sin ventas.

Todo como Decisions. Jorge solo ve el resumen.

#### Fase 11 — Escalado
**Quién:** Hokage + todos

Cuando el revenue mensual supera el 80% del objetivo definido en `business_budgets.monthly_limit_usd`, Hokage detecta la oportunidad y propone:
- Aumentar inventario / variantes
- Expandir a una segunda plataforma
- Contratar un agente especializado nuevo (ej. agente de Atención al Cliente dedicado)

Cada propuesta es una Decision de alto nivel que Jorge aprueba o descarta.

#### Fase 12 — Nuevo negocio
**Quién:** Hokage

Cuando el primer negocio está estable (revenue constante, rutinas activas), Hokage puede proponer iniciar un segundo negocio. La misma arquitectura de 12 fases se repite. Los agentes existentes amplían su contexto.

### Tabla de fases y departamentos

| Fase | Sala principal | Sala secundaria | Output |
|------|---------------|-----------------|--------|
| Idea | Hokage HQ | — | Registro en `businesses` |
| Investigación | Laboratorio | — | Reporte de mercado en `agent_memory` |
| Validación | Banco | — | Viabilidad financiera / Decision |
| Branding | Estudio | Hokage | Decision con propuesta de identidad |
| Diseño | Estudio | — | Assets + copys en `agent_tasks` |
| Automatización | Todos | — | Rutinas configuradas |
| Publicación | Tienda | — | Productos en plataforma, `status='active'` |
| Ventas | Tienda | Banco | Revenue en tiempo real |
| Atención cliente | Tienda | — | Respuestas aprobadas |
| Optimización | Laboratorio | Banco, Tienda | Ajustes de catálogo |
| Escalado | Hokage | Todos | Nuevas Decisions de expansión |
| Nuevo negocio | Hokage | — | Segundo ciclo completo |

---

## 16. Filosofía visual

### La ley fundamental

> **Hokage OS debe resultar interesante incluso cuando el usuario no hace absolutamente nada.**

Si Jorge abre Hokage OS, no toca el teclado, y a los 5 minutos el mundo se ve exactamente igual que cuando lo abrió — el sistema ha fallado. No en términos técnicos. En términos de visión.

### Las 10 reglas de diseño que no se rompen

#### Regla 1 — Todo dato importante existe físicamente en el mundo

No hay tooltips con datos escondidos. No hay tablas en modales. Si el revenue sube, se ve un número cambiando en el edificio del Banco. Si el Explorador detecta una tendencia, aparece una partícula moviéndose desde el Laboratorio hacia el Estudio. Los datos no se reportan. Se muestran.

#### Regla 2 — Si un agente trabaja, se ve

El token del agente en el mapa tiene un anillo pulsando. La sala donde está tiene las luces más brillantes. El spoke que conecta el edificio al hub tiene partículas moviéndose a mayor velocidad. Cuando el agente termina, el anillo se apaga. No hay estado de trabajo invisible.

#### Regla 3 — Cada sala muestra su trabajo, no métricas abstractas

| Sala | Lo que se ve haciendo |
|------|----------------------|
| Laboratorio | Gráfico de tendencias actualizándose, cursor que busca keywords |
| Estudio | Texto apareciendo carácter a carácter cuando el Diseñador genera contenido |
| Banco | Contador de revenue incrementando en tiempo real con cada venta |
| Tienda | Catálogo con miniatura de productos, pedidos apareciendo |
| Hokage HQ | Terminal con mensajes entre agentes, estado global del ecosistema |

#### Regla 4 — Las animaciones comunican información útil

No hay animaciones decorativas. Cada movimiento tiene significado:

- **Token moviéndose** → el agente cambia de estado (de espera a trabajo o viceversa)
- **Partículas en spokes rápidas** → el agente de esa sala está activo ahora mismo
- **Anillo doble ámbar** → el agente acaba de completar una acción (últimos 30 segundos)
- **LED rojo en crew rail** → hay una alerta que Jorge debe revisar
- **Edificio más brillante** → actividad reciente en esa sala

Si una animación no responde a un evento real, no existe.

#### Regla 5 — Sin dashboards tradicionales

No hay tablas con paginación. No hay listas de 50 items con scroll. Si hay muchos eventos, se muestran los últimos 8 en el Live Feed y el resto existe en el historial pero no se impone visualmente. La información se jerarquiza por relevancia, no por cronología.

#### Regla 6 — El mapa es el estado real del sistema

El mapa no es decorativo. En cualquier momento, mirando el mapa sin abrir ningún panel, Jorge puede saber:
- Qué agentes están trabajando (anillos pulsando)
- En qué salas hay actividad (spokes con partículas)
- Si hay alertas pendientes (LEDs rojos en crew rail)
- Qué tan activo está el ecosistema (densidad de partículas en el mapa)

#### Regla 7 — El usuario observa más de lo que controla

La interfaz está diseñada para que Jorge mire, no para que clique. Los controles existen (aprobar, rechazar, chatear), pero no son la experiencia principal. La experiencia principal es ver el mundo trabajar.

El ratio objetivo: **80% observación / 20% interacción**.

#### Regla 8 — Nada genérico. Todo específico de Hokage OS

No hay iconos de carpeta, campana o engranaje. Cada elemento visual refleja el mundo de Hokage OS:
- Los agentes son figuras en pixel art con nombre propio
- Los edificios tienen forma específica por departamento
- Los eventos tienen color según su origen (ember=acción, cyan=datos, verde=éxito, ámbar=alerta)

#### Regla 9 — El estado de error también es visible

Si el Explorador falla al conectar con Google Trends, el edificio del Laboratorio tiene un pulso rojo lento. No un modal de error. No una notificación de sistema operativo. El edificio communica el problema.

#### Regla 10 — El mapa crece con el negocio

Cuando se crea un nuevo negocio, aparece un nuevo edificio en el mapa. Cuando se añade un nuevo agente, aparece un nuevo token. El tamaño visual del ecosistema es proporcional al tamaño real del negocio. Un negocio pequeño tiene 5 salas. Una empresa grande tiene 20. El mapa refleja el éxito.

### El mundo vivo — implementación de vida ambient

Para que Hokage OS "esté vivo" sin que Jorge haga nada, existen eventos ambient que ocurren independientemente de las acciones de Jorge o de los ciclos de agentes:

#### Movimiento autónomo de tokens

Los agentes en espera deambulan alrededor del Hokage HQ con un timer de 4-8 segundos. El movimiento es aleatorio pero suave (WorldEngine con EASE=0.06). No teleportan. Caminan. Esto crea la sensación de que hay personas en el edificio aunque no estén trabajando.

```typescript
// MapView.tsx — timer de deambulación
const stagger = 2500 + ((agent.id * 733) % 4000)
setInterval(() => {
  // Si no está trabajando, mueve al azar entre hub y sala
  if (!isWorking(agent.id)) {
    setAtHub(prev => ({ ...prev, [agent.id]: Math.random() < 0.5 }))
  }
}, 4000 + stagger)
```

#### Pulsos de actividad en spokes

Los spokes que conectan edificios al hub tienen partículas animadas. Incluso en reposo hay 1-2 partículas lentas. Cuando hay actividad real, hay 3+ partículas rápidas. La densidad de partículas es la "frecuencia cardíaca" del ecosistema.

#### Eventos espontáneos de Ship Comms

El Tesorero, incluso sin acciones de Jorge, genera mensajes automáticos cada 15 minutos con el estado del revenue. El Explorador informa de las keywords que está monitorizando. Hokage resume el estado del equipo. Ship Comms nunca está vacío — siempre hay actividad.

#### Actualizaciones en tiempo real del Banco

El contador de revenue en el edificio del Banco se actualiza cada vez que llega un evento `sale.received`. Si hay un día de buenas ventas, el número crece visiblemente. Si hay sequía, se mantiene estático y el Tesorero alerta. El Banco es el termómetro visual del negocio.

#### Cambios de luz por hora del día (Fase futura)

Los edificios tienen una intensidad de luz base que varía ligeramente según la hora del día (más tenue de noche, más brillante durante horas de actividad peak). Esto da al mundo una sensación de tiempo real, no de estática artificial.

#### Eventos especiales visibles en el mapa (Fase futura)

Cuando se publica un nuevo producto → aparece una animación de "lanzamiento" en el edificio de la Tienda.
Cuando llega la primera venta de un negocio nuevo → evento global, todos los edificios pulsan brevemente.
Cuando un agente está bloqueado → el edificio tiene un indicador visual (luz amarilla parpadeante).

### La prueba definitiva

Antes de hacer merge de cualquier cambio visual, hacer esta prueba:

1. Abrir Hokage OS
2. No tocar nada durante 5 minutos
3. ¿Ha cambiado algo en el mapa? ¿Hay nuevos mensajes? ¿Se movió algún agente?

Si la respuesta es no — hay algo que añadir o corregir. El mundo no puede estar estático.

---

*HOKAGE OS · Architecture v2.0 · Agosto 2026*  
*Actualizado tras investigación arquitectónica: RimWorld · Software Inc. · Prison Architect · Factorio*
