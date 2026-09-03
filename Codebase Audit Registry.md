# Codebase Audit Registry — Hokage OS

> Registro vivo de código activo, legacy, duplicado, stubs, dependencias sin uso, APIs/tablas/componentes sin consumidores, archivos eliminables y deuda técnica.
> Generado: 2026-08-09, contrastado línea por línea contra el código real (`backend/src/`, `frontend/src/`) — no es una suposición sobre el estado del proyecto.
> **No se ha eliminado ni modificado nada.** Este documento es solo de lectura hasta que se decida explícitamente qué hacer con cada elemento.

---

## Cómo leer este registro

Cada elemento indica:
- **Qué es** — descripción concreta.
- **Quién lo usa** — importadores/consumidores reales, verificados por `grep`.
- **Reemplazo** — si existe algo que ya cubre su función.
- **Fase de eliminación** — en qué fase de `UI Implementation Plan.md` (1-16) o `Master Roadmap - v1` (A-G, vault) encajaría, o "no asignada" si no hay ninguna todavía (en cuyo caso, por la regla ya fijada en ambos documentos, debe añadirse ahí antes de tocarse).
- **Riesgo de eliminar** — bajo/medio/alto, con el motivo.

---

## 1. Código activo (resumen, no exhaustivo)

Para dar contexto al resto del registro — estos subsistemas están verificados como reales y en uso, no se listan en detalle porque no son el objeto de esta auditoría:

- **Backend**: `server.ts` (todas las rutas salvo las listadas en §6), `agentRuntime.ts` (scheduler de 8 etapas), `aiService.ts` (tool-calling real vía OpenRouter), `eventBus.ts`, `tools/registry.ts` + `tools/index.ts` (salvo los 3 stubs de §4), todos los `services/*` salvo lo señalado en §10.
- **Frontend**: `GameLayout.tsx`/`GameHUD.tsx`/`BuildingView.tsx`, todo `world/` (ECS, sistemas, registries, visuals — confirmado sin duplicación tras revisar `WorldEngineBridge.ts` vs `world/ecs/WorldEngine.ts`), todos los paneles salvo lo señalado abajo, `hooks/useAppData.ts` y `useWorldState.ts` como única fuente de estado de cliente.

---

## 2. Código legacy

| Elemento | Qué es | Quién lo usa | Reemplazo | Fase de eliminación | Riesgo |
|---|---|---|---|---|---|
| `backend/src/tools/ai-bridge.ts` | Función `toolsToFunctionSchemas()` — intento anterior de convertir tools a function-schemas para el LLM. Tiene un bug real: hardcodea `properties: {}, required: []` para cada tool, descartando el `inputSchema` real. | **Nadie** — cero imports en todo el repo (verificado por `grep`). | `aiService.ts::toolToOpenRouterSchema()` — hace lo mismo, correctamente, y es lo que de verdad se usa en el loop de function-calling. | No asignada — candidato directo para Fase A del Master Roadmap (limpieza), o eliminación inmediata al no depender de nada. | Bajo — cero importadores, `tsc --noEmit` lo confirmaría al instante si algo dependiera de él. |
| `frontend/src/shared/TopBar.tsx` | Componente de barra superior, versión anterior a `GameHUD.tsx`. | **Nadie** — cero usos de `<TopBar` en JSX en todo el frontend. Solo aparece re-exportado (sin consumir) en `shared/index.ts`. | `GameHUD.tsx` — es el que `GameLayout.tsx` renderiza de verdad hoy. | Fase 6 de `UI Implementation Plan.md` (se está ampliando `GameHUD.tsx` ahí) — buen momento para confirmar que `TopBar.tsx` no se necesita y retirarlo en el mismo commit. | Bajo — sin consumidores confirmado. |
| `frontend/src/views/index.ts` | Barrel que re-exporta las 9 vistas. | **Nadie** — cero `from '../views'`/`from './views'` en todo el repo; cada vista se importa directamente desde su archivo (p. ej. `GameLayout.tsx` hace `import { BuildingView } from './BuildingView'`). | El patrón de import directo ya en uso en todo el proyecto. | No asignada — trivial, se puede retirar en cualquier fase sin coordinación. | Bajo. |

---

## 3. Código duplicado

