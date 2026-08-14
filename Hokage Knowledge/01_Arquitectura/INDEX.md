# Hokage OS — Mapa de la bóveda

MOC (Map of Content) de Hokage Knowledge. Auditoría de arquitecto completa el 2026-08-05 — ver nota final. La documentación quedó congelada tras esa auditoría, pero se reabrió el 2026-08-06 por dos hallazgos reales: una nueva [[Auditoría de Arquitectura - 2026-08-06|auditoría de arquitectura]] (deuda técnica y bugs reales encontrados en backend/frontend) y una [[Redefinición de Principios Fundamentales - 2026-08-06|redefinición de principios fundamentales]] (Hermes como Runtime, Hokage como única interfaz, contexto por capas, biblioteca de referencias). Ninguna implementada todavía — son análisis de impacto, no cambios de código.

## 00_Inbox

**Propósito:** captura rápida y temporal. Cualquier nota, idea o hallazgo se anota aquí primero cuando no está claro todavía dónde vive — se procesa y mueve a su carpeta definitiva en la misma sesión o en la siguiente, nunca se queda como almacén permanente. Vacía por defecto entre sesiones; si algo lleva más de una sesión aquí, es señal de que falta decidir su ubicación, no de que el Inbox sea su sitio.

## Pilares (01_Arquitectura)

- [[HOKAGE_OS_MASTER_SPEC]] — **documento ápice (2026-08-13):** referencia arquitectónica de alto nivel, 24 secciones, estado ✅/🟡/🔜 verificado contra código post-F12+B.1. Consolida y sustituye como ápice a los dos siguientes (que quedan como deep-dives). Fundado en la [[Auditoría de Arquitectura - 2026-08-13]] 🆕
- [[BLOQUE_0_DECISIONES_FUNDACIONALES]] — 🔒 **CONGELADO (2026-08-13):** cierre de `AgentRuntimeState`, `ModelRouter`+`AIProvider`, Quality Floors, política de coste, feedback y revisión, + comprobación §Ω "Hokage es una cadena de orquestación, no un ModelRouter". 7 trampas evitadas, invariantes vs configurable, orden K.1–K.7. Genera ADR-007…010. Fundación del Bloque 1.
- [[Especificación Funcional de Producto - v1]] — deep-dive (superado como ápice por el Master Spec): documento de mayor nivel anterior: filosofía, sesión de usuario completa, contratos de Hokage/Hermes/Agentes, conocimiento, memoria multinivel, herramientas, interfaz/escritorio, departamentos, automatización 24/7, escalabilidad, filosofía de configuración — 8 mejoras propuestas justificadas. Nada implementado 🆕
- [[Núcleo - Arquitectura del Core]] — §0+§1 de la especificación, congelado ✅
- [[VISION]] — documento fundacional de producto (extendido por la Especificación Funcional de arriba) ✅
- [[Redefinición de Principios Fundamentales - 2026-08-06]] — Hermes deja de ser agente (es el Runtime), Hokage como única interfaz conversacional, agentes dejan de ser chatbots, contexto por capas, biblioteca de referencias, todo declarativo/configurable/editable (generalizar el patrón Registry del ECS) — filtro permanente "¿esto acerca a sistema operativo o a dashboard?" 🆕
- [[Auditoría de Arquitectura - 2026-08-06]] — nota: 6.5/10, bugs reales encontrados en backend, deuda de diseño real en frontend, 2 huecos de seguridad de bajo coste 🆕
- [[ARCHITECTURE (legacy)]] — versión anterior, superada, conservada como histórico (citada activamente por 7+ notas como "el porqué del cambio") ✅
- [[Prompts Históricos - INIT_PROMPT]] — snapshot de sesión superado, mismo tratamiento que ARCHITECTURE legacy ✅

## 02_Sistemas — un sistema, una nota

