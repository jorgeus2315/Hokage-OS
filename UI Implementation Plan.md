# UI Implementation Plan — Hokage OS

> Convierte `UI Vision Master.md` en plan técnico ejecutable, contrastado contra código real. No implementa nada. No modifica código.
> Generado: 2026-08-09. Actualizado 2026-08-09 — incorpora la decisión de producto sobre Hokage/Hermes/agentes/Sala de Reuniones (ver §0).

---

## 0. Fuentes de verdad usadas — y un conflicto real que este plan no resuelve en silencio

Se han usado, en este orden de autoridad (confirmado en `.claude/napkin.md` y en los propios documentos):

1. **`Especificación Funcional de Producto - v1`** (vault, `01_Arquitectura`, 2026-08-06) — "donde este documento contradice algo ya congelado en los otros dos, este documento gana". Es el más reciente y el más deliberado.
2. **`HOKAGE_CORE_SPECIFICATION_v1.md`** (raíz, §9/§12.3/§13/§16) — arquitectura técnica sistema por sistema, con secciones 🔒 congeladas.
3. **`Master Roadmap - v1`** (vault, `09_Roadmap`, 2026-08-06) — plan de construcción vigente. **Sustituye a `Roadmap.md`** (raíz) como fuente de secuenciación real — `Roadmap.md` quedó como snapshot histórico del 2026-08-02.
4. **`UI Vision Master.md`** (vault, `02_Sistemas/INTERFAZ Y EXPERIENCIA`) — fuente de verdad de *experiencia/UX*, no de arquitectura. Su propio §41-42 lo dice explícitamente: si hay conflicto entre estética y arquitectura, la arquitectura no se rompe para conseguir una maqueta visual.
5. Código real (`backend/src/`, `frontend/src/`) — verificado línea por línea para cada afirmación de este documento. Nada de "existe" o "falta" en este plan es una suposición.

### La decisión de producto (resuelta 2026-08-09)

El conflicto identificado en la versión anterior de este documento — `UI Vision Master.md` (§17, §13, §7) describiendo un Panel universal de Agente con chat directo y una Sala de Reuniones "hablada", frente a la `Especificación Funcional de Producto v1` negándolo para agentes de negocio — **está resuelto por decisión explícita de Jorge**:

1. Hokage es la única IA con la que Jorge conversa directamente.
2. Hermes es el kernel/runtime de Hokage OS y no debe presentarse como un agente conversacional independiente.
3. Los agentes especializados siguen existiendo y pueden trabajar, colaborar y comunicarse entre ellos.
4. La comunicación entre agentes puede visualizarse en la Sala de Reuniones como actividad operativa, mensajes y decisiones, pero no debe exponer razonamiento interno privado de los modelos.
5. El Panel universal de Agente se mantiene, pero es un panel operativo/configurativo, no un chatbot independiente.
6. Si Jorge quiere intervenir sobre un agente, la interacción debe poder pasar por Hokage como orquestador.
7. Los agentes deben poder tener estados, tareas, progreso, resultados, herramientas, conexiones, memoria relevante y configuración propios.
8. La Sala de Reuniones debe representar visualmente la colaboración real entre agentes.
9. No se crea un sistema de conversación independiente para cada agente.
10. Esta decisión respeta la arquitectura actual — no crea una arquitectura paralela.

Esta decisión **confirma y prioriza** la dirección que el `Master Roadmap - v1` ya tenía fijada para Hermes (B.1/B.2/B.3) y la extiende explícitamente al resto de agentes de negocio, algo que ningún documento había zanjado hasta ahora. Las secciones 3 y 7 de este plan quedan actualizadas más abajo en consecuencia.

### Conflictos con la arquitectura actual — y solución propuesta

