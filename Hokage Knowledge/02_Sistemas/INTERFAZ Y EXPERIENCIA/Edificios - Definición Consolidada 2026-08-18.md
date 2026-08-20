# Edificios — Definición Consolidada (2026-08-18)

> Estado: 🔒 **CONGELADO — v1 (2026-08-18)** · 🟢 **actualizado v2 (2026-08-18) tras Fases 7/8/9**
> Fuente de verdad para: definición funcional de los 6 edificios de Hokage OS, mecanismo de paneles, estado de construcción de cada panel, y restricciones de qué no implementar todavía.
> Fundado en: [[Frontend - Decisiones v2]] §13 v3 + Auditoría de Edificios 2026-08-18 + aprobación explícita de Jorge (decisiones P1–P4).
> **Autoridad:** este documento gana sobre [[UI MASTER]] cuando existe conflicto entre UX abstracta y decisiones concretas aquí congeladas. Para implementación técnica ver [[Frontend World Engine]] y UI Implementation Plan (raíz del repo).

---

## Estado real tras Fases 7/8/9 (2026-08-18)

> Las tablas por edificio (§1) describen el **diseño objetivo congelado**. Este bloque registra qué está **realmente implementado** en código tras los commits `57e5bf7` (Fase 7), `00829e4` (Fase 8) y `4064550` (Fase 9). Donde difieran, este bloque manda sobre los marcadores 🔜 de §1.

| Punto | Estado real | Delta vs. diseño |
|---|---|---|
| **Hermes → `type='system'`** | ✅ Implementado (Fase 7: columna `departments.type`; Fase 8: sala tipada) | Detección por `building.type === 'system'`, sin `if (role === 'hermes')`. Fila de Hermes en `agents` permanece (retirada física fuera de alcance). |
| **Hermes → Sistema/Terminal/Stats/Alertas** | ✅ Implementado (Fase 8, `SystemStatusPanel.tsx`) | Set curado exacto. Sin Chat (C2). Datos reales de `/api/runtime/status` + `/api/metrics/summary`. |
| **Banco → panel Finanzas** | ✅ Implementado (Fase 9, `BankPanel.tsx`) | **"Agentes más costosos" NO construido** (sin endpoint de agregación; requeriría N llamadas o backend nuevo). Resto real: coste IA hoy, gasto/presupuesto por venture, ventures activas. |
| **Laboratorio → Tendencias** | ✅ Implementado (Fase 9, `OutputsPanel variant='market'`) | **SOLO LECTURA.** Aprobar/Rechazar, resolver `market_finding` y columna `market.status` **NO construidos** (diferidos por decisión). |
| **Marketing → Contenido** | ✅ Implementado (Fase 9, `OutputsPanel variant='content'`) | Galería base. **Feedback (Me gusta/No me gusta/Aprobar) y Calendario NO construidos** (dependen de C.4). |
| **Tienda → bloqueada** | ✅ Sin cambios | Sigue con set genérico, sin datos de canal. Regla C8 intacta. |
| **Taller → sin panel especializado** | ✅ Sin cambios | Set genérico (P3). |
| **Chat de negocio → Debug (P4)** | 🟡 **Parcial** | Ya **no es el tab por defecto** y queda **en última posición** en salas curadas (Banco/Lab/Marketing). **Falta** el etiquetado/diferenciación visual "Debug" (§3) — pendiente, no bloqueante. |

**Mecanismo de montaje (A1, Fase 9):** las secciones de cada sala se resuelven por dato (ver §4) vía `frontend/src/registries/buildingSectionRegistry.ts` (lookup por `type`/rol), sin ramas `if (building.id)`. El `PanelRegistry` de layout (regiones) queda intacto. El antiguo condicional `isHermes` fue **eliminado**.

**Siguiente en el roadmap:** Fase 10 — Panel universal de agente (ver §7). No abierta.

---

## 0. Decisiones aprobadas (2026-08-18) — v4 de la capa de frontend

