import { run, get, all } from '../db/init.js';
import type { HokageCommand, HokageTask, HokageCommandStatus, RoleDefinition, TaskEdge, TaskEdgeType } from '../types/index.js';
import type { TaskEvaluation, WorkItemForEval, RemediationPolicy, RemediationAction, AgentErrorClass } from '../types/index.js';
import { DEFAULT_REMEDIATION_POLICY } from '../types/index.js';
import { getRoleDefinition, listRoleDefinitions, modelFor } from './roleService.js';
import { createAgent } from './agentService.js';
import { selectAgent, releaseAgent } from './agentSelector.js'; // ADR-011: selección + release. El CLAIM lo hace stage2 (gate pending→in_progress, decisión #5).
import { evaluateAutomated, insertTaskEvaluation } from './taskEvaluator.js'; // ADR-014: evaluación determinista
import { planRemediation, getEscalatedModelProfile } from './remediationEngine.js'; // ADR-014 B2: motor puro de remediación
import type { RemediationAttempt, ReviewContext, TaskCounters } from './remediationEngine.js';
import { createDecision } from './decisionService.js'; // ADR-014: human_intervention
import { callAIJson, estimateTaskCostUsd } from './aiService.js';
import { createMemoryEntry } from './memoryService.js';
import { reserveVentureBudget, releaseVentureBudget, ventureOverRealBudget } from './ventureBudget.js';
import { recordAudit } from './auditService.js';
import { onResearchCommandFinalized } from './opportunityPipeline.js';
import bus from '../config/eventBus.js';
import { selectModel } from '../config/modelRouter.js';       // K.5: política determinista de modelo
import { validateTaskProfile } from '../config/taskProfile.js'; // K.5: sanea el profile del LLM
import { resolveHandoffTemplate, extractHandoffKeys, validateTaskGraph, generateImplicitEdges } from '../config/taskGraph.js';
import type { TaskProfile } from '../types/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// hokageOrchestrator — Fase 5. Hokage como ORQUESTADOR, no especialista universal.
// ═══════════════════════════════════════════════════════════════════════════
//
// Una orden de alto nivel → plan de tareas por fases → work_items → ejecución por el
// agentRuntime existente → síntesis. NO duplica work_items/decisions/roles/autonomía/
// contexto/memoria: los usa. La ejecución de cada tarea pasa por el mismo camino de
// siempre (work_items → stage2/stage3 → askAgent), que ya aplica tools por rol,
// autonomía (Fase 2), presupuesto (agent_budgets) y ContextComposer (Fase 3) con la
// memoria de negocio scopeada por venture (Fase 4).
//
// SEGURIDAD (autoridad final = código determinista, nunca el LLM):
//   - La salida del LLM SOLO aporta {role, title, task}. tools/autonomía/presupuesto/
//     scope se IGNORAN estructuralmente — no se leen (ver validatePlan).
//   - Solo se despacha a roles de NEGOCIO activos (scope='business', is_system=0). Eso
//     excluye a 'ceo' (el propio Hokage) y 'hermes' (system.exec) → un plan NUNCA puede
//     alcanzar system.exec ni elevarse.
//   - El especialista ejecuta con las capacidades que role_definitions le da, no las que
//     el plan pida. Hokage no puede conceder nada que la política (rolePolicy) no permita.
//   - La venture de cada tarea = la venture de la orden. Aislamiento estricto.

const MAX_PHASES = 4;
const MAX_TASKS_PER_PHASE = 4;
const MAX_TOTAL_TASKS = 12;
const TITLE_MAX = 120;
const PROMPT_MAX = 2000;
const RESULT_MAX = 2000;
const MAX_REPLANS = 2;        // tope DETERMINISTA de replanificaciones por orden — nunca un bucle
const PRIOR_RESULT_MAX = 400; // recorte del resultado previo que se pasa a una tarea dependiente

// ── Validación determinista del plan (PURA — testeable sin BD ni red) ────────
export interface ValidatedTask {
  phase: number;
  role: string;
  title: string;
  prompt: string;
  profile: TaskProfile;   // K.5: perfil de la tarea (lo PROPONE el LLM, lo SANEA validateTaskProfile)
}
export interface PlanValidation {
  tasks: ValidatedTask[];
  rejected: Array<{ reason: string; role?: string }>;
}

// Toma la salida cruda del LLM + el conjunto de roles PERMITIDOS (negocio, activos) y
// devuelve solo tareas seguras. Cualquier campo peligroso del LLM (tools, autonomy,
// budget, scope, is_system) NO se lee: no existe forma de expresarlo en una tarea válida.
export function validatePlan(raw: unknown, allowedRoles: Set<string>): PlanValidation {
  const tasks: ValidatedTask[] = [];
  const rejected: Array<{ reason: string; role?: string }> = [];

  const phases =
    raw && typeof raw === 'object' && Array.isArray((raw as { phases?: unknown }).phases)
      ? ((raw as { phases: unknown[] }).phases)
      : [];

  for (let p = 0; p < phases.length && p < MAX_PHASES; p++) {
    const phaseObj = phases[p] as { tasks?: unknown };
    const rawTasks = phaseObj && Array.isArray(phaseObj.tasks) ? phaseObj.tasks : [];
    let perPhase = 0;

    for (const rtUnknown of rawTasks) {
      if (perPhase >= MAX_TASKS_PER_PHASE || tasks.length >= MAX_TOTAL_TASKS) break;
      const rt = (rtUnknown ?? {}) as Record<string, unknown>;

      // Solo se leen estos tres campos. Todo lo demás del LLM se descarta a propósito.
      const role = typeof rt.role === 'string' ? rt.role.trim().toLowerCase() : '';
      const title = typeof rt.title === 'string' ? rt.title.trim() : '';
      const promptRaw = typeof rt.task === 'string' ? rt.task : typeof rt.prompt === 'string' ? rt.prompt : '';
      const prompt = typeof promptRaw === 'string' ? promptRaw.trim() : '';

      if (!allowedRoles.has(role)) {
        rejected.push({ reason: `rol no permitido o inexistente: "${role}"`, role });
        continue;
      }
      if (!title || !prompt) {
        rejected.push({ reason: 'tarea incompleta (title/task vacío)', role });
        continue;
      }
      tasks.push({ phase: p, role, title: title.slice(0, TITLE_MAX), prompt: prompt.slice(0, PROMPT_MAX), profile: validateTaskProfile(rt.profile) });
      perPhase++;
    }
  }
  return { tasks, rejected };
}

// K.5: modelo elegido por el ModelRouter para una tarea validada (parte de la cadena de Hokage,
// NO de askAgent). El tamaño de contexto lo estima el runtime desde el prompt real, no el LLM.
function routeModelFor(vt: ValidatedTask): string {
  return selectModel(vt.profile, { estimatedContextTokens: Math.ceil((vt.prompt.length + 2000) / 4) }).model.id;
}

// Roles a los que Hokage PUEDE delegar: negocio, no-sistema, activos. Excluye ceo/hermes.
export async function orchestratableRoles(): Promise<RoleDefinition[]> {
  const roles = await listRoleDefinitions();
  return roles.filter((r) => r.scope === 'business' && !r.is_system && r.status === 'active');
}

async function allowedRoleKeySet(): Promise<Set<string>> {
  return new Set((await orchestratableRoles()).map((r) => r.key));
}

// ── Descomposición vía LLM (la salida es DATO no confiable → pasa por validatePlan) ──
interface RawPlan {
  phases?: Array<{ tasks?: Array<{ role?: string; title?: string; task?: string; profile?: unknown }> }>;
}
// Alias exportado solo para tipar el plan inyectado en los tests (createCommand con decomposeFn).
export type RawPlanForTest = RawPlan;

