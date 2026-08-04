> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §13. Congelado — v3 (actualización de edificios, 2026-08-05, sobre la base v2). Capa de decisiones más reciente sobre [[Frontend World Engine]] (spec v1.0) — no la sustituye, la actualiza.

## 13. Frontend: Mapa, HUD, Terminal, las 7 vistas, paneles por sala

🔒 **CONGELADO — v3.** La v1 daba por cerrado el patrón de sala genérica sin haber contrastado contra [[VISION|VISION.md]] completo — corregido en v2. La v3 (2026-08-05) resuelve, con decisión explícita de Jorge, cómo se organizan ventures dentro de los departamentos y unifica cada sala como **centro de control especializado**, no un icono con panel genérico:

- **Departamentos son módulos del sistema, permanecen estables** — ratifica [[ADR-006 - Multi-Venture|ADR-006]]: un venture nuevo nunca genera un edificio nuevo, se organiza dentro de la arquitectura existente.
- **Cada edificio abre una aplicación especializada con datos reales**, no una skin sobre el mismo panel — la tabla de abajo se actualiza con el alcance real pedido para cada sala.

### Mapa (World Engine)

[[Frontend World Engine]] describe 7 fases; el estado real verificado **ya supera lo que el propio documento marca como "pendiente"**: Fase 2 (cámara libre: pan, zoom, minimapa), Fase 3 (departamentos como datos) y Fase 4 (agentes con estado visual real) están hechas. Fase 5 (eventos reales → animación) parcial. **Acción de bajo coste, no bloqueante: actualizar la tabla de fases de ese documento a la realidad.**

**Hallazgo nuevo, de [[Prison Architect - Arquitectura de Sistemas Complejos|docs/research/world-engine/prison-architect.md]] (investigación real del proyecto, nunca antes cruzada contra este documento):** la recomendación **R7 — overlays de datos activables** (actividad, presupuesto, pipeline, salud, visualización directa del modelo de datos) está identificada como valiosa desde hace días y **nunca se incorporó aquí ni se construyó**. Es la forma más literal de "el mapa no debe ser decoración" — que Hermes ([[Hermes y Claude - Los Dos Motores|§9.1]]) ya empieza a resolver **hablado**, pero el mapa debería resolverlo **visualmente**. Se anota como el siguiente candidato real del World Engine, no bloqueante para lo que sigue, pero no se vuelve a perder de vista.

**Arquitectura del World Engine cerrada (2026-08-05):** las dos piezas que quedaban sin diseñar del mapa están ahora congeladas — [[Crecimiento de la Ciudad - World Engine]] (fases anillos → distritos/islas → campus, sin tocar el modelo de datos de `departments`) y [[Ciclo Día-Noche - World Engine]] (capa ambiental puramente cosmética, aislada del Event Adapter, activable/desactivable). Con esto, el World Engine no tiene ninguna decisión de arquitectura pendiente antes de retomar las Fases 6-7.

### HUD

`GameHUD.tsx` — barra superior persistente, sin nada decorativo tras la limpieza de esta sesión: cada número mostrado tiene una consulta real detrás. **Regla que se congela: cualquier tile nueva debe pasar la misma prueba — si el dato no cambia con el estado real del backend, no entra al HUD.**

### Salas: paneles especializados por tipo de departamento

[[VISION|VISION.md]] (documento fundacional, releído completo en esta ronda) es explícito y mucho más ambicioso que lo que la v1 de este documento congeló: *"Sala Desarrollo: terminal real, logs reales, commits. Sala Diseño: Figma, versiones. Sala Tienda: catálogo real, pedidos reales, ventas. Todo debe ser funcional. No decorativo."* Cada sala es una experiencia distinta, no una skin sobre el mismo panel.

Lo construido hasta ahora (`BuildingView` con 7 pestañas idénticas en todas las salas — Chat/Outputs/Feed/Stats/Pipeline/Alertas/Config) es honesto con el backend pero no es esa ambición. Se corrige con un **registro de paneles por tipo de sala**, mismo principio que ya rige Tools ([[Plugin System - Arquitectura Completa|§8.2]]) y Capabilities ([[Gestión de Secretos y Capabilities|§11.2]]) — extensión por datos/registro, nunca por `if` acumulados en `BuildingView.tsx`:

```typescript
// frontend/src/panels/roomPanels.ts
interface RoomPanel {
  departmentKey: string;                         // 'hermes' | 'banco' | 'tienda' | ...
  label: string;
  component: React.ComponentType<{ agent: Agent; building: Building }>;
}
```

