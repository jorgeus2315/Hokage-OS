> 🔒 **CONGELADO — arquitectura completa lista para implementar.** Séptimo sistema de la fase de diseño, abierto explícitamente por Jorge el 2026-08-05 al definir la arquitectura de edificios/departamentos: Banco necesita ser "el centro de control" de un sistema financiero real, no solo un panel sobre `agent_costs`/`ventures.budget_*`. No es una reapertura de una decisión ya congelada — [[Resumen Ejecutivo - Decisiones Congeladas|§16]] solo había congelado el modelo de coste de IA (§10 original), nunca un sistema financiero completo. Esto es una extensión nueva, tratada con el mismo rigor que [[Memory System]] o [[Plugin System - Arquitectura Completa]].

## Por qué importa

Hoy la "economía" de Hokage OS es solo gasto de IA (`agent_costs`) y presupuesto simple por venture (`ventures.budget_allocated_usd/budget_spent_usd/revenue_target_usd`). Jorge pide un sistema financiero de verdad: cuentas (bancarias, Stripe, PayPal, Wise, wallets), flujo de caja, ingresos y gastos, transferencias entre cuentas, presupuestos, beneficio por venture, coste de IA (ya existe, se integra sin duplicar), suscripciones, impuestos y reservas (campos sin integración inicial), previsiones financieras — y que ninguna integración futura obligue a rediseñar el backend.

## Principio de diseño — no reinventar lo que ya está resuelto

Las cuentas y transacciones financieras son **datos de negocio**, no secretos. La *conexión* a un proveedor externo (una API key de Stripe, un token OAuth de un banco) **ya está resuelta** por [[Gestión de Secretos y Capabilities|§11.2, SecretProvider/CapabilityResolver]] — una integración financiera nueva declara su `Capability` (`stripe`, `paypal`, `wise`, `plaid`...) y su `SecretDefinition` exactamente igual que Etsy o Shopify hoy. Economía v2 no toca esa capa. Lo que falta es el **modelo de dominio financiero** (schema) y un **proveedor de sincronización** que abstrae de dónde vienen los movimientos — mismo patrón de sustituibilidad que `SecretProvider`, aplicado a datos en vez de a credenciales.

## Modelo de dominio

```sql
CREATE TABLE finance_accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  venture_id      INTEGER REFERENCES ventures(id),  -- NULL = cuenta de instalación (matriz, compartida)
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,   -- 'bank' | 'payment_processor' | 'wallet' | 'cash'
  provider        TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'stripe' | 'paypal' | 'wise' | 'bank_plaid' | ...
  external_account_id TEXT,        -- id en el proveedor externo, NULL si es manual
  currency        TEXT NOT NULL DEFAULT 'EUR',
  balance_cached  REAL NOT NULL DEFAULT 0,
  balance_updated_at TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE finance_transactions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id           INTEGER NOT NULL REFERENCES finance_accounts(id),
  type                 TEXT NOT NULL,   -- 'income' | 'expense' | 'transfer_in' | 'transfer_out'
  category             TEXT NOT NULL,   -- 'sales' | 'ai_cost' | 'subscription' | 'tax' | 'transfer' | ...
  amount               REAL NOT NULL,   -- siempre positivo; el signo lo da `type`
  currency             TEXT NOT NULL,
  occurred_at          TEXT NOT NULL,
  description           TEXT,
  related_entity_type  TEXT,   -- 'venture' | 'agent_cost' | 'decision' | 'subscription'
  related_entity_id    INTEGER,
  source               TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'import' | 'sync' | 'system'
  external_transaction_id TEXT,  -- para upsert idempotente en syncs; NULL si es manual
  created_at           TEXT DEFAULT (datetime('now')),
  UNIQUE(account_id, external_transaction_id)
);

CREATE TABLE finance_transfers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_tx_id      INTEGER NOT NULL REFERENCES finance_transactions(id),
  to_tx_id        INTEGER NOT NULL REFERENCES finance_transactions(id)
);

CREATE TABLE finance_subscriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  venture_id      INTEGER REFERENCES ventures(id),
  name            TEXT NOT NULL,
  amount          REAL NOT NULL,
  currency        TEXT NOT NULL,
  interval        TEXT NOT NULL,  -- 'monthly' | 'yearly'
  next_charge_at  TEXT,
  active          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE finance_reserves (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  venture_id      INTEGER REFERENCES ventures(id),
  kind            TEXT NOT NULL,   -- 'tax' | 'reserve'
  label           TEXT NOT NULL,
  target_amount   REAL,
  current_amount  REAL NOT NULL DEFAULT 0
);
```

**Lo que no se duplica:** `agent_budgets` (límite mensual por agente) y `ventures.budget_allocated_usd/budget_spent_usd/revenue_target_usd` (ya congelados en §10, ver [[Economía]]) se conservan tal cual. Economía v2 los **referencia** desde el panel de Banco, no los reemplaza — ratifica la misma regla de §10 de no crear tablas satélite redundantes.

