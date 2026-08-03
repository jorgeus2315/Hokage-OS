import * as sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { modelForRole } from '../config/agentModels.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../../data/hokage-os.db');

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

  // UNIQUE index en agent_memory para evitar duplicados por clave
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_unique ON agent_memory(agent_id, key)`);

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

  // Columna nueva en work_items
  if (!(await columnExists('work_items', 'venture_id'))) {
    await run(`ALTER TABLE work_items ADD COLUMN venture_id INTEGER REFERENCES ventures(id)`);
  }
  if (!(await columnExists('work_items', 'milestone_id'))) {
    await run(`ALTER TABLE work_items ADD COLUMN milestone_id INTEGER REFERENCES obj_milestones(id)`);
  }

  // Mantener sincronizado el modelo óptimo de cada agente con la fuente de verdad (agentModels.ts)
  const agents = await all<{ id: number; role: string; model: string | null }>('SELECT id, role, model FROM agents');
  for (const agent of agents) {
    const correctModel = modelForRole(agent.role);
    if (agent.model !== correctModel) {
      await run('UPDATE agents SET model = ? WHERE id = ?', [correctModel, agent.id]);
    }
  }
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

export function addEvent(
  type: string,
  source: string,
  payload: Record<string, any>,
  entityId?: number,
  correlationId?: string
): Promise<{ lastID: number }> {
  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date().toISOString();
  return run(
    `INSERT INTO events (id, type, source, entity_id, payload, timestamp, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      type,
      source,
      entityId ?? null,
      JSON.stringify(payload),
      timestamp,
      correlationId ?? null,
    ]
  );
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

  await run(`CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'etsy',
    category TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    target_revenue REAL DEFAULT 0,
    current_revenue REAL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    price REAL NOT NULL,
    stock INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  await run(`CREATE TABLE IF NOT EXISTS finance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER,
    direction TEXT NOT NULL DEFAULT 'in',
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    source TEXT,
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

  await run(`CREATE TABLE IF NOT EXISTS agent_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
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

  await run(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    entity_id INTEGER,
    payload TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    correlation_id TEXT
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
  await run(`CREATE TABLE IF NOT EXISTS revenue_streams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venture_id INTEGER REFERENCES ventures(id),
    asset_id INTEGER REFERENCES assets(id),
    type TEXT NOT NULL DEFAULT 'one_time',
    platform TEXT NOT NULL DEFAULT 'etsy',
    status TEXT NOT NULL DEFAULT 'active',
    mrr_usd REAL DEFAULT 0,
    total_earned_usd REAL DEFAULT 0,
    last_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

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

  const deptCount = await get<{ count: number }>('SELECT COUNT(*) as count FROM departments');
  if (!deptCount || deptCount.count === 0) await seedDepartments();

  await runMigrations();
  await seedDefaultVenture();
  await seedAutomations();
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
    await run(
      `INSERT INTO departments (key,name,desc,role,glyph,color,pos_x,pos_y,is_hub,sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [d.key, d.name, d.desc, d.role, d.glyph, d.color, d.pos_x, d.pos_y, d.is_hub, d.sort_order]
    );
  }
  console.log('[DB] Departamentos sembrados correctamente');
}
