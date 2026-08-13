import type { Decision } from '../types/index.js';
import { markObjectiveAchieved } from './objectiveService.js';
import { runApprovedExec, rejectExec } from './hermesService.js';
import { createMemoryEntry } from './memoryService.js';
import { recordAudit } from './auditService.js';
import { createVentureFromProposal, rejectProposal } from './opportunityPipeline.js';
import { activateVenture } from './ventureActivation.js';

// Punto único donde vive "aprobar/rechazar esta Decision dispara esta acción real".
// Añadir un nuevo entity_type es añadir una entrada aquí, no un if más en las rutas HTTP.
export interface DecisionResolver {
  onApprove?: (decision: Decision) => Promise<void> | void;
  onReject?: (decision: Decision) => Promise<void> | void;
}

const resolvers: Record<string, DecisionResolver> = {
  objective: {
    onApprove: async (decision) => {
      if (decision.entity_id != null) await markObjectiveAchieved(decision.entity_id);
    },
  },
  system_exec: {
    onApprove: (decision) => {
      if (decision.entity_id == null) return;
      // Fire-and-forget: el comando puede tardar hasta 30s, no bloquea la respuesta HTTP.
      runApprovedExec(decision.entity_id).catch((err) => console.error('[HERMES] Error ejecutando comando:', err.message));
    },
    onReject: async (decision) => {
      if (decision.entity_id != null) await rejectExec(decision.entity_id);
    },
  },
  // Fase 11: el ÚNICO camino a crear una venture. Se dispara SOLO por aprobación HUMANA
  // (autonomyAutoApproves excluye cualquier entity_type → nunca auto-aprobada). Idempotente.
  business_proposal: {
    onApprove: async (decision) => {
      if (decision.entity_id == null) return;
      const ventureId = await createVentureFromProposal(decision.entity_id); // creación: se espera
      // Fase 12: la aprobación humana auto-activa (decisión 7.2). Fire-and-forget como system_exec:
      // el arranque dispara trabajo del orquestador F5 y no debe bloquear la respuesta HTTP. Fallos
      // quedan auditados dentro de activateVenture y son reintentables por POST /ventures/:id/activate.
      if (ventureId != null) activateVenture(ventureId, 'approval').catch((err) => console.error('[F12] Activación de venture falló:', err.message));
    },
    onReject: async (decision) => {
      if (decision.entity_id != null) await rejectProposal(decision.entity_id);
    },
  },
};

// Captura automática de memoria de negocio (Fase 4, CORE SPEC §6): toda decisión resuelta
// deja rastro en memory_entries. Punto único (estas dos funciones pasan por TODA decisión,
// aprobada por Jorge o auto-aprobada por autonomía). category='decision'; scope = venture de
// la decisión. Es DATO — no altera nada del sistema.
async function captureDecisionMemory(decision: Decision, verbo: 'aprobada' | 'rechazada'): Promise<void> {
  await createMemoryEntry({
    ventureId: decision.venture_id,
    category: 'decision',
    title: `Decisión ${verbo}: ${decision.title}`,
    content: decision.reasoning || decision.description || decision.title,
    sourceAgentId: decision.agent_id,
    relatedEntityType: 'decision',
    relatedEntityId: decision.id,
  }).catch((err) => console.error('[MEMORY] Error capturando decisión:', err.message));
}

export async function resolveDecisionApproval(decision: Decision): Promise<void> {
  const resolver = decision.entity_type ? resolvers[decision.entity_type] : undefined;
  await resolver?.onApprove?.(decision);
  await captureDecisionMemory(decision, 'aprobada');
  // Auditoría (Fase 9): distingue aprobación humana de auto-aprobación L2 por approved_by.
  await recordAudit({
    type: decision.approved_by === 'auto:autonomy' ? 'decision.auto_approved' : 'decision.approved',
    ventureId: decision.venture_id, agentId: decision.agent_id, actor: decision.approved_by,
    meta: { decisionId: decision.id, category: decision.category },
  });
}

export async function resolveDecisionRejection(decision: Decision): Promise<void> {
  const resolver = decision.entity_type ? resolvers[decision.entity_type] : undefined;
  await resolver?.onReject?.(decision);
  await captureDecisionMemory(decision, 'rechazada');
  await recordAudit({
    type: 'decision.rejected', ventureId: decision.venture_id, agentId: decision.agent_id, actor: decision.approved_by,
    meta: { decisionId: decision.id, category: decision.category },
  });
}