- [[Runtime, Scheduler y Event Bus]] (§2) ✅
- [[Goal System]] (§5) ✅
- [[Memory System]] (§6) ✅
- [[Automatizaciones (Agente-Agente)]] (§7) ✅
- [[Economía]] (§10) ✅
- [[Economía v2 - Sistema Financiero]] (séptimo sistema de diseño, extiende Economía sin duplicarla, 2026-08-05) ✅
- [[HOKAGE_MIGRATION_AND_DEPLOYMENT_SPEC]] — **ápice de producción/escalado (documento E, 2026-08-13):** arquitectura VPS, estrategia por 4 etapas (mínimo coste sin bloquear crecimiento), migración Mac→VPS clasificada A/B/C/D/E, contradicciones de producción, y el **orden recomendado de implementación de TODO el sistema**. Reconcilia las dos notas siguientes. Deep-dive de [[HOKAGE_OS_MASTER_SPEC]] §20 🆕
- [[Seguridad, Permisos y VPS]] (§11.1 + §11.3) ✅
- [[Gestión de Secretos y Capabilities]] (§11.2, separada de la anterior el 2026-08-05 — 4+ sistemas la citan como su propio sistema) ✅
- [[Arquitectura de Voz - Hermes]] (octavo sistema de diseño, 2026-08-05) ✅
- [[Founder Profile y La Fundación]] (§12) ✅
- [[Escalabilidad]] (§14) ✅

### 02_Sistemas/World Engine — subcarpeta

Clúster acoplado del mapa/frontend vivo: 4 notas que se citan constantemente entre sí y seguirán creciendo (Fases 6-7 pendientes, overlays R7, modo edición). Los wikilinks sin ruta de carpeta no se ven afectados por vivir en subcarpeta — Obsidian resuelve por título de nota, no por ubicación.

- [[HOKAGE_WORLD_ENGINE_SPEC]] — **ápice del clúster World Engine (documento D, 2026-08-13):** el mundo como proyección del estado REAL del Runtime (no animación decorativa). Contrato `AgentRuntimeState`, 5 capas sin contaminación, auditoría reutilizable-vs-deuda del ECS, migración incremental. Deep-dive de [[HOKAGE_OS_MASTER_SPEC]] §18–§19 🆕
- [[Frontend World Engine]] (spec v1.0) ✅
- [[Frontend - Decisiones v2]] (§13, congelado — v3, 2026-08-05) ✅
- [[Crecimiento de la Ciudad - World Engine]] (noveno sistema de diseño, 2026-08-05) ✅
- [[Plan de Migración ECS]] — **completo, Fases 0-9 implementadas (2026-08-06).** Fase 1 y 2 con validación visual confirmada por Jorge; Fases 3-9 con implementación ✅ pero validación visual manual todavía ⏳ pendiente (corrección honesta: una nota anterior de este índice decía "Fase 3 validada" sin base real — nunca se confirmó, corregido aquí). `WorldEngine.ts` legacy eliminado, patrón `Object.assign(container,{__x})` retirado también de `visuals/`, `EventAdapter`/`WorldLayoutEngine` conectados. Sesión de humo completa en navegador (Fase 9) sigue pendiente — sin herramienta de navegador disponible en esta sesión 🟢
- [[Baseline de Comportamiento - World Engine]] (referencia numérica para validar cada fase, 2026-08-05) ✅
- [[Ciclo Día-Noche - World Engine]] (décimo sistema de diseño, 2026-08-05) ✅

## 03_Agentes

- [[HOKAGE_AGENT_OPERATING_MODEL]] — **modelo operativo objetivo de agentes (documento C, 2026-08-13):** ciclo de vida, contexto por 11 capas, selección de modelo/proveedor por calidad, feedback→conocimiento, aportes dirigidos, coste/beneficio, autonomía por-agente, y el corte invariantes ↔ evolucionable. Deep-dive de [[HOKAGE_OS_MASTER_SPEC]] §2–§14 🆕
- [[Agentes - Modelo y Decisión]] (§4) — deep-dive de decisiones de rol concretas ✅
- [[Hermes y Claude - Los Dos Motores]] (§9) ✅

## 04_Plugins

- [[Plugin System - Arquitectura Completa]] (§8) ✅

## 05_Negocios