async function decompose(text: string, ventureId: number | null): Promise<RawPlan | null> {
  const roles = await orchestratableRoles();
  const rolesDesc = roles.map((r) => `${r.key} (${r.label}${r.specialty ? `: ${r.specialty}` : ''})`).join(', ');

  let ventureCtx = '';
  if (ventureId != null) {
    const v = await get<{ name: string; type: string; goal: string | null }>(
      'SELECT name, type, goal FROM ventures WHERE id = ?',
      [ventureId]
    );
    if (v) ventureCtx = `\nNegocio: ${v.name} (${v.type})${v.goal ? ` — objetivo: ${v.goal.slice(0, 200)}` : ''}`;
  }

  const systemPrompt =
    'Eres el orquestador de HOKAGE OS. Descompones una orden del operador en tareas concretas para ' +
    'especialistas. Devuelves ÚNICAMENTE JSON válido, sin texto adicional, sin markdown.';
  const userMsg = `Orden del operador: "${text}"${ventureCtx}

Roles disponibles (usa SOLO estas claves): ${rolesDesc}

Devuelve exactamente este JSON:
{"phases":[{"tasks":[{"role":"<clave_de_rol>","title":"título corto","task":"instrucción concreta para el especialista","profile":{"kind":"research|content|strategy|analysis|review|classify|bulk|code|design|conversation","complexity":"low|medium|high","importance":"low|medium|high|critical","needs":{"reasoning":false,"creativity":false,"research":false,"tools":false},"risk":"low|medium|high"}}]}]}

Reglas:
- Agrupa en la MISMA fase las tareas independientes (se ejecutan en paralelo).
- Pon en una fase POSTERIOR una tarea que dependa del resultado de otra.
- Máximo ${MAX_PHASES} fases y ${MAX_TASKS_PER_PHASE} tareas por fase.
- Cada tarea va a UN rol de la lista. No inventes roles, tools ni permisos.
- "profile" describe la tarea para elegir el modelo. Sé HONESTO: no marques todo como critical/high. importance=critical solo para lo irreversible o público; needs.tools=true solo si de verdad requiere herramientas.`;

  const model = await modelFor('ceo');
  // Atribución de coste del planner a la venture (Fase 7): el actor es el agente ceo (Hokage).
  // callAIJson registra en agent_costs con venture_id, sin tocar agent_budgets.
  const ceo = await get<{ id: number }>("SELECT id FROM agents WHERE role = 'ceo' AND venture_id IS NULL LIMIT 1");
  return callAIJson<RawPlan>(systemPrompt, userMsg, model, ceo ? { ventureId, agentId: ceo.id } : undefined);
}

// ── Selección / creación de especialista desde el Role Registry (Fase 1) ──────
// Prefiere un agente de esta venture; si no, uno global (venture_id NULL) reutilizable;
// si no existe ninguno, lo INSTANCIA desde el role_definition (createAgent hereda modelo,
// prompt base y presupuesto del rol). Nunca crea un agente "en blanco".
// Reutilizar un agente global entre ventures es SEGURO desde F8: su agent_memory PRIVADA está
// scopeada por (agent_id, venture_id), así que un especialista que trabaja en V1 y V2 no cruza
// sus facts privados. La memoria de NEGOCIO (memory_entries) sigue aislada por venture (F4).
// ADR-011: SELECCIÓN (no claim). El claim atómico lo hace stage2 al promover el work_item a
// in_progress (gate único pending→in_progress, decisión #5) por work_item.id — así claim y release
// comparten identidad. Aquí solo se elige/crea el agente; la selección respeta ADR-011 (selectAgent
// ya excluye agentes reclamados) y el fallback nunca reutiliza un agente ocupado (decisión #11).
async function selectOrCreateSpecialist(role: string, ventureId: number | null, commandId?: number, taskId?: number, excludeAgentIds?: number[]): Promise<number> {
  // ADR-014 reassign_agent: filtro SQL para excluir al agente anterior en la ruta legacy.
  const excludeSql = excludeAgentIds && excludeAgentIds.length ? ` AND id NOT IN (${excludeAgentIds.join(',')})` : '';

  // Si hay taskId, preferir selección por capability matching (excluye agentes ya reclamados).
  if (taskId != null) {
    const def = await getRoleDefinition(role);
    const baseCaps = def ? JSON.parse(def.capabilities) : [];
    const result = await selectAgent({
      ventureId,
      requiredCapabilities: baseCaps as any,
      agentTypes: ['permanent'],
      excludeAgentIds, // ADR-014: reassign excluye al agente que falló
      maxResults: 1,
    });
    if (result.length > 0) {
      await recordAudit({ type: 'agent.selected', ventureId, commandId, taskId, agentId: result[0].agentId, meta: { role, via: 'capability' } });
      return result[0].agentId;
    }
  }

  // Fallback legacy: preferir agente scoped/venture, luego global — pero SOLO realmente disponibles
  // (decisión #11: nunca reutilizar un agente reclamado/busy saltándose ADR-011). Si el elegido lo
  // reclama otro antes de que stage2 lo tome, el claim de stage2 fallará y el work_item reintentará.
  const CLAIMABLE = `availability = 'available' AND (claimed_by_task IS NULL OR claim_expires_at < datetime('now'))`;
  let agentId: number | null = null;
  if (ventureId != null) {
    const scoped = await get<{ id: number }>(`SELECT id FROM agents WHERE role = ? AND venture_id = ? AND ${CLAIMABLE}${excludeSql} LIMIT 1`, [role, ventureId]);
    if (scoped) agentId = scoped.id;
  }
  if (agentId == null) {
    const global = await get<{ id: number }>(`SELECT id FROM agents WHERE role = ? AND venture_id IS NULL AND ${CLAIMABLE}${excludeSql} LIMIT 1`, [role]);
    if (global) agentId = global.id;
  }
  let created = false;
  if (agentId == null) {
    const def = await getRoleDefinition(role);
    const name = `${def?.label ?? role}${ventureId != null ? ` · v${ventureId}` : ''}`;
    agentId = (await createAgent({ name, role, venture_id: ventureId })).id;
    created = true;
  }
  await recordAudit({ type: created ? 'agent.created' : 'agent.selected', ventureId, commandId, taskId, agentId, meta: { role } });
  return agentId;
}

// ── Presupuesto (lectura, mismo criterio que stage2 del runtime) ──────────────
// Aplica el límite POR AGENTE existente (agent_budgets). DEUDA (requisito PRE-PRODUCCIÓN,
// siguiente fase — decisión aprobada 'b'): un techo de gasto POR VENTURE (sumar agent_costs
// del venture contra ventures.budget_allocated_usd) todavía NO se aplica. No se implementa en
// la Fase 5 para no ampliar el alcance; es obligatorio antes de producción.
async function budgetBlocked(agentId: number): Promise<{ blocked: boolean; pct: number }> {
  const b = await get<{ monthly_limit_usd: number; current_month_usd: number; status: string }>(
    'SELECT monthly_limit_usd, current_month_usd, status FROM agent_budgets WHERE agent_id = ?',
    [agentId]
  );
  if (!b) return { blocked: false, pct: 0 };
  const pct = b.monthly_limit_usd > 0 ? b.current_month_usd / b.monthly_limit_usd : 0;
  return { blocked: b.status === 'paused' || pct >= 1.0, pct: Math.round(pct * 100) };
}

// ── Persistencia auxiliar ─────────────────────────────────────────────────────
const CMD_SELECT = 'SELECT id, venture_id, text, status, plan_summary, result_summary, idempotency_key, replan_count, created_at, updated_at FROM hokage_commands';
const TASK_SELECT = 'SELECT id, command_id, phase, role, agent_id, title, prompt, status, work_item_id, result, error, reserved_usd, model, depends_on_count, handoff_input, handoff_from_role, review_cycles, review_verdict, review_feedback, created_at, updated_at FROM hokage_tasks';
const EDGE_SELECT = "SELECT id, command_id, from_task_id, to_task_id, type, payload, created_at FROM task_edges";

async function getCommandRow(id: number): Promise<HokageCommand | undefined> {
  return get<HokageCommand>(`${CMD_SELECT} WHERE id = ?`, [id]);
}
async function tasksOf(commandId: number): Promise<HokageTask[]> {
  return all<HokageTask>(`${TASK_SELECT} WHERE command_id = ? ORDER BY phase ASC, id ASC`, [commandId]);
}
async function edgesOf(commandId: number): Promise<TaskEdge[]> {
  return all<TaskEdge>(`${EDGE_SELECT} WHERE command_id = ?`, [commandId]);
}

const TERMINAL_CMD: HokageCommandStatus[] = ['completed', 'partial', 'failed', 'cancelled'];

// ── Persistencia de edges (ADR-012: task_edges como fuente de verdad) ────────
async function persistEdges(commandId: number, edges: TaskEdge[]): Promise<void> {
  for (const e of edges) {
    await run(
      `INSERT OR IGNORE INTO task_edges (command_id, from_task_id, to_task_id, type, payload) VALUES (?, ?, ?, ?, ?)`,
      [commandId, e.from_task_id, e.to_task_id, e.type, e.payload ?? '{}']
    );
  }
}

