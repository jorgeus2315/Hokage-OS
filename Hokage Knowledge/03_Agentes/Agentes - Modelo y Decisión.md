> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §4. Congelado.

## 4. Agentes

🔒 **CONGELADO**, con una advertencia explícita marcada abajo.

### Qué es un agente hoy (verificado)

Una fila en `agents` (id, name, role, status, model, venture_id — sin usar, capabilities — sin usar) + una fila activa en `agent_prompts` +, opcionalmente, una fila en `agent_schedules` si su rol está en `AUTONOMOUS_TASKS`. 8 agentes reales hoy: ceo, investigador, contenido, trafico, finanzas, operaciones, soporte, hermes (pausado en BD todavía — [[Hermes y Claude - Los Dos Motores|§9.1]] especifica su reactivación como coordinador permanente, pendiente de implementar).

### La decisión que ya está tomada, y su coste

[[ARCHITECTURE (legacy)]] §12 ya dice: "Añadir un nuevo agente: 3. Registrar en `agentRuntime.ts` su intervalo y sus tools disponibles." **Es decir: el comportamiento de un agente (qué tarea autónoma corre, cada cuánto, qué modelo usa por defecto, qué tools tiene) es código TypeScript (`AGENT_MODELS`, `AGENT_TOOLS`, `AUTONOMOUS_TASKS`), no datos.** El *nombre*, *rol* y *prompt* sí son datos (`POST /api/agents` acepta cualquier `role` libre) — pero un agente con un rol no registrado en esos tres mapas se queda en modo chat-only para siempre, sin trabajo autónomo, sin aviso.

Esto ya era una decisión implícita del proyecto, no una desviación mía. Se congela explícitamente ahora con su consecuencia:

**⚠️ Esto bloquea a un Wizard que prometa "crea un agente con un rol completamente nuevo".** Un Wizard puede, hoy, configurar los 8 roles que ya existen (nombre, modelo, prompt — exactamente lo que `ConfigView` ya hace). No puede, sin trabajo adicional, dar de alta un rol nuevo con comportamiento autónomo propio sin tocar TypeScript.

### Decisión para Hokage OS

**v1: se mantiene el comportamiento como código.** No se convierte `AUTONOMOUS_TASKS`/`AGENT_MODELS`/`AGENT_TOOLS` en tablas todavía — sería construir infraestructura de "roles como datos" para un caso de uso (crear roles completamente nuevos desde un Wizard) que nadie ha pedido de forma concreta y que añade una capa de indirección (validación de tarea, de intervalo, de tools disponibles, todo tendría que re-validarse en runtime en vez de en tiempo de compilación).

**El Wizard v1 configura agentes existentes, no crea roles nuevos.** Si en el futuro se necesita un rol nuevo, sigue el proceso manual ya documentado en [[ARCHITECTURE (legacy)]] §12 — que sigue siendo válido y no necesita reescritura.

### Consecuencias a 2-3 años

Si Hokage OS crece hacia "cualquiera puede definir un agente con un propósito nuevo sin tocar código", este es el primer sitio que hay que convertir en datos — con un `role_definitions` table (task template, intervalo, modelo por defecto, tools permitidas). Se deja anotado como el disparador claro de cuándo revisar esta decisión: **el día que alguien pida crear un rol de agente que hoy no existe, sin escribir TypeScript, se reabre esta sección — no antes.**

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Hermes y Claude - Los Dos Motores]] — hermes es el 8º rol, pendiente de reactivación
- [[Founder Profile y La Fundación]] — Fase 3 (El equipo) construye 6 de estos 8 roles
- [[ARCHITECTURE (legacy)]] §12 — proceso manual de alta de agente, sigue vigente
- [[Escalabilidad]] — umbral de "roles de agente: código → datos"
- [[ADR-002 - Agent Runtime]]