- [[Modelo Multi-Venture]] (§3) ✅
- [[Recetas - Añadir Negocio]] (§15, incluye receta de departamento nuevo desde 2026-08-05) ✅

## 06_Investigacion

Alcance: solo investigación técnica que informa decisiones de arquitectura (motores de simulación comerciales). Lo histórico vive en 01_Arquitectura.

- [[RimWorld - Arquitectura de Simulación]] ✅
- [[Software Inc - Arquitectura de Simulación Empresarial]] ✅
- [[Prison Architect - Arquitectura de Sistemas Complejos]] ✅
- [[Factorio - Arquitectura de Simulación de Flujos]] ✅

## 07_Decisiones

- [[Resumen Ejecutivo - Decisiones Congeladas]] (§16) ✅
- [[ADR-001 - World Engine]] ✅
- [[ADR-002 - Agent Runtime]] ✅
- [[ADR-003 - Event Bus]] ✅
- [[ADR-004 - Memory System]] ✅
- [[ADR-005 - Tool Runtime y Plugin Contract]] ✅
- [[ADR-006 - Multi-Venture]] ✅
- [[ADR-007 - AgentRuntimeState]] — estado de agente derivado (primario + modificadores), no inventado por frontend 🔒
- [[ADR-008 - ModelRouter y AIProvider]] — selección dinámica de modelo; catálogo como dato; proveedor tras interfaz 🔒
- [[ADR-009 - Hokage Cadena de Orquestación]] — Hokage no es un ModelRouter; composición como Tasks-con-dependencias, sin tocar el núcleo 🔒
- [[ADR-010 - Quality Floors, Coste y Revisión]] — suelo de calidad como restricción; coste por valor; remediación diagnóstica 🔒

## 08_Memoria

**Propósito:** no espeja `memory_entries` (vive en SQLite, se consulta en vivo cuando Memory System se implemente). Es un destilado curado de retrospectivas y lecciones del uso real de Hokage OS — prosa humana, no filas de tabla. Vacía por diseño hasta que exista una lección real que preservar así — ver [[Propósito de esta carpeta]].

## 09_Roadmap — plan de trabajo vigente

**Propósito:** roadmap de producto y handoffs históricos entre sesiones — distinto de las fases de esta migración documental.

- [[Master Roadmap - v1]] — **plan vigente, 2026-08-06.** Secuencia las 3 fuentes (ADRs congelados, auditoría de arquitectura, redefinición de principios) en 7 fases (A-Consolidación → B-Runtime → C-IA → D-Sistema Operativo → E-Personalización → F-Plugins → G-Escalabilidad), cada una con entregas pequeñas verificables. Resuelve explícitamente el único choque real encontrado (§9.1 Hermes-agente vs principio "Hermes-kernel"). Marca v1.0 vs v2.0 por iniciativa. Cualquier funcionalidad nueva debe encajar aquí antes de implementarse 🆕
- [[Roadmap - Snapshot 2026-08-02]] — histórico, sustituido por el de arriba; se conserva porque su Fase 4 (Etsy) y Fase 5 (VPS) siguen vigentes, ya incorporadas al nuevo roadmap ✅
- [[Handoff Histórico - 2026-08-03]] — log de sesión, vigente solo en que Etsy/VPS seguían sin conectar entonces y siguen sin conectar hoy ✅

## 99_Templates

**Propósito:** plantillas para mantener formato consistente en notas futuras, extraídas de los patrones ya validados por el uso repetido (7 notas de sistema, 6 ADRs). Se amplía solo cuando surja un tercer patrón recurrente real.

- [[ADR Template]] — estructura de decisión de arquitectura
- [[Sistema Template]] — estructura de sistema

## Assets

**Propósito:** diagramas e imágenes referenciados desde las notas. Vacía porque ninguna nota ha necesitado todavía un adjunto binario — las tablas y diagramas ASCII en Markdown han bastado hasta ahora.

---

## Estado de la migración documental

