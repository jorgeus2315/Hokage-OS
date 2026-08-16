export interface Agent {
  id: number;
  name: string;
  role: string;
  status: string;
  model: string | null;
  venture_id: number | null;
  capabilities: string;
  agent_type: string;
  availability: string;
  claimed_by_task: number | null;
  claim_expires_at: string | null;
  created_at: string;
}

export interface AgentCreatePayload {
  name: string;
  role: string;
  model?: string;
  venture_id?: number | null;
  capabilities?: string;
  agent_type?: string;
  availability?: string;
}

// ADR-011 — Agent Registry types
export type AgentType = 'permanent' | 'ephemeral' | 'reviewer';
export type AgentCapability =
  | 'web.browser'
  | 'web.search'
  | 'google.trends'
  | 'trend.report'
  | 'content.create'
  | 'content.seo'
  | 'decision.create'
  | 'memory.remember'
  | 'system.exec'
  | 'system.shell'
  | 'etsy.search'
  | 'etsy.create_listing'
  | 'etsy.get_shop'
  | 'review.content'
  | 'review.code'
  | 'review.strategy'
  | 'review.quality'
  | 'analysis.financial'
  | 'analysis.market'
  | 'analysis.technical'
  | 'code.generate'
  | 'code.review'
  | 'design.ui'
  | 'design.graphic'
  | 'research.web'
  | 'research.trends'
  | 'analysis.data'
  | 'analysis.competitive'
  | 'strategy.marketing'
  | 'content.social';

export type AgentCapabilities = AgentCapability[];

export const AGENT_CAPABILITY_VOCABULARY: AgentCapability[] = [
  'web.browser',
  'web.search',
  'google.trends',
  'trend.report',
  'content.create',
  'content.seo',
  'decision.create',
  'memory.remember',
  'system.exec',
  'system.shell',
  'etsy.search',
  'etsy.create_listing',
  'etsy.get_shop',
  'review.content',
  'review.code',
  'review.strategy',
  'review.quality',
  'analysis.financial',
  'analysis.market',
  'analysis.technical',
  'code.generate',
  'code.review',
  'design.ui',
  'design.graphic',
  // Legacy/test aliases (mapped in parseCapabilities or kept for compatibility)
  'research.web',
  'research.trends',
  'analysis.data',
  'analysis.competitive',
  'strategy.marketing',
  'content.social',
];

export interface SelectionCriteria {
  ventureId?: number | null;
  agentTypes?: AgentType[];
  requiredCapabilities?: AgentCapability[];
  preferredCapabilities?: AgentCapability[];
  excludeAgentIds?: number[];
  maxResults?: number;
  requireReviewer?: boolean;
}

export interface SelectionResult {
  agentId: number;
  role: string;
  capabilities: AgentCapabilities;
  matchScore: number;
  availability: 'available' | 'busy';
  ventureId: number | null;
  agentType: AgentType;
}

export interface ProvisionResult {
  agentId: number;
  capabilities: AgentCapabilities;
}

// Registry de roles (Fase 1, UI Implementation Plan.md). Fuente de verdad en runtime
// de qué es un especialista: misión, tools, modelo, presupuesto y autonomía por defecto.
// Los mapas TS (agentModels.ts / AUTONOMOUS_TASKS) pasan a ser semilla + fallback.
export interface RoleDefinition {
  key: string;                       // clave de dominio estable = agents.role (L·1)
  label: string;
  specialty: string | null;
  mission: string | null;
  base_prompt: string | null;        // plantilla de prompt para nuevos agentes de este rol
  autonomous_task: string | null;    // NULL = sin trabajo autónomo (chat-only)
  interval_minutes: number | null;
  model: string;
  fallback_model: string | null;     // resiliencia (placeholder Fase 2)
  tools: string[];
  default_autonomy: number;          // 0-3 (placeholder Fase 2; el motor no lo aplica aún)
  monthly_budget_usd: number;
  scope: 'business' | 'system';
  is_system: boolean;                // rol crítico, protegido de borrado/degradación
  status: 'active' | 'disabled';
  capabilities: string;              // ADR-011: JSON array de AgentCapability (ej: '["research.web","analysis.data"]')
  max_review_cycles: number;         // ADR-012: tope de ciclos de review por rol (default 2)
  created_at: string;
  updated_at: string;
}

