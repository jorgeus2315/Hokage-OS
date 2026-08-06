> Categoría: redefinición de visión, precede a ADRs futuros
> Estado: 🆕 Nuevo — principios aprobados por Jorge, arquitectura de detalle todavía sin implementar
> Origen: sesión 2026-08-06, tras cerrar la Fase 6 del [[Plan de Migración ECS]] y la [[Auditoría de Arquitectura - 2026-08-06|auditoría de arquitectura]] previa

---

## Filtro de evaluación permanente, a partir de ahora

Toda decisión de arquitectura futura se evalúa contra esta pregunta:

**¿Esto acerca Hokage OS a parecer un sistema operativo inteligente y un centro de mando personal, o lo acerca a un simple dashboard?**

Si la respuesta es "dashboard", se propone una alternativa antes de implementar. Este filtro se añade a — no sustituye — el [[Núcleo - Arquitectura del Core|filtro de las 4 preguntas]] ya vigente.

---

## Los 7 principios

1. **Hermes deja de ser un agente.** Es el Runtime — el kernel del sistema. Ejecuta agentes, gestiona herramientas/colas/workflows/eventos/memoria/recursos, coordina llamadas a modelos. Sin personalidad, sin chat, no aparece como un trabajador más.
2. **Hokage es la única IA con la que Jorge interactúa.** Una orden libre → Hokage decide qué agentes participan, qué herramientas/modelos usan, qué contexto necesita cada uno, cuándo responde, cuándo ejecuta solo, cuándo pide aprobación. Director General del sistema.
3. **Los agentes dejan de ser chatbots.** Su interfaz es configuración/instrucciones/herramientas/modelo/permisos/contexto/memoria/rendimiento/tareas/historial/métricas. Hablar directamente con un agente concreto es un modo de depuración excepcional, no el flujo normal.
4. **Contexto por capas** — Global (qué es Hokage OS, normas, objetivos globales) / Departamento (solo lo necesario para su especialidad) / Temporal (solo lo necesario para la tarea actual). Objetivo: minimizar coste, maximizar especialización.
5. **Biblioteca de referencias para IA** — imágenes, documentos, PDFs, interfaces, logos, inspiración, capturas, paletas, tipografías, todo etiquetable. Hokage decide qué referencias usar por tarea.
6. **Hokage OS debe sentirse como un sistema operativo** — centro de mando personal, no dashboard ni panel de administración.

(El punto 7 del encargo original — "antes de seguir" — es este mismo documento.)

---

## Principio 8, añadido 2026-08-06 (misma sesión): todo declarativo, configurable, editable

**Enunciado de Jorge:** ningún agente, panel, sala, herramienta, modelo, workflow, layout, tema, asset o comportamiento debe depender de valores hardcodeados cuando pueda describirse mediante configuración. El código proporciona el motor; la configuración define el comportamiento. Objetivo: rediseñar Hokage OS dentro de un año — añadir departamentos, cambiar interfaz, sustituir modelos, incorporar sistemas nuevos — sin reescribir la arquitectura.

**Matiz de calibración (criterio de arquitecto, no aceptado sin más):** la generalidad absoluta tiene coste real — sobre-abstraer todo en config crea su propio mini-lenguaje frágil, más difícil de razonar que el código. El alcance correcto es la lista que Jorge dio (agentes, paneles, salas, herramientas, modelos, workflows, layouts, temas, assets, comportamiento) — cosas que se espera que varíen y se multipliquen durante la vida del sistema — no cada constante del código (`ZOOM_MIN`/`PAN_THRESHOLD` de `CameraSystem` no necesitan ser editables; nadie va a querer un umbral de pan distinto, y hacerlo "configurable" añade indirección sin beneficio de producto).

**Dónde ya cumple:**
- `automations` (`trigger_event → action_agent_role → action_context_template`) — 100% dato, una regla nueva es un `INSERT`, cero código. El mejor ejemplo existente.
- `departments` — una sala nueva ya es una fila, no un componente React nuevo (la Sala de Máquinas de Hermes se añadió así).
- `AGENT_MODELS`/`AGENT_TOOLS` — modelo y herramientas por rol son config, no hardcodeo por llamada (cuando se respetan, ver más abajo).
- Migraciones siempre aditivas (`columnExists()` guard).
- **El patrón `Registry` del World Engine/ECS** (`VisualKindRegistry`/`AnimationRegistry`/`ParticleEffectRegistry`, Fases 2-4 del [[Plan de Migración ECS]]) — `kind → definición`, extensible sin tocar el `System`. Es la prueba de que el patrón que este principio pide ya funciona bien en este código.

