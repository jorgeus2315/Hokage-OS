import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import { sendError, structuredErrorHandler } from './middleware/errorHandler.js';
import { OWNER_NAME } from './config/env.js';
import { constantTimeEqual } from './config/security.js';
import {
  evaluateAuth, regenerateSession, destroySession, validateSession, parseCookies,
  serializeSessionCookie, clearSessionCookie, originAllowed, SESSION_COOKIE,
} from './config/session.js';

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

// Autoridad backend de operador único (F10). Acepta DOS credenciales, comparadas en tiempo
// constante: (a) sesión de navegador vía cookie HttpOnly (el frontend ya no lleva el token), o
// (b) cabecera x-admin-token para clientes máquina/CLI. Las mutaciones por sesión exigen Origin
// de confianza (CSRF); el camino por token no es CSRF-able (cabecera custom). El backend sigue
// ligado a 127.0.0.1 y expuesto solo tras nginx/túnel (D1, F6).
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const decision = evaluateAuth(
    {
      method: req.method,
      adminTokenHeader: req.headers['authorization']?.toString().replace('Bearer ', '') || req.headers['x-admin-token']?.toString(),
      cookieHeader: req.headers['cookie']?.toString(),
      origin: req.headers['origin']?.toString(),
      referer: req.headers['referer']?.toString(),
    },
    { adminToken: ADMIN_TOKEN, trustedOrigins: TRUSTED_ORIGINS }
  );
  if (!decision.ok) {
    res.status(decision.status).json({ ok: false, error: decision.reason === 'csrf' ? 'Origen no permitido (CSRF)' : 'No autenticado' });
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
import { readAgentMemory } from './services/agentMemoryService.js';
import { toolsForRole } from './config/agentModels.js';
import { claimAgent, releaseAgent } from './services/agentSelector.js';
import {
  listRoleDefinitions, getRoleDefinition, createRoleDefinition, updateRoleDefinition, setRoleStatus,
} from './services/roleService.js';
import { getConfig, setConfig, MASTER_PROMPT_KEY } from './services/systemConfigService.js';
import { listMemory } from './services/memoryService.js';
import { approveDecision, rejectDecision, createDecision, listDecisions } from './services/decisionService.js';
import { createMessage, listMessages } from './services/messageService.js';
import { askAgent, callAIJson } from './services/aiService.js';
import { listContent } from './services/contentService.js';
import { listMarket } from './services/marketService.js';
import { listExecRuns } from './services/hermesService.js';
import { resolveDecisionApproval, resolveDecisionRejection } from './services/decisionResolvers.js';
import { createCommand, cancelCommand } from './services/hokageOrchestrator.js';
import { getVentureBudget } from './services/ventureBudget.js';
import { listAuditEvents, getCommandTrace } from './services/auditService.js';
import {
  createOpportunity, listOpportunities, getOpportunityDetail, getOpportunity,
  beginResearch, progressOpportunity, researchPromptFor,
} from './services/opportunityPipeline.js';
import { activateVenture } from './services/ventureActivation.js';
import {
  buildAuthorizeUrl, exchangeCode, getConnectionStatus,
  generateCodeVerifier, deriveCodeChallenge, generateState,
} from './services/etsyClient.js';
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

// Rate limit estricto para el login (anti fuerza bruta de la credencial).
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos de acceso. Espera un momento.' },
});

// La cookie de sesión lleva Secure cuando la conexión es HTTPS (detrás de nginx via
// x-forwarded-proto) o si se fuerza por entorno. En local (http) no, para que funcione en dev.
function cookieSecure(req: express.Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.SESSION_SECURE === '1';
}

app.use('/api', generalLimiter);
app.use('/api/agents', generalLimiter);
app.use('/api/agents/:id/ask', askLimiter);
app.use('/api/runtime', runtimeLimiter);

// WebSocket para actualizaciones en tiempo real. F10: el navegador autentica por la cookie de
// sesión (validada en verifyClient); los clientes máquina pueden seguir enviando el ADMIN_TOKEN
// en el header Sec-WebSocket-Protocol (no en la URL, para no filtrarlo en logs/Referer).
function extractWsToken(req: import('http').IncomingMessage): string | undefined {
  const proto = req.headers['sec-websocket-protocol'];
  return proto?.split(',')[0]?.trim();
}

const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: (info, callback) => {
    // F10: el navegador autentica por cookie de sesión (enviada en el handshake same-origin);
    // los clientes máquina pueden seguir usando el token en Sec-WebSocket-Protocol. El backend
    // deriva la identidad de la sesión/token — nunca de datos de aplicación del cliente.
    const cookies = parseCookies(info.req.headers['cookie']);
    if (validateSession(cookies[SESSION_COOKIE])) { callback(true); return; }
    const token = extractWsToken(info.req);
    if (constantTimeEqual(token, ADMIN_TOKEN)) { callback(true); return; }
    callback(false, 401, 'No autenticado');
  },
  handleProtocols: (protocols) => {
    // El subprotocolo ofrecido es el token en sí, no un protocolo de aplicación —
    // se confirma el primero para completar el handshake, ya validado en verifyClient.
    const first = protocols.values().next().value;
    return first ?? false;
  },
});
const clients = new Set<WebSocket>();

wss.on('connection', async (ws, _req) => {
  clients.add(ws);
  console.log(`[WS] Cliente conectado. Total: ${clients.size}`);
  ws.on('close', () => { clients.delete(ws); });

  // Snapshot inicial — el cliente no necesita REST para el arranque
  try {
    const [agents, decisions, departments, agentStates, ventures, runs] = await Promise.all([
      listAgents(),
      listDecisions(),
      all<{ id: number; key: string; name: string; desc: string; role: string; glyph: string; color: string; pos_x: number; pos_y: number; is_hub: number }>(
        'SELECT * FROM departments WHERE active = 1 ORDER BY sort_order ASC'
      ),
      runtime.getRuntimeStates(),  // K.4: estado real de runtime por agente (derivado, no inventado)
      // Roadmap Fase 3 (D1): globales simples que el mapa/overlays necesitan en el primer
      // paint. Mismas queries que sus rutas REST (reutilizadas, no endpoints nuevos). Los
      // datos computados (metrics) o pesados/secundarios (messages, objectives enriquecidos)
      // conservan su ruta REST. REST sigue siendo carga inicial + fallback.
      all('SELECT * FROM ventures ORDER BY created_at DESC'),
      all('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 100'),
    ]);
    ws.send(JSON.stringify({
      type: 'initial_snapshot',
      data: {
        agents,
        decisions,
        departments,
        agent_states: agentStates,  // K.4: snapshot de AgentRuntimeState (aditivo)
        ventures,
        runs,
        recent_events: bus.getHistory(30),
        timestamp: new Date().toISOString(),
      },
    }));
  } catch (err) {
    console.error('[WS] Error enviando snapshot inicial:', err);
    ws.send(JSON.stringify({ type: 'connected', data: { message: 'HOKAGE OS conectado' } }));
  }
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

// ═══════════ AUTENTICACIÓN DE SESIÓN (Fase 10) ═══════════
// Gate global SECURE-BY-DEFAULT: todo /api/* exige sesión (o token de máquina) salvo el
// allowlist público de bootstrap del login. Así los GET sensibles (ventures, decisions,
// objectives, messages, prompts, auditoría, presupuesto…) quedan protegidos sin editar ruta a
// ruta, y cualquier endpoint futuro nace protegido. Los requireAdmin inline de las mutaciones
// permanecen como defensa redundante.
const PUBLIC_API_PATHS = new Set(['/api/health', '/api/auth/login', '/api/auth/logout', '/api/auth/session']);
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  return requireAdmin(req, res, next);
});