Estas cuatro decisiones completan y congelan lo que §13 v3 (2026-08-05) dejaba abierto:

| # | Decisión | Efecto |
|---|---|---|
| P1 | **"Marketing"** es el nombre visible del edificio `id: estudio`. El `id` interno no cambia para evitar migración de datos. | Unifica los tres nombres que convivían en documentación: "Estudio", "Marketing", "Sala de Diseños". |
| P2 | **Sala de Reuniones = overlay/vista de navegación**, no edificio del mapa. | Mismo patrón que `CommsView`/`AlertsView`. Sin tabla `Meeting` nueva. Sin nodo nuevo en el mapa por ahora. |
| P3 | **Taller sin panel especializado** hasta que el agente de operaciones produzca outputs concretos y únicos que lo justifiquen. Mantiene pestañas genéricas. | Evita construir UI sin datos reales detrás — misma regla que Tienda. |
| P4 | **Chat de agentes de negocio = modo Debug temporal**, visualmente separado del flujo principal. Retirada definitiva coordinada con C.5 (orquestador). | Respeta C1 (solo Hokage con chat pleno) sin dejar a Jorge sin lever de control durante la transición pre-C.5. |

### Decisiones cerradas previas que aplican

| # | Decisión | Fuente |
|---|---|---|
| C1 | Jorge conversa directamente **solo con Hokage**. Los agentes de negocio no tienen chat como flujo principal. | Especificación Funcional §3 + UI Plan §0 |
| C2 | Hermes es el **runtime/kernel**, no un agente conversacional. Su sala no ofrece chat. | Master Spec §3 |
| C3 | Los departamentos son estables. Un venture nuevo **nunca crea un edificio nuevo**. | ADR-006 |
| C4 | Etsy / Shopify / Printify son **canales dentro de Tienda**, no edificios del mapa. | Frontend Decisiones v2 §13 v3 |
| C5 | La Sala de Reuniones no requiere tabla `Meeting` nueva. Visualiza datos ya existentes. | UI Plan §0 Conflicto C |
| C6 | El rol `soporte` no tiene sala propia hasta que existan usuarios externos reales. | Frontend Decisiones v2 §13 v3 |
| C7 | Chat directo a agentes = modo debug excepcional, nunca flujo por defecto. (Formalizado en P4.) | UI Plan Fase 10 |
| C8 | Tienda no muestra datos falsos mientras no exista integración real. | Frontend Decisiones v2 §13 v3 |
| C9 | Especialización de salas 100% data-driven mediante registros (layout + secciones, ver §4). Ninguna rama `if (building.id)` en `GameLayout.tsx`/`BuildingView.tsx`. | UI Plan Fase 4 · A1 Fase 9 |

---

## 1. Los 6 edificios — definición canónica

### Regla transversal (🔒 invariante — ADR-006)

> Un venture nuevo nunca crea un edificio nuevo. Los departamentos son estables y reutilizables.

---

### 1.1 Torre Hokage · `id: hokage` · rojo `#e8432d` · rol `ceo`

**Función:** centro de mando y única conversación directa de Jorge con el sistema. Es el único edificio con chat pleno habilitado.

**Al hacer clic:** panel sobre el mapa (el mapa permanece visible detrás).

| Tab | Contenido | Estado | Datos |
|---|---|---|---|
| **Chat** | Conversación directa con Hokage: órdenes, auditorías, preguntas, intervención | ✅ Básico hoy | `askAgent(ceo)` |
| **Sistema** | Estado global en vivo: agentes activos, coste del día, decisiones pendientes, errores | 🔜 Construible ya | `/api/runtime/status` · `/api/metrics/summary` |
| **Preguntas rápidas** | Acciones predefinidas ejecutables (¿qué está bloqueado?, auditar agentes...) | 🔜 Requiere C.5 | Orquestador |
| Live Feed | Eventos del bus relacionados con el orquestador | ✅ Existe | WS |
| Alertas | Decisiones pendientes de aprobación | ✅ Existe | `decisions` |
| Config | Configurar agente CEO | ✅ Existe | `AgentConfigPanel` |

