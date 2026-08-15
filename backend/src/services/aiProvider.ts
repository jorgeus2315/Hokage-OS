// ═══════════════════════════════════════════════════════════════════════════
// aiProvider — FRONTERA de proveedor de IA (K.5, ADR-008, trampa L7).
// ═══════════════════════════════════════════════════════════════════════════
//
// El dominio (aiService) llama SIEMPRE a través de esta interfaz — nunca a OpenRouter directo.
// El proveedor se encarga de: autenticación con su API, timeout, llamada, errores propios y
// normalización de la respuesta (contenido + tool_calls + uso/tokens). Añadir otro proveedor
// (Anthropic/OpenAI/Google/local) = una entrada en el registro, sin tocar dominio ni orquestador.

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

// Respuesta NORMALIZADA — el dominio no ve el formato crudo del proveedor.
export interface ChatResponse {
  content: string;
  toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
}

export interface AIProvider {
  readonly id: string;
  isConfigured(): boolean;              // ¿tiene credenciales? (sin exponer el secreto)
  listModels(): ModelDescriptor[];      // el proveedor POSEE su catálogo (precio/capacidades)
  chat(req: ChatRequest): Promise<ChatResponse>;
}

const DEFAULT_MAX_TOKENS = 2000;
const AI_TIMEOUT_MS = 120_000;

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT_MS));
  return Promise.race([p, timeout]);
}

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter';
  private readonly base = 'https://openrouter.ai/api/v1';

  isConfigured(): boolean {
    return !!process.env.OPENROUTER_API_KEY;
  }

  listModels(): ModelDescriptor[] {
    return MODEL_CATALOG.filter((m) => m.provider === this.id && m.status === 'ready');
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = process.env.OPENROUTER_API_KEY;   // el proveedor gestiona su propia auth
    if (!apiKey) throw new Error('Falta OPENROUTER_API_KEY en el entorno');

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: req.messages,
    };
    if (req.tools && req.tools.length > 0) body.tools = req.tools;

    let res: Response;
    try {
      res = await withTimeout(fetch(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      }));
    } catch (e: any) {
      throw new Error(e?.message === 'AI_TIMEOUT' ? 'OpenRouter no respondió a tiempo' : (e?.message ?? 'error de red'));
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as any;
    const usage = data?.usage ?? {};
    const message = data?.choices?.[0]?.message ?? {};
    const tokensIn = usage.prompt_tokens ?? 0;
    const tokensOut = usage.completion_tokens ?? 0;
    return {
      content: message.content ?? '',
      toolCalls: (message.tool_calls ?? []) as ChatResponse['toolCalls'],
      tokensIn,
      tokensOut,
      totalTokens: usage.total_tokens ?? (tokensIn + tokensOut),
    };
  }
}

// Registro de proveedores. El dominio pide el proveedor por id (que sale del catálogo del modelo,
// `ModelDescriptor.provider`), nunca instancia OpenRouter. Un proveedor nuevo entra aquí.
const PROVIDERS: Record<string, AIProvider> = {
  openrouter: new OpenRouterProvider(),
};

export function getProvider(providerId: string): AIProvider {
  return PROVIDERS[providerId] ?? PROVIDERS.openrouter;
}
