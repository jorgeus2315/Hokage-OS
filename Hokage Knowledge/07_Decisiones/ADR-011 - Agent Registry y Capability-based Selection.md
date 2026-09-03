# ADR-011 — Agent Registry y Capability-based Selection
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado (2026-08-16)
> Sintetizado desde [[BLOQUE_0_DECISIONES_FUNDACIONALES]] §C (y [[HOKAGE_AGENT_OPERATING_MODEL]] §2-3) — cierre del Bloque 1.

---

## Contexto

El mapeo actual es **1:1 rol→agente implícito**: `selectOrCreateSpecialist(role)` crea un agente *ad-hoc* si no existe uno con ese `role` en la venture. No hay declaración de capacidades, no hay disponibilidad, no hay tipos de agente (`permanent | temporary | reviewer`), y la selección es un `ORDER BY created_at LIMIT 1` sin criterio.

Esto rompe tres invariantes del Bloque 0:
- **L·1** (clave de dominio estable): el `role` ya existe en `role_definitions.key`, pero los agentes no lo usan como capacidad declarada.
- **L·2** (ModelRouter): el router elige modelo por `TaskProfile`, pero no hay *agente* que declare si soporta tools, longContext, etc.
- **L·7** (AIProvider): el proveedor y sus capacidades son dato; el agente debería serlo también.

---

## Decisión

Introducir **Agent Registry** como capa de dato entre `role_definitions` (plantilla de rol) y `agents` (instancia runtime), con **capabilities declarativas atómicas** y **selección por matching determinista** (no por creación implícita).

### 1. Capabilities como vocabulario atómico cerrado

```typescript
// src/types/index.ts — NUEVO

// Vocabulario cerrado de capabilities atómicas (aptitudes para selección)
export const AGENT_CAPABILITY_VOCABULARY = [
  // Research
  'research.web',
  'research.trends',
  // Content
  'content.seo',
  'content.social',
  'content.technical',
  // Strategy
  'strategy.business',
  'strategy.marketing',
  'strategy.product',
  // Analysis
  'analysis.data',
  'analysis.financial',
  'analysis.competitive',
  // Review
  'review.quality',
  'review.security',
  'review.compliance',
  // Code
  'code.backend',
  'code.frontend',
  'code.infra',
  // Design
  'design.ui',
  'design.ux',
  'design.brand',
  // Operations
  'operations.deploy',
  'operations.monitor',
  'operations.incident',
  // Support
  'support.triage',
  'support.resolve',
] as const;

export type AgentCapability = typeof AGENT_CAPABILITY_VOCABULARY[number];

// Las capabilities de un agente/rol son un array de este vocabulario
export type AgentCapabilities = AgentCapability[];

// Agent Type (clasificación obligatoria)
export type AgentType = 'permanent' | 'temporary' | 'reviewer';

/*
  permanent   — especialista de dominio persistente (contenido, tráfico, finanzas, investigación…).
                Tiene venture_id, budget mensual, autonomous_task, interval_minutes.
                Se selecciona por capability matching. Default para provisionAgent().

  temporary   — workers efímeros sin venture ni budget (p.ej. "code-reviewer-once",
                "data-extractor-temp"). Se crean/destruyen por tarea; no persisten.
                Futuro: work_item tipo 'utility_task'.

  reviewer    — agente dedicado a quality gates / review.* capabilities.
                Se filtra con requireReviewer=true en SelectionCriteria.
*/
```

### 2. Tabla `agents` — columnas nuevas (migración aditiva)

```sql
-- ADITIVO: solo añade columnas, no toca datos existentes
ALTER TABLE agents ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'permanent';
ALTER TABLE agents ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]';  -- JSON AgentCapabilities (array)
ALTER TABLE agents ADD COLUMN availability TEXT NOT NULL DEFAULT 'available'; -- 'available' | 'busy'
ALTER TABLE agents ADD COLUMN claimed_by_task INTEGER;       -- work_item_id que tiene el claim activo (NULL = libre)
ALTER TABLE agents ADD COLUMN claim_expires_at TEXT;         -- expiración del claim (ISO) — limpieza determinista
```

