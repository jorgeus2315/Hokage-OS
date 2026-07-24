// ═══════════════════════════════════════════════════════
// MODELOS ÓPTIMOS POR AGENTE — fuente única de verdad
// ═══════════════════════════════════════════════════════

// IDs verificados contra el catálogo en vivo de OpenRouter (openrouter.ai/api/v1/models).
// Nota: OpenRouter usa "claude-sonnet-4.5" / "claude-haiku-4.5" (con punto), no con guion.
export const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

export const AGENT_MODELS: Record<string, string> = {
  ceo: 'anthropic/claude-sonnet-4.5',
  investigador: 'google/gemini-2.5-flash',
  contenido: 'anthropic/claude-haiku-4.5',
  trafico: 'google/gemini-2.5-flash',
  finanzas: 'google/gemini-2.5-flash',
  operaciones: 'meta-llama/llama-3.1-8b-instruct',
  soporte: 'meta-llama/llama-3.1-8b-instruct',
};

export function modelForRole(role: string): string {
  return AGENT_MODELS[role] || DEFAULT_MODEL;
}
