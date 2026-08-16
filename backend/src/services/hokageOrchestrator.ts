import { run, get, all } from '../db/init.js';
import type { HokageCommand, HokageTask, HokageCommandStatus, RoleDefinition, TaskEdge, TaskEdgeType } from '../types/index.js';
import { getRoleDefinition, listRoleDefinitions, modelFor } from './roleService.js';
import { createAgent } from './agentService.js';
import { selectAgent, claimAgent, releaseAgent } from './agentSelector.js'; // ADR-011: claim/release atómico del agente
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
// ADR-011: usa selectAgent (capability matching) + claimAgent (atómico) cuando hay taskId.
async function selectOrCreateSpecialist(role: string, ventureId: number | null, commandId?: number, taskId?: number): Promise<number> {
  // Si hay taskId, intentar selección por capability + claim atómico (ADR-011)
  if (taskId != null) {
    const def = await getRoleDefinition(role);
    const baseCaps = def ? JSON.parse(def.capabilities) : [];
    const result = await selectAgent({
      ventureId,
      requiredCapabilities: baseCaps as any,
      agentTypes: ['permanent'],
      maxResults: 1,
    });
    if (result.length > 0) {
      const agentId = result[0].agentId;
      const claimed = await claimAgent(agentId, taskId, 30); // 30 min TTL
      if (claimed) {
        await recordAudit({ type: 'agent.claimed', ventureId, commandId, taskId, agentId, meta: { role } });
        return agentId;
      }
      // Si no se pudo claimar (carrera), seguir con fallback legacy
    }
  }

  // Fallback legacy: preferir agente scoped/venture, luego global, luego crear
  let agentId: number | null = null;
  if (ventureId != null) {
    const scoped = await get<{ id: number }>('SELECT id FROM agents WHERE role = ? AND venture_id = ? LIMIT 1', [role, ventureId]);
    if (scoped) agentId = scoped.id;
  }
  if (agentId == null) {
    const global = await get<{ id: number }>('SELECT id FROM agents WHERE role = ? AND venture_id IS NULL LIMIT 1', [role]);
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
async function dispatchReadyTasks(cmd: HokageCommand, specificIds?: number[]): Promise<number> {
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

// ── Avance del DAG: se llama cuando una tarea termina (hook desde stage3) ──────
// El agentRuntime procesa work_items secuencialmente dentro de un tick, así que estas
// transiciones no se solapan → no hacen falta locks.
export async function onHokageTaskCompleted(workItemId: number, ok: boolean, resultText: string): Promise<void> {
  const task = await get<HokageTask>(`${TASK_SELECT} WHERE work_item_id = ?`, [workItemId]);
  if (!task || task.status !== 'dispatched') return; // no es nuestra, o ya resuelta/cancelada (idempotente)

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
      `INSERT INTO hokage_tasks (command_id, phase, role, title, prompt, status, model) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [commandId, base + vt.phase, vt.role, vt.title, vt.prompt, routeModelFor(vt)]
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
      `INSERT INTO hokage_tasks (command_id, phase, role, title, prompt, status, model) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [commandId, vt.phase, vt.role, vt.title, vt.prompt, routeModelFor(vt)]
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

  const openTasks = await all<{ id: number; work_item_id: number | null }>(
    "SELECT id, work_item_id FROM hokage_tasks WHERE command_id = ? AND status IN ('pending','dispatched')",
    [commandId]
  );
  for (const t of openTasks) {
    // Un work_item ya in_progress puede terminar de todos modos (no se puede des-llamar al
    // LLM); su resultado se ignora porque la tarea queda 'cancelled' y el hook sale temprano.
    if (t.work_item_id != null) {
      await run("UPDATE work_items SET status = 'cancelled', resolved_at = datetime('now') WHERE id = ? AND status IN ('pending','in_progress')", [t.work_item_id]);
    }
    await run(`UPDATE hokage_tasks SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [t.id]);
    await releaseTaskReservation(t.id); // devolver el presupuesto reservado de la tarea cancelada
  }
  await run(`UPDATE hokage_commands SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [commandId]);
  bus.publish({ type: 'hokage.command.completed', from: 'Hokage', payload: { commandId, ventureId: cmd.venture_id, status: 'cancelled' } });

  return { command: (await getCommandRow(commandId))!, tasks: await tasksOf(commandId) };
}