// ── Resolución de handoff: propaga el resultado de la tarea origen a la destino ──
async function applyHandoff(commandId: number, fromTaskId: number, resultText: string): Promise<void> {
  const edges = await all<TaskEdge>(
    `${EDGE_SELECT} WHERE command_id = ? AND from_task_id = ? AND type = 'handoff'`,
    [commandId, fromTaskId]
  );
  let parsed: any = null;
  try { parsed = JSON.parse(resultText); } catch { /* resultado no-JSON */ }

  const fromTask = await get<{ role: string }>('SELECT role FROM hokage_tasks WHERE id = ?', [fromTaskId]);
  const fromRole = fromTask?.role ?? 'desconocido';

  for (const edge of edges) {
    const keys = extractHandoffKeys(edge.payload);
    if (keys.length === 0) continue;
    const values: Record<string, string> = {};
    for (const k of keys) {
      const v = parsed && typeof parsed === 'object' && k in parsed ? String((parsed as any)[k]) : '';
      values[k] = v;
    }
    const template = JSON.parse(edge.payload).template ?? '';
    const resolved = resolveHandoffTemplate(template, values);
    const dst = await get<{ id: number; role: string }>('SELECT id, role FROM hokage_tasks WHERE id = ? AND status = ?', [edge.to_task_id, 'pending']);
    if (!dst) continue;
    // Guardamos el handoff_input Y el rol de origen (para el contexto de despacho)
    await run(`UPDATE hokage_tasks SET handoff_input = ?, handoff_from_role = ?, updated_at = datetime('now') WHERE id = ?`, [resolved, fromRole, dst.id]);
    await recordAudit({ type: 'task.handoff', ventureId: null, commandId, taskId: dst.id, meta: { from: fromTaskId, fromRole, keys, resolved } });
  }
}

// ── Decrementa depends_on_count de las tareas sucesoras (ADR-012) ─────────────
// Cuando una tarea se completa, sus sucesoras con edge 'depends_on' reducen su contador.
// Si llega a 0, dispatchReadyTasks las recogerá en la siguiente pasada.
async function decrementDependsOnCount(commandId: number, fromTaskId: number): Promise<void> {
  const edges = await all<TaskEdge>(
    `${EDGE_SELECT} WHERE command_id = ? AND from_task_id = ? AND type = 'depends_on'`,
    [commandId, fromTaskId]
  );
  for (const edge of edges) {
    await run(
      `UPDATE hokage_tasks SET depends_on_count = depends_on_count - 1, updated_at = datetime('now') WHERE id = ? AND depends_on_count > 0`,
      [edge.to_task_id]
    );
  }
}

// ── Review flow (ADR-012): spawn revisor al completar la tarea original ────────
async function handleReviewSpawn(commandId: number, fromTask: HokageTask): Promise<void> {
  const edges = await all<TaskEdge>(
    `${EDGE_SELECT} WHERE command_id = ? AND from_task_id = ? AND type = 'review_of'`,
    [commandId, fromTask.id]
  );
  if (edges.length === 0) return;

  // Solo una review por ciclo; verificar tope por rol (role_definitions.max_review_cycles)
  const def = await getRoleDefinition(fromTask.role);
  const maxCycles = def?.max_review_cycles ?? 2;
  if (fromTask.review_cycles >= maxCycles) {
    await recordAudit({ type: 'task.review.skipped', ventureId: null, commandId, taskId: fromTask.id, meta: { reason: 'max_cycles', cycles: fromTask.review_cycles, max: maxCycles } });
    return;
  }

  for (const edge of edges) {
    const toTask = await get<HokageTask>(`${TASK_SELECT} WHERE id = ?`, [edge.to_task_id]);
    if (!toTask) continue;
    if (toTask.status !== 'pending' && toTask.status !== 'blocked') continue;

    // Incrementar ciclo de review en la tarea original y despachar la revisión.
    await run(`UPDATE hokage_tasks SET review_cycles = review_cycles + 1, updated_at = datetime('now') WHERE id = ?`, [fromTask.id]);
    const cmd = (await getCommandRow(commandId))!;
    const n = await dispatchPhase(cmd, toTask.phase + 0, [toTask.id]);
    if (n === 0) await advanceCommand(commandId, toTask.phase);
    return; // una review por completion
  }
}

// ── Veredicto de review (ADR-012): al completar la tarea revisora ─────────────
async function handleReviewVerdict(commandId: number, reviewTask: HokageTask, resultText: string): Promise<void> {
  // Buscar el edge review_of entrante a esta tarea
  const edge = await get<TaskEdge>(
    `${EDGE_SELECT} WHERE command_id = ? AND to_task_id = ? AND type = 'review_of'`,
    [commandId, reviewTask.id]
  );
  if (!edge) return;

  const original = await get<HokageTask>(`${TASK_SELECT} WHERE id = ?`, [edge.from_task_id]);
  if (!original) return;

  let verdict = 'pass';
  let feedback = '';
  try {
    const parsed = JSON.parse(resultText);
    if (parsed && typeof parsed === 'object') {
      verdict = typeof parsed.verdict === 'string' ? parsed.verdict : 'pass';
      feedback = typeof parsed.feedback === 'string' ? parsed.feedback : '';
    }
  } catch {
    // texto plano sin veredicto estructurado → pass por defecto
  }

  await run(`UPDATE hokage_tasks SET review_verdict = ?, review_feedback = ?, updated_at = datetime('now') WHERE id = ?`, [verdict, feedback, original.id]);

  if (verdict === 'fail') {
    // Re-abrir la tarea original con el feedback inyectado en el prompt.
    // Poner depends_on_count = 1 para evitar auto-despacho inmediato (requiere re-despacho manual).
    const newPrompt = `${original.prompt}\n\n[FEEDBACK DE REVISIÓN #${original.review_cycles}]: ${feedback}`;
    await run(`UPDATE hokage_tasks SET status = 'pending', agent_id = NULL, work_item_id = NULL, prompt = ?, error = NULL, depends_on_count = 1, updated_at = datetime('now') WHERE id = ?`, [newPrompt, original.id]);
    await recordAudit({ type: 'task.review.fail', ventureId: null, commandId, taskId: original.id, meta: { feedback } });
  } else {
    await recordAudit({ type: 'task.review.pass', ventureId: null, commandId, taskId: original.id, meta: { feedback } });
  }
}

// ── Despacho de tareas listas (ADR-012: DAG por depends_on_count) ─────────────
// Reemplaza el dispatch por fase: una tarea está LISTA cuando depends_on_count === 0.
// Si `specificIds` se pasa, solo esas tareas se consideran (para re-despacho tras review).
async function dispatchReadyTasks(cmd: HokageCommand, specificIds?: number[], excludeAgentIds?: number[]): Promise<number> {
  const ready = await all<HokageTask>(
    `${TASK_SELECT} WHERE command_id = ? AND status = 'pending' AND depends_on_count = 0 ${specificIds && specificIds.length ? `AND id IN (${specificIds.join(',')})` : ''}`,
    [cmd.id]
  );
  let dispatched = 0;

  for (const t of ready) {
    // Defensa en profundidad: re-validar el rol en el momento del despacho (pudo desactivarse).
    const def = await getRoleDefinition(t.role);
    if (!def || def.status !== 'active' || def.scope !== 'business' || def.is_system) {
      await run(`UPDATE hokage_tasks SET status = 'blocked', error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'`,
        [`rol no despachable: ${t.role}`, t.id]);
      await recordAudit({ type: 'task.blocked', ventureId: cmd.venture_id, commandId: cmd.id, taskId: t.id, meta: { role: t.role, reason: 'role' } });
      continue;
    }

    // ADR-014 reassign_agent: excluir al agente anterior (solo aplica al re-despacho de una tarea).
    const agentId = await selectOrCreateSpecialist(t.role, cmd.venture_id, cmd.id, t.id, excludeAgentIds);

    const budget = await budgetBlocked(agentId);
    if (budget.blocked) {
      await run(`UPDATE hokage_tasks SET status = 'blocked', agent_id = ?, error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'`,
        [agentId, `presupuesto agotado (${budget.pct}%)`, t.id]);
      await recordAudit({ type: 'task.blocked', ventureId: cmd.venture_id, commandId: cmd.id, taskId: t.id, agentId, meta: { role: t.role, reason: 'agent_budget' } });
      continue;
    }

    // Reserva de presupuesto de VENTURE (Fase 7): comprometer el coste estimado ANTES de
    // ejecutar (chequeo antes del gasto). Atómico → concurrency-safe. null = sobre presupuesto.
    const est = estimateTaskCostUsd(def.model);
    const reserved = await reserveVentureBudget(cmd.venture_id, est);
    if (reserved === null) {
      await run(`UPDATE hokage_tasks SET status = 'blocked', agent_id = ?, error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'`,
        [agentId, 'presupuesto de la venture agotado', t.id]);
      await recordAudit({ type: 'budget.blocked', ventureId: cmd.venture_id, commandId: cmd.id, taskId: t.id, agentId, meta: { estimate: est } });
      await recordAudit({ type: 'task.blocked', ventureId: cmd.venture_id, commandId: cmd.id, taskId: t.id, agentId, meta: { role: t.role, reason: 'venture_budget' } });
      continue;
    }
    if (reserved > 0) {
      await recordAudit({ type: 'budget.reserved', ventureId: cmd.venture_id, commandId: cmd.id, taskId: t.id, agentId, meta: { amount: reserved } });
    }

    // Contexto: handoff_input resuelto (si existe) precedido del prompt de la tarea.
    const context = t.handoff_input
      ? `[HANDOFF de ${t.handoff_from_role ?? t.role}]\n${t.handoff_input}\n\n${t.prompt}`
      : t.prompt;

    // Un único camino de ejecución: work_item de tipo 'hokage_task'.
    const wi = await run(
      `INSERT INTO work_items (agent_id, venture_id, type, priority, status, context, model) VALUES (?, ?, 'hokage_task', 8, 'pending', ?, ?)`,
      [agentId, cmd.venture_id, context, t.model ?? null]
    );
    const upd = await run(`UPDATE hokage_tasks SET status = 'dispatched', agent_id = ?, work_item_id = ?, reserved_usd = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'`,
      [agentId, wi.lastID, reserved, t.id]);
    if (upd.changes !== 1) {
      await releaseVentureBudget(cmd.venture_id, reserved);
      continue;
    }

    bus.publish({ type: 'hokage.task.dispatched', from: 'Hokage', payload: { commandId: cmd.id, taskId: t.id, workItemId: wi.lastID, ventureId: cmd.venture_id, role: t.role, agentId } });
    dispatched++;
  }
  return dispatched;
}