| Elemento | Qué es | Quién lo usa | Reemplazo | Fase de eliminación | Riesgo |
|---|---|---|---|---|---|
| `BUILDINGS` (`shared/constants.ts`) vs `seedDepartments()` (`backend/src/db/init.ts`) | Los mismos 6 colores/nombres de sala están escritos a mano en frontend (fallback antes de cargar `/api/departments`) y en el seed del backend. | `BUILDINGS`: fallback en `useWorldState.ts`. `seedDepartments()`: siembra inicial de la BD. | Ninguno posible hoy sin tocar `world/` — `BUILDINGS.color` alimenta `Number(color.replace('#','0x'))` para PixiJS, no puede ser dinámico sin cambiar ese contrato. Ya documentado y aceptado explícitamente en el commit de la Fase 1 (`refactor(ui): consolidate visual design system`). | No asignada — solo sería resoluble si el frontend dejara de necesitar un fallback síncrono antes de la primera respuesta de red, lo cual es un cambio de arquitectura, no de limpieza. | Medio si se toca sin querer — romper esto deja el mapa sin colores hasta que carguen los departamentos reales. |
| `ROLE_COLOR` (`ObjectivesView.tsx`) | Mapa de color por rol, valores idénticos a los de `BUILDINGS`/`seedDepartments()` para 4 de los 7 roles (investigador/trafico/finanzas/ceo), distinto para 3 (contenido/operaciones/soporte usan hex propios). | Solo `ObjectivesView.tsx`, para el borde de cada milestone. | Parcial — ya se intentó en la Fase 1 y se revirtió a propósito: el código concatena `` `${roleColor}33` `` para el alfa del borde, lo que rompe con `var()`. Documentado con comentario en el propio archivo. | No asignada — requeriría cambiar el mecanismo de alfa (p. ej. `color-mix()` en CSS moderno) para poder unificar sin regresión visual; no vale la pena solo por esto. | Medio — cualquier intento de "limpiar" esto sin cambiar el mecanismo de alfa rompe el borde visualmente (ya verificado en la Fase 1). |

---

## 4. Stubs

| Elemento | Qué es | Quién lo usa | Reemplazo | Fase de eliminación | Riesgo |
|---|---|---|---|---|---|
| `EtsyTool` (`backend/src/tools/index.ts`) | `status: 'stub'`, `execute()` devuelve siempre `{ ok: false, error: 'EtsyTool no implementado: requiere MCP o API key.' }`. | Registrado en `tools/registry.ts`; invocable por el rol `trafico`/`investigador` si el LLM decide llamarlo, siempre falla con el error explícito. | Se convierte en real en **F.2** del Master Roadmap (Etsy real, v2.0), tras **F.1** (loader de plugins) y **C.6** (Secret Management). | No se elimina — se completa. Explícitamente prohibido simular datos reales mientras tanto (`HOKAGE_CORE_SPECIFICATION_v1.md §13`). | — |
| `ShopifyTool` | Igual patrón que `EtsyTool`. | Igual. | Fase 5 del roadmap viejo (`Roadmap.md`) / no priorizado en Master Roadmap todavía. | No se elimina — se completa cuando haya negocio real en Shopify. | — |
| `PrintifyTool` | Igual patrón. | Igual. | No programado explícitamente en ningún documento vigente. | No se elimina — mismo criterio. | — |

---

## 5. Dependencias sin uso

| Elemento | Qué es | Quién lo usa | Reemplazo | Fase de eliminación | Riesgo |
|---|---|---|---|---|---|
| `zod` (`backend/package.json`) | Librería de validación de esquemas, declarada en dependencies. | **Nadie** — cero `import` de `zod` en todo `backend/src` (verificado). | Ninguno necesario — no hay validación de payloads con schema hoy (las rutas validan a mano, p. ej. `if (!title?.trim())`). | No asignada — candidato de limpieza de Fase A del Master Roadmap (junto a la ya resuelta de `bcrypt`/`jsonwebtoken`, confirmado que esos dos **ya no están** en `package.json`, ese ítem de deuda ya se cerró). | Bajo — `npm uninstall zod` no rompe nada verificable hoy. |

---

## 6. APIs sin consumidores (desde el frontend)

Verificado cruzando cada ruta de `server.ts` contra `frontend/src/shared/api.ts` (único punto de llamadas HTTP del frontend, confirmado — cero `fetch()` fuera de ese archivo).

