# ADR-008 — ModelRouter y AIProvider
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado (2026-08-13)
> Sintetizado desde [[BLOQUE_0_DECISIONES_FUNDACIONALES]] §B (y [[HOKAGE_AGENT_OPERATING_MODEL]] §4) — cierre del Bloque 0.

---

## Contexto

El modelo se resolvía **estático por rol** (`AGENT_MODELS`) y **OpenRouter estaba cableado** en `aiService.ts` (fetch directo, precios en `MODEL_PRICES`, capacidad de tools en `TOOL_CAPABLE_MODELS`). Imposible "máxima calidad con gasto inteligente" ni añadir proveedores/modelos sin tocar código (trampas **L3/L4/L7**).

## Decisión

Selección **dinámica** por tres piezas:

1. **`AIProvider`** (interfaz): desacopla el dominio del proveedor; OpenRouter es una implementación; el **proveedor/catálogo posee precio y capacidades** (L7).
2. **Model Catalog como DATO** (`ModelDescriptor`: tier S/A/B, precio, contextWindow, supportsTools, strengths): añadir modelo/proveedor = una fila (L4).
3. **`ModelRouter`** determinista: recibe un **`TaskProfile`** estructurado que **Hokage produce al descomponer** (L3), calcula `requiredTier = max(qualityFloor, complejidad, needs)`, filtra candidatos (tier ≥ required, tools/contexto), y elige el **más barato por encima del suelo**. `importance='critical'` añade revisión por 2º modelo.

Coherente con el invariante **"el LLM propone (TaskProfile), el runtime decide (modelo)"** — mismo patrón que `validatePlan`.

## Alternativas consideradas

- **Modelo fijo por rol** (statu quo) — descartada: no cumple la visión.
- **El LLM elige el modelo libremente** — descartada: impredecible, puede saltarse política/presupuesto, coste no acotado.
- **Heurística por longitud de prompt** — descartada: burda, no captura complejidad/creatividad/riesgo.
- **Catálogo derivado de las constantes actuales** — descartada como estado final: el catálogo es la fuente; las constantes se retiran en la fase de cableado (K.5).

## Consecuencias

Añadir modelos/proveedores/tipos de tarea es dato, no código. El router es tan bueno como el `TaskProfile` (riesgo aceptado: perfil pobre → routing pobre; mitigado porque el perfil es mejorable por feedback/historial). Disparador de revisión: si aparece un proveedor con formato no-OpenAI, se implementa como `AIProvider` nuevo sin tocar `agentRuntime`.

## Relacionado

- [[BLOQUE_0_DECISIONES_FUNDACIONALES]] · [[ADR-009 - Hokage Cadena de Orquestación]] · [[ADR-010 - Quality Floors, Coste y Revisión]]
- [[HOKAGE_AGENT_OPERATING_MODEL]] · [[Economía]]
- [[Resumen Ejecutivo - Decisiones Congeladas]] · [[INDEX]]
