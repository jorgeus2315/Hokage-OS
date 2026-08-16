// ═══════════════════════════════════════════════════════════════════════════════
// ADR-012 — Task Graph DAG Validation (Kahn's algorithm)
// ═══════════════════════════════════════════════════════════════════════════════
// Valida el grafo de tareas (tasks + edges) y devuelve:
// - orden topológico
// - fases (nivel topológico) para UI compat
// - detección de ciclos (throw si hay ciclo)
// - reglas semánticas: review_of requiere revisor distinto, handoff payload válido
// ═══════════════════════════════════════════════════════════════════════════════

import type { HokageTask, TaskEdge, TaskEdgeType, ValidatedTaskGraph } from '../types/index.js';

export class TaskGraphValidationError extends Error {
  constructor(message: string, public readonly cyclePath?: number[]) {
    super(message);
    this.name = 'TaskGraphValidationError';
  }
}

// Validación simple de template Handlebars-like: {{key}}
function validateHandoffPayload(payload: string): { keys: string[]; template: string } | null {
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return null;
    const keys = Array.isArray(parsed.keys) ? parsed.keys.filter((k: unknown) => typeof k === 'string') : [];
    const template = typeof parsed.template === 'string' ? parsed.template : '';
    if (keys.length === 0 || !template) return null;
    // Verificar que las keys existen en el template
    for (const k of keys) {
      if (!template.includes(`{{${k}}}`)) return null;
    }
    return { keys, template };
  } catch {
    return null;
  }
}