**Impuestos y reservas en v1:** `finance_reserves` es tracking informativo, sin integración real con ninguna administración tributaria — campos que existen para que Jorge anote manualmente cuánto reservar, no un cálculo fiscal automático. Se amplía el día que haya una integración real que lo justifique (mismo principio que Tienda/Etsy).

## `FinanceProvider` — sincronización, mismo patrón que `SecretProvider`

```typescript
// config/financeProvider.ts
interface ExternalAccount {
  externalId: string;
  name: string;
  currency: string;
  balance: number;
}
interface ExternalTransaction {
  externalId: string;
  type: 'income' | 'expense';
  amount: number;
  currency: string;
  occurredAt: string;
  description?: string;
}
interface FinanceProvider {
  id: string;  // 'manual' | 'stripe' | 'paypal' | 'wise' | 'plaid' ...
  listAccounts(ventureId: number | null): Promise<ExternalAccount[]>;
  syncTransactions(externalAccountId: string, since?: string): Promise<ExternalTransaction[]>;
}
```

`ManualFinanceProvider` es la única implementación obligatoria en v1 — Jorge introduce movimientos a mano vía formulario (`POST /api/finance/transactions`). Un `FinanceSyncService` recorre las cuentas con `provider != 'manual'`, llama a `syncTransactions()`, y hace upsert en `finance_transactions` por `external_transaction_id` (idempotente, `UNIQUE(account_id, external_transaction_id)` lo garantiza a nivel de BD). **No nace como un `setInterval` propio** — se registra como una etapa/job más del tick de `AgentRuntime`, nunca un poller independiente (regla permanente fijada en [[Runtime, Scheduler y Event Bus|§2]] tras el Hallazgo 3 de la auditoría de arquitecto, 2026-08-05). Cada `FinanceProvider` nuevo (Stripe, Wise, un agregador bancario tipo Plaid/GoCardless) es un plugin que implementa esta interfaz + declara su `Capability`/`SecretDefinition` (§11.2) — **cero cambios en el schema, el sync service o el panel de Banco** cuando se añade uno nuevo. Es exactamente la garantía de sustituibilidad que ya demostró su valor en Secretos.

## Integración con `agent_costs` — sin reescribir cómo se registra el gasto de IA

`agent_costs` sigue siendo la fuente de verdad del gasto de IA — no se toca su forma de escritura (`askAgent()` sigue registrando ahí). Una vista (o un job de agregación periódico, más simple que una vista si SQLite lo hace más barato) proyecta `agent_costs` hacia `finance_transactions` con `category='ai_cost'`, `source='system'`, `type='expense'`, para que el flujo de caja incluya el gasto de IA sin que exista un segundo lugar donde ese coste "también" se escriba a mano.

## Beneficio por venture y previsión — cálculo, no tabla nueva

**Beneficio por venture** (rango de fechas): `SUM(income) - SUM(expense)` de `finance_transactions` filtrado por las cuentas de ese `venture_id`, incluyendo el gasto de IA ya proyectado. Consulta, no tabla — coherente con cómo ya se calculó `GET /api/metrics/summary` en §10.

**Previsión financiera v1:** simple a propósito, mismo espíritu que la lectura de memoria de [[Memory System]] ("simple a propósito, no búsqueda semántica"). Proyección = gasto recurrente conocido (`finance_subscriptions` + `agent_budgets` mensuales) + tendencia de ingresos de los últimos N meses (media móvil). Nada de ML ni modelos predictivos en v1 — se revisita si el volumen real de datos lo justifica.

## Panel de Banco (frontend, consumidor de este sistema)

Centro de control real: lista de cuentas con saldo, gráfico de flujo de caja, últimas transacciones, presupuestos por venture (reutiliza lo ya existente), previsión simple, reservas/impuestos si están configuradas. Sigue la misma regla dura de [[Frontend - Decisiones v2]]: **si no hay cuentas conectadas, se muestra un estado vacío/onboarding, nunca datos simulados** — mismo principio que bloqueó Tienda hasta que hubiera integración real.

## Consecuencias a 2-3 años

Con el modelo de cuentas/transacciones desacoplado de proveedor desde el día uno, conectar Stripe, Wise o un agregador bancario real es escribir un `FinanceProvider` + un `SecretDefinition` — no rediseñar Banco. El beneficio por venture deja de ser una estimación basada solo en `ventures.budget_spent_usd` (que hoy nadie escribe de forma sistemática) y pasa a ser un número real, trazable a movimientos concretos. El riesgo conocido: si `finance_transactions` crece mucho sin índices por `account_id + occurred_at`, las consultas de flujo de caja se degradan — se anota aquí como el disparador para añadir esos índices, no se construyen preventivamente sin datos reales que lo justifiquen.

---

## Relacionado

- [[Economía]]
- [[Gestión de Secretos y Capabilities]]
- [[Plugin System - Arquitectura Completa]]
- [[Modelo Multi-Venture]]
- [[Frontend - Decisiones v2]]
- [[ADR-006 - Multi-Venture]]
- [[INDEX]]
