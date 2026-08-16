import type { RoleDefinition, TaskEvaluation, EvaluationEvidence, Diagnosis, DiagnosisCategory, TaskVerdict, RemediationAction, HokageTask, WorkItemForEval } from '../types/index.js';
import { run } from '../db/init.js';

// Parseo tolerante: los contratos de evaluación llegan como string JSON desde SQLite
// (columnas TEXT) o como objeto desde los tests. Si ya es objeto, lo devuelve tal cual;
// si es string, lo parsea; si falla, null (degradación elegante, no rompe el flujo).
function safeParse<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

// Validación de schema JSON (si task.output_schema existe)
function validateJsonSchema(result: string | null, schema: object): { valid: boolean; errors: string[] } {
  if (!result) return { valid: false, errors: ['Empty result'] };
  try {
    const parsed = JSON.parse(result);
    // Simple validation: check required fields exist
    const required = (schema as any).required || [];
    const missing = required.filter((f: string) => !(f in parsed));
    if (missing.length > 0) return { valid: false, errors: [`Missing required fields: ${missing.join(', ')}`] };
    return { valid: true, errors: [] };
  } catch (e) {
    return { valid: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
}

// Heuristic checks (empty, error markers, token anomaly)
function runHeuristics(workItem: WorkItemForEval, _roleDef: RoleDefinition | null): EvaluationEvidence[] {
  const evidence: EvaluationEvidence[] = [];
  const result = workItem.result || '';

  // Empty result
  const empty = !result || result.trim().length === 0;
  evidence.push({
    type: 'heuristic',
    check: 'non_empty_result',
    passed: !empty,
    details: empty ? 'Result is empty' : undefined,
    weight: 0.2,
    evaluable: true
  });

  // Error markers in result
  const hasErrorMarker = /\[ERROR\]|Error:|Exception:|Failed to/i.test(result);
  evidence.push({
    type: 'heuristic',
    check: 'no_error_markers',
    passed: !hasErrorMarker,
    details: hasErrorMarker ? 'Error marker detected in output' : undefined,
    weight: 0.15,
    evaluable: true
  });

  // Token usage anomaly (if available)
  if (workItem.tokens_out !== undefined && workItem.tokens_out !== null) {
    const highTokens = workItem.tokens_out > 8000;
    evidence.push({
      type: 'heuristic',
      check: 'token_usage_normal',
      passed: !highTokens,
      details: highTokens ? `High token usage: ${workItem.tokens_out}` : undefined,
      weight: 0.1,
      evaluable: true
    });
  } else {
    evidence.push({
      type: 'heuristic',
      check: 'token_usage_normal',
      passed: true,
      details: 'Token data not available',
      weight: 0.1,
      evaluable: false
    });
  }

  return evidence;
}

// Criteria checks (if task.acceptance_criteria exists)
function checkCriterion(result: string | null, criterion: string): boolean {
  if (!result) return false;
  // Simple substring/keyword check - can be enhanced
  return result.toLowerCase().includes(criterion.toLowerCase());
}

function defaultRemediationFor(category: DiagnosisCategory): RemediationAction {
  switch (category) {
    case 'transient': return 'retry_immediate';
    case 'tool_misuse': return 'retry_with_feedback';
    case 'output_invalid': return 'retry_with_feedback';
    case 'quality_below_floor': return 'retry_with_feedback';
    case 'misaligned': return 'retry_with_feedback';
    case 'missing_capability': return 'reassign_agent';
    case 'budget_exceeded': return 'replan_task';
    case 'policy_violation': return 'replan_task';
    default: return 'human_intervention';
  }
}

function diagnoseFromFailedChecks(failedChecks: EvaluationEvidence[], _workItem: WorkItemForEval, _task: HokageTask | null): Diagnosis | null {
  // Priority order for diagnosis — solo consideramos checks que fallaron realmente
  for (const check of failedChecks) {
    if (!check.passed) {
      if (check.check === 'output_schema') return { category: 'output_invalid', rootCause: check.details || 'Schema validation failed', suggestedRemediation: 'retry_with_feedback', retryable: true, context: { details: check.details } };
      if (check.check === 'quality_floor') return { category: 'quality_below_floor', rootCause: check.details || 'Quality floor not met', suggestedRemediation: 'retry_with_feedback', retryable: true, context: { details: check.details } };
      if (check.check === 'budget_exceeded') return { category: 'budget_exceeded', rootCause: check.details || 'Budget exceeded', suggestedRemediation: 'replan_task', retryable: false, context: { details: check.details } };
      if (check.check === 'non_empty_result') return { category: 'output_invalid', rootCause: 'Empty result returned', suggestedRemediation: 'retry_immediate', retryable: true, context: {} };
      if (check.check === 'no_error_markers') return { category: 'tool_misuse', rootCause: 'Error marker detected in output', suggestedRemediation: 'retry_with_feedback', retryable: true, context: {} };
    }
  }
  // Fallback for criteria failures
  const criteriaFailed = failedChecks.find(c => c.type === 'criteria');
  if (criteriaFailed) return { category: 'misaligned', rootCause: `Acceptance criterion failed: ${criteriaFailed.check}`, suggestedRemediation: 'retry_with_feedback', retryable: true, context: { criterion: criteriaFailed.check } };
  return { category: 'unknown', rootCause: 'Evaluation failed without specific diagnosis', suggestedRemediation: 'human_intervention', retryable: false, context: {} };
}

/**
 * Evaluación automática determinista de un work_item completado.
 * PURA: sin DB, sin red, sin LLM, sin logging, sin mutaciones, sin efectos secundarios.
 *
 * @param workItem - work_item ya completado (con result, error, tokens, cost)
 * @param task - hokage_task asociada (puede ser null para work_items no orquestados)
 * @param roleDef - definición del rol del agente que ejecutó la tarea
 * @returns TaskEvaluation con veredicto, confianza, evidencia y diagnóstico
 */
export async function evaluateAutomated(
  workItem: WorkItemForEval,
  task: HokageTask | null | undefined,
  roleDef: RoleDefinition | null
): Promise<TaskEvaluation> {
  const evidence: EvaluationEvidence[] = [];
  let verdict: TaskVerdict = 'pass';
  let diagnosis: Diagnosis | null = null;

  // Normaliza contratos que pueden llegar como string JSON (lee de SQLite) o como objeto (tests).
  // Sin esto, output_schema string → (schema as any).required es undefined → schema "pasa" por error.
  const normalizedTask = task ? {
    ...task,
    output_schema: typeof task.output_schema === 'string'
      ? (safeParse(task.output_schema) as HokageTask['output_schema'])
      : task.output_schema,
    acceptance_criteria: typeof task.acceptance_criteria === 'string'
      ? (safeParse(task.acceptance_criteria) as HokageTask['acceptance_criteria'])
      : task.acceptance_criteria,
    quality_floor: typeof task.quality_floor === 'string'
      ? (safeParse(task.quality_floor) as HokageTask['quality_floor'])
      : task.quality_floor,
  } : task;

  // 1. Schema validation (if task.output_schema declared)
  if (normalizedTask?.output_schema) {
    const schemaCheck = validateJsonSchema(workItem.result, normalizedTask.output_schema);
    evidence.push({
      type: 'schema',
      check: 'output_schema',
      passed: schemaCheck.valid,
      details: schemaCheck.errors.join('; '),
      weight: 0.3,
      evaluable: true
    });
    if (!schemaCheck.valid) {
      verdict = 'fail';
      diagnosis = diagnoseFromFailedChecks(evidence, workItem, normalizedTask);
    }
  }

  // 2. Criteria checks (if task.acceptance_criteria declared)
  if (normalizedTask?.acceptance_criteria && Array.isArray(normalizedTask.acceptance_criteria) && normalizedTask.acceptance_criteria.length > 0) {
    for (const criterion of normalizedTask.acceptance_criteria) {
      const passed = checkCriterion(workItem.result, criterion);
      evidence.push({
        type: 'criteria',
        check: criterion,
        passed,
        weight: 0.2 / normalizedTask.acceptance_criteria.length,
        evaluable: true
      });
      if (!passed && verdict === 'pass') {
        verdict = 'partial';
      }
    }
  }

  // 3. Heuristic checks
  const heuristicChecks = runHeuristics(workItem, roleDef);
  evidence.push(...heuristicChecks);
  const heuristicFailed = heuristicChecks.some(c => c.evaluable && !c.passed);
  if (heuristicFailed && verdict === 'pass') verdict = 'partial';

  // 4. Quality Floor check (if task.quality_floor declared)
  if (normalizedTask?.quality_floor) {
    const minConfidence = normalizedTask.quality_floor.minConfidence ?? 80;
    // NO fabricamos un passed: sin métricas reales, no se puede evaluar el quality floor
    // Registramos como NO EVALUABLE con detalle explicativo
    evidence.push({
      type: 'heuristic',
      check: 'quality_floor',
      passed: true, // neutral - no afecta veredicto
      details: `Quality floor check not available (minConfidence: ${minConfidence}, requires metrics infrastructure)`,
      weight: 0.0, // peso 0 para no afectar confidence
      evaluable: false
    });
    // NO cambiamos verdict aquí — el quality floor no evaluable no es ni pass ni fail
  }

  // 5. Budget check
  if (normalizedTask?.reserved_usd && workItem.llm_cost_usd !== undefined && workItem.llm_cost_usd !== null && workItem.llm_cost_usd > normalizedTask.reserved_usd * 1.2) {
    evidence.push({
      type: 'budget',
      check: 'budget_exceeded',
      passed: false,
      details: `Cost ${workItem.llm_cost_usd} > reserved ${normalizedTask.reserved_usd} * 1.2`,
      weight: 0.15,
      evaluable: true
    });
    if (verdict === 'pass') verdict = 'fail';
    // NO sobrescribir diagnosis si ya hay uno (prioridad: schema > budget > heuristics)
    if (!diagnosis) {
      diagnosis = diagnoseFromFailedChecks(evidence, workItem, normalizedTask);
    }
  }

  // Confidence = weighted sum of PASSED evidence that was actually evaluable
  // Solo sumamos weight de checks que SÍ se pudieron evaluar (evaluable === true)
  const totalEvaluableWeight = evidence.filter(e => e.evaluable).reduce((sum, e) => sum + e.weight, 0);
  const passedEvaluableWeight = evidence.filter(e => e.evaluable && e.passed).reduce((sum, e) => sum + e.weight, 0);

  const confidence = totalEvaluableWeight > 0
    ? Math.round((passedEvaluableWeight / totalEvaluableWeight) * 100)
    : 0; // sin checks evaluables → confidence 0

  // Set diagnosis if not already set and verdict !== pass
  if (verdict !== 'pass' && !diagnosis) {
    diagnosis = diagnoseFromFailedChecks(evidence, workItem, task ?? null);
  }
  if (diagnosis && !diagnosis.suggestedRemediation) {
    diagnosis.suggestedRemediation = defaultRemediationFor(diagnosis.category);
  }

  return {
    workItemId: workItem.id,
    taskId: task?.id ?? null,
    verdict,
    confidence,
    evidence,
    diagnosis,
    evaluator: 'automated',
    model: null,
    costUsd: 0,
    createdAt: new Date().toISOString()
  };
}

/**
 * Persiste la evaluación en task_evaluations y espejo en work_items.
 * Esta función SÍ tiene side effects (DB writes).
 */
export async function insertTaskEvaluation(evaluation: TaskEvaluation): Promise<number> {
  const res = await run(
    `INSERT INTO task_evaluations (work_item_id, task_id, verdict, confidence, evidence, diagnosis, evaluator, model, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      evaluation.workItemId,
      evaluation.taskId,
      evaluation.verdict,
      evaluation.confidence,
      JSON.stringify(evaluation.evidence),
      evaluation.diagnosis ? JSON.stringify(evaluation.diagnosis) : null,
      evaluation.evaluator,
      evaluation.model,
      evaluation.costUsd,
      evaluation.createdAt
    ]
  );
  // Also mirror to work_items for quick reads
  await run(
    `UPDATE work_items SET evaluation_verdict = ?, evaluation_confidence = ?, evaluation_evidence = ? WHERE id = ?`,
    [evaluation.verdict, evaluation.confidence, JSON.stringify(evaluation.evidence), evaluation.workItemId]
  );
  return res.lastID;
}