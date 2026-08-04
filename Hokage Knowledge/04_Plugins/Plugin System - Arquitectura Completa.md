> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §8 (8.1–8.6 completas). Congelado.

## 8. Plugin System, Business Modules, Integraciones y MCP

Estos temas comparten la misma pregunta de fondo — **"cómo entra código o capacidad nueva al sistema sin que Jorge tenga que tocar TypeScript"**. §8.1-8.5 resuelven cada pieza por separado (integraciones, contrato de Tool, plugins visuales, Business Module, postura sobre MCP); **§8.6 responde la pregunta de fondo como sistema completo — el Plugin System** — descubrimiento, instalación, versionado, permisos y desacoplo real del núcleo.

### 8.1 Integraciones (Etsy, Shopify, Google Trends...)

🔒 **CONGELADO**, ratificando una decisión ya tomada dos veces (en [[ARCHITECTURE (legacy)]] §9 y en [[Frontend World Engine]] §9, "Decisiones ya tomadas"):

> Shopify/Etsy/Fiverr no son departamentos propios. Son **canales de venta dentro de un venture** — no generan salas nuevas en el mapa ni agentes nuevos.

Estado real: **ninguna integración de venta existe todavía.** `EtsyTool`/`ShopifyTool`/`PrintifyTool` son *stubs* (`status: 'stub'`, `execute()` devuelve error explicando que falta la API key) — código de contrato ya escrito, cero conexión real. `GoogleTrendsTool` y `WebBrowserTool` sí son reales y funcionan hoy. Esto sigue pendiente — ver [[Roadmap - Snapshot 2026-08-02|Roadmap]] (nota: la numeración de fases de ese documento no coincide con la de `CLAUDE.md`, ver disclaimer en la propia nota).

### 8.2 El contrato de Tool — ya es el mecanismo de plugin

🔒 **CONGELADO.** El `Tool` interface (`tools/base.ts`) ya es, de facto, el sistema de plugins de Hokage OS: `id`, `inputSchema`/`outputSchema`, `execute(input, ctx)`, registrado en `tools/registry.ts`, descubierto automáticamente por el LLM vía function-calling. Añadir un tool nuevo es añadir un fichero + una línea en el registry — cero cambios en `aiService.ts` ni en rutas. **Esto ya es la respuesta a "Plugins" para capacidades que un agente invoca activamente** (como `SystemExecTool` de Hermes).

**Hallazgo de seguridad ya corregido esta sesión, se ratifica aquí como regla permanente:** `permissions`/`requiredApproval` en el `Tool` interface son **metadata informativa, nunca aplicada por ninguna capa de plataforma** (`ToolRuntime`/`manager.ts` que sí los hacían cumplir se borraron esta sesión por estar completamente muertos — cero llamadores). **Cualquier tool que necesite una garantía real de aprobación debe implementarla dentro de su propio `execute()`**, como hace `SystemExecTool` (nunca ejecuta directo, siempre crea una Decision). Esto no es una limitación a resolver — es la decisión correcta: la garantía de seguridad vive donde se puede verificar, no en un campo de configuración que cualquiera puede rellenar con falsa sensación de seguridad.

### 8.3 Plugins visuales (mapa) — ya diseñado, no implementado

🔒 **CONGELADO** el diseño, sin implementar todavía. [[Frontend World Engine]] §6-7 ya especifica un modelo completo: `WorldEngine.registerVisualKind()`, `AnimationDirector.registerReaction()`, `DepartmentRegistry.register()` — todo como datos validados por esquema, aditivo nunca destructivo, con fallo aislado (una entidad rota no tira el frame loop) y vocabulario visual cerrado (primitivas seguras: círculo, rect, icono, partícula — nunca JS/Pixi arbitrario inyectado). Es un diseño sólido y se ratifica sin cambios. Explícitamente marcado en su propio documento como "fase futura" — sigue siéndolo aquí.

### 8.4 Business Modules — la pieza que faltaba nombrar

🆕 **DECISIÓN NUEVA.** Un "Business Module" no es un mecanismo nuevo — es una composición de los tres anteriores:

```
Business Module = { canal (dato: platform dentro de un venture)
                   + Tool(s) que registra (mecanismo de §8.2, ya existe)
                   + Automations que siembra por defecto (tabla ya existe, §7) }
```

Ejemplo concreto: un "Módulo Etsy" = el campo `platform: 'etsy'` en un venture/asset (ya soportado) + `EtsyTool` implementado de verdad (hoy stub) + una automation por defecto tipo "Tendencia → Escritor" ya sembrada (ya existe el patrón, `seedAutomations()`).

**No hace falta un sistema de "instalación de módulos" nuevo.** Un Business Module se activa insertando filas — el mismo principio de "configuración sobre código" que gobierna todo lo demás en este documento.

### 8.5 MCP

🔒 **CONGELADO.**

Hokage OS (el runtime de agentes) no usa MCP hoy — `aiService.ts` habla directo con OpenRouter usando function-calling nativo. MCP es, hoy, solo la forma en que *yo* (Claude Code) me conecto a herramientas — no tiene relación con el runtime de Hokage.

**Alternativas:**
- **A. Adoptar MCP como mecanismo de tools de los agentes** — sustituir `tools/registry.ts` por un cliente MCP que hable con servidores MCP externos.
  - Ventajas: cualquier servidor MCP de terceros se conecta sin escribir una clase `Tool` nueva; ecosistema en crecimiento activo.
  - Inconvenientes: MCP añade una capa de transporte (proceso separado o HTTP) y de protocolo que hoy no hace falta para 5 tools internos; se pierde el control fino sobre coste/latencia que da tener el `Tool` interface propio; es infraestructura para un problema (conectar *muchos* proveedores externos) que Hokage no tiene todavía (tiene 1-2 integraciones reales pendientes, no 20).
- **B. Mantener el `Tool` interface propio, sin MCP** (lo que hay hoy).
  - Ventajas: simple, ya funciona, cero dependencias nuevas.
  - Inconvenientes: cada integración nueva requiere escribir una clase, no se puede simplemente "enchufar" un servidor MCP de terceros.
- **C. Interface propio como está, con un `MCPAdapterTool` opcional el día que haga falta** — un único tool cuyo `execute()` internamente hace de puente a un servidor MCP, sin migrar los demás.

**Decisión para Hokage OS: B ahora, con la puerta de C dejada abierta.** No se adopta MCP en el runtime de agentes en v1 — sería infraestructura para una escala (docenas de integraciones externas) que Hokage no tiene. El `Tool` interface actual ya cumple exactamente el mismo propósito con menos piezas móviles. Si en el futuro aparece un servidor MCP de terceros genuinamente útil (por ejemplo, un MCP de Etsy ya publicado por alguien), se envuelve en un tool propio (C) en vez de migrar todo el sistema.

**Consecuencia a 2-3 años:** si el número de integraciones externas crece más allá de lo que un puñado de clases `Tool` puede mantener cómodamente (aprox. 15-20), esta es la señal para revisar A en serio. Ver también [[Escalabilidad]].

### 8.6 Plugin System — arquitectura completa

🔒 **CONGELADO — arquitectura completa lista para implementar.** Tercer sistema de la fase de diseño (ver [[Resumen Ejecutivo - Decisiones Congeladas|§16]]). §8.1-8.5 respondían "cómo entra una capacidad concreta" pieza a pieza (Tool, plugin visual, Business Module, MCP); esta sección responde la pregunta de fondo que faltaba — **cómo entra cualquier capacidad nueva al ecosistema, para siempre, sin tocar el núcleo** — y define el mecanismo de vida completo (descubrir, instalar, habilitar, versionar, dar permiso, pedir acceso) que hoy no existe en ningún sitio del documento.

#### Qué es exactamente un plugin

Un **Tool** (§8.2) es el contrato de *ejecución* — `id`, `inputSchema`/`outputSchema`, `execute()`. Un **Plugin** es la unidad de *distribución y ciclo de vida* — una carpeta con un manifiesto que **provee** uno o más Tools (y, opcionalmente, un tipo visual de §8.3 y Automations por defecto de §8.4), con estado de instalación/versión/habilitación rastreado en BD, independiente del código del núcleo. Todo Tool que no sea vocabulario core del Runtime (ver más abajo) entra al sistema **a través de** un plugin — no hay un segundo camino.