> **NOTA (diseño corregido)**:
> - Se usan `claimed_by_task` + `claim_expires_at` en lugar de `current_load`/`max_load`/`last_heartbeat`.
> - Modelo: **un claim activo por agente** (maxConcurrency=1 implícito en esta fase). `claimAgent()` atómico con `UPDATE ... WHERE claimed_by_task IS NULL OR claim_expires_at < datetime('now')`.
> - `current_load`/`max_load`/`last_heartbeat` quedan para una fase posterior cuando se soporte `maxConcurrency > 1` real.
> - `availability` usa solo `'available' | 'busy'` (simplificado; 'paused'/'offline' para fase posterior).

### 3. Tabla `role_definitions` — columna nueva

```sql
ALTER TABLE role_definitions ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]';
-- Semilla desde ROLE_SEEDS: cada rol declara sus capabilities base usando el vocabulario atómico.
-- Ejemplo: investigador → ['research.web', 'research.trends', 'analysis.data', 'analysis.competitive']
-- NOMBRE DE COLUMNA: `capabilities` (no `capabilities_template`). Es la plantilla canónica del rol.
```

### 4. Normalización de `agents.capabilities` (default `'[]'`)

La migración existente (Fase 1d) creó `agents.capabilities` con `DEFAULT '[]'`. **Antes de la implementación**, se normalizan los valores vacíos:
- `UPDATE agents SET capabilities='[]' WHERE capabilities IS NULL OR capabilities = '{}'`
- El type `AgentCapabilities` es un array JSON, no un objeto.

### 5. Selección por Capability Matching (reemplaza `selectOrCreateSpecialist`)

```typescript
// src/services/agentSelector.ts — NUEVO SERVICIO

export interface SelectionCriteria {
  ventureId?: number;                           // opcional: sin venture = agents globales (venture_id IS NULL)
  requiredCapabilities: AgentCapability[];      // HARD FILTER: todas deben estar presentes (obligatorio)
  preferredCapabilities?: AgentCapability[];    // SOFT: bonifican score
  excludeAgentIds?: number[];                   // para reintentos / diversidad
  agentTypes?: AgentType[];                     // default ['permanent']
  maxResults?: number;                          // default 1 (top-1)
  requireReviewer?: boolean;                    // si la tarea necesita review → filtra agents con 'review.*'
}

export interface SelectionResult {
  agentId: number;
  role: string;
  capabilities: AgentCapabilities;
  matchScore: number;              // 0..1, mayor = mejor match
  availability: 'available' | 'busy';
  ventureId: number | null;
  agentType: AgentType;
}

export interface ProvisionResult {
  agentId: number;
  capabilities: AgentCapabilities;  // capabilities efectivas asignadas
}

/*
ALGORITMO DETERMINISTA (sin LLM, pura lógica):
1. Filtrar agents WHERE venture_id = ? (o IS NULL si no hay venture)
                     AND agent_type IN (?)  -- agentTypes (default ['permanent'])
                     AND availability = 'available'
                     AND (claimed_by_task IS NULL OR claim_expires_at < datetime('now'))
                     AND json_each(capabilities) contiene TODAS requiredCapabilities  -- HARD FILTER
2. Excluir excludeAgentIds
3. Si requireReviewer=true: filtrar agents que tengan al menos una capability 'review.*'
4. Para cada candidato: calcular matchScore =
      requiredCoverage * 0.50 +     -- siempre 1.0 tras hard filter, se mantiene por compatibilidad futura
      preferredCoverage * 0.30 +
      availabilityScore  * 0.20
   requiredCoverage = 1.0 (garantizado por hard filter)
   preferredCoverage = |preferred ∩ agent.capabilities| / |preferred| (0 si preferred vacío)
   availabilityScore = 1.0 si availability='available', 0.5 si 'busy'
5. Ordenar por matchScore DESC, tie-break: menor agentId (estabilidad determinista)
6. Devolver top-N según maxResults (default 1) → SelectionResult[]
7. Si 0 candidatos → devolver array vacío (NO crea agente — eso es provisionAgent)
*/

// Selección pura: SOLO LECTURA, no crea, no reclama, no modifica BD
export async function selectAgent(criteria: SelectionCriteria): Promise<SelectionResult[]> {
  // ...
}

// Provisioning: crea agente desde rol + override (separado de selección)
export async function provisionAgent(
  ventureId: number,
  roleKey: string,
  overrides?: AgentCapabilities  // capabilities EXTRA a añadir a las del rol (merge union)
): Promise<ProvisionResult> {
  const role = await getRoleDefinition(roleKey);
  const baseCaps = role.capabilities ?? [];
  const mergedCaps = Array.from(new Set([...baseCaps, ...(overrides ?? [])]));
  // createAgent con mergedCaps, agent_type='permanent', availability='available'...
}
```

