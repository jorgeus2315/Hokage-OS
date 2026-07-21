# HOKAGE OS — Arquitectura Definitiva del Sistema de IA
## Documento técnico v1.0

---

## 1. Visión global

HOKAGE OS no es “una app que usa GPT”. Es una **plataforma de operación de agentes** diseñada para durar 10 años. Por eso el núcleo debe separar tres horizontes:

- **Negocio**: dominio del usuario (Etsy, contenido, finanzas).
- **Orquestación**: Hermes Agent, quien coordina tareas, memoria y herramientas.
- **IA**: capa abstracta de modelos y proveedores, reemplazable sin tocar negocio ni orquestación.

```text
┌────────────────────────────────────────────┐
│               HOKAGE OS UI                 │
│   (React / Vite / Configuración visual)    │
└──────────────────┬─────────────────────────┘
                   │ REST / WS
┌──────────────────▼─────────────────────────┘
│              Backend Node/Express           │
│  ┌──────────────────────────────────────┐  │
│  │           Hermes Agent                │  │
│  │  (Orquestador principal)             │  │
│  │  - Planificación                      │  │
│  │  - Enrutamiento de tareas            │  │
│  │  - Gestión de memoria                │  │
│  │  - Presupuesto y costes              │  │
│  │  - Comunicación entre agentes        │  │
│  └──────────────────┬───────────────────┘  │
└────────────────────┼───────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
┌───────▼──────┐ ┌──▼───────┐ ┌──▼──────────┐
│ AI Adapter   │ │ Tool Bus │ │ Memory Store│
│ (abstracción)│ │ (tools)  │ │ ( memoria ) │
└───────┬──────┘ └──────────┘ └─────────────┘
        │
   ┌────┴────┬────────┬────────┬────────┐
   │         │        │        │        │
Claude   OpenRouter  OpenAI Gemini Local
```

---

## 2. Principios arquitectónicos

1. **Separación total de dominios**: IA, herramientas, negocio y orquestación viven en capas distintas.
2. **Proveedor-independencia**: ningún módulo de negocio sabe si usa Claude, OpenAI o un modelo local.
3. **Configuración sobre código**: todo lo posible se define en BD o JSON, no hardcodeado.
4. **Presupuesto como ciudadano de primera clase**: cada consumo de modelo/tool se registra y limita.
5. **Auditoría nativa**: cada acción deja traza verificable.
6. **Puertos pequeños y sustituibles**: cada componente se puede cambiar por otro sin tsunami.

---

## 3. Cómo organizar Hermes dentro del proyecto

Hermes es el **único orquestador central**. No conviven varios orquestadores.

### 3.1 Estructura recomendada

```text
backend/src/
├── types/
│   └── index.ts              # Tipos globales
├── db/
│   └── init.ts               # Schema SQLite
├── agents/
│   ├── market-scout/
│   ├── content-writer/
│   ├── traffic-manager/
│   ├── support-agents/
│   ├── finance-agent/
│   ├── ops-agent/
│   └── auditor/
├── tools/
│   ├── etsy/
│   ├── printify/
│   ├── google-trends/
│   ├── reddit/
│   ├── pinterest/
│   ├── image-generator/
│   ├── web-browser/
│   └── index.ts              # Tool registry
├── ai/
│   ├── providers/
│   │   ├── claude/
│   │   ├── openrouter/
│   │   ├── openai/
│   │   ├── gemini/
│   │   ├── local/
│   │   └── index.ts          # Provider registry
│   ├── models/
│   │   ├── chat/
│   │   ├── embedding/
│   │   └── index.ts
│   ├── tools-ai-bridge.ts    # Convierte tools en esquemas para modelos
│   └── router.ts             # Selecciona provider/modelo según agente
├── memory/
│   ├── short-term/           # Por sesión
│   ├── long-term/            # Por agente/tema
│   └── index.ts
├── services/
├── middleware/
├── routes/
└── server.ts
```

### 3.2 Responsabilidades de Hermes