**Nota:** el chat básico funciona hoy vía `askAgent(ceo)`. El valor real (descomposición de órdenes, reparto a agentes, seguimiento de plan) llega con C.5.

---

### 1.2 Laboratorio · `id: lab` · cyan `#4fd1c5` · rol `investigador`

**Función:** investigación de mercado y detección de tendencias. Sus outputs alimentan el pipeline completo (tendencia → contenido → publicación).

| Tab | Contenido | Estado | Datos |
|---|---|---|---|
| **Tendencias** | Timeline de hallazgos de `market`, **solo lectura** | ✅ Implementado (Fase 9) — Aprobar/Rechazar diferido, ver estado real arriba | `market` |
| Live Feed | Eventos del agente investigador | ✅ Existe | WS |
| Stats | Métricas del agente | ✅ Existe | `agent_runs` · `agent_costs` |
| Pipeline | Work items del agente | ✅ Existe | `work_items` |
| Alertas | Decisiones pendientes | ✅ Existe | `decisions` |
| Config | Configurar rol/modelo/prompt | ✅ Existe | `AgentConfigPanel` |
| ~~Chat~~ | *Debug temporal (P4)* | Ver §3 | — |

**Timeline de Tendencias:** funcional desde el primer arranque del proceso. Más fiable tras `event_log` (Fase 2 del plan de implementación), pero no bloqueante — sin él, la timeline cubre desde el último arranque.

---

### 1.3 Marketing · `id: estudio` · púrpura `#c77dff` · rol `contenido`

**Función:** creación de contenido y gestión de campañas. El `id` interno es `estudio`; el **nombre visible es "Marketing"** (decisión P1). El concepto "Sala de Diseños" (de UI MASTER §12) queda subsumido dentro de este panel especializado.

| Tab | Contenido | Estado | Datos |
|---|---|---|---|
| **Contenido** | Galería de piezas generadas (`content`) | ✅ Implementado (Fase 9, base) — feedback diferido a C.4 | `content` vía `/api/agents/:id/outputs` |
| **Calendario** | Calendario de publicación y campañas | ⛔ Bloqueado — requiere C.4 (no construido) | Knowledge System |
| Live Feed | Eventos del agente | ✅ Existe | WS |
| Stats | Métricas | ✅ Existe | `agent_runs` |
| Pipeline | Work items | ✅ Existe | `work_items` |
| Alertas | Decisiones pendientes | ✅ Existe | `decisions` |
| Config | Configurar agente | ✅ Existe | `AgentConfigPanel` |
| ~~Chat~~ | *Debug temporal (P4)* | Ver §3 | — |

**Referencias y aprendizaje** (§12.2/§12.5 de UI MASTER — feedback → memoria del agente): dependen de C.4 Knowledge System. No se simulan mientras no existan.

---

### 1.4 Tienda · `id: tienda` · naranja `#f0a93b` · rol `trafico`

**Función:** operación comercial en canales externos. Etsy, Shopify y futuros son subvistas dentro de esta sala (patrón: lista de canales → detalle por canal), no edificios del mapa.

**Estado: 🔴 BLOQUEADO** para cualquier dato de canal hasta que exista integración real. No se construye con datos falsos — regla C8.

| Tab | Contenido | Estado | Datos |
|---|---|---|---|
| *(Canales)* | *Selector de canal + resumen: ventas, pedidos, salud, catálogo, anuncios* | 🔴 BLOQUEADO hasta F.2 | OAuth2 + API del canal |
| Stats | Métricas del agente de tráfico | ✅ Disponible | `agent_runs` · `agent_costs` |
| Pipeline | Work items | ✅ Disponible | `work_items` |
| Alertas | Decisiones pendientes | ✅ Disponible | `decisions` |
| Config | Configurar agente | ✅ Disponible | `AgentConfigPanel` |
| ~~Chat~~ | *Debug temporal (P4)* | Ver §3 | — |