| Endpoint | Qué es | Quién lo usa | Reemplazo/razón | Fase de eliminación | Riesgo |
|---|---|---|---|---|---|
| `POST /api/agents` | Crear agente. | Nadie desde frontend. | Se consumirá cuando exista el flujo "Añadir agente" — sección 12 de `UI Implementation Plan.md`, sin fase asignada todavía. | No eliminar — es la API de un flujo pendiente de construir, no código muerto. | — |
| `POST /api/decisions` | Crear decisión manualmente. | Nadie desde frontend — las decisiones las crean agentes/tools server-side (`decision.create` tool, `agentRuntime.ts`). | Ninguno necesario — es correcto que Jorge no cree decisiones a mano. | No aplica. | — |
| `POST /api/messages` | Crear mensaje manualmente. | Nadie desde frontend — los mensajes los crea el pipeline (`automations`, `agentRuntime.ts`). | Ninguno necesario. | No aplica. | — |
| `POST /api/departments` | Crear departamento. | Nadie desde frontend. | Se consumirá en el Editor del mapa — Fase 16 de `UI Implementation Plan.md`. | No eliminar — API de un flujo pendiente. | — |
| `POST /api/assets` | Crear asset. | Nadie desde frontend. | Sin flujo de UI definido todavía en ningún documento. | No asignada. | Bajo si se retira, pero no hay motivo — es barata de mantener. |
| `PATCH /api/ventures/:id` | Actualizar venture. | Nadie desde frontend — ni siquiera `VenturesView.tsx` la usa. | Sin flujo de UI definido. | No asignada. | Bajo. |
| `GET /api/events` (requiere admin) | Devuelve historial del bus. | Nadie desde frontend — el frontend recibe eventos por WebSocket en vivo, no por polling REST. | El propio WebSocket ya cubre la necesidad. | No asignada — podría retirarse sin impacto, o conservarse como utilidad de debug/curl. | Bajo. |
| `GET /api/health` | Salud del proceso + estado runtime + nº de clientes WS. | Nadie desde frontend. | **No es código muerto** — está pensado para monitorización externa (ver `Deployment & Migration Plan.md`, health checks de PM2/VPS). | No aplica — se usará en producción, no en el frontend. | — |

---

## 7. Tablas sin consumidores

Verificado: cada tabla de `db/init.ts` cruzada contra `grep` de su nombre en el resto de `backend/src` (fuera del propio `db/init.ts`).

| Tabla | Qué es | Quién la usa | Reemplazo | Fase de eliminación | Riesgo |
|---|---|---|---|---|---|
| `projects` | `CREATE TABLE IF NOT EXISTS projects` — "iniciativa con objetivo y plazo dentro de un Venture" (comentario original). | **Nadie** — cero `INSERT`/`SELECT` en todo el backend, cero ruta en `server.ts`. | El Goal System (`objectives`/`obj_plans`/`obj_milestones`) terminó cubriendo ese concepto de forma distinta y sí está implementado. | No asignada — candidato a `DROP TABLE` en una futura limpieza de schema (Fase A del Master Roadmap, mismo tipo de limpieza que ya hizo el commit "Borra las 8 tablas legacy"). | Bajo si está vacía (verificar antes con `SELECT COUNT(*)`); si tiene filas de una sesión antigua, hacer backup antes de dropear. |
| `tool_runs` | `CREATE TABLE IF NOT EXISTS tool_runs` — pensada para loguear ejecuciones de tools. | **Nadie** — cero `INSERT`/`SELECT` fuera de su propio `CREATE TABLE`. | Ninguno — el registro real de uso de tools hoy vive disperso en `agent_costs`/`agent_runs`, no en esta tabla. | No asignada. | Bajo. |
| `agent_feedback` | `CREATE TABLE IF NOT EXISTS agent_feedback` — feedback estructurado sobre decisiones de un agente. | **Nadie** — cero `INSERT`/`SELECT` fuera del schema. Ya señalada como huérfana en `UI Implementation Plan.md` sección 6 (Sala de Diseños, "aprendizaje"). | Se activaría con el flujo de feedback de §12.4/§12.5 de `UI Vision Master.md` — depende de **C.4** (Sistema de Conocimiento), no programado todavía. | No eliminar — tiene un consumidor futuro ya identificado en el plan de UI. Distinto caso de `projects`/`tool_runs`. | — |
| `RevenueStream` (tipo, no tabla) | Interfaz TypeScript en `types/index.ts` — la tabla `revenue_streams` que le correspondería **nunca se creó** en `db/init.ts` (solo queda un comentario de sección, `═══════════ REVENUE_STREAMS ═══════════`, sin `CREATE TABLE` debajo). | **Nadie** — el tipo no se importa en ningún archivo. | Ninguno — es un tipo vestigial de un diseño que no llegó a implementarse. | No asignada — se puede borrar el tipo sin ningún riesgo (no hay tabla ni lógica detrás). | Ninguno. |

