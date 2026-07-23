import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

import { initSchema } from './db/init.js';
import { listAgents, createAgent } from './services/agentService.js';
import { createBusiness, listBusinesses } from './services/businessService.js';
import { approveDecision, rejectDecision, createDecision, listDecisions } from './agents/DecisionHandler.js';
import { createMessage, listMessages } from './agents/MessageHandler.js';
import { askAgent } from './services/aiService.js';
import progressRouter from './routes/progress.js';
import { runtime } from './config/agentRuntime.js';
import bus from './config/eventBus.js';

const app = express();
const httpServer = createServer(app);

// WebSocket para actualizaciones en tiempo real
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Cliente conectado. Total: ${clients.size}`);
  ws.send(JSON.stringify({ type: 'connected', data: { message: 'HOKAGE OS conectado' } }));
  ws.on('close', () => { clients.delete(ws); });
});

// Broadcast a todos los clientes WebSocket
function broadcast(type: string, data: unknown): void {
  const msg = JSON.stringify({ type, data, timestamp: new Date() });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// Reenviar eventos del bus por WebSocket
bus.subscribe('*', (event) => {
  broadcast('agent.event', event);
});

app.use(cors());
app.use(express.json());

// ═══════════ HEALTH ═══════════
app.get('/api/health', (_req, res) => res.json({
  ok: true,
  status: 'ok',
  runtime: runtime.isRunning(),
  websocket: clients.size,
}));

// ═══════════ AGENTES ═══════════
app.get('/api/agents', async (_req, res) => {
  try {
    const agents = await listAgents();
    res.json({ ok: true, data: agents });
  } catch { res.status(500).json({ ok: false, error: 'Error listando agentes' }); }
});

app.post('/api/agents', async (req, res) => {
  try {
    const agent = await createAgent(req.body);
    res.status(201).json({ ok: true, data: agent });
  } catch { res.status(400).json({ ok: false, error: 'Error creando agente' }); }
});

app.post('/api/agents/:id/ask', async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const { message } = req.body;
    if (!message) return res.status(400).json({ ok: false, error: 'Falta message' });
    const result = await askAgent(agentId, String(message));
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error || 'Error en askAgent' });
    }
    res.json({ ok: true, data: { response: result.data?.response || '', tokens: result.data?.tokens ?? 0 } });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// Ejecutar agente de forma autonoma (manual trigger)
app.post('/api/agents/:id/run', async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const agents = await listAgents();
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return res.status(404).json({ ok: false, error: 'Agente no encontrado' });
    const result = await runtime.runAgent({
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      taskType: 'manual',
      context: req.body.task,
    });
    res.json({ ok: result.ok, data: result });
  } catch (e: any) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════ NEGOCIOS ═══════════
app.get('/api/businesses', async (_req, res) => {
  try {
    const businesses = await listBusinesses();
    res.json({ ok: true, data: businesses });
  } catch { res.status(500).json({ ok: false, error: 'Error listando negocios' }); }
});

app.post('/api/businesses', async (req, res) => {
  try {
    const business = await createBusiness(req.body);
    res.status(201).json({ ok: true, data: business });
  } catch { res.status(400).json({ ok: false, error: 'Error creando negocio' }); }
});

// ═══════════ DECISIONES ═══════════
app.get('/api/decisions', async (_req, res) => {
  try {
    const decisions = await listDecisions();
    res.json({ ok: true, data: decisions });
  } catch { res.status(500).json({ ok: false, error: 'Error listando decisiones' }); }
});

app.post('/api/decisions', async (req, res) => {
  try {
    const decision = await createDecision(req.body);
    broadcast('decision.new', decision);
    res.status(201).json({ ok: true, data: decision });
  } catch { res.status(400).json({ ok: false, error: 'Error creando decision' }); }
});

app.put('/api/decisions/:id/approve', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await approveDecision(id, 'Jorge');
    bus.publish({ type: 'decision.approved', from: 'Jorge', payload: { decisionId: id } });
    broadcast('decision.approved', { id });
    res.json({ ok: true });
  } catch { res.status(400).json({ ok: false, error: 'Error aprobando decision' }); }
});

app.put('/api/decisions/:id/reject', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await rejectDecision(id, 'Jorge');
    bus.publish({ type: 'decision.rejected', from: 'Jorge', payload: { decisionId: id } });
    broadcast('decision.rejected', { id });
    res.json({ ok: true });
  } catch { res.status(400).json({ ok: false, error: 'Error rechazando decision' }); }
});

// ═══════════ MENSAJES ═══════════
app.get('/api/messages', async (_req, res) => {
  try {
    const messages = await listMessages();
    res.json({ ok: true, data: messages });
  } catch { res.status(500).json({ ok: false, error: 'Error listando mensajes' }); }
});

app.post('/api/messages', async (req, res) => {
  try {
    const message = await createMessage(req.body);
    broadcast('message.new', message);
    res.status(201).json({ ok: true, data: message });
  } catch { res.status(400).json({ ok: false, error: 'Error creando mensaje' }); }
});

// ═══════════ RUNTIME ═══════════
app.get('/api/runtime/status', (_req, res) => {
  res.json({ ok: true, data: runtime.getStatus() });
});

app.post('/api/runtime/start', (_req, res) => {
  runtime.start();
  res.json({ ok: true, data: { running: true } });
});

app.post('/api/runtime/stop', (_req, res) => {
  runtime.stop();
  res.json({ ok: true, data: { running: false } });
});

// ═══════════ EVENTOS DEL BUS ═══════════
app.get('/api/events', (_req, res) => {
  res.json({ ok: true, data: bus.getHistory(50) });
});

// ═══════════ PROGRESS / ACHIEVEMENTS ═══════════
app.use('/api', progressRouter);

// ═══════════ ARRANQUE ═══════════
const PORT = Number(process.env.PORT) || 3000;

initSchema().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`[SERVER] HOKAGE OS backend corriendo en http://localhost:${PORT}`);
    console.log(`[SERVER] WebSocket activo en ws://localhost:${PORT}`);
    // Iniciar runtime de agentes
    runtime.start();
  });
}).catch((error) => {
  console.error('[SERVER] Error iniciando:', error);
  process.exit(1);
});

export default app;