**Completa — 9 de 9 fases (2026-08-05).** Fases 1-5: sistemas core, agentes, plugins, negocios. Fase 6: investigación de motores de simulación. Fase 7: decisiones congeladas y ADRs (sintetizados desde la especificación, no migración literal — `docs/adr/*.md` estaban vacíos). Fase 8: Roadmap y handoff histórico, migrados como snapshots claramente marcados, sin inventar planificación actualizada.

## Auditoría de arquitecto — 2026-08-05

Revisión completa de las 37 notas de la bóveda (contenido, no solo estructura) contra VISION, HOKAGE_CORE_SPECIFICATION, Frontend World Engine, los 6 ADRs, CLAUDE.md (proyecto y global) y el código real de `departments`/`db/init.ts`.

**Cambiado:**
- Dividida [[Seguridad, Permisos y VPS]] → esa nota (§11.1+§11.3) + [[Gestión de Secretos y Capabilities]] (§11.2) nueva — 16 wikilinks actualizados.
- 9 wikilinks a ADRs rotos por nomenclatura (faltaba " - ") corregidos en 8 notas.
- Bidireccionalidad añadida: las 4 notas de investigación ahora enlazan a [[ADR-001 - World Engine]] y [[ADR-002 - Agent Runtime]], que las citan extensamente.
- [[Economía]] y [[Economía v2 - Sistema Financiero]] ahora se referencian mutuamente como extensión, no como reemplazo.
- Receta "añadir departamento nuevo" añadida a [[Recetas - Añadir Negocio]] — existía la arquitectura (WorldLayoutEngine), no la receta operativa.
- Migrada Fase 8: [[Roadmap - Snapshot 2026-08-02]] y [[Handoff Histórico - 2026-08-03]], como snapshots históricos explícitos, no como planificación vigente reescrita.
- Nota de propósito mínima en `08_Memoria`, sin contenido especulativo.
- `docs/adr/*.md` (6 stubs vacíos) y `docs/prompts/INIT_PROMPT.md` (ya migrado) eliminados del repo.
- CLAUDE.md global: corregida la única contradicción arquitectónica real encontrada ("cada negocio = departamento nuevo" contradecía ADR-006) — 2 líneas, sin cambios de estilo.

**Decidido no cambiar, y por qué:**
- **ARCHITECTURE (legacy) e INIT_PROMPT no se eliminan.** Aunque están marcados como superados, 7+ notas los citan activamente como "por qué se cambió de diseño" — tienen valor de memoria institucional real, no son ruido.
- **`docs/research/` (agentes, negocios, economía, integraciones, UI) no se toca.** Contiene investigación real sin migrar, nunca formó parte del plan de Fase 6 — fuera de alcance de esta auditoría, no es legacy sin utilidad.
- **No se fusionó Plugin System ni Founder Profile/La Fundación en notas más pequeñas** pese a su longitud — son sistemas genuinamente unificados (§8.1-8.6 convergen en un mecanismo; §12.1-12.3 son una sola experiencia), dividirlos fragmentaría la razón de ser de cada uno. Distinto del caso de Seguridad, donde §11.2 es un sistema autocontenido citado aparte por otros cuatro sistemas.
- **No se creó jerarquía de subcarpetas más allá de `World Engine/`.** 02_Sistemas con ~16 notas y un único subfolder sigue siendo navegable; más subcarpetas ahora sería estructura para un problema que no existe todavía.

**¿Volvería a tocar la arquitectura antes de que empiece el frontend? No.** Las 10 decisiones de diseño de hoy (World Engine completo, Economía v2, Voz, edificios/Marketing/Banco/Tienda, crecimiento de ciudad, día/noche) están internamente consistentes entre sí, con el código real verificado (`departments` ya existe como tabla, ya tiene 7 filas reales), y sin contradicciones pendientes con VISION/spec/CLAUDE.md. La única inconsistencia que queda anotada — la numeración de fases de `Roadmap.md` (1-6) contra `CLAUDE.md` (0-10) — es de un documento histórico ya marcado como snapshot, no de la arquitectura vigente; no bloquea nada. **La documentación queda formalmente congelada.**