### 6. Claim / Release (atómicos, concurrency-safe)

```typescript
// src/services/agentSelector.ts (continuación)

/**
 * Intenta reservar un agente para un work_item.
 * Atómico: solo uno gana si hay contención (CAS-style UPDATE).
 * Devuelve true si el claim se concedió; false si ya estaba reclamado (y no expirado).
 */
export async function claimAgent(agentId: number, workItemId: number, ttlMinutes: number = 30): Promise<boolean> {
  const res = await run(
    `UPDATE agents
       SET claimed_by_task = ?, claim_expires_at = datetime('now', '+' || ? || ' minutes'), availability = 'busy'
       WHERE id = ?
         AND (claimed_by_task IS NULL OR claim_expires_at < datetime('now'))
         AND availability = 'available'`,
    [workItemId, ttlMinutes, agentId]
  );
  return res.changes === 1;
}

/**
 * Libera el claim SOLO si pertenece al workItemId dado.
 * Idempotente: si ya fue liberado o expira, no hace nada.
 */
export async function releaseAgent(agentId: number, workItemId: number): Promise<void> {
  await run(
    `UPDATE agents
       SET claimed_by_task = NULL, claim_expires_at = NULL, availability = 'available'
       WHERE id = ? AND claimed_by_task = ?`,
    [agentId, workItemId]
  );
}

/**
 * Limpia claims expirados (job periódico o al arrancar).
 * Devuelve número de agents limpiados.
 */
export async function cleanupExpiredClaims(): Promise<number> {
  const res = await run(
    `UPDATE agents
       SET claimed_by_task = NULL, claim_expires_at = NULL, availability = 'available'
       WHERE claimed_by_task IS NOT NULL AND claim_expires_at < datetime('now')`
  );
  return res.changes;
}
```

### 7. Availability & Heartbeat (runtime, no persistido en selección)

- `agentRuntime.ts` stage 0 (drainBus) actualiza `availability = 'available'` al iniciar tick (si no tiene claim activo).
- `stage 3` (executeAgents): `claimAgent()` pone `availability = 'busy'` vía UPDATE atómico.
- Al completar work_item: `releaseAgent()` pone `availability = 'available'`.
- Agente sin heartbeat > 5 min → `availability = 'offline'` (job de limpieza aparte, fase posterior).

---

## Alternativas consideradas

| Alternativa | Por qué no |
|-------------|------------|
| Mantener 1:1 rol→agente implícito | No escala: no hay forma de decir "necesito un agente que sepa Etsy Y tenga tools" sin crear duplicados. |
| LLM elige agente libremente | Impredecible, salta política/presupuesto, no auditable. El matching es dato, no prompt. |
| Capabilities solo en role_definitions | Una venture puede necesitar un "investigador" con `analysis.financial` y otra sin él. La instancia concreta debe poder extender/restringir. |
| Tabla aparte `agent_capabilities` (normalizada) | Overhead de JOINs en hot path de selección. JSON array en `agents.capabilities` es atomic read, índice GIN no necesario (SQLite). |
| `current_load`/`max_load` con concurrencia > 1 | Complejidad adicional (race conditions en increment/decrement). Fase 1: un claim por agente. Fase posterior: contadores atómicos. |
| Jaccard / scoring suave sin hard filter | Selecciona agentes que carecen de capabilities requeridas. Hard filter garantiza aptitud mínima. |
| AgentType `business|system|utility` | No refleja el ciclo de vida real. `permanent|temporary|reviewer` clasifica por persistencia y propósito de selección, no por scope organizacional. |

