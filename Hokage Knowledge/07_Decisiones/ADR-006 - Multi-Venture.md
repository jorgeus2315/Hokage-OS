# ADR-006 — Multi-Venture
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado, implementado y verificado
> Sintetizado desde `HOKAGE_CORE_SPECIFICATION_v1.md` §3 — Fase 7 de la migración documental

---

## Contexto

Todo lo que un Setup Wizard automatizaría para un segundo negocio depende de este modelo. Hasta ahora solo ha existido un venture ("Minimal Designs") desde el primer día — el modelo nunca se ha ejercitado con dos. Era, según la especificación, la decisión más grande de todo el documento.

`ARCHITECTURE.md §15` ya documentaba una respuesta de diseño: *"Los departamentos son invariables — solo cambia el contenido que procesan. Esto permite que el ecosistema gestione múltiples negocios simultáneamente sin código nuevo"*, con un ciclo de vida de 12 fases terminando en "Fase 12 — Nuevo negocio: los agentes existentes amplían su contexto." Decisión de diseño real y buena — **pero el código no la implementaba**:

- `agents.venture_id`, `decisions.venture_id`, `work_items.venture_id` existen como columnas pero ningún código escribía nunca un valor en ellas.
- `objectives` no tenía columna `venture_id` en absoluto — el Goal System era implícitamente de un solo negocio.
- `assets` y `automations` sí escribían `venture_id`, pero solo porque sus rutas POST lo aceptaban del body — ningún formulario del frontend ofrecía elegir un venture, porque solo había uno.

## Alternativas consideradas

**A. Un agente sirve a todos los ventures, con contexto por tarea** (lo que ya documentaba `ARCHITECTURE.md §15`)
Ventajas: cero coste de infraestructura por venture nuevo; un agente por rol escala a N ventures sin crear N agentes. Inconvenientes: requiere que todo el pipeline empiece a threading `venture_id` de verdad — hoy no lo hacía en ningún punto real.

**B. Un set de agentes por venture** (cada venture "clona" sus propios 8 agentes)
Ventajas: aislamiento total — presupuesto, memoria y prompt de un negocio nunca se filtran a otro. Inconvenientes: contradice explícitamente la filosofía de `CLAUDE.md` ("cada nuevo negocio reutiliza la misma infraestructura"). Multiplica coste de OpenRouter linealmente por negocio — con 3 negocios ya son 24 agentes que gestionar, programar y pagar.

**C. Híbrido — agentes compartidos por defecto, con opción de agente dedicado cuando un venture lo justifique**
Ya semi-anticipado en `ARCHITECTURE.md §15, Fase 11 (Escalado)`. Ventajas: lo mejor de A y B. Inconvenientes: el modelo más difícil de razonar y el que más código nuevo pide.

## Decisión

**Elegido: A, con la implementación mínima que le faltaba para ser real — no B, no C todavía.** Los agentes son proveedores de servicio compartidos por rol; un venture es un registro de datos + un ámbito de presupuesto/objetivos, no un conjunto de agentes propio. Lo único que cambia respecto al diseño ya escrito es hacerlo **verificable**, no solo documentado:

1. Añadir `objectives.venture_id` (migración aditiva, nullable — un objetivo sin venture sigue siendo válido, es "global").
2. `createDecision()` y `createWorkItem()` deben aceptar y persistir `venture_id` cuando el contexto lo tenga.
3. El contexto de cada `work_item`/prompt debe declarar explícitamente para qué venture trabaja, cuando aplique — igual que ya declara `[OBJETIVO]` o el título de una decisión aprobada.
4. La opción C (agente dedicado) queda como una Decision de alto nivel que Jorge aprueba manualmente cuando un venture lo justifique — no se automatiza en v1, y el Wizard nunca la ofrece como opción de creación inicial.

C es el techo a futuro (ya bien pensado en `ARCHITECTURE.md §15` Fase 11), no algo que construir ahora.

## Relación con Memory System

Memory System (ver [[ADR-004 - Memory System]]) depende directamente de que este threading estructural exista — a diferencia de `decision.create`, que solo escribe y hereda el mismo vacío que tenía el marcador, `memory_entries` necesita **leer** por venture, así que el prerrequisito de `venture_id` estructural (`AgentTask.ventureId`, `ToolContext.ventureId`) se cierra formalmente como parte del diseño de Memory System, no de este ADR — pero es esta decisión (Multi-Venture, opción A) la que lo hace necesario.

## Consecuencias

Si se implementan los 3 puntos: el Wizard de "nuevo negocio" es barato de construir (crear fila en `ventures`, opcionalmente un objetivo con `venture_id`) y el sistema escala a N negocios sin tocar el runtime.

Si se deja como estaba (columnas fantasma, sin threading real): cualquier Wizard que prometa "segundo negocio" construye sobre una mentira — el negocio se crearía, pero ningún agente sabría nunca a cuál está sirviendo, y el trabajo de todos los negocios se mezclaría en las mismas colas sin distinción — el mismo tipo de bug de coherencia ya corregido en `AlertsView`/`CrewView`.

## Relacionado

- [[Modelo Multi-Venture]]
- [[ADR-004 - Memory System]]
- [[Recetas - Añadir Negocio]]
- [[Resumen Ejecutivo - Decisiones Congeladas]]
- [[INDEX]]
