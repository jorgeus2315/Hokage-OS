import { Router } from 'express';
import { sendError } from '../middleware/errorHandler.js';
import { all, get, run } from '../db/init.js';

const router = Router();

router.get('/agent-runs', async (req, res) => {
  try {
    const agentId = req.query.agent_id ? Number(req.query.agent_id) : undefined;
    const runs = agentId
      ? await all('SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC', [agentId])
      : await all('SELECT * FROM agent_runs ORDER BY started_at DESC');
    res.json({ ok: true, data: runs });
  } catch (e: any) { sendError(res, 500, e, 'No se pudieron obtener los runs'); }
});

router.get('/agent-memory/:agentId', async (req, res) => {
  try {
    const agentId = Number(req.params.agentId);
    const memory = await all('SELECT * FROM agent_memory WHERE agent_id = ? ORDER BY updated_at DESC', [agentId]);
    res.json({ ok: true, data: memory });
  } catch (e: any) { sendError(res, 500, e, 'No se pudo obtener la memoria'); }
});

router.get('/agent-prompts/:agentId', async (req, res) => {
  try {
    const agentId = Number(req.params.agentId);
    const prompts = await all('SELECT * FROM agent_prompts WHERE agent_id = ? ORDER BY created_at DESC', [agentId]);
    res.json({ ok: true, data: prompts });
  } catch (e: any) { sendError(res, 500, e, 'No se pudieron obtener los prompts'); }
});

router.post('/agent-feedback', async (req, res) => {
  try {
    const { agent_id, decision_id, feedback_type, comment } = req.body || {};
    if (!agent_id || !feedback_type) {
      return res.status(400).json({ ok: false, error: 'agent_id y feedback_type son requeridos' });
    }
    const result = await run(
      'INSERT INTO agent_feedback (agent_id, decision_id, feedback_type, comment) VALUES (?, ?, ?, ?)',
      [agent_id, decision_id || null, feedback_type, comment || '']
    );
    const feedback = await get('SELECT * FROM agent_feedback WHERE id = ?', [result.lastID]);
    res.status(201).json({ ok: true, data: feedback });
  } catch (e: any) { sendError(res, 500, e, 'No se pudo guardar el feedback'); }
});

router.get('/tools', async (_req, res) => {
  try {
    const tools = await all('SELECT * FROM tools ORDER BY name');
    res.json({ ok: true, data: tools });
  } catch (e: any) { sendError(res, 500, e, 'No se pudieron obtener las herramientas'); }
});

router.get('/progress', async (_req, res) => {
  try {
    const progress = await all('SELECT * FROM agent_progress ORDER BY updated_at DESC');
    res.json({ ok: true, data: progress });
  } catch (e: any) { sendError(res, 500, e, 'No se pudo obtener el progreso'); }
});

router.get('/achievements', async (_req, res) => {
  try {
    const achievements = await all('SELECT * FROM achievements ORDER BY created_at DESC');
    res.json({ ok: true, data: achievements });
  } catch (e: any) { sendError(res, 500, e, 'No se pudieron obtener los logros'); }
});

export default router;
