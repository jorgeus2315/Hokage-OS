> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §12. Congelado — v2.

## 12. Configuración inicial: Wizard, Founder Profile, System Profile

Ninguno de estos tres conceptos existía antes de este documento. §12.2 (Founder Profile) y §12.3 (La Fundación) tienen arquitectura completa (🔒 v2); §12.1 (System Profile) queda en 🆕, definido pero sin el mismo nivel de detalle todavía — candidato si en el futuro se reabre la fase de diseño.

### 12.1 System Profile

Snapshot de configuración de **esta instalación concreta** de Hokage OS — no de Jorge, no de un negocio. Responde: ¿qué integraciones están conectadas?, ¿qué agentes están activos/pausados?, ¿qué límites de presupuesto rigen?, ¿es un entorno de desarrollo o producción?

No es una tabla nueva — es una **vista de solo lectura sobre datos que ya existen**: `agents.status`, `departments.active`, `agent_budgets`, y el estado de secretos que ya expone `GET /api/secrets` (ver [[Gestión de Secretos y Capabilities|§11.2]] — presencia y validación, nunca valores). Se expone como un único endpoint (`GET /api/system/profile`) que agrega estas fuentes. **Es exactamente lo que un Wizard necesita leer al arrancar para no volver a preguntar algo que ya se sabe.**

### 12.2 Founder Profile

🔒 **CONGELADO — v2, arquitectura completa lista para implementar.** Elegido como segundo sistema de la fase de diseño (ver [[Resumen Ejecutivo - Decisiones Congeladas|§16]], metodología diseñar→revisar→congelar). La v1 de esta sección (un párrafo) quedaba corta del mismo rigor que ya tiene Memory System v3 ([[Memory System|§6]]) — se completa aquí: schema, mecanismo de escritura, alcance de lectura, y una corrección de scope real encontrada al diseñarlo en detalle.

**Qué es:** datos estructurados y **estables** sobre Jorge que Hokage (el agente `ceo`) usa para personalizar su razonamiento estratégico — tolerancia al riesgo, estilo de comunicación preferido, objetivo económico actual. Es la contraparte "humana" del Memory System ([[Memory System|§6]]): mientras `memory_entries` guarda hechos sobre *negocios*, el Founder Profile guarda rasgos sobre *el fundador*.

**Corrección de scope, encontrada al diseñar (no estaba en la v1):** "lecciones de negocios anteriores" — mencionado en la v1 como parte del Founder Profile — **no vive aquí**. Un rasgo estable ("mi tolerancia al riesgo es media") y una lección puntual ("en 2023 el negocio X fracasó porque Y") son cosas de naturaleza distinta: la primera tiene *un* valor vigente que se sobrescribe, la segunda es narrativa que se acumula sin límite. Eso último ya tiene un mecanismo — es exactamente lo que `memory_entries` ([[Memory System|§6]]) ya modela con `category='learning'`, `venture_id=NULL` (memoria de instalación, no de un negocio concreto), `source_agent_id=NULL` (lo escribió Jorge, no un agente). Inventar un segundo almacén para el mismo tipo de hecho habría repetido el error que ya se corrigió una vez en Memory System v3 (dos semánticas de escritura mezcladas en un solo sitio). Founder Profile se queda estrictamente para **rasgos con un único valor vigente**, no para historia.

**Schema:**

```sql
CREATE TABLE founder_profile (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT DEFAULT (datetime('now'))
);
```

Mismo patrón que `agent_memory` (clave-valor, upsert), pero sin `agent_id` — no hace falta, hay un único fundador (consistente con el modelo single-owner ya congelado en [[Seguridad, Permisos y VPS|§11.1]]). **Vocabulario de claves sugerido, no cerrado por un enum** (permite añadir rasgos nuevos sin migración): `risk_tolerance`, `communication_style`, `economic_goal`, `founder_name`. Igual que `memory.remember` ([[Memory System|§6]]), la clave se valida por formato (snake_case) en la tool, no por una lista fija — añadir un rasgo nuevo es escribir una clave nueva, no tocar código.

