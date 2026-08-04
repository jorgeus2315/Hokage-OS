# ADR-005 — Tool Runtime y Plugin Contract
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado — Tool Runtime implementado, Plugin System diseñado
> Sintetizado desde `HOKAGE_CORE_SPECIFICATION_v1.md` §2 (migración de marcadores) y §8 — Fase 7 de la migración documental

---

## Contexto

Hokage OS necesita un mecanismo único para que (a) los agentes disparen efectos estructurados de forma fiable, y (b) capacidades nuevas (integraciones externas, tools específicos de un negocio) entren al sistema sin tocar el núcleo. Dos decisiones distintas pero relacionadas conviven en esta nota: la migración del sistema de marcadores de texto a Tool Calling, y el diseño del Plugin System sobre ese mismo mecanismo.

## Decisión 1 — El contrato de Tool ya es el mecanismo de plugin

El `Tool` interface (`tools/base.ts`) — `id`, `inputSchema`/`outputSchema`, `execute(input, ctx)`, registrado en `tools/registry.ts`, descubierto automáticamente por el LLM vía function-calling — es de facto el sistema de plugins de Hokage OS. Añadir un tool nuevo es añadir un fichero + una línea en el registry, cero cambios en `aiService.ts` ni en rutas.

**Regla de seguridad permanente:** `permissions`/`requiredApproval` en el `Tool` interface son metadata informativa, **nunca aplicada por ninguna capa de plataforma** (`ToolRuntime`/`manager.ts`, que sí los hacían cumplir, se borraron por estar completamente muertos). Cualquier tool que necesite una garantía real de aprobación debe implementarla dentro de su propio `execute()` — como hace `SystemExecTool`, que nunca ejecuta directo, siempre crea una Decision. La garantía de seguridad vive donde se puede verificar, no en un campo de configuración.

## Decisión 2 — Migración de marcadores de texto a Tool Calling

Todo efecto estructurado de un agente (crear una `Decision`, reportar tendencia, registrar contenido, escribir en `agent_memory`) pasaba por regex sobre texto libre (`[DECISION: ...]`, `[TENDENCIA: ...]`, `[CONTENIDO: ...]`, `[MEMORIA: ...]`) — un mecanismo estrictamente peor que el function-calling ya construido para otros tools. Un marcador mal formateado no generaba error ni log; el efecto simplemente no ocurría.

**Migrado en 4 fases, completadas y verificadas (2026-08-04):**

| Orden | Marcador → Tool | Por qué en esa posición | Retirada del regex |
|---|---|---|---|
| 1 | `[TENDENCIA:]` → `trend.report` | Un único rol tool-capable — valida el patrón base | Total, tras verificar |
| 2 | `[CONTENIDO:]` → `content.create` | Segundo rol único, familia de modelo distinta | Total, tras verificar |
| 3 | `[MEMORIA: k=v]` → `memory.write` | Primero en exigir el diseño de doble camino permanente | Parcial — permanece para `operaciones`/`soporte` |
| 4 | `[DECISION:]` → `decision.create` | Mayor superficie, más visible para Jorge (Alertas) | Parcial — permanece para `operaciones`/`soporte` |

**Restricción real de modelo, no de diseño:** `TOOL_CAPABLE_MODELS` excluye `meta-llama/llama-3.1-8b-instruct` — el modelo real de `operaciones` y `soporte`. Para esos dos roles el marcador de texto sigue siendo, permanentemente, el único camino posible — no es un fallback temporal, es una realidad del modelo.

