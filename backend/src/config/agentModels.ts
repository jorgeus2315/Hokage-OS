// ═══════════════════════════════════════════════════════
// MODELOS ÓPTIMOS POR AGENTE — fuente única de verdad
// ═══════════════════════════════════════════════════════

// IDs verificados contra el catálogo en vivo de OpenRouter (openrouter.ai/api/v1/models).
// Nota: OpenRouter usa "claude-sonnet-4.5" / "claude-haiku-4.5" (con punto), no con guion.
import { getModel } from './modelCatalog.js';

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

// Tools disponibles por rol. Solo se incluyen en la llamada al proveedor si el MODELO usado
// soporta function calling (K.5: capacidad = dato del catálogo de modelos, no una lista aquí).
// memory.write (Fase 3) y decision.create (Fase 4) solo van a roles tool-capable.
// operaciones/soporte, en Llama 3.1 8B, se quedan permanentemente
// en [MEMORIA: k=v] / [DECISION: ...] — no es una omisión temporal, es la realidad del modelo
// (ver HOKAGE_CORE_SPECIFICATION_v1.md §2).
export const AGENT_TOOLS: Record<string, string[]> = {
  ceo:          ['web.browser', 'memory.write', 'memory.remember', 'decision.create'],
  investigador: ['google.trends', 'web.browser', 'trend.report', 'memory.write', 'memory.remember', 'decision.create'],
  contenido:    ['web.browser', 'content.create', 'memory.write', 'memory.remember', 'decision.create'],
  trafico:      ['google.trends', 'web.browser', 'etsy.listings', 'etsy.receipts', 'memory.write', 'memory.remember', 'decision.create'],
  finanzas:     ['memory.write', 'memory.remember', 'decision.create'],
  operaciones:  [],
  soporte:      [],
  hermes:       ['system.exec', 'memory.write', 'memory.remember', 'decision.create'],
};

export function modelForRole(role: string): string {
  return AGENT_MODELS[role] || DEFAULT_MODEL;
}

// K.5: la capacidad de tools es dato del catálogo (fuente de verdad), no una Set duplicada.
export function modelSupportsTools(model: string): boolean {
  return getModel(model)?.supportsTools ?? false;
}

export function toolsForRole(role: string): string[] {
  return AGENT_TOOLS[role] || [];
}