// POST /api/auth/login — credencial == ADMIN_TOKEN (comparación en tiempo constante). Regenera la
// sesión (anti session-fixation) y entrega cookie HttpOnly. NUNCA devuelve el token al navegador.
app.post('/api/auth/login', loginLimiter, (req, res) => {
  if (!originAllowed(req.headers.origin?.toString(), req.headers.referer?.toString(), TRUSTED_ORIGINS)) {
    return res.status(403).json({ ok: false, error: 'Origen no permitido' });
  }
  const { password } = req.body as { password?: string };
  if (!constantTimeEqual(password ?? '', ADMIN_TOKEN)) {
    return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
  }
  const prev = parseCookies(req.headers.cookie?.toString())[SESSION_COOKIE];
  const sid = regenerateSession(prev);
  res.setHeader('Set-Cookie', serializeSessionCookie(sid, { secure: cookieSecure(req) }));
  res.json({ ok: true, data: { authenticated: true } });
});

// POST /api/auth/logout — invalida la sesión y limpia la cookie. Idempotente (público).
app.post('/api/auth/logout', (req, res) => {
  destroySession(parseCookies(req.headers.cookie?.toString())[SESSION_COOKIE]);
  res.setHeader('Set-Cookie', clearSessionCookie({ secure: cookieSecure(req) }));
  res.json({ ok: true, data: { authenticated: false } });
});

// GET /api/auth/session — estado mínimo, sin secretos. Público (bootstrap del login).
app.get('/api/auth/session', (req, res) => {
  const authed = validateSession(parseCookies(req.headers.cookie?.toString())[SESSION_COOKIE]);
  res.json({ ok: true, data: { authenticated: authed } });
});

// ═══════════ HEALTH ═══════════
app.get('/api/health', (_req, res) => res.json({
  ok: true,
  status: 'ok',
  runtime: runtime.isRunning(),
  websocket: clients.size,
}));

// ═══════════ MÉTRICAS ═══════════
app.get('/api/metrics/summary', async (_req, res) => {
  try {
    // Edad calculada con julianday() (SQLite, UTC nativo) en vez de `new Date()` en JS —
    // Node interpreta los timestamps de SQLite como hora local, desfasando la antigüedad
    // por el offset de la zona horaria del proceso.
    const [costRow, msgRow, pendingRow, urgentRow] = await Promise.all([
      get<{ cost: number }>(
        `SELECT COALESCE(SUM(llm_cost_usd + tool_cost_usd), 0) as cost FROM agent_costs WHERE date(created_at) = date('now')`
      ),
      get<{ count: number }>(
        `SELECT COUNT(*) as count FROM messages WHERE date(created_at) = date('now')`
      ),
      get<{ count: number }>(
        `SELECT COUNT(*) as count FROM decisions WHERE status IN ('proposed', 'pending')`
      ),
      get<{ count: number }>(
        `SELECT COUNT(*) as count FROM decisions
         WHERE status IN ('proposed', 'pending')
         AND (risk_level = 'high' OR (amount IS NOT NULL AND amount > 0) OR (julianday('now') - julianday(created_at)) * 24 > 24)`
      ),
    ]);

    res.json({
      ok: true,
      data: {
        ai_cost_today_usd: Number((costRow?.cost ?? 0).toFixed(4)),
        messages_today: msgRow?.count ?? 0,
        pending_decisions: pendingRow?.count ?? 0,
        urgent_decisions: urgentRow?.count ?? 0,
      },
    });
  } catch (e: any) { sendError(res, 500, e, 'Error calculando métricas'); }
});

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

// MANUAL_CLAIM: identidad de claim para las ejecuciones manuales admin (/ask y /run). No tienen
// work_item, así que reclaman con un sentinela negativo (no colisiona con work_item.id, que es
// autoincrement positivo). Compartido por ambos endpoints → también son mutuamente excluyentes
// entre sí. ADR-011 (decisión #12) + cierre del criterio de readiness #5 (ninguna vía ejecuta un
// agente saltándose claimAgent): askAgent corre el loop de tools reales y gasta presupuesto.
// ponytail: sentinela en vez de crear un work_item — evita una cuarta vía y no ensucia la cola.
const MANUAL_CLAIM = -1;

app.post('/api/agents/:id/ask', requireAdmin, async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const { message } = req.body;
    if (!message) return res.status(400).json({ ok: false, error: 'Falta message' });

    const claimed = await claimAgent(agentId, MANUAL_CLAIM, 5); // exclusión mutua con runtime/Hokage/otro manual
    if (!claimed) return res.status(409).json({ ok: false, error: 'Agente ocupado por otra ejecución' });
    try {
      const result = await askAgent(agentId, String(message));
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error || 'Error en askAgent' });
      }
      res.json({ ok: true, data: { response: result.data?.response || '', tokens: result.data?.tokens ?? 0 } });
    } finally {
      await releaseAgent(agentId, MANUAL_CLAIM);
    }
  } catch (e: any) { sendError(res, 500, e, 'Error en askAgent'); }
});

// Ejecutar agente de forma autonoma (manual trigger, admin). Coordinado con la MISMA exclusión
// mutua que runtime/Hokage vía MANUAL_CLAIM (ADR-011, decisión #12): si el agente ya está
// reclamado → 409 en vez de doble ejecución. El release en finally cubre éxito, error y throw.
app.post('/api/agents/:id/run', requireAdmin, async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const agents = await listAgents();
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return res.status(404).json({ ok: false, error: 'Agente no encontrado' });

    const claimed = await claimAgent(agentId, MANUAL_CLAIM, 5); // 5 min TTL: red de seguridad
    if (!claimed) return res.status(409).json({ ok: false, error: 'Agente ocupado por otra ejecución' });
    try {
      const result = await runtime.runAgent({
        agentId: agent.id,
        agentName: agent.name,
        agentRole: agent.role,
        taskType: 'manual',
        context: req.body.task,
      });
      res.json({ ok: result.ok, data: result });
    } finally {
      await releaseAgent(agentId, MANUAL_CLAIM);
    }
  } catch (e: any) { sendError(res, 500, e, 'Error ejecutando agente'); }
});

