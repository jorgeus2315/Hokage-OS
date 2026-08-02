import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import { sendError, structuredErrorHandler } from './middleware/errorHandler.js';

const REQUIRED_ENV = ['OPENROUTER_API_KEY', 'ADMIN_TOKEN'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[SERVER] Faltan variables de entorno requeridas: ${missing.join(', ')}`);
  process.exit(1);
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const TRUSTED_ORIGINS = new Set([FRONTEND_URL, 'http://localhost:5173']);

function isTrustedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return TRUSTED_ORIGINS.has(origin);
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const token = req.headers['authorization']?.toString().replace('Bearer ', '') || req.headers['x-admin-token']?.toString();
  if (!token || token !== ADMIN_TOKEN) {
    res.status(401).json({ ok: false, error: 'Token inválido o faltante' });
    return;
  }
  next();
}

import { rateLimit } from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

import { run, get, all, initSchema } from './db/init.js';
import type { Department, DepartmentUpdatePayload } from './types/index.js';
import { listAgents, createAgent } from './services/agentService.js';
import { createBusiness, listBusinesses } from './services/businessService.js';
import { approveDecision, rejectDecision, createDecision, listDecisions } from './services/decisionService.js';
import { createMessage, listMessages } from './services/messageService.js';
import { askAgent } from './services/aiService.js';
import progressRouter from './routes/progress.js';
import { runtime } from './config/agentRuntime.js';
import bus from './config/eventBus.js';

const app = express();
const httpServer = createServer(app);
httpServer.headersTimeout = 5000;
httpServer.requestTimeout = 10000;
httpServer.keepAliveTimeout = 5000;

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  message: { ok: false, error: 'Demasiadas peticiones. Intenta de nuevo en un momento.' },
});

const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Límite de consultas IA alcanzado. Espera un momento.' },
});

const runtimeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Límite de ejecución alcanzado. Espera un momento.' },
});

app.use('/api', generalLimiter);
app.use('/api/agents', generalLimiter);
app.use('/api/agents/:id/ask', askLimiter);
app.use('/api/runtime', runtimeLimiter);

// WebSocket para actualizaciones en tiempo real
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set<WebSocket>();

wss.on('connection', (ws, req) => {
  const token = new URL(req.url || '', 'http://localhost').searchParams.get('token') || '';
  if (!token || token !== ADMIN_TOKEN) {
    ws.close(1008, 'Token inválido o faltante');
    return;
  }

  clients.add(ws);
  console.log(`[WS] Cliente conectado. Total: ${clients.size}`);
  ws.send(JSON.stringify({ type: 'connected', data: { message: 'HOKAGE OS conectado' } }));
  ws.on('close', () => { clients.delete(ws); });
});

// Broadcast a todos los clientes WebSocket
function broadcast(type: string, data: unknown): void {
  const msg = JSON.stringify({ type, data, timestamp: new Date() });
  setImmediate(() => {
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  });
}

// Reenviar eventos del bus por WebSocket
bus.subscribe('*', (event) => {
  broadcast('agent.event', event);
});

app.use(cors({
  origin: (origin, callback) => {
    callback(null, !origin || isTrustedOrigin(origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

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
  } catch (e: any) { sendError(res, 500, e, 'Error listando agentes'); }
});

app.post('/api/agents', requireAdmin, async (req, res) => {
  try {
    const agent = await createAgent(req.body);
    res.status(201).json({ ok: true, data: agent });
  } catch (e: any) { sendError(res, 400, e, 'Error creando agente'); }
});

app.post('/api/agents/:id/ask', requireAdmin, async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const { message } = req.body;
    if (!message) return res.status(400).json({ ok: false, error: 'Falta message' });
    const result = await askAgent(agentId, String(message));
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error || 'Error en askAgent' });
    }
    res.json({ ok: true, data: { response: result.data?.response || '', tokens: result.data?.tokens ?? 0 } });
  } catch (e: any) { sendError(res, 500, e, 'Error en askAgent'); }
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
  } catch (e: any) { sendError(res, 500, e, 'Error ejecutando agente'); }
});

// ═══════════ NEGOCIOS ═══════════
app.get('/api/businesses', async (_req, res) => {
  try {
    const businesses = await listBusinesses();
    res.json({ ok: true, data: businesses });
  } catch (e: any) { sendError(res, 500, e, 'Error listando negocios'); }
});

app.post('/api/businesses', requireAdmin, async (req, res) => {
  try {
    const business = await createBusiness(req.body);
    res.status(201).json({ ok: true, data: business });
  } catch (e: any) { sendError(res, 400, e, 'Error creando negocio'); }
});

// ═══════════ DECISIONES ═══════════
app.get('/api/decisions', async (_req, res) => {
  try {
    const decisions = await listDecisions();
    res.json({ ok: true, data: decisions });
  } catch (e: any) { sendError(res, 500, e, 'Error listando decisiones'); }
});

app.post('/api/decisions', requireAdmin, async (req, res) => {
  try {
    const decision = await createDecision(req.body);
    broadcast('decision.new', decision);
    res.status(201).json({ ok: true, data: decision });
  } catch (e: any) { sendError(res, 400, e, 'Error creando decision'); }
});

app.put('/api/decisions/:id/approve', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await approveDecision(id, 'Jorge');
    bus.publish({ type: 'decision.approved', from: 'Jorge', payload: { decisionId: id } });
    broadcast('decision.approved', { id });
    res.json({ ok: true });
  } catch (e: any) { sendError(res, 400, e, 'Error aprobando decision'); }
});

app.put('/api/decisions/:id/reject', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await rejectDecision(id, 'Jorge');
    bus.publish({ type: 'decision.rejected', from: 'Jorge', payload: { decisionId: id } });
    broadcast('decision.rejected', { id });
    res.json({ ok: true });
  } catch (e: any) { sendError(res, 400, e, 'Error rechazando decision'); }
});

// ═══════════ MENSAJES ═══════════
app.get('/api/messages', async (_req, res) => {
  try {
    const messages = await listMessages();
    res.json({ ok: true, data: messages });
  } catch (e: any) { sendError(res, 500, e, 'Error listando mensajes'); }
});

app.post('/api/messages', requireAdmin, async (req, res) => {
  try {
    const message = await createMessage(req.body);
    broadcast('message.new', message);
    res.status(201).json({ ok: true, data: message });
  } catch (e: any) { sendError(res, 400, e, 'Error creando mensaje'); }
});

// ═══════════ RUNTIME ═══════════
app.get('/api/runtime/status', (_req, res) => {
  res.json({ ok: true, data: runtime.getStatus() });
});

app.post('/api/runtime/start', requireAdmin, (_req, res) => {
  runtime.start();
  res.json({ ok: true, data: { running: true } });
});

app.post('/api/runtime/stop', requireAdmin, (_req, res) => {
  runtime.stop();
  res.json({ ok: true, data: { running: false } });
});

// ═══════════ DEPARTAMENTOS ═══════════
app.get('/api/departments', async (_req, res) => {
  try {
    const depts = await all<Department>('SELECT * FROM departments WHERE active = 1 ORDER BY sort_order ASC');
    res.json({ ok: true, data: depts });
  } catch (e: any) { sendError(res, 500, e, 'Error listando departamentos'); }
});

app.post('/api/departments', requireAdmin, async (req, res) => {
  try {
    const { key, name, desc = '', role, glyph = 'default', color = '#4fd1c5', pos_x = 1000, pos_y = 1000, is_hub = 0, sort_order = 0 } = req.body;
    if (!key || !name || !role) return res.status(400).json({ ok: false, error: 'Faltan campos obligatorios: key, name, role' });
    const existing = await get<Department>('SELECT id FROM departments WHERE key = ?', [key]);
    if (existing) return res.status(409).json({ ok: false, error: `Ya existe un departamento con key "${key}"` });
    const result = await run(
      `INSERT INTO departments (key,name,desc,role,glyph,color,pos_x,pos_y,is_hub,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [key, name, desc, role, glyph, color, pos_x, pos_y, is_hub, sort_order]
    );
    const dept = await get<Department>('SELECT * FROM departments WHERE id = ?', [result.lastID]);
    res.status(201).json({ ok: true, data: dept });
  } catch (e: any) { sendError(res, 400, e, 'Error creando departamento'); }
});

