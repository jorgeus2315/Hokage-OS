# Índice de Decisiones de Arquitectura (ADRs) — Hokage OS

> Última actualización: 2026-08-31
> Estado: todos los ADRs listados están **🔒 Congelados** salvo indicación expresa.

---

## Bloque 0 — Decisiones Fundacionales (2026-08-13)

| ADR | Título | Estado | Descripción corta |
|-----|--------|--------|-------------------|
| [[BLOQUE_0_DECISIONES_FUNDACIONALES]] | Decisiones Fundacionales (L1–L10) | 🔒 Congelado | 10 invariantes inmutables: clave de dominio estable, ModelRouter, Hokage autoridad única, Quality Floors, etc. |
| [[Resumen Ejecutivo - Decisiones Congeladas]] | Resumen Ejecutivo | 🔒 Congelado | Vista ejecutiva de las 10 decisiones + estado de implementación K.1–K.5 |

---

## Bloque 1 — Agentes, Orquestación y Evaluación (2026-08-15)

| ADR | Título | Estado | Descripción corta |
|-----|--------|--------|-------------------|
| [[ADR-007 - AgentRuntimeState]] | AgentRuntimeState | 🔒 Congelado | Estado derivado (primary + modifiers) como proyección backend; frontend nunca lo inventa. |
| [[ADR-008 - ModelRouter y AIProvider]] | ModelRouter y AIProvider | 🔒 Congelado | Selección dinámica de modelo por TaskProfile; catálogo como dato; AIProvider como frontera real. |
| [[ADR-009 - Hokage Cadena de Orquestación]] | Hokage Cadena de Orquestación | 🔒 Congelado | Hokage = única autoridad: decompose → validatePlan → dispatch → advance → replan → finalize. |
| [[ADR-010 - Quality Floors, Coste y Revisión]] | Quality Floors, Coste y Revisión | 🔒 Congelado | Suelos de calidad por taskKind×importance; presupuesto por venture; escalera de remediación (seam). |
| [[ADR-011 - Agent Registry y Capability-based Selection]] | Agent Registry y Capability-based Selection | 🔒 Congelado | Registry con capabilities declarativas, agent_type (business/system/utility), matching determinista. |
| [[ADR-012 - Task Graph DAG y Directed Hand-off]] | Task Graph DAG y Directed Hand-off | 🔒 Congelado | DAG explícito (depends_on, handoff, review_of) reemplaza phase; validación Kahn; review cycles acotados. |
| [[ADR-014 - Result Evaluation y Diagnostic Remediation]] | Result Evaluation y Diagnostic Remediation | 🔒 Congelado | Evaluación estructurada (verdict/confidence/evidence/diagnosis) + escalera 4 peldaños + LLM opcional. |
| [[ADR-015 - Presupuesto y Costes - Fuente Única de Verdad e Idempotencia]] | Presupuesto y Costes: Fuente Única de Verdad e Idempotencia | ⏳ En implementación | `agent_costs` única fuente de coste; `agent_budgets` solo config; gasto mensual derivado; reserve-then-settle autónomo; sin `execution_id`. **Pasos 1-4 hechos** (2026-09-01); 5+ pendientes. |
| [[ADR-016 - Hokage como Jarvis - Asistente Omnicapaz y Mundo Generativo]] | Hokage como Jarvis: Asistente Omnicapaz y Mundo Generativo | ⏳ Propuesto | Blueprint: capacidad=tools, seguridad=guardarraíles, mundo=datos editables. Skins pixel-art generadas por IA + edición por lenguaje natural, con presupuesto/aprobación. |
| [[ADR-017 - Blueprint Técnico del Sistema de Mundo Vivo]] | Blueprint Técnico del Sistema de Mundo Vivo | ⏳ Propuesto | 2ª pasada de ADR-016: World Model, estado vivo, eventos, movimiento con propósito, personajes/sprites, assets, edición por Hokage, renderer, persistencia, realtime, extensibilidad y roadmap por fases. EXTIENDE el ECS actual, no lo reescribe. |

> **Nota**: ADR-013 reservado para futura decisión sobre "Venture Lifecycle & Activation" (Fase 12+).

---

## ADRs Históricos (Fases 0–4, 2026-08-04)

| ADR | Título | Estado | Notas |
|-----|--------|--------|-------|
| [[ADR-001 - World Engine]] | World Engine | 🔒 Congelado | Mapa PixiJS, edificios, niebla, posiciones. |
| [[ADR-002 - Agent Runtime]] | Agent Runtime | 🔒 Congelado | 8-stage FSM, scheduling, tools, WebSocket. |
| [[ADR-003 - Event Bus]] | Event Bus | 🔒 Congelado | EventEmitter in-process, persistencia vía subscriber. |
| [[ADR-004 - Memory System]] | Memory System | 🔒 Congelado | agent_memory (privada) + memory_entries (negocio). |
| [[ADR-005 - Tool Runtime y Plugin Contract]] | Tool Runtime y Plugin Contract | 🔒 Congelado | Tool interface, GRANTABLE_TOOLS, SYSTEM_ONLY_TOOLS. |
| [[ADR-006 - Multi-Venture]] | Multi-Venture | 🔒 Congelado | Venture = contenedor genérico; departamentos estables; aislamiento estricto. |

