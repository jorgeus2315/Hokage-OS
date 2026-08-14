// ═══════════════════════════════════════════════════════════════════════════
// aiProvider — frontera de proveedor de IA (Bloque 0, ADR-008, trampa L7).
// ═══════════════════════════════════════════════════════════════════════════
//
// ADITIVO y NO cableado: askAgent()/callAIJson() en aiService.ts SIGUEN hablando con OpenRouter
// directamente, sin cambios. El cableado del runtime a esta interfaz es K.5, no este paso.
// Aquí se define el contrato AIProvider y una implementación OpenRouter, para que el proveedor
// deje de estar acoplado al dominio: el proveedor POSEE su catálogo (precio/capacidades).

import { MODEL_CATALOG, type ModelDescriptor } from '../config/modelCatalog.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  [key: string]: unknown;   // tool_calls, tool_call_id, name… según el rol
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  tools?: unknown[];
}

export interface ChatResponse {
  content: string;
  toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>;
  tokensIn: number;
  tokensOut: number;
  raw: unknown;
}

// Contrato de proveedor. Cambiar de proveedor o añadir modelos locales = otra implementación,
// sin tocar agentRuntime ni los agentes.
export interface AIProvider {
  readonly id: string;
  listModels(): ModelDescriptor[];
  chat(req: ChatRequest, apiKey: string): Promise<ChatResponse>;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_MAX_TOKENS = 2000;

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter';

  listModels(): ModelDescriptor[] {
    return MODEL_CATALOG.filter((m) => m.provider === this.id && m.status === 'ready');
  }

  // Primitiva de UNA completación. El loop de tool-calling se compone ENCIMA en el cableado
  // (K.5) reutilizando este método — no se duplica aquí la lógica de negocio del askAgent actual.
  async chat(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: req.messages,
    };
    if (req.tools && req.tools.length > 0) body.tools = req.tools;

    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as any;
    const usage = data?.usage ?? {};
    const message = data?.choices?.[0]?.message ?? {};
    return {
      content: message.content ?? '',
      toolCalls: message.tool_calls ?? [],
      tokensIn: usage.prompt_tokens ?? 0,
      tokensOut: usage.completion_tokens ?? 0,
      raw: data,
    };
  }
}