#### Taxonomía — qué es cada cosa y en qué se diferencian

| Concepto | Qué es | Vive en |
|---|---|---|
| **Tool** | Contrato de ejecución que un agente invoca por function-calling | `tools/base.ts`, sin cambios (§8.2) |
| **Plugin** | Unidad de distribución: carpeta + manifiesto que provee Tool(s)/visual/Automations, con instalación y versión propias | Nuevo — `plugins/<id>/`, tabla `plugins` |
| **Business Module** | Composición *de negocio*: canal + Tool(s) de un plugin + Automations por defecto, aplicado a un venture | §8.4, sin cambios en su definición — ahora casi siempre alimentado por un plugin en vez de un Tool hardcodeado |
| **Integración** | Nombre coloquial, no un mecanismo propio — es como se le llama a un plugin cuyos Tools llaman a un servicio externo de pago (Etsy, Shopify, GitHub) | No es una categoría nueva — se retira como concepto aparte |
| **MCP** | Protocolo de terceros, ortogonal a todo lo anterior. Un plugin *puede* usarlo internamente en su `execute()` (§8.5, opción C) — el Plugin System no lo requiere ni lo asume | Sin cambios en la postura de §8.5 |

**Core vs. plugin — la línea que importa:** los tools que la migración de [[Runtime, Scheduler y Event Bus|§2]] acaba de construir (`trend.report`, `content.create`, `memory.write`, `decision.create`) más `system.exec`, `memory.remember` ([[Memory System|§6]]) y `founder.remember` ([[Founder Profile y La Fundación|§12.2]]) son **vocabulario core del Runtime** — nunca opcionales, nunca deshabilitables, siguen hardcodeados en `AGENT_TOOLS` exactamente como hoy. El Plugin System gobierna la capa de encima: capacidades **opcionales, añadibles, quitables** (Etsy, Shopify, Printify, cualquier integración futura, cualquier tool específico de un negocio).

#### Manifiesto y estructura en disco

```
plugins/
  etsy-connector/
    manifest.json
    index.ts        # exporta uno o más Tool (mismo Tool interface de §8.2, sin cambios)
```

```json
{
  "id": "etsy-connector",
  "version": "1.0.0",
  "label": "Etsy Connector",
  "provides": ["etsy.listings", "etsy.orders"],
  "requiresCapabilities": ["etsy"],
  "defaultRoles": ["trafico"],
  "visualKind": "marketplace-icon",
  "businessModuleDefaults": { "automations": [{ "trigger_event": "trend.detected", "action_agent_role": "contenido" }] }
}
```

Cada campo es opcional salvo `id`/`version`/`provides` — un plugin puede proveer solo Tools, o Tools + visual, o Tools + Automations por defecto. Mismo principio compositivo que ya rige Business Module (§8.4).

#### Descubrimiento — ¿cómo sabe Hermes que existe un plugin nuevo?

Al arrancar, un `pluginLoader.ts` nuevo escanea `plugins/*/manifest.json`, valida su forma, y hace `import()` dinámico de cada `index.ts` — carga real de código, sin tocar `tools/index.ts` ni `tools/registry.ts`. Cada Tool exportado se registra en el mismo `registry` de siempre (su interfaz pública — `get`/`execute`/`list`/`discover` — no cambia; solo cambia que ahora lo alimentan dos fuentes: tools core, estáticos, y tools de plugin, dinámicos). Un plugin recién encontrado en disco pero nunca instalado aparece en la tabla `plugins` con `status='discovered'`.

