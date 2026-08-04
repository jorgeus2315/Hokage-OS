> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §9. Congelado — v2.

## 9. Los dos motores: Hermes y Claude

🔒 **CONGELADO — v2.** Reemplaza la versión anterior de esta sección. Jorge cuestionó explícitamente el diseño original de Hermes por no coincidir con la visión real del producto ("Hermes y Claude deben ser los dos motores principales del ecosistema") — no era una reactivación pendiente, era una decisión mal dimensionada desde el principio. Se corrige aquí, con la razón documentada, no disimulada.

### 9.1 Hermes — de utilidad estrecha a coordinador permanente

**Lo que estaba mal en la v1:** definí a Hermes como "el único agente con acceso a `system.exec`, infraestructura interna, sin caso de uso real" — y lo pausé. Eso confunde **una herramienta que Hermes tiene** con **lo que Hermes es**. Mientras tanto, el verdadero coordinador del ecosistema — el que ya asigna trabajo, vigila presupuestos, cierra el loop de decisiones — es `AgentRuntime`: una clase de TypeScript sin nombre, sin sala, sin voz, invisible para Jorge salvo como infraestructura. [[VISION]] pide una empresa que se sienta viva incluso desconectado; una clase anónima no puede hablar contigo sobre cómo va el día. Un agente con nombre, sí.

**Definición oficial v2:** Hermes es la **personificación del Runtime/Scheduler** — el proceso que ya corre 24/7 (ver [[Runtime, Scheduler y Event Bus|§2]]), ahora con presencia real: nombre, sala, y capacidad de que Jorge le pregunte "¿cómo va todo?" y reciba un estado operativo de verdad, no una sala vacía con una terminal.

- **Reactivado**, no pausado — `agents.status` vuelve a activo, `departments.active = 1` para su sala. El disparador que faltaba en la v1 ya existe: coordinar y reportar es un caso de uso real desde el primer día, independiente de si `system.exec` llega a usarse.
- **Tarea autónoma nueva** (mismo patrón que los demás roles en `AUTONOMOUS_TASKS`, ver [[Runtime, Scheduler y Event Bus|§2]]): cada ciclo, Hermes reporta a Ship Comms un resumen operativo real — work items procesados, decisiones pendientes, presupuesto consumido, agentes con errores recientes. Es la traducción conversacional de R7 (overlays de datos del mapa, investigado en [[Prison Architect - Arquitectura de Sistemas Complejos|prison-architect.md]], nunca implementado): si el mapa todavía no muestra esas capas visualmente, Hermes ya puede **decirlas**.
- **Tool nueva:** `system.status` — de solo lectura, sin aprobación (no ejecuta nada, solo agrega lo que `/api/runtime/status` y `/api/metrics/summary` ya calculan). Es lo que Hermes usa para responder con datos reales, no inventados, cuando Jorge le pregunta cómo va el sistema.
- **`system.exec` se queda exactamente como estaba especificado** (§9.1 anterior, sin cambios): siempre pide aprobación, nunca se duplica en otro agente. Esa regla no dependía de que Hermes fuera estrecho o amplio — sigue siendo correcta tal cual.
- **Su sala dedicada** (antes "Sala de Máquinas") es candidata natural al primer panel especializado por-sala de [[Frontend - Decisiones v2|§13]] — un panel de "Estado del Sistema" en vivo, no solo el historial de comandos que ya tenía.

**Regla dura que sigue vigente sin cambios:** ninguna capacidad de ejecutar comandos reales se duplica en otro agente — pasa por Hermes exclusivamente, sea cual sea su alcance.

### 9.2 Claude — motor de razonamiento profundo, no un agente más de la cola

**Por qué no es lo mismo que el CEO/Hokage con Sonnet.** El agente `ceo` ya usa `claude-sonnet-4.5` (ver [[Agentes - Modelo y Decisión|§4]]) para tareas estratégicas rutinarias, dentro del mismo ciclo de trabajo que cualquier otro agente. Lo que Jorge pide es distinto: razonamiento de **arquitectura, investigación y evolución del sistema** — exactamente el tipo de trabajo de esta conversación, no una tarea más en `work_items`.

**Decisión de diseño — por qué no es un Tool normal:** un Tool que cualquier agente invoca dentro de su propio ciclo (como llamaría a `google.trends`) trataría "consultar a Claude" como una llamada de API más, con la misma falta de fricción que cualquier otra. Pero lo que describe Jorge — arquitectura, evolución del sistema — es exactamente el tipo de decisión que este documento entero insiste en que pase por aprobación humana antes de actuar. Automatizarlo del todo repetiría el error que motivó pausar mal a Hermes: construir algo amplio sin el freno correcto.

**Elegido: consulta como Decision, no como Tool automático.**

```
Cualquier agente (o Hermes, al reportar) detecta que necesita razonamiento
que su propio modelo no puede dar con confianza
  → createDecision({ entity_type: 'claude_consultation', title, description: la pregunta })
  → Jorge la ve en Alertas, con la pregunta completa
  → Jorge trae la consulta a una sesión de Claude Code (como esta)
  → la respuesta se registra de vuelta — memory_entries (§6) con category='learning',
    entity_type/entity_id apuntando a la Decision original
```

No hay integración de API nueva que construir — Jorge ya es el puente, literalmente en esta misma conversación. Lo único que falta es el **hueco estructurado**: el tipo de Decision, y dónde aterriza la respuesta ([[Memory System]], ya diseñado, ahora con un consumidor real más).

**Lo que esto NO es, explícitamente:** no es el backend llamando a la API de Claude de forma autónoma para modificar su propio código (eso existe técnicamente — Claude API / Agent SDK — pero es un sistema auto-modificable, una categoría de riesgo completamente distinta que merece su propia decisión dedicada, no colarse dentro de "añadir Claude"). Si algún día se quiere ese nivel de automatización, es una sección nueva de este documento, con su propio análisis de alternativas — no una extensión silenciosa de esta.

### Consecuencias a 2-3 años

Hermes deja de ser una pieza "lista para cuando haga falta" y pasa a ser, desde ya, la voz operativa diaria del sistema — exactamente lo que separa un sistema operativo de un panel de agentes con un mapa bonito encima. Claude queda como el escalón de razonamiento que ningún modelo barato puede sustituir, sin haber construido una integración de API que hoy sería prematura y de riesgo desproporcionado al beneficio.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Agentes - Modelo y Decisión]] — Hermes como 8º rol
- [[Runtime, Scheduler y Event Bus]] — Hermes personifica este proceso
- [[Memory System]] — destino de las respuestas de Claude (`category='learning'`)
- [[Frontend - Decisiones v2]] — panel especializado de Hermes, hallazgo R7
- [[Founder Profile y La Fundación]] — Fase 4 (Hermes despierta)
- [[Prison Architect - Arquitectura de Sistemas Complejos|Prison Architect]] — origen de R7
