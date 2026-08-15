import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run, get } from '../db/init.js';
import { createCommand, type RawPlanForTest } from './hokageOrchestrator.js';

// ═══ Tests de K.5 — integración: la cadena de Hokage enruta el modelo por tarea. ═══
// El ModelRouter corre en el dispatch (cadena de orquestación), fija el modelo en el work_item;
// el runtime lo ejecutaría con él. Se verifica sin llamar a la IA (decomposeFn inyectado).

const plan = (phases: RawPlanForTest['phases']) => async (): Promise<RawPlanForTest> => ({ phases });

before(async () => { await initSchema(); });

test('K.5 #10/#13 distintas tareas → distintos modelos; venture threaded; Hermes NO aparece', async () => {
  const v = await run(`INSERT INTO ventures (name, type, status, goal, revenue_target_usd) VALUES ('V-K5','store','active','m',500)`);
  const { tasks } = await createCommand(
    { text: 'evalúa oportunidad', ventureId: v.lastID },
    plan([{ tasks: [
      { role: 'investigador', title: 'A', task: 'clasifica esto',
        profile: { kind: 'classify', complexity: 'low', importance: 'low', needs: {}, risk: 'low' } },
      { role: 'finanzas', title: 'B', task: 'define la estrategia',
        profile: { kind: 'strategy', complexity: 'high', importance: 'high', needs: { reasoning: true }, risk: 'low' } },
    ] }]),
  );
  assert.equal(tasks.length, 2);

  const wiA = await get<{ model: string | null; venture_id: number; agent_id: number }>('SELECT model, venture_id, agent_id FROM work_items WHERE id = ?', [tasks[0].work_item_id]);
  const wiB = await get<{ model: string | null; venture_id: number; agent_id: number }>('SELECT model, venture_id, agent_id FROM work_items WHERE id = ?', [tasks[1].work_item_id]);

  assert.ok(wiA!.model, 'work_item A lleva el modelo enrutado');
  assert.ok(wiB!.model, 'work_item B lleva el modelo enrutado');
  assert.notEqual(wiA!.model, wiB!.model, 'distintas tareas → distintos modelos (un mismo ecosistema)');
  assert.equal(wiA!.venture_id, v.lastID);
  assert.equal(wiB!.venture_id, v.lastID);

  // Hermes (kernel) nunca es objetivo del orquestador — K.5 no lo convierte en agente de negocio.
  const hermes = await get<{ id: number }>(`SELECT id FROM agents WHERE role = 'hermes'`);
  assert.notEqual(wiA!.agent_id, hermes!.id);
  assert.notEqual(wiB!.agent_id, hermes!.id);
});

test('K.5 #11 plan SIN profile → sigue funcionando (perfil por defecto, no rompe)', async () => {
  const v = await run(`INSERT INTO ventures (name, type, status, goal, revenue_target_usd) VALUES ('V-K5b','store','active','m',500)`);
  const { tasks } = await createCommand(
    { text: 'investiga', ventureId: v.lastID },
    plan([{ tasks: [{ role: 'investigador', title: 'A', task: 'sin profile declarado' }] }]),
  );
  assert.equal(tasks.length, 1);
  const wi = await get<{ model: string | null }>('SELECT model FROM work_items WHERE id = ?', [tasks[0].work_item_id]);
  assert.ok(wi!.model, 'perfil por defecto → modelo válido, sin romper el flujo');
});
