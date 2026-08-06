> Categoría: plan de construcción — documento vigente de trabajo, no una decisión de arquitectura más
> Estado: 🆕 Nuevo — sustituye a [[Roadmap - Snapshot 2026-08-02]] como plan vigente
> Origen: sesión 2026-08-06, tras cerrar [[Especificación Funcional de Producto - v1]] y [[Redefinición de Principios Fundamentales - 2026-08-06]]
> Regla a partir de aquí: cualquier funcionalidad nueva debe encajar en una de las fases/entregas de este documento antes de implementarse. Si no encaja, se añade aquí primero — nunca se construye al margen.

---

## Cómo leer este documento

Este roadmap no diseña nada nuevo — **secuencia** lo que ya está decidido en tres fuentes, resolviendo dónde chocan:

1. **Lo ya congelado y listo para implementar** (ADRs 001-006, `HOKAGE_CORE_SPECIFICATION_v1.md` §5/§6/§8/§9/§11.2/§12): Memory System v3, Plugin System, Secret Management v2, Founder Profile v2, La Fundación/Wizard v2, Multi-Venture (parcialmente implementado), Hermes v2 §9.1.
2. **Lo verificado como deuda real contra el código actual** ([[Auditoría de Arquitectura - 2026-08-06]]): 3 bugs concretos, 2 huecos de seguridad, duplicación de diseño en frontend, sistemas spec-only.
3. **La redefinición de esta misma sesión** ([[Redefinición de Principios Fundamentales - 2026-08-06]] y [[Especificación Funcional de Producto - v1]]): Hermes como kernel puro, Hokage como única interfaz, contexto por capas, sistema de conocimiento, interfaz de escritorio, todo declarativo.

**Un choque real que este documento resuelve explícitamente, no en silencio:** `HOKAGE_CORE_SPECIFICATION_v1.md §9.1` (🔒 congelado) reactivó a Hermes como agente con nombre, sala y voz conversacional propia ("Jorge le pregunta cómo va todo y Hermes responde"). La [[Redefinición de Principios Fundamentales - 2026-08-06|redefinición de hoy]] (principio 1) dice lo contrario: sin personalidad, sin chat, no aparece como trabajador. Esto **no es una reapertura arbitraria** — es Jorge mismo redefiniendo el principio, la única autoridad que puede hacerlo sin violar la regla de "no reabrir sin problema arquitectónico real". La Fase B de este roadmap resuelve el choque conservando el mecanismo útil de §9.1 (`system.status`, reporte operativo real) y descartando el marco (agente conversacional).

Cada fase se divide en **entregas** — unidades de trabajo de 1 a 3 días, cada una en su propio commit, cada una dejando el proyecto compilando y funcionando. Ninguna entrega depende de "terminar toda la fase" para ser útil.

---

## Mapa de fases y dependencias

```
Fase A (Consolidación)
   │
   ├──────────────┬──────────────┐
   ▼              ▼              ▼
Fase B         Fase C         Fase D
(Runtime)      (IA)      (Sistema Operativo)
   │              │              │
   │   B.3 necesita un slice mínimo de D.4 ◄──┘ (dependencia cruzada real)
   │              │
   └──────┬───────┘
          ▼
     Fase E (Personalización)
          │
          ▼
     Fase F (Plugins)
          │
          ▼
     Fase G (Escalabilidad) ── G.1 (VPS) es v1.0 pese a estar aquí, ver tabla final
```

Fase A es la única con dependencia real de "todo antes de lo demás" — toca cimentación que B, C y D asumen resuelta. B, C y D pueden avanzar en paralelo entre sí, con una única dependencia cruzada real (B.3 ← D.4, explicada en su ficha). E depende de C (memoria) y D (departamentos tipados). F depende de C.6 (secrets) para credenciales reales. G es mayormente condicional a volumen real, salvo G.1.

---

## Fase A — Consolidación del núcleo

**Por qué primero:** ninguna pieza nueva (Runtime, IA, interfaz) debería construirse sobre bugs ya identificados, huecos de seguridad conocidos, o un refactor de frontend a medio cerrar. Esta fase no añade nada visible a Jorge — reduce riesgo silencioso antes de construir encima.

### A.1 — Corregir los 3 bugs reales de la auditoría
- **Objetivo:** eliminar divergencias silenciosas encontradas por evidencia directa de código.
- **Problema que resuelve:** modelo hardcodeado (`claude-haiku-4-5` en vez de leer `AGENT_MODELS`) puede causar fallos silenciosos de llamada; doble camino de notificación WS puede dejar una decisión creada por HTTP sin entrar nunca al Event Bus; la FK colgante a `businesses` rompe una instalación limpia.
- **Dependencias:** ninguna.
- **Riesgo:** bajo — cambios acotados, comportamiento actual ya roto en los tres casos.
- **Impacto:** alto en fiabilidad, cero en superficie de producto.
- **Duración aprox.:** 1 día.
- **Documentación afectada:** ninguna (son bugs, no decisiones de arquitectura).
- **Código que toca:** `aiService.ts`, `server.ts` (2 líneas de modelo), rutas de `decisions` (unificar a un único camino de notificación), `db/init.ts` (schema de instalación limpia de `work_items`/`agent_costs`).
- **Criterios de finalización:** los 3 hallazgos ya no reproducen; `npx tsc --noEmit` limpio; instalación desde cero sin FK colgante.
- **v1.0.**