**Cadena de desbloqueo:** C.6 (Secret Management) → F.1 (Plugin Loader) → F.2 (Etsy Business Module).

---

### 1.5 Banco · `id: banco` · verde `#3ecf6a` · rol `finanzas`

**Función:** salud financiera interna — coste de IA, presupuestos por venture, flujo económico. No replica datos de plataformas externas (eso es Tienda).

| Tab | Contenido | Estado | Datos |
|---|---|---|---|
| **Finanzas** | Coste IA hoy, presupuesto asignado/gastado/disponible por venture, ventures activas | ✅ Implementado (Fase 9, `BankPanel`) — "agentes más costosos" NO construido | `agent_costs` · `ventures` · `/api/ventures/:id/budget` |
| Stats | Métricas del agente finanzas | ✅ Existe | `agent_runs` |
| Alertas | Decisiones categoría FINANCIAL | ✅ Existe | `decisions` |
| Config | Configurar agente | ✅ Existe | `AgentConfigPanel` |
| ~~Chat~~ | *Debug temporal (P4)* | Ver §3 | — |

**Nota:** ingresos de ventas reales (Etsy/Shopify) siguen bloqueados por Tienda. El panel de Finanzas se limita a coste/presupuesto interno — real, consultable y de alto valor ahora mismo.

---

### 1.6 Taller · `id: taller` · azul `#4f8cff` · rol `operaciones`

**Función:** operaciones técnicas del ecosistema. Sin panel especializado hasta que el agente produzca outputs concretos y únicos que lo justifiquen (decisión P3).

| Tab | Estado |
|---|---|
| Stats | ✅ Disponible |
| Pipeline | ✅ Disponible |
| Alertas | ✅ Disponible |
| Config | ✅ Disponible |
| ~~Chat~~ | *Debug temporal (P4)* |

**Revisitar cuando:** el Memory System (C.1) esté implementado y el agente de operaciones genere reportes de salud con estructura propia que justifiquen un panel dedicado.

---

### Sala de Máquinas / Hermes · *(edificio en BD, `type='system'` ✅ Fase 7)*

**Función:** ventana al runtime de Hokage OS. Hermes es el kernel — no es agente de negocio ni agente conversacional.

| Tab | Contenido | Estado | Datos |
|---|---|---|---|
| **Sistema** | Estado del runtime: agentes activos, eventos en cola, coste IA hoy, mensajes/decisiones | ✅ Implementado (Fase 8, `SystemStatusPanel`) | `/api/runtime/status` · `/api/metrics/summary` |
| **Terminal** | Historial de exec_runs: stdout/stderr, exit codes | ✅ Existe (`TerminalPanel`) | `exec_runs` |
| Stats | Métricas operativas | ✅ Existe | `agent_runs` |
| Alertas | Decisiones de sistema | ✅ Existe | `decisions` |
| ~~Chat~~ | **Retirado definitivamente** (decisión C2) | ✅ Fase 8 | — |

**Dependencia (satisfecha):** `departments.type = 'system'` identifica la sala declarativamente vía `building.type === 'system'`, sin `if (role === 'hermes')` (Fase 7). La fila de Hermes en `agents` permanece durante la transición — su retirada física es posterior (B.1, fuera de alcance).

---

## 2. Sala de Reuniones (decisión P2)

**No es un edificio del mapa.** Es una vista/overlay de navegación, con el mismo patrón que `CommsView` o `AlertsView`. No requiere tabla `Meeting` ni nodo nuevo en el World Engine.

**Contenido:** visualización de actividad colaborativa real — `messages` (canal `internal`/`general`) + `work_items` + `decisions` recientes entre agentes, en una ventana de tiempo. No expone razonamiento interno de los modelos (hoy ninguna tabla persiste ese razonamiento crudo).

