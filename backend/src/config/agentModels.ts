// ═══════════════════════════════════════════════════════
// MODELOS ÓPTIMOS POR AGENTE — fuente única de verdad
// ═══════════════════════════════════════════════════════

// IDs verificados contra el catálogo en vivo de OpenRouter (openrouter.ai/api/v1/models).
// Nota: OpenRouter usa "claude-sonnet-4.5" / "claude-haiku-4.5" (con punto), no con guion.
export const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

export const AGENT_MODELS: Record<string, string> = {
  ceo:          'anthropic/claude-sonnet-4.5',
  investigador: 'google/gemini-2.5-flash',
  contenido:    'anthropic/claude-haiku-4.5',
  trafico:      'google/gemini-2.5-flash',
  finanzas:     'google/gemini-2.5-flash',
  operaciones:  'meta-llama/llama-3.1-8b-instruct',
  soporte:      'meta-llama/llama-3.1-8b-instruct',
};

// Modelos con soporte real de function calling vía OpenRouter.
// Llama 3.1 8B no soporta tools de forma fiable → se excluye.
// Añadir aquí cuando se confirme soporte en un nuevo modelo.
const TOOL_CAPABLE_MODELS = new Set([
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',
  'google/gemini-2.5-flash',
  'google/gemini-flash-1.5',
]);

export function modelForRole(role: string): string {
  return AGENT_MODELS[role] || DEFAULT_MODEL;
}

// Determina si el modelo soporta function calling.
// Usar en aiService.ts antes de incluir el campo `tools` en la petición a OpenRouter.
export function modelSupportsTools(model: string): boolean {
  return TOOL_CAPABLE_MODELS.has(model);
}