### A.2 — Cerrar los 2 huecos de seguridad
- **Objetivo:** el backend deja de escuchar en todas las interfaces y el WebSocket exige el mismo token que el resto de la API.
- **Problema que resuelve:** hoy cualquier cliente en la misma red local recibe snapshot completo + stream en vivo sin autenticación; `ADMIN_TOKEN` viaja también al bundle del cliente.
- **Dependencias:** ninguna.
- **Riesgo:** bajo técnicamente; medio de producto si Jorge dependía sin saberlo del acceso LAN sin token — **confirmar con Jorge antes de aplicar**, no asumir.
- **Impacto:** alto — cierra la única superficie de exposición real encontrada.
- **Duración aprox.:** 1 día.
- **Documentación afectada:** [[Seguridad, Permisos y VPS]] (actualizar estado de WS auth).
- **Código que toca:** `server.ts` (`httpServer.listen(PORT, '127.0.0.1', ...)`, handshake de auth en `wss.on('connection')`), revisar `VITE_ADMIN_TOKEN` en el cliente.
- **Criterios de finalización:** WS rechaza conexión sin token válido; `netstat`/`lsof` confirma bind solo a loopback.
- **v1.0.**

### A.3 — Consolidar el sistema de diseño frontend
- **Objetivo:** una única fuente de tokens de diseño (color/tipografía/espaciado), un único set de componentes base.
- **Problema que resuelve:** `design/components/*` no lo usa ninguna vista real; paleta duplicada en 4 sitios sin sincronía (`styles.css`, `design/tokens.ts`, `shared/constants.ts`, hex sueltos en `ObjectivesView.tsx`).
- **Dependencias:** ninguna técnica — pero es **prerrequisito real de toda la Fase D** (no tiene sentido construir temas/layout sobre una base duplicada).
- **Riesgo:** bajo — es eliminar duplicación, no cambiar comportamiento.
- **Impacto:** alto para D, invisible para Jorge hoy.
- **Duración aprox.:** 2 días.
- **Documentación afectada:** ninguna nueva; consolida lo ya descrito en `frontend-design.md`.
- **Código que toca:** eliminar `design/components/*` (o fusionar en `shared/ui.tsx`, decidir una vez, no las dos), `design/tokens.ts` deja de ser copia manual, `shared/constants.ts` (`BUILDINGS`) deja de duplicar color de `departments`, hex sueltos de `ObjectivesView.tsx`.
- **Criterios de finalización:** una sola fuente de verdad de paleta verificable por grep; cero componentes duplicados con el mismo propósito.
- **v1.0.**

### A.4 — Cerrar el Plan de Migración ECS (Fases 7-9)
- **Estado: ✅ completado (2026-08-06).**
- **Objetivo:** terminar formalmente la migración ECS del World Engine iniciada esta sesión, antes de construir el editor de mapa/departamentos encima.
- **Problema que resolvió:** `WorldEngine.ts` legacy vivo sin uso; traducción de eventos sin tipar dentro de `useWorldState.ts`; posicionamiento de departamentos sin conectar a `position_locked`, ignorado en silencio por el frontend pese a que el backend ya lo enviaba.
- **Dependencias:** [[Plan de Migración ECS]] Fases 0-6 (completadas esta sesión).
- **Riesgo real:** bajo, confirmado — mismo patrón incremental ya validado 6 veces, sin sorpresas de compilación.
- **Impacto:** medio — prerrequisito técnico de D.4/D.6 (editor de mapa/departamentos), ya desbloqueado.
- **Duración real:** 1 sesión (las 3 fases juntas, no 3-4 días como se estimó — el patrón ya establecido en Fases 0-6 hizo cada una más rápida de lo previsto).
- **Documentación afectada:** [[Plan de Migración ECS]] (checklist de las 3 fases + cierre completo), [[INDEX]] (corrige además una validación de Fase 3 dada por hecha sin base real en una nota anterior).
- **Código que tocó:** `world/events/WorldCommand.ts` (reescrito, primera variante real), `world/events/EventAdapter.ts` (nuevo), `world/layoutEngine.ts` (nuevo, no `registries/DepartmentRegistry.ts` — nombre tomado del diseño congelado posterior "Crecimiento de la Ciudad"), `shared/types.ts`/`shared/api.ts` (`position_locked` conectado), `hooks/useWorldState.ts`, `visuals/hub.ts`/`room.ts`/`token.ts` (patrón `Object.assign(container,{__x})` retirado también aquí, hallazgo real no anticipado), eliminación de `world/WorldEngine.ts`.
- **Criterios de finalización:** ✅ `grep -r "WorldEngine" frontend/src/world` no encuentra el archivo viejo; ✅ `npx tsc --noEmit` limpio; ✅ patrón `__x` retirado; ⏳ `WorldCanvas.tsx` sigue en 374 líneas, no ~100 — desviación documentada y justificada, no se fuerza (ver Fase 9 en el plan); ⏳ sesión de humo en navegador pendiente de Jorge.
- **v1.0.**

