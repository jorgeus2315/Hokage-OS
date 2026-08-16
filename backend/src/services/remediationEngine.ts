import type {
  TaskEvaluation,
  Diagnosis,
  DiagnosisCategory,
  RemediationAction,
  HokageTask,
  RemediationPolicy,
  DEFAULT_REMEDIATION_POLICY
} from '../types/index.js';

/**
 * Contexto de revisión para decisiones de remediación (ADR-012).
 * Solo se usa si respectReviewCycles = true en la política.
 */
export interface ReviewContext {
  cycles: number;           // review_cycles actual de la tarea
  maxCycles: number;        // role_definitions.max_review_cycles
  lastVerdict: 'pass' | 'fail' | 'needs_changes' | null; // review_verdict del último ciclo
  lastFeedback: string | null; // review_feedback del último ciclo
}

/**
 * Contadores actuales de la tarea (se leen de hokage_tasks).
 */
export interface TaskCounters {
  retryCount: number;         // retry_count (reintentos técnicos de transporte)
  remediationCount: number;   // remediation_count (escalones de remediación por calidad)
}

/**
 * Historial de intentos de remediación para este work_item.
 * Se usa para contar cuántas veces se ha aplicado cada peldaño.
 */
export interface RemediationAttempt {
  action: RemediationAction;
  workItemId: number;
  createdAt: string;
}

/**
 * Decisión de remediación estructurada (pura, sin side effects).
 */
export interface RemediationDecision {
  action: RemediationAction;
  reason: string;
  maxRetriesForAction: number;
  currentAttempt: number;
  nextStepIfExhausted: RemediationAction | null;
  injectFeedback?: string;        // feedback para retry_with_feedback / escalate_model / reassign_agent
  modelOverride?: string;         // modelo sugerido para escalate_model
  excludedAgentIds?: number[];    // agentes a excluir para reassign_agent
}

/**
 * Función pura: decide el siguiente paso de remediación basado en evaluación,
 * contadores, política y contexto de revisión.
 *
 * NO hace: DB, red, LLM, logging, mutaciones.
 *
 * @param evaluation - Resultado de evaluateAutomated (o LLM evaluation)
 * @param task - hokage_task asociada (puede ser null para work_items no orquestados)
 * @param policy - RemediationPolicy de la tarea o DEFAULT_REMEDIATION_POLICY
 * @param counters - retry_count y remediation_count actuales de la tarea
 * @param attemptHistory - Historial de remediaciones previas para este work_item
 * @param reviewContext - Contexto de ciclos de review (ADR-012), opcional
 * @returns RemediationDecision con acción, razón, límites y datos para ejecutar
 */