**Dependencia:** endpoint de agregación `GET /api/rooms/reuniones/activity` (menor — une tablas ya existentes).

**Si en el futuro se añade como nodo en el mapa:** solo cuando tenga representación de datos propios que representar en el World Engine, no antes. El ECS ya puede acomodarlo sin cambios de arquitectura.

---

## 3. Chat de agentes — modo Debug temporal (decisión P4)

| Caso | Comportamiento |
|---|---|
| **Torre Hokage** | Chat pleno. Es el flujo principal y esperado. Sin restricción visual. |
| **Resto de salas de negocio** | Tab existe pero etiquetado como "Debug" o "Chat (dev)". Diferenciado visualmente del resto de tabs. No es el tab por defecto al abrir una sala. |
| **Sala de Máquinas (Hermes)** | Sin tab Chat en absoluto. Decisión C2, no P4. |

**Diferenciación visual mínima del Debug:** etiqueta distinta ("Debug"), posición no prominente (último tab o separado del grupo principal), indicador visual de modo no recomendado.

**Estado real (tras Fase 9):** en las salas curadas (Banco/Lab/Marketing) el Chat ya está **en última posición y no es el tab por defecto** (✅ parte de P4). **Falta** el etiquetado/indicador visual "Debug" (pendiente, no bloqueante). En salas genéricas (Tienda/Taller/Torre Hokage) el Chat sigue en el set base sin diferenciar.

**Retirada definitiva:** cuando C.5 (orquestador de Hokage) esté implementado y Jorge tenga un canal de intervención real sobre agentes concretos sin necesitar chat directo. La retirada no bloquea ninguna fase anterior.

---

## 4. Mecanismo de paneles — dos registros (C9)

El sistema usa **dos registros data-driven**, ninguno con ramas `if (building.id)`:

1. **`PanelRegistry` de layout** (`frontend/src/registries/PanelRegistry.ts`) — regiones de la pantalla (left-rail, `building-panel`, system-log, overlays). Monta la sala como una entrada `'building-panel'`. Intacto desde Fase 4.
2. **`buildingSectionRegistry`** (`frontend/src/registries/buildingSectionRegistry.ts`, Fase 9 / mecanismo A1) — **qué pestañas declara cada sala**, resuelto por lookup de `type`/rol (`system` > rol curado > base). `BuildingView` lee `sectionsForBuilding(building)`; `GameLayout` abre en `defaultSectionFor(building)` (primer tab).

**El antiguo condicional `isHermes` en `BuildingView.tsx` fue eliminado** (Fase 8→9): la distinción es ahora `building.type === 'system'` y el resto por rol, todo vía el registro de secciones.

**Cómo añadir el panel de una sala:**
1. Crear el componente (`BankPanel.tsx`, etc.).
2. Declarar sus pestañas en `buildingSectionRegistry` (entrada por rol/tipo) — sin `if (building.id)`.
3. Añadir su caso de render en el switch por sección de `BuildingView` (p. ej. `section === 'finance'`). El render es por sección, no por edificio.

**Evolución a Fase 16:** el mapa estático por rol de `buildingSectionRegistry` se sustituye por configuración servida desde `departments.type` (backend), sin rehacer `BuildingView` — el consumidor solo llama a `sectionsForBuilding()`.

---

## 5. Tabla de referencia rápida — estado de construcción