// Memoria de negocio (Fase 4, CORE SPEC §6). DATO, nunca instrucción. Compartida por venture.
export type MemoryCategory = 'decision' | 'error' | 'attempt' | 'research' | 'result' | 'learning' | 'context';

export interface MemoryEntry {
  id: number;
  venture_id: number | null;      // NULL = memoria de instalación (global)
  category: MemoryCategory;
  title: string;
  content: string;
  source_agent_id: number | null;
  related_entity_type: string | null;
  related_entity_id: number | null;
  created_at: string;
}

export interface Decision {
  id: number;
  agent_id: number | null;
  entity_type: string | null;
  entity_id: number | null;
  title: string;
  description: string | null;
  reasoning: string | null;
  amount: number | null;
  risk_level: string;
  status: string;
  category: 'FINANCIAL' | 'LEGAL' | 'PUBLICATION' | 'STRATEGIC' | 'TECHNICAL' | 'OPERATIONAL';
  venture_id: number | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface DecisionCreatePayload {
  agent_id?: number | null;
  entity_type?: string | null;
  entity_id?: number | null;
  venture_id?: number | null;
  title: string;
  description?: string | null;
  reasoning?: string | null;
  amount?: number | null;
  risk_level?: string;
}

// ═══════════ HOKAGE ORCHESTRATOR (Fase 5) ═══════════════════════════════════════
// Ledger propio del orquestador. NO duplica work_items/decisions/roles: es la capa de
// coordinación que no existía. Una orden (command) se descompone en tareas (task) con
// fases; cada tarea se despacha como un work_item que ejecuta el agentRuntime existente.
// La salida del LLM NUNCA entra aquí sin pasar por validatePlan() (validación determinista).
export type HokageCommandStatus = 'planning' | 'active' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type HokageTaskStatus = 'pending' | 'dispatched' | 'completed' | 'failed' | 'blocked' | 'cancelled';

export interface HokageCommand {
  id: number;
  venture_id: number | null;
  text: string;
  status: HokageCommandStatus;
  plan_summary: string | null;
  result_summary: string | null;
  idempotency_key: string | null;
  replan_count: number;        // replanificaciones ya usadas — tope determinista (sin bucles)
  created_at: string;
  updated_at: string;
}

export interface HokageTask {
  id: number;
  command_id: number;
  phase: number;               // fase de dependencia: la fase N solo se despacha cuando la N-1 terminó OK
  role: string;                // clave de rol de negocio (role_definitions.key)
  agent_id: number | null;     // especialista seleccionado/creado al despachar
  title: string;
  prompt: string;              // instrucción de la tarea — es DATO (viaja como mensaje de usuario)
  status: HokageTaskStatus;
  work_item_id: number | null;
  result: string | null;
  error: string | null;
  reserved_usd: number;        // importe de presupuesto de venture reservado para esta tarea (Fase 7)
  model: string | null;        // K.5: modelo elegido por el ModelRouter al crear el plan
  depends_on_count: number;    // ADR-012: aristas depends_on entrantes (cache de grafo)
  handoff_input: string | null; // ADR-012: template de handoff resuelto desde tareas previas
  handoff_from_role: string | null; // ADR-012: rol de la tarea que generó el handoff
  review_cycles: number;       // ADR-012: ciclos de revisión ya ejecutados (tope en role_definitions.max_review_cycles)
  review_verdict: string | null; // ADR-012: veredicto de la última review (pass|fail|needs_changes)
  review_feedback: string | null; // ADR-012: feedback de la última review
  // ADR-014 Slice A: contratos de evaluación determinista (opcionales — solo si el planner los fija)
  output_schema: { required?: string[] } | null;
  acceptance_criteria: string[] | null;
  quality_floor: { minConfidence?: number } | null;
  created_at: string;
  updated_at: string;
}

// ═══════════ ADR-012 — Task Graph DAG ═════════════════════════════════════════
export type TaskEdgeType = 'depends_on' | 'handoff' | 'review_of';

export interface TaskEdge {
  id: number;
  command_id: number;              // scope: todas las aristas de un command
  from_task_id: number;            // predecesora
  to_task_id: number;              // sucesora
  type: TaskEdgeType;
  payload: string;                 // JSON: para handoff = claves/template; para review_of = criterios
  created_at: string;
}

export interface ValidatedTaskGraph {
  tasks: HokageTask[];           // ya validados individualmente
  edges: TaskEdge[];             // ya validados
  topologicalOrder: number[];    // task_ids en orden de ejecución
  phases: Map<number, number>;   // task_id → phase (nivel topológico)
  hasReviewCycles: boolean;      // true si hay edges type='review_of'
}

// ═══════════ F11 — Pipeline de oportunidades ═══════════════════════════════════
export type OpportunityStatus =
  | 'draft' | 'researching' | 'validating' | 'monetization' | 'proposed'
  | 'awaiting_approval' | 'approved' | 'creating' | 'created'
  | 'rejected' | 'failed' | 'insufficient_evidence' | 'needs_human_review';
export type ValidationStatus = 'not_started' | 'insufficient_evidence' | 'validated' | 'rejected' | 'needs_human_review';
export type EvidenceKind = 'fact' | 'inference' | 'hypothesis' | 'unknown';
export type ProposalStatus = 'proposed' | 'awaiting_approval' | 'approved' | 'rejected' | 'created' | 'failed';

export interface Opportunity {
  id: number;
  funding_venture_id: number;
  title: string;
  status: OpportunityStatus;
  research_command_id: number | null;
  validation_status: ValidationStatus;
  validation_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Evidence {
  id: number;
  opportunity_id: number;
  kind: EvidenceKind;
  claim: string;
  source: string | null;
  confidence: number;         // 0..100
  agent_id: number | null;
  task_id: number | null;
  conflicts_with: number | null;
  created_at: string;
}

export interface BusinessProposal {
  id: number;
  opportunity_id: number;
  content: string;            // JSON estructurado (§13)
  proposed_budget_usd: number;
  proposed_name: string;
  proposed_type: string;
  status: ProposalStatus;
  decision_id: number | null;
  created_venture_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  sender_id: number | null;
  receiver_id: number | null;
  content: string;
  channel: string;
  created_at: string;
}

export interface MessageCreatePayload {
  sender_id?: number | null;
  receiver_id?: number | null;
  content: string;
  channel?: string;
}

export interface ContentItem {
  id: number;
  agent_id: number | null;
  business_id: number | null;
  platform: string;
  body: string | null;
  media_url: string | null;
  schedule_at: string | null;
  status: string;
  created_at: string;
}

export interface ContentCreatePayload {
  agent_id?: number | null;
  business_id?: number | null;
  platform: string;
  body?: string | null;
  media_url?: string | null;
  schedule_at?: string | null;
  status?: string;
}

export interface MarketItem {
  id: number;
  agent_id: number | null;
  keyword: string;
  source: string;
  score: number | null;
  payload: string;
  created_at: string;
}

export interface MarketCreatePayload {
  agent_id?: number | null;
  keyword: string;
  source?: string;
  score?: number | null;
  payload?: string;
}

export interface Department {
  id: number;
  key: string;
  name: string;
  desc: string;
  role: string;
  glyph: string;
  color: string;
  pos_x: number;
  pos_y: number;
  is_hub: number;
  active: number;
  sort_order: number;
  created_at: string;
}

export interface DepartmentUpdatePayload {
  name?: string;
  desc?: string;
  color?: string;
  pos_x?: number;
  pos_y?: number;
  active?: number;
}

export interface AuditLog {
  id: number;
  action: string;
  entity: string;
  entity_id: number | null;
  user_id: number | null;
  details: string;
  created_at: string;
}

// ═══════════ VENTURES ══════════════════════════════════════════════════════════
export type VentureStatus = 'idea' | 'active' | 'scaling' | 'paused' | 'closed';
export type VentureType = 'store' | 'saas' | 'content' | 'fund' | 'agency' | 'community' | 'other';

export interface Venture {
  id: number;
  name: string;
  type: VentureType;
  status: VentureStatus;
  goal: string | null;
  budget_allocated_usd: number;
  budget_spent_usd: number;
  revenue_target_usd: number;
  metadata: string;
  created_at: string;
  activated_at?: string | null; // Fase 12: NULL = creada pero inerte; sello = activada
}

export interface VentureCreatePayload {
  name: string;
  type?: VentureType;
  status?: VentureStatus;
  goal?: string | null;
  revenue_target_usd?: number;
}

// ═══════════ ASSETS ════════════════════════════════════════════════════════════
export type AssetType = 'content' | 'code' | 'data' | 'audience' | 'brand' | 'ip' | 'credential' | 'tool';
export type AssetStatus = 'draft' | 'active' | 'deprecated';

export interface Asset {
  id: number;
  venture_id: number | null;
  type: AssetType;
  name: string;
  description: string | null;
  value_usd: number | null;
  status: AssetStatus;
  platform: string | null;
  external_id: string | null;
  metadata: string;
  created_at: string;
}

export interface AssetCreatePayload {
  venture_id?: number | null;
  type: AssetType;
  name: string;
  description?: string | null;
  value_usd?: number | null;
  platform?: string | null;
  external_id?: string | null;
}

// ═══════════ PROJECTS ══════════════════════════════════════════════════════════
export type ProjectStatus = 'planned' | 'active' | 'completed' | 'cancelled';

export interface Project {
  id: number;
  venture_id: number | null;
  name: string;
  goal: string | null;
  status: ProjectStatus;
  deadline: string | null;
  budget_usd: number | null;
  created_at: string;
}

export interface ProjectCreatePayload {
  venture_id?: number | null;
  name: string;
  goal?: string | null;
  deadline?: string | null;
  budget_usd?: number | null;
}

// ═══════════ REVENUE_STREAMS ═══════════════════════════════════════════════════
export type RevenueType = 'one_time' | 'subscription' | 'ads' | 'commission' | 'licensing' | 'consulting' | 'tips';

export interface RevenueStream {
  id: number;
  venture_id: number | null;
  asset_id: number | null;
  type: RevenueType;
  platform: string;
  status: string;
  mrr_usd: number;
  total_earned_usd: number;
  last_synced_at: string | null;
  created_at: string;
}

// ═══════════ AUTOMATIONS — pipeline como datos ══════════════════════════════════
export type DecisionCategory = 'FINANCIAL' | 'LEGAL' | 'PUBLICATION' | 'STRATEGIC' | 'TECHNICAL' | 'OPERATIONAL';

export interface Automation {
  id: number;
  venture_id: number | null;
  name: string;
  trigger_event: string;
  trigger_conditions: string;
  action_type: string;
  action_agent_role: string | null;
  action_priority: number;
  action_context_template: string | null;
  requires_approval: number;
  active: number;
  created_at: string;
}

export interface AutomationCreatePayload {
  venture_id?: number | null;
  name: string;
  trigger_event: string;
  action_agent_role: string;
  action_priority?: number;
  action_context_template?: string | null;
  requires_approval?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUE 0 (2026-08-13) — contratos de selección de modelo y estado de runtime.
// ADITIVO: tipos nuevos, sin efecto sobre el comportamiento actual. Ver
// BLOQUE_0_DECISIONES_FUNDACIONALES (vault) + ADR-007/008/009/010.
// ═══════════════════════════════════════════════════════════════════════════

// —— TaskProfile / ModelRouter (ADR-008) ——
export type TaskKind =
  | 'research' | 'content' | 'strategy' | 'analysis' | 'review'
  | 'classify' | 'bulk' | 'conversation' | 'code' | 'design';
export type TaskComplexity = 'low' | 'medium' | 'high';
export type TaskImportance = 'low' | 'medium' | 'high' | 'critical';
export type TaskRisk = 'low' | 'medium' | 'high';

export interface TaskNeeds {
  reasoning?: boolean;
  creativity?: boolean;
  research?: boolean;
  tools?: boolean;
  longContext?: boolean;
}

// Perfil estructurado que Hokage produce al descomponer una orden — alimenta al ModelRouter.
// El LLM propone este perfil; el runtime (router determinista) decide el modelo.
export interface TaskProfile {
  kind: TaskKind;
  complexity: TaskComplexity;
  importance: TaskImportance;
  needs: TaskNeeds;
  risk: TaskRisk;
  timeSensitivity?: 'normal' | 'urgent';
}

// —— AgentRuntimeState (ADR-007) ——
// Proyección DERIVADA en el backend (fuente de verdad). El frontend nunca la inventa.
export type AgentPrimaryState =
  | 'IDLE' | 'THINKING' | 'RESEARCHING' | 'WORKING' | 'WAITING'
  | 'REVIEWING' | 'COMMUNICATING' | 'MOVING' | 'COMPLETED' | 'ERROR';

export interface AgentStateModifiers {
  awaitingApproval: boolean;   // tiene ≥1 Decision suya en 'proposed'
  hasError: boolean;           // último run/tarea con error
  blocked: boolean;            // bloqueada por dependencia/fase
  reviewing: boolean;          // sometida a quality gate
}

export interface AgentCurrentTask {
  workItemId: number;
  kind: string;                // TaskKind del trabajo en curso
  tool?: string;               // tool activa
  startedAt: string;           // ISO
}

export interface AgentRuntimeState {
  agentId: number;
  ventureId: number | null;    // venture del trabajo ACTUAL
  primary: AgentPrimaryState;
  modifiers: AgentStateModifiers;
  currentTask?: AgentCurrentTask;
  activity: number;            // 0..1, derivado de señales reales (nunca Math.random)
  since: string;               // desde cuándo en este primary
  updatedAt: string;           // sello de captura
  source: 'runtime';           // SIEMPRE backend
}

// ═══════════ ADR-014 Slice A — Task Evaluation (deterministic) ═══════════
export type TaskVerdict = 'pass' | 'partial' | 'fail' | 'error';

// Proyección mínima de work_item para evaluación — coincide con la SELECT en agentRuntime stage3.
export interface WorkItemForEval {
  id: number;
  agent_id: number;
  type: string;
  context: string | null;
  result: string | null;
  error: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  llm_cost_usd?: number | null;
  tool_cost_usd?: number | null;
  venture_id?: number | null;
  model?: string | null;
  milestone_id?: number | null;
  retry_count?: number;
  created_at?: string;
  resolved_at?: string;
}

export interface TaskEvaluation {
  workItemId: number;
  taskId: number | null;
  verdict: TaskVerdict;
  confidence: number;              // 0..100
  evidence: EvaluationEvidence[];
  diagnosis: Diagnosis | null;
  evaluator: 'automated' | 'llm' | 'human';
  model: string | null;
  costUsd: number;
  createdAt: string;
}

export interface EvaluationEvidence {
  type: 'schema' | 'criteria' | 'heuristic' | 'budget';
  check: string;
  passed: boolean;
  details?: string;
  weight: number;                  // 0..1, suma ≈1.0 en la evaluación
  evaluable: boolean;              // true = check realizado; false = no hay datos para evaluar
}

export interface Diagnosis {
  category: DiagnosisCategory;
  rootCause: string;
  suggestedRemediation: RemediationAction;
  retryable: boolean;
  context: Record<string, any>;
}

export type DiagnosisCategory =
  | 'transient'          // rate limit, timeout, network blip
  | 'tool_misuse'        // tool invocada mal, params inválidos
  | 'output_invalid'     // schema violation, formato incorrecto
  | 'quality_below_floor'// quality floor no alcanzado
  | 'misaligned'         // resultado no responde al prompt/objetivo
  | 'missing_capability' // agente no tiene tool/dominio necesario
  | 'budget_exceeded'    // coste > reserved_usd o venture ceiling
  | 'policy_violation'   // tool no grantable, autonomía insuficiente
  | 'unknown';

export type RemediationAction =
  | 'retry_immediate'
  | 'retry_with_feedback'
  | 'escalate_model'
  | 'reassign_agent'
  | 'replan_task'
  | 'replan_command'
  | 'human_intervention';