**Escritura — tool nueva, no una reutilización de otra:** `founder.remember({key, value})`. Mismo principio ya aplicado dos veces en esta fase de diseño ([[Runtime, Scheduler y Event Bus|§2]], [[Memory System|§6]]): una tool, un propósito. No reutiliza `memory.remember` (semántica de log, no de rasgo estable) ni `memory.write` (memoria privada por agente, no del fundador). Upsert por `key` (`ON CONFLICT(key) DO UPDATE`), mismo patrón exacto que `writeAgentMemory()`.

- **Disponible solo al rol `ceo`** — es el único rol cuyo prompt lee este perfil (ver Lectura, abajo); dar la tool a un rol que nunca la consulta crea una escritura huérfana. Si en el futuro otro rol tiene una necesidad concreta de leer/escribir esto, se reabre esta decisión con esa necesidad real delante — no antes.
- Cumple la regla permanente fijada al cerrar la migración de [[Runtime, Scheduler y Event Bus|§2]]: toda escritura estructurada nueva nace en Tool Calling, nunca en un marcador ni en un mecanismo alternativo.

**Lectura:** en `aiService.ts::askAgent()`, un bloque `[PERFIL DEL FUNDADOR]` — **solo cuando `agentRow?.role === 'ceo'`**, no en los otros 7 roles (coste de tokens innecesario para agentes cuyo prompt nunca lo usa, mismo criterio de disciplina de [[Economía|§10]]). Formato igual que `[LO QUE SÉ]`: `SELECT key, value FROM founder_profile ORDER BY key` (tabla pequeña por naturaleza — un puñado de rasgos, nunca miles de filas — no hace falta `LIMIT` ni orden por recencia).

**Tres caminos de escritura, uno solo de verdad (el resto llaman al mismo):**
1. **Conversación normal con Hokage** — la tool `founder.remember`, disponible desde ya, sin depender de nada más.
2. **API directa** — `GET /api/founder-profile` / `PUT /api/founder-profile/:key` (`requireAdmin`), para un futuro panel de ajustes donde Jorge edite sus rasgos a mano sin pasar por una conversación. Llama al mismo servicio (`setFounderProfile()`) que usa la tool — nunca hay dos implementaciones del upsert.
3. **Fresh Install Wizard** (§12.3, abajo) — cuando exista, sus preguntas de arranque llaman al mismo `setFounderProfile()`. **Founder Profile no depende del Wizard para ser útil** — el camino 1 ya funciona el día que se implemente esta sección, con o sin Wizard. Se corrige así la v1, que ataba la primera población al Wizard sin necesidad real de esa dependencia.

#### Consecuencias a 2-3 años

Rasgos estables sobre Jorge se acumulan desde la primera conversación, no desde que exista un Wizard — igual que Memory System v3 evita "memoria vacía que empezó tarde" para negocios, esto evita lo mismo para el fundador. Si algún día Founder Profile necesita historizar cambios (saber que la tolerancia al riesgo de Jorge cambió de 'media' a 'baja' en una fecha concreta, no solo el valor actual), eso es una razón real para versionar la tabla — no se construye ahora sin esa necesidad concreta delante.

### 12.3 La Fundación — la experiencia de entrada al ecosistema

🔒 **CONGELADO — v2, arquitectura completa. Sexto y último sistema de la fase de diseño ([[Resumen Ejecutivo - Decisiones Congeladas|§16]]).** La v1 de esta sección trataba el Wizard como un formulario de configuración inicial ("pide nombre, objetivo, confirma agentes"). Jorge pidió explícitamente cambiar el enfoque: no es un asistente de configuración, es **la experiencia de fundar la empresa** — el primer contacto real con [[VISION]], no una pantalla de ajustes con estética de videojuego encima. Se rediseña aquí desde cero, con tres hallazgos reales verificados contra el código que cambian el punto de partida.

