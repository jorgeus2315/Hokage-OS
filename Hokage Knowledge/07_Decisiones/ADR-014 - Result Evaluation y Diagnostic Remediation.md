# ADR-014 — Result Evaluation y Diagnostic Remediation
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado (2026-08-15)
> Sintetizado desde [[BLOQUE_0_DECISIONES_FUNDACIONALES]] §E-F (y [[HOKAGE_AGENT_OPERATING_MODEL]] §6-7) — cierre del Bloque 1.

---

## Contexto

El modelo actual de finalización de trabajo es binario: `work_item.status = 'completed' | 'failed'`. No hay:
- **Señal de calidad** (¿qué tan bien se hizo?).
- **Diagnóstico** (¿por qué falló o qué faltó?).
- **Remediación escalonada** (retry ciego → replan completo).

El `agentRuntime` reintenta hasta `ttl_minutes` / `retry_count` y luego Hokage hace `attemptReplan` (replanificación completa). No hay distinción entre:
- Error transitorio (rate limit, timeout) → retry inmediato.
- Error de herramienta (tool mal usada) → retry con feedback.
- Error de modelo (output inválido) → escalar a modelo superior.
- Error de diseño (tarea mal planteada) → replan.

ADR-010 (§F) define la **escalera de remediación** pero no tiene el **evaluador** que la alimenta. ADR-012 introduce `review_of` que necesita veredictos estructurados. Este ADR cierra el bucle.

---

## Decisión

Introducir **Task Evaluation** como paso obligatorio tras cada `work_item` completado, que produce un **veredicto estructurado** (`verdict`, `confidence`, `evidence`, `diagnosis`) y alimenta una **escalera de remediación determinista de 4 peldaños**.

### 1. Evaluation Verdict (tipado)

```typescript
// src/types/index.ts — NUEVO
export type TaskVerdict = 'pass' | 'partial' | 'fail' | 'error';

export interface TaskEvaluation {
  workItemId: number;
  taskId: number | null;           // si viene de hokage_task
  verdict: TaskVerdict;
  confidence: number;              // 0..100 — qué tan seguro está el evaluador
  evidence: EvaluationEvidence[];  // qué se miró para decidir
  diagnosis: Diagnosis | null;     // solo si verdict !== 'pass'
  evaluator: 'automated' | 'llm' | 'human';  // quién evaluó
  model: string | null;            // modelo usado si evaluator='llm'
  costUsd: number;                 // coste de la evaluación
  createdAt: string;
}

export interface EvaluationEvidence {
  type: 'schema' | 'criteria' | 'reference' | 'heuristic' | 'llm_judge';
  check: string;                   // qué se comprobó
  passed: boolean;
  details?: string;
  weight: number;                  // 0..1, suma 1.0 en la evaluación
}

export interface Diagnosis {
  category: DiagnosisCategory;
  rootCause: string;               // frase corta: "JSON schema validation failed: missing required field 'keywords'"
  suggestedRemediation: RemediationAction;  // qué hacer a continuación
  retryable: boolean;              // true = peldaño 1-2, false = peldaño 3-4
  context: Record<string, any>;    // datos extra para la remediación
}

export type DiagnosisCategory =
  | 'transient'        // rate limit, timeout, network blip
  | 'tool_misuse'      // tool invocada mal, params inválidos
  | 'output_invalid'   // schema violation, formato incorrecto
  | 'quality_below_floor'  // quality floor no alcanzado (ADR-010)
  | 'misaligned'       // resultado no responde al prompt / objetivo
  | 'missing_capability'   // agente no tiene tool/dominio necesario
  | 'budget_exceeded'  // coste > reserved_usd o venture ceiling
  | 'policy_violation' // tool no grantable, autonomía insuficiente
  | 'unknown';

export type RemediationAction =
  | 'retry_immediate'           // peldaño 1: mismo agente, mismo modelo, mismo prompt
  | 'retry_with_feedback'       // peldaño 2: mismo agente, inyecta diagnosis.feedback en prompt
  | 'escalate_model'            // peldaño 3: mismo agente, modelo tier+1 (via ModelRouter)
  | 'reassign_agent'            // peldaño 3b: agente distinto con capabilities matching (ADR-011)
  | 'replan_task'               // peldaño 4: Hokage re-planifica esta tarea (nuevo prompt, quizás distinto role)
  | 'replan_command'            // peldaño 4b: Hokage re-planifica todo el command (attemptReplan)
  | 'human_intervention';       // peldaño 5: Decision propuesta a Jorge
```