// ── Despacho de una fase → work_items (reutiliza el motor de ejecución existente) ──
// Devuelve cuántas tareas quedaron efectivamente despachadas (no bloqueadas).
// `specificIds` permite re-despachar solo ciertas tareas (tras re-abrir por review).
async function dispatchPhase(cmd: HokageCommand, phase: number, specificIds?: number[]): Promise<number> {
  const pending = await all<HokageTask>(`${TASK_SELECT} WHERE command_id = ? AND phase = ? AND status = 'pending' ${specificIds && specificIds.length ? `AND id IN (${specificIds.join(',')})` : ''}`, [cmd.id, phase]);
  let dispatched = 0;

  // Flujo de dependencias: una tarea recibe los RESULTADOS de la fase anterior como DATO
  // (la comunicación entre especialistas pasa por el orquestador, no directa). Va en el
  // contexto = mensaje de usuario; el especialista sigue con SUS tools/autonomía por rol, así
  // que un resultado hostil no puede reconfigurarlo (misma frontera que un resultado de tool).
  let priorBlock = '';
  if (phase > 0) {
    const prior = await all<{ role: string; title: string; result: string | null }>(
      "SELECT role, title, result FROM hokage_tasks WHERE command_id = ? AND phase = ? AND status = 'completed'",
      [cmd.id, phase - 1]
    );
    if (prior.length > 0) {
      priorBlock = '[RESULTADOS PREVIOS DEL EQUIPO]\n' +
        prior.map((p) => `- ${p.role} · ${p.title}: ${(p.result ?? '').slice(0, PRIOR_RESULT_MAX)}`).join('\n') +
        '\n\n';
    }
  }

  for (const t of pending) {
    // Defensa en profundidad: re-validar el rol en el momento del despacho (pudo desactivarse).
    const def = await getRoleDefinition(t.role);
    if (!def || def.status !== 'active' || def.scope !== 'business' || def.is_system) {
      await run(`UPDATE hokage_tasks SET status = 'blocked', error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'`,
        [`rol no despachable: ${t.role}`, t.id]);
      await recordAudit({ type: 'task.blocked', ventureId: cmd.venture_id, commandId: cmd.id, taskId: t.id, meta: { role: t.role, reason: 'role' } });
      continue;
    }

    const agentId = await selectOrCreateSpecialist(t.role, cmd.venture_id, cmd.id, t.id);

    const budget = await budgetBlocked(agentId);
    if (budget.blocked) {
      await run(`UPDATE hokage_tasks SET status = 'blocked', agent_id = ?, error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'`,
        [agentId, `presupuesto agotado (${budget.pct}%)`, t.id]);
      await recordAudit({ type: 'task.blocked', ventureId: cmd.venture_id, commandId: cmd.id, taskId: t.id, agentId, meta: { role: t.role, reason: 'agent_budget' } });
      continue;
    }

    // Reserva de presupuesto de VENTURE (Fase 7): comprometer el coste estimado ANTES de
    // ejecutar (chequeo antes del gasto). Atómico → concurrency-safe. null = sobre presupuesto.
    const est = estimateTaskCostUsd(def.model);
    const reserved = await reserveVentureBudget(cmd.venture_id, est);
    if (reserved === null) {
      await run(`UPDATE hokage_tasks SET status = 'blocked', agent_id = ?, error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'`,
        [agentId, 'presupuesto de la venture agotado', t.id]);
      await recordAudit({ type: 'budget.blocked', ventureId: cmd.venture_id, commandId: cmd.id, taskId: t.id, agentId, meta: { estimate: est } });
      await recordAudit({ type: 'task.blocked', ventureId: cmd.venture_id, commandId: cmd.id, taskId: t.id, agentId, meta: { role: t.role, reason: 'venture_budget' } });
      continue;
    }
    if (reserved > 0) {
      await recordAudit({ type: 'budget.reserved', ventureId: cmd.venture_id, commandId: cmd.id, taskId: t.id, agentId, meta: { amount: reserved } });
    }

    // Un único camino de ejecución: work_item de tipo 'hokage_task'. stage3 lo ejecuta con
    // askAgent() (tools por rol + autonomía + contexto + memoria), venture_id incluido.
    // K.5: el modelo ya lo eligió el ModelRouter al crear el plan (routeModelFor → hokage_tasks.model).
    // Aquí solo se PROPAGA al work_item para que el runtime lo ejecute con él.
    const wi = await run(
      `INSERT INTO work_items (agent_id, venture_id, type, priority, status, context, model) VALUES (?, ?, 'hokage_task', 8, 'pending', ?, ?)`,
      [agentId, cmd.venture_id, priorBlock + t.prompt, t.model ?? null]
    );
    const upd = await run(`UPDATE hokage_tasks SET status = 'dispatched', agent_id = ?, work_item_id = ?, reserved_usd = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'`,
      [agentId, wi.lastID, reserved, t.id]);
    if (upd.changes !== 1) {
      // No debería ocurrir en este flujo secuencial; si ocurre, no dejar la reserva colgada.
      await releaseVentureBudget(cmd.venture_id, reserved);
      continue;
    }

    bus.publish({ type: 'hokage.task.dispatched', from: 'Hokage', payload: { commandId: cmd.id, taskId: t.id, workItemId: wi.lastID, ventureId: cmd.venture_id, role: t.role, agentId } });
    dispatched++;
  }
  return dispatched;
}

// Libera la reserva de presupuesto de una tarea de forma IDEMPOTENTE: solo el primero que pone
// reserved_usd a 0 decrementa el comprometido de la venture. Seguro ante múltiples llamadas
// (hook de completado, cancelación de comando, cancelación desde stage2). El coste REAL ya está
// en agent_costs; al liberar, la contabilidad pasa de "reservado" (estimación) a "real".
async function releaseTaskReservation(taskId: number): Promise<void> {
  const t = await get<{ command_id: number; reserved_usd: number }>(
    'SELECT command_id, reserved_usd FROM hokage_tasks WHERE id = ?', [taskId]
  );
  if (!t || t.reserved_usd <= 0) return;
  const z = await run("UPDATE hokage_tasks SET reserved_usd = 0 WHERE id = ? AND reserved_usd > 0", [taskId]);
  if (z.changes !== 1) return; // otro llamador ya liberó
  const cmd = await getCommandRow(t.command_id);
  await releaseVentureBudget(cmd?.venture_id ?? null, t.reserved_usd);
  await recordAudit({ type: 'budget.released', ventureId: cmd?.venture_id ?? null, commandId: t.command_id, taskId, meta: { amount: t.reserved_usd } });
}

