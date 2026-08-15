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

## Estado de implementación (K.5, 2026-08-13)

**Cableado.** La cadena (ADR-009): `decompose` (LLM) propone un `profile` por tarea → `validateTaskProfile` (guard determinista, `config/taskProfile.ts`) lo sanea → `selectModel` (ADR-008, en el dispatch de Hokage) elige el modelo → se fija en `hokage_tasks.model` y se propaga a `work_items.model` → `agentRuntime.stage3` lo pasa a `askAgent` como `modelOverride`. **El router corre en la cadena de Hokage, no en askAgent** (fiel a ADR-009).

- **Catálogo = fuente de verdad**: `aiService` lee el precio (`priceOf`) y `modelSupportsTools` la capacidad desde `modelCatalog`; **`MODEL_PRICES` y `TOOL_CAPABLE_MODELS` retiradas**. `AGENT_MODELS` se conserva como **modelo por defecto del rol** (fallback sin profile).
- **AIProvider como frontera real**: `askAgent`/`callAIJson` llaman a `getProvider(model.provider).chat(...)`; el dominio ya **no conoce OpenRouter** (confinado a `aiProvider.ts`, el arranque y la denylist de seguridad). El proveedor gestiona su auth/timeout/normalización.
- **Sin profile → estático** (chat/autónomo): comportamiento anterior intacto (retrocompatible).
- **Coste por modelo**: se registra `agent_costs.model`.
- 🔒 Seguridad: el router solo elige MODELO; las tools/permisos siguen saliendo de rol∩autonomía (el modelo nunca eleva permisos). El guard impide que el LLM inyecte campos peligrosos.

**GAP (seam, no bucle):** `selectModel` devuelve `review` (crítico/riesgo alto → 2º modelo), pero la **escalera de remediación** (ADR-010 §F) queda para una fase posterior — necesita el evaluador de calidad. La **reserva de presupuesto** sigue estimando con el modelo por defecto del rol (no el enrutado) — refinamiento futuro; el techo duro por venture es el guard real.

## Relacionado

- [[BLOQUE_0_DECISIONES_FUNDACIONALES]] · [[ADR-009 - Hokage Cadena de Orquestación]] · [[ADR-010 - Quality Floors, Coste y Revisión]]
- [[HOKAGE_AGENT_OPERATING_MODEL]] · [[Economía]]
- [[Resumen Ejecutivo - Decisiones Congeladas]] · [[INDEX]]
