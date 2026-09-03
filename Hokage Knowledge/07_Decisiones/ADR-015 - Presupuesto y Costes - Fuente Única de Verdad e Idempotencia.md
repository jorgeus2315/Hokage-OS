# ADR-015 — Presupuesto y Costes: Fuente Única de Verdad e Idempotencia

> Categoría: decisión de arquitectura
> Estado: ⏳ Propuesto — **aprobado como dirección** por Jorge (2026-08-31). Implementación por fases; **Paso 1 hecho** (desacople de tests del LLM). NO congelar hasta completar la implementación.
> Origen: auditoría del sistema de presupuesto/costes (2026-08-31) + revisión de idempotencia.

---

## Contexto

El sistema de costes tenía un problema **de diseño, no un bug aislado**: cuatro lugares escribían información de coste en la ruta de éxito de `askAgent`, ninguno autoridad clara sobre los demás, y los errores de escritura estaban silenciados con `.catch(() => {})`.

Evidencia demoledora medida en la BD viva: **1994 filas en `agent_runs` y 0 en `agent_costs`**. El `INSERT INTO agent_costs` llevaba fallando en silencio prácticamente toda la vida del proyecto y nadie lo vio, porque el error estaba tapado.

Los cuatro sumideros de coste:
1. `agent_runs.cost` — log de actividad (sin venture, sin work_item).
2. `agent_costs.*` — coste real detallado (silenciado).
3. `agent_budgets.current_month_usd` — acumulador mensual (silenciado, **segunda copia** del coste; además `reset_date` no se aplica en ningún sitio → "mensual" que nunca resetea).
4. `work_items.*_cost` — copia por trazabilidad **rota** (stage3 leía `work_item_id IS NULL`, que nunca es NULL porque `askAgent` ya lo escribe) y **que nadie lee**.

Consecuencia: presupuesto de venture (derivado de `agent_costs`) y presupuesto mensual por agente (acumulador propio) **pueden divergir** y de hecho divergen. Además los tests de presupuesto estaban acoplados a un LLM real (cargaban `.env`, ejecutaban `askAgent` contra OpenRouter), así que un modelo caído hacía fallar toda la lógica de presupuesto sin que fuera culpa de la lógica.

## Decisión

**Una sola escritura de coste, append-only, sin re-lectura, sin copias. El resto se deriva.**

1. **`agent_costs` = única fuente de verdad del coste real.** Una fila = una invocación de `askAgent`/`callAIJson`. Ya lo era para el presupuesto de venture (`ventureBudget.realSpent` suma `agent_costs`); el resto son satélites que deben derivar de ella. `agent_runs` queda como **log de actividad**, nunca autoridad de coste.
   - `work_item_id`: **NON-NULL para ejecuciones de runtime**; NULL solo para llamadas sin work_item (planner/replanner). Es clave de agregación por tarea, no de idempotencia.
2. **`agent_budgets` = solo configuración de límite** (`monthly_limit_usd`, `status`, `reset_date`). **Deja de almacenarse `current_month_usd`** → se deriva: `SUM(agent_costs) WHERE agent_id, venture_id, created_at ≥ inicio_mes`. Esto elimina la segunda verdad y arregla el "mensual que nunca resetea".
3. **`ventures`**: `budget_allocated_usd` (tope; 0 = sin tope) + `budget_spent_usd` (**reservado en vuelo**, mal llamado "spent"). El gasto real nunca se almacena aquí; se deriva de `agent_costs`.
4. **`work_items` NO es fuente contable.** Se elimina la copia de coste de stage3. Si una fase futura necesita "coste por work_item" es `SUM(agent_costs) WHERE work_item_id = ?`. Las columnas de coste quedan inertes (retirar en consolidación posterior).
5. **Reserva-antes-de-gastar unificada.** El camino autónomo (`stage2`) pasa de *check-only* a *reserve-then-settle*, igual que ya hace el orquestador ([[ADR-009 - Hokage Cadena de Orquestación]]). Cierra el TOCTOU entre comprobar presupuesto y gastar.
6. **Tests de presupuesto independientes del LLM.** `FakeProvider` inyectable sobre la frontera existente `aiProvider` ([[ADR-008 - ModelRouter y AIProvider]]) — determinismo total sin red, API keys ni disponibilidad de modelos.

