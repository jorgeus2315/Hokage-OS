import { describe, it, expect } from 'vitest';
import {
  planRemediation,
  getEscalatedModelProfile,
  type RemediationPolicy,
  type TaskCounters,
  type RemediationAttempt,
  type ReviewContext,
} from './remediationEngine.js';
import {
  type HokageTask,
  type TaskEvaluation,
  type Diagnosis,
  DEFAULT_REMEDIATION_POLICY,
} from '../types/index.js';

function makeEvaluation(
  verdict: TaskEvaluation['verdict'],
  diagnosis?: Partial<Diagnosis>
): TaskEvaluation {
  return {
    workItemId: 1,
    taskId: 1,
    verdict,
    confidence: 80,
    evidence: [],
    diagnosis: diagnosis
      ? {
          category: diagnosis.category ?? 'unknown',
          rootCause: diagnosis.rootCause ?? 'test cause',
          suggestedRemediation: diagnosis.suggestedRemediation ?? 'retry_immediate',
          retryable: diagnosis.retryable ?? true,
          context: diagnosis.context ?? {},
        }
      : null,
    evaluator: 'automated',
    model: 'test-model',
    costUsd: 0.01,
    createdAt: new Date().toISOString(),
  };
}

function makeTask(overrides: Partial<HokageTask> = {}): HokageTask {
  return {
    id: 1,
    command_id: 1,
    phase: 1,
    role: 'writer',
    agent_id: 5,
    title: 'Test Task',
    prompt: 'Write something',
    status: 'dispatched',
    work_item_id: 1,
    result: null,
    error: null,
    reserved_usd: 10,
    model: 'test-model',
    depends_on_count: 0,
    handoff_input: null,
    handoff_from_role: null,
    review_cycles: 0,
    review_verdict: null,
    review_feedback: null,
    output_schema: null,
    acceptance_criteria: null,
    quality_floor: null,
    retry_count: 0,
    remediation_count: 0,
    remediation_policy: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCounters(overrides: Partial<TaskCounters> = {}): TaskCounters {
  return {
    retryCount: 0,
    remediationCount: 0,
    ...overrides,
  };
}

function makeAttempt(action: RemediationAttempt['action'], workItemId = 1): RemediationAttempt {
  return {
    action,
    workItemId,
    createdAt: new Date().toISOString(),
  };
}

function makePolicy(overrides: Partial<RemediationPolicy> = {}): RemediationPolicy {
  return {
    ...DEFAULT_REMEDIATION_POLICY,
    ...overrides,
  };
}

function makeReviewContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    cycles: 1,
    maxCycles: 2,
    lastVerdict: 'fail',
    lastFeedback: 'needs improvement',
    ...overrides,
  };
}

