// ═══════════════════════════════════════════════════════════════════════════
// modelCatalog — catálogo de modelos como DATO (Bloque 0, ADR-008, trampa L4/L7).
// ═══════════════════════════════════════════════════════════════════════════
//
// FUENTE DE VERDAD (K.5, cableado) de los metadatos de modelo: tier, precio, contexto, tools,
// fuerzas. aiService lee el precio (priceOf) y agentModels la capacidad de tools (modelSupportsTools)
// desde aquí — sin tablas duplicadas (MODEL_PRICES / TOOL_CAPABLE_MODELS retiradas en K.5).
// AGENT_MODELS queda solo como modelo por defecto del ROL (fallback cuando no hay TaskProfile).
// Añadir un modelo/proveedor futuro = una fila aquí, sin tocar el router ni el dominio.

export type ModelTier = 'S' | 'A' | 'B';

export interface ModelStrengths {
  reasoning: number;   // 0..1 — dato afinable
  creativity: number;
  research: number;
  speed: number;
}

export interface ModelDescriptor {
  id: string;
  provider: string;                    // 'openrouter' (una impl de AIProvider)
  tier: ModelTier;
  price: { in: number; out: number };  // USD por millón de tokens — fuente de verdad del coste (K.5)
  contextWindow: number;               // tokens (aproximado, dato afinable)
  supportsTools: boolean;              // function calling — fuente de verdad de la capacidad (K.5)
  strengths: ModelStrengths;
  status: 'ready' | 'deprecated';
}

export const MODEL_CATALOG: readonly ModelDescriptor[] = [
  {
    id: 'anthropic/claude-sonnet-4.5', provider: 'openrouter', tier: 'S',
    price: { in: 3.0, out: 15.0 }, contextWindow: 200_000, supportsTools: true,
    strengths: { reasoning: 0.95, creativity: 0.9, research: 0.8, speed: 0.4 }, status: 'ready',
  },
  {
    id: 'anthropic/claude-haiku-4.5', provider: 'openrouter', tier: 'A',
    price: { in: 0.8, out: 4.0 }, contextWindow: 200_000, supportsTools: true,
    strengths: { reasoning: 0.7, creativity: 0.7, research: 0.65, speed: 0.8 }, status: 'ready',
  },
  {
    id: 'google/gemini-2.5-flash', provider: 'openrouter', tier: 'A',
    price: { in: 0.15, out: 0.6 }, contextWindow: 1_000_000, supportsTools: true,
    strengths: { reasoning: 0.6, creativity: 0.55, research: 0.7, speed: 0.9 }, status: 'ready',
  },
  {
    id: 'google/gemini-flash-1.5', provider: 'openrouter', tier: 'B',
    price: { in: 0.075, out: 0.3 }, contextWindow: 1_000_000, supportsTools: true,
    strengths: { reasoning: 0.45, creativity: 0.4, research: 0.55, speed: 0.95 }, status: 'ready',
  },
  {
    id: 'meta-llama/llama-3.1-8b-instruct', provider: 'openrouter', tier: 'B',
    price: { in: 0.06, out: 0.06 }, contextWindow: 131_072, supportsTools: false,
    strengths: { reasoning: 0.35, creativity: 0.3, research: 0.3, speed: 0.95 }, status: 'ready',
  },
];

export const TIER_RANK: Record<ModelTier, number> = { S: 3, A: 2, B: 1 };

export function getModel(id: string): ModelDescriptor | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

export function modelsByProvider(provider: string): ModelDescriptor[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}

// Precio del modelo (fuente de verdad para el coste). Fallback conservador si no está catalogado.
export function priceOf(id: string): { in: number; out: number } {
  return getModel(id)?.price ?? { in: 1.0, out: 5.0 };
}
