# Resumen Ejecutivo — Decisiones Congeladas
> Categoría: decisiones
> Migrado desde `HOKAGE_CORE_SPECIFICATION_v1.md` §16 — Fase 7 de la migración documental

---

## Congelado sin más discusión (🔒)

Arquitectura en capas del Core · Runtime/Scheduler/Event Bus (contrastado contra investigación previa del proyecto — R1-R4 ya implementadas) · Contrato de Tool como sistema de plugins · Diseño de plugins visuales del mapa · Modelo de economía (agent_costs/agent_budgets/ventures) · VPS y despliegue · **Modelo multi-venture, implementado y verificado** (§3) · **Sistema de permisos single-owner sin hardcode** (§11.1, implementado) · **Arquitectura de gestión de secretos v2** (§11.2 — `SecretProvider`, capacidades, scope por venture) · **Hermes y Claude como los dos motores del ecosistema v2** (§9 — Hermes personifica el Runtime y coordina permanentemente; Claude como consulta profunda estructurada vía Decision, no API automática) · **Registro de paneles especializados por sala** (§13 — reabierto tras contrastar contra VISION.md completo) · **Migración de marcadores de texto a Tool Calling, implementada** (§2 — MEMORIA/TENDENCIA/CONTENIDO/DECISION son Tools reales) · **Memory System v3, arquitectura completa lista para implementar** (§6 — elegido como siguiente sistema tras comparar contra Founder Profile/Secret Management/Hermes v2; dos tools distintas para dos semánticas de escritura, `venture_id` estructural como prerrequisito cerrado, puntos de enganche verificados contra código real) · **Founder Profile v2, arquitectura completa lista para implementar** (§12.2 — segundo sistema de la fase de diseño; tool `founder.remember` dedicada, lectura acotada al rol `ceo`, "lecciones de negocios anteriores" redirigidas a `memory_entries` en vez de duplicar almacenamiento) · **Plugin System, arquitectura completa** (§8.6 — tercer sistema de la fase de diseño; taxonomía Tool/Plugin/Business Module/Integración/MCP, ciclo de vida completo — descubrir/instalar/habilitar/versionar —, `plugin_role_grants` cierra la parte de §4 que de verdad hacía falta cerrar sin reabrir su decisión de fondo, seguridad sin sandboxing como trade-off explícito) · **La Fundación (Wizard v2), arquitectura completa** (§12.3 — sexto y último sistema; rediseñada como experiencia de fundación dentro del World Engine, no formulario — modelo de tres niveles de agentes pre-existentes/construidos/descubiertos, cuatro arquitecturas comparadas, autocrítica que corrigió una contradicción real y un bug de resumibilidad antes de congelar).

## Metodología de la fase de diseño — ✅ completada (6/6 sistemas, 2026-08-04)

Tras cerrar la migración de §2, Jorge fijó un modo de trabajo explícito: **diseñar completamente un sistema → revisarlo críticamente → congelarlo → pasar al siguiente**, manteniendo siempre distinción clara entre "sistema diseñado" y "sistema implementado" — sin escribir código durante esta fase. Los seis sistemas objetivo están todos diseñados: Memory System (✅ §6), Founder Profile (✅ §12.2), Secret Management (✅ §11.2), Hermes v2 (✅ §9.1), Plugin System (✅ §8.6), La Fundación/Wizard (✅ §12.3). **La fase de diseño se cierra formalmente aquí.** A partir de ahora el modo de trabajo por defecto es solo construir, siguiendo el orden de dependencias entre estos sistemas — reabrir un diseño ya congelado exige un problema arquitectónico crítico real, no una mejora incremental. Razón explícita de Jorge: evitar el bucle de "mejoramos otra vez el diseño" que nunca termina en producto.

## Decidido aquí por primera vez (🆕)

Definición de Business Module · Postura sobre MCP (no adoptar en v1) · System Profile (§12.1) · Alcance definitivo del Setup Wizard (§12.3, definido pero sin el mismo nivel de detalle que Memory System/Founder Profile todavía — candidato de esta fase de diseño).

## Pausa estratégica de esta ronda — qué cambió y por qué

Antes de seguir implementando, Jorge pidió una relectura completa contra `VISION.md` y la investigación ya existente en el proyecto (`docs/research/world-engine/`, ver [[RimWorld - Arquitectura de Simulación]] y [[Prison Architect - Arquitectura de Sistemas Complejos]]). Encontró — y Claude confirmó, no rechazó — dos decisiones de la v1 que no coincidían con la visión real:

1. **Hermes estaba mal dimensionado.** Diseñado como utilidad estrecha y pausada; debía ser el coordinador permanente del ecosistema. Corregido en §9.1 — ver [[Hermes y Claude - Los Dos Motores]].
2. **El patrón de sala genérica no cumplía `VISION.md`.** El documento pedía salas radicalmente distintas entre sí desde el primer día; la v1 congeló un patrón único de 7 pestañas sin haber leído `VISION.md` completo antes de hacerlo. Corregido en §13, con la regla explícita de no construir paneles con datos falsos (Tienda queda bloqueada hasta Fase 6, no simulada).

También se incorporó investigación del propio proyecto (`prison-architect.md`, `rimworld.md`) que nunca se había cruzado contra el documento — confirmando que el Runtime ya sigue R1-R4 sin que se supiera, y dejando R5/R7 anotadas.

## Auditoría crítica final pre-lanzamiento — un hallazgo real, no cero

