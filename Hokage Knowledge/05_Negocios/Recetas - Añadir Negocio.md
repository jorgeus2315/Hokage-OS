> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §15. Síntesis operativa de las decisiones congeladas del documento, en el mismo formato que [[ARCHITECTURE (legacy)]] §12 (que sigue siendo válido en estructura, se actualiza aquí en contenido).

## 15. Recetas: añadir negocio / agente / plugin

### Añadir un negocio nuevo

1. `POST /api/ventures` (ya existe).
2. Si aplica, crear un `Objective` con `venture_id` (una vez resuelto [[Modelo Multi-Venture|§3]]).
3. Si el negocio usa un canal nuevo (Etsy, Shopify...), ver "añadir un Business Module" abajo.
4. No se toca código — los agentes existentes atienden el venture nuevo via contexto ([[Modelo Multi-Venture|§3]]).

### Añadir un departamento nuevo

1. Fila nueva en `departments` (`key`, `name`, `role` opcional si va a tener agente propio, `glyph`, `color`).
2. No se toca el frontend — [[Crecimiento de la Ciudad - World Engine|el WorldLayoutEngine]] posiciona el edificio automáticamente (anillo actual, o distrito nuevo si el anillo está lleno), sin `pos_x`/`pos_y` manuales salvo que Jorge quiera fijarlos.
3. Si necesita panel especializado propio (no solo las pestañas genéricas), registrar en `roomPanels.ts` (ver [[Frontend - Decisiones v2|§13 v3]]) — opcional, un departamento sin panel especializado sigue siendo funcional con las pestañas base.
4. Departamentos son permanentes y compartidos entre ventures — nunca se crea uno nuevo por negocio (ver [[Modelo Multi-Venture|§3]] / [[ADR-006 - Multi-Venture]]).

### Añadir un agente nuevo (rol ya existente en `AGENT_MODELS`/`AGENT_TOOLS`/`AUTONOMOUS_TASKS`)

1. `POST /api/agents` con el rol existente.
2. `PUT /api/agents/:id/prompt` con su personalidad.
3. Crear su `department` si necesita sala propia en el mapa.

### Añadir un rol de agente completamente nuevo (comportamiento nuevo)

Requiere tocar código hoy (ver [[Agentes - Modelo y Decisión|§4]]) — no automatizable en v1: registrar en `AGENT_MODELS`, `AGENT_TOOLS`, `AUTONOMOUS_TASKS`.

### Añadir un plugin (tool nuevo que un agente puede invocar)

1. Clase `Tool` nueva en `tools/index.ts` (contrato en `tools/base.ts`, ver [[Plugin System - Arquitectura Completa|§8.2]]).
2. Registrar en `tools/registry.ts`.
3. Añadir su id a `AGENT_TOOLS` para el rol que lo use.
4. Si necesita garantía de aprobación real, implementarla dentro de su propio `execute()` (nunca confiar en `requiredApproval` como si fuera aplicado por la plataforma — no lo es).

### Añadir un Business Module

Ver [[Plugin System - Arquitectura Completa|§8.4]] — es composición de lo anterior (canal + Tool + Automations por defecto), no un mecanismo nuevo.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Modelo Multi-Venture]] — receta de negocio, desarrollo completo
- [[Agentes - Modelo y Decisión]] — receta de agente y de rol nuevo
- [[Plugin System - Arquitectura Completa]] — receta de plugin y Business Module
- [[Crecimiento de la Ciudad - World Engine]] — receta de departamento, desarrollo completo
- [[ARCHITECTURE (legacy)]] §12 — formato original de estas recetas