app.get('/api/agent-runs', async (req, res) => {
  try {
    const agentId = req.query.agent_id ? Number(req.query.agent_id) : undefined;
    const runs = agentId
      ? await all('SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC', [agentId])
      : await all('SELECT * FROM agent_runs ORDER BY started_at DESC');
    res.json({ ok: true, data: runs });
  } catch (e: any) { sendError(res, 500, e, 'Error listando agent_runs'); }
});

// ═══════════ ROLES (Registry de roles, Fase 1c) ═══════════
// Configuración de seguridad → todos requireAdmin, incl. lectura (L·5).
app.get('/api/roles', requireAdmin, async (_req, res) => {
  try {
    const roles = await listRoleDefinitions();
    res.json({ ok: true, data: roles });
  } catch (e: any) { sendError(res, 500, e, 'Error listando roles'); }
});

app.get('/api/roles/:key', requireAdmin, async (req, res) => {
  try {
    const role = await getRoleDefinition(req.params.key);
    if (!role) return res.status(404).json({ ok: false, error: 'Rol no encontrado' });
    res.json({ ok: true, data: role });
  } catch (e: any) { sendError(res, 500, e, 'Error leyendo rol'); }
});

app.post('/api/roles', requireAdmin, async (req, res) => {
  try {
    const role = await createRoleDefinition(req.body);
    res.status(201).json({ ok: true, data: role });
  } catch (e: any) { sendError(res, 400, e, 'Error creando rol'); }
});

app.put('/api/roles/:key', requireAdmin, async (req, res) => {
  try {
    const role = await updateRoleDefinition(req.params.key, req.body);
    res.json({ ok: true, data: role });
  } catch (e: any) { sendError(res, 400, e, 'Error actualizando rol'); }
});

app.post('/api/roles/:key/enable', requireAdmin, async (req, res) => {
  try {
    const role = await setRoleStatus(req.params.key, 'active');
    res.json({ ok: true, data: role });
  } catch (e: any) { sendError(res, 400, e, 'Error activando rol'); }
});

app.post('/api/roles/:key/disable', requireAdmin, async (req, res) => {
  try {
    const role = await setRoleStatus(req.params.key, 'disabled');
    res.json({ ok: true, data: role });
  } catch (e: any) { sendError(res, 400, e, 'Error desactivando rol'); }
});

// ═══════════ MEMORIA DE NEGOCIO (Fase 4) ═══════════
// Datos de negocio → requireAdmin. Filtros opcionales: venture_id (o 'null' = global), category.
app.get('/api/memory', requireAdmin, async (req, res) => {
  try {
    const ventureId = req.query.venture_id !== undefined
      ? (req.query.venture_id === 'null' ? null : Number(req.query.venture_id))
      : undefined;
    const category = req.query.category ? String(req.query.category) : undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
    const data = await listMemory({ ventureId, category, limit });
    res.json({ ok: true, data });
  } catch (e: any) { sendError(res, 500, e, 'Error listando memoria'); }
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
    const decision = await approveDecision(id, OWNER_NAME);
    await resolveDecisionApproval(decision);
    bus.publish({ type: 'decision.approved', from: OWNER_NAME, payload: { decisionId: id } });
    broadcast('decision.approved', { id });
    res.json({ ok: true });
  } catch (e: any) { sendError(res, 400, e, 'Error aprobando decision'); }
});

app.put('/api/decisions/:id/reject', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const decision = await rejectDecision(id, OWNER_NAME);
    await resolveDecisionRejection(decision);
    bus.publish({ type: 'decision.rejected', from: OWNER_NAME, payload: { decisionId: id } });
    broadcast('decision.rejected', { id });
    res.json({ ok: true });
  } catch (e: any) { sendError(res, 400, e, 'Error rechazando decision'); }
});

// ═══════════ HERMES ═══════════
app.get('/api/hermes/runs', async (_req, res) => {
  try {
    const runs = await listExecRuns(30);
    res.json({ ok: true, data: runs });
  } catch (e: any) { sendError(res, 500, e, 'Error listando ejecuciones de Hermes'); }
});

// ═══════════ HOKAGE ORCHESTRATOR (Fase 5) ═══════════
// Recibe una orden de alto nivel, la descompone en tareas para especialistas y las
// despacha por el motor de work_items existente. askLimiter: cada orden hace 1 llamada IA.
app.post('/api/hokage/command', requireAdmin, askLimiter, async (req, res) => {
  try {
    const { text, venture_id = null, idempotency_key = null } = req.body as { text?: string; venture_id?: number | null; idempotency_key?: string | null };
    if (!text?.trim()) return res.status(400).json({ ok: false, error: 'Falta el texto de la orden' });
    const result = await createCommand({ text: String(text), ventureId: venture_id, idempotencyKey: idempotency_key });
    broadcast('hokage.command', result.command);
    res.status(201).json({ ok: true, data: result });
  } catch (e: any) { sendError(res, 500, e, 'Error procesando la orden de Hokage'); }
});

// Detalle de una orden reconstruido (Fase 9): command + tasks + work_items + traza de eventos
// correlacionada por command_id. Extiende el contrato previo ({command, tasks}) de forma aditiva.
app.get('/api/hokage/commands/:id', requireAdmin, async (req, res) => {
  try {
    const result = await getCommandTrace(Number(req.params.id));
    if (!result) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
    res.json({ ok: true, data: result });
  } catch (e: any) { sendError(res, 500, e, 'Error leyendo la orden'); }
});

// ═══════════ AUDITORÍA (Fase 9) — traza operativa persistida (event_log). requireAdmin.
// Scope por venture IMPUESTO en la query (una consulta de V1 no devuelve eventos de V2).
app.get('/api/audit/events', requireAdmin, async (req, res) => {
  try {
    const q = req.query;
    const n = (v: unknown) => (v !== undefined ? Number(v) : undefined);
    const events = await listAuditEvents({
      ventureId: q.venture_id !== undefined ? (q.venture_id === 'null' ? null : Number(q.venture_id)) : undefined,
      commandId: n(q.command_id),
      taskId: n(q.task_id),
      workItemId: n(q.work_item_id),
      agentId: n(q.agent_id),
      type: q.type ? String(q.type) : undefined,
      since: q.since ? String(q.since) : undefined,
      until: q.until ? String(q.until) : undefined,
      limit: n(q.limit),
      cursor: n(q.cursor),
    });
    res.json({ ok: true, data: events });
  } catch (e: any) { sendError(res, 500, e, 'Error listando eventos de auditoría'); }
});

app.post('/api/hokage/commands/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const result = await cancelCommand(Number(req.params.id));
    if (!result) return res.status(404).json({ ok: false, error: 'Orden no encontrada' });
    broadcast('hokage.command', result.command);
    res.json({ ok: true, data: result });
  } catch (e: any) { sendError(res, 500, e, 'Error cancelando la orden'); }
});