**Hermes no tiene un canal de descubrimiento propio** — reutiliza el mismo mecanismo ya diseñado en [[Hermes y Claude - Los Dos Motores|§9.1]]: su tool `system.status` (solo lectura) se extiende para incluir "plugins instalados y su estado" como una fuente más de las que ya agrega (`/api/runtime/status`, `/api/metrics/summary`). Su tarea autónoma (`AUTONOMOUS_TASKS.hermes`) reporta cambios de estado de plugins en su resumen operativo periódico, igual que reporta cola y presupuesto. **No se inventa un segundo protocolo de "avisar a Hermes"** — el bus ya tiene el patrón correcto: se añaden tres valores nuevos y cerrados al union `AgentEventType` ([[Runtime, Scheduler y Event Bus|§2]]) — `plugin.installed`, `plugin.enabled`, `plugin.disabled` — mismo mecanismo con el que ya se añadió cada evento anterior, no una excepción.

#### Instalación, habilitación, versionado — ciclo de vida completo

```sql
CREATE TABLE plugins (
  id                 TEXT PRIMARY KEY,       -- del manifest
  installed_version  TEXT,
  status             TEXT NOT NULL DEFAULT 'discovered',  -- discovered|installed|uninstalled
  enabled             INTEGER NOT NULL DEFAULT 0,
  manifest_json       TEXT NOT NULL,
  installed_at        TEXT,
  updated_at          TEXT DEFAULT (datetime('now'))
);
CREATE TABLE plugin_role_grants (
  role         TEXT NOT NULL,
  plugin_id    TEXT NOT NULL REFERENCES plugins(id),
  granted_by   TEXT NOT NULL,   -- OWNER_NAME, o 'auto:install' si vino de defaultRoles
  granted_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (role, plugin_id)
);
```

- **Instalar** (`POST /api/plugins/:id/install`, `requireAdmin`) — acción deliberada de Jorge, nunca automática al descubrirlo (un plugin recién hallado en disco no se activa solo — coherente con "todo lo que cueste dinero o tenga efecto real requiere aprobación explícita", [[Núcleo - Arquitectura del Core|§0]]). Valida el manifiesto, sincroniza sus `SecretDefinition` en `secret_definitions` (mismo `INSERT OR REPLACE` que ya usa [[Gestión de Secretos y Capabilities|§11.2]] para no divergir del código), siembra sus Automations por defecto si las declara (§7/§8.4), aplica `defaultRoles` como grants iniciales (`granted_by='auto:install'`), y marca `status='installed', enabled=1`.
- **Habilitar/deshabilitar** (`PUT /api/plugins/:id/enable|disable`) — interruptor reversible e inmediato: `enabled=0` hace que el registry deje de exponer sus Tools a cualquier rol al instante, sin desinstalar nada — la forma rápida de "apágalo" si un plugin falla.
- **Desinstalar** — marca `status='uninstalled'`, fuerza `enabled=0`. Los `plugin_role_grants` no se borran (regla de CLAUDE.md: nunca borrar datos sin confirmación explícita) — quedan como histórico inerte; reinstalar no los reactiva solo, se conceden de nuevo explícitamente.
- **Versionado** — deliberadamente simple, sin resolución de dependencias ni rangos semver: el manifiesto declara una versión, `plugins.installed_version` la rastrea. No hay motor de compatibilidad — es la misma razón por la que se rechazó MCP en §8.5 (infraestructura para una escala que Hokage no tiene todavía).
- **Actualizar** — reemplazar el contenido de la carpeta en disco (paso manual, igual que actualizar cualquier otro código) + reiniciar el backend (el loader re-escanea) + `POST /api/plugins/:id/update` (`requireAdmin`) que re-sincroniza manifiesto/`SecretDefinition`/versión. Si la nueva versión deja de proveer un Tool que algún rol tenía concedido, ese grant queda simplemente inerte — nunca se borra nada automáticamente.

#### Permisos — qué agentes pueden usarlo, y cómo lo pide un agente

`toolsForRole(role)` (`agentModels.ts`) pasa a ser la unión de dos fuentes — **cambio mecánico pequeño, no un rediseño**: los tools core (`AGENT_TOOLS[role]`, hardcodeado, sin cambios) más los tools de plugin concedidos a ese rol (`plugin_role_grants JOIN plugins WHERE enabled=1`, expandiendo `provides`). Se vuelve una función async (consulta a BD) — cambio trivial para sus llamadores, que ya hacen trabajo async constantemente.