// Resolver template con valores reales
export function resolveHandoffTemplate(template: string, values: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

// Extraer template de un payload handoff (JSON con clave 'template').
export function extractHandoffTemplate(payload: string): string | null {
  try {
    const parsed = JSON.parse(payload);
    return typeof parsed.template === 'string' ? parsed.template : null;
  } catch {
    return null;
  }
}

// Extraer keys de un payload handoff (JSON con clave 'keys': string[]).
export function extractHandoffKeys(payload: string): string[] {
  try {
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed.keys)) {
      return parsed.keys.filter((k: unknown) => typeof k === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

export function validateTaskGraph(tasks: HokageTask[], edges: TaskEdge[]): ValidatedTaskGraph {
  // 1. Todos los task_ids existen en tasks y pertenecen al mismo command_id
  const taskIds = new Set(tasks.map((t) => t.id));
  if (taskIds.size === 0) {
    return { tasks, edges, topologicalOrder: [], phases: new Map(), hasReviewCycles: false };
  }

  const commandIds = new Set(tasks.map((t) => t.command_id));
  if (commandIds.size > 1) {
    throw new TaskGraphValidationError('Todas las tareas deben pertenecer al mismo command_id');
  }

  // 2. No auto-loops (from === to)
  for (const edge of edges) {
    if (edge.from_task_id === edge.to_task_id) {
      throw new TaskGraphValidationError(`Auto-loop detectado: tarea ${edge.from_task_id} no puede depender de sí misma`);
    }
    if (!taskIds.has(edge.from_task_id) || !taskIds.has(edge.to_task_id)) {
      throw new TaskGraphValidationError(`Arista referencia tarea inexistente: ${edge.from_task_id} -> ${edge.to_task_id}`);
    }
    if (edge.command_id !== tasks[0].command_id) {
      throw new TaskGraphValidationError(`Arista pertenece a command_id distinto: ${edge.command_id}`);
    }
  }

  // 3. No aristas duplicadas (el unique index en BD lo garantiza, pero validamos temprano)
  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.from_task_id}:${edge.to_task_id}:${edge.type}`;
    if (edgeKeys.has(key)) {
      throw new TaskGraphValidationError(`Arista duplicada: ${edge.from_task_id} -> ${edge.to_task_id} (${edge.type})`);
    }
    edgeKeys.add(key);
  }

  // 4. DAG check: Kahn's algorithm — detectar ciclos
  const adj = new Map<number, number[]>();
  const inDegree = new Map<number, number>();

  for (const task of tasks) {
    adj.set(task.id, []);
    inDegree.set(task.id, 0);
  }

  for (const edge of edges) {
    // Todas las aristas cuentan para la dependencia topológica
    adj.get(edge.from_task_id)!.push(edge.to_task_id);
    inDegree.set(edge.to_task_id, inDegree.get(edge.to_task_id)! + 1);
  }

  const queue: number[] = [];
  for (const [taskId, deg] of inDegree) {
    if (deg === 0) queue.push(taskId);
  }

  const topologicalOrder: number[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    topologicalOrder.push(u);
    for (const v of adj.get(u)!) {
      const newDeg = inDegree.get(v)! - 1;
      inDegree.set(v, newDeg);
      if (newDeg === 0) queue.push(v);
    }
  }

  if (topologicalOrder.length !== tasks.length) {
    // Hay ciclo — encontrar el camino para error explicativo
    const remaining = tasks.filter((t) => !topologicalOrder.includes(t.id)).map((t) => t.id);
    throw new TaskGraphValidationError(`Ciclo detectado en el grafo de tareas`, remaining);
  }

  // 5. Validaciones semánticas por tipo de arista
  const hasReviewCycles = edges.some((e) => e.type === 'review_of');

  for (const edge of edges) {
    const fromTask = tasks.find((t) => t.id === edge.from_task_id)!;
    const toTask = tasks.find((t) => t.id === edge.to_task_id)!;

    if (edge.type === 'review_of') {
      // from_task.role ≠ to_task.role (revisor distinto) OBLIGATORIO
      if (fromTask.role === toTask.role) {
        throw new TaskGraphValidationError(
          `review_of requiere revisor distinto: from_task.role="${fromTask.role}" === to_task.role="${toTask.role}"`
        );
      }
    }

    if (edge.type === 'handoff') {
      // payload.keys[] no vacío, template válido
      const handoff = validateHandoffPayload(edge.payload || '{}');
      if (!handoff) {
        throw new TaskGraphValidationError(
          `handoff payload inválido en edge ${edge.from_task_id}->${edge.to_task_id}: se requiere keys[] no vacío y template con {{keys}}`
        );
      }
    }
  }

  // 6. Calcular phases (nivel topológico = longest path from roots)
  const phases = new Map<number, number>();
  // Inicializar roots con phase 0
  for (const taskId of topologicalOrder) {
    if (inDegree.get(taskId) === 0) {
      phases.set(taskId, 0);
    }
  }

  // Para cada nodo en orden topológico, propagar phase a sucesores
  for (const u of topologicalOrder) {
    const uPhase = phases.get(u) ?? 0;
    for (const v of adj.get(u)!) {
      const currentVPhase = phases.get(v) ?? 0;
      phases.set(v, Math.max(currentVPhase, uPhase + 1));
    }
  }

  // 7. Calcular depends_on_count por tarea (entrantes type='depends_on')
  // Se devuelve como parte de HokageTask actualizado — el caller actualiza la BD

  return { tasks, edges, topologicalOrder, phases, hasReviewCycles };
}

// Helper para generar edges implícitos desde plan legacy (solo phase)
export function generateImplicitEdges(tasks: HokageTask[]): TaskEdge[] {
  const edges: TaskEdge[] = [];
  const byPhase = new Map<number, HokageTask[]>();

  for (const task of tasks) {
    if (!byPhase.has(task.phase)) byPhase.set(task.phase, []);
    byPhase.get(task.phase)!.push(task);
  }

  const phases = Array.from(byPhase.keys()).sort((a, b) => a - b);
  for (let i = 1; i < phases.length; i++) {
    const prevPhase = byPhase.get(phases[i - 1])!;
    const currPhase = byPhase.get(phases[i])!;
    // Cada tarea de la fase actual depende de TODAS las de la fase anterior (fan-in completo)
    for (const from of prevPhase) {
      for (const to of currPhase) {
        edges.push({
          id: 0, // será asignado por BD
          command_id: from.command_id,
          from_task_id: from.id,
          to_task_id: to.id,
          type: 'depends_on',
          payload: '{}',
          created_at: new Date().toISOString(),
        });
      }
    }
  }
  return edges;
}