### A.5 — Threading estructural de `venture_id`
- **Objetivo:** `venture_id` deja de ser un prefijo de texto `[VENTURE: nombre]` y pasa a ser un campo real en `AgentTask`/`ToolContext`.
- **Problema que resuelve:** prerrequisito **bloqueante** de Memory System v3 (C.1) — `memory_entries` necesita leer por venture, no solo escribir. Ya identificado y decidido en [[ADR-006 - Multi-Venture]] y [[ADR-004 - Memory System]].
- **Dependencias:** ninguna — es la base de C.1.
- **Riesgo:** bajo — cambio mecánico, ya diseñado con precisión en los ADRs.
- **Impacto:** alto — desbloquea Memory System y cualquier tool futura que necesite leer por venture.
- **Duración aprox.:** 1-2 días.
- **Documentación afectada:** ninguna nueva — ya especificado en ADR-004/006, esta entrega solo lo ejecuta.
- **Código que toca:** `agentRuntime.ts` (`AgentTask.ventureId`), `aiService.ts` (`askAgent()` recibe el parámetro), `tools/base.ts` (`ToolContext.ventureId` sustituye al campo muerto `businessId`).
- **Criterios de finalización:** `grep -rn "VENTURE:" agentRuntime.ts` no encuentra el prefijo de texto; `ToolContext` no tiene `businessId`.
- **v1.0.**

### A.6 — Persistencia real del Event Bus
- **Objetivo:** los eventos del bus sobreviven a un reinicio del proceso, no solo un historial de 100 en memoria.
- **Problema que resuelve:** hoy un crash pierde todo evento que no haya tocado ya una tabla de dominio — bloqueante real para la memoria de Hokage (C.3) y para auditoría a largo plazo.
- **Dependencias:** ninguna.
- **Riesgo:** bajo — tabla aditiva, no cambia el contrato del bus (que sigue sin persistir por diseño, ver [[ADR-003 - Event Bus]] — esto es un log de auditoría en paralelo, no el bus mismo).
- **Impacto:** medio hoy, alto para C.3/G.
- **Duración aprox.:** 1 día.
- **Documentación afectada:** [[Runtime, Scheduler y Event Bus]] (nota de que el bus gana un log persistente sin cambiar su contrato de no-persistencia).
- **Código que toca:** `config/eventBus.ts` (suscriptor nuevo que persiste), tabla `event_log` nueva en `db/init.ts`.
- **Criterios de finalización:** reiniciar el proceso no pierde el histórico de eventos consultable.
- **v1.0.**

### A.7 — Aclarar discrepancia `sqlite3` vs `better-sqlite3`
- **Objetivo:** que la documentación oficial (CLAUDE.md) diga la verdad sobre el driver real en uso.
- **Problema que resuelve:** CLAUDE.md afirma `better-sqlite3`; el código usa `sqlite3` (async/callback). Es una discrepancia de documentación, no necesariamente un bug — **decisión a tomar, no ejecutar a ciegas:** migrar el driver (síncrono, menos overhead de Promise) o corregir el documento.
- **Dependencias:** ninguna.
- **Riesgo:** bajo si se corrige el documento; medio si se decide migrar el driver (toca cada punto de acceso a BD).
- **Impacto:** bajo funcionalmente, alto en confianza de la documentación.
- **Duración aprox.:** 0.5 días (documentar) o 2-3 días (migrar driver, si se decide).
- **Documentación afectada:** `CLAUDE.md` (global).
- **Código que toca:** ninguno si se documenta; `db/init.ts` completo si se migra.
- **Criterios de finalización:** CLAUDE.md coincide con el código real.
- **v1.0 (documentar) — migrar driver queda v2.0, solo si el volumen de escritura concurrente lo justifica.**

---

## Fase B — Runtime (Hermes)

**Por qué después de A:** depende de que el Event Bus tenga persistencia (A.6, para que el reporte operativo de Hermes tenga datos reales que consultar) y no depende de nada de C/D salvo la dependencia cruzada explícita en B.3.

### B.1 — Sacar a Hermes de la tabla `agents`
- **Objetivo:** Hermes deja de ser una fila de `agents` con `system_prompt` de personalidad.
- **Problema que resuelve:** hoy Hermes es indistinguible de un agente de negocio en el modelo de datos — cualquier vista futura que liste "agentes" lo mostraría como trabajador salvo exclusión manual en cada sitio.
- **Dependencias:** ninguna técnica.
- **Riesgo:** medio — toca el punto de datos más citado del sistema (`agents`); requiere auditar cada consulta que asuma "toda entidad activa vive en `agents`".
- **Impacto:** alto — es la decisión de mayor apalancamiento de todo el roadmap, per la [[Redefinición de Principios Fundamentales - 2026-08-06|redefinición]].
- **Duración aprox.:** 2-3 días.
- **Documentación afectada:** `HOKAGE_CORE_SPECIFICATION_v1.md §9.1` (marcar como parcialmente superado, ver nota de choque al inicio de este documento), [[Hermes y Claude - Los Dos Motores]], memoria `project-hermes-pausado`.
- **Código que toca:** `db/init.ts` (nuevo concepto de estado de runtime, fuera de `agents`), `hermesService.ts`, cualquier query que haga `SELECT * FROM agents` sin filtrar por rol de negocio.
- **Criterios de finalización:** `agents` no tiene fila para Hermes; ninguna vista de "lista de agentes" lo muestra.
- **v1.0.**

