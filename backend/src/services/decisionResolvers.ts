import type { Decision } from '../types/index.js';
import { markObjectiveAchieved } from './objectiveService.js';
import { runApprovedExec, rejectExec } from './hermesService.js';
import { createMemoryEntry } from './memoryService.js';

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
}

export async function resolveDecisionRejection(decision: Decision): Promise<void> {
  const resolver = decision.entity_type ? resolvers[decision.entity_type] : undefined;
  await resolver?.onReject?.(decision);
  await captureDecisionMemory(decision, 'rechazada');
}