- **Planificación**: recibe objetivos del usuario y los descompone en tareas ejecutables.
- **Enrutamiento**: asigna tareas al agente correcto según departamento, habilidades y carga.
- **Presupuesto**: asigna y controla el presupuesto de cada agente en tiempo real.
- **Memoria**: coordina acceso a memoria compartida y privada.
- **Comunicación**: Public/Sub o colas internas para reuniones entre agentes.
- **Herramientas**: autoriza qué tools puede usar cada agente en cada momento.
- **Auditoría**: registra quién hizo qué, con qué modelo, con qué tool, y a qué coste.

---

## 4. Cómo conectar Claude Opus

Claude Opus es el **razonador principal**, no un endpoint cualquiera.

### 4.1 Diseño

```text
Agente --> Hermes --> AI Router --> Claude Provider --> Claude Opus
```

- Hermes nunca llama directamente a Anthropic.
- El **AI Router** decide, por agente y por tarea, qué provider usar.
- Claude Opus se usa para:
  - Razonamiento complejo
  - Planificación de objetivos
  - Redacción de contenido creativo
  - Toma de decisiones con alta ambigüedad

### 4.2 Configuración

```json
{
  "agent": "content-writer",
  "model": {
    "provider": "claude",
    "model": "claude-3-5-sonnet-20240620",
    "fallbacks": ["openrouter/anthropic/claude-3-5-sonnet"]
  },
  "tools": ["image-generator", "google-trends"],
  "budget": { "daily": 50, "monthly": 800 },
  "autonomy": "medium"
}
```

Hermes lee esta configuración y construye la llamada al provider configurado.

---

## 5. Cómo integrar OpenRouter

OpenRouter es la **puerta de enlace preferente**, no un proveedor más.

### 5.1 Ventaja
Si OpenRouter cae o cambia de API, solo modificas el `OpenRouterProvider`, no los agentes.

### 5.2 Implementación

```text
AI Router
  ├── OpenRouterProvider  (por defecto)
  │     ├── Claude
  │     ├── OpenAI
  │     ├── Gemini
  │     └── DeepSeek
  ├── DirectProvider      (fallback si OpenRouter falla)
  │     ├── AnthropicDirect
  │     ├── OpenAIDirect
  │     └── ...
  └── LocalProvider       (modelos locales)
        └── Ollama / vLLM
```

### 5.3 Regla
Si OpenRouter tiene el modelo requerido y dentro del presupuesto, se usa. Si no, fallback al provider directo o al local.

---

## 6. Arquitectura para cambiar de modelo sin modificar el resto

### 6.1 Patrón: Strategy + Factory

```text
interface AIModel {
  complete(messages, options): Promise<AIResponse>;
  embed(text): Promise<Embedding>;
  tokenize(text): Promise<TokenCount>;
}

class ClaudeModel implements AIModel { ... }
class OpenAIModel implements AIModel { ... }
class GeminiModel implements AIModel { ... }
class LocalModel implements AIModel { ... }

class ModelFactory {
  static create(config): AIModel {
    switch (config.provider) {
      case 'claude': return new ClaudeModel(config);
      case 'openrouter': return new OpenRouterModel(config);
      ...
    }
  }
}
```

### 6.2 Contrato único

Toda llamada a IA pasa por `AIAdapter`:

```text
AIAdapter.complete({
  agentId: 'content-writer',
  messages: [...],
  tools: [...],
  maxTokens: 1024,
  temperature: 0.7
})
```

Nadie más construye requests HTTP a proveedores. Si cambia Anthropic o se cae OpenRouter, solo tocás el provider.

---

## 7. Cómo hacer que cada agente use un modelo distinto

Cada agente tiene una configuración de modelo en BD o JSON:

```json
{
  "market-scout": {
    "provider": "openrouter",
    "model": "deepseek/deepseek-chat",
    "temperature": 0.2,
    "maxTokens": 512,
    "tools": ["google-trends", "reddit", "pinterest"],
    "budget": { "daily": 10, "monthly": 100 },
    "autonomy": "high"
  },
  "content-writer": {
    "provider": "openrouter",
    "model": "anthropic/claude-3.5-sonnet",
    "temperature": 0.7,
    "maxTokens": 4096,
    "tools": ["image-generator", "google-trends"],
    "budget": { "daily": 50, "monthly": 800 },
    "autonomy": "medium"
  },
  "finance-agent": {
    "provider": "openrouter",
    "model": "openai/gpt-4o-mini",
    "temperature": 0.0,
    "maxTokens": 1024,
    "tools": [],
    "budget": { "daily": 5, "monthly": 50 },
    "autonomy": "low"
  }
}
```