// ═══════════ F11 — PIPELINE DE OPORTUNIDADES ═══════════
// Investigación → validación → monetización → propuesta → (aprobación HUMANA vía la Decision
// business_proposal, ruta PUT /api/decisions/:id/approve) → creación. Todo bajo el gate F10.
app.post('/api/opportunities', requireAdmin, async (req, res) => {
  try {
    const { title, funding_venture_id } = req.body as { title?: string; funding_venture_id?: number };
    if (!title?.trim()) return res.status(400).json({ ok: false, error: 'Falta el título/hipótesis' });
    if (funding_venture_id == null) return res.status(400).json({ ok: false, error: 'Falta funding_venture_id' });
    const opp = await createOpportunity({ title: String(title), fundingVentureId: Number(funding_venture_id) });
    res.status(201).json({ ok: true, data: opp });
  } catch (e: any) { sendError(res, 400, e, 'Error creando oportunidad'); }
});

app.get('/api/opportunities', requireAdmin, async (_req, res) => {
  try { res.json({ ok: true, data: await listOpportunities() }); }
  catch (e: any) { sendError(res, 500, e, 'Error listando oportunidades'); }
});

app.get('/api/opportunities/:id', requireAdmin, async (req, res) => {
  try {
    const detail = await getOpportunityDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ ok: false, error: 'Oportunidad no encontrada' });
    res.json({ ok: true, data: detail });
  } catch (e: any) { sendError(res, 500, e, 'Error leyendo oportunidad'); }
});

// Despacha la investigación por el orquestador F5, financiada por la funding_venture (F7).
app.post('/api/opportunities/:id/research', requireAdmin, askLimiter, async (req, res) => {
  try {
    const opp = await getOpportunity(Number(req.params.id));
    if (!opp) return res.status(404).json({ ok: false, error: 'Oportunidad no encontrada' });
    if (opp.status !== 'draft') { res.json({ ok: true, data: opp }); return; } // idempotente
    const cmd = await createCommand({ text: researchPromptFor(opp.title), ventureId: opp.funding_venture_id });
    const updated = await beginResearch(opp.id, cmd.command.id);
    res.status(201).json({ ok: true, data: updated });
  } catch (e: any) { sendError(res, 500, e, 'Error lanzando investigación'); }
});

// Progresión acotada (respaldo del hook automático): research→…→awaiting_approval. Idempotente.
app.post('/api/opportunities/:id/advance', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(await getOpportunity(id))) return res.status(404).json({ ok: false, error: 'Oportunidad no encontrada' });
    await progressOpportunity(id);
    res.json({ ok: true, data: await getOpportunityDetail(id) });
  } catch (e: any) { sendError(res, 500, e, 'Error avanzando la oportunidad'); }
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

// ═══════════ INTEGRACIONES · ETSY (Fase 4 · slice lectura) ═══════════
// Estado transitorio del flujo OAuth (state → PKCE verifier + venture), en memoria.
// ponytail: por-proceso, suficiente para el connect one-time de admin en single-instance;
// mover a tabla si se despliega multi-instancia.
const etsyOAuthFlows = new Map<string, { codeVerifier: string; ventureId: number; expiresAt: number }>();
const ETSY_FLOW_TTL_MS = 10 * 60_000;
function pruneEtsyFlows(): void {
  const now = Date.now();
  for (const [k, v] of etsyOAuthFlows) if (v.expiresAt < now) etsyOAuthFlows.delete(k);
}

// Inicia OAuth: genera state + PKCE, guarda el verifier y redirige a Etsy. Admin (guard global).
app.get('/api/integrations/etsy/connect', requireAdmin, (req, res) => {
  try {
    const ventureId = Number(req.query.venture_id);
    if (!Number.isInteger(ventureId) || ventureId <= 0) return res.status(400).json({ ok: false, error: 'venture_id requerido' });
    pruneEtsyFlows();
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    etsyOAuthFlows.set(state, { codeVerifier, ventureId, expiresAt: Date.now() + ETSY_FLOW_TTL_MS });
    res.redirect(buildAuthorizeUrl({ state, codeChallenge: deriveCodeChallenge(codeVerifier) }));
  } catch (e: any) { sendError(res, 500, e, 'Error iniciando OAuth de Etsy'); }
});

// Callback OAuth: valida state (single-use, TTL) y canja el code → guarda tokens. GET del
// navegador tras el redirect de Etsy (cookie SameSite=Lax viaja; GET no dispara CSRF).
app.get('/api/integrations/etsy/callback', async (req, res) => {
  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '');
  const flow = etsyOAuthFlows.get(state);
  etsyOAuthFlows.delete(state);   // single-use pase lo que pase
  if (!flow || flow.expiresAt < Date.now() || !code) {
    return res.status(400).send('<p>Conexión con Etsy fallida: estado inválido o expirado. Vuelve a intentarlo.</p>');
  }
  try {
    await exchangeCode({ code, codeVerifier: flow.codeVerifier, ventureId: flow.ventureId });
    res.send('<p>Etsy conectado correctamente. Puedes cerrar esta pestaña.</p>');
  } catch {
    // Nunca exponer detalles/secretos en el mensaje al navegador (F3).
    res.status(502).send('<p>No se pudo completar la conexión con Etsy. Revisa la configuración e inténtalo de nuevo.</p>');
  }
});