**Cómo un agente solicita un plugin nuevo:** un tool core más, disponible a los mismos 6 roles tool-capable de siempre — `plugin.request_access({ pluginId, reason })`. Su `execute()` crea una `Decision` (`entity_type='plugin_access_request'`, `entity_id`=id interno del plugin, `description`=`reason`). Jorge la aprueba o rechaza por el flujo que **ya existe**, sin inventar nada — un resolver nuevo en `decisionResolvers.ts` (`plugin_access_request: { onApprove: insertar en plugin_role_grants } }`), mismo patrón que ya usan `objective` y `system_exec`. No hay un segundo mecanismo de "pedir permiso" en todo el sistema — es siempre una Decision.

#### Conexión con Secret Management

Sin mecanismo nuevo — un plugin declara `requiresCapabilities` en su manifiesto, y al instalarse sus `SecretDefinition` se sincronizan en `secret_definitions` exactamente como ya hace cada `Tool` hoy ([[Gestión de Secretos y Capabilities|§11.2]]: "cualquier integración nueva declara su Capability + SecretDefinition junto a su Tool — aparece sola en `GET /api/secrets`"). Un Tool de un plugin pide `capabilities.resolve('etsy', { ventureId })` igual que `EtsyTool` lo haría si dejara de ser un stub — el plugin no sabe ni le importa si el secreto vive en `.env` o en `secret_values` cifrado.

#### Integración con el Runtime

`aiService.ts::askAgent()` no cambia de forma — sigue pidiendo `toolsForRole(role)` y pasándolo a OpenRouter; simplemente esa lista ahora puede incluir tools de plugin. `registry.execute(toolId, args, ctx)` tampoco cambia — el registry no distingue en tiempo de ejecución si un Tool es core o de plugin, ambos implementan el mismo `Tool` interface. **El Runtime no necesita saber que existen los plugins** — es la prueba de que el desacoplo funciona: la única pieza nueva es el loader que puebla el registry al arrancar.

#### Aparición visual en el Ecosistema

Reutiliza el registro de plugins visuales ya diseñado en §8.3 (`WorldEngine.registerVisualKind()`), sin construir nada nuevo. El manifiesto declara `visualKind` con una clave del **mismo vocabulario visual cerrado** que §8.3 ya exige (primitivas seguras — círculo, rect, icono, partícula — nunca JS/Pixi arbitrario). Esto es, sin buscarlo, una propiedad de seguridad real: incluso un plugin mal escrito no puede inyectar renderizado arbitrario en el mapa, solo componer primitivas ya aprobadas.

#### Relación con Ventures

Igual que Secret Management ([[Gestión de Secretos y Capabilities|§11.2]]): el `scope` de la `SecretDefinition` de un plugin (`'installation'` | `'venture'`) decide si su capacidad es global o por-negocio. Un plugin tipo Etsy es `scope='venture'` — cada venture lo conecta por separado (§11.2 ya resuelve esto). Business Module (§8.4) sigue siendo la pieza que hace visible esa capacidad *dentro* de un venture concreto — sin cambios en su definición, ahora casi siempre alimentada por un Tool de plugin en vez de un stub hardcodeado.

#### Desacoplo real del núcleo — la respuesta a la pregunta de fondo

Añadir una capacidad nueva, de principio a fin, **no toca ningún fichero existente del núcleo**:

| Paso | Acción | ¿Toca código del núcleo? |
|---|---|---|
| Crear el plugin | Carpeta nueva + manifiesto + `Tool` (interfaz sin cambios) | No |
| Descubrirlo | Automático al arrancar | No |
| Instalarlo | `POST /api/plugins/:id/install` | No |
| Darle secretos | Sincronizado del manifiesto | No |
| Concederlo a un rol | Fila en `plugin_role_grants` (a mano o vía Decision de un agente) | No |
| Darle visual | Clave de `visualKind` del vocabulario ya existente | No |
| Darle Automations | Del manifiesto, al instalar | No |

