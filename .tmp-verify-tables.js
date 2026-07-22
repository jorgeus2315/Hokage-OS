const Database = require('sqlite');
const path = require('path');

(async () => {
  const dbPath = path.resolve(__dirname, 'backend/data/hokage-os.db');
  const db = await Database.open(dbPath);

  const tables = [
    'agent_runs',
    'agent_memory',
    'agent_prompts',
    'agent_feedback',
    'tools',
    'agent_tools',
    'agent_progress',
    'achievements',
  ];

  const results = [];
  for (const table of tables) {
    try {
      const row = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table]);
      results.push({ table, exists: !!row });
    } catch (err) {
      results.push({ table, exists: false, error: String(err) });
    }
  }

  console.log(JSON.stringify({ ok: true, tables: results }, null, 2));
  await db.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