// Estado de conexión de una venture — SIN tokens (F3). Admin.
app.get('/api/integrations/etsy/status', requireAdmin, async (req, res) => {
  try {
    const ventureId = Number(req.query.venture_id);
    if (!Number.isInteger(ventureId) || ventureId <= 0) return res.status(400).json({ ok: false, error: 'venture_id requerido' });
    res.json({ ok: true, data: await getConnectionStatus(ventureId) });
  } catch (e: any) { sendError(res, 500, e, 'Error leyendo estado de Etsy'); }
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
    const { key, name, desc = '', role, glyph = 'default', color = '#4fd1c5', pos_x = 1000, pos_y = 1000, is_hub = 0, sort_order = 0, type = 'business' } = req.body;
    if (!key || !name || !role) return res.status(400).json({ ok: false, error: 'Faltan campos obligatorios: key, name, role' });
    if (type !== 'business' && type !== 'system') return res.status(400).json({ ok: false, error: "type debe ser 'business' o 'system'" });
    const existing = await get<Department>('SELECT id FROM departments WHERE key = ?', [key]);
    if (existing) return res.status(409).json({ ok: false, error: `Ya existe un departamento con key "${key}"` });
    const result = await run(
      `INSERT INTO departments (key,name,desc,role,glyph,color,pos_x,pos_y,is_hub,sort_order,type) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [key, name, desc, role, glyph, color, pos_x, pos_y, is_hub, sort_order, type]
    );
    const dept = await get<Department>('SELECT * FROM departments WHERE id = ?', [result.lastID]);
    res.status(201).json({ ok: true, data: dept });
  } catch (e: any) { sendError(res, 400, e, 'Error creando departamento'); }
});

app.put('/api/departments/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const payload = req.body as DepartmentUpdatePayload;
    if (payload.type !== undefined && payload.type !== 'business' && payload.type !== 'system') {
      return res.status(400).json({ ok: false, error: "type debe ser 'business' o 'system'" });
    }
    const allowed: (keyof DepartmentUpdatePayload)[] = ['name', 'desc', 'color', 'pos_x', 'pos_y', 'active', 'type'];
    const sets = allowed.filter((k) => payload[k] !== undefined).map((k) => `${k} = ?`);
    const vals = allowed.filter((k) => payload[k] !== undefined).map((k) => payload[k]);
    if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Sin campos a actualizar' });
    await run(`UPDATE departments SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    const dept = await get<Department>('SELECT * FROM departments WHERE id = ?', [id]);
    res.json({ ok: true, data: dept });
  } catch (e: any) { sendError(res, 400, e, 'Error actualizando departamento'); }
});
// Work items por agente — fuente de verdad del Pipeline tab
app.get('/api/agents/:id/work-items', async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const items = await all<{
      id: number; agent_id: number; type: string; priority: number;
      status: string; context: string | null; result: string | null;
      locked_at: string | null; retry_count: number; created_at: string; resolved_at: string | null;
    }>(
      `SELECT id, agent_id, type, priority, status, context, result, locked_at, retry_count, created_at, resolved_at
       FROM work_items
       WHERE agent_id = ?
       ORDER BY
         CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 WHEN 'failed' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
         priority DESC, created_at DESC
       LIMIT 30`,
      [agentId]
    );
    res.json({ ok: true, data: items });
  } catch (e: any) { sendError(res, 500, e, 'Error listando work items'); }
});

app.get('/api/agents/:id/stats', async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const [runs, costs, workItems, decisions] = await Promise.all([
      all<{ status: string; tokens_used: number; started_at: string }>(
        `SELECT status, tokens_used, started_at FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 200`,
        [agentId]
      ),
      get<{ tokens_in: number; tokens_out: number; cost_sum: number }>(
        `SELECT COALESCE(SUM(tokens_in),0) as tokens_in, COALESCE(SUM(tokens_out),0) as tokens_out,
                COALESCE(SUM(llm_cost_usd),0) as cost_sum
         FROM agent_costs WHERE agent_id = ?`,
        [agentId]
      ),
      get<{ active: number; pending: number }>(
        `SELECT SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status='pending'     THEN 1 ELSE 0 END) as pending
         FROM work_items WHERE agent_id = ?`,
        [agentId]
      ),
      get<{ proposed: number }>(
        `SELECT COUNT(*) as proposed FROM decisions WHERE agent_id = ? AND status IN ('proposed','pending')`,
        [agentId]
      ),
    ]);

    const total = runs.length;
    const successful = runs.filter(r => r.status === 'completed').length;
    const failed     = runs.filter(r => r.status === 'failed').length;
    const lastRunAt  = runs[0]?.started_at ?? null;

    res.json({
      ok: true,
      data: {
        total_runs: total,
        successful_runs: successful,
        failed_runs: failed,
        success_rate: total ? Math.round((successful / total) * 100) : null,
        total_tokens: (costs?.tokens_in ?? 0) + (costs?.tokens_out ?? 0),
        total_cost_usd: Number((costs?.cost_sum ?? 0).toFixed(4)),
        active_work_items: workItems?.active ?? 0,
        pending_work_items: workItems?.pending ?? 0,
        pending_decisions: decisions?.proposed ?? 0,
        last_run_at: lastRunAt,
      },
    });
  } catch (e: any) { sendError(res, 500, e, 'Error calculando stats del agente'); }
});

// Outputs reales del agente: contenido creado + tendencias detectadas
app.get('/api/agents/:id/outputs', async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const [content, market] = await Promise.all([
      listContent(agentId),
      listMarket(agentId),
    ]);
    res.json({ ok: true, data: { content, market } });
  } catch (e: any) { sendError(res, 500, e, 'Error listando outputs del agente'); }
});

// Fase 10: Memoria privada del agente (solo lectura, sin requireAdmin — como /stats, /outputs, /work-items)
app.get('/api/agents/:id/memory', async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 20;
    const entries = await readAgentMemory(agentId, limit);
    res.json({ ok: true, data: entries });
  } catch (e: any) { sendError(res, 500, e, 'Error leyendo memoria del agente'); }
});

// Fase 10: Tools disponibles para el rol del agente (solo nombres, sin descripciones inventadas)
app.get('/api/agents/:id/tools', async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const agents = await listAgents();
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return res.status(404).json({ ok: false, error: 'Agente no encontrado' });
    const tools = toolsForRole(agent.role);
    res.json({ ok: true, data: tools });
  } catch (e: any) { sendError(res, 500, e, 'Error obteniendo tools del agente'); }
});

app.get('/api/events', requireAdmin, (_req, res) => {
  res.json({ ok: true, data: bus.getHistory(50) });
});

// ═══════════ DECISIONES — limpieza masiva ═══════════
app.post('/api/decisions/expire-old', requireAdmin, async (req, res) => {
  try {
    const olderThanHours = Number(req.body?.older_than_hours ?? 48);
    const result = await run(
      `UPDATE decisions SET status = 'expired'
       WHERE status IN ('proposed', 'pending')
       AND datetime(created_at, '+' || ? || ' hours') < datetime('now')`,
      [olderThanHours]
    );
    res.json({ ok: true, data: { expired: result.changes } });
  } catch (e: any) { sendError(res, 500, e, 'Error expirando decisiones'); }
});

// ═══════════ VENTURES ═══════════
app.get('/api/ventures', async (_req, res) => {
  try {
    const ventures = await all('SELECT * FROM ventures ORDER BY created_at DESC');
    res.json({ ok: true, data: ventures });
  } catch (e: any) { sendError(res, 500, e, 'Error listando ventures'); }
});

// Presupuesto por venture (Fase 7): asignado / reservado / real / disponible. Dato financiero
// sensible → requireAdmin (aún sin consumidor de UI; F10 decidirá su superficie).
app.get('/api/ventures/:id/budget', requireAdmin, async (req, res) => {
  try {
    const budget = await getVentureBudget(Number(req.params.id));
    if (!budget) return res.status(404).json({ ok: false, error: 'Venture no encontrada' });
    res.json({ ok: true, data: budget });
  } catch (e: any) { sendError(res, 500, e, 'Error leyendo presupuesto de la venture'); }
});

app.post('/api/ventures', requireAdmin, async (req, res) => {
  try {
    const { name, type = 'store', status = 'idea', goal = null, revenue_target_usd = 0 } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: 'Falta name' });
    const result = await run(
      `INSERT INTO ventures (name, type, status, goal, revenue_target_usd) VALUES (?, ?, ?, ?, ?)`,
      [name, type, status, goal, revenue_target_usd]
    );
    const venture = await get('SELECT * FROM ventures WHERE id = ?', [result.lastID]);
    res.status(201).json({ ok: true, data: venture });
  } catch (e: any) { sendError(res, 400, e, 'Error creando venture'); }
});

