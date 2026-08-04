# ADR-001 — World Engine
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado, parcialmente implementado
> Sintetizado desde `HOKAGE_CORE_SPECIFICATION_v1.md` §1 y §13 — Fase 7 de la migración documental

---

## Contexto

El mapa de Hokage OS necesita representar el estado real del backend como un mundo vivo — departamentos, agentes, actividad — sin que el frontend invente lógica de negocio propia (§0, principio rector). `FRONTEND_WORLD_ENGINE.md` especifica 7 fases para este motor. Antes de diseñarlo desde cero se cruzó contra investigación real ya existente en el proyecto sobre motores de simulación comerciales: [[RimWorld - Arquitectura de Simulación]], [[Software Inc - Arquitectura de Simulación Empresarial]], [[Prison Architect - Arquitectura de Sistemas Complejos]], [[Factorio - Arquitectura de Simulación de Flujos]].

## Decisión

**Motor propio en PixiJS, aislado por completo del React Shell.** El mundo vivo se pinta en un único `<WorldCanvas/>`; todo lo demás (vistas, paneles, HUD) es DOM. Nunca se mezclan las dos capas de renderizado (§1).

El desarrollo sigue las 7 fases de `FRONTEND_WORLD_ENGINE.md`. Estado real verificado (más avanzado que lo que el propio documento marcaba como pendiente):

| Fase | Estado |
|------|--------|
| 0 — Diseño arquitectónico + mapa DOM/CSS | ✅ Hecho |
| 1 — World Engine mínimo con PixiJS, paridad visual | ✅ Hecho |
| 2 — Cámara libre: pan, zoom, minimapa | ✅ Hecho |
| 3 — Departamentos como datos en BD | ✅ Hecho |
| 4 — Agentes visibles con estado real | ✅ Hecho |
| 5 — Eventos reales → animaciones | 🔶 Parcial |
| 6 — Vista de departamento y ficha de agente | Pendiente |
| 7 — Modo edición (drag, add, resize) | Pendiente |

Cualquier reacción visual a un evento del bus se define como **tabla de reacciones**, nunca como `if`/`switch` disperso — ya especificado en `FRONTEND_WORLD_ENGINE.md §3.3`. El "Animation Director" formal descrito ahí todavía no se extrajo como módulo — hoy vive como lógica ad-hoc en `useWorldState.ts`. Deuda reconocida, no bloqueante.

## Aportación de la investigación de motores de simulación

Contrastar el Runtime y el World Engine contra RimWorld/Prison Architect (nunca cruzado antes contra este documento) confirmó que el Runtime ya sigue, sin saberlo, patrones investigados con rigor (ver [[ADR-002 - Agent Runtime]], tabla R1-R7). Del lado visual, el hallazgo pendiente es:

**R7 — overlays de datos activables** (actividad, presupuesto, pipeline, salud — visualización directa del modelo de datos, sin lógica adicional) está identificado como valioso desde hace días y **todavía no se ha construido**. Es la forma más literal de "el mapa no debe ser decoración" — Hermes (§9.1) ya resuelve esto hablado; el mapa debería resolverlo visualmente. Se anota como el siguiente candidato real del World Engine.

## Consecuencias

- El aislamiento estricto PixiJS/React evita que el mapa acumule lógica de negocio duplicada — cualquier estado que muestre viene siempre de una consulta real al backend.
- La deuda del Animation Director (reacciones hardcodeadas en `useWorldState.ts` en vez de una tabla de reacciones formal) crece con cada evento nuevo que se anima — extraerlo como módulo es limitado en coste hoy, más caro cuanto más se posponga.
- Los overlays de datos (R7) son el puente natural entre la investigación de motores de simulación y el producto real — construible con datos que ya existen (`agent_budgets`, `work_items.priority`, estado de sala), sin depender de integraciones externas todavía no construidas.

## Actualización 2026-08-05 — arquitectura de edificios y World Engine cerrada

Tras este ADR se resolvieron, con decisión explícita de Jorge, todas las piezas de arquitectura que quedaban abiertas sobre el mapa: qué representa cada edificio y cómo se organizan los ventures ([[Frontend - Decisiones v2|§13 v3]]), el modelo de crecimiento de la ciudad ([[Crecimiento de la Ciudad - World Engine]]) y la capa ambiental ([[Ciclo Día-Noche - World Engine]]). Este ADR mantiene su alcance original (paridad PixiJS, fases 0-5); las decisiones nuevas viven en sus propias notas para no sobrecargar un registro histórico con contenido que sigue evolucionando.

## Relacionado

- [[Frontend World Engine]]
- [[Frontend - Decisiones v2]]
- [[Crecimiento de la Ciudad - World Engine]]
- [[Ciclo Día-Noche - World Engine]]
- [[RimWorld - Arquitectura de Simulación]]
- [[Software Inc - Arquitectura de Simulación Empresarial]]
- [[Prison Architect - Arquitectura de Sistemas Complejos]]
- [[Factorio - Arquitectura de Simulación de Flujos]]
- [[ADR-002 - Agent Runtime]]
- [[Resumen Ejecutivo - Decisiones Congeladas]]
- [[INDEX]]