### 2. Tabla `task_evaluations` (NUEVA)

```sql
CREATE TABLE IF NOT EXISTS task_evaluations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id    INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  task_id         INTEGER REFERENCES hokage_tasks(id) ON DELETE SET NULL,
  verdict         TEXT NOT NULL CHECK (verdict IN ('pass','partial','fail','error')),
  confidence      INTEGER NOT NULL DEFAULT 0,     -- 0..100
  evidence        TEXT NOT NULL DEFAULT '[]',     -- JSON EvaluationEvidence[]
  diagnosis       TEXT,                           -- JSON Diagnosis (NULL si pass)
  evaluator       TEXT NOT NULL CHECK (evaluator IN ('automated','llm','human')),
  model           TEXT,                           -- modelo usado si evaluator='llm'
  cost_usd        REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_evaluations_workitem ON task_evaluations(work_item_id);
CREATE INDEX idx_task_evaluations_task ON task_evaluations(task_id);
CREATE INDEX idx_task_evaluations_verdict ON task_evaluations(verdict);
```

### 3. Evaluador Automático (peldaño 0 — gratis, determinista)

Corre **síncrono** en `agentRuntime.ts` stage 3 al recibir `work_item` result, **antes** de marcar completed.

```typescript
// src/services/taskEvaluator.ts — NUEVO
export async function evaluateAutomated(
  workItem: WorkItem,
  task: HokageTask | null,
  roleDef: RoleDefinition | null
): Promise<TaskEvaluation> {
  const evidence: EvaluationEvidence[] = [];
  let verdict: TaskVerdict = 'pass';
  let diagnosis: Diagnosis | null = null;
  
  // 1. Schema validation (si task.prompt declara output_schema)
  if (task?.output_schema) {
    const schemaCheck = validateJsonSchema(workItem.result, task.output_schema);
    evidence.push({ type: 'schema', check: 'output_schema', passed: schemaCheck.valid, 
                    details: schemaCheck.errors, weight: 0.3 });
    if (!schemaCheck.valid) { verdict = 'fail'; diagnosis = mkDiag('output_invalid', schemaCheck.errors); }
  }
  
  // 2. Criteria checks (si task.prompt declara acceptance_criteria[])
  if (task?.acceptance_criteria) {
    for (const criterion of task.acceptance_criteria) {
      const passed = checkCriterion(workItem.result, criterion);
      evidence.push({ type: 'criteria', check: criterion, passed, weight: 0.2 });
      if (!passed && verdict === 'pass') { verdict = 'partial'; }
    }
  }
  
  // 3. Heuristic: empty result, error markers, token usage anomaly
  const heuristicChecks = runHeuristics(workItem, roleDef);
  evidence.push(...heuristicChecks);
  if (heuristicChecks.some(c => !c.passed) && verdict === 'pass') verdict = 'partial';
  
  // 4. Quality Floor check (ADR-010) — solo si task tiene quality_floor definido
  if (task?.quality_floor) {
    const qfCheck = await checkQualityFloor(workItem, task.quality_floor);
    evidence.push({ type: 'heuristic', check: 'quality_floor', passed: qfCheck.passed, 
                    details: qfCheck.reason, weight: 0.3 });
    if (!qfCheck.passed) { verdict = 'fail'; diagnosis = mkDiag('quality_below_floor', qfCheck.reason); }
  }
  
  // 5. Budget check
  if (task?.reserved_usd && workItem.llm_cost_usd > task.reserved_usd * 1.2) {
    evidence.push({ type: 'heuristic', check: 'budget_exceeded', passed: false, 
                    details: `Cost ${workItem.llm_cost_usd} > reserved ${task.reserved_usd}`, weight: 0.1 });
    if (verdict === 'pass') verdict = 'fail';
    diagnosis = mkDiag('budget_exceeded', `Cost overrun: ${workItem.llm_cost_usd} vs ${task.reserved_usd}`);
  }
  
  // Confidence = media ponderada de evidence.passed
  const confidence = Math.round(evidence.reduce((sum, e) => sum + (e.passed ? e.weight : 0), 0) * 100);
  
  // Diagnosis.defaultRemediation por categoría
  if (diagnosis && !diagnosis.suggestedRemediation) {
    diagnosis.suggestedRemediation = defaultRemediationFor(diagnosis.category);
  }
  
  return { workItemId: workItem.id, taskId: task?.id ?? null, verdict, confidence, evidence, diagnosis, 
           evaluator: 'automated', model: null, costUsd: 0, createdAt: new Date().toISOString() };
}
```

