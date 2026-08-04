> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §3. Congelado, implementado y verificado.

## 3. Modelo multi-venture

🔒 **CONGELADO, implementado y verificado.** Era la decisión más grande de todo el documento — resuelta y con los 3 puntos de implementación mínima ya en código (ver [[Resumen Ejecutivo - Decisiones Congeladas|§16]]).

### Por qué importa

Todo lo que un Setup Wizard automatizaría para un segundo negocio depende de esto. Hoy solo ha existido un venture ("Minimal Designs") desde el primer día — el modelo nunca se ha ejercitado con dos.

### Estado real verificado

[[ARCHITECTURE (legacy)]] §15 ya documenta una respuesta — **"Los departamentos son invariables — solo cambia el contenido que procesan. Esto permite que el ecosistema gestione múltiples negocios simultáneamente sin código nuevo"**, con un ciclo de vida de 12 fases terminando en "Fase 12 — Nuevo negocio: los agentes existentes amplían su contexto." Es una decisión de diseño real y buena.

**Pero el código no la implementa.** Evidencia:
- `agents.venture_id`, `decisions.venture_id`, `work_items.venture_id` existen como columnas (migraciones aditivas) pero **ningún código escribe nunca un valor en ellas** — verificado: `DecisionCreatePayload` no tiene campo `venture_id`; las 3 llamadas a `createWorkItem()` en `agentRuntime.ts` nunca pasan `businessId`.
- `objectives` **no tiene columna `venture_id` en absoluto** — el Goal System es implícitamente de un solo negocio.
- `assets` y `automations` sí escriben `venture_id`, pero solo porque sus rutas POST lo aceptan del body — ningún formulario del frontend construido hasta ahora ofrece elegir un venture (porque solo hay uno).

### Alternativas

**A. Un agente sirve a todos los ventures, con contexto por tarea** (lo que documenta [[ARCHITECTURE (legacy)]] §15)
- Ventajas: cero coste de infraestructura por venture nuevo; "Escritor" sigue siendo un único agente con una única personalidad/prompt, que recibe contexto de qué venture está atendiendo en cada `work_item`/`decision`. Escala a N ventures sin crear N agentes.
- Inconvenientes: requiere que **todo** el pipeline (creación de decisions, work_items, objectives) empiece a threading `venture_id` de verdad — hoy no lo hace en ningún punto real. El agente necesita cargar "qué venture es este" en cada ejecución, no solo en la UI.

**B. Un set de agentes por venture** (cada venture "clona" sus propios 8 agentes)
- Ventajas: aislamiento total — presupuesto, memoria y prompt de un negocio nunca se filtran a otro. Conceptualmente más simple de razonar por venture individual.
- Inconvenientes: contradice explícitamente la filosofía ya escrita en `CLAUDE.md` ("cada nuevo negocio reutiliza la misma infraestructura... los agentes existentes se reutilizan con nuevo contexto"). Multiplica coste de OpenRouter linealmente por negocio sin necesidad. Con 3 negocios ya son 24 agentes que gestionar, programar y pagar.

**C. Híbrido — agentes compartidos por defecto, con opción de agente dedicado cuando un venture lo justifique**
- Ya está semi-anticipado en [[ARCHITECTURE (legacy)]] §15, Fase 11 (Escalado): "contratar un agente especializado nuevo" como Decision de alto nivel cuando un negocio crece.
- Ventajas: lo mejor de A y B — barato por defecto, con vía de escape cuando un venture concreto lo necesite.
- Inconvenientes: es el modelo más difícil de razonar y el que más código nuevo pide (hay que decidir cuándo un agente es "compartido" vs "dedicado" y cómo convive con el scheduler).

### Decisión para Hokage OS

**Elegido: A, con la implementación mínima que le falta para ser real — no B, no C todavía.**

Los agentes son proveedores de servicio compartidos por rol; un venture es un registro de datos + un ámbito de presupuesto/objetivos, no un conjunto de agentes propio. Esto ya estaba decidido en principio en [[ARCHITECTURE (legacy)]] §15 y en `CLAUDE.md` — lo único que cambia aquí es hacerlo **verificable**, no solo escrito:

1. **Añadir `objectives.venture_id`** (migración aditiva, nullable — un objetivo sin venture sigue siendo válido, es "global").
2. **`createDecision()` y `createWorkItem()` deben aceptar y persistir `venture_id`** cuando el contexto lo tenga (hoy los tipos ni siquiera lo permiten).
3. **El contexto de cada `work_item`/prompt debe declarar explícitamente para qué venture trabaja** cuando aplique — igual que hoy ya declara `[OBJETIVO]` o el título de una decisión aprobada.
4. La opción C (agente dedicado) queda como lo que ya es: una Decision de alto nivel que Jorge aprueba manualmente cuando un venture lo justifique — **no se automatiza en v1**, y el Wizard nunca la ofrece como opción de creación inicial.

C es el techo a futuro (ya está bien pensado en [[ARCHITECTURE (legacy)]] §15 Fase 11), no algo que construir ahora.

### Consecuencias a 2-3 años

Si se congela A y se implementan los 3 puntos de arriba: el Wizard de "nuevo negocio" es barato de construir (crear fila en `ventures`, opcionalmente un objetivo con `venture_id`) y el sistema escala a N negocios sin tocar el runtime. Si se deja como está (columnas fantasma, sin threading real), cualquier Wizard que prometa "segundo negocio" construye sobre una mentira — el negocio se crearía, pero ningún agente sabría nunca a cuál está sirviendo, y el trabajo de todos los negocios se mezclaría en las mismas colas sin distinción, exactamente el mismo tipo de bug de coherencia que ya se corrigió en `AlertsView`/`CrewView` esta sesión.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[ARCHITECTURE (legacy)]] §15 — ciclo de vida de negocio de 12 fases, origen de esta decisión
- [[Recetas - Añadir Negocio]] — síntesis operativa
- [[Memory System]] · [[Runtime, Scheduler y Event Bus]] — ambos dependen del threading de `venture_id` que aquí se resuelve
- [[Goal System]] — `objectives.venture_id` pendiente
- [[Founder Profile y La Fundación]] — Fase 2 de la Fundación construye el primer venture
- [[ADR-006 - Multi-Venture]]
