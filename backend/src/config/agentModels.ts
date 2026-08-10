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
  hermes:       'anthropic/claude-haiku-4.5',
};

// Modelos con soporte real de function calling vía OpenRouter.
// Llama 3.1 8B no soporta tools de forma fiable → se excluye.
const TOOL_CAPABLE_MODELS = new Set([
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-haiku-4.5',
  'google/gemini-2.5-flash',
  'google/gemini-flash-1.5',
]);

// Tools disponibles por rol. Solo se incluyen en la llamada a OpenRouter
// si el modelo del agente soporta function calling.
// memory.write (Fase 3) y decision.create (Fase 4) solo van a roles tool-capable (ver
// TOOL_CAPABLE_MODELS arriba). operaciones/soporte, en Llama 3.1 8B, se quedan permanentemente
// en [MEMORIA: k=v] / [DECISION: ...] — no es una omisión temporal, es la realidad del modelo
// (ver HOKAGE_CORE_SPECIFICATION_v1.md §2).
export const AGENT_TOOLS: Record<string, string[]> = {
  ceo:          ['web.browser', 'memory.write', 'decision.create'],
  investigador: ['google.trends', 'web.browser', 'trend.report', 'memory.write', 'decision.create'],
  contenido:    ['web.browser', 'content.create', 'memory.write', 'decision.create'],
  trafico:      ['google.trends', 'web.browser', 'memory.write', 'decision.create'],
  finanzas:     ['memory.write', 'decision.create'],
  operaciones:  [],
  soporte:      [],
  hermes:       ['system.exec', 'memory.write', 'decision.create'],
};

export function modelForRole(role: string): string {
  return AGENT_MODELS[role] || DEFAULT_MODEL;
}

export function modelSupportsTools(model: string): boolean {
  return TOOL_CAPABLE_MODELS.has(model);
}

export function toolsForRole(role: string): string[] {
  return AGENT_TOOLS[role] || [];
}