### B.2 — Reconciliar `system.status` con el principio de kernel sin voz
- **Objetivo:** mantener el reporte operativo real (work items procesados, decisiones pendientes, presupuesto, errores) sin el marco de "agente que Jorge le pregunta cómo va todo".
- **Problema que resuelve:** el hueco entre §9.1 (agente conversacional) y el principio 1 de hoy (sin chat, sin personalidad).
- **Dependencias:** B.1, A.6 (necesita datos reales del Event Bus persistente que reportar).
- **Riesgo:** bajo — es reencuadrar una tool que ya existe (`system.status`, de solo lectura), no construirla desde cero.
- **Impacto:** alto — resuelve el único choque real de todo este roadmap.
- **Duración aprox.:** 1-2 días.
- **Documentación afectada:** `HOKAGE_CORE_SPECIFICATION_v1.md §9.1` (anotar la reconciliación explícitamente, no reescribir en silencio).
- **Código que toca:** `hermesService.ts` (o su sucesor tras B.1), la tool `system.status` se conserva, se retira cualquier ruta de UI que trate a Hermes como interlocutor de chat.
- **Criterios de finalización:** el estado operativo real es consultable (por Hokage, por el Panel de Sistema de B.3) sin que exista una superficie de "chatear con Hermes".
- **v1.0.**

### B.3 — Sala de Máquinas → "Panel de Sistema"
- **Objetivo:** la sala de Hermes deja de ser un departamento de negocio y pasa a ser un tipo de panel distinto: monitorización del Runtime.
- **Problema que resuelve:** hoy nace en niebla y se revela por el mismo ritual que un negocio nuevo — un kernel no debería competir por ese ritual.
- **Dependencias reales, cruzadas:** necesita un **slice mínimo** de D.4 (departamentos como plantillas tipadas) — al menos la distinción "tipo Negocio" vs "tipo Sistema" — antes de poder reclasificar la sala sin reintroducir el problema. No hace falta esperar a D.4 completo, solo esa distinción binaria.
- **Riesgo:** medio — depende de una pieza de otra fase, marcado explícitamente para no perderlo de vista.
- **Impacto:** medio — cierra visualmente lo que B.1/B.2 cierran a nivel de datos.
- **Duración aprox.:** 1-2 días (una vez disponible el slice de D.4).
- **Documentación afectada:** [[Especificación Funcional de Producto - v1|Especificación Funcional]] §10 (ya lo anticipa).
- **Código que toca:** `db/init.ts` (`departments.type` o equivalente), frontend (panel de sistema, deja de usar `BuildingSection` genérica).
- **Criterios de finalización:** la sala de Hermes no pasa por el flujo de niebla/reactivación de La Fundación; muestra monitorización real, no chat.
- **v1.0.**

---

## Fase C — IA (agentes, memoria, contexto, conocimiento)

**Por qué en paralelo con B, no después:** no depende de que Hermes termine de reclasificarse — depende de A.5 (venture_id) y A.6 (event log), ambas en Fase A.

### C.1 — Implementar Memory System v3 (ya diseñado, [[ADR-004 - Memory System]])
- **Objetivo:** construir exactamente lo que ADR-004 ya especifica — tabla `memory_entries`, tool `memory.remember`, captura automática en los 4 puntos de enganche verificados.
- **Problema que resuelve:** hoy no existe memoria empresarial real, solo `agent_memory` (KV privado). CLAUDE.md pide explícitamente "recordar por qué fracasó algo hace 6 meses".
- **Dependencias:** A.5 (venture_id estructural — bloqueante, ya anotado en el propio ADR).
- **Riesgo:** bajo — arquitectura completa ya congelada, cero decisiones de diseño pendientes.
- **Impacto:** alto — es el primero de los "8 principios" que se vuelve real, y desbloquea C.3.
- **Duración aprox.:** 3-4 días.
- **Documentación afectada:** ninguna nueva — ADR-004 ya lo cubre; actualizar su estado a "implementado" al cerrar.
- **Código que toca:** `db/init.ts` (`memory_entries` + FTS5), `tools/` (`memory.remember` nueva), `decisionResolvers.ts`, `stage4_checkTTLs()`, `objectiveService.ts` (puntos de enganche automáticos).
- **Criterios de finalización:** los 4 puntos de enganche capturan en producción; lectura por venture funciona; `memory.write` (privado) no se toca.
- **v1.0.**

### C.2 — Formalizar niveles de autonomía 0-3
- **Objetivo:** el modelo de 4 niveles descrito en la Especificación Funcional §3 se vuelve un contrato real, mapeado sobre `decisions.risk_level`.
- **Problema que resuelve:** hoy el nivel de autonomía es implícito en el `risk_level` de cada `Decision` — no hay tabla de configuración por tipo de acción, ni valor por defecto declarado.
- **Dependencias:** ninguna técnica — conceptualmente es la base de C.5 (orquestador de Hokage).
- **Riesgo:** bajo — es formalizar algo que ya funciona parcialmente.
- **Impacto:** alto — es el contrato que hace predecible "cuándo decide solo, cuándo pide aprobación", pedido explícitamente en la Especificación.
- **Duración aprox.:** 1-2 días.
- **Documentación afectada:** [[Especificación Funcional de Producto - v1]] §3 (ya lo describe, esta entrega lo implementa).
- **Código que toca:** tabla nueva de configuración por tipo de acción, `decisionService.ts`, `agentRuntime.ts` (consulta el nivel antes de decidir si crear `Decision` o ejecutar directo).
- **Criterios de finalización:** cada tipo de acción tiene un nivel configurado; cambiar un nivel es un `UPDATE`, no un despliegue.
- **v1.0.**