// ═══════════ ADR-014 Slice B3 — Evaluación + Remediación (integration layer) ═══════════
// El engine (remediationEngine) es PURO: solo decide. La EJECUCIÓN de las acciones vive aquí,
// en el orquestador. Un retry/reassign vuelve al dispatcher existente (dispatchReadyTasks); no
// hay un segundo sistema de asignación. Los topes (maxRetries/maxRemediations, review_cycles) y
// el historial persistido (remediation_history) garantizan terminación (nunca retry→eval→retry…).

// Evalúa el resultado de una completion. Usa `resultText` como resultado autoritativo de ESTE
// intento (no work_items.result de BD, que en tests puede estar vacío); tokens/coste vienen del
// work_item si existen. Pura respecto a estado de tareas (solo lee work_items).
async function evaluateCompletion(task: HokageTask, workItemId: number, ok: boolean, resultText: string): Promise<TaskEvaluation> {
  const wiRow = await get<WorkItemForEval>(
    `SELECT id, agent_id, type, context, result, error, tokens_in, tokens_out, llm_cost_usd, tool_cost_usd,
            venture_id, model, milestone_id, retry_count, created_at, resolved_at
     FROM work_items WHERE id = ?`,
    [workItemId]
  );
  const workItem: WorkItemForEval = {
    id: workItemId,
    agent_id: wiRow?.agent_id ?? task.agent_id ?? 0,
    type: wiRow?.type ?? 'hokage_task',
    context: wiRow?.context ?? null,
    result: ok ? resultText : (wiRow?.result ?? resultText ?? null),
    error: ok ? (wiRow?.error ?? null) : resultText,
    tokens_in: wiRow?.tokens_in ?? null,
    tokens_out: wiRow?.tokens_out ?? null,
    llm_cost_usd: wiRow?.llm_cost_usd ?? null,
    tool_cost_usd: wiRow?.tool_cost_usd ?? null,
    venture_id: wiRow?.venture_id ?? null,
    model: wiRow?.model ?? task.model ?? null,
    milestone_id: wiRow?.milestone_id ?? null,
    retry_count: wiRow?.retry_count ?? 0,
    created_at: wiRow?.created_at,
    resolved_at: wiRow?.resolved_at,
  };
  const roleDef = await getRoleDefinition(task.role);
  return evaluateAutomated(workItem, task, roleDef);
}

// ¿Es esta tarea una REVISORA (ADR-012)? Tiene un edge review_of entrante. Las revisoras NO se
// remedian aquí: su veredicto lo procesa handleReviewVerdict (no romper el ciclo de review).
async function isReviewerTask(task: HokageTask): Promise<boolean> {
  const e = await get<TaskEdge>(`${EDGE_SELECT} WHERE command_id = ? AND to_task_id = ? AND type = 'review_of'`, [task.command_id, task.id]);
  return !!e;
}

function parseRemediationPolicy(raw: RemediationPolicy | string | null | undefined): RemediationPolicy {
  if (!raw) return DEFAULT_REMEDIATION_POLICY;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as RemediationPolicy; } catch { return DEFAULT_REMEDIATION_POLICY; }
  }
  return raw;
}

function parseRemediationHistory(raw: unknown): RemediationAttempt[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as RemediationAttempt[];
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

// Deserialización segura del TaskProfile persistido (frontera única de lectura).
// NULL/legacy → null (no se fabrica perfil). JSON válido → se sanea con validateTaskProfile
// (reutilizado, sin segundo validador). JSON corrupto → null, sin lanzar.
export function parseTaskProfile(raw: unknown): TaskProfile | null {
  if (raw === null || raw === undefined || raw === '') return null;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return null; }
  }
  return validateTaskProfile(parsed);
}

// Fallback conservador para tareas legacy SIN task_profile (comportamiento previo a la persistencia).
// No se elimina todavía: sigue vivo mientras existan tareas antiguas sin perfil.
const CONSERVATIVE_ESCALATION_PROFILE: TaskProfile = {
  kind: 'analysis', complexity: 'medium', importance: 'high', needs: { reasoning: true }, risk: 'medium',
};

// escalate_model: usa el TaskProfile REAL si la tarea lo tiene persistido; si es legacy (NULL),
// mantiene el fallback conservador previo. Sube un tier vía ModelRouter determinista. Si algo
// falla, conserva el modelo actual (peor caso = comportamiento de retry_with_feedback).
// NUNCA sobrescribe task_profile: solo devuelve el model resuelto para esta ejecución.
function escalatedModelId(task: HokageTask): string | undefined {
  try {
    const real = parseTaskProfile((task as unknown as { task_profile?: unknown }).task_profile);
    const base = real ?? CONSERVATIVE_ESCALATION_PROFILE;
    const escalated = getEscalatedModelProfile(base as unknown as Parameters<typeof getEscalatedModelProfile>[0]);
    return selectModel(escalated as unknown as TaskProfile).model.id;
  } catch {
    return task.model ?? undefined;
  }
}

// Re-abre la tarea y la devuelve al dispatcher EXISTENTE. Atómico e idempotente: solo actúa si la
// tarea SIGUE 'dispatched' (evita doble dispatch frente a completion duplicado). Incrementa el
// counter correspondiente y añade la acción a remediation_history (fuente de los topes del engine).
async function reopenAndDispatch(
  task: HokageTask,
  action: RemediationAction,
  history: RemediationAttempt[],
  opts: { feedback?: string; modelOverride?: string; clearAgent?: boolean; excludeAgentIds?: number[] }
): Promise<boolean> {
  const cmd = await getCommandRow(task.command_id);
  if (!cmd) { await safeFailTerminal(task, 'command inexistente'); return true; }

  const newHistory: RemediationAttempt[] = [...history, { action, workItemId: task.work_item_id ?? 0, createdAt: new Date().toISOString() }];
  const counterCol = action === 'retry_immediate' ? 'retry_count' : 'remediation_count';
  const newPrompt = opts.feedback
    ? `${task.prompt}\n\n[REMEDIACIÓN · ${action}] ${opts.feedback}`.slice(0, PROMPT_MAX)
    : task.prompt;
  const newModel = opts.modelOverride ?? task.model;
  const newAgent = opts.clearAgent ? null : task.agent_id;

  const upd = await run(
    `UPDATE hokage_tasks
       SET status = 'pending', work_item_id = NULL, agent_id = ?, prompt = ?, model = ?,
           error = NULL, ${counterCol} = ${counterCol} + 1, remediation_history = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'dispatched'`,
    [newAgent, newPrompt, newModel, JSON.stringify(newHistory), task.id]
  );
  if (upd.changes !== 1) return true; // otra transición ya movió la tarea → NO re-despachar (sin doble dispatch)

  await recordAudit({ type: 'task.remediation.executed', ventureId: cmd.venture_id, commandId: cmd.id, taskId: task.id, agentId: task.agent_id, meta: { action, attempts: newHistory.length } });
  bus.publish({ type: 'hokage.task.remediation', from: 'Hokage', payload: { commandId: cmd.id, taskId: task.id, ventureId: cmd.venture_id, action, attempt: newHistory.length } });

  await dispatchReadyTasks(cmd, [task.id], opts.excludeAgentIds);
  return true;
}

// Terminal seguro: propone Decision a Jorge y deja la tarea 'failed'. El guard de completion
// impide re-entrada → sin bucle. createDecision dedupea por (entity_type, entity_id).
async function escalateRemediationToHuman(task: HokageTask, evaluation: TaskEvaluation, action: RemediationAction, reason: string): Promise<boolean> {
  const cmd = await getCommandRow(task.command_id);
  try {
    await createDecision({
      title: `Remediación requiere intervención: ${task.title}`.slice(0, TITLE_MAX),
      description: `Tarea ${task.id} no superó la evaluación (${evaluation.verdict}). Causa: ${evaluation.diagnosis?.rootCause ?? 'desconocida'}. Acción: ${action}. ${reason}`.slice(0, PROMPT_MAX),
      venture_id: cmd?.venture_id ?? null,
      entity_type: 'hokage_task',
      entity_id: task.id,
      risk_level: 'medium',
    });
  } catch (e) { console.error('[REMEDIATION] createDecision:', (e as Error).message); }

  await run(`UPDATE hokage_tasks SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'dispatched'`,
    [`remediación: ${action} (${reason})`.slice(0, RESULT_MAX), task.id]);
  await recordAudit({ type: 'task.remediation.human', ventureId: cmd?.venture_id ?? null, commandId: task.command_id, taskId: task.id, agentId: task.agent_id, meta: { action, reason, verdict: evaluation.verdict } });
  if (cmd) await dispatchReadyTasks(cmd); // avanzar hermanas listas (no re-despacha esta, ya failed)
  return true;
}