**Dónde lo viola (evidencia real, no hipotética):**
- `system_prompt` por agente es texto libre soldado al sembrar — no composición declarativa. Se resuelve con el `ContextComposer` del punto 4, no aparte.
- El bug real ya encontrado (`aiService.ts:204`, `server.ts:648` hardcodean `claude-haiku-4-5` en vez de leer `AGENT_MODELS`) es este principio violado en producción, no solo un typo.
- `BUILDINGS` (`shared/constants.ts`) sigue vivo como *fallback* antes de que carguen los `departments` reales (`useWorldState.ts:37`) — duplica a mano la misma info que ya vive en BD.
- `BASE_SECTIONS` (`BuildingView.tsx`) — las 7 pestañas de una sala son las mismas para todos los roles, hardcodeadas, con un único `if (role === 'hermes')` de excepción. Debería ser dato por rol/departamento.
- `tools/registry.ts` — imports estáticos, no loader dinámico. El mismo hueco que ya señalaba el Plugin System (§8.6, solo spec) — este principio lo hace más urgente.
- Layout de paneles — cero representación como dato (ni tabla, ni JSON, ni `localStorage`). El bloqueante más directo de toda la lista.

**Decisión a tomar ahora, la que añade este principio:** generalizar el patrón `Registry` que ya funciona en el ECS del mapa como convención de todo el proyecto — backend y frontend — en vez de que cada pieza futura (paneles, temas, workflows, plugins) invente su propio mecanismo declarativo por separado. Tres capas explícitas para cada sistema nuevo:
- **Motor (código):** el `System`/servicio que sabe *ejecutar* un `kind` — no cambia cuando se añade uno nuevo.
- **Registro (código, pero extensible):** la tabla `kind → definición` — un archivo nuevo la registra, nunca se toca el motor.
- **Configuración (dato, editable sin desplegar):** qué instancias existen, con qué parámetros — fila en BD o JSON.

No contradice ninguna de las 5 decisiones ya tomadas — les da un mecanismo común, y hace la Decisión 4 (`ContextComposer`) y la Decisión 5 (layout/tema) todavía más prioritarias, porque son las que más viola hoy.

---

## Estado real del código frente a cada principio (verificado, no supuesto)

### 1 — Hermes como Runtime

**Hoy:** Hermes es una fila más de la tabla `agents` (`role='hermes'`, modelo `claude-haiku-4.5`, `status='idle'`), con un `system_prompt` de personalidad literal ("Eres Hermes, el agente de sistema de HOKAGE OS…", `db/init.ts:593`). Tiene su propio departamento "Sala de Máquinas", que nace `active=0` y se revela por el mismo mecanismo de niebla que un negocio nuevo (`db/init.ts:604-609`). Pasa por el mismo poll de 10s / misma cola de asignación que los agentes de negocio — sin prioridad ni ruta diferenciada.

**Ya alineado:** `requestExec()` (`hermesService.ts`) es genuinamente kernel-like — nunca ejecuta directo, siempre crea `exec_run` + `Decision` pendiente de aprobación, con auditoría completa. La UI ya distingue Hermes con `section === 'terminal'` en vez de `'chat'` (`GameLayout.tsx:63`) — precedente accidental, no diseñado, pero ya apunta en la dirección correcta.

**Decisión a tomar ya (la de mayor apalancamiento de las siete):** sacar a Hermes de la tabla `agents` antes de que más funcionalidad futura asuma "toda entidad activa vive en `agents`". Forma propuesta, sin implementar: Hermes pasa a ser un concepto de `runtime_status` separado, sin `system_prompt` de personalidad, sin fila en la tabla de agentes de negocio, sin el ritual de niebla/reactivación de departamento.

### 2 — Hokage como única interfaz

**Ya existe la base, sin usar todavía para esto:** `work_items`/`createWorkItem()` (tipado, priorizado, con `venture_id` y contexto) es exactamente el primitivo que necesita "decidir qué agentes participan". `Decision` ya resuelve "cuándo pedir aprobación". `automations` (`trigger_event → action_agent_role`) ya resuelve enrutamiento reactivo de fondo — pero es config fija, no una IA decidiendo en el momento.

**Falta por completo:** un punto de entrada donde una orden libre llegue a Hokage y su propio turno de tool-calling decida el reparto. Hoy la interacción real es "entra en la sala de un agente y chatea con él directamente" (`chatByAgent`, `GameLayout.tsx:35`) — lo opuesto de "hablo solo con Hokage".

**Decisión a tomar ahora:** definir el contrato de un servicio de orquestación nuevo (ej. `hokageOrchestrator.ts` + `POST /api/hokage/command`, distinto de `runAgent()` porque decide un reparto multi-agente, no responde una tarea propia) antes de seguir invirtiendo en el patrón de chat-por-agente actual.

