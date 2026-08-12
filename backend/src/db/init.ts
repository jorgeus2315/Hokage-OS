import * as sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { modelForRole } from '../config/agentModels.js';
import { ROLE_SEEDS } from '../config/roleSeeds.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// HOKAGE_DB_PATH permite apuntar a un SQLite aislado (tests de Fase 5). En producción no se
// define → mismo fichero de siempre. Cambio aditivo, comportamiento por defecto idéntico.
const dbPath = process.env.HOKAGE_DB_PATH || path.resolve(__dirname, '../../data/hokage-os.db');

export const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) console.error('[DB] Error al abrir SQLite:', err.message);
  else console.log('[DB] Conexión establecida con SQLite');
});

export function run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: (this as any).lastID, changes: (this as any).changes });
    });
  });
}

export function get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

export function all<T>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const columns = await all<{ name: string }>(`PRAGMA table_info(${table})`);
  return columns.some((c) => c.name === column);
}

// Migraciones aditivas: nunca borran datos, solo añaden columnas/valores si faltan
async function runMigrations(): Promise<void> {
  if (!(await columnExists('agents', 'model'))) {
    await run(`ALTER TABLE agents ADD COLUMN model TEXT`);
  }
  if (!(await columnExists('decisions', 'description'))) {
    await run(`ALTER TABLE decisions ADD COLUMN description TEXT`);
  }
  if (!(await columnExists('decisions', 'reasoning'))) {
    await run(`ALTER TABLE decisions ADD COLUMN reasoning TEXT`);
  }

  // Migrar agent_schedules: agent_role TEXT PK → agent_id INTEGER PK
  const hasAgentRole = await columnExists('agent_schedules', 'agent_role');
  if (hasAgentRole) {
    await run(`CREATE TABLE IF NOT EXISTS agent_schedules_v2 (
      agent_id       INTEGER PRIMARY KEY REFERENCES agents(id),
      interval_minutes INTEGER NOT NULL,
      last_run_at    TEXT,
      next_run_at    TEXT NOT NULL
    )`);
    await run(`INSERT OR IGNORE INTO agent_schedules_v2 (agent_id, interval_minutes, last_run_at, next_run_at)
      SELECT a.id, s.interval_minutes, s.last_run_at, s.next_run_at
      FROM agent_schedules s
      JOIN agents a ON a.role = s.agent_role`);
    await run(`DROP TABLE agent_schedules`);
    await run(`ALTER TABLE agent_schedules_v2 RENAME TO agent_schedules`);
    console.log('[DB] Migración agent_schedules: agent_role → agent_id completada');
  }

  // Fase 8: aislamiento de agent_memory PRIVADA por venture. venture_id (0 = global/sin venture,
  // sentinel sin FK). Migración idempotente y no destructiva: añade la columna si falta (en BD
  // existentes las filas quedan a 0 = memoria histórica preservada como GLOBAL, no se borra nada),
  // y sustituye el índice UNIQUE (agent_id,key) por (agent_id,venture_id,key) para que la misma
  // key pueda existir por venture sin colisión. Ejecutable varias veces sin duplicar ni corromper.
  if (!(await columnExists('agent_memory', 'venture_id'))) {
    await run(`ALTER TABLE agent_memory ADD COLUMN venture_id INTEGER NOT NULL DEFAULT 0`);
  }
  await run(`DROP INDEX IF EXISTS idx_agent_memory_unique`);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_venture_unique ON agent_memory(agent_id, venture_id, key)`);

  // Índices de rendimiento en tablas de alto crecimiento
  await run(`CREATE INDEX IF NOT EXISTS idx_work_items_agent_status ON work_items(agent_id, status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_obj_milestones_plan ON obj_milestones(plan_id)`);

  // Columnas nuevas en agents
  if (!(await columnExists('agents', 'venture_id'))) {
    await run(`ALTER TABLE agents ADD COLUMN venture_id INTEGER REFERENCES ventures(id)`);
  }
  if (!(await columnExists('agents', 'capabilities'))) {
    await run(`ALTER TABLE agents ADD COLUMN capabilities TEXT DEFAULT '[]'`);
  }

  // Columnas nuevas en decisions
  if (!(await columnExists('decisions', 'category'))) {
    await run(`ALTER TABLE decisions ADD COLUMN category TEXT DEFAULT 'OPERATIONAL'`);
  }
  if (!(await columnExists('decisions', 'venture_id'))) {
    await run(`ALTER TABLE decisions ADD COLUMN venture_id INTEGER REFERENCES ventures(id)`);
  }

  // Columna nueva en market — vincula cada tendencia al agente que la detectó
  if (!(await columnExists('market', 'agent_id'))) {
    await run(`ALTER TABLE market ADD COLUMN agent_id INTEGER REFERENCES agents(id)`);
  }

  // Columna nueva en objectives — HOKAGE_CORE_SPECIFICATION_v1.md §3 (modelo multi-venture)
  if (!(await columnExists('objectives', 'venture_id'))) {
    await run(`ALTER TABLE objectives ADD COLUMN venture_id INTEGER REFERENCES ventures(id)`);
  }

  // Columna nueva en work_items
  if (!(await columnExists('work_items', 'venture_id'))) {
    await run(`ALTER TABLE work_items ADD COLUMN venture_id INTEGER REFERENCES ventures(id)`);
  }
  if (!(await columnExists('work_items', 'milestone_id'))) {
    await run(`ALTER TABLE work_items ADD COLUMN milestone_id INTEGER REFERENCES obj_milestones(id)`);
  }

  // Migración: work_items.business_id y agent_costs.business_id referenciaban
  // a la tabla businesses, eliminada por código muerto — con
  // PRAGMA foreign_keys=ON eso rompía CUALQUIER INSERT en ambas tablas
  // ("no such table: main.businesses"), tirando el runtime de agentes entero.
  // Se recrean sin la referencia colgante, mismo patrón que la migración de
  // agent_schedules más abajo (crear → copiar → drop → renombrar).
  const workItemsFks = await all<{ table: string }>(`PRAGMA foreign_key_list(work_items)`);
  if (workItemsFks.some((fk) => fk.table === 'businesses')) {
    await run(`CREATE TABLE work_items_v2 (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id         INTEGER NOT NULL REFERENCES agents(id),
      business_id      INTEGER,
      type             TEXT NOT NULL,
      priority         INTEGER NOT NULL DEFAULT 6,
      status           TEXT NOT NULL DEFAULT 'pending',
      context          TEXT,
      result           TEXT,
      locked_at        TEXT,
      ttl_minutes      INTEGER DEFAULT 30,
      retry_count      INTEGER DEFAULT 0,
      created_at       TEXT DEFAULT (datetime('now')),
      resolved_at      TEXT,
      venture_id       INTEGER REFERENCES ventures(id),
      milestone_id     INTEGER REFERENCES obj_milestones(id)
    )`);
    await run(`INSERT INTO work_items_v2 (id, agent_id, business_id, type, priority, status, context, result, locked_at, ttl_minutes, retry_count, created_at, resolved_at, venture_id, milestone_id)
               SELECT id, agent_id, business_id, type, priority, status, context, result, locked_at, ttl_minutes, retry_count, created_at, resolved_at, venture_id, milestone_id FROM work_items`);
    await run(`DROP TABLE work_items`);
    await run(`ALTER TABLE work_items_v2 RENAME TO work_items`);
    await run(`CREATE INDEX IF NOT EXISTS idx_work_items_agent_status ON work_items(agent_id, status)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_work_items_priority ON work_items(priority DESC, created_at ASC)`);
    await run(`CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status)`);
    console.log('[DB] Migración: work_items.business_id ya no referencia la tabla businesses (eliminada)');
  }

  const agentCostsFks = await all<{ table: string }>(`PRAGMA foreign_key_list(agent_costs)`);
  if (agentCostsFks.some((fk) => fk.table === 'businesses')) {
    await run(`CREATE TABLE agent_costs_v2 (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id        INTEGER NOT NULL REFERENCES agents(id),
      business_id     INTEGER,
      work_item_id    INTEGER REFERENCES work_items(id),
      tokens_in       INTEGER DEFAULT 0,
      tokens_out      INTEGER DEFAULT 0,
      llm_cost_usd    REAL DEFAULT 0,
      tool_cost_usd   REAL DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now'))
    )`);
    await run(`INSERT INTO agent_costs_v2 (id, agent_id, business_id, work_item_id, tokens_in, tokens_out, llm_cost_usd, tool_cost_usd, created_at)
               SELECT id, agent_id, business_id, work_item_id, tokens_in, tokens_out, llm_cost_usd, tool_cost_usd, created_at FROM agent_costs`);
    await run(`DROP TABLE agent_costs`);
    await run(`ALTER TABLE agent_costs_v2 RENAME TO agent_costs`);
    await run(`CREATE INDEX IF NOT EXISTS idx_agent_costs_agent ON agent_costs(agent_id, created_at)`);
    console.log('[DB] Migración: agent_costs.business_id ya no referencia la tabla businesses (eliminada)');
  }

  // Columna nueva en departments — el WorldLayoutEngine necesita distinguir una posición
  // calculada por el motor de una posición fijada a mano por Jorge (Hallazgo 1, auditoría
  // de arquitecto 2026-08-05). 0 = el motor puede recalcular; 1 = fijada, nunca se toca
  // salvo acción explícita del usuario.
  const hadPositionLocked = await columnExists('departments', 'position_locked');
  if (!hadPositionLocked) {
    await run(`ALTER TABLE departments ADD COLUMN position_locked INTEGER NOT NULL DEFAULT 0`);

    // Migración de una sola vez, empaquetada aquí a propósito: los departamentos no-hub
    // nacían active=1 por el DEFAULT de la columna, contradiciendo el mecanismo de niebla
    // de La Fundación (Hallazgo 2, misma auditoría) — solo Torre Hokage debe nacer activa,
    // el resto se revela mediante ese flujo. Se corrige una única vez aquí, gateado por la
    // misma condición de arriba: después de esta migración, active 0→1 solo lo cambia
    // La Fundación o una acción explícita de Jorge, nunca de nuevo un arranque del servidor.
    await run(`UPDATE departments SET active = 0 WHERE is_hub = 0`);
    console.log('[DB] Migración: departments.position_locked añadida; departamentos no-hub normalizados a active=0 (niebla de La Fundación)');
  }

  // Fuente de verdad del modelo por rol = role_definitions (Fase 1b). Aquí ya NO se sobrescribe
  // un modelo elegido por Jorge (bug anterior: se reseteaba en cada arranque) — solo se rellena
  // el de un agente que no tenga ninguno. Se lee role_definitions directamente (no vía roleService)
  // para no crear un ciclo de imports con db/init.
  const agentsSinModelo = await all<{ id: number; role: string }>(
    "SELECT id, role FROM agents WHERE model IS NULL OR model = ''"
  );
  for (const agent of agentsSinModelo) {
    const def = await get<{ model: string }>('SELECT model FROM role_definitions WHERE key = ?', [agent.role]);
    await run('UPDATE agents SET model = ? WHERE id = ?', [def?.model ?? modelForRole(agent.role), agent.id]);
  }

  // Migración one-time del Master Prompt: si algún entorno lo tenía en agent_prompts (agent_id=0),
  // se copia a system_config sin sobrescribir un valor ya presente. No-op si no existe (caso actual).
  const legacyMaster = await get<{ content: string }>(
    "SELECT content FROM agent_prompts WHERE agent_id = 0 AND prompt_type = 'master' AND active = 1 ORDER BY version DESC LIMIT 1"
  );
  if (legacyMaster?.content) {
    await run(
      `INSERT OR IGNORE INTO system_config (key, value) VALUES ('master_prompt', ?)`,
      [legacyMaster.content]
    );
    console.log('[DB] Migración: Master Prompt legacy (agent_prompts id=0) → system_config');
  }

  // Fase 4: concede memory.remember a los 6 roles tool-capable ya sembrados (los seeds usan
  // INSERT OR IGNORE y no re-actualizan). Idempotente: solo añade la tool si falta. No toca
  // operaciones/soporte (Llama, sin tool-calling). Respeta la política (memory.remember es
  // grantable). No modifica autonomía, presupuesto ni scope.
  for (const key of ['ceo', 'investigador', 'contenido', 'trafico', 'finanzas', 'hermes']) {
    const row = await get<{ tools: string }>('SELECT tools FROM role_definitions WHERE key = ?', [key]);
    if (!row) continue;
    let tools: string[];
    try { tools = JSON.parse(row.tools); } catch { continue; }
    if (Array.isArray(tools) && !tools.includes('memory.remember')) {
      tools.push('memory.remember');
      await run("UPDATE role_definitions SET tools = ?, updated_at = datetime('now') WHERE key = ?", [JSON.stringify(tools), key]);
    }
  }

  // Fase 5: replan_count en hokage_commands para el tope de replanificaciones del orquestador.
  // Aditivo — solo para una BD que ya hubiera creado la tabla sin esta columna.
  if (!(await columnExists('hokage_commands', 'replan_count'))) {
    await run(`ALTER TABLE hokage_commands ADD COLUMN replan_count INTEGER NOT NULL DEFAULT 0`);
  }

  // Fase 7: coste real atribuible por venture. agent_costs.venture_id lo puebla askAgent
  // (y callAIJson para el planner). Fuente única de coste real; no se toca agent_budgets.
  if (!(await columnExists('agent_costs', 'venture_id'))) {
    await run(`ALTER TABLE agent_costs ADD COLUMN venture_id INTEGER REFERENCES ventures(id)`);
  }
  await run(`CREATE INDEX IF NOT EXISTS idx_agent_costs_venture ON agent_costs(venture_id)`);

  // Fase 7: reserva por tarea del orquestador (importe comprometido, para liberar al terminar).
  if (!(await columnExists('hokage_tasks', 'reserved_usd'))) {
    await run(`ALTER TABLE hokage_tasks ADD COLUMN reserved_usd REAL NOT NULL DEFAULT 0`);
  }
}

// Siembra las definiciones de rol desde ROLE_SEEDS (código = semilla). INSERT OR IGNORE
// por key: solo rellena roles que falten, nunca sobrescribe una edición en BD. Idempotente.
async function seedRoleDefinitions(): Promise<void> {
  let inserted = 0;
  for (const r of ROLE_SEEDS) {
    const res = await run(
      `INSERT OR IGNORE INTO role_definitions
        (key, label, specialty, mission, base_prompt, autonomous_task, interval_minutes,
         model, fallback_model, tools, default_autonomy, monthly_budget_usd, scope, is_system, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active')`,
      [
        r.key, r.label, r.specialty, r.mission, r.base_prompt, r.autonomous_task, r.interval_minutes,
        r.model, r.fallback_model, JSON.stringify(r.tools), r.default_autonomy, r.monthly_budget_usd,
        r.scope, r.is_system ? 1 : 0,
      ]
    );
    inserted += res.changes;
  }
  if (inserted > 0) console.log(`[DB] role_definitions sembradas (${inserted} roles nuevos de ${ROLE_SEEDS.length})`);
}