app.patch('/api/ventures/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const allowed = ['name', 'type', 'status', 'goal', 'revenue_target_usd', 'budget_allocated_usd'];
    const sets = allowed.filter((k) => req.body[k] !== undefined).map((k) => `${k} = ?`);
    const vals = allowed.filter((k) => req.body[k] !== undefined).map((k) => req.body[k]);
    if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Sin campos a actualizar' });
    await run(`UPDATE ventures SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    const venture = await get('SELECT * FROM ventures WHERE id = ?', [id]);
    res.json({ ok: true, data: venture });
  } catch (e: any) { sendError(res, 400, e, 'Error actualizando venture'); }
});

// F12 · Activación de venture — backstop/retry idempotente (la vía normal es la auto-activación
// tras aprobar la Decision business_proposal). askLimiter: dispara trabajo del orquestador F5 (gasto).
// Reactiva también una venture antes inerte por presupuesto 0, una vez se le asigna presupuesto vía PATCH.
app.post('/api/ventures/:id/activate', requireAdmin, askLimiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!(await get('SELECT id FROM ventures WHERE id = ?', [id]))) return res.status(404).json({ ok: false, error: 'Venture no encontrada' });
    const result = await activateVenture(id, 'endpoint');
    res.json({ ok: true, data: result });
  } catch (e: any) { sendError(res, 500, e, 'Error activando venture'); }
});

// ═══════════ ASSETS ═══════════
app.get('/api/assets', async (req, res) => {
  try {
    const { venture_id } = req.query;
    const where = venture_id ? 'WHERE venture_id = ?' : '';
    const params = venture_id ? [Number(venture_id)] : [];
    const assets = await all(`SELECT * FROM assets ${where} ORDER BY created_at DESC`, params);
    res.json({ ok: true, data: assets });
  } catch (e: any) { sendError(res, 500, e, 'Error listando assets'); }
});

app.post('/api/assets', requireAdmin, async (req, res) => {
  try {
    const { venture_id = null, type, name, description = null, value_usd = null, platform = null, external_id = null } = req.body;
    if (!type || !name) return res.status(400).json({ ok: false, error: 'Faltan type y name' });
    const result = await run(
      `INSERT INTO assets (venture_id, type, name, description, value_usd, platform, external_id) VALUES (?,?,?,?,?,?,?)`,
      [venture_id, type, name, description, value_usd, platform, external_id]
    );
    const asset = await get('SELECT * FROM assets WHERE id = ?', [result.lastID]);
    res.status(201).json({ ok: true, data: asset });
  } catch (e: any) { sendError(res, 400, e, 'Error creando asset'); }
});

// ═══════════ AUTOMATIONS ═══════════
app.get('/api/automations', async (_req, res) => {
  try {
    const automations = await all('SELECT * FROM automations ORDER BY created_at ASC');
    res.json({ ok: true, data: automations });
  } catch (e: any) { sendError(res, 500, e, 'Error listando automations'); }
});

app.post('/api/automations', requireAdmin, async (req, res) => {
  try {
    const { venture_id = null, name, trigger_event, action_agent_role, action_priority = 6, action_context_template = null, requires_approval = 0 } = req.body;
    if (!name || !trigger_event || !action_agent_role) return res.status(400).json({ ok: false, error: 'Faltan name, trigger_event, action_agent_role' });
    const result = await run(
      `INSERT INTO automations (venture_id, name, trigger_event, action_agent_role, action_priority, action_context_template, requires_approval) VALUES (?,?,?,?,?,?,?)`,
      [venture_id, name, trigger_event, action_agent_role, action_priority, action_context_template, requires_approval ? 1 : 0]
    );
    const automation = await get('SELECT * FROM automations WHERE id = ?', [result.lastID]);
    res.status(201).json({ ok: true, data: automation });
  } catch (e: any) { sendError(res, 400, e, 'Error creando automation'); }
});

app.patch('/api/automations/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await run(`UPDATE automations SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?`, [id]);
    const automation = await get('SELECT * FROM automations WHERE id = ?', [id]);
    res.json({ ok: true, data: automation });
  } catch (e: any) { sendError(res, 400, e, 'Error toggling automation'); }
});

app.put('/api/automations/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const allowed = ['name', 'trigger_event', 'action_agent_role', 'action_priority', 'action_context_template', 'requires_approval', 'venture_id'];
    const sets = allowed.filter((k) => req.body[k] !== undefined).map((k) => `${k} = ?`);
    const vals = allowed.filter((k) => req.body[k] !== undefined).map((k) => (k === 'requires_approval' ? (req.body[k] ? 1 : 0) : req.body[k]));
    if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Sin campos a actualizar' });
    await run(`UPDATE automations SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    const automation = await get('SELECT * FROM automations WHERE id = ?', [id]);
    res.json({ ok: true, data: automation });
  } catch (e: any) { sendError(res, 400, e, 'Error actualizando automation'); }
});

app.delete('/api/automations/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await run(`DELETE FROM automations WHERE id = ?`, [id]);
    res.json({ ok: true });
  } catch (e: any) { sendError(res, 400, e, 'Error borrando automation'); }
});

// ═══════════ GOAL SYSTEM ═══════════
app.get('/api/objectives', async (_req, res) => {
  try {
    type ObjRow = { id: number; title: string; goal: string | null; success_criteria: string | null; deadline: string | null; priority: number; status: string; created_at: string };
    type PlanRow = { id: number; objective_id: number; phases: string; estimated_weeks: number | null; confidence: number; status: string; created_at: string };
    type MilestoneRow = { id: number; plan_id: number; objective_id: number; phase_index: number; title: string; description: string | null; assigned_agent_role: string | null; status: string; due_date: string | null; completed_at: string | null; created_at: string };

    const objectives = await all<ObjRow>('SELECT * FROM objectives ORDER BY priority DESC, created_at DESC');
    if (objectives.length === 0) return res.json({ ok: true, data: [] });

    const objIds = objectives.map((o) => o.id);
    const ph = (n: number) => Array(n).fill('?').join(',');

    // 1 query para todos los planes (el más reciente por objetivo)
    const allPlans = await all<PlanRow>(
      `SELECT * FROM obj_plans WHERE objective_id IN (${ph(objIds.length)}) ORDER BY created_at DESC`,
      objIds
    );
    const planByObj = new Map<number, PlanRow>();
    for (const p of allPlans) {
      if (!planByObj.has(p.objective_id)) planByObj.set(p.objective_id, p);
    }

    // 1 query para todos los milestones
    const planIds = [...planByObj.values()].map((p) => p.id);
    const allMilestones: MilestoneRow[] = planIds.length > 0
      ? await all<MilestoneRow>(
          `SELECT * FROM obj_milestones WHERE plan_id IN (${ph(planIds.length)}) ORDER BY phase_index ASC, created_at ASC`,
          planIds
        )
      : [];
    const milestonesByPlan = new Map<number, MilestoneRow[]>();
    for (const m of allMilestones) {
      if (!milestonesByPlan.has(m.plan_id)) milestonesByPlan.set(m.plan_id, []);
      milestonesByPlan.get(m.plan_id)!.push(m);
    }

    const result = objectives.map((obj) => {
      const plan = planByObj.get(obj.id);
      if (!plan) return { ...obj, plan: null };
      return { ...obj, plan: { ...plan, milestones: milestonesByPlan.get(plan.id) ?? [] } };
    });

    res.json({ ok: true, data: result });
  } catch (e: any) { sendError(res, 500, e, 'Error listando objetivos'); }
});