describe('planRemediation', () => {
  // 1. Pass verdict — no remediation needed
  it('returns no-op for pass verdict', () => {
    const decision = planRemediation(
      makeEvaluation('pass'),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      null
    );
    expect(decision.action).toBe('retry_immediate'); // placeholder action
    expect(decision.reason).toContain('passed');
    expect(decision.maxRetriesForAction).toBe(0);
    expect(decision.currentAttempt).toBe(0);
  });

  // 2. transient category — first retry_immediate attempt
  it('chooses retry_immediate for transient category on first attempt', () => {
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'transient', retryable: true }),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      null
    );
    expect(decision.action).toBe('retry_immediate');
    expect(decision.maxRetriesForAction).toBe(2);
    expect(decision.currentAttempt).toBe(0);
    expect(decision.nextStepIfExhausted).toBe('retry_with_feedback');
  });

  // 3. transient category — retry_immediate exhausted, falls to human_intervention (transient not in retry_with_feedback categories)
  it('returns human_intervention when retry_immediate exhausted for transient', () => {
    const history = [makeAttempt('retry_immediate'), makeAttempt('retry_immediate')];
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'transient', retryable: true }),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      history,
      null
    );
    expect(decision.action).toBe('human_intervention');
    expect(decision.reason).toContain('No more remediation steps');
  });

  // 4. tool_misuse category — retry_immediate
  it('chooses retry_immediate for tool_misuse category', () => {
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'tool_misuse', retryable: true }),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      null
    );
    expect(decision.action).toBe('retry_immediate');
  });

  // 5. output_invalid — retry_with_feedback (first attempt)
  it('chooses retry_with_feedback for output_invalid on first attempt', () => {
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'output_invalid', retryable: true }),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      null
    );
    expect(decision.action).toBe('retry_with_feedback');
    expect(decision.injectFeedback).toBeDefined();
  });

  // 6. quality_below_floor — retry_with_feedback
  it('chooses retry_with_feedback for quality_below_floor', () => {
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'quality_below_floor', retryable: true }),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      null
    );
    expect(decision.action).toBe('retry_with_feedback');
  });

  // 7. misaligned — retry_with_feedback
  it('chooses retry_with_feedback for misaligned', () => {
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'misaligned', retryable: true }),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      null
    );
    expect(decision.action).toBe('retry_with_feedback');
  });

  // 8. quality_below_floor — escalate_model after retry_with_feedback exhausted (with custom path)
  it('escalates to escalate_model when retry_with_feedback exhausted for quality_below_floor', () => {
    const customPolicy = makePolicy({
      escalationPath: ['retry_immediate', 'retry_with_feedback', 'escalate_model', 'replan_task', 'human_intervention'],
    });
    const history = [makeAttempt('retry_with_feedback'), makeAttempt('retry_with_feedback')];
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'quality_below_floor', retryable: true }),
      makeTask(),
      customPolicy,
      makeCounters(),
      history,
      null
    );
    expect(decision.action).toBe('escalate_model');
    expect(decision.maxRetriesForAction).toBe(1);
  });

  // 9. misaligned — escalate_model after retry_with_feedback exhausted (with custom path)
  it('escalates to escalate_model when retry_with_feedback exhausted for misaligned', () => {
    const customPolicy = makePolicy({
      escalationPath: ['retry_immediate', 'retry_with_feedback', 'escalate_model', 'replan_task', 'human_intervention'],
    });
    const history = [makeAttempt('retry_with_feedback'), makeAttempt('retry_with_feedback')];
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'misaligned', retryable: true }),
      makeTask(),
      customPolicy,
      makeCounters(),
      history,
      null
    );
    expect(decision.action).toBe('escalate_model');
  });

  // 10. missing_capability — reassign_agent
  it('chooses reassign_agent for missing_capability', () => {
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'missing_capability', retryable: true }),
      makeTask({ agent_id: 5 }),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      null
    );
    expect(decision.action).toBe('reassign_agent');
    expect(decision.excludedAgentIds).toEqual([5]);
  });

  // 11. policy_violation — replan_task (non-retryable)
  it('chooses replan_task for policy_violation', () => {
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'policy_violation', retryable: false }),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      null
    );
    expect(decision.action).toBe('replan_task');
  });

  // 12. budget_exceeded — replan_task (non-retryable)
  it('chooses replan_task for budget_exceeded', () => {
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'budget_exceeded', retryable: false }),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      null
    );
    expect(decision.action).toBe('replan_task');
  });

  // 13. unknown non-retryable — replan_task
  it('chooses replan_task for unknown non-retryable', () => {
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'unknown', retryable: false }),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      null
    );
    expect(decision.action).toBe('replan_task');
  });

  // 14. review cycles exhausted — replan_task (skips retry_with_feedback and escalate_model)
  it('skips to replan_task when review cycles exhausted', () => {
    const reviewContext = makeReviewContext({ cycles: 2, maxCycles: 2 });
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'quality_below_floor', retryable: true }),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      reviewContext
    );
    expect(decision.action).toBe('replan_task');
    expect(decision.reason).toContain('Review cycles exhausted');
  });

  // 15. global maxRemediations exhausted — human_intervention
  it('returns human_intervention when global remediation limit reached', () => {
    const history = [
      makeAttempt('retry_immediate'),
      makeAttempt('retry_immediate'),
      makeAttempt('retry_with_feedback'),
      makeAttempt('retry_with_feedback'),
    ];
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'transient', retryable: true }),
      makeTask(),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      history,
      null
    );
    expect(decision.action).toBe('human_intervention');
    expect(decision.reason).toContain('Global remediation limit');
  });

  // 16. category-specific policy override (byCategory)
  it('uses byCategory override when defined', () => {
    const customPolicy = makePolicy({
      byCategory: {
        transient: { maxRetries: 5, escalationPath: ['retry_immediate', 'human_intervention'] },
      },
    });
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'transient', retryable: true }),
      makeTask(),
      customPolicy,
      makeCounters(),
      [],
      null
    );
    expect(decision.maxRetriesForAction).toBe(5);
    expect(decision.nextStepIfExhausted).toBe('human_intervention');
  });

  // 17. respectReviewCycles = false — does not skip retry_with_feedback
  it('respects review cycles when policy has respectReviewCycles=false', () => {
    const customPolicy = makePolicy({ respectReviewCycles: false });
    const reviewContext = makeReviewContext({ cycles: 2, maxCycles: 2 });
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'quality_below_floor', retryable: true }),
      makeTask(),
      customPolicy,
      makeCounters(),
      [],
      reviewContext
    );
    expect(decision.action).toBe('retry_with_feedback'); // not skipped
  });

  // 18. excludedAgentIds for reassign_agent includes current agent
  it('excludes current agent from reassignment', () => {
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'missing_capability', retryable: true }),
      makeTask({ agent_id: 42 }),
      DEFAULT_REMEDIATION_POLICY,
      makeCounters(),
      [],
      null
    );
    expect(decision.excludedAgentIds).toEqual([42]);
  });

  // 19. action not in escalationPath for category — goes to human_intervention (no fallback for other steps)
  it('goes to human_intervention when category-specific action not in escalationPath', () => {
    const customPolicy = makePolicy({
      escalationPath: ['retry_immediate', 'replan_task', 'human_intervention'],
    });
    const decision = planRemediation(
      makeEvaluation('fail', { category: 'output_invalid', retryable: true }),
      makeTask(),
      customPolicy,
      makeCounters(),
      [],
      null
    );
    // output_invalid only has retry_with_feedback step; not in path -> human_intervention
    expect(decision.action).toBe('human_intervention');
    expect(decision.reason).toContain('No more remediation steps');
  });

  // 20. getEscalatedModelProfile helper
  it('increases complexity for escalate_model profile', () => {
    const base = {
      kind: 'content',
      complexity: 'low' as const,
      importance: 'medium' as const,
      needs: { reasoning: true },
      risk: 'low' as const,
    };
    const escalated = getEscalatedModelProfile(base);
    expect(escalated.complexity).toBe('medium');
    expect(escalated.kind).toBe('content');
    expect(escalated.needs).toEqual(base.needs);
  });

  it('caps complexity at high', () => {
    const base = {
      kind: 'research',
      complexity: 'high' as const,
      importance: 'high' as const,
      needs: {},
      risk: 'high' as const,
    };
    const escalated = getEscalatedModelProfile(base);
    expect(escalated.complexity).toBe('high');
  });
});