Hermes consulta esta configuración antes de cada ejecución. No hay código condicional por agente; data-driven.

---

## 8. Cómo conectar herramientas externas de forma modular

### 8.1 Patrón: Tool Interface

```text
interface Tool {
  name: string;
  description: string;
  schema: JSONSchema;
  authorize(agentId, context): Promise<boolean>;
  execute(input, context): Promise<ToolResult>;
  estimateCost(input): Promise<number>;
}
```

### 8.2 Registry central

```text
ToolRegistry.register('etsy', EtsyTool);
ToolRegistry.register('printify', PrintifyTool);
ToolRegistry.register('google-trends', GoogleTrendsTool);
```

### 8.3 Flujo

```text
Agente --> Hermes --> ToolBus --> Tool.authorize() --> Tool.execute() --> Resultado
```

### 8.4 Características
- Cada tool es un módulo independiente.
- Los modelos de IA ven los tools como **function calling schemas**.
- Si una tool falla, Hermes registra el error y sigue sin romper el agente.
- Las tools tienen **coste estimado** para que el presupuesto se controle antes de ejecutar.

---

## 9. Patrones de diseño recomendados

| Patrón | Dónde se usa |
|--------|--------------|
| **Strategy** | Selección de modelo por agente |
| **Factory** | Creación de providers y tools |
| **Registry** | Tools y models registrados dinámicamente |
| **Pub/Sub** | Reuniones entre agentes |
| **Circuit Breaker** | Fallos de proveedores/OpenRouter |
| **Saga** | Flujos de negocio complejos con compensaciones |
| **CQRS** | Lecturas de métricas separadas de escrituras |
| **Event Sourcing** | Histórico completo de acciones |
| **Plugin** | Tools y providers cargables sin recompilar |
| **Dependency Injection** | Proveer tools y memoria a agentes sin hardcodear |
| **Aspect-Oriented** | Logging, presupuesto y auditoría transversales |

---

## 10. Errores a evitar desde el principio

1. **Acoplar agentes a un modelo específico**: si un agente llama a `openai.chat.completions.create`, está mal. Debe pasar por `AIAdapter`.
2. **Permitir tools sin autorización**: cualquier tool que toque dinero o publicación necesita aprobación humana.
3. **Olvidar el presupuesto**: sin límites por agente, un bucle te vacía la cuenta.
4. **Memoria infinita sin gestión**: si guardas todo, el sistema se degrada. Implementa TTL y compresión.
5. ** reinventar la rueda con prompts**: los prompts deben estar en BD o JSON, no en código.
6. **Orquestadores múltiples**: un solo Hermes. Varios coordinadores generan condiciones de carrera.
7. **Agentes con acceso global**: principio de mínimo privilegio. Cada agente ve solo lo que necesita.
8. **No medir nada**: si no hay métricas por agente, no puedes optimizar ni depurar.
9. **Mezclar dominios**: el código de Etsy no debe vivir en el proveedor de IA.
10. **Hardcodear credenciales**: variables de entorno y vault local.

---

## 11. Escalabilidad: cientos de agentes en el futuro

### 11.1 Arquitectura de procesos

```text
┌─────────────────────────────────────────┐
│           HOKAGE OS API                 │
└──────────────┬──────────────────────────┘
               │
       ┌───────▼────────┐
       │  Hermes Core   │  (único orquestador lógico)
       └───────┬────────┘
               │ internal queue
       ┌───────▼────────┐
       │  Worker Pool    │  (procesos/tareas paralelas)
       │  - Agent Runner │  (ejecuta agentes)
       │  - Tool Runner  │  (ejecuta tools)
       │  - Model Runner │  (ejecuta llamadas a IA)
       └────────────────┘
```