### Idempotencia de `agent_costs` (revisión específica)

**Invariante que se deduce del código:** `nº filas en agent_costs = nº llamadas reales al proveedor`. `askAgent` hace **exactamente un** INSERT por invocación, sin bucle ni retry, y sus únicos invocadores son `await askAgent(...)` sueltos. Una llamada nunca produce dos filas.

Con eso se distinguen **por construcción** los dos casos:
- **Caso 1 — dos ejecuciones legítimas del mismo work_item → dos costes.** Ocurre vía retry / TTL-requeue / reinicio: cada una es una **llamada real nueva** → dos filas es correcto (se gastó dinero dos veces).
- **Caso 2 — la misma ejecución lógica registrada dos veces → imposible.** No existe mecanismo que reproduzca el INSERT de una invocación ya hecha (no hay retry del registro).

**Decisión: NO se introduce `execution_id` ni `UNIQUE` en `agent_costs` ahora.** Un `UNIQUE(execution_id)` solo se dispararía si el mismo id se insertara dos veces, cosa que no ocurre (un INSERT por invocación, sin reintento). Lo único que habilitaría —reintentar el registro de forma idempotente— es un camino que **deliberadamente no existe** (si el registro falla se pierde la fila = sub-conteo seguro, cubierto por la reserva previa).

**El riesgo real NO es doble-registro sino doble-GASTO** (dos llamadas reales por TTL disparado en vuelo o re-claim multi-proceso). `execution_id` no lo evita (serían dos ejecuciones reales distintas). Se cierra con el **invariante temporal `ttl_minutes > timeout del proveedor`**: hoy `AI_TIMEOUT_MS = 120s` (2 min) vs `ttl_minutes` por defecto **30 min** (margen 15×), y ningún work_item se crea con TTL menor. El invariante es implícito → se hace explícito con un **suelo** (`ttl_minutes ≥ 5`).

**Disparadores para reconsiderar `execution_id` (decisión consciente futura):** ejecución concurrente real del mismo work_item entre procesos; TTLs por debajo del timeout del proveedor; o querer registro **exactamente-una-vez** (pasar de "sub-conteo aceptado" a "nunca perder una fila ante crash"). Diseño en ese caso: `crypto.randomUUID()` en `askAgent`, propagado a `agent_costs`, `UNIQUE(execution_id)`, `INSERT … ON CONFLICT DO NOTHING`.

### Tres adiciones al diseño que destapó la revisión de idempotencia

1. **`work_items.reserved_usd` (columna nueva, migración aditiva).** Necesaria para que el camino autónomo libere la reserva **exacta** (como `hokage_tasks.reserved_usd`); recalcular la estimación al liberar sería frágil (fuga si cambia el estimador/modelo).
2. **Invariante `ttl_minutes > timeout del proveedor`**, hecho explícito con un suelo en `createWorkItem`.
3. **Liberación de reserva en TODOS los finales del camino autónomo** (done, failed, cancelled por presupuesto, cancelado por TTL, limpieza de claim expirado), con test por cada final.

## Alternativas consideradas

- **Capa global de transacciones (`BEGIN/COMMIT`)** — descartada: no encaja con el driver (`sqlite3` async, conexión única que ya serializa). El diseño usa "un statement atómico + acción compensatoria", que es el patrón que ya funciona en el orquestador.
- **`execution_id` + `UNIQUE` ahora** — descartada: protege un escenario inexistente (no hay INSERT que reintentar). Documentados los disparadores para introducirlo si cambian las condiciones.
- **Mantener `agent_budgets.current_month_usd` almacenado** — descartada: es una segunda verdad que diverge de `agent_costs` y no resetea. Se deriva.
- **Conservar la copia de coste en `work_items`** — descartada: write-only, nadie la lee; derivar por `work_item_id` si hace falta.