### C.3 — `ContextComposer`: capas Global/Departamento/Temporal
- **Objetivo:** sustituir el `system_prompt` monolítico por composición en tiempo de ejecución de 3 capas, extendiendo Memory System (C.1) con una capa Global nueva.
- **Problema que resuelve:** hoy el contexto es plano — cambiar algo "global" exige re-sembrar cada agente a mano.
- **Dependencias:** C.1 (Memory System da la capa de Departamento/Agente vía `memory_entries`), A.5.
- **Riesgo:** medio — toca el punto más central del pipeline (`runAgent()`/`askAgent()`), requiere migrar los 7 `system_prompt` existentes sin romper comportamiento.
- **Impacto:** alto — es el mecanismo directo de "minimizar coste, maximizar especialización" (principio 4) y prerrequisito real de C.4/C.5.
- **Duración aprox.:** 4-5 días.
- **Documentación afectada:** [[Especificación Funcional de Producto - v1]] §4/§7 (ya lo describe), [[ADR-004 - Memory System]] (nota de extensión, no de reapertura — añade capa Global sin tocar el schema ya congelado).
- **Código que toca:** `db/init.ts` (tabla `context_global` pequeña), `agentRuntime.ts`/`aiService.ts` (compositor nuevo reemplaza la concatenación de `system_prompt` + `[VENTURE:]`), 7 seeds de agentes reescritos como instrucciones estructuradas.
- **Criterios de finalización:** ningún agente recibe contexto que no declara necesitar; cambiar la capa Global es una fila, no un re-seed.
- **v1.0.**

### C.4 — Sistema de Conocimiento (biblioteca de referencias)
- **Objetivo:** repositorio etiquetable de imágenes/PDFs/documentación/vídeos/código, como segunda fuente del mismo motor de recuperación que `memory_entries`.
- **Problema que resuelve:** hoy no existe ni rastro (confirmado por grep en toda la sesión de auditoría).
- **Dependencias:** C.3 (se integra en el mismo mecanismo de composición, no aparte — per la mejora propuesta en la Especificación §6).
- **Riesgo:** medio — incluye almacenamiento de archivo, patrón nuevo en el proyecto (no existe hoy ninguna subida de archivos).
- **Impacto:** medio — mejora la calidad de las tareas visuales/de diseño, no bloqueante para el resto del sistema.
- **Duración aprox.:** 4-5 días.
- **Documentación afectada:** [[Especificación Funcional de Producto - v1]] §6 (ya lo describe).
- **Código que toca:** tabla nueva `knowledge_items` + `knowledge_tags`, endpoint de subida, integración en `ContextComposer` (C.3).
- **Criterios de finalización:** Hokage puede incluir una referencia relevante en el contexto de una tarea sin que Jorge la adjunte manualmente.
- **v2.0 — no bloqueante para el resto de la Fase C.**

### C.5 — Orquestador de Hokage
- **Objetivo:** el punto de entrada donde una orden libre de Jorge se convierte en reparto real de trabajo entre agentes.
- **Problema que resuelve:** hoy no existe — lo más parecido es `automations` (reglas fijas) o el chat directo por agente (justo lo que se quiere eliminar).
- **Dependencias:** C.2 (niveles de autonomía), C.3 (contexto por capas — Hokage necesita capas de las que elegir qué mandar a cada agente).
- **Riesgo:** medio-alto — es la pieza más nueva conceptualmente, sin precedente directo en el código actual.
- **Impacto:** muy alto — es la promesa central del principio 2 ("Hokage es la única IA con la que hablo").
- **Duración aprox.:** 5-6 días.
- **Documentación afectada:** [[Especificación Funcional de Producto - v1]] §3 (contrato ya descrito), nuevo ADR técnico una vez implementado.
- **Código que toca:** servicio nuevo (`hokageOrchestrator.ts` o equivalente), endpoint nuevo (`POST /api/hokage/command`), reutiliza `work_items`/`createWorkItem()`/`Decision` sin modificarlos.
- **Criterios de finalización:** una orden de texto libre produce un plan visible, reparte trabajo real, y respeta los niveles de autonomía de C.2.
- **v1.0 — es el corazón de la redefinición, no puede posponerse.**

### C.6 — Secret Management v2 (ya diseñado, §11.2)
- **Objetivo:** `SecretProvider`, capabilities, scope por venture — desacopla credenciales de las tools que las usan.
- **Dependencias:** ninguna técnica, pero solo tiene valor real cuando existen integraciones que lo necesiten (F).
- **Riesgo:** bajo — arquitectura ya congelada.
- **Impacto:** bajo hasta que haya integraciones de terceros reales.
- **Duración aprox.:** 3 días.
- **Documentación afectada:** ninguna nueva.
- **Código que toca:** capa nueva entre `tools/` y `.env`.
- **Criterios de finalización:** una tool declara qué tipo de capability necesita sin conocer el secreto real.
- **v2.0 — mover a v1.0 solo si F (Plugins/Etsy) se prioriza antes de lo previsto.**

---

## Fase D — Sistema Operativo (interfaz)

**Por qué en paralelo con B/C:** depende solo de A.3 (consolidación de diseño) y A.4 (ECS cerrado). No depende de que C termine.

