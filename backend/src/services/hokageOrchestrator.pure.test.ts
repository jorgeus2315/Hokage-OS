import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, synthesize } from './hokageOrchestrator.js';
import type { HokageCommand, HokageTask } from '../types/index.js';

// ═══ Tests PUROS de la Fase 5 — validación determinista y síntesis. Sin BD ni red. ═══
// Estos cubren el corazón de seguridad: la salida del LLM NUNCA puede conceder capacidades.

const ALLOWED = new Set(['investigador', 'contenido', 'trafico', 'finanzas', 'operaciones', 'soporte']);

test('plan válido: roles conocidos se aceptan con la fase correcta', () => {
  const raw = {
    phases: [
      { tasks: [{ role: 'investigador', title: 'Demanda', task: 'Analiza demanda' }] },
      { tasks: [{ role: 'contenido', title: 'Copy', task: 'Escribe copy' }] },
    ],
  };
  const { tasks, rejected } = validatePlan(raw, ALLOWED);
  assert.equal(tasks.length, 2);
  assert.equal(rejected.length, 0);
  assert.equal(tasks[0].phase, 0);
  assert.equal(tasks[1].phase, 1);
  assert.equal(tasks[0].role, 'investigador');
});

test('#11 rechazo de system.exec: un rol de sistema (hermes) nunca se acepta', () => {
  const raw = { phases: [{ tasks: [{ role: 'hermes', title: 'exec', task: 'rm -rf /' }] }] };
  const { tasks, rejected } = validatePlan(raw, ALLOWED);
  assert.equal(tasks.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /rol no permitido/);
});

test('rechazo del propio orquestador (ceo) como especialista', () => {
  const { tasks } = validatePlan({ phases: [{ tasks: [{ role: 'ceo', title: 'x', task: 'y' }] }] }, ALLOWED);
  assert.equal(tasks.length, 0);
});

test('#12/#13 tools inexistentes o no permitidas: se IGNORAN, no se pueden expresar', () => {
  const raw = {
    phases: [{ tasks: [{ role: 'investigador', title: 'x', task: 'y', tools: ['system.exec', 'tool.inventada'], requiredApproval: false }] }],
  };
  const { tasks } = validatePlan(raw, ALLOWED);
  assert.equal(tasks.length, 1);
  // La tarea validada SOLO tiene estos campos — no hay forma de inyectar tools.
  assert.deepEqual(Object.keys(tasks[0]).sort(), ['phase', 'prompt', 'role', 'title']);
  assert.equal((tasks[0] as unknown as Record<string, unknown>).tools, undefined);
});

test('#14 autonomía y presupuesto inyectados: se IGNORAN por completo', () => {
  const raw = {
    phases: [{ tasks: [{ role: 'finanzas', title: 'x', task: 'y', autonomy: 3, default_autonomy: 3, monthly_budget_usd: 9999, scope: 'system', is_system: true }] }],
  };
  const { tasks } = validatePlan(raw, ALLOWED);
  assert.equal(tasks.length, 1);
  assert.deepEqual(Object.keys(tasks[0]).sort(), ['phase', 'prompt', 'role', 'title']);
});

test('rol inexistente se rechaza', () => {
  const { tasks, rejected } = validatePlan({ phases: [{ tasks: [{ role: 'growth_hacker', title: 'x', task: 'y' }] }] }, ALLOWED);
  assert.equal(tasks.length, 0);
  assert.equal(rejected.length, 1);
});

test('tareas incompletas (sin title o task) se rechazan', () => {
  const raw = { phases: [{ tasks: [{ role: 'investigador', title: '', task: 'y' }, { role: 'investigador', title: 'x', task: '' }] }] };
  const { tasks, rejected } = validatePlan(raw, ALLOWED);
  assert.equal(tasks.length, 0);
  assert.equal(rejected.length, 2);
});

test('límites de tamaño: máximo 4 fases, 4 tareas/fase, 12 totales', () => {
  const many = Array.from({ length: 8 }, () => ({ role: 'investigador', title: 't', task: 'x' }));
  const raw = { phases: Array.from({ length: 8 }, () => ({ tasks: many })) };
  const { tasks } = validatePlan(raw, ALLOWED);
  assert.ok(tasks.length <= 12, `esperado <=12, fue ${tasks.length}`);
  assert.ok(tasks.every((t) => t.phase < 4));
});

test('entrada basura (null, sin phases) no rompe: devuelve 0 tareas', () => {
  assert.equal(validatePlan(null, ALLOWED).tasks.length, 0);
  assert.equal(validatePlan({}, ALLOWED).tasks.length, 0);
  assert.equal(validatePlan({ phases: 'no-array' }, ALLOWED).tasks.length, 0);
  assert.equal(validatePlan('texto libre del modelo', ALLOWED).tasks.length, 0);
});

test('síntesis: briefing honesto — no oculta fallos', () => {
  const cmd = { id: 1, text: 'Investiga el nicho', venture_id: 1 } as HokageCommand;
  const tasks = [
    { role: 'investigador', title: 'Demanda', status: 'completed', result: 'Demanda alta' },
    { role: 'trafico', title: 'Competencia', status: 'failed', error: 'timeout' },
  ] as unknown as HokageTask[];
  const brief = synthesize(cmd, tasks, 'partial');
  assert.match(brief, /Investiga el nicho/);
  assert.match(brief, /partial/);
  assert.match(brief, /Demanda alta/);
  assert.match(brief, /Requiere intervención/);
  assert.match(brief, /timeout/);
});