// Salida de emergencia si la ejecución de remediación lanza: la tarea queda 'failed' (observable),
// nunca se propaga el error al flujo principal del orquestador.
async function safeFailTerminal(task: HokageTask, reason: string): Promise<void> {
  try {
    await run(`UPDATE hokage_tasks SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ? AND status IN ('dispatched','pending')`,
      [`remediación abortada: ${reason}`.slice(0, RESULT_MAX), task.id]);
    await recordAudit({ type: 'task.remediation.error', commandId: task.command_id, taskId: task.id, meta: { reason } });
    const cmd = await getCommandRow(task.command_id);
    if (cmd) await dispatchReadyTasks(cmd);
  } catch (e) { console.error('[REMEDIATION] safeFailTerminal:', (e as Error).message); }
}

// Punto de entrada de remediación (integration layer). Decide con el engine PURO y ejecuta la
// acción. Nunca lanza: cualquier error interno cae en safeFailTerminal. Devuelve true cuando toma
// el control del flujo (re-despacho o terminal), para que onHokageTaskCompleted NO haga doble dispatch.
export async function remediateTask(task: HokageTask, evaluation: TaskEvaluation): Promise<boolean> {
  try {
    // Liberar reserva y claim del intento anterior antes de re-despachar (idempotentes).
    await releaseTaskReservation(task.id);
    if (task.agent_id != null && task.work_item_id != null) await releaseAgent(task.agent_id, task.work_item_id);

    const policy = parseRemediationPolicy(task.remediation_policy);
    const counters: TaskCounters = { retryCount: task.retry_count ?? 0, remediationCount: task.remediation_count ?? 0 };
    const history = parseRemediationHistory((task as unknown as { remediation_history?: unknown }).remediation_history);
    const roleDef = await getRoleDefinition(task.role);
    const reviewContext: ReviewContext | null = policy.respectReviewCycles
      ? { cycles: task.review_cycles ?? 0, maxCycles: roleDef?.max_review_cycles ?? 2, lastVerdict: (task.review_verdict as ReviewContext['lastVerdict']) ?? null, lastFeedback: task.review_feedback ?? null }
      : null;

    const decision = planRemediation(evaluation, task, policy, counters, history, reviewContext);
    const cmdRow = await getCommandRow(task.command_id);
    await recordAudit({ type: 'task.remediation.planned', ventureId: cmdRow?.venture_id ?? null, commandId: task.command_id, taskId: task.id, agentId: task.agent_id, meta: { verdict: evaluation.verdict, category: evaluation.diagnosis?.category ?? 'unknown', action: decision.action, reason: decision.reason } });

    switch (decision.action) {
      case 'retry_immediate':
        return await reopenAndDispatch(task, 'retry_immediate', history, {});
      case 'retry_with_feedback':
        return await reopenAndDispatch(task, 'retry_with_feedback', history, { feedback: decision.injectFeedback });
      case 'escalate_model':
        return await reopenAndDispatch(task, 'escalate_model', history, { feedback: decision.injectFeedback, modelOverride: escalatedModelId(task) });
      case 'reassign_agent':
        return await reopenAndDispatch(task, 'reassign_agent', history, {
          feedback: decision.injectFeedback,
          clearAgent: true,
          excludeAgentIds: decision.excludedAgentIds ?? (task.agent_id != null ? [task.agent_id] : undefined),
        });
      case 'replan_task':
      case 'replan_command':
        // NO IMPLEMENTADO: no hay replanSingleTask ni TaskProfile persistido → una replanificación
        // LLM por-tarea sería improvisar. Terminal humano seguro (ver informe B3).
        return await escalateRemediationToHuman(task, evaluation, decision.action, decision.reason);
      case 'human_intervention':
      default:
        return await escalateRemediationToHuman(task, evaluation, 'human_intervention', decision.reason);
    }
  } catch (err) {
    console.error('[REMEDIATION] error, salida segura:', (err as Error).message);
    await safeFailTerminal(task, (err as Error).message);
    return true;
  }
}

// ── Avance del DAG: se llama cuando una tarea termina (hook desde stage3) ──────
// El agentRuntime procesa work_items secuencialmente dentro de un tick, así que estas
// transiciones no se solapan → no hacen falta locks.
export async function onHokageTaskCompleted(workItemId: number, ok: boolean, resultText: string, errorClass?: AgentErrorClass): Promise<void> {
  // SELECT * → HokageTask completo (incluye output_schema/acceptance_criteria/quality_floor y los
  // contadores/política/historial de remediación) que el TASK_SELECT reducido no trae.
  const task = await get<HokageTask>(`SELECT * FROM hokage_tasks WHERE work_item_id = ?`, [workItemId]);
  if (!task || task.status !== 'dispatched') return; // no es nuestra, o ya resuelta/cancelada (idempotente)

  // ADR-014 B3: evaluación determinista integrada (antes observacional en agentRuntime stage3).
  // Corre para toda completion de hokage_task; persistir es best-effort (aislado del flujo).
  const evaluation = await evaluateCompletion(task, workItemId, ok, resultText);

  // ADR-014 transient: el evaluador de contenido NO puede emitir 'transient' (la señal viene del
  // transporte). Si el fallo de ejecución (ok=false) llega clasificado como transient, se convierte
  // en un diagnóstico transient estructurado → la escalera lo tratará como retry_immediate.
  const isTransient = !ok && errorClass === 'transient';
  if (isTransient) {
    evaluation.verdict = 'error';
    evaluation.diagnosis = {
      category: 'transient',
      rootCause: resultText || 'transient transport error',
      suggestedRemediation: 'retry_immediate',
      retryable: true,
      context: {},
    };
  }

  try { await insertTaskEvaluation(evaluation); } catch (e) { console.error('[EVAL] persistencia:', (e as Error).message); }

  // ADR-014: remediación si (B3) el agente ejecutó OK pero el resultado no supera la evaluación,
  // O (transient) el fallo de transporte es reintentable. Todo lo demás de ok=false (permanent/
  // policy/budget/config/undefined) conserva el camino de fallo existente (semántica DAG/replan
  // intacta). Las revisoras (ADR-012) no se remedian aquí. Si remedia → return (sin doble dispatch).
  const needsRemediation = (ok && evaluation.verdict !== 'pass') || isTransient;
  if (needsRemediation && !(await isReviewerTask(task))) {
    const handled = await remediateTask(task, evaluation);
    if (handled) return;
  }

  await run(
    `UPDATE hokage_tasks SET status = ?, result = ?, error = ?, updated_at = datetime('now') WHERE id = ?`,
    [ok ? 'completed' : 'failed', ok ? resultText.slice(0, RESULT_MAX) : null, ok ? null : (resultText.slice(0, RESULT_MAX) || 'fallo'), task.id]
  );
  const cmdRow = await getCommandRow(task.command_id);
  await recordAudit({ type: ok ? 'task.completed' : 'task.failed', ventureId: cmdRow?.venture_id ?? null, commandId: task.command_id, taskId: task.id, workItemId, agentId: task.agent_id, status: ok ? 'ok' : 'error' });
  await releaseTaskReservation(task.id); // el coste real ya quedó en agent_costs

  // ADR-011: liberar claim del agente (idempotente)
  if (task.agent_id != null && task.work_item_id != null) {
    await releaseAgent(task.agent_id, task.work_item_id);
  }

  if (ok) {
    // ADR-012: decrementar depends_on_count de sucesoras (edges type='depends_on')
    await decrementDependsOnCount(task.command_id, task.id);

    // ADR-012: ¿es esta tarea una revisora? (tiene edge review_of entrante)
    const reviewEdge = await get<TaskEdge>(
      `${EDGE_SELECT} WHERE command_id = ? AND to_task_id = ? AND type = 'review_of'`,
      [task.command_id, task.id]
    );
    if (reviewEdge) {
      // Es una tarea de revisión → procesar veredicto
      await handleReviewVerdict(task.command_id, task, resultText);
    } else {
      // Es una tarea normal → handoff + review spawn
      await applyHandoff(task.command_id, task.id, resultText);
      await handleReviewSpawn(task.command_id, task);
    }
  }

  // ADR-012: avanazar DAG (dispatchReadyTasks reemplaza advanceCommand por fase)
  await dispatchReadyTasks((await getCommandRow(task.command_id))!);
}