#### Hallazgos reales, verificados, que la v1 no tenía en cuenta

1. **`BootView.tsx` tiene `'Bienvenido, Jorge.'` como string literal** — el propio boot script asume que Jorge existe antes de que nada lo haya confirmado. Se corrige: la última línea del boot lee `founder_profile.founder_name` (§12.2) si existe; si no existe, el boot ya sabe que lo que viene después es la Fundación, no el mundo normal.
2. **`db/init.ts::seedDefaultVenture()` crea la venture "Minimal Designs" automáticamente y en silencio** en cualquier arranque con `ventures` vacío — contradice directamente que el usuario funde su primer negocio. **Se retira esta función.** El primer venture nace exclusivamente de la Fundación, nunca de un seed automático.
3. **Solo Hermes se siembra hoy** (`seedHermesAgent()`). Los otros 7 roles no tienen seed en código — existen solo porque se crearon a mano en algún momento de este proyecto. Una instalación real y vacía arrancaría con departamentos sin nadie dentro salvo Hermes, pausado. La Fundación es, literalmente, la primera vez que el resto del equipo llega a existir.

#### Arquitecturas exploradas antes de decidir

| # | Enfoque | Por qué se descarta / se elige |
|---|---|---|
| A | **Formulario multi-paso lineal**, skin sci-fi encima (Bienvenida → Datos → Venture → Agentes → Fin) | Descartado explícitamente. Aunque tenga estética de videojuego, la *interacción* (rellenar campo → siguiente) sigue siendo un formulario — falla el requisito central de Jorge de raíz, no en la superficie. |
| B | **Secuencia cinemática dentro del propio World Engine** — el mapa empieza vacío y se construye en directo delante del usuario mientras responde | Alineación máxima con [[VISION]], pero coste de ingeniería alto si se construye como un renderer paralelo al `WorldCanvas` ya existente (cámara guiada, revelado en etapas, modo "construcción"). |
| C | **Todo por chat con Hokage (CEO), sin pantallas estructuradas** — el usuario solo conversa, la interfaz reacciona | Máxima sensación de "hablar con mi cofundador IA", reutiliza el patrón de chat ya construido en `BuildingView`. Pero el texto libre sin estructura reabre exactamente el problema que la migración de [[Runtime, Scheduler y Event Bus|§2]] eliminó (ambigüedad, nada garantiza que una respuesta libre se pueda mapear a un campo real como `risk_tolerance` o `VentureType`) — y un chat abierto no comunica progreso ("¿cuánto falta?"), lo que contradice "debe ser progresivo." |
| **D** | **Híbrido, elegido:** un número pequeño y fijo de fases discretas, cada una un turno de conversación con Hokage con respuesta **estructurada** (chips/selección corta, no texto libre parseado), renderizadas **sobre el mismo `GameLayout`/`WorldCanvas` que ya existe** — no una vista nueva — con los datos (`departments`/`agents`) creciendo en vivo a medida que se responde, y la cámara/menú bloqueados hasta el final | Resuelve el rechazo de A (no es un formulario, es una conversación con payoff visual inmediato), evita el riesgo de C (respuestas estructuradas, mismo principio de Tool Calling que gobierna el resto del sistema), y reduce el coste de B: no hace falta un renderer nuevo — `WorldCanvas` ya pinta departamentos/agentes desde datos; la Fundación solo controla *qué subconjunto* de esos datos existe en cada momento y desactiva la cámara libre hasta el final. |

**Decisión: D.** Se detalla completa abajo.

#### El modelo de tres niveles — quién existe antes de que el usuario haga nada

No todo nace en la Fundación. Tres niveles, no dos:

1. **Ya existe, siempre** (igual que Hermes hoy): el agente **CEO** (`role='ceo'`, nombre `'Hokage'` — ya es el nombre real en los datos de este proyecto) se siembra igual que Hermes, antes de la primera pregunta. Es quien conduce la conversación de la Fundación — no un "narrador del sistema" sin cara, un agente real con el que el usuario habla desde el primer segundo, coherente con [[VISION]] ("hablar con cualquier agente como si fuera un empleado"). Hermes también existe ya (pausado, como hoy) pero no participa activamente hasta la Fase 4.
2. **Se construye durante la Fundación**: el resto del equipo (6 roles), el primer venture, el primer objetivo, el Founder Profile.
3. **Se descubre después, nunca en la Fundación**: Plugin System, Secret Management/Integraciones, Memory System (como concepto visible), Claude, ajuste fino de modelos/prompts, Automations personalizadas, paneles por sala. Ver la lista completa más abajo.

#### Recorrido completo — fase por fase

Todas las fases ocurren **dentro de `GameLayout`**, no en una vista aparte — un modo `founding` que bloquea el menú PS4 y la cámara libre hasta completarse. El mapa arranca con un único edificio visible (la Torre Hokage, ya sembrada como `is_hub`) y el resto en negro/niebla.

**Fase 0 — Detección (invisible, automática)**
`GameLayout` comprueba si `founder_profile` tiene la clave `founding_completed_at`. Si no existe, entra en modo `founding` en vez de la vista normal. **Nota de diseño encontrada en autocrítica** (ver abajo): la condición no es "¿existe algún dato en `founder_profile`?" — sería ambigua si el usuario cierra la pestaña a mitad — es específicamente esa clave, escrita solo al final de la Fase 5.

**Fase 1 — El fundador** · sistema: Founder Profile (§12.2)
Hokage saluda y hace 3 preguntas, una por turno, cada una con su UI mínima: nombre (texto corto), tolerancia al riesgo (3 chips: bajo/medio/alto), objetivo económico inicial (texto corto tipo "1000€/mes"). Cada respuesta se guarda con `founder.remember` **en vivo**, la misma tool de §12.2 — la Fundación no tiene su propio mecanismo de guardado, usa el real. Payoff visual: ninguno todavía (el fundador no es un edificio) — el fondo del mundo pasa de negro puro a un tono base, marcando que "algo ha empezado a existir."

**Fase 2 — El primer negocio** · sistemas: [[Modelo Multi-Venture|Ventures]], [[Goal System]]
Hokage pregunta el nombre del venture y su tipo (chips de `VentureType`, con "otro" como escape sin intentar interpretar texto libre) — reutiliza el formulario que `VenturesView` ya tiene, no inventa uno nuevo. `POST /api/ventures` + primer `Objective` con `venture_id`. **Payoff visual:** el edificio ya existe en el mapa (departamentos permanentes, [[ADR-006 - Multi-Venture|ver ADR-006]] — no se crea uno nuevo por venture); el correspondiente al tipo de venture (Tienda, Marketing...) sale de la niebla/inactividad con una animación breve de "activación" y la cámara hace un acercamiento corto.

**Fase 3 — El equipo** · sistema: [[Agentes - Modelo y Decisión|Agentes]]
Hokage no pregunta agente por agente — **propone** el equipo de 6 roles restantes con sus modelos/prompts por defecto ya definidos en `AGENT_MODELS`, mostrados como una fila compacta (avatar + nombre + rol), con opción de renombrar con un toque pero "Aceptar equipo" como acción principal — respeta que "el fundador no hace trabajo pequeño" ([[VISION]]) sin quitarle la sensación de estar decidiendo. `POST /api/agents` × 6. **Payoff visual:** el resto de edificios sembrados sale de la niebla a la vez, y uno a uno, con un pequeño retraso escalonado, un agente entra caminando a su edificio y su luz se enciende — el primer momento en que el mundo se siente realmente vivo.

**Fase 4 — Hermes despierta** · sistema: [[Hermes y Claude - Los Dos Motores|Hermes v2]]
Sin preguntas. `agents.status`/`departments.active` de Hermes pasan a activo (la reactivación que §9.1 ya especificó). Hermes se presenta en una línea ("Voy a coordinar el día a día — pregúntame cómo va cuando quieras"). Payoff visual: su Sala de Máquinas se ilumina, indicador "EN LÍNEA."