### 4. Evaluador LLM (peldaño opcional — para `importance='critical'` o `verdict='partial'`)

```typescript
// Solo si: task.importance === 'critical' OR automated.verdict === 'partial' OR ADR-010 review trigger
export async function evaluateWithLLM(
  workItem: WorkItem,
  task: HokageTask,
  automatedEval: TaskEvaluation
): Promise<TaskEvaluation> {
  const prompt = buildEvaluationPrompt(task, workItem, automatedEval);
  const model = await selectModel({ kind: 'review', complexity: 'low', importance: 'high', needs: { tools: false } });
  const result = await askAgent({ model, messages: [{ role: 'user', content: prompt }], responseFormat: 'json' });
  
  // Merge: LLM overridea verdict/confidence/diagnosis; evidence se concatena
  return {
    ...automatedEval,
    verdict: result.verdict,
    confidence: result.confidence,
    diagnosis: result.diagnosis,
    evidence: [...automatedEval.evidence, { type: 'llm_judge', check: 'llm_evaluation', passed: result.verdict === 'pass', weight: 0.4 }],
    evaluator: 'llm',
    model: model.id,
    costUsd: result.costUsd,
  };
}
```

### 5. Escalera de Remediación (determinista, en `agentRuntime.ts` / `hokageOrchestrator.ts`)

```typescript
// src/services/remediationLadder.ts — NUEVO
export interface RemediationDecision {
  action: RemediationAction;
  reason: string;
  maxRetries: number;        // tope por peldaño (configurable)
  currentAttempt: number;    // cuántas veces ya se intentó este peldaño
}

export function decideRemediation(
  evaluation: TaskEvaluation,
  task: HokageTask,
  attemptHistory: RemediationAttempt[]  // historial de remediaciones previas para este work_item
): RemediationDecision {
  if (evaluation.verdict === 'pass') return { action: 'none', reason: 'Passed', maxRetries: 0, currentAttempt: 0 };
  
  const diag = evaluation.diagnosis;
  const category = diag?.category ?? 'unknown';
  const retryable = diag?.retryable ?? true;
  
  // Contar intentos previos por acción
  const attemptsByAction = new Map<RemediationAction, number>();
  for (const a of attemptHistory) attemptsByAction.set(a.action, (attemptsByAction.get(a.action) || 0) + 1);
  
  // PELDAÑO 1: retry_immediate (solo transient, tool_misuse con feedback simple)
  if (retryable && (category === 'transient' || category === 'tool_misuse')) {
    const n = attemptsByAction.get('retry_immediate') || 0;
    if (n < MAX_RETRY_IMMEDIATE) return { action: 'retry_immediate', reason: category, maxRetries: MAX_RETRY_IMMEDIATE, currentAttempt: n };
  }
  
  // PELDAÑO 2: retry_with_feedback (output_invalid, quality_below_floor, misaligned)
  if (retryable && (category === 'output_invalid' || category === 'quality_below_floor' || category === 'misaligned')) {
    const n = attemptsByAction.get('retry_with_feedback') || 0;
    if (n < MAX_RETRY_FEEDBACK) return { action: 'retry_with_feedback', reason: category, maxRetries: MAX_RETRY_FEEDBACK, currentAttempt: n };
  }
  
  // PELDAÑO 3: escalate_model (quality_below_floor, misaligned) O reassign_agent (missing_capability)
  if (category === 'quality_below_floor' || category === 'misaligned') {
    const n = attemptsByAction.get('escalate_model') || 0;
    if (n < MAX_ESCALATE_MODEL) return { action: 'escalate_model', reason: category, maxRetries: MAX_ESCALATE_MODEL, currentAttempt: n };
  }
  if (category === 'missing_capability') {
    const n = attemptsByAction.get('reassign_agent') || 0;
    if (n < MAX_REASSIGN) return { action: 'reassign_agent', reason: category, maxRetries: MAX_REASSIGN, currentAttempt: n };
  }
  
  // PELDAÑO 4: replan_task (policy_violation, budget_exceeded, unknown con retryable=false)
  if (!retryable || category === 'policy_violation' || category === 'budget_exceeded' || category === 'unknown') {
    const n = attemptsByAction.get('replan_task') || 0;
    if (n < MAX_REPLAN_TASK) return { action: 'replan_task', reason: category, maxRetries: MAX_REPLAN_TASK, currentAttempt: n };
  }
  
  // PELDAÑO 5: human_intervention (tope alcanzado en cualquier peldaño, o strategic)
  return { action: 'human_intervention', reason: `Exhausted remediation for ${category}`, maxRetries: 0, currentAttempt: 0 };
}

// Constantes (configurables en system_config o role_definitions)
const MAX_RETRY_IMMEDIATE = 2;
const MAX_RETRY_FEEDBACK = 2;
const MAX_ESCALATE_MODEL = 1;
const MAX_REASSIGN = 1;
const MAX_REPLAN_TASK = 1;  // después va a replan_command (attemptReplan existente)
```