// Hook desde stage2 cuando cancela un work_item (presupuesto por-agente / pausa / TTL): si era
// una tarea de Hokage, marcarla blocked, liberar su reserva y avanzar el DAG (evita que la
// orden quede colgada y que la reserva se filtre). No-op si el work_item no es de Hokage.
export async function onHokageWorkItemCancelled(workItemId: number): Promise<void> {
  const task = await get<HokageTask>(`${TASK_SELECT} WHERE work_item_id = ?`, [workItemId]);
  if (!task || task.status !== 'dispatched') return;
  await run(
    `UPDATE hokage_tasks SET status = 'blocked', error = COALESCE(error, 'work_item cancelado (presupuesto/TTL)'), updated_at = datetime('now') WHERE id = ?`,
    [task.id]
  );
  await releaseTaskReservation(task.id);

  // ADR-011: liberar claim del agente (idempotente)
  if (task.agent_id != null && task.work_item_id != null) {
    await releaseAgent(task.agent_id, task.work_item_id);
  }

  await dispatchReadyTasks((await getCommandRow(task.command_id))!);
}

async function advanceCommand(commandId: number, phase: number): Promise<void> {
  const cmd = await getCommandRow(commandId);
  if (!cmd || TERMINAL_CMD.includes(cmd.status)) return;

  const phaseTasks = await all<{ status: string }>('SELECT status FROM hokage_tasks WHERE command_id = ? AND phase = ?', [commandId, phase]);
  const stillRunning = phaseTasks.some((t) => t.status === 'pending' || t.status === 'dispatched');
  if (stillRunning) return; // esperar a las tareas hermanas de la misma fase

  const phaseFailed = phaseTasks.some((t) => t.status === 'failed' || t.status === 'blocked');
  if (phaseFailed) {
    // Una fase con fallo bloquea las fases dependientes posteriores. Las hermanas de esta
    // misma fase ya terminaron (arriba) → "continuación segura": no se abortan.
    await run(`UPDATE hokage_tasks SET status = 'blocked', updated_at = datetime('now') WHERE command_id = ? AND phase > ? AND status = 'pending'`, [commandId, phase]);
    // Supervisor: intentar un plan alternativo para el trabajo restante (tope MAX_REPLANS).
    // Si no se puede (límite alcanzado, sin IA o sin plan válido), se cierra con briefing honesto.
    const replanned = await attemptReplan(commandId);
    if (!replanned) await finalizeCommand(commandId);
    return;
  }

  bus.publish({ type: 'hokage.phase.completed', from: 'Hokage', payload: { commandId, ventureId: cmd.venture_id, phase } });

  const next = await get<{ phase: number | null }>(
    "SELECT MIN(phase) as phase FROM hokage_tasks WHERE command_id = ? AND phase > ? AND status = 'pending'",
    [commandId, phase]
  );
  if (next && next.phase != null) {
    const n = await dispatchPhase(cmd, next.phase);
    if (n === 0) await advanceCommand(commandId, next.phase); // todas bloqueadas → cascada
  } else {
    await finalizeCommand(commandId);
  }
}