## Consecuencias

Cualquier fase futura (Tesorero con P&L por venture, multi-negocio, revenue vs coste, límites por modelo) es **una consulta `SUM` con otro `WHERE`** sobre `agent_costs`, no una tabla nueva ni un acumulador que sincronizar. Presupuesto de venture y mensual por agente **dejan de poder divergir**. La reserva-antes-de-gastar unificada da un guard correcto bajo concurrencia sin transacciones.

Riesgo aceptado explícitamente: si el proceso muere entre `provider.chat` (gasto real) y el INSERT, se pierde una fila (sub-conteo) — dirección segura para presupuesto, y la reserva previa ya había comprometido el importe.

## Implementación (orden por fases)

1. ✅ **Paso 1 (hecho 2026-08-31)** — Desacoplar tests del LLM: `registerProvider()` (costura aditiva en `aiProvider.ts`) + `FakeProvider` determinista + quitar `runtime.start()` de `budgetPipeline.test.ts`, conducir con un helper `tick()` sin timer de fondo. Resultado: 16/18 verde sin red (los 2 rojos restantes son tests de pipeline Fase 4.2 que requieren guionizar `tool_calls`, no lógica de presupuesto).
2. Tests unitarios de presupuesto (reserve/release/getVentureBudget/`agentMonthlySpent`) verdes contra el diseño objetivo.
3. Migración aditiva: `work_items.reserved_usd REAL NOT NULL DEFAULT 0`.
4. Centralizar presupuesto: `agentMonthlySpent(agentId, ventureId)` derivado; un solo módulo.
5. `askAgent`: quitar `.catch(() => {})` de `agent_costs`; eliminar el UPSERT de `agent_budgets.current_month_usd`.
6. `stage3`: eliminar la "Etapa 5 inline" (copia de costes a `work_items`).
7. `stage2`: check-only → reserve-then-settle con `work_items.reserved_usd`; liberar en todos los finales.
8. Suelo de TTL (`ttl_minutes ≥ 5`) en `createWorkItem`.
9. Chequeos agent-monthly (stage2 + orchestrator) → usar `agentMonthlySpent`, no `current_month_usd`.
10. Limpieza: `console.log('[DEBUG]')` en `ventureBudget.ts`/`decisionService.ts`, dedupe redundante de `budget_request`, scripts `debug-*.ts`, `hokage.db` 0 bytes.
11. Meter `budgetPipeline` en el runner de `package.json`; suite en verde real.

Sin cambios: schema de `agent_costs` (ya sirve), `claimAgent`/`releaseAgent`, `reserveVentureBudget`/`releaseVentureBudget`, la frontera `aiProvider`. Fuera de este trabajo: los 3 tests rojos del DAG (dependencias/continuación/replan de [[ADR-012 - Task Graph DAG y Directed Hand-off]]) — verificado que **no** tocan presupuesto ni costes.

## Relacionado

- [[ADR-008 - ModelRouter y AIProvider]] — frontera `aiProvider` donde se inyecta el `FakeProvider`; catálogo como fuente del precio.
- [[ADR-010 - Quality Floors, Coste y Revisión]] — política de coste (qué tier/modelo dentro del techo); este ADR es la **contabilidad** de ese coste (fuente de verdad + idempotencia).
- [[ADR-002 - Agent Runtime]] — stages, claims, TTL; aquí se añade reserva autónoma y el suelo de TTL.
- [[ADR-009 - Hokage Cadena de Orquestación]] · [[ADR-012 - Task Graph DAG y Directed Hand-off]] — patrón reserva→dispatch→rollback del orquestador que se extiende al camino autónomo.
- [[ADR-006 - Multi-Venture]] — aislamiento de coste por venture.
- [[Economía]] · [[INDEX]] · [[Resumen Ejecutivo - Decisiones Congeladas]]