### 6. Integración en `agentRuntime.ts` (stage 3 → evaluation → remediation)

```typescript
// En executeAgents (stage 3), al recibir work_item result:
async function handleWorkItemResult(workItem: WorkItem, result: any): Promise<void> {
  const task = workItem.task_id ? await getHokageTask(workItem.task_id) : null;
  const roleDef = task ? await getRoleDefinition(task.role) : null;
  
  // 1. Evaluación automática (siempre)
  let evaluation = await evaluateAutomated(workItem, task, roleDef);
  
  // 2. Evaluación LLM si criteria
  if (shouldRunLLMEvaluation(task, evaluation)) {
    evaluation = await evaluateWithLLM(workItem, task!, evaluation);
  }
  
  // 3. Persistir evaluación
  await insertTaskEvaluation(evaluation);
  
  // 4. Decidir remediación
  const attemptHistory = await getRemediationHistory(workItem.id);
  const decision = decideRemediation(evaluation, task!, attemptHistory);
  
  // 5. Ejecutar peldaño
  switch (decision.action) {
    case 'retry_immediate':
      await requeueWorkItem(workItem.id, { sameAgent: true, sameModel: true, injectFeedback: false });
      break;
    case 'retry_with_feedback':
      await requeueWorkItem(workItem.id, { 
        sameAgent: true, 
        sameModel: true, 
        injectFeedback: evaluation.diagnosis?.rootCause 
      });
      break;
    case 'escalate_model':
      const newModel = await selectModel(escalatedTaskProfile(task));
      await requeueWorkItem(workItem.id, { sameAgent: true, modelOverride: newModel.id, injectFeedback: evaluation.diagnosis?.rootCause });
      break;
    case 'reassign_agent':
      const newAgent = await agentSelector.select({ ventureId: task.venture_id, requiredCapabilities: inferCapabilities(task), excludeAgentIds: [workItem.agent_id] });
      await requeueWorkItem(workItem.id, { agentId: newAgent.agentId, injectFeedback: evaluation.diagnosis?.rootCause });
      break;
    case 'replan_task':
      await hokageOrchestrator.replanSingleTask(task!.command_id, task!.id, evaluation.diagnosis);
      break;
    case 'human_intervention':
      await createDecision({ 
        title: `Remediación agotada: ${task!.title}`,
        description: `Tarea falló tras ${attemptHistory.length} intentos. Diagnosis: ${evaluation.diagnosis?.rootCause}`,
        category: 'TECHNICAL',
        venture_id: task!.venture_id,
        entity_type: 'hokage_task',
        entity_id: task!.id
      });
      break;
  }
}
```

### 7. `work_items` — columnas nuevas (migración aditiva)

```sql
ALTER TABLE work_items ADD COLUMN evaluation_verdict TEXT CHECK (evaluation_verdict IN ('pass','partial','fail','error'));
ALTER TABLE work_items ADD COLUMN evaluation_confidence INTEGER DEFAULT 0;
ALTER TABLE work_items ADD COLUMN remediation_step TEXT;        -- último peldaño ejecutado
ALTER TABLE work_items ADD COLUMN remediation_count INTEGER DEFAULT 0;  -- total intentos de remediación
```