### D.1 — Consolidación de tokens de diseño (ejecuta lo que A.3 preparó)
- **Objetivo:** un único sistema de tokens (color/tipografía/espaciado) del que derivan todos los componentes.
- **Dependencias:** A.3.
- **Riesgo:** bajo.
- **Impacto:** alto — prerrequisito de D.7 (temas).
- **Duración aprox.:** incluida en A.3, sin coste adicional si A.3 se hizo bien.
- **Documentación afectada:** `frontend-design.md`.
- **Código que toca:** ya cubierto en A.3.
- **Criterios de finalización:** ya cubiertos en A.3.
- **v1.0.**

### D.2 — Motor mínimo de layout: Registry de paneles + persistencia
- **Objetivo:** cada panel es una instancia de un Registry de "tipos de panel"; su posición/tamaño se guarda en el backend.
- **Problema que resuelve:** hoy `GameLayout.tsx` es un compositor de posiciones CSS fijas — cero representación como dato.
- **Dependencias:** A.3/D.1.
- **Riesgo:** medio — es el mayor cambio estructural del frontend fuera de `world/`.
- **Impacto:** muy alto — bloqueante directo de "paneles dinámicos", el hallazgo más repetido de toda la auditoría.
- **Duración aprox.:** 5-6 días.
- **Documentación afectada:** [[Especificación Funcional de Producto - v1]] §9 (ya lo describe), [[Frontend - Decisiones v2]].
- **Código que toca:** `GameLayout.tsx` (reescritura estructural), tabla nueva `user_layout` en backend, `registries/PanelRegistry.ts` (frontend, mismo patrón que `VisualKindRegistry` del ECS).
- **Criterios de finalización:** cerrar y reabrir el navegador conserva el layout; añadir un panel nuevo es una entrada de Registry, no tocar `GameLayout.tsx`.
- **v1.0 (motor + persistencia) — drag-and-drop visual real se separa en D.6, v2.0.**

### D.3 — Barra superior + notificaciones unificadas
- **Objetivo:** reloj, salud del sistema, coste del día, acceso al canal de Hokage siempre visible; notificaciones con nivel de urgencia, accionables inline.
- **Dependencias:** D.2 (vive dentro del mismo motor de paneles/ventanas).
- **Riesgo:** bajo.
- **Impacto:** alto — es la pieza que más directamente hace sentir "sistema operativo" en el uso diario.
- **Duración aprox.:** 2-3 días.
- **Documentación afectada:** [[Especificación Funcional de Producto - v1]] §9.
- **Código que toca:** componente nuevo de barra superior, sistema de notificaciones (sustituye el flujo de aprobación aislado de hoy por uno generalizado).
- **Criterios de finalización:** una decisión pendiente se aprueba/rechaza desde la notificación sin navegar.
- **v1.0.**

### D.4 — Departamentos como plantillas tipadas
- **Objetivo:** Registry de "tipos de departamento" (Marketing, Ventas, Finanzas, Sistema...); crear uno nuevo es instanciar un tipo, no programar una vista.
- **Dependencias:** D.2 (necesita el Registry de paneles para que un tipo de departamento pueda declarar "qué paneles tiene").
- **Riesgo:** medio.
- **Impacto:** muy alto — responde directamente a "añadir departamentos dentro de un año sin reescribir arquitectura".
- **Duración aprox.:** 4-5 días (el slice mínimo que B.3 necesita puede entregarse en ~1 día dentro de este trabajo, antes del resto).
- **Documentación afectada:** [[Especificación Funcional de Producto - v1]] §10.
- **Código que toca:** `db/init.ts` (`department_types` o `departments.type`), frontend (`BuildingView.tsx` dejar de usar `BASE_SECTIONS` fijo, leer del tipo).
- **Criterios de finalización:** dos departamentos de tipos distintos muestran paneles genuinamente distintos sin código condicional por rol.
- **v1.0 (el slice mínimo que B.3 necesita, ya en A/B) — el Registry completo con N tipos reutilizables puede completarse en v2.0 si el tiempo aprieta.**

### D.5 — Sistema de widgets reutilizables
- **Objetivo:** piezas pequeñas (ventas del día, cola de contenido) como instancias de un Registry de tipos de widget.
- **Dependencias:** D.4.
- **Riesgo:** bajo.
- **Impacto:** medio.
- **Duración aprox.:** 3 días.
- **Documentación afectada:** [[Especificación Funcional de Producto - v1]] §9.
- **Código que toca:** `registries/WidgetRegistry.ts`.
- **Criterios de finalización:** un departamento nuevo puede exponer un widget sin tocar código de otro departamento.
- **v2.0.**

### D.6 — Editor visual (drag/resize real)
- **Objetivo:** reorganizar el escritorio en caliente, sobre el motor de D.2.
- **Dependencias:** D.2.
- **Riesgo:** medio.
- **Impacto:** medio — mejora de experiencia, no bloqueante de ninguna otra pieza.
- **Duración aprox.:** 4 días.
- **Documentación afectada:** [[Especificación Funcional de Producto - v1]] §9.
- **Código que toca:** interacción de arrastre sobre `PanelRegistry`.
- **Criterios de finalización:** mover/redimensionar un panel persiste sin recargar.
- **v2.0.**

