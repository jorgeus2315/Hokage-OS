import { get } from '../db/init.js';
import bus from '../config/eventBus.js';
import type { Decision } from '../types/index.js';
import { getRoleDefinition } from './roleService.js';
import { approveDecision } from './decisionService.js';
import { resolveDecisionApproval } from './decisionResolvers.js';
import { autonomyAutoApproves } from '../config/rolePolicy.js';

// ═══════════════════════════════════════════════════════════════════════════
// agentAutonomy — autonomía efectiva de un agente + auto-aprobación (Fase 2).
// ═══════════════════════════════════════════════════════════════════════════
//
// Autonomía efectiva = default_autonomy del rol del agente (role_definitions). Un
// override por-agente más restrictivo es trabajo futuro (Especificación §5) — no se
// construye aquí. Fallback 1 (Proponente) si el rol no existe: mismo nivel que el
// comportamiento histórico, nunca deja a un agente sin poder proponer.

export async function autonomyForAgent(agentId: number | null | undefined): Promise<number> {
  if (!agentId) return 1;
  const agent = await get<{ role: string }>('SELECT role FROM agents WHERE id = ?', [agentId]);
  if (!agent) return 1;
  const def = await getRoleDefinition(agent.role);
  return def?.default_autonomy ?? 1;
}

// Tras crear una Decision de forma autónoma, la auto-aprueba si la autonomía lo permite.
// NO es un segundo mecanismo de aprobación: reutiliza approveDecision + resolveDecisionApproval
// (el mismo camino que dispara Jorge al aprobar) y publica el mismo evento decision.approved,
// de modo que stage7 del runtime cierra el loop igual que con una aprobación humana.
// approved_by = 'auto:autonomy' para dejar traza de que no fue humana.
export async function maybeAutoApprove(decision: Decision): Promise<boolean> {
  const autonomy = await autonomyForAgent(decision.agent_id);
  if (!autonomyAutoApproves(autonomy, decision)) return false;

  const approved = await approveDecision(decision.id, 'auto:autonomy');
  await resolveDecisionApproval(approved);
  bus.publish({ type: 'decision.approved', from: 'auto:autonomy', payload: { decisionId: decision.id, decisionTitle: decision.title } });
  console.log(`[AUTONOMY] Decision ${decision.id} auto-aprobada (Nivel ${autonomy}): ${decision.title}`);
  return true;
}