async function seedDefaultVenture(): Promise<void> {
  const count = await get<{ count: number }>('SELECT COUNT(*) as count FROM ventures');
  if (count && count.count > 0) return;
  await run(
    `INSERT INTO ventures (name, type, status, goal, revenue_target_usd)
     VALUES (?, ?, ?, ?, ?)`,
    ['Minimal Designs', 'store', 'active', 'Generar 1000€/mes con productos digitales minimalistas en Etsy', 1000]
  );
  console.log('[DB] Venture inicial sembrado: Minimal Designs');
}

async function seedAutomations(): Promise<void> {
  const count = await get<{ count: number }>('SELECT COUNT(*) as count FROM automations');
  if (count && count.count > 0) return;

  const defaults = [
    {
      name: 'Tendencia → Escritor',
      trigger_event: 'trend.detected',
      action_agent_role: 'contenido',
      action_priority: 7,
      action_context_template:
        'Tendencia detectada por el Explorador — keyword: "{{keyword}}". {{description}}. Crea contenido SEO optimizado (titulo, descripcion, 5 tags). Cuando termines añade: [CONTENIDO: {{keyword}} | resumen breve] y [DECISION: Publicar contenido SEO — {{keyword}}]',
    },
    {
      name: 'Contenido → Tráfico',
      trigger_event: 'content.created',
      action_agent_role: 'trafico',
      action_priority: 6,
      action_context_template:
        'El Escritor ha creado contenido para la keyword "{{keyword}}". Resumen: {{summary}}. Analiza oportunidades SEO adicionales, hashtags y canales de distribucion para maximizar visibilidad. Propón 2-3 acciones concretas.',
    },
  ];

  for (const a of defaults) {
    await run(
      `INSERT INTO automations (name, trigger_event, action_agent_role, action_priority, action_context_template)
       VALUES (?, ?, ?, ?, ?)`,
      [a.name, a.trigger_event, a.action_agent_role, a.action_priority, a.action_context_template]
    );
  }
  console.log('[DB] Automations sembradas: Tendencia→Escritor, Contenido→Tráfico');
}