### D.7 — Sistema de temas
- **Objetivo:** un tema es una instancia de configuración sobre D.1.
- **Dependencias:** D.1.
- **Riesgo:** bajo.
- **Impacto:** bajo funcionalmente, alto en la sensación de personalización.
- **Duración aprox.:** 2 días.
- **Documentación afectada:** [[Especificación Funcional de Producto - v1]] §9.
- **Código que toca:** capa de resolución de tema sobre los tokens ya consolidados.
- **Criterios de finalización:** cambiar de tema no toca un solo componente.
- **v2.0.**

---

## Fase E — Personalización

**Por qué después de C y D:** Founder Profile necesita Memory System (C.1); La Fundación necesita departamentos tipados (D.4); Modo Nocturno necesita niveles de autonomía (C.2).

### E.1 — Founder Profile v2 (ya diseñado, §12.2)
- **Objetivo:** tool `founder.remember` dedicada, lectura acotada al rol `ceo`.
- **Dependencias:** C.1.
- **Riesgo:** bajo — arquitectura ya congelada.
- **Impacto:** medio — mejora cuánto Hokage entiende a Jorge específicamente.
- **Duración aprox.:** 2-3 días.
- **Documentación afectada:** ninguna nueva.
- **Código que toca:** tool nueva, sin cambios de schema más allá de lo ya descrito en §12.2.
- **Criterios de finalización:** ya descritos en la especificación congelada.
- **v2.0.**

### E.2 — La Fundación / Wizard v2 (ya diseñado, §12.3)
- **Objetivo:** experiencia de fundación de un venture/departamento nuevo dentro del World Engine, no un formulario.
- **Dependencias:** D.4 (departamentos tipados — La Fundación instancia un tipo).
- **Riesgo:** medio.
- **Impacto:** alto cuando llegue el segundo venture — no bloqueante para el primero.
- **Duración aprox.:** 5-6 días.
- **Documentación afectada:** ninguna nueva — §12.3 ya la cubre.
- **Código que toca:** frontend (`world/`, integrado con D.4), backend (creación de `ventures`/`departments`).
- **Criterios de finalización:** ya descritos en §12.3.
- **v2.0 — no urgente mientras exista un único venture.**

### E.3 — Modo nocturno
- **Objetivo:** autonomía elevada temporal con reversión automática (propuesta de la Especificación §11).
- **Dependencias:** C.2.
- **Riesgo:** medio — cualquier elevación de autonomía automática exige la reversión probada de verdad, no solo diseñada.
- **Impacto:** medio.
- **Duración aprox.:** 3 días.
- **Documentación afectada:** [[Especificación Funcional de Producto - v1]] §11 (ya lo propone).
- **Código que toca:** `agentRuntime.ts` (ventana horaria de autonomía elevada), mecanismo de reversión automática.
- **Criterios de finalización:** una acción de nivel 2 tomada en modo nocturno se revierte automáticamente si la señal de éxito no llega a tiempo.
- **v2.0.**

---

## Fase F — Plugins

**Por qué después de C/D/E:** el contrato ya está congelado (ADR-005) — esta fase construye el *loader dinámico* sobre él, y solo tiene sentido cuando hay una integración real que lo justifique.

### F.1 — Loader dinámico de Plugins sobre el contrato ya congelado
- **Objetivo:** discover/install/enable/version real, sobre la taxonomía Tool/Plugin/Business Module ya decidida en ADR-005.
- **Dependencias:** ninguna técnica nueva — el contrato de `Tool` ya existe y funciona.
- **Riesgo:** medio.
- **Impacto:** bajo hasta que el número de tools crezca — hoy 5-6 tools no lo necesitan.
- **Duración aprox.:** 5 días.
- **Documentación afectada:** ninguna nueva — ADR-005 ya lo cubre.
- **Código que toca:** `tools/registry.ts` (de imports estáticos a loader), tablas `plugins`/`plugin_role_grants` (ya diseñadas).
- **Criterios de finalización:** un plugin nuevo se instala sin tocar `tools/registry.ts`.
- **v2.0.**

### F.2 — Primer Business Module real: Etsy
- **Objetivo:** pipeline tendencia → contenido → publicación end-to-end en Etsy (Fase 4 del roadmap viejo, sigue vigente según su propia anotación).
- **Dependencias:** F.1, C.6 (Secret Management, para las credenciales de Etsy).
- **Riesgo:** medio — depende de una API externa real.
- **Impacto:** alto de negocio, no de arquitectura — es la primera prueba de fuego real del sistema de plugins.
- **Duración aprox.:** 5-7 días.
- **Documentación afectada:** ninguna nueva.
- **Código que toca:** `EtsyTool` real (OAuth2, listings, pedidos).
- **Criterios de finalización:** primera venta real generada y registrada.
- **v2.0 — decisión de negocio, no técnica: puede adelantarse si Jorge prioriza ingresos sobre completar la Fase D.**

---

## Fase G — Escalabilidad

**Por qué al final, salvo G.1:** casi todo aquí es condicional a volumen real, ya decidido explícitamente así en [[ADR-002 - Agent Runtime]] y el roadmap viejo — construirlo antes sería la misma sobre-ingeniería que el principio 7 ya advierte evitar.