### 3 — Agentes no son chatbots

**Mejor de lo esperado:** cada edificio ya es una interfaz por pestañas (Chat | Live Feed | Stats | Pipeline | Alertas), no un chat exclusivo. Ya existe `AgentConfigPanel.tsx`. El patrón estructural para "configuración/herramientas/permisos/tareas/métricas como pestañas" ya existe — no hay que inventar el mecanismo, solo re-priorizarlo.

**A cambiar:** `useState<BuildingSection>('chat')` — chat es hoy la pestaña por defecto; debería ser la excepción de depuración. Cambio quirúrgico (qué pestaña abre primero + ocultar chat salvo modo debug), no reescritura.

**Pendiente de verificar** (no confirmado con certeza en esta pasada): cobertura real de memoria/rendimiento/historial como pestañas — puede que falte construir alguna.

### 4 — Contexto por capas

**Hoy no existe — la brecha más real de las siete.** `runAgent()` construye el prompt como `system_prompt` estático (fijado al sembrar el agente) + un prefijo ad hoc `[VENTURE: nombre]` + texto de tarea (`agentRuntime.ts:190-220,485`). No hay composición en capas; si algo "global" cambia, hay que re-sembrar cada agente a mano.

**Decisión a tomar ahora:** diseñar un `ContextComposer` (Global editable una vez / Departamento por rol / Temporal = lo que ya hace bien `work_items.context`) que sustituya el `system_prompt` estático, insertado entre la asignación de `work_items` y la llamada a `askAgent()`. Es infraestructura nueva real. De esta pieza dependen directamente el punto 2 (Hokage no puede decidir "qué contexto necesita cada uno" sin capas de las que elegir) y el punto 5.

### 5 — Biblioteca de referencias

**No existe ni rastro** (confirmado por grep en todo el repo — cero tablas, endpoints, ni patrón de subida de archivos). Terreno limpio.

**Decisión a tomar ahora:** secuenciar esto **después** del `ContextComposer` (punto 4), no en paralelo — la selección automática de referencias por Hokage es, en esencia, una fuente más de contexto por tarea. Construirlo antes garantiza un mecanismo ad hoc que luego hay que fusionar con el general.

### 6 — Sistema operativo, no dashboard

Conecta directamente con tres hallazgos ya identificados en la [[Auditoría de Arquitectura - 2026-08-06|auditoría de arquitectura del día anterior]], que esta redefinición convierte en bloqueantes, no en mejoras opcionales:
- Ausencia total de motor de layout de paneles (`GameLayout.tsx` con posiciones CSS fijas) — obstáculo directo a "centro de mando", un SO permite mover/redimensionar ventanas.
- Dos sistemas de diseño paralelos (`design/components` sin usar vs `shared/ui.tsx` real) — un SO necesita un único lenguaje visual, no dos a medias.
- Colapsar el chat-con-N-agentes a una única superficie de comando con Hokage (punto 2) es, en sí mismo, el cambio de UX que más acerca esto a "sistema operativo" y más lo aleja de "app de mensajería con salas".

---

## Orden de decisiones — antes de seguir añadiendo funcionalidad

1. Sacar a Hermes de `agents` (esquema — cuanto más tarde, más caro de separar).
2. Adoptar el patrón `Registry` (motor/registro/configuración) del ECS del mapa como convención de todo el proyecto — antes de diseñar en detalle las piezas 3-6, para que todas compartan un único mecanismo declarativo, no uno cada una.
3. Definir el contrato del orquestador de Hokage (`work_items`/`Decision`/`automations` ya sirven de base).
4. Diseñar el `ContextComposer` de tres capas — antes de tocar biblioteca de referencias u orquestación real.
5. Dejar de sembrar `system_prompt` como personalidad — decidir el reemplazo ahora, no reescribir 7+ seeds más tarde.
6. Reclasificar el motor de layout de paneles y la consolidación de diseño (ya en la auditoría previa) como prerequisitos directos de "sistema operativo", no limpieza técnica aparte — y construirlos ya como dato (Registry), no como CSS fijo.

Ninguna de las seis está implementada todavía — este documento es el análisis de impacto que Jorge pidió antes de decidir cómo construirlas.

## Relacionado

- [[Núcleo - Arquitectura del Core]]
- [[VISION]]
- [[Runtime, Scheduler y Event Bus]]
- [[ADR-002 - Agent Runtime]]
- [[Automatizaciones (Agente-Agente)]]
- [[Memory System]]
- [[Frontend World Engine]]
- [[Frontend - Decisiones v2]]
- [[Auditoría de Arquitectura - 2026-08-06]]
- [[Resumen Ejecutivo - Decisiones Congeladas]]
- [[INDEX]]