**Hallazgos reales encontrados durante la construcción:**
- El modelo preferÍa el marcador viejo incluso con la tool disponible y pedida explícitamente — corregido construyendo el bloque de instrucciones dinámicamente por rol (`toolsForRole()`), retirando la instrucción del marcador solo para roles con la tool.
- Riesgo de ciclo de imports (`aiService.ts → tools/registry.ts → tools/index.ts → aiService.ts`) al mover `writeAgentMemory()` — resuelto extrayendo la función a un servicio nuevo sin dependencia hacia `tools/`. Regla general: cualquier Tool que necesite invocar algo de `aiService.ts` corre el mismo riesgo.
- Campos que "venían gratis" del texto libre (como `description`, capturada como los primeros 300 caracteres por el regex viejo) dejan de venir gratis en una tool — hay que declararlos explícitamente obligatorios en el schema. `description` pasó a ser obligatorio en `decision.create`; efecto colateral positivo: el modelo empezó a rechazar crear decisiones sin contexto real en vez de rellenar con ruido.

**Regla permanente:** ningún sistema nuevo introduce un mecanismo alternativo de comunicación estructurada — todo pasa por Tool Calling. Gobierna en concreto el futuro `memory.remember` (ver [[ADR-004 - Memory System]], que nace directamente como tool) y cualquier Business Module.

## Decisión 3 — Postura sobre MCP: no adoptar en v1

Hokage OS (el runtime de agentes) no usa MCP — `aiService.ts` habla directo con OpenRouter con function-calling nativo. MCP es, hoy, solo la forma en que Claude Code (la herramienta de desarrollo) se conecta a herramientas — sin relación con el runtime de Hokage.

**Alternativas evaluadas:** (A) adoptar MCP como mecanismo de tools de los agentes — descartado, añade una capa de transporte/protocolo innecesaria para 5 tools internos y es infraestructura para un problema (conectar muchos proveedores externos) que Hokage no tiene. (B) mantener el `Tool` interface propio — elegido. (C) interface propio con un `MCPAdapterTool` opcional el día que haga falta — puerta dejada abierta.

**Decisión: B ahora, con la puerta de C abierta.** Señal de revisión: si el número de integraciones externas supera los 15-20 tools mantenibles cómodamente.

## Decisión 4 — Plugin System: cómo entra capacidad nueva sin tocar el núcleo

Un **Tool** es el contrato de *ejecución*. Un **Plugin** es la unidad de *distribución y ciclo de vida* — una carpeta con manifiesto que provee uno o más Tools (y opcionalmente un tipo visual y Automations por defecto), con instalación/versión/habilitación rastreadas en BD, independiente del núcleo.

**Core vs. plugin — la línea que importa:** los tools construidos en la migración de marcadores (`trend.report`, `content.create`, `memory.write`, `decision.create`) más `system.exec`, `memory.remember` y `founder.remember` son **vocabulario core del Runtime** — nunca opcionales, siguen hardcodeados en `AGENT_TOOLS`. El Plugin System gobierna la capa de encima: capacidades opcionales, añadibles, quitables (Etsy, Shopify, Printify, cualquier integración futura).

Un **Business Module** no es un mecanismo nuevo — es una composición: canal (dato) + Tool(s) que registra + Automations que siembra por defecto. Activar uno es insertar filas, no "instalar" nada en el sentido de código nuevo.

## Consecuencias

- La regla de "un tool, un propósito" (nunca un parámetro `scope` que cambia semántica) se convierte en el patrón que todo sistema futuro debe seguir — ya validado en la migración y reutilizado explícitamente en [[ADR-004 - Memory System]].
- La ausencia de enforcement real de `permissions` en el Tool interface significa que cada tool nuevo es responsable de su propia garantía de seguridad — un olvido aquí es un agujero real, no cosmético.
- El Plugin System deja lista la arquitectura para Etsy/Shopify/Printify (Fase 6 del roadmap de producto) sin tener que rediseñar nada cuando esas integraciones dejen de ser stubs.
- `operaciones`/`soporte` permanecen atados al mecanismo de marcador de forma permanente — cualquier feature nueva que dependa de tool-calling debe excluir explícitamente a esos dos roles o planear su migración de modelo primero.

## Relacionado

- [[Runtime, Scheduler y Event Bus]]
- [[Plugin System - Arquitectura Completa]]
- [[ADR-003 - Event Bus]]
- [[ADR-004 - Memory System]]
- [[Resumen Ejecutivo - Decisiones Congeladas]]
- [[INDEX]]
