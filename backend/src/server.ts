import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initSchema } from './db/init.js';
import { listAgents, createAgent } from './services/agentService.js';
import { createBusiness } from './services/businessService.js';
import { approveDecision, rejectDecision, createDecision } from './agents/DecisionHandler.js';
import { createMessage } from './agents/MessageHandler.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, status: 'ok' }));

app.get('/api/agents', async (_req, res) => {
  try {
    const agents = await listAgents();
    res.json({ ok: true, data: agents });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'No se pudieron obtener los agentes' });
  }
});

app.post('/api/agents', async (req, res) => {
  try {
    const agent = await createAgent(req.body);
    res.status(201).json({ ok: true, data: agent });
  } catch (error) {
    console.error(error);
    res.status(400).json({ ok: false, error: 'No se pudo crear el agente' });
  }
});app.get('/api/businesses', async (_req, res) => res.json({ ok: true, data: [] }));
app.get('/api/products', async (_req, res) => res.json({ ok: true, data: [] }));
app.get('/api/decisions', async (_req, res) => res.json({ ok: true, data: [] }));
app.get('/api/messages', async (_req, res) => res.json({ ok: true, data: [] }));
app.get('/api/content', async (_req, res) => res.json({ ok: true, data: [] }));
app.get('/api/market', async (_req, res) => res.json({ ok: true, data: [] }));
app.get('/api/finance', async (_req, res) => res.json({ ok: true, data: [] }));
app.get('/api/audit', async (_req, res) => res.json({ ok: true, data: [] }));

app.post('/api/businesses', async (req, res) => {
  try {
    const business = await createBusiness(req.body);
    res.status(201).json({ ok: true, data: business });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'No se pudo crear el negocio' });
  }
});

app.post('/api/decisions', async (req, res) => {
  try {
    const decision = await createDecision(req.body);
    res.status(201).json({ ok: true, data: decision });
  } catch (error) {
    console.error(error);
    res.status(400).json({ ok: false, error: 'No se pudo crear la decisión' });
  }
});

app.post('/api/messages', async (req, res) => {
  const { sender_id, receiver_id, content } = req.body || {};
  if (!content || !sender_id) {
    return res.status(400).json({ ok: false, error: 'sender_id y content son requeridos' });
  }
  try {
    const message = await createMessage({ sender_id, receiver_id, content });
    res.status(201).json({ ok: true, data: message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'No se pudo crear el mensaje' });
  }
});

app.put('/api/decisions/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    const decision = await approveDecision(Number(id), 'Jorge');
    res.json({ ok: true, data: decision });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'No se pudo aprobar la decisión' });
  }
});

app.put('/api/decisions/:id/reject', async (req, res) => {
  const { id } = req.params;
  try {
    const decision = await rejectDecision(Number(id), 'Jorge');
    res.json({ ok: true, data: decision });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 'No se pudo rechazar la decisión' });
  }
});

const PORT = Number(process.env.PORT || 3000);

if (!((globalThis as any).__HOKAGE_SERVER_STARTED__)) {
  (globalThis as any).__HOKAGE_SERVER_STARTED__ = true;
  app.listen(PORT, async () => {
    await initSchema();
    console.log(`[SERVER] HOKAGE OS backend corriendo en http://localhost:${PORT}`);
  });
}

export default app;