---

## Navegación por Tema

### Agentes y Runtime
- [[ADR-002 - Agent Runtime]] — Motor base (fase 1)
- [[ADR-007 - AgentRuntimeState]] — Estado derivado (Bloque 0)
- [[ADR-011 - Agent Registry y Capability-based Selection]] — Registry, capabilities, matching (Bloque 1)

### Modelos y Proveedores
- [[ADR-008 - ModelRouter y AIProvider]] — Router dinámico, catálogo, AIProvider (Bloque 0)

### Orquestación y Tareas
- [[ADR-009 - Hokage Cadena de Orquestación]] — Cadena completa (Bloque 0)
- [[ADR-012 - Task Graph DAG y Directed Hand-off]] — DAG, edges, review_of (Bloque 1)

### Calidad, Coste y Evaluación
- [[ADR-010 - Quality Floors, Coste y Revisión]] — Suelos, presupuesto, escalera (Bloque 0)
- [[ADR-014 - Result Evaluation y Diagnostic Remediation]] — Evaluation, diagnosis, remediación (Bloque 1)
- [[ADR-015 - Presupuesto y Costes - Fuente Única de Verdad e Idempotencia]] — Contabilidad de coste: fuente única + idempotencia (⏳ en implementación)

### Visión y Producto
- [[ADR-016 - Hokage como Jarvis - Asistente Omnicapaz y Mundo Generativo]] — Blueprint del Jarvis: tools + guardarraíles + mundo generativo editable (⏳ propuesto)
- [[ADR-017 - Blueprint Técnico del Sistema de Mundo Vivo]] — Spec implementable del mundo vivo: World Model, personajes, movimiento con propósito, assets, edición por Hokage (⏳ propuesto)

### Memoria y Contexto
- [[ADR-004 - Memory System]] — Dual memory system (fase 4)

### Herramientas y Permisos
- [[ADR-005 - Tool Runtime y Plugin Contract]] — Tool contract, policy (fase 2)

### Arquitectura de Negocio
- [[ADR-006 - Multi-Venture]] — Ventures, aislamiento, departamentos (fase 3)
- [[ADR-001 - World Engine]] — Visualización mapa (fase 4)

### Eventos y Comunicación
- [[ADR-003 - Event Bus]] — Nervio central (fase 2)

---

## Convenciones de Nombrado

- **ADR-NNN** — Decisión de arquitectura numerada secuencialmente.
- **Estado**: 🔒 Congelado = no se modifica sin aprobación expresa de Jorge; 🔄 En revisión = abierto a cambios; ⏳ Propuesto = borrador.
- **Wikilinks**: `[[Nombre del archivo]]` (sin extensión `.md`) para navegación cruzada.

---

## Cómo añadir un nuevo ADR

1. Crear archivo `ADR-NNN - Título Corto.md` en esta carpeta.
2. Usar plantilla: Categoría, Estado, Fecha, Contexto, Decisión, Alternativas, Consecuencias, Implementación, Relacionado.
3. Añadir fila en la tabla correspondiente (Bloque 0, Bloque 1, o Históricos).
4. Añadir enlaces `[[...]]` en la sección "Relacionado" de ADRs afectados.
5. Actualizar este `INDEX.md` y `Resumen Ejecutivo - Decisiones Congeladas.md` si es decisión fundacional.
6. Commit con mensaje: `docs: ADR-NNN - Título Corto [congelado]`.

---

## Referencias Rápidas a Código

| Concepto | Archivo(s) clave |
|----------|------------------|
| Agent Registry / Selector | `src/services/agentSelector.ts` (nuevo, ADR-011) |
| Task Graph / DAG | `src/config/taskGraph.ts`, `src/services/hokageOrchestrator.ts` (ADR-012) |
| Evaluation / Remediation | `src/services/taskEvaluator.ts`, `src/services/remediationLadder.ts` (ADR-014) |
| ModelRouter | `src/config/modelRouter.ts`, `src/config/modelCatalog.ts` (ADR-008) |
| Hokage Orchestrator | `src/services/hokageOrchestrator.ts` (ADR-009, 012) |
| Agent Runtime | `src/services/agentRuntime.ts` (ADR-002, 007, 014) |
| Role Definitions | `src/services/roleService.ts`, `src/config/roleSeeds.ts` (ADR-011) |
| Venture Budget / Coste | `src/services/ventureBudget.ts` (ADR-010); `src/services/aiService.ts` (agent_costs), `src/services/aiProvider.ts` (registerProvider/FakeProvider) (ADR-015) |
| Decisions | `src/services/decisionService.ts`, `src/services/decisionResolvers.ts` |
| Types centrales | `src/types/index.ts` (todos los ADRs) |
| DB Schema | `src/db/init.ts` (migraciones aditivas de todos los ADRs) |

---

## Enlaces Externos

- [[HOKAGE_OS_MASTER_SPEC.md]] — Especificación maestra (archivo raíz del proyecto)
- [[HOKAGE_AGENT_OPERATING_MODEL.md]] — Modelo operativo de agentes (deep-dive)
- [[VISION.md]] — Identidad y feeling del producto
- [[ARCHITECTURE.md]] — Arquitectura completa (capas, contratos, operación)
- [[Roadmap.md]] — Fases, prioridades, estado actual