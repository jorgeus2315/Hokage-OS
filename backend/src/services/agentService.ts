import { run, get, all } from '../db/init.js';
import { modelForRole } from '../config/agentModels.js';
import { getRoleDefinition } from './roleService.js';
import type { Agent, AgentCreatePayload } from '../types/index.js';

const SELECT = 'SELECT id, name, role, status, model, created_at FROM agents';

export async function listAgents(): Promise<Agent[]> {
  return all<Agent>(`${SELECT} ORDER BY id ASC`);
}

// B.1 (Fase B — Hermes como Kernel): agentes de NEGOCIO. Excluye los roles de sistema
// (Hermes es scope='system' en role_definitions, la fuente canónica de la distinción — no se
// duplica un flag en `agents`). listAgents()/getAgent() se conservan para resolución interna
// por id/rol. Un rol legacy sin role_definition cuenta como negocio (NOT IN el conjunto system).
export async function listBusinessAgents(): Promise<Agent[]> {
  return all<Agent>(
    `${SELECT} WHERE role NOT IN (SELECT key FROM role_definitions WHERE scope = 'system') ORDER BY id ASC`
  );
}

export async function getAgent(id: number): Promise<Agent | undefined> {
  return get<Agent>(`${SELECT} WHERE id = ?`, [id]);
}

// Crea un agente (instancia). Si su rol tiene un role_definition (Fase 1d), lo instancia
// desde él: modelo, prompt base y presupuesto por defecto. Si no lo tiene, comportamiento
// mínimo de siempre (compatibilidad hacia atrás — un rol libre sigue creando un agente).
export async function createAgent(payload: AgentCreatePayload): Promise<Agent> {
  const def = await getRoleDefinition(payload.role);
  const model = payload.model || def?.model || modelForRole(payload.role);
  const capabilities = payload.capabilities ?? '[]';
  const agent_type = payload.agent_type ?? 'permanent';
  const availability = payload.availability ?? 'available';
  const result = await run(
    'INSERT INTO agents (name, role, status, model, venture_id, capabilities, agent_type, availability) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [payload.name, payload.role, 'idle', model, payload.venture_id ?? null, capabilities, agent_type, availability]
  );
  const id = Number(result.lastID);

  if (def) {
    if (def.base_prompt) {
      await run(
        `INSERT INTO agent_prompts (agent_id, prompt_type, content, version, active) VALUES (?, 'base', ?, 1, 1)`,
        [id, def.base_prompt]
      );
    }
    await run(
      `INSERT OR IGNORE INTO agent_budgets (agent_id, monthly_limit_usd, current_month_usd) VALUES (?, ?, 0)`,
      [id, def.monthly_budget_usd]
    );
  }

  const row = await getAgent(id);
  if (!row) throw new Error('Agent not found after insert');
  return row;
}

export async function updateAgent(id: number, payload: Partial<AgentCreatePayload> & { status?: string }): Promise<Agent> {
  const current = await getAgent(id);
  if (!current) throw new Error('Agent not found');

  const name = payload.name ?? current.name;
  const role = payload.role ?? current.role;
  const status = payload.status ?? current.status;
  const model = payload.model ?? current.model ?? modelForRole(role);

  await run('UPDATE agents SET name = ?, role = ?, status = ?, model = ? WHERE id = ?', [name, role, status, model, id]);
  const row = await getAgent(id);
  if (!row) throw new Error('Agent not found after update');
  return row;
}

export async function deleteAgent(id: number): Promise<void> {
  await run('DELETE FROM agents WHERE id = ?', [id]);
}
