# Núcleo — Arquitectura del Core

> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §0 y §1 (fuente de verdad vigente, 2026-08-04). Congelado.

---

## 0. Principio rector

🔒 **CONGELADO** — ya establecido en [[Frontend World Engine]] §0 y en `CLAUDE.md`, se ratifica sin cambios:

> El frontend no tiene estado propio de negocio. Es una proyección del estado del backend. Ninguna pantalla inventa datos ni lógica de negocio. Si algo se mueve en la interfaz es porque un evento del backend dijo que se moviera.

A esto se añade el principio que gobernó la sesión de limpieza previa a este documento, y que se congela aquí formalmente:

> **Toda decisión de arquitectura debe responder cinco preguntas antes de construirse:** ¿aporta valor?, ¿es coherente?, ¿complica la experiencia?, ¿duplica algo?, ¿cómo afecta dentro de tres años? Si existe una solución más simple, se elige esa. Hokage OS es un sistema elegante, no un catálogo de funciones.

---

## 1. Arquitectura del Core

🔒 **CONGELADO** — verificado contra el código real, no contra el [[ARCHITECTURE (legacy)]] original (que describe una capa de tools con `ZodSchema` y clases `BaseTool` que nunca existieron; el código real usa un `Tool` interface más simple con `inputSchema`/`outputSchema` como objetos planos — ese es el contrato real y el que se congela).

### Capas (backend)

```
rutas (server.ts)  →  servicios (services/*.ts)  →  db (db/init.ts, run/get/all)
                    ↘  runtime (config/agentRuntime.ts)  →  aiService.ts  →  OpenRouter
                    ↘  bus en memoria (config/eventBus.ts)  →  WebSocket broadcast
```

- **Un único fichero de rutas** (`server.ts`). No hay routers separados — se intentó una vez (`routes/progress.ts`) y se retiró en esta sesión precisamente porque era la única excepción al patrón. **Regla fija: toda ruta HTTP vive en `server.ts`.**
- **Servicios son la única capa que toca SQL.** Las rutas nunca escriben SQL directo salvo consultas triviales de un solo `SELECT`/`UPDATE` sin lógica (ventures, assets, automations siguen este patrón más laxo hoy — ver [[Plugin System - Arquitectura Completa]], es una inconsistencia menor, no se resuelve en v1).
- **`db/init.ts` es la única fuente del schema.** Las migraciones son siempre aditivas (`ALTER TABLE ... ADD COLUMN`, con `columnExists()` de guarda) o `CREATE TABLE IF NOT EXISTS`. Nunca se borra una columna en código — si una tabla queda huérfana, se elimina explícitamente con confirmación humana (como se hizo con las 8 tablas legacy de esta sesión), nunca mediante una migración automática.
- **El punto de extensión para "aprobar X dispara Y real" es `decisionResolvers.ts`.** Mapa `entity_type → resolver`, no `if` sueltos en las rutas. Cualquier decisión futura que necesite ejecutar algo real tras la aprobación de Jorge (nuevo negocio, nuevo plugin, lo que sea) se registra ahí. **Este es el seam central de todo el sistema de aprobación — cualquier feature de auto-configuración que necesite "Jorge aprueba X" pasa por aquí, no inventa su propio mecanismo.**

### Capas (frontend)

```
useAppData.ts (hook único de datos)  →  GameLayout.tsx (orquestador)  →  vistas (views/*.tsx)  →  paneles (panels/*.tsx)
```

- Un único hook (`useAppData`) es la fuente de todo el estado remoto. Las vistas no hacen fetch propio salvo datos que solo ellas necesitan (`OutputsPanel`, `TerminalPanel`, `ConfigView` hacen su propio polling porque su dato no es global).
- El **World Engine** (PixiJS) vive aislado del React Shell — ver [[Frontend World Engine]] y [[Frontend - Decisiones v2]]. Nunca se mezclan: el mundo vivo se pinta en un único `<WorldCanvas/>`, todo lo demás es DOM.

### Lo que nunca cambia (ratificado de [[ARCHITECTURE (legacy)]] §12, sigue siendo cierto)

- La estructura de carpetas del backend (`config/`, `db/`, `services/`, `tools/`, `types/`).
- El contrato del Event Bus: emit → listen, nunca persistencia a SQL (ver [[Runtime, Scheduler y Event Bus]]).
- Los tipos centralizados en `types/index.ts` (backend) y `shared/types.ts` (frontend) — nunca duplicados en otro fichero.
- El patrón de aprobación para acciones costosas, públicas o de sistema: se crea una `Decision`, nunca se ejecuta directo.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[VISION]] — identidad de producto que este núcleo sirve
- [[ARCHITECTURE (legacy)]] — versión anterior, parcialmente ratificada aquí
- [[Runtime, Scheduler y Event Bus]] — desarrollo de §2
- [[Escalabilidad]] — desarrollo de §14
