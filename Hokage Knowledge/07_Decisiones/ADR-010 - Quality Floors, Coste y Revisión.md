# ADR-010 — Quality Floors, Coste y Revisión
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado (2026-08-13)
> Sintetizado desde [[BLOQUE_0_DECISIONES_FUNDACIONALES]] §C/§D/§E/§F — cierre del Bloque 0.

---

## Contexto

"Máxima calidad dentro de un gasto racional" exige tres garantías que hoy no existen: que el ahorro **no** produzca resultados cutres, que el coste se decida por **valor** dentro del techo, y que un resultado pobre se **diagnostique y remedie** en vez de repetirse a ciegas.

## Decisión

- **Quality Floors (§C):** un **tier mínimo por categoría de tarea** que el ahorro **nunca** puede cruzar — es una **restricción del sistema, no una preferencia**. Configurable **hacia arriba**; con mínimo de sistema invariante (p.ej. contenido de cara al cliente nunca < A; estrategia nunca < S).
- **Política de coste (§D):** techo duro (venture+rol) invariante; dentro del techo, el router elige el tier que la tarea **merece** y el modelo **más barato** de ese tier; se escala un tier con `importance≥high` + (complejidad alta o `needs`) + presupuesto. **Importancia = campo declarado** por Hokage (no un ROI computado especulativo). Dedup contra resultados previos/work_items equivalentes evita llamadas y trabajo duplicado.
- **Feedback (§E):** `captura → clasificación (LLM propone) → evidencia → validación (umbral/confirmación) → promoción` a `preferences` (scope + confianza + caducidad). 🔒 **El feedback NUNCA modifica seguridad, política, presupuesto ni permisos.** Ningún comentario aislado se vuelve regla global.
- **Revisión y resultados pobres (§F):** señal de calidad **por capas** (checks baratos deterministas → revisión por 2º modelo en `critical`/`risk=high` → feedback humano) y **escalera de remediación diagnóstica**: enriquecer contexto / escalar tier / cambiar estrategia (micro-replan) / revisión humana / **parar a los 3 fallos** — nunca retry ciego, siempre acotado por presupuesto.

## Alternativas consideradas

- **Calidad como preferencia configurable a la baja** — descartada: rompe la garantía anti-cutre.
- **ROI computado del valor** — descartada: falsa precisión; se usa importancia declarada.
- **Feedback → regla inmediata** — descartada: contamina (memoria basura).
- **Retry ciego / siempre escalar a S** — descartada: desperdicia sin diagnosticar.

## Consecuencias

El sistema entrega calidad consistente con coste racional y aprende de Jorge sin perder control. Riesgo aceptado: la **señal de calidad de output** es el eslabón débil (L5) hasta tener un evaluador rico — se empieza con checks baratos + revisión + feedback. Disparador de revisión: si el evaluador de calidad barato deja pasar resultados pobres de forma sistemática → priorizar un evaluador más rico.

## Relacionado

- [[BLOQUE_0_DECISIONES_FUNDACIONALES]] · [[ADR-008 - ModelRouter y AIProvider]]
- [[HOKAGE_AGENT_OPERATING_MODEL]] · [[Economía]] · [[Memory System]]
- [[Resumen Ejecutivo - Decisiones Congeladas]] · [[INDEX]]