// Helper: genera y persiste el plan de un objetivo via IA
type PlanData = {
  goal?: string; success_criteria?: string; estimated_weeks?: number; confidence?: number;
  phases?: Array<{ title: string; description: string; milestones: Array<{ title: string; description: string; assigned_agent_role: string; estimated_days: number }> }>;
};
async function generateObjectivePlan(objectiveId: number, title: string): Promise<{ planId: number }> {
  const systemPrompt = `Eres el planificador estratégico de HOKAGE OS. Recibes un objetivo de negocio y devuelves ÚNICAMENTE JSON válido sin texto adicional, sin bloques de código markdown, sin explicaciones.`;
  const userMsg = `Objetivo: "${title}"

Devuelve este JSON exacto (sin texto extra antes ni después):
{
  "goal": "una frase que estructura el objetivo con claridad",
  "success_criteria": "criterio medible de éxito (número, fecha o porcentaje)",
  "estimated_weeks": 8,
  "confidence": 72,
  "phases": [
    {
      "title": "Nombre de la fase",
      "description": "Qué se consigue en esta fase",
      "milestones": [
        {
          "title": "Nombre del milestone",
          "description": "Qué hay que hacer concretamente",
          "assigned_agent_role": "investigador",
          "estimated_days": 7
        }
      ]
    }
  ]
}

Roles disponibles: investigador, contenido, trafico, finanzas, operaciones, soporte, ceo
Reglas: 2-4 fases, 2-3 milestones por fase. confidence entre 0-100 refleja cuán predecible es el éxito.`;

  // Modelo omitido a propósito: callAIJson usa DEFAULT_MODEL (haiku 4.5), fuente única en agentModels.ts.
  const planData: PlanData = await callAIJson<PlanData>(systemPrompt, userMsg) ?? {};

  await run(
    `UPDATE objectives SET goal = ?, success_criteria = ? WHERE id = ?`,
    [planData.goal ?? null, planData.success_criteria ?? null, objectiveId]
  );

  const planResult = await run(
    `INSERT INTO obj_plans (objective_id, phases, estimated_weeks, confidence, status) VALUES (?, ?, ?, ?, 'proposed')`,
    [objectiveId, JSON.stringify(planData.phases ?? []), planData.estimated_weeks ?? null, planData.confidence ?? 70]
  );
  const planId = planResult.lastID;

  for (let phaseIdx = 0; phaseIdx < (planData.phases ?? []).length; phaseIdx++) {
    const phase = planData.phases![phaseIdx];
    for (const m of (phase.milestones ?? [])) {
      await run(
        `INSERT INTO obj_milestones (plan_id, objective_id, phase_index, title, description, assigned_agent_role) VALUES (?, ?, ?, ?, ?, ?)`,
        [planId, objectiveId, phaseIdx, m.title, m.description ?? null, m.assigned_agent_role ?? null]
      );
    }
  }
  return { planId };
}

app.post('/api/objectives', requireAdmin, async (req, res) => {
  try {
    const { title, venture_id = null } = req.body as { title?: string; venture_id?: number | null };
    if (!title?.trim()) return res.status(400).json({ ok: false, error: 'Falta el título del objetivo' });

    const objResult = await run(
      `INSERT INTO objectives (title, status, venture_id) VALUES (?, 'planning', ?)`,
      [title.trim(), venture_id]
    );
    const objectiveId = objResult.lastID;

    const { planId } = await generateObjectivePlan(objectiveId, title.trim());

    const objective = await get('SELECT * FROM objectives WHERE id = ?', [objectiveId]);
    const plan = await get('SELECT * FROM obj_plans WHERE id = ?', [planId]);
    const milestones = await all('SELECT * FROM obj_milestones WHERE plan_id = ? ORDER BY phase_index ASC, created_at ASC', [planId]);

    bus.publish({ type: 'objective.created', from: OWNER_NAME, payload: { objectiveId, title: title.trim() } });
    res.status(201).json({ ok: true, data: { ...(objective as object), plan: { ...(plan as object), milestones } } });
  } catch (e: any) { sendError(res, 500, e, 'Error creando objetivo'); }
});

// Reintentar generación de plan para objetivos atascados en 'planning'
app.post('/api/objectives/:id/retry', requireAdmin, async (req, res) => {
  try {
    const objectiveId = Number(req.params.id);
    const obj = await get<{ id: number; title: string; status: string }>('SELECT id, title, status FROM objectives WHERE id = ?', [objectiveId]);
    if (!obj) return res.status(404).json({ ok: false, error: 'Objetivo no encontrado' });

    // Limpiar planes anteriores fallidos
    const oldPlan = await get<{ id: number }>('SELECT id FROM obj_plans WHERE objective_id = ?', [objectiveId]);
    if (oldPlan) {
      await run('DELETE FROM obj_milestones WHERE plan_id = ?', [oldPlan.id]);
      await run('DELETE FROM obj_plans WHERE id = ?', [oldPlan.id]);
    }
    await run(`UPDATE objectives SET status = 'planning' WHERE id = ?`, [objectiveId]);

    const { planId } = await generateObjectivePlan(objectiveId, obj.title);

    const objective = await get('SELECT * FROM objectives WHERE id = ?', [objectiveId]);
    const plan = await get('SELECT * FROM obj_plans WHERE id = ?', [planId]);
    const milestones = await all('SELECT * FROM obj_milestones WHERE plan_id = ? ORDER BY phase_index ASC, created_at ASC', [planId]);

    res.json({ ok: true, data: { ...(objective as object), plan: { ...(plan as object), milestones } } });
  } catch (e: any) { sendError(res, 500, e, 'Error reintentando objetivo'); }
});

