# ADR-016 — Hokage como Jarvis: Asistente Omnicapaz y Mundo Generativo Editable

> Categoría: decisión de arquitectura (visión + rumbo)
> Estado: ⏳ Propuesto — dirección aprobada por Jorge (2026-09-01). Blueprint, sin implementación. Se ejecuta por fases, cada una con autorización explícita.
> Relacionado con [[VISION.md]] y la filosofía de §0 de CLAUDE.md (compañero intelectual).

---

## Contexto

Jorge quiere que Hokage sea **un Jarvis** (el de Iron Man): le habla en lenguaje natural de **cualquier cosa** y Hokage **entiende, razona y actúa** — dirige el negocio, genera y edita el mundo (skins de agentes, salas, fondo, HUD), conecta servicios, recuerda. Ejemplo canónico: *"quiero que el personaje del Banco sea un pikachu de pixel"* → Hokage lo genera y lo integra en vivo.

La clave arquitectónica: **"hacer cualquier cosa" NO es una feature única. Es la suma de tres cosas que ya son el diseño de Hokage OS:**
1. Un **modelo bueno** que conversa y razona (el cerebro).
2. Un **ecosistema de tools** que crece (la convención ya guardada: *toda acción estructurada agente↔runtime pasa por Tool Calling*, [[ADR-005 - Tool Runtime y Plugin Contract]]).
3. Un **mundo definido por datos** (agentes, salas, automatizaciones, presupuestos, prompts y visuales viven en BD/registros, no hardcodeados) → **editable**.

Y lo que hace que "hacer cualquier cosa" sea **responsable** en vez de peligroso: los **guardarraíles que ya existen** (autonomía, aprobación de Jorge, presupuesto/coste [[ADR-015 - Presupuesto y Costes - Fuente Única de Verdad e Idempotencia]], SSRF, `requiredApproval`).

## Decisión — principio rector

> **Capacidad = tools. Seguridad = guardarraíles. El mundo = datos editables.**

Hokage crece hacia "Jarvis" **añadiendo tools** (no reescribiendo el núcleo). Cada tool nueva amplía lo que Hokage puede hacer por lenguaje natural; el sistema de **autonomía + aprobación + presupuesto** decide qué puede hacer solo y qué requiere el "sí" de Jorge. El mundo (visual y de negocio) se define en **datos**, así que Hokage puede modificarlo con tools sin tocar código.

## Modelo de capacidades (familias de tools)

| Familia | Qué permite | Estado |
|---|---|---|
| **Conversar / razonar** | Hablar de cualquier cosa, con memoria y contexto | ✅ Existe (chat de Torre Hokage + LLM) |
| **Dirigir el negocio** | Planificar → despachar → evaluar → remediar (orquestación) | ✅ Existe ([[ADR-009 - Hokage Cadena de Orquestación]], [[ADR-012 - Task Graph DAG y Directed Hand-off]]) |
| **Recordar** | Memoria privada + de negocio | ✅ Existe ([[ADR-004 - Memory System]]) |
| **Generar/editar lo VISUAL** | `asset.generate`, `skin.set`, `world.theme`, `hud.configure` — el mundo generativo | 🟡 Nuevo (este ADR) |
| **Editar CONFIGURACIÓN** | Cambiar automatizaciones, presupuestos, prompts, roles vía tools sobre el config data-driven | 🟡 Nuevo (exponer con tools lo que ya es dato) |
| **Conectar SERVICIOS** | Etsy/Shopify/proveedores de imagen/etc. como providers+tools | 🟡 Parcial (Etsy lectura) |
| **Voz (Jarvis literal)** | Hablar/escuchar por voz | ⏳ Contemplado ([[Arquitectura de Voz - Hermes]]) |

Regla de oro: **cambiar datos/assets** (un sprite, un fondo, una sala) es fácil y seguro; **cambiar comportamiento/HUD/layout** es config o código y va con más guardarraíles. Se empieza por lo primero.

## El mundo generativo (sistema de skins + generación)

Tu motor ya es *skinnable* por diseño: el `VisualKindRegistry` mapea cada entidad (agente/sala/hub) a una definición visual; `AnimationRegistry` separa animación de dibujo; `palette` es la fuente de color. Extensión:

1. **Skin = pack de datos**: spritesheet(s) + mapeo (rol→sprite, departamento→tileset, mundo→tema) + paleta. Vive en BD → **editable en vivo**, por agente / por sala / global.
2. **Render por sprite**: un `VisualKindDefinition` basado en `AnimatedSprite` que sustituye a las formas geométricas actuales, elegido por la skin activa.
3. **Tool `asset.generate`**: Hokage la llama con un prompt → proveedor de imagen → **pipeline de normalización** (downscale a rejilla, quantize a paleta, quitar fondo, empaquetar spritesheet) → guarda el asset → actualiza el mapeo de skin → el frontend cambia el sprite en caliente.
4. **Presupuesto + aprobación**: generar imagen cuesta dinero → pasa por Decision/aprobación y se registra en `agent_costs` (reutiliza [[ADR-015 ...]] — reserve-then-settle ya cubre esto).

**Proveedor de imagen (frontera nueva, mismo patrón que [[ADR-008 - ModelRouter y AIProvider]]):** para pixel-art coherente y **animado**, herramientas especializadas (Retro Diffusion / PixelLab / Scenario / SD+LoRA) por encima de genéricos (FLUX / gpt-image / Imagen). El **cerebro** de Hokage sigue por OpenRouter (Claude Sonnet/Opus para razonamiento + tool-calling).

## Modelo de seguridad (por qué "cualquier cosa" es viable)

"Cualquier cosa" NO significa "sin control". Los guardarraíles existentes son lo que lo hace responsable:
- **Autonomía por rol** (`rolePolicy`): Nivel 0 observa; niveles altos actúan.
- **Aprobación de Jorge** (Decisions): todo lo que **gasta dinero, publica o es irreversible** requiere su "sí".
- **Presupuesto/coste** ([[ADR-015 ...]]): techo por venture + reserva antes de gastar; generar assets cuesta y se controla.
- **`requiredApproval` por tool** + SSRF + validación de entrada.

Invariante: **la capacidad crece por tools; la seguridad crece por el sistema de guardarraíles.** Nunca una tool destructiva o con coste sin aprobación.

## Qué existe vs qué es nuevo

- **Ya está**: Hokage conversacional, loop de tool-calling, frontera de proveedor, orquestación DAG, memoria, autonomía, aprobaciones, presupuesto/coste, visuales por registro.
- **Nuevo**: proveedor de imagen + pipeline de assets, tools generativas/de skin, tools de edición de config (exponer automatizaciones/presupuestos/prompts a Hokage con aprobación), modelo de datos de skin, capa de HUD/mundo editable, y conectar servicios en la VPS.

## Roadmap (cada fase pasa el filtro de las 4 preguntas de §0)

1. **Cerebro vivo**: OpenRouter en la VPS → Hokage habla y los agentes ejecutan con las tools que ya hay. (Desbloqueo nº1, barato.)
2. **Arquitectura de skins** (data-driven, editable) — sin arte todavía. Contrato de skin + registro + `VisualKindDefinition` de sprite.
3. **Generación**: proveedor de imagen + tool `asset.generate` + pipeline. **Spike**: cambiar el sprite de un agente desde el chat de Hokago ("el del banco, pikachu pixel").
4. **Edición de config por lenguaje natural**: tools para automatizaciones/presupuestos/prompts, con aprobación.
5. **HUD/mundo editables**; más adelante, personajes que caminan, vehículos, minimapa, modo edición.
6. **Voz** (Jarvis literal) cuando el resto sea sólido.

## Lo que este ADR NO promete (honestidad)

- No hay magia: "hacer cualquier cosa" es un **asíntota** que se alcanza añadiendo tools, no un interruptor. Cada capacidad es trabajo real.
- **Consistencia y animación** de pixel-art generado es lo más difícil (una imagen bonita ≠ spritesheet limpio y animado en tu rejilla). Necesita herramienta especializada + pipeline + humano en el bucle.
- Editar **comportamiento/código** por lenguaje natural es mucho más delicado que editar **datos/assets**; se prioriza lo segundo y lo primero va con guardarraíles fuertes.
- Nada de esto sustituye la base: si el cerebro (proveedor de IA) no está conectado, el mundo más bonito está quieto.

## Relacionado

- [[VISION.md]] — el mundo vivo, el fundador que solo toma grandes decisiones.
- [[ADR-005 - Tool Runtime y Plugin Contract]] — tools como único mecanismo de acción.
- [[ADR-008 - ModelRouter y AIProvider]] — frontera de proveedor (se añade el de imagen).
- [[ADR-009 - Hokage Cadena de Orquestación]] · [[ADR-012 - Task Graph DAG y Directed Hand-off]] — Hokage dirige.
- [[ADR-015 - Presupuesto y Costes - Fuente Única de Verdad e Idempotencia]] — coste/aprobación de la generación.
- [[ADR-004 - Memory System]] · [[Arquitectura de Voz - Hermes]] · [[INDEX]]