Lo único que sigue exigiendo tocar código del núcleo, deliberadamente: (1) un **rol de agente** completamente nuevo ([[Agentes - Modelo y Decisión|§4]], sin cambios — sigue siendo la decisión correcta, un plugin nunca crea un rol), (2) un **tipo de evento** nuevo si el vocabulario cerrado del bus no cubre algo que un plugin necesita reaccionar (raro, estructural, no por-plugin), (3) copiar la carpeta al servidor (paso de despliegue, no de código — igual que ya lo es actualizar `.env`).

#### Seguridad — trade-off aceptado explícitamente, no ignorado

Un plugin es código TypeScript que corre **en el mismo proceso, con los mismos privilegios** que el resto del backend — no hay sandboxing, aislamiento de proceso, ni límite de permisos del sistema operativo. Es una decisión deliberada, no un descuido: Hokage OS es de un único operador ([[Seguridad, Permisos y VPS|§11.1]]) y, hoy, el único autor plausible de un plugin es el propio Jorge (o yo, en su nombre). Construir aislamiento real (proceso separado, permisos restringidos) es infraestructura para un problema — código de terceros no confiable — que no existe todavía, y que MCP (§8.5) ya cubriría mejor el día que aparezca genuinamente.

**Consecuencia a 2-3 años:** el día que un plugin lo escriba alguien que no sea Jorge (un colaborador, un desarrollador externo, un plugin de un tercero descargado de internet), esta decisión se reabre — instalar código no confiable sin aislamiento deja de ser aceptable en ese momento, no antes. Ver también [[Escalabilidad]].

#### Qué cambia realmente en decisiones ya congeladas — justificado, no impuesto

- **§8.2 (contrato de Tool):** el contrato en sí **no cambia una línea** — `id`/`inputSchema`/`outputSchema`/`execute()` siguen exactamente igual. Lo que cambia es solo *quién puebla* `tools/registry.ts` (antes: únicamente imports estáticos; ahora: imports estáticos de tools core + `import()` dinámico de tools de plugin). Cambio aditivo, no rompe nada existente.
- **§4 (Agentes):** `AGENT_TOOLS` se bifurca en core (sin cambios, hardcodeado) y plugin (nuevo, en `plugin_role_grants`). **No se reabre** la decisión de fondo de [[Agentes - Modelo y Decisión|§4]] — crear un rol nuevo con comportamiento propio (`AUTONOMOUS_TASKS`/`AGENT_MODELS`) sigue siendo código, el umbral que dispararía revisar eso ("alguien pide un rol nuevo sin tocar TypeScript") sigue sin cruzarse.
- **§2 (Event Bus):** se añaden 3 valores al union `AgentEventType` (`plugin.installed/enabled/disabled`) — la única vez que este diseño exige tocar el vocabulario cerrado del bus, y es una vez, no por cada plugin futuro.
- **§8.1, §8.3, §8.4, §8.5:** sin cambios — se citan y reutilizan tal cual, ninguno necesitaba corregirse.

### Consecuencias a 2-3 años

Con esto, Hokage OS puede incorporar cualquier capacidad económica digital nueva que aparezca en cinco años — un plugin nuevo, aunque sea para un negocio completamente distinto a los de hoy — sin que nadie tenga que volver a abrir `tools/index.ts`, `agentModels.ts` ni ningún fichero del núcleo. El límite real no es el mecanismo, es la disciplina de escribir cada plugin como una unidad autocontenida — y esa disciplina ya la impone el propio manifiesto.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Runtime, Scheduler y Event Bus]] — Tool Calling y vocabulario del bus
- [[Gestión de Secretos y Capabilities]] — Secret Management, consumido por plugins
- [[Seguridad, Permisos y VPS]] — single-owner, trade-off de seguridad sin sandboxing (§8.6)
- [[Frontend World Engine]] — plugins visuales (§8.3)
- [[Agentes - Modelo y Decisión]] — línea entre rol de agente (código) y plugin (dato)
- [[Hermes y Claude - Los Dos Motores]] — descubrimiento de plugins vía `system.status`
- [[Modelo Multi-Venture]] — scope venture de un plugin/Business Module
- [[ADR-005 - Tool Runtime y Plugin Contract]]
- [[Escalabilidad]] — umbrales de MCP y sandboxing