export async function initSchema(): Promise<void> {
  await run(`PRAGMA journal_mode = WAL;`);
  await run(`PRAGMA foreign_keys = ON;`);

  await run(`CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER,
    entity_type TEXT,
    entity_id INTEGER,
    title TEXT NOT NULL,
    amount REAL,
    risk_level TEXT NOT NULL DEFAULT 'low',
    status TEXT NOT NULL DEFAULT 'proposed',
    approved_by TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_id INTEGER,
    content TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'internal',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER,
    business_id INTEGER,
    platform TEXT NOT NULL,
    body TEXT,
    media_url TEXT,
    schedule_at TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS market (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'etsy',
    score INTEGER,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    user_id INTEGER,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '',
    output TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'running',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    tokens_used INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )`);

  // venture_id (Fase 8): aísla la memoria PRIVADA del agente entre ventures. 0 = global/sin
  // venture (sentinel, no es un venture real → sin FK). El índice UNIQUE es (agent_id,
  // venture_id, key), de modo que la misma key existe por venture sin colisionar.
  await run(`CREATE TABLE IF NOT EXISTS agent_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    venture_id INTEGER NOT NULL DEFAULT 0,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS agent_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    prompt_type TEXT NOT NULL DEFAULT 'base',
    content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS agent_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    decision_id INTEGER,
    feedback_type TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS agent_schedules (
    agent_id INTEGER PRIMARY KEY REFERENCES agents(id),
    interval_minutes INTEGER NOT NULL,
    last_run_at TEXT,
    next_run_at TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS work_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id         INTEGER NOT NULL REFERENCES agents(id),
    business_id      INTEGER REFERENCES businesses(id),
    type             TEXT NOT NULL,
    priority         INTEGER NOT NULL DEFAULT 6,
    status           TEXT NOT NULL DEFAULT 'pending',
    context          TEXT,
    result           TEXT,
    locked_at        TEXT,
    ttl_minutes      INTEGER DEFAULT 30,
    retry_count      INTEGER DEFAULT 0,
    created_at       TEXT DEFAULT (datetime('now')),
    resolved_at      TEXT
  )`);

  await run(`CREATE INDEX IF NOT EXISTS idx_work_items_agent_status ON work_items(agent_id, status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_work_items_priority ON work_items(priority DESC, created_at ASC)`);

  await run(`CREATE TABLE IF NOT EXISTS agent_costs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id        INTEGER NOT NULL REFERENCES agents(id),
    business_id     INTEGER REFERENCES businesses(id),
    work_item_id    INTEGER REFERENCES work_items(id),
    tokens_in       INTEGER DEFAULT 0,
    tokens_out      INTEGER DEFAULT 0,
    llm_cost_usd    REAL DEFAULT 0,
    tool_cost_usd   REAL DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now'))
  )`);

  await run(`CREATE INDEX IF NOT EXISTS idx_agent_costs_agent ON agent_costs(agent_id, created_at)`);

  await run(`CREATE TABLE IF NOT EXISTS agent_budgets (
    agent_id          INTEGER PRIMARY KEY REFERENCES agents(id),
    monthly_limit_usd REAL NOT NULL DEFAULT 5.0,
    current_month_usd REAL NOT NULL DEFAULT 0,
    reset_date        TEXT NOT NULL DEFAULT (strftime('%Y-%m-01', 'now', '+1 month')),
    status            TEXT NOT NULL DEFAULT 'active'
  )`);

  await run(`CREATE TABLE IF NOT EXISTS tool_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_id     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'completed',
    ok          INTEGER NOT NULL DEFAULT 1,
    error       TEXT,
    cost        REAL DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  )`);

  // ═══════════ VENTURES — contenedor genérico de actividad económica ═══════════
  await run(`CREATE TABLE IF NOT EXISTS ventures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'store',
    status TEXT NOT NULL DEFAULT 'idea',
    goal TEXT,
    budget_allocated_usd REAL DEFAULT 0,
    budget_spent_usd REAL DEFAULT 0,
    revenue_target_usd REAL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // ═══════════ ASSETS — cualquier activo de valor creado o poseído ═══════════
  await run(`CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venture_id INTEGER REFERENCES ventures(id),
    type TEXT NOT NULL DEFAULT 'content',
    name TEXT NOT NULL,
    description TEXT,
    value_usd REAL,
    status TEXT NOT NULL DEFAULT 'draft',
    platform TEXT,
    external_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // ═══════════ PROJECTS — iniciativa con objetivo y plazo dentro de un Venture ═════
  await run(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venture_id INTEGER REFERENCES ventures(id),
    name TEXT NOT NULL,
    goal TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    deadline TEXT,
    budget_usd REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // ═══════════ REVENUE_STREAMS — cómo genera dinero un Venture ══════════════════
  // ═══════════ AUTOMATIONS — pipeline como dato, no como código ════════════════
  await run(`CREATE TABLE IF NOT EXISTS automations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venture_id INTEGER REFERENCES ventures(id),
    name TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    trigger_conditions TEXT NOT NULL DEFAULT '{}',
    action_type TEXT NOT NULL DEFAULT 'create_work_item',
    action_agent_role TEXT,
    action_priority INTEGER DEFAULT 6,
    action_context_template TEXT,
    requires_approval INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE INDEX IF NOT EXISTS idx_automations_trigger ON automations(trigger_event, active)`);

  await run(`CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    desc TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    glyph TEXT NOT NULL DEFAULT 'default',
    color TEXT NOT NULL DEFAULT '#4fd1c5',
    pos_x REAL NOT NULL DEFAULT 1000,
    pos_y REAL NOT NULL DEFAULT 1000,
    is_hub INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // ═══════════ GOAL SYSTEM ═══════════════════════════════════════════════════
  await run(`CREATE TABLE IF NOT EXISTS objectives (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT NOT NULL,
    goal             TEXT,
    success_criteria TEXT,
    deadline         TEXT,
    priority         INTEGER DEFAULT 5,
    status           TEXT NOT NULL DEFAULT 'planning',
    created_at       TEXT DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS obj_plans (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    objective_id    INTEGER NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
    phases          TEXT NOT NULL DEFAULT '[]',
    estimated_weeks INTEGER,
    confidence      INTEGER DEFAULT 70,
    status          TEXT NOT NULL DEFAULT 'proposed',
    created_at      TEXT DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS obj_milestones (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id              INTEGER NOT NULL REFERENCES obj_plans(id) ON DELETE CASCADE,
    objective_id         INTEGER NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
    phase_index          INTEGER NOT NULL DEFAULT 0,
    title                TEXT NOT NULL,
    description          TEXT,
    assigned_agent_role  TEXT,
    status               TEXT NOT NULL DEFAULT 'pending',
    due_date             TEXT,
    completed_at         TEXT,
    created_at           TEXT DEFAULT (datetime('now'))
  )`);

  // ═══════════ HERMES — ejecución de comandos, siempre pendiente de aprobación ═══
  await run(`CREATE TABLE IF NOT EXISTS exec_runs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    decision_id           INTEGER REFERENCES decisions(id),
    requested_by_agent_id INTEGER REFERENCES agents(id),
    command               TEXT NOT NULL,
    cwd                   TEXT,
    status                TEXT NOT NULL DEFAULT 'pending',
    exit_code             INTEGER,
    stdout                TEXT,
    stderr                TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    executed_at           TEXT
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_exec_runs_created ON exec_runs(created_at DESC)`);

  // ═══════════ EVENT_LOG — persistencia del Event Bus (Fase 2, UI Implementation
  // Plan.md). Log de auditoría en paralelo: HokageBus sigue sin persistir nada por
  // sí mismo (ADR-003) — esta tabla solo recibe lo que ya emite publish() vía un
  // suscriptor aparte en config/eventBus.ts. ═══════════════════════════════════
  await run(`CREATE TABLE IF NOT EXISTS event_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    from_actor TEXT NOT NULL,
    to_actor   TEXT,
    payload    TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log(created_at DESC)`);

  // ═══════════ USER_LAYOUT — persistencia del motor de paneles (Fase 5, UI
  // Implementation Plan.md). Fila única (id=1): sistema single-owner, sin concepto
  // de usuario/sesión múltiple — mismo criterio que ADMIN_TOKEN compartido. Solo
  // persiste qué overlay/sala estaba abierto, no tabs internos ni chat (ninguno de
  // los dos está en el alcance autorizado de esta fase). ═══════════════════════
  await run(`CREATE TABLE IF NOT EXISTS user_layout (
    id                 INTEGER PRIMARY KEY,
    screen             TEXT NOT NULL DEFAULT 'map',
    active_building_key TEXT,
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // ═══════════ SYSTEM_CONFIG — configuración de sistema clave-valor (Fase 3). Independiente
  // de agents: el Master Prompt vivía en agent_prompts con agent_id=0, lo que violaba la FK
  // agent_prompts→agents(id). Aquí no hay FK artificial. Ver systemConfigService.ts. ═════════
  await run(`CREATE TABLE IF NOT EXISTS system_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // ═══════════ MEMORY_ENTRIES — memoria de NEGOCIO (Fase 4, CORE SPEC §6). Log append-only,
  // distinto de agent_memory (privada clave-valor por agente). Compartida por venture:
  // venture_id NULL = memoria de instalación (global). Es DATO, nunca instrucción. FTS5 se
  // difiere hasta que exista un panel de búsqueda que lo consuma. Ver memoryService.ts. ═══════
  // source_agent_id ON DELETE SET NULL: la memoria de negocio SOBREVIVE al borrado de su agente
  // autor (§6: es memoria del negocio, no del agente; source_agent_id es nullable = "lo escribió
  // el sistema o un agente ya retirado"). Sin esto, borrar un agente fallaría por la FK.
  await run(`CREATE TABLE IF NOT EXISTS memory_entries (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    venture_id          INTEGER REFERENCES ventures(id),
    category            TEXT NOT NULL,
    title               TEXT NOT NULL,
    content             TEXT NOT NULL,
    source_agent_id     INTEGER REFERENCES agents(id) ON DELETE SET NULL,
    related_entity_type TEXT,
    related_entity_id   INTEGER,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_memory_entries_venture ON memory_entries(venture_id, created_at DESC)`);

  // ═══════════ ROLE_DEFINITIONS — Registry de roles como dato (Fase 1, UI
  // Implementation Plan.md). Fuente de verdad en runtime de qué es un especialista.
  // key = la clave de dominio estable ya usada en agents.role / automations /
  // obj_milestones (L·1). Los mapas TS (agentModels.ts / AUTONOMOUS_TASKS) pasan
  // a ser semilla + fallback — se siembra aquí, no se lee todavía (eso es 1b). ═══
  await run(`CREATE TABLE IF NOT EXISTS role_definitions (
    key                TEXT PRIMARY KEY,
    label              TEXT NOT NULL,
    specialty          TEXT,
    mission            TEXT,
    base_prompt        TEXT,
    autonomous_task    TEXT,
    interval_minutes   INTEGER,
    model              TEXT NOT NULL,
    fallback_model     TEXT,
    tools              TEXT NOT NULL DEFAULT '[]',
    default_autonomy   INTEGER NOT NULL DEFAULT 1,
    monthly_budget_usd REAL NOT NULL DEFAULT 5.0,
    scope              TEXT NOT NULL DEFAULT 'business',
    is_system          INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'active',
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // ═══════════ HOKAGE ORCHESTRATOR — Fase 5. Ledger propio del orquestador: una orden
  // se descompone en tareas con fases y cada tarea se despacha como un work_item que el
  // agentRuntime ya sabe ejecutar. No duplica work_items/decisions/roles — es la capa de
  // coordinación que faltaba. Ver services/hokageOrchestrator.ts. ════════════════════════
  await run(`CREATE TABLE IF NOT EXISTS hokage_commands (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    venture_id      INTEGER REFERENCES ventures(id),
    text            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'planning',
    plan_summary    TEXT,
    result_summary  TEXT,
    idempotency_key TEXT,
    replan_count    INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_hokage_commands_status ON hokage_commands(status, created_at DESC)`);
  // Idempotencia a prueba de carreras: dos POST concurrentes con la misma clave no pueden
  // crear dos comandos. SQLite trata cada NULL como distinto → las órdenes sin clave no chocan.
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hokage_commands_idem ON hokage_commands(idempotency_key)`);

  await run(`CREATE TABLE IF NOT EXISTS hokage_tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id   INTEGER NOT NULL REFERENCES hokage_commands(id) ON DELETE CASCADE,
    phase        INTEGER NOT NULL DEFAULT 0,
    role         TEXT NOT NULL,
    agent_id     INTEGER REFERENCES agents(id),
    title        TEXT NOT NULL,
    prompt       TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    work_item_id INTEGER REFERENCES work_items(id),
    result       TEXT,
    error        TEXT,
    reserved_usd REAL NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_hokage_tasks_command ON hokage_tasks(command_id, phase)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_hokage_tasks_workitem ON hokage_tasks(work_item_id)`);

  const deptCount = await get<{ count: number }>('SELECT COUNT(*) as count FROM departments');
  if (!deptCount || deptCount.count === 0) await seedDepartments();

  // role_definitions se siembra ANTES de runMigrations: el sync de agents.model dentro de
  // runMigrations ahora lee de esta tabla (Fase 1b).
  await seedRoleDefinitions();
  await runMigrations();
  await seedDefaultVenture();
  await seedAutomations();
  await seedHermesAgent();
}

async function seedDepartments(): Promise<void> {
  // Posiciones precalculadas del pentágono (WORLD_CENTER={1000,1000}, RADIO=400)
  const seed = [
    { key: 'hokage', name: 'Torre Hokage', desc: 'Centro de mando', role: 'ceo',          glyph: 'tower',    color: '#e8432d', pos_x: 1000,   pos_y: 1000,   is_hub: 1, sort_order: 0 },
    { key: 'lab',    name: 'Laboratorio',  desc: 'Investigación',   role: 'investigador',  glyph: 'lab',      color: '#4fd1c5', pos_x: 1000,   pos_y: 600,    is_hub: 0, sort_order: 1 },
    { key: 'estudio',name: 'Estudio',      desc: 'Fábrica contenido',role: 'contenido',    glyph: 'studio',   color: '#c77dff', pos_x: 1380.4, pos_y: 876.4,  is_hub: 0, sort_order: 2 },
    { key: 'tienda', name: 'Tienda',       desc: 'Sala de ventas',  role: 'trafico',       glyph: 'shop',     color: '#f0a93b', pos_x: 1235.1, pos_y: 1323.6, is_hub: 0, sort_order: 3 },
    { key: 'banco',  name: 'Banco',        desc: 'Sala financiera', role: 'finanzas',      glyph: 'bank',     color: '#3ecf6a', pos_x: 764.9,  pos_y: 1323.6, is_hub: 0, sort_order: 4 },
    { key: 'taller', name: 'Taller',       desc: 'Sala técnica',    role: 'operaciones',   glyph: 'workshop', color: '#4f8cff', pos_x: 619.6,  pos_y: 876.4,  is_hub: 0, sort_order: 5 },
  ];
  for (const d of seed) {
    // Solo Torre Hokage (is_hub) nace activa — el resto se revela vía La Fundación
    // (Hallazgo 2, auditoría de arquitecto 2026-08-05). Mismo campo que ya usa la
    // reactivación de Hermes (§9.1).
    await run(
      `INSERT INTO departments (key,name,desc,role,glyph,color,pos_x,pos_y,is_hub,sort_order,active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [d.key, d.name, d.desc, d.role, d.glyph, d.color, d.pos_x, d.pos_y, d.is_hub, d.sort_order, d.is_hub]
    );
  }
  console.log('[DB] Departamentos sembrados correctamente');
}

async function seedHermesAgent(): Promise<void> {
  const existing = await get<{ id: number }>(`SELECT id FROM agents WHERE role = 'hermes'`);
  if (existing) return;

  const agentResult = await run(
    `INSERT INTO agents (name, role, status, model) VALUES (?, ?, ?, ?)`,
    ['Hermes', 'hermes', 'idle', modelForRole('hermes')]
  );
  const agentId = agentResult.lastID;

  await run(
    `INSERT INTO agent_prompts (agent_id, prompt_type, content, version, active) VALUES (?, 'base', ?, 1, 1)`,
    [agentId, `Eres Hermes, el agente de sistema de HOKAGE OS. Tu única función es ejecutar comandos de terminal en el Mac de Jorge cuando él o otro agente te lo pida, usando la herramienta system.exec.

REGLAS ABSOLUTAS:
- Nunca ejecutas nada directamente. Cada comando que propones queda pendiente de aprobación de Jorge — así se lo explicas si te preguntan.
- Antes de proponer un comando, explica en una frase qué hace y por qué es necesario.
- Nunca propongas comandos destructivos (rm -rf, dd, mkfs, formatear disco) salvo que Jorge lo pida explícitamente y confirme el riesgo.
- Si no tienes claro qué comando ejecutar exactamente, pregunta — no adivines.`]
  );

  const deptExists = await get<{ id: number }>(`SELECT id FROM departments WHERE key = 'hermes'`);
  if (!deptExists) {
    // active=0: no es hub, nace en niebla como el resto — la reactivación de Hermes
    // (§9.1) es quien la pone a 1, igual que ya hace con agents.status.
    await run(
      `INSERT INTO departments (key,name,desc,role,glyph,color,pos_x,pos_y,is_hub,sort_order,active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ['hermes', 'Sala de Máquinas', 'Ejecución de sistema', 'hermes', 'terminal', '#8b5cf6', 1000, 1400, 0, 6, 0]
    );
  }

  console.log('[DB] Agente Hermes sembrado correctamente');
}