### 8. Quality Floors Integration (ADR-010 §F)

- `task.quality_floor` (nuevo en `hokage_tasks`, opcional) = `{ minConfidence: 80, requiredEvidence: ['schema','criteria'] }`
- El evaluador automático lo chequea (evidence type='heuristic', check='quality_floor').
- Si falla → `verdict='fail'`, `diagnosis.category='quality_below_floor'` → peldaño 2/3.
- `importance='critical'` en TaskProfile → obliga evaluación LLM + `quality_floor.minConfidence >= 90`.

---

## Alternativas consideradas

| Alternativa | Por qué no |
|-------------|------------|
| Solo `completed`/`failed` + replan | No distingue causa → replan ciego, caro, lento. No hay aprendizaje. |
| LLM evalúa todo siempre | Coste inaceptable. Automático cubre 80% (schema, criteria, heuristics, budget). LLM solo para bordes. |
| Diagnosis como string libre | No accionable. Categoría tipada → remediación determinista. |
| Remediación decidida por LLM | Impredecible, bucles infinitos posibles. Escalera determinista con topes duros. |
| Tabla `work_item_retries` separada | `remediation_count` + `task_evaluations` + `attempt_history` (JSON en work_items.context) cubren trazabilidad. |

---

## Consecuencias

1. **Cada work_item genera evaluation** (automática, gratis). LLM evaluation solo bajo criterio.
2. **Remediación es escalera, no salto**: peldaño 1→2→3→4→5 con topes. No hay "replan" directo salvo policy/budget.
3. **Diagnosis estructurada alimenta memoria**: `memory_entries` categoría 'learning' con `diagnosis.rootCause` + `remediationAction` para que futuros agentes eviten mismo error.
4. **Review_of (ADR-012) usa mismo evaluation**: review task produce `TaskEvaluation` sobre tarea revisada; `verdict='fail'` dispara remediación en tarea original.
5. **Coste acotado**: evaluación automática = 0 USD. LLM evaluation = ~$0.001-0.01 por tarea crítica. Remediación peldaños 1-3 reusan work_item (nuevo run, mismo task). Peldaño 4 = replan (nuevo task).

---

## Estado de implementación (diseño aprobado, no autorizado para código)

**Archivos a crear/modificar:**
- `src/types/index.ts` — `TaskVerdict`, `TaskEvaluation`, `EvaluationEvidence`, `Diagnosis`, `DiagnosisCategory`, `RemediationAction`
- `src/services/taskEvaluator.ts` — `evaluateAutomated`, `evaluateWithLLM`, `buildEvaluationPrompt`
- `src/services/remediationLadder.ts` — `decideRemediation`, constantes, `RemediationDecision`
- `src/db/init.ts` — migración: `CREATE TABLE task_evaluations` + columnas en `work_items`
- `src/services/agentRuntime.ts` — stage 3 integra `handleWorkItemResult` con evaluation + remediation
- `src/services/hokageOrchestrator.ts` — `replanSingleTask` (nuevo), `attemptReplan` usa evaluations para decidir
- `src/config/roleSeeds.ts` — `max_retry_immediate`, `max_retry_feedback`, `max_escalate_model`, `max_reassign`, `max_replan_task` por rol (defaults en system_config)

**Tests requeridos (antes de cableado):**
- `evaluateAutomated` — schema pass/fail, criteria pass/fail, heuristic empty/error, quality_floor, budget
- `evaluateWithLLM` — merge correcto, cost tracking, model selection
- `decideRemediation` — cada categoría → peldaño correcto, topes respetados, historial contado
- `handleWorkItemResult` — integration flow completo, cada peldaño ejecuta acción correcta
- Migración idempotente — tabla nueva, columnas nuevas, datos legacy sin evaluation

---

## Relacionado

- [[BLOQUE_0_DECISIONES_FUNDACIONALES]] · [[HOKAGE_AGENT_OPERATING_MODEL]] · [[ADR-010 - Quality Floors, Coste y Revisión]]
- [[ADR-011 - Agent Registry y Capability-based Selection]] · [[ADR-012 - Task Graph DAG y Directed Hand-off]]
- [[Resumen Ejecutivo - Decisiones Congeladas]] · [[INDEX]]