export function planRemediation(
  evaluation: TaskEvaluation,
  task: HokageTask | null,
  policy: RemediationPolicy,
  counters: TaskCounters,
  attemptHistory: RemediationAttempt[],
  reviewContext?: ReviewContext | null
): RemediationDecision {
  // Si pasó, no hay remediación
  if (evaluation.verdict === 'pass') {
    return {
      action: 'retry_immediate', // no se usa, solo para tipo
      reason: 'Evaluation passed — no remediation needed',
      maxRetriesForAction: 0,
      currentAttempt: 0,
      nextStepIfExhausted: null,
    };
  }

  // Categoría de diagnóstico y si es reintentable
  const diagnosis = evaluation.diagnosis;
  const category = diagnosis?.category ?? 'unknown';
  const retryable = diagnosis?.retryable ?? true;

  // Contar intentos previos por acción
  const attemptsByAction = new Map<RemediationAction, number>();
  for (const a of attemptHistory) {
    attemptsByAction.set(a.action, (attemptsByAction.get(a.action) || 0) + 1);
  }

  // Contador de remediaciones totales (peldaños consumidos)
  const totalRemediations = attemptHistory.length;

  // Helper: comprobar tope global de remediaciones
  const isGlobalExhausted = totalRemediations >= policy.maxRemediations;

  // Helper: comprobar tope por acción
  function attemptCount(action: RemediationAction): number {
    return attemptsByAction.get(action) || 0;
  }

  // Helper: comprobar si action está en escalationPath (o en byCategory)
  function isInPath(action: RemediationAction, path: RemediationAction[]): boolean {
    return path.includes(action);
  }

  // Determinar la ruta de escalada a usar (byCategory si existe, si no escalationPath genérica)
  const categoryOverrides = policy.byCategory?.[category];
  const escalationPath = categoryOverrides?.escalationPath ?? policy.escalationPath;
  const maxRetriesForCategory = categoryOverrides?.maxRetries ?? policy.maxRetries;

  // Respeto a review_cycles: si respectReviewCycles=true y hay reviewContext con cycles >= maxCycles,
  // saltar retry_with_feedback y escalate_model, ir directo a replan_task
  const respectCycles = policy.respectReviewCycles && reviewContext !== undefined && reviewContext !== null;
  const reviewExhausted = respectCycles && reviewContext.cycles >= reviewContext.maxCycles;

  // PELDAÑO 1: retry_immediate (transient, tool_misuse simple)
  if (retryable && (category === 'transient' || category === 'tool_misuse')) {
    const n = attemptCount('retry_immediate');
    if (n < maxRetriesForCategory && isInPath('retry_immediate', escalationPath) && !isGlobalExhausted) {
      return {
        action: 'retry_immediate',
        reason: `Category ${category} → retry_immediate`,
        maxRetriesForAction: maxRetriesForCategory,
        currentAttempt: n,
        nextStepIfExhausted: escalationPath[escalationPath.indexOf('retry_immediate') + 1] ?? null,
      };
    }
  }

  // PELDAÑO 2: retry_with_feedback (output_invalid, quality_below_floor, misaligned)
  // Si reviewExhausted, saltar este peldaño
  if (retryable && (category === 'output_invalid' || category === 'quality_below_floor' || category === 'misaligned') && !reviewExhausted) {
    const n = attemptCount('retry_with_feedback');
    if (n < maxRetriesForCategory && isInPath('retry_with_feedback', escalationPath) && !isGlobalExhausted) {
      return {
        action: 'retry_with_feedback',
        reason: `Category ${category} → retry_with_feedback`,
        maxRetriesForAction: maxRetriesForCategory,
        currentAttempt: n,
        nextStepIfExhausted: escalationPath[escalationPath.indexOf('retry_with_feedback') + 1] ?? null,
        injectFeedback: diagnosis?.rootCause,
      };
    }
  }

  // PELDAÑO 3a: escalate_model (quality_below_floor, misaligned)
  // Si reviewExhausted, saltar este peldaño
  if (retryable && (category === 'quality_below_floor' || category === 'misaligned') && !reviewExhausted) {
    const n = attemptCount('escalate_model');
    if (n < 1 && isInPath('escalate_model', escalationPath) && !isGlobalExhausted) {
      // max 1 escalada de modelo por defecto (configurable en byCategory)
      return {
        action: 'escalate_model',
        reason: `Category ${category} → escalate_model`,
        maxRetriesForAction: 1,
        currentAttempt: n,
        nextStepIfExhausted: escalationPath[escalationPath.indexOf('escalate_model') + 1] ?? null,
        injectFeedback: diagnosis?.rootCause,
        // El runtime usará ModelRouter con complexity+1 para elegir el modelo superior
      };
    }
  }

  // PELDAÑO 3b: reassign_agent (missing_capability)
  if (retryable && category === 'missing_capability') {
    const n = attemptCount('reassign_agent');
    if (n < 1 && isInPath('reassign_agent', escalationPath) && !isGlobalExhausted) {
      return {
        action: 'reassign_agent',
        reason: `Category ${category} → reassign_agent`,
        maxRetriesForAction: 1,
        currentAttempt: n,
        nextStepIfExhausted: escalationPath[escalationPath.indexOf('reassign_agent') + 1] ?? null,
        injectFeedback: diagnosis?.rootCause,
        excludedAgentIds: task?.agent_id ? [task.agent_id] : undefined,
      };
    }
  }

  // PELDAÑO 4: replan_task (policy_violation, budget_exceeded, unknown no retryable, review exhaustado)
  if (!retryable || category === 'policy_violation' || category === 'budget_exceeded' || category === 'unknown' || reviewExhausted) {
    const n = attemptCount('replan_task');
    if (n < 1 && isInPath('replan_task', escalationPath) && !isGlobalExhausted) {
      return {
        action: 'replan_task',
        reason: reviewExhausted ? 'Review cycles exhausted' : `Category ${category} → replan_task`,
        maxRetriesForAction: 1,
        currentAttempt: n,
        nextStepIfExhausted: escalationPath[escalationPath.indexOf('replan_task') + 1] ?? null,
      };
    }
  }

  // PELDAÑO 5: human_intervention (tope global alcanzado, o no hay más peldaños en path)
  return {
    action: 'human_intervention',
    reason: isGlobalExhausted
      ? `Global remediation limit (${policy.maxRemediations}) reached for ${category}`
      : `No more remediation steps available for ${category}`,
    maxRetriesForAction: 0,
    currentAttempt: 0,
    nextStepIfExhausted: null,
  };
}

/**
 * Helper: obtiene el siguiente modelo sugerido para escalate_model.
 * El runtime llama a selectModel con el perfil escalado (complexity + 1).
 */
export function getEscalatedModelProfile(originalProfile: {
  kind: string;
  complexity: 'low' | 'medium' | 'high';
  importance: 'low' | 'medium' | 'high' | 'critical';
  needs: Record<string, boolean>;
  risk: 'low' | 'medium' | 'high';
}): { kind: string; complexity: 'low' | 'medium' | 'high'; importance: string; needs: Record<string, boolean>; risk: string } {
  const complexityMap: Record<'low' | 'medium' | 'high', 'low' | 'medium' | 'high'> = {
    low: 'medium',
    medium: 'high',
    high: 'high',
  };
  return {
    ...originalProfile,
    complexity: complexityMap[originalProfile.complexity] ?? 'high',
  };
}