app.put('/api/departments/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const payload = req.body as DepartmentUpdatePayload;
    const allowed: (keyof DepartmentUpdatePayload)[] = ['name', 'desc', 'color', 'pos_x', 'pos_y', 'active'];
    const sets = allowed.filter((k) => payload[k] !== undefined).map((k) => `${k} = ?`);
    const vals = allowed.filter((k) => payload[k] !== undefined).map((k) => payload[k]);
    if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Sin campos a actualizar' });
    await run(`UPDATE departments SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    const dept = await get<Department>('SELECT * FROM departments WHERE id = ?', [id]);
    res.json({ ok: true, data: dept });
  } catch (e: any) { sendError(res, 400, e, 'Error actualizando departamento'); }
});
app.get('/api/events', requireAdmin, (_req, res) => {
  res.json({ ok: true, data: bus.getHistory(50) });
});

// ═══════════ PROGRESS / ACHIEVEMENTS ═══════════
app.use('/api', progressRouter);

// ═══════════ ARRANQUE ═══════════
// ═══════════ ARRANQUE ═══════════
const PORT = Number(process.env.PORT) || 3000;
console.time('[BOOT] initSchema');
initSchema().then(() => {
  console.timeEnd('[BOOT] initSchema');
  console.time('[BOOT] listen');
  httpServer.listen(PORT, () => {
    console.timeEnd('[BOOT] listen');
    console.log(`[SERVER] HOKAGE OS backend corriendo en http://localhost:${PORT}`);
    console.log(`[SERVER] WebSocket activo en ws://localhost:${PORT}`);
    console.time('[BOOT] runtime.start');
    setImmediate(() => runtime.start());
    console.timeEnd('[BOOT] runtime.start');
  });
}).catch((error) => {
  console.error('[SERVER] Error iniciando:', error);
  process.exit(1);
});

// ═══════════ ERROR HANDLER ═══════════
app.use(structuredErrorHandler);

export default app;
