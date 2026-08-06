> Categoría: auditoría de arquitecto, no una decisión congelada
> Estado: 🆕 Nuevo — hallazgos verificados contra código real, ninguno implementado todavía
> Metodología: research paralela de 3 subagentes de solo-lectura (backend, frontend fuera de `world/`, seguridad) con evidencia `file:line`, más auditoría directa del World Engine/ECS (recién migrado en 6 fases el mismo día, por eso auditado a mano y no delegado)

---

## Veredicto

**Nota: 6.5/10.** Sólido donde se ha invertido rigor real (Event Bus/Runtime, esquema de datos, separación básica de secretos, y sobre todo el [[Plan de Migración ECS|World Engine/ECS]] — el trabajo mejor ejecutado del proyecto a día de hoy). Débil donde la especificación se adelantó al código: tres sistemas completos existen solo como diseño (Memoria, Secretos/Capabilities, Plugins), hay duplicación de diseño/paleta real en frontend, y dos huecos de seguridad de bajo coste de cierre.

- **% del núcleo terminado:** ~70% (motor de agentes + datos + Event Bus + mapa, ponderado). ECS del mapa ~95% (quedan Fases 7-9).
- **% que falta para base sólida:** ~25-30% adicional, y no es features nuevas — es cimentación.

---

## Backend

**Problemas de diseño:**
- 44 endpoints en un único `server.ts` de 873 líneas — lógica de negocio a veces vive en el handler HTTP directamente (`generateObjectivePlan`, `server.ts:619-671`), sin servicio propio.
- Doble camino de notificación WebSocket, divergente: `PUT /api/decisions/:id/approve` publica al bus *y* hace `broadcast()` manual; `POST /api/decisions` solo hace `broadcast()` — una decisión creada por HTTP nunca entra al Event Bus.
- Modelo hardcodeado con typo respecto a la config real: `agentModels.ts` documenta `claude-haiku-4.5` (con punto); `aiService.ts:204` y `server.ts:648` hardcodean `claude-haiku-4-5` (con guion).
- FK colgante en instalación nueva: `work_items`/`agent_costs` siguen creándose con referencia a `businesses(id)`, tabla ya eliminada — solo se repara en BDs existentes vía migración, no en una instalación desde cero.
- **`sqlite3` (async/callback), no `better-sqlite3`** — CLAUDE.md global dice explícitamente lo segundo; discrepancia entre documentación oficial y código real.

**Cuellos de botella futuros:** Runtime de poll único de 10s, documentado por el propio proyecto con techo en "un par de docenas de agentes activos" (ver [[ADR-002 - Agent Runtime]]). Recarga la lista completa de agentes 3x por tick, escaneo O(n) por lookup. Event Bus con historial acotado en memoria (100 eventos) pero sin persistencia — un crash pierde todo lo no volcado a tabla de dominio.

**Deuda spec-vs-código (ya documentada por el propio proyecto, confirmada aquí):** Memory System (ADR-004), Secretos/Capabilities (§11.2) y Plugin System (§8.6) existen solo como diseño — cero tablas, cero loader.

## Frontend (fuera de `world/`)

- **Dos sistemas de diseño paralelos, uno muerto:** `src/design/components/*` no lo usa ninguna vista real (solo un preview oculto); la app real usa `shared/ui.tsx`, que reimplementa lo mismo con otro nombre.
- **Paleta en 4 sitios sin sincronía automática** — el propio código lo admite en comentario (`design/tokens.ts:1-2`): `styles.css`, `design/tokens.ts` (copia manual), `shared/constants.ts`, y ~15 hex sueltos solo en `ObjectivesView.tsx`.
- **`GameLayout.tsx` (441 líneas) es el compositor único** — cada panel es un `<div>` con clase CSS de posición fija. Cero motor de layout, cero drag/resize, cero persistencia de preferencias de usuario.
- **Deriva de tipos confirmada:** `frontend/shared/types.ts`'s `Agent` ya no tiene `venture_id`/`capabilities`, que sí existen en `backend/src/types/index.ts` — sin paquete compartido, tipos copiados a mano.
- **Buena noticia real:** frontera de PixiJS limpia — `pixi.js` no se importa fuera de `world/`; el resto de la app consume `<WorldCanvas>` como caja opaca, solo comparte tipos planos.

## World Engine / ECS — auditado directamente

Migración incremental Strangler Fig en 6 fases, cada una con revisión técnica, `tsc` limpio, smoke test. Una deuda técnica real se detectó y cerró en el momento (doble ejecución de `TTLSystem`/`ParticleSystem` por registrarlos innecesariamente vía `ecs.addSystem()`) y la lección se aplicó preventivamente en `CameraSystem`/`SelectionSystem`. Deuda conocida y ya documentada: `useWorldState.ts` mantiene un `setInterval` por agente (mismo antipatrón que el backend ya rechazó una vez); `ctx.elapsedSec` es contador de frames, no tiempo real (inofensivo mientras nada lo use); `WorldEngine.ts` legacy vivo sin uso hasta la Fase 9.

## Seguridad

| Área | Veredicto |
|---|---|
| API Keys/secrets | ✅ PASS — sin hardcodeo, `.env` gitignored, nunca commiteado |
| `.gitignore` | ✅ PASS — incluye el incidente previo de `.obsidian/`, nunca commiteado |
| Permisos/autorización | ⚠️ CONCERN — WebSocket sin autenticación alguna; `httpServer.listen()` sin host fijo → escucha en `0.0.0.0`; `ADMIN_TOKEN` también expuesto en el bundle cliente (`VITE_ADMIN_TOKEN`) |
| Auditoría/trazabilidad | ✅ PASS (con matiz) — `decisions`+`agent_runs`+`exec_runs` dan reconstrucción razonable; tabla `audit_logs` dedicada pero infrautilizada |
| Separación frontend/backend | ✅ PASS — frontend nunca llama a OpenRouter directo |
| Dependencias | ✅ PASS — nada desactualizado en ninguno de los dos `package.json` |

## Recomendación priorizada

1. Arreglar los 3 bugs reales encontrados (modelo hardcodeado, doble notificación WS, FK colgante) — bajo esfuerzo, riesgo silencioso.
2. Cerrar los 2 huecos de seguridad (bind a `127.0.0.1`, autenticar WebSocket).
3. Consolidar paleta/diseño en una única fuente — precondición para temas/editor visual.
4. Motor de layout mínimo para paneles — precondición para paneles dinámicos.
5. Cerrar Fases 7-9 del [[Plan de Migración ECS]] antes de construir el editor de mapa encima.
6. Memoria/Secretos/Plugins — cada uno como mini-fase de cimentación con alcance v1 explícito, no la spec completa ya existente en la bóveda.

Estas seis recomendaciones quedan reforzadas y en algunos casos convertidas en bloqueantes directos por la [[Redefinición de Principios Fundamentales - 2026-08-06|redefinición de principios fundamentales]] posterior a este documento.

## Relacionado

- [[Redefinición de Principios Fundamentales - 2026-08-06]]
- [[Plan de Migración ECS]]
- [[ADR-002 - Agent Runtime]]
- [[ADR-003 - Event Bus]]
- [[ADR-004 - Memory System]]
- [[ADR-005 - Tool Runtime y Plugin Contract]]
- [[Gestión de Secretos y Capabilities]]
- [[Escalabilidad]]
- [[INDEX]]