Las 7 pestañas genéricas **se quedan** como base común (chat, alertas y configuración son legítimamente iguales en cualquier sala) — los paneles del registro se **añaden** encima, nunca las sustituyen. `TerminalPanel.tsx` (hoy un caso especial hardcodeado en `BuildingView.tsx` solo para `role === 'hermes'`) es, sin saberlo, el primer ejemplo de este patrón — se generaliza al registro en vez de quedarse como la única excepción.

**Regla dura, honesta, para no repetir el error de la capa de XP eliminada esta sesión:** un panel especializado **solo se construye cuando hay dato real detrás**. Verificado sala por sala (v3, 2026-08-05):

| Sala | Rol | Panel especializado | Estado |
|---|---|---|---|
| Torre Hokage (hub) | ceo | Estado del sistema, modelos de IA activos, agentes, memoria, costes, logs, chat de texto **y voz** con Hermes | **Construible ya** para texto (reutiliza `/api/runtime/status` + `/api/metrics/summary`); voz depende de [[Arquitectura de Voz - Hermes]], diseñada, no implementada |
| Sala de Máquinas (Hermes) | hermes | Estado del sistema en vivo ([[Hermes y Claude - Los Dos Motores|§9.1]] — cola, presupuesto, salud) | **Construible ya** |
| Banco | finanzas | Cuentas, flujo de caja, ingresos, gastos, presupuestos, previsiones, beneficio por venture | Depende de [[Economía v2 - Sistema Financiero]] — diseñada, no implementada. Con `provider='manual'` (mínimo v1 de esa nota) es **construible ya** sin esperar integraciones externas. |
| Laboratorio | investigador | Tendencias, investigaciones, oportunidades detectadas, resultados | **Ya existe** — es `OutputsPanel` filtrado a `market` |
| Marketing (antes "Estudio") | contenido | Campañas, redes sociales, contenido generado, calendario, rendimiento. Renombrado — mismo rol y agente, panel ampliado respecto al `OutputsPanel` actual. | `OutputsPanel` filtrado a `content` **ya existe**; calendario/rendimiento/campañas son ampliación pendiente, no bloqueada por nada externo |
| Tienda | trafico | Listado de canales/tiendas conectadas (Etsy, Shopify...); al entrar en una: catálogo, pedidos, ventas, publicidad, inventario, métricas reales | **Bloqueado** — no hay integración de Etsy/Shopify ([[Plugin System - Arquitectura Completa|§8.1]], Fase 6). No se construye una versión con datos falsos mientras tanto. Patrón de navegación: lista → detalle por tienda, no un panel plano. |
| Taller | operaciones | Salud de sistemas | Candidato, sin dato específico más allá de lo que ya cubre Stats — no urgente |

**Soporte (Atención al Cliente) — decisión explícita, no un olvido:** el rol `soporte` no tiene sala/edificio propio. Decisión de Jorge (2026-08-05): Hermes cubre ese trabajo por ahora; una sala dedicada solo tiene sentido cuando Hokage OS tenga usuarios externos reales. `soporte` sigue operando vía Alertas/Chat genérico, sin bloquear el resto de esta unificación. Se revisita el día que exista ese escenario, no antes — mismo principio de "disparador explícito, no construir por adelantado" que ya rige el resto del documento.

### Terminal

UI de Hermes ([[Hermes y Claude - Los Dos Motores|§9.1]]) — ya no pausada. `TerminalPanel.tsx` (historial de comandos, stdout/stderr, exit code) se mantiene y pasa a ser el primer panel registrado en `roomPanels.ts`, junto al nuevo panel de Estado del Sistema.

### Las 7 vistas

Sin cambios: **Mapa, Crew, Alertas, Comms, Ventures, Objetivos, Config**, todas overlay sobre el mapa. **Regla que se congela: una vista nueva se añade a este mismo patrón — nunca como ruta separada.**

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Frontend World Engine]] — spec v1.0 que esta nota actualiza
- [[VISION]] — estándar de ambición que reabrió esta sección
- [[Hermes y Claude - Los Dos Motores]] — Hermes resolviendo "el mapa no es decorativo" hablado
- [[Economía v2 - Sistema Financiero]] — sistema que respalda el panel de Banco
- [[Arquitectura de Voz - Hermes]] — sistema que respalda el chat por voz de Torre Hokage
- [[ADR-006 - Multi-Venture]] — departamentos estables, ventures no los duplican
- [[Plugin System - Arquitectura Completa]] · [[Gestión de Secretos y Capabilities]] — mismo principio de extensión por registro/datos
- [[Prison Architect - Arquitectura de Sistemas Complejos|Prison Architect]] — origen del hallazgo R7
- [[ADR-001 - World Engine]]
