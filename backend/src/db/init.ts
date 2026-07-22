import * as sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../../data/hokage-os.db');

export const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) console.error('[DB] Error al abrir SQLite:', err.message);
  else console.log('[DB] Conexión establecida con SQLite');
});

export function run(sql: string, params: any[] = []): Promise<{ lastID: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: (this as any).lastID });
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

  await run(`CREATE TABLE IF NOT EXISTS tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'general',
    config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    api_key_ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS agent_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    tool_id INTEGER NOT NULL,
    permission_level TEXT NOT NULL DEFAULT 'read',
    max_daily_calls INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS agent_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    stats TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general',
    xp_reward INTEGER NOT NULL DEFAULT 0,
    condition_type TEXT NOT NULL,
    condition_value TEXT NOT NULL DEFAULT '{}',
    icon TEXT,
    unlocked_by INTEGER,
    unlocked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}
