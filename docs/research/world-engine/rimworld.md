# RimWorld — Arquitectura de simulación
> Categoría: world-engine  
> Analizado: 2026-08-01  
> Relevancia para Hokage OS: **alta**  
> Fuente principal: decompilación comunitaria verificada (C# → IL) + documentación de modding oficial

---

## Objetivo del análisis

Extraer principios arquitectónicos del motor de simulación de RimWorld aplicables al diseño del World Engine y el Agent Runtime de Hokage OS. El análisis se centra en cómo un simulador comercial gestiona entidades autónomas complejas, actualización de estado, pathfinding y separación entre simulación y renderizado a escala.

No se estudia el juego. Se estudia la máquina que lo hace funcionar.

---

## Resumen ejecutivo

RimWorld es un simulador de agentes autónomos construido sobre tres decisiones arquitectónicas fundamentales:

**1. Entidades como contenedores de sub-sistemas.** Un agente no es un objeto monolítico. Es un hub que delega cada dominio (salud, movimiento, trabajo, cognición, renderizado) a un tracker especializado. El renderizado es explícitamente privado y nunca es tocado por el código de simulación.

**2. Tick escalonado con tres velocidades.** El motor distingue entre actualización crítica (cada tick), poco urgente (cada ~250 ticks) y de fondo (cada ~2000 ticks). Las entidades se distribuyen en el tiempo por hash para que no todas carguen el mismo frame.

**3. Pipeline de trabajo con bloqueo previo al cálculo de ruta.** Las tareas siguen un pipeline de tres capas: descubrimiento → empaquetado → ejecución. Un sistema de reservas actúa como tabla de locks antes de que ningún agente calcule una ruta, evitando colisiones a nivel de planning, no de ejecución.

La separación simulación/render, el tick escalonado y el sistema de locks son los tres patrones más transferibles a Hokage OS.

---

## Arquitectura general

```
┌───────────────────────────────────────────────────────────────┐
│  TICK MANAGER                                                  │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────────┐   │
│  │  Normal tick │  │  Rare tick    │  │  Long tick        │   │
│  │  (cada tick) │  │  (~250 ticks) │  │  (~2000 ticks)    │   │
│  └──────┬───────┘  └───────┬───────┘  └────────┬──────────┘   │
│         │                  │                    │              │
│  ┌──────▼──────────────────▼────────────────────▼──────────┐  │
│  │  ENTIDAD (Agente)                                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐   │  │
│  │  │ Cognición│  │Movimiento│  │  Salud   │  │ [Draw] │   │  │
│  │  │ (AI tree)│  │(pather)  │  │(health)  │  │privado │   │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│  PIPELINE DE TRABAJO                                          │
│                                                               │
│  WorkGiver          JobGiver           JobDriver              │
│  "¿hay algo        "empaqueta         "ejecuta como           │
│   que hacer?"       la tarea"          máquina de estados"    │
│       │                 │                   │                 │
│       └── ReservationManager (lock table) ──┘                 │
│               bloquea ANTES de calcular ruta                  │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│  PATHFINDING JERÁRQUICO                                       │
│                                                               │
│  Nivel 1: grafo de regiones (chunks ~12×12 tiles)            │
│            → ruta aproximada barata                          │
│  Nivel 2: A* celda a celda                                   │
│            → usa ruta de regiones como heurística            │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│  EVENTOS / INCIDENTES                                         │
│                                                               │
│  StorytellerComp → IncidentWorker → LetterStack (UI)         │
│                                                               │
│  La simulación empuja a un stack. La UI lo lee.              │
│  Único punto de acoplamiento: el stack.                      │
└───────────────────────────────────────────────────────────────┘
```

---

## Componentes principales

### 1. Entidad como hub de trackers

Una entidad no es una clase con 200 campos. Es un contenedor que delega cada responsabilidad a un tracker especializado:

- Tracker de cognición (árbol de comportamiento)
- Tracker de trabajo (cola de tareas en curso)
- Tracker de movimiento (seguir una ruta)
- Tracker de necesidades (hambre, descanso, estado de ánimo)
- Tracker de salud
- Tracker de relaciones sociales
- Tracker de inventario
- Tracker de renderizado — **privado**, nunca llamado desde simulación

Cada tracker recibe llamadas de ciclo de vida (`tick`, `tickRare`, `tickLong`, `save`, `load`) delegadas desde la entidad principal.

**Invariante crítica:** el tracker de renderizado es el único que conoce posición visual, meshes y materiales. El resto de trackers operan en coordenadas de simulación.

---

### 2. Tick Manager con tres velocidades

El motor mantiene tres listas de objetos suscritos:

| Lista | Frecuencia | Uso |
|-------|-----------|-----|
| Normal | Cada tick | Movimiento, ejecución de tarea, AI activa, salud crítica |
| Rare | ~cada 250 ticks | Chequeos no urgentes, efectos ambientales |
| Long | ~cada 2000 ticks | Procesos de fondo, estadísticas globales |

Cada objeto elige su lista al crearse. El motor ejecuta las tres listas en orden cada tick, disparando la rare o long solo cuando corresponde por módulo.

**Escalonamiento por hash:** las entidades no se distribuyen por ID secuencial sino por `hash(ID) % intervalo`. Esto evita que en el tick 250 todas las entidades con rare tick disparen a la vez.

**Budget de frame:** el manager mide tiempo real. Si una ronda de ticks supera `1000ms / FPS_mínimo` (≈45ms), para de procesar aunque queden ticks pendientes en ese frame.

---

### 3. Pathfinding jerárquico dos niveles

**Nivel 1 — grafo de zonas:** el mapa se divide en regiones (chunks de ~12×12 celdas, delimitadas por obstáculos). Se calcula primero una ruta aproximada entre regiones. Esto produce una heurística de coste real mucho mejor que la distancia Manhattan.

**Nivel 2 — A* celda a celda:** usa la ruta de regiones como guía. Solo expande celdas que están en la dirección correcta según el grafo superior. Esto drásticamente reduce nodos expandidos en rutas largas.

**Grids planos:** todas las propiedades del mapa (coste de movimiento, obstáculos, penalizaciones) son arrays planos indexados por `x + z * ancho`. Lookup O(1) sin indirección de punteros.

**Sesgo intencional:** el heurístico está calibrado para velocidad, no optimalidad. Las rutas son "suficientemente buenas" en lugar de globalmente óptimas. Decisión explícita de diseño.

---

### 4. Pipeline de trabajo en tres capas

```
Capa 1 — Descubrimiento (WorkGiver)
  "¿Hay algo que hacer en el mundo que encaje con mis capacidades?"
  Escanea el estado global, devuelve un objetivo o nada.

Capa 2 — Empaquetado (JobGiver)
  "Dado ese objetivo, crea una tarea concreta con pasos."
  Produce una Job: secuencia de pasos + recursos requeridos.

Capa 3 — Ejecución (JobDriver / Toil)
  "Ejecuta la tarea paso a paso como máquina de estados."
  Cada paso (Toil) tiene: inicialización, acción por tick, condición de salida.
```

El sistema de **reservas** actúa entre capas 1 y 2: antes de que una entidad se comprometa con un objetivo, lo registra en la tabla de locks. Esto evita que dos entidades calculen rutas hacia el mismo destino y colisionen al llegar.

---

### 5. Árbol de comportamiento con dos niveles de urgencia

La IA de cada entidad es un árbol de prioridades evaluado cada tick:

- **Árbol principal:** determina la siguiente tarea si el agente no tiene ninguna activa.
- **Árbol constante:** se evalúa cada ~30 ticks y puede **interrumpir** la tarea en curso si encuentra algo de mayor prioridad (emergencia, necesidad crítica).

Los nodos son componibles: un árbol puede insertar sub-árboles externos, lo que permite construir comportamientos complejos por composición sin reescribir la lógica base.

---

### 6. Separación definición/instancia

Los datos estáticos (propiedades, configuración, tipo) están separados de las instancias en ejecución:

- **Definición:** inmutable, cargada una vez al inicio, referenciada por nombre único. Contiene: categoría, propiedades base, lista de componentes posibles.
- **Instancia:** creada por una fábrica que lee la definición, vive durante el juego, tiene estado mutable.

Esto hace que añadir un nuevo tipo de entidad sea solo añadir una definición. No hay código de instanciación por tipo.

---

### 7. Eventos como stack con acoplamiento único

El flujo de eventos externos es:

```
Motor de lógica → IncidentWorker → LetterStack (buffer) ← UI
```

La simulación nunca llama directamente a la UI. Solo empuja a un stack compartido. La UI consume el stack en su propio ciclo de render. El stack es el único punto de contacto entre los dos mundos.

---

## Flujo interno del sistema

Ciclo de un tick completo (simplificado):

```
TickManager.DoSingleTick()
  ├── ticksGame++
  ├── Normal tick list → cada entidad suscrita recibe Tick()
  │   └── Entidad.Tick()
  │       ├── movimiento.Tick()       → avanza N pasos de ruta
  │       ├── trabajo.Tick()          → ejecuta toil actual
  │       └── cognición.Tick()        → si no hay tarea, evalúa árbol
  ├── Rare tick list  (si ticksGame % 250 == hash_offset)
  │   └── Entidad.TickRare()
  │       ├── salud.TickRare()        → chequeos no críticos
  │       └── necesidades.TickRare()  → decay lento
  ├── Long tick list  (si ticksGame % 2000 == hash_offset)
  │   └── Entidad.TickLong()
  │       └── estadísticas.TickLong() → métricas de fondo
  ├── StorytellerTick()               → genera eventos aleatorios
  ├── LetterStack.Tick()              → muestra alertas a UI
  └── Autosave check
```

El pathfinding en versiones recientes se ejecuta **fuera de este ciclo**, en hilos paralelos sin acceso a estado compartido mutable durante su fase de cálculo.

---

## Patrones reutilizables

### P1 — Entidad como hub de trackers especializados

**Principio:** una entidad compleja no es una clase con muchos campos. Es un contenedor que coordina sub-sistemas independientes. Cada sub-sistema es responsable de su propio dominio y su propio estado.

**Por qué importa:** permite añadir o eliminar capacidades sin tocar la entidad principal. Permite testear cada dominio de forma independiente.

**Señal de abuso:** si un tracker necesita leer el estado de otro tracker directamente, el diseño de dominios es incorrecto.

---

### P2 — Tick escalonado con tres velocidades

**Principio:** no toda actualización tiene la misma urgencia. Clasificar sistemas en crítico / frecuente / fondo y asignar frecuencias distintas. Distribuir entidades en el tiempo para que no coincidan en el mismo ciclo.

**Por qué importa:** en un sistema con N agentes, el coste por tick es O(N) solo si todos tickean cada frame. Reducir frecuencia de la mitad de sistemas a 1/250 reduce coste total significativamente.

**Invariante:** el escalonamiento debe ser por hash del ID, no por ID módulo intervalo, para que la distribución sea uniforme incluso cuando los IDs son consecutivos.

---

### P3 — Budget de frame explícito

**Principio:** el motor de simulación debe medir su propio coste en tiempo real y pausar si supera el budget asignado. La simulación no puede asumir tiempo ilimitado por frame.

**Por qué importa:** en un sistema backend que también atiende peticiones HTTP, el runtime de agentes comparte CPU. Si un tick de agentes tarda 5 segundos, las peticiones se degradan. El budget fuerza equidad.

---

### P4 — Lock de recursos antes del cálculo de ruta

**Principio:** antes de que un agente se comprometa con un objetivo y empiece a planificar cómo llegar, debe verificar que el objetivo está disponible y registrar su intención. Ningún otro agente puede tomar ese objetivo durante el planning.

**Por qué importa:** sin este mecanismo, dos agentes calculan rutas al mismo recurso, uno llega primero y el otro invalida todo su trabajo. El lock previo convierte un problema de carrera en una cola ordenada.

---

### P5 — Pipeline de trabajo en tres capas

**Principio:** separar "qué hay que hacer" (escaneo del mundo), "cómo se hace" (construcción de la tarea), y "ejecutar paso a paso" (máquina de estados). Ninguna capa conoce el interior de las otras.

**Por qué importa:** permite cambiar la lógica de descubrimiento sin tocar la ejecución. Permite reutilizar drivers de ejecución para tareas distintas. Permite probar cada capa en aislamiento.

---

### P6 — Árbol de comportamiento con interrupción de alta prioridad

**Principio:** el árbol principal determina la siguiente tarea. Un árbol secundario, evaluado con menor frecuencia, puede interrumpir cualquier tarea si detecta una condición de mayor urgencia. La interrupción es limpia porque las tareas son máquinas de estado con punto de salida definido.

**Por qué importa:** permite que un agente ejecute trabajo de fondo mientras responde a eventos urgentes sin lógica de excepción en el código de cada tarea.

---

### P7 — Separación estricta definición/instancia

**Principio:** los datos que definen un tipo de entidad (sus propiedades, capacidades, configuración) son inmutables y están separados de las instancias en ejecución. Una fábrica central crea instancias a partir de definiciones.

**Por qué importa:** añadir un nuevo tipo no requiere código nuevo. El sistema de herencia de definiciones permite variantes sin duplicación. La separación hace que los errores de configuración sean detectables antes de que se creen instancias.

---

### P8 — La simulación no conoce la UI

**Principio:** la simulación produce eventos y los empuja a un buffer. La UI consume ese buffer en su propio ritmo. La dirección de dependencia es siempre simulación → buffer ← UI. La simulación nunca llama código de presentación.

**Por qué importa:** permite cambiar completamente la UI sin tocar simulación. Permite tener múltiples representaciones del mismo estado (WebSocket, REST, logs) consumiendo el mismo buffer.

---

### P9 — Pathfinding jerárquico para espacios grandes

**Principio:** dividir el espacio en regiones y resolver primero en el grafo de regiones (coste bajo), luego refinar a nivel de celda usando la solución de regiones como heurística. El primer nivel hace el segundo mucho más rápido.

**Por qué importa:** el tiempo de A* crece con el número de nodos expandidos. Una heurística precisa (basada en rutas reales, no distancia Manhattan) reduce expansiones en un orden de magnitud para rutas largas.

---

### P10 — Paralelizar solo subsistemas sin dependencias de escritura

**Principio:** la simulación core es single-thread. Los subsistemas que pueden aislarse (pathfinding, render, iluminación) se mueven a hilos independientes, pero solo durante su fase de lectura/cálculo, antes de escribir resultados de vuelta.

**Por qué importa:** la concurrencia sin disciplina produce condiciones de carrera difíciles de detectar. La estrategia correcta es identificar fases "solo lectura" o "escritura aislada" y paralelizar esas fases, no el bucle principal.

---

## Qué NO copiaría

### La granularidad de trackers por agente

RimWorld tiene ~30 trackers por entidad porque modela necesidades humanas complejas (hambre, descanso, humor, relaciones sociales, historial de vida). Para Hokage OS, los agentes son procesos de negocio, no simulaciones sociales. Un agente de Hokage OS con 30 sub-trackers sería sobre-ingeniería pura.

**El principio sí aplica. La granularidad, no.**

---

### El sistema de reservas a nivel de celda

El ReservationManager opera a nivel de celda de grid 2D porque los agentes se mueven físicamente por el mapa y pueden colisionar en el espacio. Los agentes de Hokage OS no se mueven en un espacio físico — compiten por recursos de negocio (productos, clientes, slots de publicación). El mecanismo de locking aplica, pero la implementación debe ser conceptual, no espacial.

---

### El árbol de comportamiento en XML

El árbol se define en XML para que modders puedan modificarlo sin compilar. Esta complejidad adicional no aporta valor en un sistema donde los agentes tienen comportamientos fijos definidos en código TypeScript.

---

### El pathfinding jerárquico regional

Resuelve el problema de mover un personaje por un mapa 2D con obstáculos dinámicos. Los agentes de Hokage OS no tienen posición física ni obstáculos en el espacio. Si Hokage OS llegara a necesitar un mapa navegable en el frontend (pixel art tycoon), el patrón P9 aplica. Hoy, no.

---

### La serialización de estado completa

RimWorld tiene un sistema de serialización propio que persiste y restaura el estado completo de cada tracker. Es extremadamente complejo. Hokage OS ya tiene SQLite para persistencia. No es necesario replicar este sistema.

---

## Cómo adaptaría estas ideas a Hokage OS

### Agent como hub de trackers (P1)

El `Pawn` con sus 30 trackers se convierte en un `Agent` con tres:

```
Agent {
  CognitionTracker   → árbol de decisión + memoria semántica
  TaskTracker        → tarea actual + cola
  StateTracker       → estado visible (idle/working/waiting/error)
}
```

El tracker de renderizado privado ya existe como separación entre el backend (`Agent` en BD) y el frontend (`TokenDescriptor` en PixiJS). Esa separación está bien diseñada. Solo hay que mantenerla explícita.

---

### Tick escalonado (P2 + P3)

El `pollTick` actual de 10 segundos es una iteración secuencial de todos los agentes sin distinción de urgencia.

Propuesta adaptada:

| Nivel | Frecuencia | Responsabilidad |
|-------|-----------|----------------|
| Critical | 10s | Agentes con decisión aprobada pendiente de ejecutar |
| Frequent | 5min | Agentes con tarea en curso que necesita seguimiento |
| Scheduled | Per-agente | Tarea autónoma según intervalo del rol |

La distribución por hash evita que todos los agentes con intervalo de 30 minutos coincidan en el mismo ciclo. El budget de frame equivale a un timeout de ejecución por ciclo: si el runtime lleva más de X segundos, pospone los agentes restantes al siguiente ciclo.

---

### Lock de recursos (P4)

Antes de que dos agentes actúen sobre el mismo recurso (mismo producto, mismo slot de publicación), uno registra su intención. El otro detecta el lock y busca alternativa.

Tabla mínima: `agent_locks (resource_type, resource_id, agent_id, expires_at)`. Los locks expiran automáticamente para evitar deadlocks si un agente falla a mitad de tarea.

---

### Pipeline de trabajo en tres capas (P5)

El `AUTONOMOUS_TASKS` actual mezcla descubrimiento con la tarea en sí. La separación limpia:

| Capa | Función | ¿IA necesaria? |
|------|---------|---------------|
| WorkScanner | Examina BD y detecta trabajo pendiente | No |
| TaskBuilder | Construye el contexto/prompt específico | No |
| TaskDriver | Ejecuta el prompt y procesa la respuesta | Sí |

Esta separación hace que el scanner sea determinista (sin coste de tokens) y el TaskDriver sea el único punto que consume API de IA.

---

### Interrupción de alta prioridad (P6)

Si existe una decisión aprobada por Jorge que requiere acción del agente, el siguiente tick del agente la ejecuta antes que su tarea autónoma programada. Hoy las decisiones se crean pero no interrumpen. Esta es la pieza que falta para cerrar el loop Jorge → agente → acción.

---

### Separación simulación/UI (P8)

El Event Bus ya implementa este patrón correctamente. El problema es que el frontend también hace polling REST para estado inicial, creando un canal dual. La solución: el WebSocket sirve estado inicial en el evento de conexión, eliminando el polling REST paralelo.

---

### Paralelización aislada (P10)

Las llamadas a OpenRouter ya son asíncronas. El problema es que el runtime ejecuta agentes con `for await` secuencial. La adaptación: `Promise.allSettled` para agentes que no compiten por el mismo recurso (determinado por el sistema de locks de P4). Sin locks: sin paralelismo seguro.

---

## Riesgos

### R1 — Complejidad prematura del tick system

Implementar tres niveles de tick y distribución por hash antes de tener más de 5 agentes activos añade complejidad sin beneficio medible. **Umbral de aplicación:** cuando el runtime tarde más de 2 segundos en un pollTick con todos los agentes activos en producción.

### R2 — El sistema de locks puede convertirse en un cuello de botella

Si los locks se implementan con consultas síncronas a SQLite antes de cada tarea, el overhead de locking puede superar el beneficio. **Mitigación:** locks en memoria (Map en Node.js) con escritura en BD solo para persistencia, no como mecanismo de sincronización en el camino crítico.

### R3 — La separación WorkScanner/TaskBuilder requiere datos reales

Si los agentes no tienen datos reales del mundo (ventas reales, tendencias reales, inventario real), el WorkScanner siempre devuelve vacío y los agentes siguen operando con prompts genéricos. La separación en capas solo aporta valor cuando la capa de descubrimiento tiene datos que examinar. **Prerrequisito:** integración con Etsy antes de implementar esta separación con seriedad.

### R4 — Las interrupciones limpias requieren tareas con punto de salida definido

Implementar interrupciones de alta prioridad antes de tener tareas multi-paso sería optimización prematura. Las tareas actuales son atómicas (un prompt, una respuesta), así que la interrupción equivale simplemente a priorizar en la cola antes del siguiente tick.

---

## Referencias

- [Chillu1/RimWorldDecompiled](https://github.com/Chillu1/RimWorldDecompiled) — Decompilación C# más reciente y verificada
- [josh-m/RW-Decompile](https://github.com/josh-m/RW-Decompile) — Decompilación alternativa con estructura de archivos clara
- [BetterPathfinding — NewPathFinder.cs](https://github.com/Zhentar/BetterPathfinding/blob/master/BetterPathfinding/NewPathFinder.cs) — Análisis detallado del pathfinding original con propuesta de mejora
- [CBornholdt — RimWorld AI Tutorial](https://github.com/CBornholdt/RimWorld-AI-Tutorial/wiki/Part-1---Introduction) — Documentación del sistema de árbol de comportamiento
- [roxxploxx — How Pawns Think](https://github.com/roxxploxx/RimWorldModGuide/wiki/SHORTTUTORIAL:-How-Pawns-Think) — Flujo de toma de decisiones explicado para modders
- [Dubs Performance Analyzer](https://github.com/simplyWiri/Dubs-Performance-Analyzer) — Datos de profiling real en partidas de escala alta
- [RimWorldHub — AI Paths Unpacked](https://rimworldhub.com/post/ai_paths_unpacked_rimworld_routing_quirks__tactics) — Análisis del pathfinding con casos extremos
- [RimWorld Wiki — Version 1.6](https://rimworldwiki.com/wiki/Version/1.6.4518) — Cambios de rendimiento en la versión más reciente
- [HugsLib — Custom Tick Scheduling](https://github.com/UnlimitedHugs/RimworldHugsLib/wiki/Custom-Tick-Scheduling) — Extensión del tick system por terceros
- [Ludeon forums — Pathfinding discussion](https://ludeon.com/forums/index.php?topic=51592.0) — Debate técnico con desarrolladores del juego
