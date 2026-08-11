import { get, run } from '../db/init.js';

// ═══════════════════════════════════════════════════════════════════════════
// systemConfigService — configuración de sistema clave-valor, independiente de agents.
// ═══════════════════════════════════════════════════════════════════════════
//
// Reemplaza el hack de guardar el Master Prompt en agent_prompts con agent_id=0, que
// violaba la FK agent_prompts→agents(id) (no existe ni debe existir un agente id=0).
// Aquí no hay ninguna FK artificial: es una tabla clave-valor de instalación única.

export const MASTER_PROMPT_KEY = 'master_prompt';

export async function getConfig(key: string): Promise<string | null> {
  const row = await get<{ value: string }>('SELECT value FROM system_config WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value]
  );
}