Antes de autorizar implementación del resto del sistema, se hizo la pregunta explícita: *¿existe alguna decisión que dentro de 1-2 años obligue a reconstruir algo importante?* Respuesta honesta: **sí, una** — el sistema de marcadores de texto (`[DECISION:]`, `[TENDENCIA:]`, `[CONTENIDO:]`, `[MEMORIA:]`) que hoy convive, de forma inconsistente, con el mecanismo de Tool Calling ya construido y funcionando (§8.2). Jorge aceptó la recomendación sin reservas: **migración incremental y compatible hacia atrás de los 4 marcadores a Tools reales, en el orden TENDENCIA → CONTENIDO → MEMORIA → DECISION** — ver §2, "De marcadores de texto a Tool Calling" ([[Runtime, Scheduler y Event Bus]]). `operaciones`/`soporte` corren en un modelo sin tool-calling fiable (Llama 3.1 8B) — para ellos el regex de `MEMORIA`/`DECISION` no se retira nunca, no es un detalle menor. El resto de riesgos encontrados en esa auditoría (ausencia de paginación en la API, cero tests automatizados, `decisions.entity_type/entity_id` sin integridad referencial, acoplamiento a OpenRouter en `aiService.ts`) se evaluaron como deuda gestionable con disparador explícito, no como bombas de relojería — ya incorporados a §14 ([[Escalabilidad]]).

## Migración marcadores → Tool Calling — ✅ completada (4/4 fases, 2026-08-04)

Las cuatro fases (`trend.report`, `content.create`, `memory.write`, `decision.create`) están construidas, conectadas y verificadas con ejecución real, cada una en su propio commit, siguiendo exactamente la disciplina fijada al aprobar el plan — ver §2 para el detalle completo de cada fase, incluidos dos hallazgos reales encontrados y corregidos durante la construcción (el riesgo de ciclo de imports con `aiService.ts`, y el campo `description` que dejó de venir "gratis" al migrar de texto libre a tool). **Estado honesto, no optimista:** los 6 roles tool-capable ya no reciben la instrucción del marcador migrado en el prompt, pero el regex de compatibilidad sigue en el código para los 4 marcadores — retirarlo del todo (posible solo para `TENDENCIA`/`CONTENIDO`) es una decisión aparte, pendiente de datos de producción reales, no tomada en esta ronda. `operaciones`/`soporte` (Llama 3.1 8B) se quedan en `MEMORIA`/`DECISION` por marcador de forma permanente, por diseño.

## Elección del siguiente sistema — Memory System v2, no Founder Profile

Con la migración cerrada, tocaba decidir qué sistema construir a continuación mientras el sistema acumula evidencia real de la migración (fase de estabilización, sin más cambios al Runtime por ahora). Jorge propuso Founder Profile como candidato; se comparó contra los otros tres sistemas ya especificados pero no implementados (Memory System, Secret Management, Hermes v2) contra el filtro de 4 preguntas de §0 y contra dependencias externas reales — no se aceptó la sugerencia sin más, como pide la directriz de arquitecto-jefe.

**Ganador: Memory System v2.** Es el único que cumple dos de las cuatro preguntas de §0 con fuerza (mejores decisiones autónomas, menos intervención de Jorge) y no depende de nada externo (FTS5 nativo). Founder Profile solo cumple una (comprende mejor a Jorge) y su alcance es más estrecho (principalmente el razonamiento del CEO). Secret Management depende de integraciones que todavía no existen (Fase 6, sin fecha) y necesita credenciales reales de terceros para verificarse de verdad — no solo diseño. Decisivo además: la Fase 3 de la migración de marcadores (§2) construyó, sin buscarlo, la mitad del mecanismo de escritura que Memory System necesita (`memory.write` ya existe) — aprovechar ese momentum directamente pesó más que "es lo que propuse primero".

**§6 se reescribió como v3, arquitectura completa lista para implementar** — no solo el schema de la v2, sino los puntos de enganche exactos verificados contra el código real (incluye un hallazgo honesto: "objetivo abandonado" nunca se dispara en el código actual, no se construye ese hook), la corrección de un error de diseño de la v2 (`memory.write` no se reutiliza con un parámetro — nace una tool nueva, `memory.remember`, porque mezclar upsert-privado con log-empresarial en una sola tool repetía justo el tipo de ambigüedad que la migración de §2 eliminó), y el cierre de un prerrequisito real que se venía posponiendo: `venture_id` pasa a ser un campo estructural en `AgentTask`/`ToolContext` (hoy solo existe como texto `[VENTURE: ...]`), necesario porque Memory System **lee** por venture, no solo escribe. Ver [[Memory System]].

## Ya no queda ninguna decisión ⚠️ pendiente de confirmación

Todas las de esta ronda y las anteriores están resueltas. Lo que queda es **diseño ya especificado pero no implementado**: Memory System v3 (§6, siguiente en la cola de implementación), Secret Management completo, Hermes v2, paneles por sala.

## Bloqueante real para el Setup Wizard

Sin cambios: el **Fresh Install Wizard** se puede construir ya. El **New Venture Wizard** depende de implementar §11.2 si el primer venture nuevo necesita credenciales propias.

---

## Relacionado

- [[Núcleo - Arquitectura del Core]]
- [[Runtime, Scheduler y Event Bus]]
- [[Memory System]]
- [[Founder Profile y La Fundación]]
- [[Plugin System - Arquitectura Completa]]
- [[Modelo Multi-Venture]]
- [[Hermes y Claude - Los Dos Motores]]
- [[Escalabilidad]]
- [[INDEX]]