---

## Consecuencias

1. **Fin de la creación implícita**: `selectOrCreateSpecialist` desaparece. Todo paso por `agentSelector.select(criteria)` → si array vacío → `provisionAgent` (explícito, auditable).
2. **Role definitions = plantilla, no instancia**: `role_definitions.capabilities` es el default; `agents.capabilities` es la realidad (rol + override).
3. **Agent types son invariante**: `system` (roles críticos como ceo/hermes/operaciones/soporte) nunca entra en matching vía `agentTypes`; se excluye en `orchestratableRoles()`. `temporary` se crea/destruye por `work_item` tipo `utility_task` (fase posterior). `reviewer` se filtra con `requireReviewer`.
4. **ModelRouter y AgentSelector son ortogonales**: Router elige *modelo* por `TaskProfile`; Selector elige *agente* por `Capabilities`. Ambos corren en la cadena de Hokage (dispatch).
5. **Budget por venture sigue igual**: `ventureBudget.reserve` usa `agent_id` seleccionado; el techo duro no cambia.
6. **Tools/permissions/autonomy NO cambian**: Capabilities son solo para selección. `tools + autonomy + rolePolicy` siguen siendo la autoridad de ejecución.

---

## Estado de implementación

**Archivos creados/modificados:**
- `src/types/index.ts` — `AGENT_CAPABILITY_VOCABULARY`, `AgentCapability`, `AgentCapabilities`, `AgentType`, `SelectionCriteria`, `SelectionResult`, `ProvisionResult`
- `src/services/agentSelector.ts` — nuevo servicio (matching determinista hard-filter + provisionAgent + claim/release/cleanup)
- `src/db/init.ts` — migraciones aditivas: `agents.agent_type DEFAULT 'permanent'`, `agents.capabilities DEFAULT '[]'`, `agents.availability DEFAULT 'available'`, `agents.claimed_by_task`, `agents.claim_expires_at`, `role_definitions.capabilities DEFAULT '[]'`, normalización `UPDATE agents SET capabilities='[]' WHERE capabilities='{}' OR capabilities IS NULL`
- `src/services/roleService.ts` — `hydrate` parsea `capabilities` array; `createRole`/`updateRole` validan contra vocabulario
- `src/config/roleSeeds.ts` — semilla de `capabilities` por rol (8 roles base) usando vocabulario atómico (`AgentCapabilities[]`)
- `src/services/hokageOrchestrator.ts` — `dispatchPhase` usa `agentSelector.select({..., agentTypes:['permanent']})` → si vacío → `provisionAgent`; claim/release en runtime
- `src/services/agentRuntime.ts` — stage 3 usa `claimAgent`/`releaseAgent` importados desde `agentSelector`
- `src/services/agentService.ts` — `createAgent` usa `agent_type='permanent'`, `capabilities='[]'`, `availability='available'` por defecto

**Tests implementados y pasando (33/33 en aislamiento):**
- `agentSelector.select` — hard filter requiredCapabilities, scoring preferredCoverage/availability, maxResults, agentTypes array, requireReviewer, exclusiones, ventureId undefined (globals)
- `claimAgent`/`releaseAgent` — atómicos, concurrencia, expiración TTL via SQLite datetime, idempotencia
- `provisionAgent` — merge capabilities rol + override, venture_id correcto, agent_type='permanent'
- `cleanupExpiredClaims` — limpia expirados, devuelve count, idempotente
- Migración idempotente — columnas nuevas, defaults correctos, normalización a `'[]'`, sin pérdida de datos

---

## Relacionado

- [[BLOQUE_0_DECISIONES_FUNDACIONALES]] · [[HOKAGE_AGENT_OPERATING_MODEL]] · [[ADR-007 - AgentRuntimeState]]
- [[ADR-008 - ModelRouter y AIProvider]] · [[ADR-009 - Hokage Cadena de Orquestación]]
- [[ADR-012 - Task Graph DAG y Directed Hand-off]] · [[ADR-014 - Result Evaluation y Diagnostic Remediation]]
- [[Resumen Ejecutivo - Decisiones Congeladas]] · [[INDEX]]