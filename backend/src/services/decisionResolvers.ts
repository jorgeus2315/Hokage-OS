import type { Decision } from '../types/index.js';
import { markObjectiveAchieved } from './objectiveService.js';
import { runApprovedExec, rejectExec } from './hermesService.js';

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

export async function resolveDecisionApproval(decision: Decision): Promise<void> {
  const resolver = decision.entity_type ? resolvers[decision.entity_type] : undefined;
  await resolver?.onApprove?.(decision);
}

export async function resolveDecisionRejection(decision: Decision): Promise<void> {
  const resolver = decision.entity_type ? resolvers[decision.entity_type] : undefined;
  await resolver?.onReject?.(decision);
}
