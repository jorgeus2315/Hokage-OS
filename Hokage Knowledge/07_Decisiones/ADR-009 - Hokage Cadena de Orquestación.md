# ADR-009 — Hokage Cadena de Orquestación
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado (2026-08-13)
> Sintetizado desde [[BLOQUE_0_DECISIONES_FUNDACIONALES]] §Ω — comprobación pedida por Jorge al cerrar el Bloque 0.

---

## Contexto

Riesgo real al introducir el ModelRouter (ADR-008): reducir Hokage a "elegir modelo". La visión exige una cadena de decisión superior — comprensión, selección de agente(s), contexto, reutilización, herramientas, perfil, modelo, ejecución, evaluación, diagnóstico, remediación — de la que el modelo es solo una pieza.

## Decisión

**Hokage es una cadena de orquestación; el ModelRouter es una etapa.** La cadena:
`objetivo → comprensión → selección de agente(s) por capacidad → contexto → información reutilizable → herramientas → TaskProfile → selección de modelo → ejecución → evaluación → diagnóstico/remediación → resultado`.

Consecuencias de diseño congeladas:
- **Piezas componibles:** agente, modelo, proveedor, herramienta y venture son **dato o interfaz**; añadir una **no toca el núcleo de Hokage** (Ω.2).
- **La selección resuelve por capacidad requerida → candidatos** (trampa **L2**), no por agente fijo 1:1.
- **Composición como Tasks-con-dependencias, no primitivas nuevas** (Ω.3): un agente / varios / secuenciales (dependencias) / paralelo (misma fase) / revisión (Task `kind='review'` dependiente) / especialista temporal (agente on-demand desde `role_definition`). Todo ello **sin cambiar el contrato del Runtime** (`work_items` + `agent_id` + fase + dependencia + seam `decisionResolvers`).

## Alternativas consideradas

- **Hokage = ModelRouter** — descartada: pierde comprensión/contexto/colaboración/evaluación.
- **Cada agente orquesta su parte** — descartada: mini-planners, viola la autoridad única.
- **Primitivas dedicadas de pipeline/parallel/review en el Runtime** — descartada: infla el núcleo; se logra igual con Tasks + dependencias.
- **Un handler por agente en Hokage** — descartada: rework por cada agente nuevo.

## Consecuencias

El sistema puede crecer a N agentes, agentes creados por Jorge, especializaciones, secuencias, paralelismo, revisión cruzada y especialistas temporales **sin rediseñar el núcleo**. Riesgo aceptado: la calidad depende de que Hokage ejecute bien toda la cadena (no solo el routing) — mitigado por la evaluación/remediación (ADR-010) y el feedback. Disparador de revisión: si una composición futura no encaja como Task-con-dependencias, se reabre este ADR antes de añadir una primitiva.

## Relacionado

- [[BLOQUE_0_DECISIONES_FUNDACIONALES]] · [[ADR-008 - ModelRouter y AIProvider]] · [[ADR-002 - Agent Runtime]]
- [[HOKAGE_AGENT_OPERATING_MODEL]] · [[Automatizaciones (Agente-Agente)]]
- [[Resumen Ejecutivo - Decisiones Congeladas]] · [[INDEX]]