- Hermes delega en workers.
- Cada worker es stateless; el estado vive en BD/memoria.
- Si necesitas 100 agentes simultáneos, escalas workers, no el core.

### 11.2 Estados en BD

Todo estado vivo debe estar en SQLite o Redis, no en memoria de proceso:
- `agent_runs` (ejecución actual de cada agente)
- `agent_messages` (buzón)
- `agent_memory` (contexto)
- `audit_logs` (trazabilidad)
- `cost_events` (consumo)

### 11.3 Concurrencia
- Colas por agente o por departamento.
- Rate limiting por proveedor.
- Circuit breakers por modelo/herramienta.

---

## 12. Memoria de cada agente

### 12.1 Modelo: tres capas

| Capa | Nombre | Retención | Uso |
|------|--------|-----------|-----|
| 1 | Working Memory | Sesión actual | Contexto inmediato |
| 2 | Episodic Memory | 30 días | Experiencias pasadas |
| 3 | Semantic Memory | Permanente | Conocimiento curado del agente |

### 12.2 Implementación

- **Working Memory**: transient, se pierde al cerrar sesión.
- **Episodic Memory**: `agent_memory` en BD, con TTL automático.
- **Semantic Memory**: documentos JSONL o embeddings por agente/tema.

```text
agent_memory/
├── agents/
│   ├── content-writer/
│   │   ├── episodic/
│   │   │   └── 2025/07/*.jsonl
│   │   ├── semantic/
│   │   │   ├── style-guide.md
│   │   │   └── brand-voice.md
│   │   └── config.json
│   └── market-scout/
```

### 12.3 Reglas
- Ningún agente accede a la memoria de otro sin autorización.
- El usuario puede purgar memoria por agente.
- Se registra cuándo se consulta memoria (auditoría).

---

## 13. Reuniones entre agentes

### 13.1 Patrón: Agent Roundtable (Pub/Sub)

```text
Topic: "launch-campaign-2025-07"
 Publishers: market-scout, content-writer, traffic-manager, finance-agent
 Subscribers: ops-agent, auditor

Flujo:
1. market-scout publica findings.
2. content-writer los suscribe y genera copy.
3. traffic-manager suscribe copy y propone presupuesto.
4. finance-agent revisa presupuesto y pide ajuste.
5. ops-agent coordina ejecución.
6. auditor valida antes de publicación definitiva.
```

### 13.2 Características
- Room por objetivo/proyecto.
- Mensajes estructurados: `{ from, to, type, payload, timestamp }`.
- Límite de turnos para evitar bucles infinitos.
- Timeout por reunión: si no hay consenso en N minutos, escala al usuario.

---

## 14. Gestión de costes

### 14.1 Modelo

```text
CostBudget
  ├── global (empresa)
  │     └── monthly_limit
  ├── per_department
  │     └── monthly_limit
  ├── per_agent
  │     └── daily_limit + monthly_limit
  └── per_task
        └── max_cost
```

### 14.2 Flujo

1. Antes de ejecutar, Hermes estima el coste de la tarea.
2. Si supera el límite del agente o departamento, se bloquea o escala.
3. Cada llamada a modelo/tool registra:
   - tokens input/output
   - duración
   - coste real
   - proveedor/modelo
4. Dashboard en tiempo real de consumo.

### 14.3 Alertas
- 80% del presupuesto: warning.
- 95% del presupuesto: bloqueo preventivo.
- 100% del presupuesto: solo tareas humanas.

---

## 15. Monitorización

### 15.1 Métricas por agente

- Tareas ejecutadas / fallidas / canceladas.
- Tiempo medio por tarea.
- Tokens consumidos por tarea.
- Coste por tarea / por día / por mes.
- Herramientas usadas y tasa de éxito.
- Latencia por proveedor.

### 15.2 Métricas del sistema

- Cola de tareas pendientes vs procesadas.
- Disponibilidad de proveedores.
- Estado de tools (online/offline/rate-limited).
- Uso de memoria por agente.

### 15.3 Dashboards
- Vista operativa: estado actual de agentes y tareas.
- Vista financiera: costes por agente/departamento.
- Vista técnica: disponibilidad de servicios.