**Conflicto A — `ChatPanel` permite hoy chat directo con cualquier agente, incluido Hermes.**
`GameLayout.tsx::sendChat()` llama `api.ask(agent.id, msg)` → `askAgent()` para el agente asignado a la sala abierta, sin distinción de rol. Esto es exactamente el "sistema de conversación independiente por agente" que la decisión #9 prohíbe, y viola #1/#2 para Hermes en particular.
**Solución propuesta (sin arquitectura paralela — decisión #10):** `askAgent()` **no se retira ni se duplica** — sigue siendo el mecanismo real que `agentRuntime.ts` ya usa para ejecutar cualquier tarea de agente (`autonomous_run`, `decision_execution`, etc.), y es exactamente lo que el Orquestador de Hokage (C.5) invocaría internamente al despachar trabajo. Lo que cambia es solo la **superficie de UI**: la pestaña "Chat" de `BuildingView` deja de estar disponible para agentes de negocio y para Hermes; se sustituye por el panel operativo/configurativo de la decisión #5/#7 (ver sección 3 actualizada). Cualquier instrucción de Jorge hacia un agente concreto se escribe en el canal de Hokage (C.5), que la despacha por el mismo camino de `work_items`/`askAgent()` que ya existe — un único motor de ejecución, dos puntos de entrada (autónomo y por orden de Jorge), nunca dos motores.

**Conflicto B — Hermes vive hoy en la tabla `agents` con un `system_prompt` de personalidad y aparece en toda vista que liste "agentes".**
`db/init.ts::seedHermesAgent()` lo siembra con rol `hermes` y un prompt en primera persona ("Eres Hermes..."); `BuildingView.tsx` le añade una pestaña `TERMINAL_TAB` pero conserva la de chat.
**Solución propuesta:** ya especificada como B.1/B.2/B.3 en el `Master Roadmap - v1` — sacar a Hermes de `agents`, retirar su pestaña de chat, dejar su sala como "Panel de Sistema" (monitorización real vía `system.status`, no conversación). Esta decisión de Jorge no añade trabajo nuevo aquí: **confirma como definitiva** una dirección que ya estaba diseñada pero no priorizada.

**Conflicto C — no existe modelo de datos para "reunión" (falso conflicto, se resuelve por simplificación, no por construcción nueva).**
La versión anterior de este plan asumía que la Sala de Reuniones necesitaría una tabla `Meeting` nueva. La decisión #4/#8 ("actividad operativa, mensajes y decisiones... sin exponer razonamiento interno") aclara que **no hace falta inventar una entidad nueva**: `messages` (ya poblada por el pipeline de `automations` — p. ej. "Tendencia → Escritor"), `work_items` y `decisions` ya son, juntas, exactamente "actividad operativa, mensajes y decisiones" entre agentes. La Sala de Reuniones puede construirse como una visualización especializada sobre datos que ya existen, filtrando explícitamente cualquier campo que contenga razonamiento crudo del modelo (hoy no se persiste tal cosa en ninguna tabla, así que el filtro es principalmente una garantía de diseño, no una limpieza de datos existente). Esto **reduce** el alcance de backend necesario respecto a la versión anterior de este plan — ver sección 7 actualizada.

**Conflicto D (gap, no conflicto) — la decisión #7 pide exponer herramientas/conexiones/memoria por agente; hoy no hay API para ello.**
`AGENT_TOOLS` (`agentModels.ts`) está hardcodeado en código, sin endpoint que lo exponga; `agent_memory` no tiene ninguna ruta `GET` en `server.ts`. No es un conflicto de arquitectura — es superficie de lectura que falta añadir (aditivo, ver sección 3).

### Regla de secuenciación heredada

El `Master Roadmap - v1` fija una regla que este plan respeta: *"cualquier funcionalidad nueva debe encajar en una de las fases/entregas de ese documento antes de implementarse. Si no encaja, se añade ahí primero — nunca se construye al margen."* Varias secciones de `UI Vision Master.md` (Sonido, Sala de Reuniones, flujo completo de alta de agentes) **no tienen entrega asignada en el Master Roadmap** — se marcan como **NO PROGRAMADO** en este plan, no como "listo para construir".

---

## 1. Cómo leer las tablas

- **REUTILIZAR** — ya existe y funciona, se usa tal cual.
- **EXISTE PARCIALMENTE** — hay una base real pero incompleta o con forma distinta a la pedida.
- **BACKEND NECESARIO** — no hay ninguna capacidad real detrás; hay que construirla.
- **FRONTEND** — puramente visual, sin dependencia de backend nuevo.
- **NO PROGRAMADO** — no tiene entrega en el Master Roadmap vigente; se debe añadir ahí antes de construirse (regla del propio roadmap).
- **BLOQUEADO** — depende de una integración externa o decisión de producto que no existe todavía; no se debe simular con datos falsos (regla explícita de `HOKAGE_CORE_SPECIFICATION_v1.md §13`).

---

## 2. Las 17 secciones

### 1. Shell / layout principal

| Campo | Detalle |
|---|---|
| Qué ya existe | `GameLayout.tsx` — compositor de posiciones CSS fijas: HUD, rail de agentes, log de sistema, panel de sala, overlays de pantalla completa. Funciona hoy. |
| Componente/sistema que lo soporta | `GameLayout.tsx`, `GameHUD.tsx`, `useAppData.ts`, `useWorldState.ts`. |
| Qué falta | El motor de paneles como dato (Registry) y su persistencia en backend — hoy la disposición está hardcodeada en JSX, no es configuración. Es "el hallazgo más repetido de toda la auditoría" (Master Roadmap, D.2). |
| Frontend | Sí — reescritura estructural de `GameLayout.tsx`. |
| Backend | Sí — tabla `user_layout` nueva (no existe). |
| Base de datos | Nueva tabla `user_layout`. |
| API | Nueva — `GET/PUT /api/layout`. |
| Realtime | No directamente. |
| Tipos/contratos nuevos | `PanelRegistry` (frontend), tipo de panel instanciable. |
| Assets | No. |
| Sonido | No. |
| Dependencias | A.3 (consolidar diseño), A.4 (ya ✅ completado según Master Roadmap). |
| Riesgos | Medio — mayor cambio estructural del frontend fuera de `world/`. Tocar `GameLayout.tsx` sin plan puede romper el patrón "el mapa nunca se desmonta" que hoy funciona bien. |
| Estado | **EXISTE PARCIALMENTE.** Corresponde a **D.2** del Master Roadmap (v1.0, 5-6 días). |

---

### 2. Sistema de paneles contextuales sobre el mapa

| Campo | Detalle |
|---|---|
| Qué ya existe | El patrón ya funciona de verdad: `BuildingView` se abre sobre el mapa sin desmontar `WorldCanvas`; overlays de pantalla completa (Objetivos/Ventures/Comms/Alertas/Crew/Config) siguen el mismo principio. Cumple ya §2.1 y §10 de `UI Vision Master.md`. |
| Componente/sistema que lo soporta | `GameLayout.tsx` (`showBuildingPanel`/`showOverlay`), `BuildingView.tsx`. |
| Qué falta | Que cada panel sea una *instancia de Registry* en vez de una rama `if` en `GameLayout.tsx` — mismo trabajo que la sección 1 (es la misma pieza, D.2). |
| Frontend | Sí. |
| Backend | Compartido con D.2. |
| Base de datos | Compartida con D.2. |
| API | Compartida con D.2. |
| Realtime | No nuevo. |
| Tipos/contratos nuevos | Compartidos con D.2. |
| Assets | No. |
| Sonido | Apertura/cierre de panel (§23 UI Vision Master) — no programado, ver sección 15. |
| Dependencias | D.2. |
| Riesgos | Bajo — el patrón visual ya es correcto, es una refactorización de mecanismo, no de comportamiento visible. |
| Estado | **REUTILIZAR** el patrón · **EXISTE PARCIALMENTE** el mecanismo interno. Es la misma entrega D.2. |

---

### 3. Panel universal de agente

| Campo | Detalle |
|---|---|
| Qué ya existe | `BuildingView.tsx` muestra identidad/actividad/modelo/config del agente asignado a una sala — pero solo dentro de esa sala, no como panel invocable desde cualquier sitio con el mismo componente (lo que pide `UI Vision Master §17`). Incluye hoy una pestaña de chat directo, que la decisión de producto retira (ver §0, Conflicto A). |
| Componente/sistema que lo soporta | `BuildingView.tsx`, `AgentConfigPanel.tsx`, `StatsPanel.tsx`, `/api/agents/:id/stats`, `/api/agents/:id/outputs`, `/api/agents/:id/work-items`. |
| Qué falta | **Confirmado por decisión #5/#7 — es un panel operativo/configurativo, no un chatbot:** (a) retirar la pestaña de chat directo para agentes de negocio y Hermes; (b) exponer **herramientas** asignadas por rol (`AGENT_TOOLS` en `agentModels.ts` hoy solo vive en código, sin endpoint — falta `GET /api/agents/:id/tools`); (c) exponer **memoria relevante** (`agent_memory` no tiene ninguna ruta `GET` hoy — falta `GET /api/agents/:id/memory`); (d) **conexiones** — no existe ningún concepto de conexión/integración por agente todavía, depende de Secret Management (C.6)/Plugin System (F.1); (e) sistema de autonomía real que mostrar (§17.6 — **no existe todavía**, ver C.2 del Master Roadmap). Estados/tareas/progreso/resultados/config (resto de la decisión #7) ya tienen datos reales detrás (`work_items`, `agent_runs`, `content`/`market`, `AgentConfigPanel`). |
| Frontend | Sí — extraer el panel de agente de `BuildingView` a un componente independiente invocable desde mapa/rail/sala; retirar la superficie de chat. |
| Backend | Parcial — identidad/stats/tareas/resultados ya existen; faltan los endpoints de lectura de herramientas y memoria (aditivos, bajo riesgo); autonomía y conexiones no existen. |
| Base de datos | Nueva tabla de configuración de autonomía por tipo de acción (C.2); ninguna nueva para herramientas/memoria (ya existen, solo falta exponerlas). |
| API | `GET /api/agents/:id/tools`, `GET /api/agents/:id/memory` (nuevas, menores) — autonomía nueva (C.2) — conexiones nueva (C.6/F.1). |
| Realtime | Ya cubierto por WS existente. |
| Tipos/contratos nuevos | `AutonomyLevel` (0-3), ya definido conceptualmente en `Especificación Funcional §3` — no implementado. |
| Assets | Avatar de agente — hoy es solo la inicial del nombre sobre un círculo de color (`AgentAvatar.tsx`); "avatar/personaje" real (§17.1) no existe. |
| Sonido | No. |
| Dependencias | C.2 (niveles de autonomía); C.6/F.1 (conexiones, no bloqueante para el resto del panel). Intervención sobre un agente (decisión #6) depende de C.5 (Orquestador de Hokage) — este panel puede mostrar todo lo demás sin esperar a C.5. |
| Riesgos | Bajo, ya resuelta la ambigüedad de diseño. El único riesgo real es de secuenciación: retirar la pestaña de chat sin haber construido todavía el canal de Hokage (C.5) dejaría a Jorge sin forma de intervenir sobre un agente concreto durante la transición — evaluar si se retira de golpe o se deja en modo lectura hasta que C.5 exista. |
| Estado | **EXISTE PARCIALMENTE** (identidad/stats/tareas/config) · **BACKEND NECESARIO** (herramientas/memoria — menor; autonomía — C.2; conexiones — C.6/F.1). No tiene entrega propia en el Master Roadmap — candidato a añadirse en Fase D, tras C.2. |

---

### 4. Salas / departamentos

| Campo | Detalle |
|---|---|
| Qué ya existe | Tabla `departments` real con 7 filas, `WorldLayoutEngine`, `position_locked`, colores/glifos por sala. Renderizado real en el mapa. |
| Componente/sistema que lo soporta | `db/init.ts` (schema `departments`), `server.ts` (`/api/departments`), `world/layoutEngine.ts`, `world/visuals/room.ts`. |
| Qué falta | Departamentos como *plantillas tipadas* (Registry de "tipos de departamento": Marketing/Ventas/Finanzas/Sistema) — hoy cada sala es una fila con un `role` fijo, no una instancia de un tipo configurable. Sin esto, "añadir un departamento nuevo" sigue siendo escribir código. |
| Frontend | Sí — `BuildingView.tsx` debe dejar de usar `BASE_SECTIONS` fijo y leer del tipo. |
| Backend | Sí — columna/tabla `department_types` o `departments.type`. |
| Base de datos | Nueva. |
| API | Ampliar `PUT/POST /api/departments` para aceptar `type`. |
| Realtime | No nuevo. |
| Tipos/contratos nuevos | `DepartmentType`. |
| Assets | Glifos por tipo — ya existe un sistema de glifos (`BuildingGlyph`), reutilizable. |
| Sonido | No. |
| Dependencias | D.2 (necesita el Registry de paneles para que un tipo declare "qué paneles tiene"). |
| Riesgos | Medio. La niebla de "La Fundación" (documentada como deuda en `Roadmap.md`, decisión ya tomada de no tocarla ahora) no bloquea esto — los 7 departamentos actuales están `active=1` en la BD de trabajo. |
| Estado | **EXISTE PARCIALMENTE.** Corresponde a **D.4** del Master Roadmap — v1.0 solo el *slice mínimo* (distinción binaria Negocio/Sistema, necesaria para B.3/Hermes); el Registry completo es v2.0. |

---

### 5. Labs Uchiha (≈ Laboratorio / Explorador)

| Campo | Detalle |
|---|---|
| Qué ya existe | `OutputsPanel` ya muestra las tendencias reales detectadas por el Explorador (tabla `market`, vía `/api/agents/:id/outputs`). Confirmado explícitamente en `HOKAGE_CORE_SPECIFICATION_v1.md §13`: **"Ya existe"**. |
| Componente/sistema que lo soporta | `OutputsPanel.tsx`, `marketService.ts`, `GoogleTrendsTool` (tool real, no stub). |
| Qué falta | Timeline visual de actividad (§11 UI Vision Master: "10:32 Investigación iniciada..."), flujo de Aprobar/Rechazar/Revisar hallazgos con registro de decisión — hoy `OutputsPanel` es una lista, no un flujo de revisión. Requiere el `event_log` persistente (A.6) para reconstruir una timeline fiable tras un reinicio. |
| Frontend | Sí — panel especializado nuevo (registro de paneles por sala, §13 Core Spec). |
| Backend | Parcial — datos de `market` ya existen; falta encadenar hallazgo → `Decision` con `entity_type='market_finding'` (no existe hoy en `decisionResolvers.ts`). |
| Base de datos | Ninguna nueva estrictamente (reutiliza `market` + `decisions`), salvo `event_log` para la timeline (A.6). |
| API | Ampliar, no crear desde cero. |
| Realtime | Ya cubierto (WS + bus). |
| Tipos/contratos nuevos | `entity_type: 'market_finding'` en el resolver de decisiones. |
| Assets | No. |
| Sonido | No. |
| Dependencias | A.6 (event log) para la timeline con fidelidad. |
| Riesgos | Bajo. |
| Estado | **REUTILIZAR** la base de datos/tool · **FRONTEND** para el panel especializado · **BACKEND NECESARIO** menor (resolver de decisión para hallazgos). |

---

### 6. Sala de Diseños (≈ Estudio / Escritor)

| Campo | Detalle |
|---|---|
| Qué ya existe | `OutputsPanel` filtrado a `content` — confirmado "Ya existe" en `HOKAGE_CORE_SPECIFICATION_v1.md §13`. |
| Componente/sistema que lo soporta | `OutputsPanel.tsx`, `contentService.ts`. |
| Qué falta | Galería de diseños con detalle ampliado (§12.1), zona de referencias (§12.2 — texto/imágenes/archivos), vínculo a tienda/producto (§12.3, depende de integración real — ver sección 8), feedback estructurado (§12.4) y su conexión a aprendizaje (§12.5). |
| Frontend | Sí, para galería y feedback. |
| Backend | Sí — subida/almacenamiento de referencias no existe en ningún punto del sistema (confirmado por grep: no hay endpoint de upload de archivos en todo `server.ts`). Es exactamente el `Sistema de Conocimiento` (§6 Especificación Funcional / **C.4** Master Roadmap). |
| Base de datos | `knowledge_items`/`knowledge_tags` (C.4) — no existen. |
| API | Endpoint de subida — no existe. |
| Realtime | No nuevo. |
| Tipos/contratos nuevos | `KnowledgeItem`. |
| Assets | Necesita almacenamiento de archivos (imágenes/PDFs) — infraestructura nueva, no hay patrón previo en el proyecto. |
| Sonido | No. |
| Dependencias | C.4 (Sistema de Conocimiento), que a su vez depende de C.3 (`ContextComposer`). |
| Riesgos | Medio — subida de archivos es un patrón completamente nuevo en el backend (validación, límites de tamaño, almacenamiento). |
| Estado | **REUTILIZAR** galería base (`OutputsPanel`) · **BACKEND NECESARIO** para referencias/feedback/aprendizaje (**C.4**, v2.0, no bloqueante para el resto). El "aprendizaje" (§12.5) también depende de que `agent_feedback` (tabla existente, sin uso hoy) se conecte a algo real — actualmente huérfana. |

---

### 7. Sala de Reuniones

| Campo | Detalle |
|---|---|
| Qué ya existe | `messages` (canal `internal`/`general`) registra comunicación agente↔agente real, disparada por `automations` (p. ej. "Tendencia → Escritor", "Contenido → Tráfico"); `work_items` y `decisions` completan el cuadro de "quién hace qué y qué se decidió". Es más de lo que la versión anterior de este plan reconocía — ver §0, Conflicto C. |
| Componente/sistema que lo soporta | `messages` + `messageService.ts`, `work_items`, `decisions`, `automations` (pipeline data-driven ya funcionando), representación de agentes en el mapa (`world/`). |
| Qué falta | **Confirmado por decisión #4/#8 — no hace falta una entidad "reunión" nueva:** una visualización especializada de sala que agrupe `messages`/`work_items`/`decisions` recientes entre 2+ agentes en una ventana de tiempo, mostrando actividad operativa (quién habló, cuándo, sobre qué tarea, qué decisión salió) sin exponer razonamiento interno del modelo (hoy ninguna tabla persiste ese razonamiento crudo, así que es una garantía de diseño del panel, no una limpieza de datos). Representación visual de agentes "reunidos" en la sala (mesa, animación de conversación) — capa puramente visual sobre el ECS ya existente. Intervención humana dirigida a "todos" o a un agente concreto, con registro explícito de que fue humana (§13.3 UI Vision Master) — sencillo de añadir: `createMessage()` ya acepta `sender_id`, basta con distinguir origen humano. |
| Frontend | Sí — panel/sala especializada nueva + capa visual de agentes agrupados en el ECS. |
| Backend | Menor — ya no hace falta tabla `Meeting`; como mucho, un endpoint de agregación (`GET /api/rooms/reuniones/activity`) que una `messages`+`work_items`+`decisions` filtrados por ventana de tiempo — reutiliza servicios existentes. |
| Base de datos | Ninguna nueva (se reutilizan `messages`/`work_items`/`decisions`). |
| API | Un endpoint de agregación, menor. |
| Realtime | Reutiliza WS/bus existente — los eventos que alimentan esta sala ya se emiten hoy. |
| Tipos/contratos nuevos | Ninguno mayor — tipos ya existentes (`CommMsg`, `WorkItem`, `Decision`) cubren el contrato. |
| Assets | Escena visual de mesa + agentes sentados — no existe ningún asset de este tipo hoy; puramente visual, sobre el ECS ya construido (sección 14). |
| Sonido | No crítico. |
| Dependencias | D.4 (departamentos tipados, slice mínimo) para encajar como un tipo de sala más. |
| Riesgos | Bajo, ya resuelta la ambigüedad de diseño. Riesgo real a vigilar: que el panel muestre por accidente contenido que se parezca a "razonamiento interno" (p. ej. si en el futuro se decide loguear el `content` completo de una llamada al modelo) — el filtro de qué se muestra debe ser explícito en el diseño del panel, no accidental por ausencia de dato hoy. |
| Estado | **EXISTE PARCIALMENTE** (los datos operativos ya existen y se generan) · **FRONTEND NECESARIO** (la sala/visualización en sí) · **BACKEND NECESARIO** menor (endpoint de agregación). No tiene entrega en el Master Roadmap — debe añadirse ahí antes de construirse (regla del propio roadmap), pero ya no está bloqueada por ninguna tensión de diseño sin resolver. |

---

### 8. Tiendas

| Campo | Detalle |
|---|---|
| Qué ya existe | Nada funcional. `EtsyTool`/`ShopifyTool`/`PrintifyTool` existen en `tools/index.ts` con `status: 'stub'`, devuelven error explícito "no implementado: requiere MCP o API key". |
| Componente/sistema que lo soporta | Los stubs en sí, y `VenturesView.tsx` como base de UI de negocio genérica. |
| Qué falta | Todo lo real: OAuth2, credenciales, `SecretProvider` (C.6), catálogo/pedidos/ventas reales. |
| Frontend | Bloqueado. |
| Backend | Sí — íntegro. |
| Base de datos | Depende del contrato final de cada API externa — no se define aquí. |
| API | Nueva (OAuth2 callback, etc.). |
| Realtime | Sincronización periódica, no bloqueante. |
| Tipos/contratos nuevos | Se definen cuando exista la integración real. |
| Assets | No. |
| Sonido | No. |
| Dependencias | **F.2** (primer Business Module real: Etsy) del Master Roadmap, que a su vez depende de **F.1** (loader de plugins) y **C.6** (Secret Management). |
| Riesgos | Depende de una API externa real y de credenciales de Jorge (Etsy Developer). Regla explícita ya congelada: **no construir una versión con datos falsos mientras tanto.** |
| Estado | **BLOQUEADO.** Corresponde a **F.2** del Master Roadmap (v2.0, "decisión de negocio, puede adelantarse si Jorge prioriza ingresos"). |

---

### 9. Banco

| Campo | Detalle |
|---|---|
| Qué ya existe | Datos reales de coste (`agent_costs`), presupuesto (`agent_budgets`, `ventures.budget_allocated_usd`/`budget_spent_usd`/`revenue_target_usd`). Confirmado explícitamente "construible ya" en `HOKAGE_CORE_SPECIFICATION_v1.md §13`. |
| Componente/sistema que lo soporta | `agent_costs`, `agent_budgets`, `ventures`, `/api/metrics/summary`. |
| Qué falta | Panel especializado de sala que agregue estos datos (hoy no existe ninguna vista de "Banco" — `Taller`/`Banco` usan las 7 pestañas genéricas). Ingresos reales (§15 UI Vision Master) siguen bloqueados por la ausencia de integración de tienda (sección 8). |
| Frontend | Sí. |
| Backend | Ninguno nuevo — los datos ya se exponen o son trivialmente agregables desde tablas existentes. |
| Base de datos | Ninguna nueva. |
| API | Posible endpoint agregado nuevo (`/api/ventures/:id/finance-summary`) — menor, reutiliza tablas existentes. |
| Realtime | Ya cubierto. |
| Tipos/contratos nuevos | Ninguno mayor. |
| Assets | No. |
| Sonido | No. |
| Dependencias | Ninguna bloqueante — puede construirse ya. |
| Riesgos | Bajo. Cuidado explícito: no mezclar con datos de "ventas" reales inexistentes (sección 8) — este panel debe limitarse a coste/presupuesto interno, que sí es real. |
| Estado | **REUTILIZAR** datos · **FRONTEND** necesario para el panel. Candidato de alto valor y bajo riesgo — no tiene entrega propia en el Master Roadmap pero encaja de forma natural en el registro de paneles de D.4/§13 Core Spec. |

---

### 10. Torre Hokage

| Campo | Detalle |
|---|---|
| Qué ya existe | Sala/edificio hub real en el mapa; `ChatPanel` permite hablar con el agente `ceo` vía `askAgent()`; preguntas rápidas de `UI Vision Master §16.2` no existen como acciones reales todavía. |
| Componente/sistema que lo soporta | `ChatPanel.tsx`, `askAgent()` (`aiService.ts`), agente `ceo` (Claude Sonnet 4.5). |
| Qué falta | Lo que describe `UI Vision Master §16` (preguntas rápidas ejecutando operaciones reales, chat como centro de control) **es, casi palabra por palabra, el Orquestador de Hokage** (`Especificación Funcional §3`, **C.5** del Master Roadmap) — "es el corazón de la redefinición, no puede posponerse". Hoy `askAgent()` es una llamada directa de chat sin descomposición de trabajo, sin niveles de autonomía, sin reparto real entre agentes. |
| Frontend | Sí, una vez exista el backend. |
| Backend | **Sí, íntegro** — no existe ningún orquestador. No hay `POST /api/hokage/command` ni servicio equivalente. |
| Base de datos | Reutiliza `work_items`/`Decision` existentes (el propio Master Roadmap lo especifica así — "sin modificarlos"). |
| API | Nueva — `POST /api/hokage/command`. |
| Realtime | Reutiliza WS/bus existente para reflejar el progreso del plan despachado. |
| Tipos/contratos nuevos | Plan de Hokage (fases/agentes asignados), similar en forma al `ObjPlan` que ya existe para el Goal System — reutilizable como referencia de diseño. |
| Assets | Avatar/presencia del Hokage (§16.1) — no existe hoy, es puramente visual una vez haya algo que representar. |
| Sonido | Mensaje de Hokage (§24) — no programado. |
| Dependencias | **C.2** (niveles de autonomía) y **C.3** (`ContextComposer`) — ambos prerrequisitos explícitos de C.5 en el Master Roadmap. |
| Riesgos | Medio-alto — "es la pieza más nueva conceptualmente, sin precedente directo en el código actual" (cita textual del Master Roadmap). No construir la UI de Torre Hokage como si el orquestador ya existiera. |
| Estado | **EXISTE PARCIALMENTE** (chat básico) · **BACKEND NECESARIO** (orquestador real — **C.5**, v1.0, máxima prioridad de toda la Fase C). |

---

### 11. Editor del mapa

| Campo | Detalle |
|---|---|
| Qué ya existe | CRUD parcial de departamentos (`POST/PUT /api/departments`), `position_locked` ya conectado end-to-end. Ningún modo de edición visual en el frontend. |
| Componente/sistema que lo soporta | `server.ts` (rutas de departments), `world/layoutEngine.ts`. |
| Qué falta | Modo de edición diferenciado visualmente, drag/resize real, creación de salas desde la UI. |
| Frontend | Sí, mayoritariamente. |
| Backend | Parcial — CRUD ya existe, pero sin `type` (sección 4) ni validaciones de "modo edición" específicas. |
| Base de datos | Comparte necesidad con D.4 (`department_types`). |
| API | Ya existe la base; se amplía. |
| Realtime | No nuevo. |
| Tipos/contratos nuevos | Ninguno mayor más allá de D.4. |
| Assets | No. |
| Sonido | No. |
| Dependencias | **D.2** (motor de layout). |
| Riesgos | Medio. |
| Estado | **EXISTE PARCIALMENTE** (backend CRUD) · **FRONTEND NECESARIO** (modo edición). Corresponde a **D.6** del Master Roadmap (v2.0, depende de D.2). También se solapa con **E.2** (La Fundación / New Venture Wizard) para la creación guiada de salas — recordatorio: la niebla/reveal de La Fundación queda **explícitamente fuera de alcance** por decisión ya tomada (ver `Roadmap.md`, hallazgo documentado). |

---

### 12. Añadir / configurar agentes

| Campo | Detalle |
|---|---|
| Qué ya existe | `createAgent()` mínimo (`agentService.ts`), `AgentConfigPanel.tsx` permite editar nombre/modelo/prompt de un agente ya existente. |
| Componente/sistema que lo soporta | `agentService.ts`, `AgentConfigPanel.tsx`, `AGENT_MODELS`/`AGENT_TOOLS` (`agentModels.ts`). |
| Qué falta | Flujo de creación guiado (§7 UI Vision Master: avatar, departamento, herramientas, conexiones, permisos, autonomía, memoria) — hoy `createAgent()` no acepta casi ninguno de esos campos. El modelo conceptual real que hay que seguir es el de `Especificación Funcional §5`: **rol como Registry, agente como instancia** — no existe ese Registry de roles todavía (hoy los roles están hardcodeados en `AGENT_MODELS`/`AGENT_TOOLS`). |
| Frontend | Sí. |
| Backend | Sí — Registry de roles, autonomía por agente (depende de C.2), herramientas asignables desde UI (hoy son fijas en código). |
| Base de datos | Ampliar `agents` (ya tiene `capabilities TEXT DEFAULT '[]'`, sin uso real hoy) + tabla de autonomía (C.2). |
| API | Ampliar `POST /api/agents`. |
| Realtime | No nuevo. |
| Tipos/contratos nuevos | `RoleTemplate`/Registry de roles. |
| Assets | Avatar/personaje seleccionable (§7) — no existe ningún sistema de avatares hoy, solo iniciales sobre color. |
| Sonido | No. |
| Dependencias | **C.2** (autonomía) para la parte de permisos/autonomía del flujo. |
| Riesgos | Bajo-medio. |
| Estado | **EXISTE PARCIALMENTE.** **No tiene entrega propia en el Master Roadmap** — encaja como extensión natural de D.4 (departamentos tipados) + C.2, pero debe añadirse explícitamente al roadmap antes de construirse, por su propia regla. |

---

### 13. Chat Hokage

| Campo | Detalle |
|---|---|
| Qué ya existe | `ChatPanel` dentro de la sala Torre Hokage, conectado a `askAgent()` real (no mock). |
| Componente/sistema que lo soporta | `ChatPanel.tsx`, `askAgent()`. |
| Qué falta | Ver sección 10 — es la misma pieza. Además, `UI Vision Master §20` pide un **chat rápido accesible desde cualquier punto** (no solo dentro de la sala) — eso es literalmente **D.3** del Master Roadmap ("barra superior... acceso al canal de Hokage siempre visible", "como Spotlight, como un command palette"). |
| Frontend | Sí. |
| Backend | Compartido con sección 10 (**C.5**). |
| Base de datos | Compartida con C.5. |
| API | Compartida con C.5. |
| Realtime | Reutiliza WS existente. |
| Tipos/contratos nuevos | Compartidos con C.5. |
| Assets | No. |
| Sonido | Notificación de mensaje de Hokage (§24) — no programado. |
| Dependencias | **C.5** (orquestador) para que el chat rápido sea algo más que texto libre sin estructura; **D.3** (barra superior) para la accesibilidad global. |
| Riesgos | Bajo para la UI en sí; el riesgo real está en C.5 (ver sección 10). |
| Estado | **EXISTE PARCIALMENTE** (chat básico dentro de sala) · **BACKEND NECESARIO** para el comportamiento real de "centro de control" (**C.5**) · **FRONTEND NECESARIO** para la accesibilidad global (**D.3**). |

---

### 14. Animaciones y estados vivos

| Campo | Detalle |
|---|---|
| Qué ya existe | Motor ECS completo y funcionando: `AnimationSystem`, `ParticleSystem`, `MovementSystem`, `CameraSystem`, registries de animación/partículas/visual-kind. Tokens con anillo de pulso, burbuja de acción, ripples en eventos reales. Nada de esto es decorativo — cumple ya la regla de `UI Vision Master §23` y la del propio napkin del proyecto ("no animaciones decorativas — todo debe reflejar estado real"). |
| Componente/sistema que lo soporta | `world/ecs/`, `world/systems/`, `world/registries/`, `world/visuals/`. |
| Qué falta | **R7 — overlays de datos activables** (actividad/presupuesto/pipeline/salud directamente sobre el mapa), identificado en `docs/research/world-engine/prison-architect.md` como valioso y nunca construido — confirmado explícitamente en `HOKAGE_CORE_SPECIFICATION_v1.md §13` como "el siguiente candidato real del World Engine". También: el `setInterval` por agente en `useWorldState.ts` (deuda documentada a propósito) debería absorberse en `MovementSystem` antes de añadir comportamiento nuevo de movimiento. |
| Frontend | Sí, mayoritariamente. |
| Backend | No para R7 en sí — consume datos ya expuestos (`work_items`, `agent_costs`, `/api/metrics/summary`). |
| Base de datos | Ninguna nueva. |
| API | Ninguna nueva. |
| Realtime | Ya cubierto — R7 solo visualiza datos que el WS ya entrega. |
| Tipos/contratos nuevos | Overlay toggles (frontend-only). |
| Assets | No. |
| Sonido | No. |
| Dependencias | Ninguna bloqueante. |
| Riesgos | Bajo — es la parte más madura de todo el sistema. |
| Estado | **REUTILIZAR** el motor · **FRONTEND** para R7 (overlays) y para absorber el `setInterval` de vagabundeo en `MovementSystem`. No tiene entrega numerada en el Master Roadmap — candidato de bajo riesgo/alto valor a añadir. |

---

### 15. Sonido

| Campo | Detalle |
|---|---|
| Qué ya existe | Nada. Cero referencias a audio en todo el código (`frontend/src`) y cero menciones en `Especificación Funcional`, `HOKAGE_CORE_SPECIFICATION_v1.md` o `Master Roadmap`. |
| Componente/sistema que lo soporta | Ninguno. |
| Qué falta | Todo. |
| Frontend | Sí, íntegro. |
| Backend | No — es puramente cliente (Web Audio API o similar), salvo la preferencia de volumen/activación, que si se quiere persistir entre sesiones necesitaría backend (coherente con "personalización" de la Especificación Funcional §9/§13, nivel 4 "personalización"). |
| Base de datos | Ninguna, salvo que se persista la preferencia (menor). |
| API | Ninguna, salvo preferencia. |
| Realtime | No. |
| Tipos/contratos nuevos | Ninguno mayor. |
| Assets | Sí — archivos de audio (clicks, apertura/cierre de panel, notificación, error, tarea completada). No existe ningún asset de este tipo en el repo. |
| Sonido | — (es la propia sección). |
| Dependencias | Ninguna técnica. |
| Riesgos | Bajo técnicamente, pero **no programado en ningún documento de arquitectura vigente**. |
| Estado | **NO PROGRAMADO.** No aparece en el Master Roadmap. Por su propia regla, debe añadirse ahí antes de construirse — aunque, a diferencia de la Sala de Reuniones (sección 7), aquí no hay ninguna tensión de diseño que resolver primero: es aditivo, aislado, y de bajo riesgo cuando se decida priorizar. |

---

### 16. Estados realtime

| Campo | Detalle |
|---|---|
| Qué ya existe | WebSocket real con snapshot inicial completo + broadcast de todo evento del bus. `HokageBus` en memoria (sin persistir a SQLite — cumple ya su propio contrato, `ADR-003`). Esto ya cubre la mayoría de lo que pide `UI Vision Master §21/§31` (estados IDLE/RUNNING/WAITING/ERROR/etc. — visibles hoy vía `agent_runs.status` + eventos). |
| Componente/sistema que lo soporta | `config/eventBus.ts`, WS en `server.ts`, `useWebSocket.ts`, `world/events/`. |
| Qué falta | Persistencia del Event Bus (`event_log`, **A.6** del Master Roadmap) — hoy un reinicio del proceso pierde todo evento que no haya tocado ya una tabla de dominio. Bloqueante real para: memoria de Hokage, timeline fiable de Labs Uchiha/Reuniones, y el **briefing al abrir sesión** que pide `Especificación Funcional §2` ("Mientras no estabas: el Explorador detectó..."). El briefing en sí **no existe** — no hay ningún endpoint ni lógica que lo genere. |
| Frontend | Menor, una vez exista el backend. |
| Backend | Sí — `event_log` (A.6) y el propio servicio de briefing (no tiene entrega numerada explícita, pero depende de A.6 + C.1/C.3 para tener contexto que sintetizar). |
| Base de datos | Nueva tabla `event_log`. |
| API | Nueva para el briefing. |
| Realtime | Ya cubierto para lo que sí persiste hoy; el hueco es específicamente la supervivencia a reinicios. |
| Tipos/contratos nuevos | `event_log` row shape. |
| Assets | No. |
| Sonido | No. |
| Dependencias | **A.6**, y para el briefing en sí, **C.1** (Memory System) + **C.3** (`ContextComposer`). |
| Riesgos | Bajo para A.6 en sí ("tabla aditiva, no cambia el contrato del bus"). |
| Estado | **REUTILIZAR** WS/bus en vivo · **BACKEND NECESARIO** para persistencia (**A.6**) y para el briefing (no programado explícitamente, depende de C.1/C.3). |

---

### 17. Responsive y pulido

| Campo | Detalle |
|---|---|
| Qué ya existe | Diseño ya orientado a desktop, prioridad correcta según `UI Vision Master §28`. Existe un design system embrionario (`design/tokens.ts`, `design/components/*`) pero **no lo usa ninguna vista real** — hallazgo confirmado explícitamente en el Master Roadmap (A.3). |
| Componente/sistema que lo soporta | `design/`, `styles.css`, `shared/constants.ts`. |
| Qué falta | Consolidar: hoy hay **4 fuentes de paleta sin sincronía** (`styles.css`, `design/tokens.ts`, `shared/constants.ts`, hex sueltos en `ObjectivesView.tsx`) — confirmado como hallazgo real de auditoría, no una suposición de este plan. |
| Frontend | Sí, íntegro. |
| Backend | No. |
| Base de datos | No. |
| API | No. |
| Realtime | No aplica. |
| Tipos/contratos nuevos | Sistema único de tokens de diseño. |
| Assets | No nuevos — es consolidación de lo existente. |
| Sonido | No. |
| Dependencias | Ninguna — pero es **prerrequisito real de toda la Fase D** (no tiene sentido construir el motor de layout o temas sobre una base de diseño duplicada). |
| Riesgos | Bajo — "es eliminar duplicación, no cambiar comportamiento" (cita del Master Roadmap). |
| Estado | **EXISTE PARCIALMENTE** (piezas sueltas, no consolidadas). Corresponde a **A.3** del Master Roadmap (v1.0, 2 días) — y debe ir **antes**, no después, de casi todo lo demás de este plan. |

---

## 3. Infraestructura de UI ya existente — confirmado en código antes de definir la Fase 1

Antes de tocar nada visual, esto es lo que ya existe realmente (verificado con `grep`/lectura directa, no supuesto):

- **`frontend/src/design/tokens.ts`** es una copia manual en JS de las mismas custom properties de `frontend/src/styles.css` (`colors.void === --void`, `colors.ember === --ember`, etc., byte a byte). El propio archivo lo admite en su primera línea: *"Cualquier cambio de paleta debe reflejarse en ambos lugares"* — es decir, la duplicación es conocida y manual, no accidental.
- **`frontend/src/design/components/*`** (`GlowText`, `ProgressBar`, `StatusDot`, `TerminalCard`, `AgentAvatar`) — confirmado por `grep`: **el único importador real es `main.tsx`** (la ruta de desarrollo `/design-preview`). Ninguna vista de producción (`GameLayout`, `BuildingView`, `GameHUD`, paneles) los usa.
- **`frontend/src/shared/ui.tsx`** — el set de componentes que sí usan las vistas reales (`Panel`, `Led`, `Badge`, etc.). No importa nada de `design/tokens.ts` ni de `design/components/*` — es una tercera fuente de estilo, independiente de las otras dos, que resuelve sus colores con `var(--...)` inline directamente contra `styles.css`.
- **Hex sueltos fuera de las tres fuentes anteriores**, confirmado por `grep -rlo "#[0-9a-fA-F]{6}"`: `GameLayout.tsx`, `shared/constants.ts` (paleta de `BUILDINGS`), `panels/StatsPanel.tsx`, `views/ObjectivesView.tsx`.
- **Conclusión verificada, no eran 4 fuentes "aproximadas" — son exactamente 4, con roles distintos:** `styles.css` (CSS vars, la que de verdad renderiza), `design/tokens.ts` (copia JS muerta en producción, solo usada por el preview), `shared/ui.tsx` (componentes reales, sin tokens propios, resuelve contra `styles.css` directamente), y hex sueltos en 4 archivos de vista/paneles. `BUILDINGS` (`shared/constants.ts`) además duplica color con la tabla `departments` del backend — confirmado en `useWorldState.ts:37`, sigue siendo un fallback real, no está muerto.
- **La barra superior (`GameHUD.tsx`) ya existe y ya es en gran parte lo que `D.3` pide** — reloj, coste del día, contador de alertas/mensajes/objetivos, toggle START/STOP conectado al runtime real. Lo que falta específicamente, confirmado leyendo el componente completo: (a) las alertas solo *navegan* a `AlertsView`, no se aprueban/rechazan inline desde la barra; (b) no hay ningún input de texto para Hokage en la barra — solo un botón de navegación a la sala. **Esto reduce el alcance real de D.3** respecto a lo que el Master Roadmap asumía — se refleja en la Fase 6 más abajo.

Con esto confirmado, la Fase 1 no es "crear un sistema de diseño" — es **elegir una única fuente de las tres que ya compiten y eliminar las otras dos**, sin tocar ningún comportamiento visible.

---

## 4. Guardrails — no romper esto en ninguna fase

Aplican a todas las fases de este plan sin excepción:

| Evitar | Qué reutilizar en su lugar |
|---|---|
| Rehacer el ECS del mapa | `world/ecs/`, `world/systems/`, `world/registries/` tal cual. Cualquier pieza visual nueva (R7, Sala de Reuniones) es un `System`/`VisualKind` nuevo *registrado* en ese motor, nunca un renderer paralelo. |
| Estados globales duplicados | `useAppData.ts`/`useWorldState.ts` como única fuente de estado de cliente. Estado nuevo (layout, autonomía) se añade ahí — no un store nuevo (Redux/Zustand/Context propio). |
| APIs duplicadas | Todo endpoint nuevo se añade a `server.ts` (patrón ya establecido, un único archivo). Antes de crear un endpoint, comprobar si ya expone el dato uno existente (`/api/agents/:id/stats`, `/api/metrics/summary`, etc.). |
| Otro sistema de eventos | Todo evento nuevo pasa por `HokageBus`/`bus.publish()`. La persistencia (Fase 2) es un suscriptor más del bus, nunca un segundo bus. |
| Otra arquitectura de agentes | Cualquier trabajo despachado a un agente pasa por `work_items`/`agentRuntime.ts`/`askAgent()`. El Orquestador de Hokage (Fase 14) es un despachador *sobre* ese motor, no un motor nuevo. |
| Implementar stubs como reales | `EtsyTool`/`ShopifyTool`/`PrintifyTool` siguen devolviendo su error explícito hasta que exista integración real (fuera de este plan). Ningún panel construido aquí muestra datos de tienda simulados. |
| Cambios grandes sin validación intermedia | Cada fase de este plan deja la app compilando y funcionando, con su propio criterio de validación — es la razón por la que entregas grandes del Master Roadmap (D.2, Memory System) se dividen aquí en sub-fases. |

---

## Fases de implementación

### Fase 1 — Consolidar el sistema de diseño

| Campo | Detalle |
|---|---|
| Objetivo | Una única fuente de verdad de paleta/tipografía/espaciado. Cero cambio de comportamiento. |
| Resultado visible esperado | Ninguno para Jorge — la app se ve exactamente igual. La validación es técnica, no visual. |
| Componentes a crear/modificar | `design/tokens.ts` (pasa a ser la única fuente, o se retira en favor de `styles.css` — decidir una vez, no dejar las dos); `design/components/*` (se fusionan en `shared/ui.tsx` o se retiran, nunca conviven ambas rutas); `shared/constants.ts` (`BUILDINGS` deja de tener su propia copia de color); `views/ObjectivesView.tsx`, `panels/StatsPanel.tsx`, `views/GameLayout.tsx` (hex sueltos → variable). |
| Backend necesario | Ninguno. |
| APIs necesarias | Ninguna. |
| Tipos/contratos necesarios | Ninguno nuevo. |
| Realtime/eventos necesarios | Ninguno. |
| Datos necesarios | Ninguno nuevo — es la paleta ya definida en `styles.css`. |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Ninguna — es la primera. |
| Criterio de validación | `npx tsc --noEmit` limpio en frontend; captura visual antes/después idéntica en Mapa, una sala, y un overlay. |
| Qué NO debe tocarse | Ningún componente de `world/` (el mapa no usa esta paleta de la misma forma — sus colores son numéricos para PixiJS, ya centralizados en `world/visuals/palette.ts`, fuera de alcance de esta fase); ninguna ruta de backend; ningún comportamiento de negocio. |
| Criterio de "terminado" | Una sola fuente de paleta verificable por `grep -r "#[0-9a-fA-F]\{6\}"` sin resultados fuera de esa fuente; cero componentes duplicados con el mismo propósito. |

---

### Fase 2 — Persistencia del Event Bus (`event_log`)

| Campo | Detalle |
|---|---|
| Objetivo | Los eventos del bus sobreviven a un reinicio del proceso. |
| Resultado visible esperado | Ninguno inmediato para Jorge — verificable solo reiniciando el backend y comprobando que el histórico de eventos sigue consultable (vía una query directa a la tabla nueva, no hay UI todavía que lo muestre). |
| Componentes a crear/modificar | `config/eventBus.ts` (nuevo suscriptor que persiste cada evento), `db/init.ts` (tabla nueva). |
| Backend necesario | Sí — el suscriptor nuevo. |
| APIs necesarias | Ninguna todavía (se consumirá en fases posteriores — briefing, timelines). |
| Tipos/contratos necesarios | Forma de fila de `event_log` (type, from, to, payload, created_at). |
| Realtime/eventos necesarios | Ninguno nuevo — reutiliza el bus existente como fuente, no lo modifica. |
| Datos necesarios | Ninguno nuevo más allá de la tabla. |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Ninguna — puede hacerse en paralelo con la Fase 1. |
| Criterio de validación | Reiniciar `tsx src/server.ts` y confirmar por consulta directa a SQLite que el histórico previo al reinicio sigue en `event_log`. |
| Qué NO debe tocarse | El contrato del propio `HokageBus` (`publish`/`subscribe`/`getHistory`) — no debe empezar a persistir él mismo; la persistencia vive en un suscriptor aparte, exactamente como un log de auditoría en paralelo. |
| Criterio de "terminado" | `event_log` tiene filas tras cualquier actividad del bus; un reinicio no las pierde. |

---

### Fase 3 — `venture_id` estructural

| Campo | Detalle |
|---|---|
| Objetivo | `venture_id` deja de ser el prefijo de texto `[VENTURE: nombre]` y pasa a ser un campo real en `AgentTask`/`ToolContext`. |
| Resultado visible esperado | Ninguno para Jorge — refactor interno puro. |
| Componentes a crear/modificar | `agentRuntime.ts` (`AgentTask.ventureId`), `aiService.ts` (`askAgent()` recibe el parámetro), `tools/base.ts` (`ToolContext.ventureId` sustituye al campo muerto `businessId`). |
| Backend necesario | Sí, íntegro (es puramente backend). |
| APIs necesarias | Ninguna nueva. |
| Tipos/contratos necesarios | `AgentTask.ventureId: number \| null`, `ToolContext.ventureId`. |
| Realtime/eventos necesarios | Ninguno. |
| Datos necesarios | Ninguno nuevo — `work_items.venture_id` ya existe en el schema. |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Ninguna — puede hacerse en paralelo con las Fases 1-2. |
| Criterio de validación | `grep -rn "VENTURE:" agentRuntime.ts` no encuentra el prefijo de texto; `npx tsc --noEmit` limpio; una tarea con venture sigue funcionando igual de bien que hoy. |
| Qué NO debe tocarse | El resto del pipeline de `agentRuntime.ts` (las 8 etapas) — es un cambio de forma de un dato que ya viaja, no de flujo. |
| Criterio de "terminado" | Ningún agente recibe el venture como texto libre; `ToolContext` no tiene `businessId`. |

---

### Fase 4 — Motor de paneles: Registry interno (sin persistencia todavía)

| Campo | Detalle |
|---|---|
| Objetivo | Cada panel/overlay que hoy es una rama `if`/`switch` en `GameLayout.tsx` pasa a ser una instancia declarada en un Registry — **sin cambiar todavía dónde vive el estado** (sigue en memoria de React, no en backend). Divide la entrega D.2 del Master Roadmap en dos para poder validar el refactor de mecanismo antes de añadir persistencia encima. |
| Resultado visible esperado | Ninguno — la disposición de HUD/rail/panel/overlays debe verse y comportarse exactamente igual que hoy. |
| Componentes a crear/modificar | `world/registries/` gana un `PanelRegistry.ts` nuevo (mismo patrón que `VisualKindRegistry` del ECS, fuera de `world/` esta vez — vive en `frontend/src/registries/` o similar, a decidir en la sesión); `GameLayout.tsx` se reescribe para leer de ese Registry en vez de JSX condicional fijo. |
| Backend necesario | Ninguno todavía. |
| APIs necesarias | Ninguna todavía. |
| Tipos/contratos necesarios | `PanelDescriptor` (id, tipo, componente, posición por defecto). |
| Realtime/eventos necesarios | Ninguno nuevo. |
| Datos necesarios | Ninguno nuevo. |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Fase 1 (paleta consolidada — no tiene sentido tocar el layout dos veces por dos motivos distintos). |
| Criterio de validación | Sesión manual en navegador: abrir cada sala, cada overlay (Objetivos/Ventures/Comms/Alertas/Crew/Config), confirmar que el mapa **nunca se desmonta** (propiedad más valiosa del frontend actual) y que cerrar cada panel vuelve exactamente al estado anterior. |
| Qué NO debe tocarse | `WorldCanvas.tsx`, cualquier archivo de `world/` — el Registry nuevo describe *qué panel de React se monta*, no toca el motor PixiJS. Ningún endpoint de backend. |
| Criterio de "terminado" | Añadir un panel nuevo (de prueba, descartable) es una entrada de Registry, no una edición de `GameLayout.tsx`; cero regresión visual confirmada manualmente. |

---

### Fase 5 — Motor de paneles: persistencia en backend

| Campo | Detalle |
|---|---|
| Objetivo | La disposición/estado de qué está abierto sobrevive a cerrar y reabrir el navegador. |
| Resultado visible esperado | Cerrar el navegador con una sala abierta y un overlay activo, y al volver a abrir, encontrar el mismo estado — "el escritorio que dejaste es el escritorio que encuentras" (`Especificación Funcional §1`). |
| Componentes a crear/modificar | `db/init.ts` (tabla `user_layout`), `server.ts` (`GET/PUT /api/layout`), `GameLayout.tsx` (carga estado al montar, guarda en cada cambio relevante). |
| Backend necesario | Sí — tabla + endpoint. |
| APIs necesarias | `GET /api/layout`, `PUT /api/layout`. |
| Tipos/contratos necesarios | `UserLayout` (qué panel/sala estaba abierto, posición si aplica). |
| Realtime/eventos necesarios | Ninguno — es estado de sesión, no un evento de dominio. |
| Datos necesarios | Tabla nueva únicamente. |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Fase 4 (el Registry debe existir antes de decidir qué se persiste). |
| Criterio de validación | Recargar la página (`F5`) con una sala abierta reconstruye exactamente ese estado desde el backend, no desde `localStorage`. |
| Qué NO debe tocarse | El propio Registry de la Fase 4 (esta fase solo le añade una fuente de estado inicial, no cambia su forma). |
| Criterio de "terminado" | Cerrar/reabrir el navegador conserva el layout, verificado con backend reiniciado entre medias (para confirmar que persiste en BD, no en memoria del proceso). |

---

### Fase 6 — Barra superior: notificaciones accionables + acceso a Hokage

| Campo | Detalle |
|---|---|
| Objetivo | Cerrar el hueco real ya confirmado en `GameHUD.tsx` (§3 de este documento): las alertas se aprueban/rechazan sin navegar, y existe un punto de entrada de texto hacia Hokage siempre visible. |
| Resultado visible esperado | Click en el contador de alertas abre un desplegable con las decisiones pendientes y botones Aprobar/Rechazar inline; un campo de texto en la barra permite escribir a Hokage sin entrar en su sala. |
| Componentes a crear/modificar | `GameHUD.tsx` (desplegable de notificaciones, input de Hokage). Reutiliza `api.approve()`/`api.reject()` (ya existen) y, para el input, `askAgent()` sobre el agente `ceo` **tal cual funciona hoy** — sin descomposición de trabajo todavía (eso es la Fase 14). |
| Backend necesario | Ninguno nuevo — reutiliza `PUT /api/decisions/:id/approve`, `/reject`, `POST /api/agents/:id/ask`. |
| APIs necesarias | Ninguna nueva. |
| Tipos/contratos necesarios | Ninguno nuevo. |
| Realtime/eventos necesarios | Ninguno nuevo — el contador ya se actualiza por WS. |
| Datos necesarios | Ninguno nuevo. |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno (la notificación sonora de §24 sigue no programada). |
| Dependencias con fases anteriores | Fase 4/5 si el desplegable se monta como panel del Registry (recomendado); técnicamente podría hacerse antes, pero se sitúa aquí para no crear un segundo mecanismo de panel ad-hoc. |
| Criterio de validación | Aprobar/rechazar una decisión desde la barra sin navegar a `AlertsView`; enviar un mensaje a Hokage desde la barra sin entrar en Torre Hokage, y ver la respuesta. |
| Qué NO debe tocarse | `decisionService.ts`/`decisionResolvers.ts` (se reutilizan tal cual); no crear una segunda ruta de aprobación. |
| Criterio de "terminado" | Una decisión pendiente se aprueba/rechaza desde la notificación sin navegar (criterio ya fijado en el Master Roadmap para D.3). |

---

### Fase 7 — Departamentos tipados: slice mínimo (Negocio / Sistema)

| Campo | Detalle |
|---|---|
| Objetivo | Distinción binaria de tipo de departamento — únicamente lo necesario para que la Fase 8 pueda reclasificar la sala de Hermes sin construir el Registry completo de tipos todavía. |
| Resultado visible esperado | Ninguno directo — es la base de la Fase 8. |
| Componentes a crear/modificar | `db/init.ts` (columna `departments.type`, migración aditiva con `columnExists`, valores `'business'`/`'system'`), `server.ts` (`PUT/POST /api/departments` acepta `type`). |
| Backend necesario | Sí — columna + migración. |
| APIs necesarias | Ampliar las ya existentes de `departments`, no crear nuevas. |
| Tipos/contratos necesarios | `DepartmentType = 'business' \| 'system'` (frontend), reflejando la columna. |
| Realtime/eventos necesarios | Ninguno nuevo. |
| Datos necesarios | Migración: todas las salas actuales → `type='business'` salvo `hermes` → `type='system'`. |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Ninguna estructural — puede hacerse en paralelo con las Fases 4-6. |
| Criterio de validación | Migración corre limpia sobre la BD de trabajo actual (7 departamentos); `GET /api/departments` devuelve `type` en cada fila. |
| Qué NO debe tocarse | No construir todavía el Registry completo de tipos (eso es la Fase 16) — esta fase es deliberadamente el slice mínimo, igual que lo fija el Master Roadmap para B.3. |
| Criterio de "terminado" | Cada departamento tiene un `type` válido; ninguna vista rompe por el campo nuevo (aditivo, con default). |

---

### Fase 8 — Hermes: retirar chat, construir Panel de Sistema

| Campo | Detalle |
|---|---|
| Objetivo | Aplicar la decisión de producto (§0, punto 2) de la forma más segura posible: **sin tocar todavía la tabla `agents`** (ese refactor, B.1 del Master Roadmap, es de mayor riesgo — "toca el punto de datos más citado del sistema" — y se deja fuera de este plan hasta que haga falta de verdad). Se resuelve primero la parte segura y de mayor valor visible: Hermes deja de ofrecer chat y gana un panel real de estado operativo. |
| Resultado visible esperado | Al entrar en la Sala de Máquinas: sin pestaña "Chat"; con una pestaña "Estado del Sistema" mostrando cola de `work_items`, presupuesto consumido, agentes con errores recientes — datos reales, no simulados. |
| Componentes a crear/modificar | `BuildingView.tsx` (para `role === 'hermes'`: quitar `BASE_SECTIONS[0]` de la lista, mantener `TERMINAL_TAB`, añadir pestaña nueva "Sistema"); componente nuevo `SystemStatusPanel.tsx`. |
| Backend necesario | Ninguno nuevo si se reutiliza tal cual `GET /api/runtime/status` + `GET /api/metrics/summary` (ambos ya existen y ya devuelven datos reales). |
| APIs necesarias | Ninguna nueva — reutiliza las dos anteriores. |
| Tipos/contratos necesarios | Ninguno nuevo. |
| Realtime/eventos necesarios | Ninguno nuevo. |
| Datos necesarios | Ninguno nuevo. |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Fase 7 (necesita `departments.type='system'` para que la sala de Hermes se identifique como distinta sin un `if (role === 'hermes')` disperso — aunque el slice mínimo permite hacerlo también con esa condición directa si se prefiere no esperar). |
| Criterio de validación | Entrar en la Sala de Máquinas ya no ofrece chat; el panel de estado muestra números que cambian cuando el runtime procesa trabajo real (verificable disparando `POST /api/runtime/start` con actividad pendiente). |
| Qué NO debe tocarse | La tabla `agents` (Hermes sigue siendo una fila ahí por ahora — ese refactor queda fuera de este plan, documentado como pendiente, no como error); `system.exec`/`hermesService.ts` (siguen exactamente igual, siempre con aprobación). |
| Criterio de "terminado" | La sala de Hermes no ofrece ninguna superficie de chat; el estado operativo real es consultable desde el panel. |

---

### Fase 9 — Paneles de sala de bajo riesgo: Banco, Labs Uchiha, Sala de Diseños (base)

| Campo | Detalle |
|---|---|
| Objetivo | Capturar el valor de mayor relación beneficio/riesgo del plan: tres paneles especializados sobre datos que **ya existen** hoy. |
| Resultado visible esperado | Banco muestra coste/presupuesto real por venture; Laboratorio muestra timeline de tendencias detectadas con flujo Aprobar/Rechazar; Estudio muestra la galería de contenido ya generado (sin referencias/feedback todavía — eso depende de C.4, fuera de este plan). |
| Componentes a crear/modificar | Tres paneles nuevos (`BankPanel.tsx`, especialización de `OutputsPanel` para Laboratorio con timeline, especialización para Estudio); `decisionResolvers.ts` gana `entity_type: 'market_finding'`. |
| Backend necesario | Menor — solo el resolver de decisión nuevo para hallazgos de Laboratorio; Banco y Estudio no necesitan nada nuevo. |
| APIs necesarias | Posible `GET /api/ventures/:id/finance-summary` (agregación menor sobre tablas existentes) — opcional, puede resolverse en frontend agregando lo que ya devuelven `/api/ventures` + `/api/agents/:id/stats`. |
| Tipos/contratos necesarios | `entity_type: 'market_finding'` en el tipo `Decision`. |
| Realtime/eventos necesarios | Ninguno nuevo — reutiliza WS/bus. |
| Datos necesarios | Ninguno nuevo (timeline fiable de Laboratorio queda mejor con la Fase 2 ya hecha, pero no es bloqueante — sin ella, la timeline solo cubre lo que ha pasado desde el último arranque). |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Fase 4/5 si se registran como paneles del motor nuevo (recomendado, evita crear el patrón ad-hoc una vez más); Fase 2 recomendable, no bloqueante, para la timeline de Laboratorio. |
| Criterio de validación | Los tres paneles muestran datos reales verificables contra una consulta directa a SQLite (coste, tendencias, contenido) — ninguno debe mostrar un valor que no se pueda trazar a una fila real. |
| Qué NO debe tocarse | `Tienda`/`Taller` — quedan explícitamente fuera (bloqueado por integración real / no urgente, respectivamente). |
| Criterio de "terminado" | Los tres paneles existen, muestran datos reales, y Laboratorio permite Aprobar/Rechazar un hallazgo con registro en `decisions`. |

---

### Fase 10 — Panel universal de agente (versión operativa)

| Campo | Detalle |
|---|---|
| Objetivo | Aplicar la decisión de producto (§0, puntos 5 y 7): panel operativo/configurativo por agente, invocable desde cualquier sitio, sin chat como flujo principal. |
| Resultado visible esperado | Un mismo componente de panel de agente, abierto desde el rail izquierdo, el mapa, o dentro de una sala, mostrando: identidad, estado, tarea actual, progreso, resultados recientes, herramientas asignadas, memoria relevante, configuración. La pestaña de chat existente se conserva pero se **degrada** — deja de ser la pestaña por defecto, se etiqueta como modo de depuración (ver `Especificación Funcional`: "chat directo a un agente concreto es modo debug excepcional, nunca el flujo por defecto") — no se retira todavía del todo, ver Fase 14. |
| Componentes a crear/modificar | Extraer un `AgentPanel.tsx` nuevo, invocable independientemente de `BuildingView`; `BuildingView.tsx` lo usa como su columna lateral existente en vez de tener su propia versión inline. |
| Backend necesario | Menor — dos endpoints de lectura nuevos. |
| APIs necesarias | `GET /api/agents/:id/tools` (lee `toolsForRole()` de `agentModels.ts` y lo expone), `GET /api/agents/:id/memory` (lee `agent_memory`, hoy sin ninguna ruta). |
| Tipos/contratos necesarios | `AgentToolInfo`, `AgentMemoryEntry` (formas de respuesta de los dos endpoints nuevos). |
| Realtime/eventos necesarios | Ninguno nuevo — reutiliza WS existente para estado/actividad. |
| Datos necesarios | Ninguno nuevo — ambos endpoints leen tablas/config ya existentes. |
| Assets necesarios | Ninguno (avatar real sigue fuera de alcance, sección 3 del documento). |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Fase 4/5 (panel invocable desde cualquier sitio, mismo motivo que las Fases 6/9). |
| Criterio de validación | Abrir el panel del mismo agente desde el rail y desde el mapa muestra exactamente el mismo componente con los mismos datos; herramientas y memoria mostradas coinciden con lo que hay en código/BD. |
| Qué NO debe tocarse | No retirar `ChatPanel`/`askAgent()` todavía — la retirada completa depende de que exista un canal real de intervención (Fase 14), tal como ya advierte la sección de Riesgos de este documento. |
| Criterio de "terminado" | El panel es un único componente reutilizable en los tres puntos de entrada; muestra los 7 campos que pide la decisión #7 (estado, tareas, progreso, resultados, herramientas, memoria, configuración) — "conexiones" queda pendiente de Secret Management, fuera de este plan. |

---

### Fase 11 — Niveles de autonomía (0-3)

| Campo | Detalle |
|---|---|
| Objetivo | El modelo de 4 niveles de `Especificación Funcional §3` se vuelve un contrato real, mapeado sobre `decisions.risk_level`. |
| Resultado visible esperado | El panel de agente (Fase 10) muestra el nivel de autonomía real de cada agente, no un valor inventado. |
| Componentes a crear/modificar | `db/init.ts` (tabla de configuración por tipo de acción), `decisionService.ts`, `agentRuntime.ts` (consulta el nivel antes de decidir si crear `Decision` o ejecutar directo). |
| Backend necesario | Sí. |
| APIs necesarias | `GET/PUT` sobre la tabla de configuración de autonomía (endpoint nuevo, menor). |
| Tipos/contratos necesarios | `AutonomyLevel = 0 \| 1 \| 2 \| 3`, `AutonomyConfig` (tipo de acción → nivel por defecto). |
| Realtime/eventos necesarios | Ninguno nuevo. |
| Datos necesarios | Tabla nueva + valores por defecto sembrados. |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Fase 10 (para tener dónde mostrarlo) — el backend en sí podría construirse antes, pero no tiene resultado visible propio hasta que el panel exista. |
| Criterio de validación | Cambiar un nivel es un `UPDATE`, no un despliegue; el `risk_level` de una `Decision` nueva respeta el nivel configurado para su tipo de acción. |
| Qué NO debe tocarse | El mecanismo de `Decision`/aprobación existente — este contrato se apoya encima, no lo sustituye. |
| Criterio de "terminado" | Cada tipo de acción tiene un nivel configurado y consultable; el panel de agente lo refleja con datos reales. |

---

### Fase 12 — Memory System v3

| Campo | Detalle |
|---|---|
| Objetivo | Construir `memory_entries` + tool `memory.remember` + los 4 puntos de enganche automáticos ya verificados en `HOKAGE_CORE_SPECIFICATION_v1.md §6`/`ADR-004`. Arquitectura ya congelada — esta fase la ejecuta, no la diseña. |
| Resultado visible esperado | Ninguno directo todavía — es infraestructura para la Fase 13/14. |
| Componentes a crear/modificar | `db/init.ts` (`memory_entries` + FTS5), `tools/` (`memory.remember` nueva, distinta de `memory.write` privada — no se toca esta última), `decisionResolvers.ts`, `stage4_checkTTLs()`, `objectiveService.ts` (puntos de enganche). |
| Backend necesario | Sí, íntegro. |
| APIs necesarias | Lectura acotada (mencionada en la especificación como "no bloquea el resto de la fase") — puede diferirse a cuando exista un panel que la consuma. |
| Tipos/contratos necesarios | `MemoryEntry` (category, venture_id, entity_type/entity_id, contenido). |
| Realtime/eventos necesarios | Ninguno nuevo — los puntos de enganche reaccionan a eventos/flujos ya existentes (decisiones resueltas, objetivos cerrados). |
| Datos necesarios | Tabla nueva. |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Fase 3 (`venture_id` estructural — bloqueante, ya lo fija el propio ADR-004: `memory_entries` necesita leer por venture, no solo escribir). |
| Criterio de validación | Los 4 puntos de enganche capturan una entrada real durante una sesión de prueba (p. ej. cerrar un objetivo genera una entrada de memoria); lectura por venture funciona; `memory.write` (privada) sigue intacta. |
| Qué NO debe tocarse | `memory.write`/`agent_memory` (memoria privada por agente) — `memory.remember` es una tool nueva y distinta, no un parámetro sobre la existente. |
| Criterio de "terminado" | Igual al criterio ya fijado en el Master Roadmap para C.1: los 4 puntos de enganche capturan en producción; lectura por venture funciona. |

---

### Fase 13 — `ContextComposer` (capas Global / Departamento / Temporal)

| Campo | Detalle |
|---|---|
| Objetivo | Sustituir el `system_prompt` monolítico por composición en tiempo de ejecución de 3 capas. |
| Resultado visible esperado | Ninguno directo — cambio interno del pipeline de IA. Verificable indirectamente: cambiar la capa Global una vez debería reflejarse en el comportamiento de los 7 agentes sin re-sembrarlos a mano. |
| Componentes a crear/modificar | `db/init.ts` (tabla `context_global`, pequeña), `agentRuntime.ts`/`aiService.ts` (compositor nuevo reemplaza la concatenación de `system_prompt` + `[VENTURE:]`), los 7 seeds de agentes reescritos como instrucciones estructuradas. |
| Backend necesario | Sí, íntegro. |
| APIs necesarias | `GET/PUT` sobre `context_global` (menor). |
| Tipos/contratos necesarios | Forma estructurada de instrucciones por rol (objetivo, límites, formato de salida) — reemplaza el párrafo libre actual. |
| Realtime/eventos necesarios | Ninguno nuevo. |
| Datos necesarios | Tabla nueva + migración de los 7 prompts existentes. |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Fase 12 (Memory System da la capa de Departamento/Agente vía `memory_entries`), Fase 3. |
| Criterio de validación | Ningún agente recibe contexto que no declara necesitar (verificable inspeccionando el `system_prompt` final construido); una tarea de prueba con cada uno de los 7 roles sigue produciendo una respuesta coherente tras la migración. |
| Qué NO debe tocarse | El punto de entrada `askAgent()` en sí (su firma no cambia para los llamadores existentes — internamente construye el prompt distinto). |
| Criterio de "terminado" | Cambiar la capa Global es una fila, no un re-seed; los 7 agentes migrados y funcionando. |

---

### Fase 14 — Orquestador de Hokage + Chat Hokage real + retirada final del chat directo

| Campo | Detalle |
|---|---|
| Objetivo | La pieza central de todo el plan: una orden de texto libre a Hokage se convierte en reparto real de trabajo entre agentes, respetando niveles de autonomía. Con esto en pie, se completa la decisión de producto: el chat directo por agente (degradado desde la Fase 10) se retira del todo — cualquier intervención sobre un agente pasa por aquí (§0, punto 6). |
| Resultado visible esperado | Escribir una orden en la barra de Hokage (Fase 6) o en su sala produce un plan visible ("qué agentes participarán, qué haría primero"), despacha trabajo real, y las pestañas de chat directo desaparecen de `BuildingView`/`AgentPanel`. |
| Componentes a crear/modificar | Servicio nuevo (`hokageOrchestrator.ts` o equivalente); `GameHUD.tsx`/panel de Torre Hokage (muestran el plan despachado); `BuildingView.tsx`/`AgentPanel.tsx` (retiran la pestaña de chat por agente). |
| Backend necesario | Sí, íntegro — no existe hoy ningún orquestador. |
| APIs necesarias | `POST /api/hokage/command`. |
| Tipos/contratos necesarios | Plan de Hokage (fases/agentes asignados) — forma similar a `ObjPlan`, reutilizable como referencia de diseño, no como código compartido forzado. |
| Realtime/eventos necesarios | Reutiliza WS/bus para reflejar el progreso del plan a medida que se ejecuta. |
| Datos necesarios | Ninguna tabla nueva — reutiliza `work_items`/`Decision` explícitamente, tal como ya lo fija el Master Roadmap ("sin modificarlos"). |
| Assets necesarios | Ninguno. |
| Sonidos necesarios | Ninguno (notificación sonora de mensaje de Hokage sigue no programada). |
| Dependencias con fases anteriores | Fase 11 (niveles de autonomía) y Fase 13 (`ContextComposer`) — ambos prerrequisitos explícitos en el Master Roadmap. |
| Criterio de validación | Una orden de texto libre produce un plan visible, reparte trabajo real verificable en `work_items`, y respeta los niveles de autonomía de la Fase 11 (una acción Nivel 3 se detiene a esperar aprobación, una Nivel 1 se ejecuta y se reporta). |
| Qué NO debe tocarse | `agentRuntime.ts` (las 8 etapas) — el orquestador despacha *a través* de `work_items`/`createWorkItem()`, nunca crea un segundo camino de ejecución (guardrail de la sección 4 de este documento). |
| Criterio de "terminado" | Igual al ya fijado en el Master Roadmap para C.5: una orden de texto libre produce un plan visible, reparte trabajo real, y respeta los niveles de autonomía. Adicionalmente aquí: cero superficies de chat directo por agente restantes en la UI. |

---

### Fase 15 — Sala de Reuniones

| Campo | Detalle |
|---|---|
| Objetivo | Visualización especializada de la colaboración real entre agentes (§0, puntos 4 y 8), sin exponer razonamiento interno. |
| Resultado visible esperado | Una sala nueva mostrando actividad agrupada de `messages`/`work_items`/`decisions` recientes entre 2+ agentes — quién habló, cuándo, sobre qué tarea, qué decisión salió — con representación visual de los agentes implicados. |
| Componentes a crear/modificar | Panel/sala nueva; capa visual sobre el ECS existente (agentes "reunidos" — nuevo `VisualKind`/`System` registrado, no un renderer aparte). |
| Backend necesario | Menor — endpoint de agregación. |
| APIs necesarias | `GET /api/rooms/reuniones/activity` (une `messages`+`work_items`+`decisions` por ventana de tiempo, reutiliza servicios existentes). |
| Tipos/contratos necesarios | Ninguno mayor — reutiliza `CommMsg`, `WorkItem`, `Decision` ya existentes. |
| Realtime/eventos necesarios | Reutiliza WS/bus — los eventos que alimentan esta sala ya se emiten hoy vía `automations`. |
| Datos necesarios | Ninguno nuevo. |
| Assets necesarios | Escena visual de agentes agrupados — nueva, pero como composición de assets ya existentes en el ECS (tokens, glow), no un sistema de assets aparte. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Fase 7 (departamentos tipados, para encajar como un tipo de sala más). No depende técnicamente de la Fase 14, aunque tiene afinidad temática con el trabajo de intervención por agente. |
| Criterio de validación | El panel muestra actividad real verificable contra `messages`/`work_items`/`decisions`; ningún campo mostrado contiene texto que se pueda confundir con razonamiento crudo del modelo — revisión explícita de qué campos se exponen antes de dar la fase por cerrada. |
| Qué NO debe tocarse | No crear una tabla `Meeting` nueva (confirmado innecesario en §0, Conflicto C); no añadir chat entre agentes ni de Jorge hacia varios agentes a la vez — la intervención sigue pasando por Hokage (Fase 14). |
| Criterio de "terminado" | La sala existe, muestra datos reales agrupados, y pasa la revisión explícita de no exponer razonamiento interno. |

---

### Fase 16 — Registry completo de tipos de departamento + Editor del mapa

| Campo | Detalle |
|---|---|
| Objetivo | Completar D.4 (Registry de N tipos reutilizables, no solo la distinción binaria de la Fase 7) y construir el modo de edición visual sobre el motor de paneles ya persistente. |
| Resultado visible esperado | Botón "Editar mapa" con modo visualmente diferenciado; crear/mover/configurar salas desde la UI sin escribir código; un departamento nuevo se instancia desde un tipo, no se programa. |
| Componentes a crear/modificar | `registries/DepartmentTypeRegistry.ts` (o nombre equivalente), `BuildingView.tsx` (deja de usar `BASE_SECTIONS` fijo, lee del tipo), modo de edición en `GameLayout.tsx`/`WorldCanvas.tsx` (interacción de arrastre, sobre el motor de la Fase 4/5). |
| Backend necesario | Ampliar `departments.type` (Fase 7) a un catálogo abierto de tipos con sus paneles/widgets declarados. |
| APIs necesarias | Ampliar `PUT/POST /api/departments`. |
| Tipos/contratos necesarios | `DepartmentTypeDefinition` (paneles, widgets, herramientas relevantes por tipo). |
| Realtime/eventos necesarios | Ninguno nuevo. |
| Datos necesarios | Catálogo de tipos (dato, no código). |
| Assets necesarios | Cursor/indicador visual de modo edición — menor. |
| Sonidos necesarios | Ninguno. |
| Dependencias con fases anteriores | Fase 5 (motor de paneles persistente), Fase 7 (slice mínimo ya en producción). |
| Criterio de validación | Dos departamentos de tipos distintos muestran paneles genuinamente distintos sin código condicional por rol; mover/redimensionar una sala persiste sin recargar. |
| Qué NO debe tocarse | La niebla/reveal de "La Fundación" — sigue explícitamente fuera de alcance (decisión ya tomada, documentada en `Roadmap.md`); esta fase no la reabre. |
| Criterio de "terminado" | Un click accidental en modo normal no modifica la estructura del mundo (regla explícita de `UI Vision Master §6`); crear una sala nueva no requiere escribir código. |

---

## Fases de implementación

1. Fase 1 — Consolidar el sistema de diseño
2. Fase 2 — Persistencia del Event Bus (`event_log`)
3. Fase 3 — `venture_id` estructural
4. Fase 4 — Motor de paneles: Registry interno
5. Fase 5 — Motor de paneles: persistencia en backend
6. Fase 6 — Barra superior: notificaciones accionables + acceso a Hokage
7. Fase 7 — Departamentos tipados: slice mínimo
8. Fase 8 — Hermes: retirar chat, Panel de Sistema
9. Fase 9 — Paneles de sala de bajo riesgo (Banco, Labs Uchiha, Sala de Diseños base)
10. Fase 10 — Panel universal de agente (versión operativa)
11. Fase 11 — Niveles de autonomía (0-3)
12. Fase 12 — Memory System v3
13. Fase 13 — `ContextComposer`
14. Fase 14 — Orquestador de Hokage + retirada final del chat directo
15. Fase 15 — Sala de Reuniones
16. Fase 16 — Registry completo de departamentos + Editor del mapa

**Deliberadamente fuera de esta secuencia** (ya documentado en las 17 secciones más arriba, ninguna novedad aquí): Sistema de Conocimiento/C.4 (sección 6, v2.0), Sonido (sección 15, no programado), Tiendas/Etsy real (sección 8, bloqueado por integración externa).

---

## Dependencias

```
Fase 1 (diseño)
   │
   ├────────────┬──────────────┐
   ▼            ▼              ▼
Fase 4      Fase 2         Fase 3
(Registry)  (event_log)    (venture_id)
   │                            │
   ▼                            ▼
Fase 5                     Fase 12 (Memory)
(persistencia)                  │
   │                            ▼
   ├────────────┐          Fase 13 (ContextComposer)
   ▼            ▼               │
Fase 6       Fase 7              │
(barra)   (deptos: slice)        │
              │                  │
   ┌──────────┼──────────┐       │
   ▼          ▼          ▼       │
Fase 8     Fase 9    Fase 15     │
(Hermes)  (paneles)  (Reuniones) │
              │                  │
              ▼                  │
          Fase 10                │
      (panel de agente)          │
              │                  │
              ▼                  │
          Fase 11                │
        (autonomía)              │
              │                  │
              └────────┬─────────┘
                        ▼
                    Fase 14
              (Orquestador Hokage)
                        │
                        ▼
                    Fase 16
           (Registry completo + Editor)
```

**Bloqueos duros (no se puede empezar sin la anterior):**
- Fase 5 ← Fase 4 (necesita el Registry antes de decidir qué persistir).
- Fase 13 ← Fase 12 + Fase 3 (Memory System da la capa de Departamento/Agente; venture_id es prerrequisito del propio Memory System).
- Fase 14 ← Fase 11 + Fase 13 (ambos prerrequisitos explícitos del Orquestador en el Master Roadmap).
- Fase 8 ← Fase 7 (necesita `departments.type` para reclasificar sin condicionales dispersos).
- Fase 16 ← Fase 5 + Fase 7.

**Dependencias blandas (recomendadas, no bloqueantes):**
- Fases 6, 9, 10, 15 se apoyan en el motor de paneles (Fases 4/5) por consistencia, pero podrían construirse con el patrón ad-hoc actual si hiciera falta adelantarlas.
- Fase 9 mejora con la Fase 2 (timeline fiable) pero no la necesita para funcionar.
- Fase 15 solo depende técnicamente de la Fase 7; se sitúa tarde en la secuencia por afinidad temática con la Fase 14, no por bloqueo real.

**Paralelizable de verdad, confirmado por el propio Master Roadmap:** Fases 2 y 3 pueden hacerse en cualquier orden entre sí y en paralelo con la Fase 1; Fases 6, 7, 9 pueden solaparse una vez completada la Fase 5.

---

## Riesgos

- **Romper el patrón "el mapa nunca se desmonta"** al construir el Registry de paneles (Fases 4-5) — verificación manual explícita exigida en el criterio de validación de la Fase 4, antes de avanzar a la Fase 5.
- **Tocar `agentRuntime.ts` sin necesidad** en la Fase 14 — el Orquestador debe despachar *a través* de `work_items`, nunca duplicar el mecanismo (guardrail, sección 4).
- **Retirar el chat directo por agente antes de tiempo** — por eso la Fase 10 lo *degrada* (deja de ser la pestaña por defecto) en vez de retirarlo, y la retirada completa espera explícitamente a la Fase 14.
- **Que la Sala de Reuniones (Fase 15) exponga por accidente contenido equivalente a razonamiento interno** — criterio de validación de esa fase incluye una revisión explícita de campos antes de cerrarla.
- **Simular datos de Tiendas con ingresos reales** — ninguna fase de esta secuencia lo permite; Tiendas queda fuera de esta secuencia por diseño.
- **Reintroducir un `setInterval` por agente nuevo** en la Fase 15 (agentes agrupados visualmente) — debe usar el `MovementSystem`/ECS existente, no un timer nuevo.
- **Migrar la tabla `agents` para sacar a Hermes (B.1 del Master Roadmap) sin necesidad real** — deliberadamente excluido de esta secuencia (ver Fase 8); es de mayor riesgo que su beneficio inmediato justifica ahora mismo.

---

## Primera fase

Cuando se autorice implementar, esto es exactamente lo que debería hacerse — **Fase 1, Consolidar el sistema de diseño**:

1. **Confirmar el estado exacto** (ya hecho en la sección 3 de este documento — no repetir la investigación, partir de ahí): tres fuentes compitiendo (`styles.css`, `design/tokens.ts`, `shared/ui.tsx` resolviendo inline) más 4 archivos con hex sueltos.
2. **Decidir una vez, no dejar ambigüedad:** `styles.css` (CSS custom properties) es la fuente real — es la que ya renderiza en producción a través de `shared/ui.tsx` y de los estilos inline de `GameLayout.tsx`/`GameHUD.tsx`. `design/tokens.ts` se retira o se convierte en un simple re-export tipado de los mismos valores para uso en TypeScript donde un string CSS no sirva (p. ej. cálculos numéricos para PixiJS) — nunca una copia mantenida a mano.
3. **`design/components/*`**: dado que su único consumidor es `main.tsx`/`/design-preview`, decidir si esa ruta de preview se conserva (y entonces esos componentes se migran a usar la fuente única del paso 2) o se retira junto con ellos si ya no aporta valor de desarrollo.
4. **Reemplazar los hex sueltos** en `GameLayout.tsx`, `shared/constants.ts` (`BUILDINGS`), `panels/StatsPanel.tsx`, `views/ObjectivesView.tsx` por referencias a la fuente única — sin cambiar ningún valor de color, solo su origen.
5. **Verificar `BUILDINGS` sigue siendo necesario como fallback** en `useWorldState.ts` antes de tocarlo — no eliminarlo, solo dejar de duplicar su color.
6. **Compilar** (`npx tsc --noEmit` en frontend) y **verificar visualmente** (captura antes/después en Mapa, una sala cualquiera, un overlay) que no hay ninguna diferencia perceptible.
7. **Commit** siguiendo la convención ya establecida en el proyecto (mensaje descriptivo en español, un módulo completo por commit).

No debe tocarse en esta fase: ningún archivo de `world/` (su paleta vive aparte en `world/visuals/palette.ts`, numérica para PixiJS, fuera de alcance), ningún archivo de `backend/`, ningún comportamiento de negocio.

---

Me detengo aquí. No se ha modificado ningún archivo de código ni configuración — solo se ha actualizado este documento.