app.put('/api/objectives/:id/plan/approve', requireAdmin, async (req, res) => {
  try {
    const objectiveId = Number(req.params.id);
    const plan = await get<{ id: number }>('SELECT id FROM obj_plans WHERE objective_id = ? AND status = \'proposed\'', [objectiveId]);
    if (!plan) return res.status(404).json({ ok: false, error: 'No hay plan propuesto para este objetivo' });

    // Activar plan y objetivo
    await run(`UPDATE obj_plans SET status = 'approved' WHERE id = ?`, [plan.id]);
    await run(`UPDATE objectives SET status = 'active' WHERE id = ?`, [objectiveId]);

    const objective = await get<{ venture_id: number | null }>('SELECT venture_id FROM objectives WHERE id = ?', [objectiveId]);

    // Crear work_items para cada milestone
    const milestones = await all<{ id: number; assigned_agent_role: string | null; title: string; description: string | null }>(
      'SELECT id, assigned_agent_role, title, description FROM obj_milestones WHERE plan_id = ? ORDER BY phase_index ASC, created_at ASC',
      [plan.id]
    );
    const agents = await listAgents();

    for (const m of milestones) {
      if (!m.assigned_agent_role) continue;
      const agent = agents.find((a) => a.role === m.assigned_agent_role);
      if (!agent) continue;

      const context = `[OBJETIVO] ${m.title}${m.description ? ': ' + m.description : ''}. Ejecuta esta tarea de forma concreta y reporta el resultado.`;
      const wiResult = await run(
        `INSERT INTO work_items (agent_id, venture_id, type, priority, status, context, milestone_id) VALUES (?, ?, 'event_triggered', 8, 'pending', ?, ?)`,
        [agent.id, objective?.venture_id ?? null, context, m.id]
      );
      await run(`UPDATE obj_milestones SET status = 'in_progress' WHERE id = ?`, [m.id]);
      console.log(`[GOAL] Milestone ${m.id} → work_item ${wiResult.lastID} para ${agent.name}`);
    }

    bus.publish({ type: 'objective.approved', from: OWNER_NAME, payload: { objectiveId } });
    const updated = await get('SELECT * FROM objectives WHERE id = ?', [objectiveId]);
    res.json({ ok: true, data: updated });
  } catch (e: any) { sendError(res, 500, e, 'Error aprobando plan'); }
});

app.patch('/api/objectives/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const allowed = ['status', 'priority', 'deadline'];
    const sets = allowed.filter((k) => req.body[k] !== undefined).map((k) => `${k} = ?`);
    const vals = allowed.filter((k) => req.body[k] !== undefined).map((k) => req.body[k]);
    if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Sin campos a actualizar' });
    await run(`UPDATE objectives SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    const obj = await get('SELECT * FROM objectives WHERE id = ?', [id]);
    res.json({ ok: true, data: obj });
  } catch (e: any) { sendError(res, 400, e, 'Error actualizando objetivo'); }
});

// ═══════════ AGENTES: PATCH + PROMPTS ═══════════

// Actualizar nombre / modelo del agente
app.patch('/api/agents/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, model } = req.body as { name?: string; model?: string };
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (name !== undefined) { sets.push('name = ?'); vals.push(name.trim()); }
    if (model !== undefined) { sets.push('model = ?'); vals.push(model.trim()); }
    if (sets.length === 0) return res.status(400).json({ ok: false, error: 'Nada que actualizar' });
    await run(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    const agent = await get('SELECT * FROM agents WHERE id = ?', [id]);
    res.json({ ok: true, data: agent });
  } catch (e: any) { sendError(res, 400, e, 'Error actualizando agente'); }
});

// Leer prompt activo de un agente
app.get('/api/agents/:id/prompt', async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const row = await get<{ content: string }>(
      'SELECT content FROM agent_prompts WHERE agent_id = ? AND active = 1 ORDER BY version DESC LIMIT 1',
      [agentId],
    );
    res.json({ ok: true, data: { content: row?.content ?? '' } });
  } catch (e: any) { sendError(res, 500, e, 'Error leyendo prompt'); }
});

// Crear o actualizar prompt de un agente (nueva versión)
app.put('/api/agents/:id/prompt', requireAdmin, async (req, res) => {
  try {
    const agentId = Number(req.params.id);
    const { content } = req.body as { content: string };
    if (!content?.trim()) return res.status(400).json({ ok: false, error: 'content vacío' });
    await run('UPDATE agent_prompts SET active = 0 WHERE agent_id = ?', [agentId]);
    const ver = await get<{ v: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS v FROM agent_prompts WHERE agent_id = ?',
      [agentId],
    );
    await run(
      'INSERT INTO agent_prompts (agent_id, prompt_type, content, version, active) VALUES (?, ?, ?, ?, 1)',
      [agentId, 'base', content.trim(), ver?.v ?? 1],
    );
    res.json({ ok: true });
  } catch (e: any) { sendError(res, 500, e, 'Error actualizando prompt'); }
});

// Leer prompt maestro global (system_config — Fase 3)
app.get('/api/config/master-prompt', async (_req, res) => {
  try {
    const content = await getConfig(MASTER_PROMPT_KEY);
    res.json({ ok: true, data: { content: content ?? '' } });
  } catch (e: any) { sendError(res, 500, e, 'Error leyendo master prompt'); }
});

// Actualizar prompt maestro global (system_config — Fase 3, sin FK a agents)
app.put('/api/config/master-prompt', requireAdmin, async (req, res) => {
  try {
    const { content } = req.body as { content: string };
    if (content === undefined) return res.status(400).json({ ok: false, error: 'content requerido' });
    await setConfig(MASTER_PROMPT_KEY, content.trim());
    res.json({ ok: true });
  } catch (e: any) { sendError(res, 500, e, 'Error actualizando master prompt'); }
});

// ═══════════ LAYOUT ═══════════
// Fila única (id=1) — sistema single-owner, sin sesión multi-usuario.
app.get('/api/layout', async (_req, res) => {
  try {
    const row = await get<{ screen: string; active_building_key: string | null }>(
      'SELECT screen, active_building_key FROM user_layout WHERE id = 1'
    );
    res.json({ ok: true, data: { screen: row?.screen ?? 'map', buildingKey: row?.active_building_key ?? null } });
  } catch (e: any) { sendError(res, 500, e, 'Error leyendo layout'); }
});

app.put('/api/layout', requireAdmin, async (req, res) => {
  try {
    const { screen, buildingKey } = req.body as { screen?: string; buildingKey?: string | null };
    if (!screen) return res.status(400).json({ ok: false, error: 'Falta screen' });
    await run(
      `INSERT INTO user_layout (id, screen, active_building_key, updated_at) VALUES (1, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET screen = excluded.screen, active_building_key = excluded.active_building_key, updated_at = excluded.updated_at`,
      [screen, buildingKey ?? null]
    );
    res.json({ ok: true });
  } catch (e: any) { sendError(res, 400, e, 'Error guardando layout'); }
});

// ═══════════ ARRANQUE ═══════════
// ═══════════ ARRANQUE ═══════════
const PORT = Number(process.env.PORT) || 3000;
console.time('[BOOT] initSchema');
initSchema().then(() => {
  console.timeEnd('[BOOT] initSchema');
  console.time('[BOOT] listen');
  httpServer.listen(PORT, '127.0.0.1', () => {
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