---

## 16. Configuración desde HOKAGE OS sin código

### 16.1 Principio
Toda la configuración vive en la base de datos o en archivos JSON editables desde la UI.

### 16.2 Entidades configurables

```text
ai_providers
  ├── id
  ├── name
  ├── type (claude, openrouter, openai, gemini, local)
  ├── config (JSON: api keys, endpoints, modelos permitidos)
  ├── priority (fallback order)
  └── enabled

ai_models
  ├── id
  ├── provider_id
  ├── model_id
  ├── context_window
  ├── input_price_per_1k
  ├── output_price_per_1k
  ├── capabilities (JSON: vision, tools, reasoning)
  └── enabled

agents
  ├── ...
  ├── model_id
  ├── allowed_tools (JSON array)
  ├── budget_daily
  ├── budget_monthly
  ├── autonomy_level (low, medium, high)
  ├── department
  ├── priority
  └── memory_ttl

tools
  ├── id
  ├── name
  ├── type
  ├── config (JSON: credenciales, endpoints)
  ├── cost_per_call
  ├── required_approval
  └── enabled

agent_tools (relación N:N)
  ├── agent_id
  ├── tool_id
  └── enabled
```

### 16.3 UI de configuración
El frontend debe permitir:
- Crear/editar proveedores y modelos.
- Asignar modelos y tools a agentes.
- Definir presupuestos.
- Activar/desactivar tools.
- Ver métricas en tiempo real.

Sin deploy, sin modificar código.

---

## 17. Mejoras sugeridas a tus ideas iniciales

### 17.1 Sobre “Hermes como orquestador”
Tu idea es correcta. La mejora: **Hermes no debe ser monolítico**. Separar:
- Hermes Core: orquestación y reglas.
- Hermes Workers: ejecución paralela.
- Hermes API: interfaz para el frontend.

Así si Hermes crece, lo escalas con workers, no reescribes el core.

### 17.2 Sobre “OpenRouter siempre que sea posible”
Correcto. La mejora: **fallback automático a directo**. Si OpenRouter cae o no tiene el modelo, Hermes detecta el error y usa el proveedor directo sin intervención humana.

### 17.3 Sobre “Herramientas externas”
Tu lista es excelente. La mejora: **sandboxing y timeouts**. Ninguna tool se ejecuta indefinidamente. Timeout duro, retry con backoff y circuit breaker por tool. Así una caída de Google Trends no tumba toda la operación.

### 17.4 Sobre “Configuración por agente”
Correcto. La mejora: **herencia por departamento**. Si todos los agentes de Marketing comparten modelo y presupuesto base, defínelo en el departamento y hereda. Evita configurar 50 agentes uno por uno.

### 17.5 Sobre “Memoria”
Tu idea es correcta. La mejora: **vector store a largo plazo**. A medida que crezca la memoria, búsqueda semántica > LIKE. Preparar desde ya una interfaz `MemoryStore` para luego enchufar pgvector, sqlite-vec o similar sin cambiar agentes.

### 17.6 Sobre “Reuniones entre agentes”
Correcto. La mejora: **chairman automático**. Si una reunión no avanza en N minutos, Hermes propone decisiones por votación o escala al usuario. Evita reuniones infinitas.

---

## 18. Resumen ejecutivo

- **Hermes** es el único orquestador, descompuesto en Core + Workers + API.
- **AI Adapter** es la capa que permite cambiar de modelo/proveedor sin tocar negocio.
- **OpenRouter** es la vía preferente, con fallback a directo/local.
- **Tools** son módulos pluggables con autorización, coste y timeout.
- **Memoria** es por agente, con tres capas y TTL.
- **Costes** se controlan por agente/departamento/global con alertas.
- **Monitorización** es nativa: cada consumo y acción se traza.
- **Configuración** es 100% desde UI/BD, sin código.
- **Escalabilidad** viene de workers stateless y colas, no de reescribir.

Este documento es la base para que cualquier IA o desarrollador pueda implementar el sistema sin inventar arquitectura nueva cada vez.
