> 🔒 **CONGELADO — arquitectura definida, implementación pendiente.** Octavo sistema de la fase de diseño, abierto explícitamente por Jorge el 2026-08-05 al definir Torre Hokage como centro de control: debe soportar chat de texto y conversación por voz con Hermes. Decisión explícita de Jorge: **diseñar ahora, construir después** — igual que el arte pixel-art de [[Frontend World Engine|§4 Fase 4]] quedó definido antes de decidir el proveedor. No se implementa nada en esta ronda.

## Por qué importa

[[Hermes y Claude - Los Dos Motores|§9.1]] (ya congelado) define a Hermes como texto: reporta a Ship Comms, responde con la tool `system.status`. Torre Hokage, como centro de control del sistema, necesita que Jorge pueda hablar con Hermes por voz, no solo leer texto — sin que eso signifique cablear un proveedor concreto (OpenAI, ElevenLabs, Deepgram, Cartesia...) en el corazón del sistema.

## Principio de diseño — voz es una capacidad, no un proveedor

Igual que [[Gestión de Secretos y Capabilities|§11.2]] hizo que ningún Tool llame a `secretProvider.get('etsy_oauth')` directamente sino a `capabilities.resolve('etsy', ...)`, la voz se descompone en dos capacidades independientes — `stt` (speech-to-text) y `tts` (text-to-speech) — resueltas por el mismo `CapabilityResolver` que ya existe. El proveedor concreto detrás de cada una es intercambiable sin tocar el resto del sistema: es exactamente la garantía que ya demostró su valor con `SecretProvider`.

## Interfaces

```typescript
// config/voiceProvider.ts
interface SttProvider {
  id: string;   // 'whisper' | 'deepgram' | ...
  transcribe(audio: Buffer, opts?: { language?: string }): Promise<{ text: string; confidence?: number }>;
}

interface TtsProvider {
  id: string;   // 'elevenlabs' | 'cartesia' | 'openai-tts' | ...
  synthesize(text: string, opts?: { voiceId?: string }): Promise<{ audio: Buffer; mimeType: string }>;
}
```

Cada implementación concreta (`WhisperSttProvider`, `DeepgramSttProvider`, `ElevenLabsTtsProvider`, `CartesiaTtsProvider`...) vive junto al resto de providers/tools y declara su propia `Capability` + `SecretDefinition`, mismo patrón exacto que `EtsySecretDefinition` en §11.2:

```typescript
export const ElevenLabsTtsDefinition: SecretDefinition = {
  id: 'elevenlabs_tts', label: 'ElevenLabs (TTS)', capability: 'tts',
  kind: 'static', scope: 'installation',
  envVar: 'ELEVENLABS_API_KEY',
};
```

`config/voiceProviders.ts` (mismo espíritu que `agentModels.ts`) decide en un único sitio qué proveedor concreto atiende cada capacidad hoy — `STT_PROVIDER=whisper`, `TTS_PROVIDER=elevenlabs` como configuración, nunca hardcodeado en un componente de UI ni en `aiService.ts`.

## Flujo de conversación por voz — I/O en los extremos, nunca lógica de negocio nueva

Coherente con el principio rector (§0 — "el frontend no tiene estado propio de negocio"): la voz es una capa de entrada/salida en los bordes del sistema, no una vía paralela para hablar con Hermes. `askAgent()`/`aiService.ts` no cambian una línea.

```
Torre Hokage (frontend) → graba audio (MediaRecorder API)
  → POST /api/voice/transcribe  { audio }
      → SttProvider.transcribe() → { text }
  → el texto entra al mismo camino de siempre: POST /api/agents/:id/run (ya existe, Hermes)
  → Hermes responde en texto, como hoy
  → POST /api/voice/synthesize  { text }
      → TtsProvider.synthesize() → { audio, mimeType }
  → el frontend reproduce el audio
```

Dos endpoints nuevos, ambos `requireAdmin`, ninguno cambia el contrato de `POST /api/agents/:id/run`. El chat de texto sigue funcionando exactamente igual — voz es una alternativa de entrada/salida sobre el mismo canal, nunca un segundo Hermes.

## Coste — se integra con Economía v2, no un mecanismo aparte

Cada transcripción y cada síntesis es una llamada a un proveedor externo con coste real. Se registra en `agent_costs` (mismo campo `tool_cost_usd` que ya existe para otras tools de coste no-LLM) asociada al `work_item`/interacción correspondiente — de forma que [[Economía v2 - Sistema Financiero]] lo ve sin ningún mecanismo de tracking adicional.

## Qué no se construye en esta ronda

Ningún proveedor concreto se implementa. No se elige todavía entre Whisper/Deepgram para STT ni entre ElevenLabs/Cartesia/OpenAI TTS para TTS — es una decisión de producto (coste, latencia, calidad de voz en español) que Jorge toma cuando llegue el momento de construir, no de diseñar. Lo que esta nota fija es que, cuando se elija, **conectar el proveedor es escribir una clase + una `SecretDefinition`**, no rediseñar Torre Hokage ni el flujo de conversación.

## Consecuencias a 2-3 años

Si mañana ElevenLabs sube de precio o Deepgram ofrece mejor latencia en español, cambiar de proveedor es un valor de configuración (`TTS_PROVIDER=cartesia`) más una clase nueva — cero cambios en Torre Hokage, en Hermes, ni en el flujo de aprobación existente. El riesgo conocido y aceptado: la latencia real de una conversación de voz (grabar → transcribir → responder → sintetizar → reproducir) depende de tres llamadas de red encadenadas — si al implementar resulta demasiado lenta para sentirse como conversación, la mitigación (streaming de STT/TTS en vez de request-response completo) es una decisión de implementación futura, no algo que esta arquitectura bloquee.

---

## Relacionado

- [[Hermes y Claude - Los Dos Motores]]
- [[Gestión de Secretos y Capabilities]]
- [[Economía v2 - Sistema Financiero]]
- [[Frontend - Decisiones v2]]
- [[Frontend World Engine]]
- [[INDEX]]
