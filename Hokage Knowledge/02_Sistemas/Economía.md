> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §10. Congelado.
> Extendida, no sustituida, por [[Economía v2 - Sistema Financiero]] (2026-08-05) — esta nota sigue siendo la fuente real de `agent_costs`/`agent_budgets`; v2 añade cuentas, transacciones y flujo de caja sin duplicar nada de esto.

## Economía

🔒 **CONGELADO** el modelo real (diverge de [[ARCHITECTURE (legacy)]] §13, que describe columnas y tablas — `business_budgets`, límite diario además de mensual, `agent_run_id` en `agent_costs` — que no existen en el schema real). Lo que existe y se congela:

- `agent_costs` (agent_id, work_item_id, tokens_in/out, llm_cost_usd, tool_cost_usd) — registrado tras cada `askAgent()`.
- `agent_budgets` (agent_id, monthly_limit_usd, current_month_usd, status) — **solo límite mensual, no diario.** `stage2_assignWork` bloquea la asignación si `status='paused'` o si se supera el 100%; avisa (log) a partir del 80%. No crea automáticamente una Decision de "ampliar presupuesto" — el `ARCHITECTURE.md` original lo describía, no se implementó, y **se decide aquí no implementarlo en v1**: un log de aviso al 80% es suficiente para un solo operador humano (Jorge) que ya revisa el sistema activamente. Se automatiza el día que haya suficientes agentes/ventures como para que revisar manualmente deje de ser viable.
- No existe `business_budgets` como tabla separada — el ROI/presupuesto por venture vive directamente en `ventures.budget_allocated_usd`/`budget_spent_usd`/`revenue_target_usd`. Es más simple que el diseño original de dos tablas y se ratifica como la decisión correcta (un venture ya es su propio ámbito de presupuesto, no hace falta una tabla satélite).
- Endpoint `GET /api/metrics/summary` (nuevo esta sesión) da coste-de-hoy agregado — construido con SQL nativo (`julianday()`) precisamente para evitar el bug de zona horaria que `new Date()` en Node introduce al parsear timestamps de SQLite (documentado y corregido en el propio commit). **Regla de código que se congela:** cualquier cálculo de antigüedad/fecha sobre timestamps de SQLite se hace en SQL, nunca con `new Date(sqlite_timestamp)` en JS.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[ARCHITECTURE (legacy)]] §13 — diseño original divergente
- [[Modelo Multi-Venture]] — presupuesto por venture vive en `ventures.*`
- [[Economía v2 - Sistema Financiero]] — extiende este sistema con cuentas, transacciones y flujo de caja
