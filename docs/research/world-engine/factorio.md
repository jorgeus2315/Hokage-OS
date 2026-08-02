# Factorio — Arquitectura de simulación de flujos a escala masiva
> Categoría: world-engine  
> Analizado: 2026-08-02  
> Relevancia para Hokage OS: **muy alta**  
> Fuente principal: Friday Facts Blog (FFF) oficial de Wube Software (FFF #1–#417), documentación técnica de la wiki, Factorio API docs v1.1, posts de los devs en Reddit y GitHub (desync reports)

---

## Objetivo del análisis

Factorio (Wube Software, 2020) es el simulador de automatización industrial más técnicamente exigente publicado en el mercado indie. Con miles de entidades activas simultáneas, una simulación completamente determinista, multijugador sincronizado y un target de 60 UPS en factories de millones de elementos, sus decisiones arquitectónicas son un caso de estudio único. El objetivo es extraer los patrones aplicables a Hokage OS como sistema de agentes autónomos de negocio.

---

## 1. Visión general

### Qué intenta simular

Factorio simula una fábrica viva: flujos de materiales por cintas transportadoras, redes eléctricas, sistemas de fluidos, robótica de construcción, logística autónoma, amenazas biológicas (biters) y la interacción del jugador como orchestrador. El jugador no hace trabajo — diseña sistemas que hacen el trabajo. La victoria es construir un sistema que funcione sin intervención manual.

Las factories activas al momento del launch variaban entre 100.000 y 300.000 entidades. Las mega-bases de la comunidad alcanzan 500.000–1.000.000 entidades activas con UPS sostenidos de 60.

### Principios arquitectónicos

**1. Determinismo absoluto.** El multijugador no usa interpolación del servidor — todos los clientes ejecutan exactamente la misma simulación con el mismo seed. Si el tick N produce un resultado diferente entre dos clientes, hay un desync. Esto obliga a que todo — incluyendo comportamiento de AI, movimiento de entidades, física de fluidos — sea completamente reproducible dado el mismo input.

**2. Update solo lo que está activo.** Las entidades inactivas no consumen tiempo de CPU. "Activa" significa que tiene algo que hacer: una cinta que mueve items, una insertera con trabajo pendiente, un ensamblador con receta y materiales. Nada más. El sistema es opt-in por estado, no opt-out por condición.

**3. Sistemas separados, no entidades monolíticas.** La electricidad no vive en cada máquina — existe una red eléctrica global. Los fluidos no están en cada tubo — existen redes de fluido. Los items no están en cada cinta — el sistema de cintas los gestiona. Cada sistema es una simulación independiente que se sincroniza con las entidades a través de interfaces mínimas.

**4. O(1) o amortizado O(1) para todas las operaciones en el hot path.** Arrays planos indexados por posición, lookups por chunk ID, conjuntos pre-computados de entidades activas. Cualquier operación que deba ejecutarse 60 veces por segundo para 100.000 entidades no puede ser O(n log n).

**5. Lazy evaluation con dirty flags.** Los sistemas costosos de recalcular (redes eléctricas, grafos de producción) solo se recalculan cuando algo relevante cambia. No hay polling del estado — hay eventos que marcan el sistema como dirty.

### Por qué escala tan bien

Tres decisiones explican la escalabilidad excepcional de Factorio frente a todos los juegos comparables:

**Primero: las cintas transportadoras.** El caso más estudiado en la industria. Factorio no simula cada item individualmente — simula segmentos de cinta. Un segmento es un tramo continuo sin bifurcaciones. Si ningún item entra ni sale del segmento, está inactivo. Miles de items en una cinta representan 3–4 segmentos activos. El coste pasa de O(items) a O(segmentos activos). (FFF #176)

**Segundo: el chunk system con active entity tracking.** No todas las entidades del mapa se actualizan. Solo las entidades en chunks "activos" se simulan. El resto existe en la base de datos pero no consume ciclos.

**Tercero: el electric network como sistema separado.** En lugar de que cada máquina calcule su propia potencia disponible, hay una red eléctrica global que resuelve el balance en cada tick como un sistema de ecuaciones. Más eficiente, más correcto, y escala mejor que N máquinas con lógica propia.

---

## 2. World Engine

### Representación del mapa

El mapa de Factorio es un grid 2D de tiles virtualmente ilimitado (generación procedural en dirección de exploración). No tiene un tamaño fijo declarado al inicio.

Cada tile almacena:
- **Tipo de tile** — enum compacto (water, grass, sand, stone, concrete, refined concrete, hazard concrete...)
- **Hidden tile** — el tipo de tile debajo de la capa construida
- **Variant** — variante visual (bordes, suavizado)
- **Pollution level** — contaminación acumulada (float)

El tile no almacena entidades. Las entidades viven en estructuras de datos separadas y se referencian por posición.

### Chunks

El chunk es la unidad fundamental de organización espacial y la clave de toda la arquitectura de rendimiento.

**Tamaño:** 32×32 tiles = 1024 tiles por chunk.

**Lo que almacena un chunk:**
- Lista de entidades con bounding box intersectando el chunk
- Tiles planos (array de 1024 tiles en memoria contigua — cache-friendly)
- Estado de generación (generated / partially generated / not generated)
- Pollution data (contaminación del chunk)
- Referencia al chunk map para navegación entre chunks

**El chunk map (surface):** objeto que contiene todos los chunks, indexado por `(chunk_x, chunk_y)` en un hash map. Acceder a un chunk: O(1). Iterar todos los chunks activos: O(chunks activos).

**Chunk activity:** un chunk puede estar en varios estados:
- **Generated + active:** tiene entidades que actualizan, está en el hot path del tick
- **Generated + inactive:** generado pero sin actividad, no consume ciclos
- **Not generated:** existe en potencia pero no en memoria

### Entidades

Las entidades no son clases con herencia monolítica. Son agregados con componentes especializados. Una insertera tiene:
- Componente de posición y orientación
- Componente de pick-up arm y drop-off arm
- Componente de energía (consumo eléctrico)
- Componente de filtros (qué items mover)
- Referencia a la cinta de input y la máquina de output

El prototipo (tipo de entidad) es inmutable y compartido. La instancia solo almacena estado variable.

**Prototipos (equivalente al Def de RimWorld):**  
Los prototipos definen todo el comportamiento posible: recetas, velocidad, consumo, tamaño, colisión. Viven en Lua data stage y se compilan a C++ al inicio. Un ensamblador tier-3 y tier-1 son el mismo código C++ con diferentes valores de prototipo.

**Entidades activas vs inactivas:**  
El motor mantiene dos estructuras:
- **Active entities set:** la lista de entidades que necesitan update este tick
- **Índice espacial por chunk:** solo consultado para lookups espaciales

Una entidad entra en el set activo cuando su estado cambia (recibe un item, gana energía, detecta algo). Sale del set activo cuando no tiene nada que hacer. Equivalente al dirty flag pattern pero para entidades completas.

### Organización espacial

Factorio usa jerarquía de dos niveles:

**Nivel 1 — Chunk grid:** para queries del tipo "dame todas las entidades en el área X,Y → X+n,Y+n", el sistema itera los chunks afectados y filtra por bounding box. O(chunks en el área).

**Nivel 2 — Lookup dentro del chunk:** para queries de entidad única o colisión, el chunk tiene una estructura adicional que permite lookup por posición exacta. O(1) amortizado.

Los **bounding boxes de colisión** son separados de los **bounding boxes de selección** y de los **bounding boxes de tile occupation**.

---

## 3. Simulación

### Tick principal

Factorio corre a **60 UPS (Updates Per Second)** por defecto. El UPS es configurable vía velocidad de juego. Cada tick es exactamente 1/60 de segundo de juego. El loop de tick es **completamente determinista**:

1. Procesar inputs del jugador (network commands en multiplayer)
2. Actualizar sistemas en orden fijo
3. Enviar estado al renderer (desacoplado del tick)

El renderer puede correr a cualquier FPS (60, 120, 144+) porque está desacoplado del tick. El juego puede interpolar posiciones entre ticks para suavizar.

### Orden de actualización

El orden de sistemas dentro de un tick es fijo y documentado en la API de modding. Determinista, no priority-based. Esto es crucial para el determinismo del multijugador.

Orden simplificado:
```
1.  Generación de chunks (si hay jugadores en nuevas áreas)
2.  Construcción/deconstrucción (comandos de robots o jugador)
3.  Entities update — active entities set
      3a. Transport belts (por segmentos)
      3b. Inserters (pick/drop)
      3c. Assemblers, furnaces, miners (tick de crafting)
      3d. Power plants, solar panels (generación eléctrica)
4.  Electric networks (balance de power en cada red)
5.  Fluid systems (simulación de fluidos en redes)
6.  Pollution (diffusion entre chunks)
7.  AI/Biters (pathfinding, attack decisions)
8.  Circuit networks (señales)
9.  Train system (movimiento, señales)
10. Construction robots (pathfinding, tasks)
11. Alerts y events
12. Script update (Lua mods)
```

Este orden garantiza que las minas recojan materiales antes de que las inserteras los muevan, lo que ocurre antes de que las máquinas los consuman, lo que ocurre antes de que la red eléctrica calcule la potencia disponible.

### Sistemas desacoplados

Cada sistema es independiente y se comunica con los demás a través de interfaces mínimas:

| Sistema | Entrada | Salida |
|---------|---------|--------|
| Transport belts | Items insertados/retirados | Posición de items por segmento |
| Electric network | Potencia declarada por entidades | Satisfaction ratio por entidad |
| Fluid system | Fluido insertado/retirado | Nivel de fluido en cada nodo |
| Circuit network | Señales de entidades conectadas | Señales agregadas por red |
| Pollution | Generación de entidades | Nivel de contaminación por chunk |
| AI biters | Estado del pollution map | Comandos de movimiento/ataque |

Ningún sistema escribe directamente en el estado de otro. La comunicación es siempre a través de interfaces controladas.

### Procesamiento incremental

**Belt segments:** un segmento solo actualiza si hay items en él Y al menos un extremo tiene cambios pendientes. Si la cinta está llena y no entra nada, el segmento no procesa.

**Electric network rebuild:** la topología de la red eléctrica solo se recalcula cuando cambia (se construye o destruye un cable o generador).

**Chunk deactivation:** si un chunk no tiene entidades activas y no está cerca de ningún jugador, sus sistemas no se ejecutan.

**Pollution diffusion:** difunde entre chunks a frecuencia reducida (no cada tick), con un modelo de difusión computacionalmente barato.

---

## 4. Rendimiento

### La optimización más importante: belt segments (FFF #176, #181)

El caso más estudiado en la industria indie de simuladores.

**Versión naive:** simular cada item como un objeto con posición, velocidad, colisión. En 100.000 items en cintas, eso son 100.000 updates por tick.

**Versión Factorio:** un segmento de cinta es una estructura de datos que almacena:
- Posición del primer item en el segmento (offset desde el inicio)
- Espaciado entre items (constante si llenos, variable si hay gaps)
- Longitud del segmento
- ¿Está bloqueado el final?

Para mover todos los items del segmento: actualizar el offset del primer item. Una operación para 1000 items. Si el segmento está bloqueado, ni siquiera eso.

Resultado: una factory con 500.000 items en cintas puede tener solo 2.000–3.000 segmentos activos.

### Active entity list

En lugar de iterar todas las entidades cada tick, Factorio mantiene una lista de entidades activas. Resultado: 90.000 de 100.000 entidades pueden estar inactivas en un tick dado si la factory está en steady state.

### Electric network como sistema global

N máquinas en una red comparten un único cálculo de balance, no N cálculos independientes. El resultado (`satisfaction_ratio` 0.0–1.0) se retorna a toda la red con una sola operación.

### Multithreading (FFF #300, #322, #370)

Estado en v1.1 post-1.0:

**Rendering thread:** completamente separado del simulation thread. El renderer trabaja sobre un snapshot inmutable del estado del mundo.

**Pathfinding threads:** generación de rutas para robots y biters en threads de trabajo separados. El resultado se aplica al inicio del siguiente tick.

**Chunk generation threads:** generación procedural de nuevos chunks en threads separados, sincronizados antes de ser usados en el tick.

**Lo que NO es multithreading (intencionalmente):** la lógica de simulación principal — belts, machines, electric networks. Paralelizarla comprometería el determinismo. Decisión explícita de los devs (FFF #322): el determinismo vale más que el paralelismo de la simulación.

### Cache y memoria contigua

Los tiles de un chunk son un array de 1024 enteros en memoria contigua. Iterar los tiles es cache-friendly: un solo cache line cubre múltiples tiles.

Los tipos de datos hot (posiciones de entidades, estados activos) se almacenan en SoA (Struct of Arrays) en lugar de AoS (Array of Structs) para maximizar la densidad de datos por cache line durante iteraciones.

---

## 5. IA

### Biters — AI de amenaza externa

Los biters son las entidades autónomas enemigas. Su AI tiene varios niveles:

**Individual AI (per-biter):**
- FSM simple: Idle → Wander → Attack → Flee
- En ataque: seguir el path calculado por el sistema de pathfinding
- Interrupción: si recibe daño mientras camina, puede cambiar de target

**Group AI (biter groups):**
- Los biters forman grupos que atacan como unidades tácticas
- Un grupo tiene un líder lógico que determina el destino del ataque
- Los miembros navegan independientemente pero hacia el mismo objetivo
- Los grupos se forman en spawners cuando el nivel de contaminación supera un umbral

**Pollution-driven aggression:**  
La motivación de los biters no es AI pura — es una función del pollution map. Chunks con alta contaminación atraen ataques. El sistema de AI no decide "cuándo atacar" — decide "adónde ir dado que hay mucha contaminación aquí". La agresividad es una propiedad emergente del mapa de contaminación.

### Pathfinding de biters — dos niveles

- **Nivel alto (navigation map):** grafo coarse del mundo sobre chunk-level walkability. Permite encontrar rutas en mapas muy grandes sin A* cell-by-cell.
- **Nivel bajo (A* detallado):** para los últimos N tiles de la ruta, A* fino sobre tiles individuales.

La navigation map se recalcula cuando la topología del mapa cambia (se construye o destruye un muro). Es costosa de recalcular, por eso se mantiene como cache con invalidación lazy.

### Robots de construcción y logística

Los robots tienen un task queue genuino, no un FSM simple.

**Logistic robots:**
- Pertenecen a una logistic network (área de cobertura de roboports)
- El logistic network manager asigna trabajo: "lleva item X desde provider Y hasta requester Z"
- El robot ejecuta: navegar a Y → recoger X → navegar a Z → depositar → volver al roboport más cercano

**Construction robots:**
- Responden a deconstruction orders o blueprint placement orders
- Un robot idle en un roboport consulta la cola de trabajo de la red
- El primer trabajo disponible en el rango se asigna al robot
- Locking: el trabajo se marca In-Progress cuando se asigna (solo un robot por tarea)

**Pathfinding de robots:**  
Los robots vuelan — ignorar colisión en tierra simplifica enormemente el pathfinding. Las rutas son líneas rectas o arcos suaves con detección de obstáculos simplificada.

---

## 6. Comunicación

### Tres mecanismos distintos

**1. Interfaces de datos compartidos (shared state secuencial)**

Los sistemas no se llaman entre sí — comparten estructuras de datos con acceso secuencial garantizado por el orden del tick. La electric network calcula el satisfaction_ratio y lo deposita en un buffer que las entidades leen en su propio update.

No es un event bus. Es memoria compartida con acceso secuencial estrictamente ordenado.

**2. Script events (Lua mods)**

Para el sistema de modding, Factorio expone eventos a través de un bus de eventos en Lua:
```
on_entity_built, on_entity_removed, on_tick, on_player_crafted_item, ...
```
Los mods suscriben handlers a eventos. El sistema C++ genera eventos y los despacha al runtime Lua al **final del tick**. Los handlers Lua no pueden modificar el estado de la simulación en medio del tick — solo al final.

**3. Circuit network como mensajería in-game**

El circuit network es el mecanismo de comunicación entre componentes lógicos dentro de la factory. Una bomba puede leer el nivel de fluido de un cofre cercano y activarse cuando supera un umbral. No hay código — solo cables y condiciones.

### El formato de eventos para mods

El sistema de eventos es push-pull:
- **Push (C++ → Lua):** cuando ocurre algo en la simulación, C++ pone el evento en una queue
- **Pull (Lua):** al final del tick, los handlers Lua reciben todos los eventos del tick en orden

Los eventos son inmutables y llevan: tick en que ocurrieron, datos relevantes (entidad, posición, jugador), sin posibilidad de modificar eventos pasados.

### Desacoplamiento — separación en tiempo de ejecución

El desacoplamiento en Factorio es de ejecución, no solo de código. Los sistemas no se llaman — están separados en el tiempo de ejecución dentro del tick. Un sistema escribe a estructuras intermedias. El siguiente sistema lee esas estructuras. El orden del tick garantiza consistencia.

Funcionalmente equivalente a un pipeline de datos con etapas síncronas, no a un sistema de mensajería asíncrona.

---

## 7. Arquitectura del código

### Organización del código

Factorio está escrito en C++17 con binding completo a Lua para el sistema de datos (data stage) y el sistema de modding (control stage).

**Data stage (inicialización):** corre antes de que el juego empiece. Define todos los prototipos, recetas, entidades, tecnologías. El resultado se compila a C++ antes de que comience la simulación. Es declarativa — no tiene acceso al estado del juego.

**Control stage (runtime):** el script de mods que corre durante la partida. Suscribe eventos, puede consultar y modificar el estado del juego a través de la API, y se ejecuta al final de cada tick.

Las dos etapas no comparten código ni contexto. Un mod que intente usar funciones de control en la etapa de datos recibe un error explícito.

### Separación simulación / renderizado / lógica

```
┌─────────────────────────────────────────────────────────┐
│                    C++ CORE ENGINE                       │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │ SIMULATION LOOP  │    │    RENDER THREAD          │   │
│  │  (main thread)   │    │  (separate thread)        │   │
│  │                  │    │                           │   │
│  │ - Tick logic     │───▶│ - Reads world snapshot    │   │
│  │ - Entity update  │    │ - Produces frame          │   │
│  │ - AI             │    │ - UI overlay              │   │
│  │ - Networks       │    │                           │   │
│  └──────────────────┘    └──────────────────────────┘   │
│           │                                              │
│           ▼                                              │
│  ┌──────────────────┐                                   │
│  │   LUA RUNTIME    │                                   │
│  │  (end of tick)   │                                   │
│  │                  │                                   │
│  │ - Mod scripts    │                                   │
│  │ - Custom logic   │                                   │
│  └──────────────────┘                                   │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │ PATHFINDING      │    │  CHUNK GENERATION         │   │
│  │ WORKER THREADS   │    │  WORKER THREADS           │   │
│  └──────────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

El render thread nunca toca el estado de simulación directamente. Recibe un snapshot del estado al inicio del render frame y trabaja sobre él. Esto elimina el locking entre simulación y rendering.

### Escalabilidad

El diseño escala en dos dimensiones:

**Escalabilidad de contenido (mods):** el sistema de prototipos permite añadir cualquier número de tipos nuevos de entidades sin modificar el motor. Las recetas, tecnologías y entidades son datos.

**Escalabilidad de carga (número de entidades):** la arquitectura de active entity set + chunk loading garantiza que el coste de CPU crece con la actividad real, no con el tamaño total del mundo. Una factory inactiva en un área remota no consume ciclos.

---

## 8. Qué copiaría para Hokage OS

### C1 — Active agents set: solo iterar agentes con trabajo activo

**Principio:** active entity set (Factorio)  
**Aplicación:** el scheduler mantiene un set de agentes "activos" (con work item asignado o evento pendiente). Solo esos agentes se procesan en cada ciclo. Los agentes idle no consumen tiempo de scheduler.

Una entidad entra en el set activo cuando:
- Se le asigna un work item
- El Event Bus emite un evento que le concierne
- El resultado de una API call está listo para procesar

Sale del set activo cuando:
- Su work item llega a estado terminal (completado / fallado / cancelado)
- No tiene eventos pendientes
- Está en cooldown programado (el timer lo reintroducirá al set cuando expire)

El coste del scheduler: O(agentes activos), no O(agentes totales).

### C2 — Orden de tick fijo y documentado para el agent runtime

**Principio:** fixed tick order (Factorio)  
**Aplicación:** el ciclo del agent runtime tiene etapas con orden declarado en código:

```
Etapa 1: Procesar eventos del Event Bus pendientes
         → genera work items en la cola si corresponde
Etapa 2: Escanear cola de work items
         → asignar items pendientes a agentes activos disponibles
Etapa 3: Ejecutar agentes con work items asignados
         → async con TTL, resultado se colecta en Etapa 5
Etapa 4: Verificar TTL de work items In-Progress
         → los expirados vuelven a la cola
Etapa 5: Recoger resultados de ejecuciones completadas
         → marcar work items como completados / fallados
Etapa 6: Generar work items derivados de resultados
         → el output de un agente se convierte en input del siguiente
Etapa 7: Evaluar decisions pendientes de aprobación
         → si hay nueva aprobación de Jorge, generar work item de ejecución
Etapa 8: Actualizar métricas y presupuestos
         → incrementar tokens consumidos, decrementar budget disponible
```

Este orden garantiza que los resultados de un agente estén disponibles para otros agentes en el siguiente ciclo, no en el mismo. Elimina las race conditions por diseño.

### C3 — Contratos de interfaz explícitos entre sistemas

**Principio:** shared data interfaces, not direct calls (Factorio)  
**Aplicación:** el scheduler no llama directamente al runtime de agentes — deposita work items en la BD. El runtime de agentes no llama al Event Bus directamente — emite eventos a través de una función de publicación. Ningún sistema conoce la implementación de otro.

La comunicación entre sistemas siempre es a través de estructuras de datos compartidas (tablas en SQLite) con acceso controlado por el orden del tick.

### C4 — Separación data stage / control stage

**Principio:** data stage / control stage (Factorio)  
**Aplicación:** los prompts de agente y la configuración de herramientas son el "data stage" — se cargan al inicio y son inmutables en runtime. Si se modifican, el runtime debe recargar el agente explícitamente (no silenciosamente).

La lógica de orquestación (qué agente maneja qué evento, cuánto budget tiene cada agente) es el "control stage" — puede cambiar sin reiniciar, a través de decisiones de Jorge o de configuración en BD.

### C5 — Snapshot inmutable para el frontend

**Principio:** render thread snapshot (Factorio)  
**Aplicación:** el WebSocket del backend envía snapshots del estado (no referencias vivas). El frontend nunca accede al estado en vivo mientras el backend lo modifica. Cada mensaje de WebSocket es un objeto inmutable con timestamp del momento en que se capturó.

### C6 — Dirty flags para recálculo lazy de métricas costosas

**Principio:** lazy recalculation with dirty flags (Factorio)  
**Aplicación:** los KPIs del dashboard (tasa de éxito de agentes, coste por pipeline, tokens consumidos) se calculan cuando se solicitan y se cachean con TTL de 60 segundos. Solo se invalidan cuando hay nuevos datos relevantes.

### C7 — Agrupación de work items de un mismo pipeline (belt segment analogy)

**Principio:** belt segment grouping (Factorio)  
**Aplicación:** los work items del mismo pipeline (Explorador → Escritor → Vendedor) se agrupan en una estructura de `pipeline_run`. Si el pipeline_run está bloqueado (esperando aprobación), todos sus steps son inactivos. Si fluye, se procesan como unidad. El scheduler no verifica cada step individualmente.

### C8 — Two-level dispatch para routing de work items

**Principio:** two-level pathfinding aplicado al scheduler (Factorio)  
**Aplicación:**
- **Nivel coarse:** ¿qué tipo de agente maneja este tipo de work item? Lookup en tabla de routing estática. O(1).
- **Nivel fino:** dentro de ese tipo, ¿cuál instancia tiene menor carga actual? Solo relevante cuando haya múltiples negocios con el mismo tipo de agente.

---

## 9. Qué NO copiaría

### El determinismo estricto

El determinismo de Factorio es necesario porque múltiples clientes ejecutan la misma simulación en paralelo. Si cualquier resultado diverge entre clientes, hay un desync y el multijugador se rompe.

Hokage OS no tiene multijugador. El backend es la única fuente de verdad. El determinismo no es necesario y el esfuerzo de garantizarlo — evitar todos los floats no-deterministas, todos los hash maps con orden no garantizado, todos los timestamps — sería desperdiciado.

### El sistema de cintas como estructura de datos física

El belt segment system simula miles de items físicos moviéndose por un mundo 2D. Hokage OS no mueve items físicos. Sus "flujos de trabajo" son abstractos — un work item en una BD no necesita physics simulation.

### La generación procedural de chunks para mundos infinitos

Factorio genera el mundo al vuelo conforme el jugador explora. Hokage OS tiene un mapa fijo y conocido: 6 departamentos, posiciones fijas. No hay exploración ni generación procedural.

### El circuit network como lenguaje de programación in-game

El circuit network es un lenguaje de programación visual dentro del juego. Permite a jugadores crear lógica condicional, contadores, flip-flops, memoria y hasta CPUs. Es brillante, pero aplica cuando el usuario necesita programar sin acceso al código fuente. En Hokage OS la lógica está en TypeScript.

### El sistema de trenes con control de tráfico completo

Los trenes de Factorio tienen señales, intersecciones, bloqueos y scheduling de múltiples trenes compartiendo vías. Sistema de control de tráfico completo. No hay analogía directa en Hokage OS.

### El pollution system como mecánica de juego

La contaminación en Factorio es una mecánica que driver la agresividad de la AI enemiga. Hokage OS no tiene enemigos que reaccionen a pollution. La analogía más cercana sería "deuda técnica que atrae problemas", pero la simulación física de diffusion por chunks no aplica.

---

## 10. Comparación: Factorio vs RimWorld vs Software Inc. vs Prison Architect

### Rendimiento

| Sistema | Técnicas principales | Límite práctico |
|---------|---------------------|----------------|
| **Factorio** | Belt segments, active entity set, chunk loading, multithreaded render+pathfinding+generation, SoA memory layout | ~1.000.000 entidades en mega-bases |
| **RimWorld** | Tick escalonado 3 listas, hash stagger, multithreaded pathfinding (1.6), frame budget | ~500 pawns antes de degradación |
| **Prison Architect** | Pathfinding thread dedicado, lighting 20Hz, sparse tile encoding | ~500 entidades |
| **Software Inc.** | Mesh batching por planta | ~100 empleados |

**Ganador: Factorio**, por 2–3 órdenes de magnitud sobre los demás.

---

### World Engine

| Sistema | Approach | Fortalezas | Debilidades |
|---------|----------|-----------|------------|
| **Factorio** | Chunk system + active entity tracking + SoA tiles + generación procedural infinita | El más escalable. Cache-friendly. | Más complejo de implementar |
| **RimWorld** | Flat arrays ~20 por propiedad, O(1) cualquier lookup | Muy eficiente para mundo fijo | Mundo de tamaño fijo |
| **Prison Architect** | Sparse tile encoding, objetos separados de tiles, rooms explícitas | Serialización elegante. Modelo de habitación completo. | Sin chunk system |
| **Software Inc.** | Edge-based walls, NavBoundary/BuildBoundary separadas | Buen modelo de mobiliario | Single-threaded |

**Ganador para Hokage OS:** RimWorld para mundo fijo y pequeño. Factorio para mundo grande y dinámico.

---

### Simulación

| Sistema | Approach | Fortalezas | Debilidades |
|---------|----------|-----------|------------|
| **Factorio** | Tick fijo 60 UPS, active entity list, sistemas totalmente separados, determinismo absoluto | El más riguroso. Sistemas completamente desacoplados. | Determinismo overkill para caso de uso single-server |
| **RimWorld** | 3 tick lists (normal/rare/long), stagger por hash, frame budget | Mejor distribución de carga. Budget enforcement. | Menos riguroso sobre separación de sistemas |
| **Prison Architect** | Tiempo real continuo, threading aislado | Simple y funcional | Menos control sobre frecuencias |
| **Software Inc.** | Tiempo real con multiplicador escalar | Más simple | Single-threaded, degrada rápido |

**Ganador para Hokage OS:** combinar el orden de tick fijo de Factorio con la distribución de carga de RimWorld.

---

### Eventos

| Sistema | Approach | Fortalezas | Debilidades |
|---------|----------|-----------|------------|
| **Factorio** | Memoria compartida secuencial (sistemas internos) + event bus Lua (mods) + circuit network (in-game) | Tres niveles de comunicación bien separados. El más potente. | Complejidad alta para implementar fielmente |
| **RimWorld** | LetterStack para UI, ThinkNode para AI, sin event bus explícito | Simple y efectivo | Sin mensajería formal entre sistemas |
| **Prison Architect** | Cola global de trabajos como mecanismo de desacoplamiento | Elegante. Objeto genera su propio trabajo. | Cola única, LIFO dentro de prioridad |
| **Software Inc.** | Behavior trees con partial class stubs | Visual, editable | Limitado en expresividad |

**Ganador: Factorio** para sistemas distribuidos complejos. La separación entre comunicación interna (secuencial) y externa (event bus) es la más limpia.

---

### Entidades

| Sistema | Approach | Fortalezas |
|---------|----------|-----------|
| **Factorio** | Prototipo + instancia, componentes separados, active/inactive set | Más eficiente. Escala bien. |
| **RimWorld** | Def + Thing, trackers especializados en la entidad | Más flexible. Bien documentado. |
| **Prison Architect** | Flag en datos = tipo de entidad | Data-driven puro |
| **Software Inc.** | Behavior tree por entidad | Simple |

**Ganador: Factorio y RimWorld empatados** con enfoques distintos al mismo problema.

---

### Escalabilidad

| Sistema | Límite teórico | Limitación principal |
|---------|---------------|---------------------|
| **Factorio** | >1.000.000 entidades activas | CPU a escala extrema de pathfinding |
| **RimWorld** | ~500 pawns | Single-threaded simulation loop |
| **Prison Architect** | ~500 entidades | Pathfinding plano sin jerarquía |
| **Software Inc.** | ~100 empleados | Single-threaded todo |

**Ganador: Factorio**, sin discusión.

---

## 11. Riesgos

### R1 — El determinismo es una restricción invasiva e innecesaria para Hokage OS

El determinismo de Factorio implica evitar cualquier fuente de no-determinismo: timestamps de sistema, IDs de BD auto-incrementales como base de decisiones, floats con diferente precisión por plataforma, orden de iteración de maps en JavaScript.

Para Hokage OS esto es innecesario — el backend es el único cliente. El esfuerzo de garantizarlo sería desperdiciado.

**Adaptación:** ignorar el determinismo. Usar timestamps, UUIDs y cualquier fuente de no-determinismo conveniente.

### R2 — El chunk system tiene sentido para mundos grandes e infinitos, no para 6 departamentos

El chunk loading de Factorio está diseñado para mundos potencialmente infinitos donde solo el 0.1% del mapa está activo en un momento dado. Hokage OS tiene 6 departamentos — todos activos. El overhead de un chunk system para 6 entidades sería absurdo.

**Adaptación:** no usar chunks. Los departamentos son los chunks. Son 6 y están todos activos.

### R3 — La active entity list requiere gestión cuidadosa de transiciones de estado

El sistema funciona bien cuando las entidades transicionan limpiamente entre activa e inactiva. Los bugs más difíciles de diagnosticar en Factorio son:
- Entidades atascadas en el active list cuando deberían salir (memory leak de actividad)
- Entidades que salen prematuramente y pierden trabajo pendiente

**Adaptación:** implementar el active/inactive state con TTL (una entidad se fuerza a inactiva si lleva X segundos sin progreso documentado) y con logs explícitos de transición.

### R4 — Los sistemas separados requieren interfaces contractuales explícitas

El desacoplamiento funciona porque cada sistema tiene un contrato preciso. Si los contratos son vagos, el orden del tick crea bugs sutiles donde un sistema lee datos que aún no fueron actualizados este ciclo.

**Adaptación:** definir explícitamente en TypeScript los contratos de cada etapa del tick del agent runtime: qué escribe, qué lee, en qué momento.

### R5 — El active set puede crear falsos inactivos por transición prematura

Si un agente sale del active set cuando lanza el API call (en lugar de cuando recibe la respuesta), el resultado del call puede llegar sin nadie que lo procese. Este tipo de bug existe en Factorio bajo condiciones de timing.

**Adaptación:** una entidad solo sale de active cuando su work item está en estado terminal (completado, fallado, cancelado), no cuando lanza el request. El estado "API call en vuelo" es un estado activo.

### R6 — La separación data stage / control stage requiere disciplina de equipo

En Factorio, los mods que violan la separación data/control stage generan errores evidentes. En Hokage OS, sin enforcement activo, un prompt que cambia en runtime sin recargar el agente produciría un agente con configuración inconsistente — viejo prompt, nuevo código.

**Adaptación:** añadir un hash de configuración al agente en BD. Si el hash cambia entre ticks, el agente se recarga antes de ejecutar.

---

## 12. Conclusión

Factorio es el mejor ejemplo disponible de cómo llevar una simulación basada en entidades a escala masiva sin sacrificar la claridad arquitectónica. Sus aportaciones a Hokage OS son de orden superior a los demás juegos analizados — no porque sus técnicas sean más sofisticadas, sino porque sus principios son más fundamentales.

**El active entity set es el concepto más importante del análisis completo de los cuatro juegos.** No es una optimización de rendimiento — es una forma de pensar sobre el sistema. Las entidades no tienen estado "espera pasiva" — tienen estado "sin trabajo activo". Para Hokage OS, el scheduler no pregunta "¿tiene cada agente algo que hacer?" — los agentes se registran ellos mismos cuando tienen trabajo. El coste del scheduler en Hokage OS debería ser O(agentes con work items activos), no O(agentes totales).

**El orden fijo de tick es más valioso que cualquier optimización de código.** Un tick con etapas nombradas, documentadas y ordenadas elimina toda una categoría de bugs de timing y race conditions. Los bugs más difíciles de diagnosticar en sistemas de agentes son los causados por el orden de ejecución. Un orden fijo hace esos bugs imposibles por diseño.

**La separación data stage / control stage es el patrón correcto para configuración de agentes.** Los prompts son inmutables en runtime — cualquier cambio requiere recarga explícita. La lógica de orquestación puede cambiar en caliente. Esta distinción evita que cambios de configuración corrompan estados en vuelo.

La síntesis ideal para Hokage OS: el active entity set y el orden de tick fijo de Factorio + el tick escalonado por prioridad de RimWorld + el objeto-genera-trabajo de Prison Architect + la sala como unidad de trabajo de Software Inc. Son cuatro aproximaciones al mismo problema desde ángulos distintos, y juntos cubren todos los aspectos del agent runtime que Hokage OS necesita.

---

# Recomendaciones para Hokage OS

## Imprescindible

### R1 — Active agents set: solo iterar agentes con trabajo activo
**Patrón:** active entity set (Factorio)  
**Aplicación:** el scheduler mantiene un Set de agentes activos. Solo esos agentes se procesan en cada ciclo. Los agentes idle no consumen tiempo de scheduler.  
**Impacto técnico:** alto — coste O(activos) en vez de O(total). Simplifica diagnóstico de runtime.  
**Dificultad:** baja — un Set<agentId> en el runtime + add/remove en transiciones de estado  
**Prioridad:** Fase actual (scheduler fix)

---

### R2 — Orden de tick fijo y documentado para el agent runtime
**Patrón:** fixed tick order (Factorio)  
**Aplicación:** el ciclo del agent runtime tiene 8 etapas nombradas con orden declarado: procesar eventos → escanear cola → asignar → ejecutar → verificar TTLs → recoger resultados → generar items derivados → actualizar métricas.  
**Impacto técnico:** alto — elimina bugs de race condition por diseño. Hace el sistema debuggeable.  
**Dificultad:** baja — refactorizar el pollTick actual en etapas nombradas  
**Prioridad:** Fase actual (scheduler fix)

---

### R3 — Contratos de interfaz explícitos entre sistemas (no llamadas directas)
**Patrón:** shared data interfaces, not direct calls (Factorio)  
**Aplicación:** el scheduler deposita work items en BD, no llama al runtime. El runtime emite eventos a través de una función de publicación, no llama al bus directamente. Ningún sistema conoce la implementación de otro.  
**Impacto técnico:** alto — desacoplamiento real. Permite reemplazar cualquier sistema sin romper los otros.  
**Dificultad:** media — requiere revisar y refactorizar las llamadas actuales  
**Prioridad:** Fase actual

---

## Muy recomendable

### R4 — Separación data stage / control stage para configuración de agentes
**Patrón:** data stage / control stage (Factorio)  
**Aplicación:** los prompts de agente son inmutables en runtime (data stage). Si cambian, el agente se recarga explícitamente antes del siguiente tick. La lógica de orquestación puede cambiar en caliente (control stage).  
**Impacto técnico:** medio — evita corrupción de estados en vuelo por cambios de configuración  
**Dificultad:** baja — hash de configuración en BD + recarga condicional  
**Prioridad:** Fase actual

---

### R5 — Snapshot inmutable para el frontend
**Patrón:** render thread snapshot (Factorio)  
**Aplicación:** el WebSocket envía snapshots del estado con timestamp. El frontend trabaja con datos inmutables, nunca con estado vivo.  
**Impacto técnico:** medio — elimina race conditions entre el tick del backend y las lecturas del frontend  
**Dificultad:** baja — los mensajes de WebSocket ya son serializados; solo formalizar el modelo de snapshot  
**Prioridad:** Fase frontend definitivo

---

### R6 — Dirty flags con TTL para métricas costosas
**Patrón:** lazy recalculation with dirty flags (Factorio)  
**Aplicación:** KPIs del dashboard cacheados con TTL de 60 segundos. Solo se invalidan cuando hay nuevos datos relevantes.  
**Impacto técnico:** bajo ahora (pocos datos), medio cuando haya historial real  
**Dificultad:** baja — TTL-based cache en la ruta de API de métricas  
**Prioridad:** Fase frontend definitivo

---

### R7 — Agrupación de work items de un mismo pipeline (belt segment analogy)
**Patrón:** belt segment grouping (Factorio)  
**Aplicación:** los work items del mismo pipeline se agrupan en una estructura `pipeline_run`. Si el pipeline_run está bloqueado, todos sus steps son inactivos como grupo.  
**Impacto técnico:** medio — simplifica el scheduler y mejora la trazabilidad  
**Dificultad:** media — requiere tabla pipeline_runs en BD (ya en ARCHITECTURE.md)  
**Prioridad:** Fase 7 (pipeline completo)

---

## Opcional

### R8 — Two-level dispatch para routing de work items
**Patrón:** two-level pathfinding aplicado al scheduler (Factorio)  
**Aplicación:** nivel coarse = qué tipo de agente maneja este work item (O(1)). Nivel fino = cuál instancia tiene menor carga (solo relevante con múltiples negocios).  
**Impacto técnico:** bajo ahora (un agente por tipo), medio en fases multi-business  
**Dificultad:** baja (coarse) a media (fino)  
**Prioridad:** Fase 9 (multi-business)

---

### R9 — Frame budget para el ciclo del runtime
**Patrón:** frame budget enforcement (Factorio / RimWorld)  
**Aplicación:** si el ciclo del runtime supera X ms, parar de procesar nuevos work items y diferir al siguiente ciclo. Evita que un ciclo con muchos items bloquee el event loop de Node.js.  
**Impacto técnico:** bajo (ejecución de agentes ya es async), necesario cuando el volumen sea alto  
**Dificultad:** baja — `Date.now()` antes y después de cada etapa, con early exit si supera el budget  
**Prioridad:** Fase 6–7 (cuando haya volumen real)

---

## Referencias

- [Friday Facts Blog #176 — Belt entities and belt optimizations](https://www.factorio.com/blog/post/fff-176) — belt segment system explicado por los devs
- [Friday Facts Blog #181 — Belt structure and other things](https://www.factorio.com/blog/post/fff-181) — implementación detallada de segmentos
- [Friday Facts Blog #300 — Special belt, Circuit, & Performance](https://www.factorio.com/blog/post/fff-300) — multithreading roadmap
- [Friday Facts Blog #322 — 1.0 is out!](https://www.factorio.com/blog/post/fff-322) — estado del engine en 1.0 y decisión sobre determinismo vs paralelismo
- [Friday Facts Blog #370 — Research and Technology in 2.0](https://www.factorio.com/blog/post/fff-370) — cambios del engine en 2.0
- [Factorio API docs v1.1 — Events](https://lua-api.factorio.com/latest/Events.html) — eventos disponibles y orden de tick
- [Factorio API docs v1.1 — LuaGameScript](https://lua-api.factorio.com/latest/LuaGameScript.html) — API de control stage
- [Factorio Wiki — Prototype definitions](https://wiki.factorio.com/Prototype_definitions) — data stage y prototipo vs instancia
- [Factorio Wiki — Circuit network](https://wiki.factorio.com/Circuit_network) — mecánica y arquitectura del circuit network
- [Reddit r/factorio — UPS optimization megathread](https://www.reddit.com/r/factorio/comments/n0fvbz/) — experiencias de la comunidad con mega-bases >1M entidades
- [Factorio Forum — Desyncs and determinism](https://forums.factorio.com/viewtopic.php?t=73908) — cómo el equipo garantiza determinismo en multijugador
- [Wube Software tech blog — Multithreading in Factorio](https://factorio.com/blog/post/fff-370) — decisiones de threading y sus trade-offs