### G.1 — Despliegue VPS 24/7
- **Objetivo:** Hetzner CX22, PM2, Nginx, Let's Encrypt (Fase 5 del roadmap viejo, confirmada vigente).
- **Dependencias:** A.2 (seguridad cerrada antes de exponer el sistema fuera de localhost).
- **Riesgo:** bajo — infraestructura conocida, sin decisiones de arquitectura pendientes.
- **Impacto:** muy alto — sin esto, "funciona 24/7 sin mí" no es cierto todavía, solo local.
- **Duración aprox.:** 2-3 días.
- **Documentación afectada:** [[Seguridad, Permisos y VPS]].
- **Código que toca:** configuración de despliegue, no lógica de aplicación.
- **Criterios de finalización:** el sistema corre sin supervisión, con reinicio automático si el proceso cae.
- **v1.0 — pese a vivir en la fase "Escalabilidad", es v1.0 real: es la condición de posibilidad de la Fase 11 de la Especificación (automatización 24/7).**

### G.2 — Scheduler con sharding/colas priorizadas
- **Objetivo:** superar el techo de "un par de docenas de agentes" ya documentado.
- **Dependencias:** volumen real que lo justifique — señal explícita ya definida en ADR-002.
- **Riesgo:** medio-alto si se construye antes de tiempo (complejidad sin necesidad real).
- **Impacto:** alto, pero solo cuando la señal llegue.
- **Duración aprox.:** 5-7 días, cuando toque.
- **Documentación afectada:** [[ADR-002 - Agent Runtime]] (nueva versión cuando se active).
- **Código que toca:** `agentRuntime.ts` completo.
- **Criterios de finalización:** definidos cuando se active, no antes.
- **v2.0, condicional — no se agenda hasta que el disparador ocurra.**

### G.3 — Capa de proveedor de IA multi-modelo real
- **Objetivo:** adaptador más allá del formato de tool-calling estilo OpenAI/OpenRouter, para soportar proveedores nativos o modelos locales.
- **Dependencias:** ninguna técnica — es una decisión de cuándo, no de si.
- **Riesgo:** medio.
- **Impacto:** alto solo si se necesita salir de OpenRouter — hoy no es una necesidad real.
- **Duración aprox.:** 4-5 días.
- **Documentación afectada:** ninguna nueva.
- **Código que toca:** `aiService.ts` (capa de adaptador).
- **Criterios de finalización:** un proveedor no-OpenRouter funciona sin tocar `agentRuntime.ts`.
- **v2.0.**

### G.4 — Migración a PostgreSQL
- **Objetivo:** solo si se superan 2 ventures activos simultáneos o 10 agentes (condición ya fijada en el roadmap viejo, sigue vigente).
- **Dependencias:** condicional.
- **Riesgo:** medio — el schema no cambia, solo el driver, per la decisión ya tomada.
- **Impacto:** alto solo cuando la condición se cumpla.
- **Duración aprox.:** 3-4 días, cuando toque.
- **Documentación afectada:** ninguna nueva.
- **Código que toca:** capa de acceso a datos completa.
- **Criterios de finalización:** definidos cuando se active.
- **v2.0, condicional.**

---

## Tabla resumen — v1.0 vs v2.0

| Fase | v1.0 (imprescindible) | v2.0 (puede posponerse) |
|---|---|---|
| A — Consolidación | A.1, A.2, A.3, A.4, A.5, A.6, A.7 (documentar) | A.7 (migrar driver, condicional) |
| B — Runtime | B.1, B.2, B.3 | — |
| C — IA | C.1, C.2, C.3, C.5 | C.4 (conocimiento), C.6 (secrets, salvo que F se adelante) |
| D — Sistema Operativo | D.1, D.2 (motor+persistencia), D.3, D.4 (slice mínimo) | D.4 (Registry completo), D.5, D.6, D.7 |
| E — Personalización | — | E.1, E.2, E.3 |
| F — Plugins | — | F.1, F.2 |
| G — Escalabilidad | G.1 (VPS) | G.2, G.3, G.4 (todos condicionales) |

**Lectura directa:** v1.0 es exactamente lo que hace *verdadera* la redefinición de esta sesión — Hermes como kernel, Hokage como única interfaz con memoria y contexto reales, un sistema operativo mínimo viable (no un dashboard), y corriendo 24/7 de verdad. v2.0 es todo lo que la hace *mejor* sin lo cual la redefinición seguiría siendo cierta — conocimiento, personalización, plugins dinámicos, y escala que hoy no hace falta.

---

## Qué queda fuera de este documento

Este roadmap secuencia — no rediseña. Cualquier iniciativa nueva que no encaje en una fase existente se añade aquí primero, con sus 9 campos completos, antes de tocar código — esa es la regla a partir de ahora.

## Relacionado

- [[Especificación Funcional de Producto - v1]]
- [[Redefinición de Principios Fundamentales - 2026-08-06]]
- [[Auditoría de Arquitectura - 2026-08-06]]
- [[Resumen Ejecutivo - Decisiones Congeladas]]
- [[ADR-001 - World Engine]]
- [[ADR-002 - Agent Runtime]]
- [[ADR-003 - Event Bus]]
- [[ADR-004 - Memory System]]
- [[ADR-005 - Tool Runtime y Plugin Contract]]
- [[ADR-006 - Multi-Venture]]
- [[Plan de Migración ECS]]
- [[Roadmap - Snapshot 2026-08-02]]
- [[INDEX]]