// Replanificación acotada del supervisor. Ante tareas sin completar, Hokage genera un plan
// alternativo (informado por el fallo) para el trabajo restante y lo despacha en fases nuevas.
// Límite DURO (MAX_REPLANS) → nunca un bucle infinito de agentes. decomposeFn es inyectable
// SOLO para tests; en producción usa el planner real. Devuelve true si añadió y despachó tareas.
export async function attemptReplan(
  commandId: number,
  decomposeFn: (text: string, ventureId: number | null) => Promise<RawPlan | null> = decompose
): Promise<boolean> {
  const cmd = await getCommandRow(commandId);
  if (!cmd || TERMINAL_CMD.includes(cmd.status)) return false;
  if (cmd.replan_count >= MAX_REPLANS) return false; // tope determinista
  if (await ventureOverRealBudget(cmd.venture_id)) return false; // un replan NO elude el presupuesto

  const failed = await all<{ role: string; title: string; error: string | null }>(
    "SELECT role, title, error FROM hokage_tasks WHERE command_id = ? AND status IN ('failed','blocked')",
    [commandId]
  );
  const failureNote = failed.map((f) => `- ${f.role}/${f.title}: ${f.error ?? 'fallo'}`).join('\n');
  const raw = await decomposeFn(
    `${cmd.text}\n\n[REPLANIFICACIÓN] Tareas sin completar en el intento anterior:\n${failureNote}\nGenera un plan alternativo SOLO para el trabajo que queda.`,
    cmd.venture_id
  );
  const { tasks } = validatePlan(raw, await allowedRoleKeySet());
  if (tasks.length === 0) return false;

  const maxPhaseRow = await get<{ m: number | null }>('SELECT MAX(phase) as m FROM hokage_tasks WHERE command_id = ?', [commandId]);
  const base = (maxPhaseRow?.m ?? 0) + 1; // las tareas nuevas van a fases posteriores a todo lo anterior
  for (const vt of tasks) {
    await run(
      `INSERT INTO hokage_tasks (command_id, phase, role, title, prompt, status, model, task_profile) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [commandId, base + vt.phase, vt.role, vt.title, vt.prompt, routeModelFor(vt), JSON.stringify(vt.profile)]
    );
  }

  // ADR-012: generar edges para tareas nuevas + validar + depends_on_count + persistir
  const allTasks = await tasksOf(commandId);
  const newEdges = generateImplicitEdges(allTasks);
  const validated = validateTaskGraph(allTasks, newEdges);

  for (const task of validated.tasks) {
    const count = newEdges.filter((e) => e.to_task_id === task.id && e.type === 'depends_on').length;
    await run(`UPDATE hokage_tasks SET depends_on_count = ? WHERE id = ?`, [count, task.id]);
  }
  await persistEdges(commandId, newEdges);

  await run(`UPDATE hokage_commands SET replan_count = replan_count + 1, status = 'active', updated_at = datetime('now') WHERE id = ?`, [commandId]);
  bus.publish({ type: 'hokage.command.replanned', from: 'Hokage', payload: { commandId, ventureId: cmd.venture_id, replan: cmd.replan_count + 1, tasks: tasks.length } });
  await recordAudit({ type: 'command.replanned', ventureId: cmd.venture_id, commandId, meta: { replan: cmd.replan_count + 1, tasks: tasks.length, reason: 'task_failure' } });

  const dispatched = await dispatchReadyTasks((await getCommandRow(commandId))!);
  if (dispatched === 0) await advanceCommand(commandId, base); // todo bloqueado → cascada/cierre
  return true;
}

async function finalizeCommand(commandId: number): Promise<void> {
  const cmd = await getCommandRow(commandId);
  if (!cmd || TERMINAL_CMD.includes(cmd.status)) return; // idempotente

  const tasks = await tasksOf(commandId);
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const unfinished = tasks.filter((t) => t.status === 'failed' || t.status === 'blocked' || t.status === 'cancelled').length;
  // 0 tareas = no se planificó/ejecutó nada (plan vacío o presupuesto agotado) → failed, no completed.
  const status: HokageCommandStatus =
    tasks.length === 0 ? 'failed' : unfinished === 0 ? 'completed' : completed > 0 ? 'partial' : 'failed';

  const summary = synthesize(cmd, tasks, status);
  await run(`UPDATE hokage_commands SET status = ?, result_summary = ?, updated_at = datetime('now') WHERE id = ?`, [status, summary, commandId]);

  // Aprendizaje de negocio (Fase 4), scopeado por venture. Es DATO — no altera el sistema.
  await createMemoryEntry({
    ventureId: cmd.venture_id,
    category: status === 'completed' ? 'result' : 'learning',
    title: `Orden de Hokage: ${cmd.text.slice(0, 80)}`,
    content: summary.slice(0, 800),
    relatedEntityType: 'hokage_command',
    relatedEntityId: commandId,
  }).catch((err) => console.error('[HOKAGE] Error guardando memoria:', err.message));

  bus.publish({ type: 'hokage.command.completed', from: 'Hokage', payload: { commandId, ventureId: cmd.venture_id, status, completed, unfinished } });
  console.log(`[HOKAGE] Comando ${commandId} finalizado: ${status} (${completed} ok, ${unfinished} sin completar)`);

  // Hook aditivo F11: si este command era la investigación de una oportunidad, la hace avanzar
  // (extracción → validación → monetización → propuesta), deteniéndose en el gate humano. No-op
  // si no hay oportunidad enlazada. No altera la semántica del command.
  await onResearchCommandFinalized(commandId).catch((err) => console.error('[F11] Error avanzando oportunidad:', err.message));
}

// ── Síntesis final (DETERMINISTA — sin LLM: los datos son la fuente) ──────────
// Briefing claro: qué se pidió, qué se ejecutó, qué falló, qué requiere intervención y
// el siguiente paso. No oculta errores para aparentar éxito.
export function synthesize(cmd: HokageCommand, tasks: HokageTask[], status: HokageCommandStatus): string {
  const lines: string[] = [];
  lines.push(`Orden: ${cmd.text}`);
  lines.push(`Resultado: ${status}`);
  if (tasks.length === 0) lines.push('No se generó ninguna tarea válida a partir de la orden.');
  for (const t of tasks) {
    const tag = `[${t.status}] ${t.role} · ${t.title}`;
    if (t.status === 'completed' && t.result) lines.push(`${tag} → ${t.result.slice(0, 200)}`);
    else if (t.error) lines.push(`${tag} → ${t.error.slice(0, 200)}`);
    else lines.push(tag);
  }
  const pending = tasks.filter((t) => t.status === 'failed' || t.status === 'blocked');
  if (pending.length > 0) {
    lines.push(`Requiere intervención: ${pending.map((t) => t.title).join('; ')}`);
    lines.push('Siguiente paso: revisar las tareas no completadas y reintentar o ajustar el plan.');
  } else if (status === 'completed') {
    lines.push('Siguiente paso: sin acción pendiente.');
  }
  return lines.join('\n');
}

// ── Entrada pública: recibir una orden ────────────────────────────────────────
export interface CommandInput {
  text: string;
  ventureId?: number | null;
  idempotencyKey?: string | null;
}
export interface CommandResult {
  command: HokageCommand;
  tasks: HokageTask[];
}

// decomposeFn es inyectable SOLO para tests deterministas (evita la llamada a la IA). En
// producción se usa el decompose real. La validación determinista (validatePlan) se ejecuta
// igual sobre la salida inyectada — la seguridad no depende de quién produjo el plan.
export async function createCommand(
  input: CommandInput,
  decomposeFn: (text: string, ventureId: number | null) => Promise<RawPlan | null> = decompose
): Promise<CommandResult> {
  const text = (input.text || '').trim();
  if (!text) throw new Error('La orden no puede estar vacía.');
  const ventureId = input.ventureId ?? null;
  const idem = input.idempotencyKey?.trim() || null;

  // Aislamiento: una orden no puede apuntar a una venture que no existe.
  if (ventureId != null) {
    const v = await get<{ id: number }>('SELECT id FROM ventures WHERE id = ?', [ventureId]);
    if (!v) throw new Error(`Venture inexistente: ${ventureId}`);
  }

  // Idempotencia: misma clave, o una orden equivalente aún abierta para la misma venture.
  if (idem) {
    const byKey = await get<HokageCommand>(`${CMD_SELECT} WHERE idempotency_key = ? LIMIT 1`, [idem]);
    if (byKey) return { command: byKey, tasks: await tasksOf(byKey.id) };
  }
  const openDup = ventureId != null
    ? await get<HokageCommand>(`${CMD_SELECT} WHERE venture_id = ? AND text = ? AND status IN ('planning','active') LIMIT 1`, [ventureId, text])
    : await get<HokageCommand>(`${CMD_SELECT} WHERE venture_id IS NULL AND text = ? AND status IN ('planning','active') LIMIT 1`, [text]);
  if (openDup) return { command: openDup, tasks: await tasksOf(openDup.id) };

  const insert = await run(
    `INSERT INTO hokage_commands (venture_id, text, status, idempotency_key) VALUES (?, ?, 'planning', ?)`,
    [ventureId, text, idem]
  );
  const commandId = insert.lastID;

  // Chequeo de presupuesto ANTES de gastar en el planner (Fase 7): si la venture ya superó su
  // presupuesto REAL, no se planifica (no se gasta) — el comando cierra como fallo.
  const overBudget = await ventureOverRealBudget(ventureId);
  // Descomponer (LLM) → validar (determinista) → persistir tareas.
  const raw = overBudget ? null : await decomposeFn(text, ventureId);
  const allowed = await allowedRoleKeySet();
  const { tasks: validTasks, rejected } = validatePlan(raw, allowed);

  const planSummary = JSON.stringify({
    phases: Math.max(0, ...validTasks.map((t) => t.phase + 1), 0),
    tasks: validTasks.length,
    rejected: rejected.length,
    ...(overBudget ? { budget: 'exhausted' } : {}),
  });
  await run(`UPDATE hokage_commands SET plan_summary = ?, updated_at = datetime('now') WHERE id = ?`, [planSummary, commandId]);

  for (const vt of validTasks) {
    const ins = await run(
      `INSERT INTO hokage_tasks (command_id, phase, role, title, prompt, status, model, task_profile) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [commandId, vt.phase, vt.role, vt.title, vt.prompt, routeModelFor(vt), JSON.stringify(vt.profile)]
    );
    await recordAudit({ type: 'task.created', ventureId, commandId, taskId: ins.lastID, meta: { role: vt.role, phase: vt.phase } });
  }

  // ADR-012: generar edges implícitos (phase-based fan-in) + validar grafo + inicializar depends_on_count + persistir edges
  const allTasks = await tasksOf(commandId);
  const implicitEdges = generateImplicitEdges(allTasks);
  const validated = validateTaskGraph(allTasks, implicitEdges);

  // Actualizar depends_on_count en BD para cada tarea
  for (const task of validated.tasks) {
    const count = implicitEdges.filter((e) => e.to_task_id === task.id && e.type === 'depends_on').length;
    await run(`UPDATE hokage_tasks SET depends_on_count = ? WHERE id = ?`, [count, task.id]);
  }

  // Persistir edges
  await persistEdges(commandId, implicitEdges);

  const cmd = (await getCommandRow(commandId))!;

  if (validTasks.length === 0) {
    // No se pudo planificar → finalizar como fallo, con briefing honesto.
    await finalizeCommand(commandId);
    return { command: (await getCommandRow(commandId))!, tasks: await tasksOf(commandId) };
  }

  bus.publish({ type: 'hokage.command.created', from: 'Hokage', payload: { commandId, ventureId, tasks: validTasks.length } });

  // ADR-012: despachar tareas READY (depends_on_count === 0) en lugar de fase 0
  const n = await dispatchReadyTasks(cmd);
  if (n === 0) {
    await advanceCommand(commandId, 0);
  } else {
    await run(`UPDATE hokage_commands SET status = 'active', updated_at = datetime('now') WHERE id = ?`, [commandId]);
  }

  return { command: (await getCommandRow(commandId))!, tasks: await tasksOf(commandId) };
}

export async function getCommand(commandId: number): Promise<CommandResult | null> {
  const command = await getCommandRow(commandId);
  if (!command) return null;
  return { command, tasks: await tasksOf(commandId) };
}

export async function cancelCommand(commandId: number): Promise<CommandResult | null> {
  const cmd = await getCommandRow(commandId);
  if (!cmd) return null;
  if (TERMINAL_CMD.includes(cmd.status)) return { command: cmd, tasks: await tasksOf(commandId) };

  const openTasks = await all<{ id: number; work_item_id: number | null; agent_id: number | null }>(
    "SELECT id, work_item_id, agent_id FROM hokage_tasks WHERE command_id = ? AND status IN ('pending','dispatched')",
    [commandId]
  );
  for (const t of openTasks) {
    // Un work_item ya in_progress puede terminar de todos modos (no se puede des-llamar al
    // LLM); su resultado se ignora porque la tarea queda 'cancelled' y el hook sale temprano.
    if (t.work_item_id != null) {
      await run("UPDATE work_items SET status = 'cancelled', resolved_at = datetime('now') WHERE id = ? AND status IN ('pending','in_progress')", [t.work_item_id]);
      // ADR-011 (decisión #7): liberar el claim del agente si esta tarea lo tenía reclamado
      // (identidad = work_item.id). Idempotente: no-op si stage2 aún no lo había reclamado.
      if (t.agent_id != null) await releaseAgent(t.agent_id, t.work_item_id);
    }
    await run(`UPDATE hokage_tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [t.id]);
    await releaseTaskReservation(t.id); // devolver el presupuesto reservado de la tarea cancelada
  }
  await run(`UPDATE hokage_commands SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [commandId]);
  bus.publish({ type: 'hokage.command.completed', from: 'Hokage', payload: { commandId, ventureId: cmd.venture_id, status: 'cancelled' } });

  return { command: (await getCommandRow(commandId))!, tasks: await tasksOf(commandId) };
}