**Fase 5 — Entrada al mundo** · cierre
Hokage resume en una frase ("Tu empresa está lista: 7 empleados, [venture] como primer negocio, [objetivo] como meta"), un único botón "Entrar". Al pulsarlo: se escribe `founder_profile.founding_completed_at`, se crea automáticamente **la primera entrada de Memory System** (`memory_entries`, `category='context'`, `venture_id=NULL`, título "Fundación de Hokage OS" — mismo mecanismo de captura automática de [[Memory System|§6]], no una excepción para la Fundación), la cámara se aleja a la vista general, el menú PS4 se desbloquea. De aquí en adelante es `GameLayout` normal, sin ninguna diferencia de código respecto a hoy.

**Afordancia obligatoria, no opcional:** botón "Saltar animaciones" visible desde la Fase 1 — necesario para desarrollo (reinstalar la BD en local no debería exigir ver la secuencia completa cada vez) y para cualquier usuario que repita el flujo.

#### Lo que la Fundación explícitamente NO pregunta — descubrimiento progresivo

| Sistema | Cuándo se descubre |
|---|---|
| Plugin System ([[Plugin System - Arquitectura Completa|§8.6]]) | Nunca en la Fundación. Se descubre en `ConfigView` o cuando un agente crea una `Decision` de tipo `plugin_access_request` |
| Secret Management / Integraciones ([[Gestión de Secretos y Capabilities|§11.2]]) | Nunca en la Fundación — coherente con la regla ya congelada de que el Wizard nunca escribe secretos por HTTP. Se descubre al conectar un canal real desde el New Venture Wizard (abajo) o `VenturesView` |
| Claude ([[Hermes y Claude - Los Dos Motores|§9.2]]) | Nunca en la Fundación — Claude es consulta estructurada bajo demanda, no parte del arranque |
| Memory System ([[Memory System|§6]]) como concepto visible | Nunca explicado — pero la Fundación ya es su primer escritor automático real (Fase 5) |
| Modelos de IA por agente, prompts individuales | `ConfigView`, después, si el usuario quiere ajustar los defaults de la Fase 3 |
| Automations personalizadas | `VenturesView`, después — las automations por defecto ([[Automatizaciones (Agente-Agente)|§7]]) se siembran igual que hoy, sin preguntar |
| Paneles por sala ([[Frontend - Decisiones v2|§13]]) | Se descubren al entrar a cada edificio por primera vez |

#### New Venture Wizard — versión corta, reutiliza fases

Disponible en cualquier momento desde el menú, no ligado al primer arranque. Es literalmente la **Fase 2 sola** — founder ya existe (Fase 1 no se repite), equipo ya existe y se reutiliza sin preguntar (Fase 3 no se repite, coherente con [[Modelo Multi-Venture|§3]]: agentes compartidos entre ventures). Para canales OAuth2 (Etsy, Shopify) ofrece el botón "conectar" de [[Gestión de Secretos y Capabilities|§11.2]] con el `venture_id` recién creado ya fijado.

**Bloqueante sin cambios respecto a la v1:** el New Venture Wizard requiere que [[Modelo Multi-Venture|§3]] esté implementado (ya lo está, ✅) — no bloquea nada nuevo.

#### Autocrítica — errores encontrados y corregidos antes de congelar

Jorge pidió explícitamente atacar el propio diseño antes de darlo por definitivo. Esto es lo que cambió al hacerlo, no una lista de cumplidos:

1. **Contradicción real encontrada:** la primera versión de este diseño asumía "nada se siembra antes de la Fundación" — pero entonces Hokage (CEO) no podría *conducir* la Fase 1, porque el propio agente que habla con el usuario todavía no existiría. **Corregido:** el modelo de tres niveles de arriba — CEO y Hermes son pre-existentes (mismo trato especial que Hermes ya tiene hoy en código), el resto del equipo se construye. No es una excepción nueva, es extender un patrón que el código ya tiene.
2. **Bug de resumibilidad encontrado:** detectar "primera vez" por "¿existe algún dato en `founder_profile`?" rompe si el usuario cierra la pestaña a mitad de la Fase 1 — quedaría con `founder_name` guardado pero se trataría como "ya fundado", perdiendo la Fase 2 en adelante. **Corregido:** la condición de entrada es una clave específica (`founding_completed_at`), escrita solo al final. No se diseña una máquina de estados de "reanudar en la fase exacta" — es una complejidad que no se justifica todavía; si se interrumpe, se reinicia desde la Fase 1 (barato: son 3 preguntas, y `founder.remember` es upsert, así que repetir no duplica nada).
3. **Coste de ingeniería subestimado en la primera idea (arquitectura B):** un renderer paralelo al `WorldCanvas` para la secuencia cinemática sería una pieza de infraestructura nueva grande. **Corregido:** se decidió reutilizar `GameLayout`/`WorldCanvas` tal cual, alimentado con un subconjunto de datos que crece — cero renderer nuevo, solo control de qué se le pasa y una cámara con menos libertad temporalmente.
4. **Riesgo de "esto tampoco es un formulario, pero se siente como uno" con `VentureType`:** si se deja texto libre para el tipo de venture y se intenta interpretarlo, se reabre la ambigüedad que la migración de [[Runtime, Scheduler y Event Bus|§2]] eliminó. **Corregido explícitamente:** el tipo es siempre un chip cerrado (`VentureType` existente), "otro" no intenta clasificar nada, solo guarda el texto como nombre.
5. **Tensión real, no resuelta por ingeniería sino por decisión de producto:** [[VISION]] dice que el fundador "contrata agentes" — pero la Fase 3 propone el equipo completo con un solo toque, sin que el usuario "contrate" a nadie individualmente. Se decide conscientemente a favor de "el fundador no hace trabajo pequeño" (también [[VISION]]) — contratar un agente adicional más adelante sigue siendo una acción real y deliberada ([[Recetas - Añadir Negocio|§15]], receta ya existente), solo no ocurre en el primer contacto. Se anota aquí como decisión de diseño explícita, no como omisión.
6. **Dependencias de implementación que este diseño expone, no inventa:** la Fundación no se puede construir hasta que existan de verdad `founder_profile`+`founder.remember` (§12.2) y la reactivación de Hermes ([[Hermes y Claude - Los Dos Motores|§9.1]]) — ambos ya diseñados en esta misma fase, ninguno implementado todavía. Es información útil para el orden de implementación que viene después de cerrar esta fase de diseño, no un bloqueo del diseño en sí.

#### Consecuencias a 2-3 años

La Fundación es, sin que el usuario lo note, el primer ejercicio real de casi todo lo que este documento congeló: primer uso de `founder.remember`, primera `Objective` real, primeros agentes creados fuera de una sesión de desarrollo manual, primera entrada de `memory_entries`, primera reactivación real de Hermes. Si algo en esas piezas está mal diseñado, la Fundación lo revela en los primeros cinco minutos de cualquier instalación nueva — es, de facto, el test de integración más completo que tiene el sistema, aunque no se haya construido pensando en eso.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[VISION]] — estándar de ambición que gobierna toda la Fundación
- [[Memory System]] — Founder Profile es su contraparte "humana"; primera entrada automática en la Fase 5
- [[Modelo Multi-Venture]] · [[Goal System]] — sistemas construidos durante la Fase 2
- [[Agentes - Modelo y Decisión]] — equipo construido en la Fase 3
- [[Hermes y Claude - Los Dos Motores]] — reactivación de Hermes en la Fase 4
- [[Gestión de Secretos y Capabilities]] — Secret Management, descubrimiento progresivo
- [[Seguridad, Permisos y VPS]] — modelo single-owner que gobierna System Profile (§12.1, en esta misma nota)
- [[Plugin System - Arquitectura Completa]] — nunca en la Fundación, descubrimiento posterior