---

## 8. Componentes sin consumidores

(Se listan aquí por completitud — coinciden con los ya identificados en §2 "Código legacy", que es la causa de que no tengan consumidores.)

| Componente | Quién lo usa | Fase de eliminación | Riesgo |
|---|---|---|---|
| `frontend/src/shared/TopBar.tsx` | Nadie (ver §2). | Fase 6 de `UI Implementation Plan.md`. | Bajo. |
| `frontend/src/views/index.ts` (barrel) | Nadie (ver §2). | No asignada, trivial. | Bajo. |

---

## 9. Archivos que podrán eliminarse

Consolidado de §2/§3/§7/§8 — lista única para ejecutar cuando se autorice:

| Archivo/tabla | Motivo | Acción propuesta | Fase |
|---|---|---|---|
| `backend/src/tools/ai-bridge.ts` | Cero importadores, función con bug, superseded por `aiService.ts`. | Borrar archivo. | No asignada — bajo riesgo, se puede hacer en cualquier momento. |
| `frontend/src/shared/TopBar.tsx` | Cero uso en JSX, superseded por `GameHUD.tsx`. | Borrar archivo + su export en `shared/index.ts`. | Fase 6 de `UI Implementation Plan.md`. |
| `frontend/src/views/index.ts` | Barrel sin importadores. | Borrar archivo. | No asignada. |
| `projects` (tabla) | Sin consumidores, concepto cubierto por Goal System. | `DROP TABLE` vía migración explícita (verificar filas antes). | No asignada — Fase A del Master Roadmap. |
| `tool_runs` (tabla) | Sin consumidores. | `DROP TABLE` vía migración explícita. | No asignada — Fase A del Master Roadmap. |
| `RevenueStream` (tipo) | Tabla asociada nunca se creó. | Borrar la interfaz de `types/index.ts`. | No asignada, trivial. |
| `zod` (dependencia) | Sin imports. | `npm uninstall zod` en `backend/`. | No asignada — Fase A del Master Roadmap. |

**No incluidos aquí a propósito** (tienen consumidor futuro identificado, no son basura): `EtsyTool`/`ShopifyTool`/`PrintifyTool`, `agent_feedback`, las APIs sin consumidor de §6 que sí tienen flujo de UI pendiente.

---

## 10. Deuda técnica