| Edificio | Panel especializado | Datos disponibles hoy | Estado |
|---|---|---|---|
| Torre Hokage | Sistema + Preguntas rápidas | Parcial (chat hoy; C.5 pendiente para lo real) | 🔜 Construible parcialmente (no en Fase 9) |
| Laboratorio | Tendencias (timeline, **solo lectura**) | ✅ `market` | ✅ **Implementado (Fase 9)** |
| Marketing | Contenido (galería; feedback → C.4) | ✅ `content` | ✅ **Implementado (Fase 9)** |
| Banco | Finanzas (coste/presupuesto/ventures) | ✅ `agent_costs`, `ventures`, budget | ✅ **Implementado (Fase 9)** |
| Tienda | Canales reales | ❌ stubs sin implementar | 🔴 BLOQUEADO (F.2) |
| Taller | Ninguno por ahora (P3) | Genéricos disponibles | Sin panel especializado |
| Hermes (Sala de Máquinas) | Sistema + Terminal | ✅ `/api/runtime/status` | ✅ **Implementado (Fase 8)** |
| Sala de Reuniones | Actividad colaborativa | ✅ `messages`+`work_items`+`decisions` | 🔜 Construible (sin edificio en mapa — P2) |

---

## 6. Qué NO implementar todavía

- **Sala de Reuniones como edificio** del mapa — decisión P2.
- **Panel especializado del Taller** — decisión P3; sin datos únicos que lo justifiquen aún.
- **Datos de Tienda simulados o placeholder** — regla C8; solo cuando exista integración real F.2.
- **Calendario/Campañas de Marketing** — requiere C.4 Knowledge System.
- **Referencias y aprendizaje de agentes** (§12.2/§12.5 UI MASTER) — requiere C.4.
- **Preguntas rápidas ejecutables de Torre Hokage** — sin orquestador C.5.
- **Retirar Chat definitivamente de agentes de negocio** — sin C.5; hasta entonces permanece como Debug.
- **Registry completo de tipos de departamento** — solo el slice mínimo `'business'/'system'` en Fase 7; el registry completo es trabajo posterior (Fase D.4).

---

## 7. Orden de implementación

Basado en dependencias y relación valor/riesgo:

**Sin dependencias — construible ahora:**
1. ✅ `BankPanel.tsx` — Banco, panel de Finanzas. **Hecho (Fase 9).**
2. ✅ Panel de Tendencias — Laboratorio, timeline. **Hecho (Fase 9, solo lectura).** El flujo Aprobar/Rechazar + `entity_type='market_finding'` queda **diferido** (no construido).
3. 🔜 Pestaña Sistema — Torre Hokage (reutiliza dos endpoints ya existentes). **Pendiente** (no entró en Fase 9).
4. ✅ Panel base de Contenido — Marketing, galería de `content`. **Hecho (Fase 9).**

**Requiere Fase 7 (`departments.type`):**
5. ✅ Panel de Sistema + retirar Chat — Sala de Máquinas (Hermes). **Hecho (Fase 8).**

**Requiere PanelRegistry poblado (Fase 4/5 del plan):**
6. Panel universal de agente (operativo, Chat como Debug).
7. Overlay de Sala de Reuniones.

**Requiere C.5 orquestador:**
8. Preguntas rápidas ejecutables de Torre Hokage.
9. Retirada definitiva de Chat en agentes de negocio.

**Bloqueado sin fecha:**
10. Canales reales de Tienda — requiere C.6 → F.1 → F.2.
11. Calendario/Campañas de Marketing — requiere C.4.

---

## Notas relacionadas

- [[Frontend - Decisiones v2]] — v3 (2026-08-05) + v4 block (2026-08-18), capa que este documento extiende
- [[Frontend World Engine]] — spec técnica v1.0 del mapa y ECS
- [[UI MASTER]] — fuente de UX abstracta; donde conflicte con este documento, **este documento gana**
- [[HOKAGE_OS_MASTER_SPEC]] — ápice del sistema (§18–§19 sobre proyección visual)
- [[ADR-006 - Multi-Venture]] — invariante de departamentos estables
- [[Master Roadmap - v1]] — secuenciación: Fase 7 (departments.type), Fase 8 (Hermes), Fase 9 (Banco/Lab/Marketing), Fase 10 (Panel agente)
- [[Economía v2 - Sistema Financiero]] — modelo que respalda el panel de Banco