| Elemento | Qué es | Impacto | Fase de resolución | Riesgo de no resolverlo |
|---|---|---|---|---|
| `ToolContext.businessId` (`tools/base.ts`) | Campo declarado, nunca poblado ni leído — el campo real que viaja es texto libre `[VENTURE: nombre]` en el contexto del prompt. | Cualquier tool que intente leer `ctx.businessId` obtendría siempre `undefined`. | **A.5** del Master Roadmap ("Threading estructural de `venture_id`") — ya identificada ahí, esta auditoría solo la reconfirma contra el código actual. | Medio — bloquea Memory System v3 (C.1) hasta resolverse, ya documentado como prerrequisito. |
| `ToolContext.userId` / `ToolContext.requestId` | Campos declarados en la interfaz, cero código los puebla o los lee. | Ninguno hoy — son ruido en el contrato. | No asignada. | Bajo — limpiar la interfaz o implementarlos de verdad, cualquiera de las dos es válida. |
| `agents.capabilities` (columna BD + campo de tipo) | Columna `TEXT DEFAULT '[]'`, añadida por migración, nunca leída ni escrita fuera de la migración misma. | Ninguno hoy. | No asignada — candidata a activarse cuando exista el Registry de herramientas por agente (Fase 10 de `UI Implementation Plan.md`, `GET /api/agents/:id/tools`) o a borrarse si ese endpoint termina leyendo `AGENT_TOOLS` en código en su lugar. | Bajo. |
| `deleteAgent()` (`agentService.ts`) | Función exportada, sin ninguna ruta HTTP que la invoque. | Ninguno — muerta pero inofensiva. | No asignada. | Bajo — o se conecta a una ruta `DELETE /api/agents/:id` real, o se borra. |
| Hermes sigue en la tabla `agents` | Contradice la decisión de producto ya tomada (Hermes = kernel, no agente) y el propio **B.1** del Master Roadmap, que lo marca como pendiente. | Cualquier `SELECT * FROM agents` sin filtrar lo trata como agente de negocio. | **Fase 8** de `UI Implementation Plan.md` resolvió la parte visible (sin chat, panel de sistema) **sin** tocar la tabla, a propósito — la migración de la tabla en sí sigue pendiente, marcada como fuera de alcance deliberadamente. | Medio — ya documentado y aceptado, no es un hallazgo nuevo. |
| 4 marcadores de texto (`[TENDENCIA:]`/`[CONTENIDO:]`/`[MEMORIA:]`/`[DECISION:]`) conviven con Tool Calling | El regex de compatibilidad sigue activo en `agentRuntime.ts` para los 4, aunque los 6 roles tool-capable ya no reciben la instrucción de usarlo. | Ninguno funcional — es red de seguridad. Para `operaciones`/`soporte` (Llama 3.1 8B, sin tool-calling fiable) es permanente por diseño, no deuda. | Ya documentado en `HOKAGE_CORE_SPECIFICATION_v1.md §16`: "retirarlo del todo... pendiente de datos de producción reales, no tomada en esta ronda". Esta auditoría confirma que sigue así. | Bajo — es deuda conocida y aceptada explícitamente, no accidental. |
| Discrepancia `sqlite3` vs `better-sqlite3` | `CLAUDE.md` (raíz del proyecto) documenta `better-sqlite3`; el código real usa `sqlite3` (async/callback). | Ninguno funcional — solo desalinea la documentación con la realidad. | **A.7** del Master Roadmap, ya identificada ahí: "decisión a tomar, no ejecutar a ciegas" — documentar o migrar el driver. | Bajo si se documenta; medio si se decide migrar sin necesidad real. |
| Cero tests automatizados en todo el repo | Verificado: `find . -iname "*.test.ts" -o -iname "*.spec.ts"` no devuelve nada. | Cualquier regresión se detecta solo por verificación manual (como en la Fase 1 de este plan). | No asignada explícitamente en ningún documento — señalado como riesgo conocido en la auditoría crítica de `HOKAGE_CORE_SPECIFICATION_v1.md §16` ("cero tests automatizados... deuda gestionable con disparador explícito"). | Medio a largo plazo — crece con cada fase nueva del `UI Implementation Plan.md`. |
| `listDecisions()`/`listAgents()`/`agent_runs` sin paginación | Las listas crecen sin límite (`ORDER BY id DESC` sin `LIMIT`), a diferencia de `messages` (que sí se poda a 500 filas / 30 días en `messageService.ts`). | Ninguno hoy con el volumen actual; ya señalado como riesgo conocido en la auditoría crítica del core spec. | No asignada. | Bajo hoy, crece con el uso real del sistema — mismo patrón que `messages` ya resuelve, aplicable cuando haga falta. |
| `npm run db:init` (`backend/package.json`) apunta a `src/scripts/init-db.ts`, que **no existe** — solo existe `src/scripts/seed.ts`. | Script de `package.json` roto — fallaría con "module not found" si alguien lo ejecuta. | Ninguno hoy (nadie lo ejecuta en el flujo real — `initSchema()` se llama automáticamente al arrancar `server.ts`). Relevante para `Deployment & Migration Plan.md`: no depender de este script en el pipeline de despliegue. | No asignada — corregir el nombre del script o crear el archivo que falta. | Bajo — descubierto al preparar el plan de despliegue, antes de que causara un fallo real en producción. |

---

## Resumen

- **3 archivos** listos para eliminar sin coordinación (`ai-bridge.ts`, `views/index.ts`, tipo `RevenueStream`), **1 archivo** con fase asignada (`TopBar.tsx` → Fase 6), **2 tablas** candidatas a `DROP` en limpieza de Fase A (`projects`, `tool_runs`).
- **1 dependencia** sin uso (`zod`).
- **7 endpoints** sin consumidor de frontend — 6 son APIs de flujos de UI todavía no construidos (correcto que no se usen aún), 1 (`GET /api/health`) es infraestructura de producción, no código muerto.
- **9 elementos de deuda técnica**: 8 ya identificados individualmente en documentos existentes (`Master Roadmap`, `HOKAGE_CORE_SPECIFICATION_v1.md`, `UI Implementation Plan.md`) — esta auditoría los confirma contra el código real del 2026-08-09 — y 1 hallazgo nuevo (script `db:init` roto), encontrado al preparar `Deployment & Migration Plan.md`.

No se ha eliminado ni modificado nada para producir este registro.
