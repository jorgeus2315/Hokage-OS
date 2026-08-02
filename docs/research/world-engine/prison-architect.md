# Prison Architect — Arquitectura de simulación de sistemas complejos
> Categoría: world-engine  
> Analizado: 2026-08-02  
> Relevancia para Hokage OS: **alta**  
> Fuente principal: Introversion Forums (dev posts), Paradox Wiki oficial, Prison-Architect-API GitHub (originalfoo), changelogs Alpha 14–15, Steam Community guides

---

## Objetivo del análisis

Prison Architect (Introversion Software, 2015) es un simulador de gestión de prisiones con cientos de entidades autónomas, pathfinding dinámico, sistema de necesidades de 18 variables y una arquitectura completamente data-driven. El objetivo es extraer sus decisiones arquitectónicas y determinar cuáles son aplicables a Hokage OS como sistema de agentes autónomos de negocio.

---

## 1. Visión general

### Qué intenta simular

Un sistema de sistemas: el espacio físico de una prisión, los flujos de trabajo del personal, las necesidades de los presos, la economía de operación y las dinámicas sociales emergentes entre cientos de entidades. El jugador no gestiona individuos — gestiona políticas, horarios y espacios. El comportamiento individual emerge de las reglas del sistema.

### Pilares de arquitectura

**1. Data-driven puro.** Casi todo el contenido del juego — objetos, entidades, necesidades, tipos de habitación, árbol de investigación — está definido en archivos de texto con el mismo formato que los archivos de guardado. El runtime no tiene conocimiento especial de ningún tipo de objeto. Un compilador de Lua puede añadir un nuevo tipo de entidad sin tocar el motor.

**2. Objeto como generador de trabajo.** Los objetos no esperan a que un scheduler central les diga qué necesita hacerse. Cuando su estado cambia, generan su propio job en la cola global. Un horno lleno genera "servir comida". Un punto de entrega genera "recibir mercancías". El estado del objeto y la generación del trabajo son la misma operación.

**3. Necesidades como sistema de interrupción priorizado.** Las 18 necesidades de los presos tienen niveles de prioridad explícitos (1–9) y dos umbrales separados: uno para empezar a buscar satisfacción, y otro para consecuencia de fallo. El sistema de AI no necesita comparar utilidades globales — solo verificar si la necesidad más prioritaria ha cruzado su umbral.

**4. Separación simulación / datos.** El motor en C++ gestiona el loop, el pathfinding y el render. El comportamiento de cada objeto está en Lua (una VM aislada por objeto). Los datos de contenido están en texto. Son tres capas que no se conocen entre sí.

### Qué hace diferente a Prison Architect

Frente a otros simuladores de su época, Prison Architect tomó tres decisiones inusuales:

- **Pathfinding en thread dedicado desde Alpha 14.** Cuando el resto de juegos indie todavía bloqueaban el main thread en A*, Introversion aisló el pathfinding completamente, con Johnny Knottenbelt (PhD en AI, Imperial College) implementando la solución.
- **Formato de datos isomorfo al formato de save.** No hay capa de serialización separada — el formato de datos de juego y el formato de guardado son el mismo. Los archivos de save son legibles como texto plano y tienen la misma estructura que las definiciones de contenido.
- **Clasificación de habitaciones explícita por el jugador, no inferida por el sistema.** La habitación es lo que el jugador dice que es. El sistema verifica si los requisitos se cumplen, no detecta el tipo.

---

## 2. World Engine

### Representación del mapa — grid sparse

El mundo es un grid 2D de integers con dimensiones declaradas como `NumCellsX` / `NumCellsY`. Solo los tiles no-default se escriben a disco (codificación sparse). Un tile almacena:

| Campo | Tipo | Significado |
|-------|------|-------------|
| `Mat` | enum string | Material: BrickWall, ConcreteFloor, Grass, Fence, Road, PerimeterWall... (17+ valores) |
| `Con` | float 0–100 | Integridad estructural del tile |
| `Ind` | boolean | ¿Está bajo techo? |
| `Room.i` | int | ID local de habitación (scoped por tipo) |
| `Room.u` | int | ID global único de habitación |

La mayoría de tiles solo tienen `Mat` y `Con`. Los campos de habitación aparecen únicamente en tiles designados como parte de una habitación.

### Objetos — separados de tiles

Los objetos no están embebidos en los tiles. Existen en una sección `BEGIN Objects` separada del save file. Cada objeto tiene:

- `Id.i` — identificador local (scoped por tipo de objeto)
- `Id.u` — identificador global único (de un contador compartido `ObjectId.next`)
- Posición X, Y en el grid
- Estado específico del tipo (tuberías almacenan `PressureX`/`PressureY`, puertas almacenan estado de cierre)

El contador global `ObjectId.next` asigna IDs a todo: muebles, presos, guardias, vehículos. Es el mecanismo de creación de entidades de todo el sistema.

### Entidades — definición por flags en datos

Todo el contenido del juego se define en `materials.txt`. El flag `Properties Entity` en la definición de un objeto lo convierte en una entidad navegante. Los tipos de entidad reconocidos son: `Prisoner`, `Administrator`, `Staff`, `Guard`. No hay herencia de código entre tipos — la distinción es un flag en datos.

### Habitaciones — clasificación explícita

Las habitaciones no se infieren del contenido. El jugador designa un área y la declara como tipo específico (Comedor, Taller, Biblioteca). El sistema valida si los requisitos del tipo están cumplidos. La clasificación es siempre jugador → sistema, nunca sistema → jugador.

Campos de definición de habitación en `materials.txt`:
- `Enclosed` — debe estar completamente rodeada de muros y puertas
- `Secure` — sin rutas de escape al exterior
- `MinimumSize x [w] y [h]` — dimensiones mínimas
- `Object [NombreObjeto]` — objetos requeridos dentro de la habitación
- `AdjacentObject [NombreObjeto]` — objetos requeridos en la pared adyacente
- `RequiresSector` — la habitación genera automáticamente su propio sector de seguridad

La revalidación de habitaciones ocurre cuando se construye o demuele una pared o puerta. Cualquier cambio topológico invalida el estado de habitación de los tiles afectados.

### Sectores — zonas de control de acceso

Los sectores son áreas topológicamente contiguas sin puertas entre ellas. Cada sector tiene una designación de acceso: Compartido, Solo Personal, Solo Presos, Nivel de Seguridad Específico, Sin Acceso, etc. Los sectores no son habitaciones — son un layer de control de acceso que actúa como pre-filtro del pathfinding.

---

## 3. Navegación

### Algoritmo — A* por tiles

El pathfinding usa A* sobre el grid de tiles, confirmado por el desarrollador. Es pathfinding plano — no hay un grafo de abstracción sobre el grid en el sentido de HPA*.

**La diferenciación de Prison Architect es de ingeniería, no de algoritmo.** El A* en sí es estándar. Lo que lo hace escalable son sus condiciones de ejecución.

### Thread dedicado (desde Alpha 14)

El pathfinding corre en un thread dedicado separado del loop principal. Esto fue implementado por Johnny Knottenbelt (PhD en AI, Imperial College London) y es el cambio de rendimiento más importante de toda la historia del juego.

El mecanismo exacto: el main thread sincroniza con el pathfinding thread antes de renderizar cada frame. El pathfinding no es completamente asíncrono — hay un punto de sincronización por frame. Esto elimina el stall del main thread pero mantiene garantías de consistencia.

### Sector como pre-filtro

Antes de ejecutar A*, el sistema verifica qué sectores puede atravesar la entidad según su tipo y credenciales. Los presos no pueden entrar en sectores de solo personal. Los guardias pueden entrar en todos. Esta verificación es booleana y opera sobre un grafo coarse de sectores, no sobre tiles individuales. Reduce significativamente el espacio de búsqueda antes de que A* comience.

### Verificación de alcanzabilidad antes de asignación

Antes de asignar un trabajo a una entidad, el sistema verifica si el destino es alcanzable. Si no hay ruta válida, el trabajo no se asigna — la entidad permanece ociosa y sigue explorando la cola. Esto evita que entidades se bloqueen en trabajos inalcanzables.

### Obstáculos dinámicos — puertas

Las puertas son el obstáculo dinámico principal. La validez de una ruta es dependiente de la entidad: un guardia puede atravesar una puerta cerrada; un preso no. Esto significa que el pathfinding no solo depende de la topología del mapa — depende de la identidad de quien solicita la ruta.

### Límites conocidos

La degradación de rendimiento comienza alrededor de 500 entidades en mapas grandes. El pathfinding crece super-linealmente con el tamaño del mapa, lo que hace que mejoras de hardware den rendimientos decrecientes a escala.

---

## 4. IA

### Dos sistemas separados, no un árbol unificado

La IA de Prison Architect está documentada por el propio equipo como dos subsistemas distintos:

1. **Sistema de necesidades** — exclusivo de presos. Reactivo, orientado a satisfacción propia.
2. **Sistema de trabajos** — todas las entidades (presos y personal). Reactivo, orientado a tareas asignadas externamente.

No hay un árbol de comportamiento ni máquina de estados unificada. La IA es reactiva dual: cuando las necesidades no presionan, la entidad ejecuta trabajos de la cola.

### Sistema de necesidades — 18 variables con 9 niveles de prioridad

```
Prioridad 9: Vejiga, Intestino (crítico-biológico)
Prioridad 8: Sueño, Comida, Ropa, Drogas, Alcohol (supervivencia)
Prioridad 7: Seguridad, Higiene (bienestar)
Prioridad 6: Ejercicio, Familia, Recreación (social)
Prioridad 5: Comodidad, Entorno, Privacidad, Libertad, Espiritualidad, Alfabetización, Calor (calidad de vida)
```

### Modelo de dos umbrales

Cada necesidad tiene dos umbrales independientes:

- **TimeToAction:** cuando se cruza, la entidad empieza a buscar un proveedor de satisfacción
- **TimeToFailure:** cuando se cruza, se dispara la `FailureAction` (ej: orinar en el suelo) y se incrementa el Temperature global

La ventana entre ambos umbrales es el tiempo que el sistema tiene para satisfacer la necesidad antes de consecuencias negativas. Esto produce comportamiento de "procrastinación razonable" sin lógica especial.

Ejemplos de valores documentados:
| Necesidad | TimeToAction | TimeToFailure |
|-----------|-------------|--------------|
| Vejiga | 10 min | 12 min |
| Sueño | 24 min | 24 min |
| Comida | 16 min | 24 min |

### Selección de proveedor — greedy nearest-valid

El modelo de selección no calcula utilidad sobre todos los proveedores posibles. Es greedy:
1. Identificar la necesidad más prioritaria por encima de su TimeToAction
2. Buscar el proveedor válido más cercano para esa necesidad
3. Verificar alcanzabilidad
4. Si alcanzable: navegar y satisfacer
5. Si no alcanzable: siguiente proveedor candidato

Simple, predecible, con limitaciones conocidas (entidades pueden ignorar un mejor proveedor más lejano).

### Definición de proveedor de necesidades

Cada proveedor declara en datos:
- `PrimaryNeed` + `PrimaryRate` — necesidad satisfecha y velocidad de satisfacción
- `SecondaryNeed` + `SecondaryRate` — efecto secundario
- `UsesEntireObject` — uso exclusivo (mutex en el objeto)
- `Shareable` — permite uso concurrente
- `RequiresQuiet` — necesita entorno tranquilo
- `RequiresCash` — el preso necesita fondos
- `NoRoomRequired` — funciona sin habitación designada

### Interrupción y cambio de tarea

Las entidades interrumpen tareas activas por trabajos de mayor prioridad:
- Construcción: `Ctrl+Click` eleva la prioridad de un trabajo y hace que los obreros abandonen el actual
- Guardias: un combate activo anula la asignación de estación — el guardia responde inmediatamente
- Necesidades críticas: prioridad 9 interrumpe cualquier trabajo en curso

No hay un mecanismo de "checkpoint de interrupción" documentado — las tareas se abandonan sin garantía de volver a ellas.

---

## 5. Scheduler

### Cola global de trabajos

Todos los trabajos existen en una única cola global. Los trabajos no son generados por un scheduler central que monitorea el estado del sistema — son generados por los objetos cuando su estado cambia.

Este es el patrón más importante de Prison Architect: **el objeto es el scheduler de sus propios trabajos**.

```
Horno lleno → genera "servir comida"
Punto de entrega recibe mercancía → genera "mover mercancía a almacén"
Puerta bloqueada → genera "abrir puerta"
Cubo de limpieza lleno → genera "vaciar cubo"
```

La cola es el sistema de integración entre el estado del mundo físico y la capacidad de trabajo disponible.

### Flujo de asignación

Cuando una entidad queda ociosa:
1. Escanea la cola por trabajos aplicables (filtrado por tipo de trabajo, luego por prioridad)
2. Para cada candidato: verifica distancia y alcanzabilidad
3. Primer trabajo válido: se reclama — su estado pasa a "En Progreso"
4. Ninguna otra entidad puede reclamar un trabajo En Progreso

El locking In-Progress es un mutex simple a nivel de job que elimina el problema del "thundering herd" (todas las entidades idle corriendo al mismo trabajo).

### Ordenación de la cola

Observable por la comunidad (no documentado oficialmente): el comportamiento es aproximadamente LIFO dentro de un mismo nivel de prioridad. Los trabajos más recientes se recogen antes. Esto causa starvation de trabajos antiguos cuando la cola se llena.

### Niveles de prioridad de trabajos

| Prioridad | Tipo de trabajo |
|-----------|----------------|
| Máxima | Trabajos marcados manualmente (Ctrl+Click) |
| Alta | Demolición |
| Media-alta | Construcción y colocación |
| Media | Exportación / tala de árboles (puede interrumpir construcción) |
| Normal | Tareas estándar |
| Baja | Operación de puertas (la más baja — causa que guardias abandonen puestos) |

### Despliegue de guardias — modelo de estaciones

Los guardias tienen un sistema separado del job queue general: el Deployment. Las habitaciones/sectores tienen prioridades de guardia (1–3). Mayor prioridad atrae guardias de posiciones de menor prioridad. Es un modelo de llenado de estaciones, no de dispatch reactivo puro.

---

## 6. Simulación

### Tiempo real continuo

Prison Architect no es por turnos. El tiempo avanza continuamente. Las necesidades decaen en minutos de juego, no en ticks de sistema.

No hay un timestep fijo documentado equivalente al FixedUpdate de Unity. El decay de necesidades se expresa en unidades de tiempo de juego, desacoplado de la cadencia del motor.

### Modelo de threading (desde Alpha 14–15)

```
Thread principal:    lógica del juego, rendering, input, UI, sincronización
Thread pathfinding:  generación de rutas A* para todas las entidades
Thread de luz:       recálculo de iluminación a 20Hz (desde Alpha 15)

Punto de sincronización: antes de cada frame renderizado
```

El main thread espera al pathfinding thread antes de renderizar. Esto garantiza consistencia pero no es pathfinding completamente asíncrono.

### Qué se actualiza en cada ciclo vs diferido

| Actualización | Frecuencia |
|--------------|-----------|
| Decremento de necesidades de todos los presos | Cada ciclo |
| Pasos de movimiento de entidades | Cada ciclo |
| Iluminación | 20Hz (thread separado) |
| Pathfinding | Thread separado, sincronizado por frame |
| Generación de listas de contrabando | Diferida / lazy (bug de crecimiento ilimitado corregido en Alpha 15) |
| Generación de trabajos | Event-driven (triggered por cambios de estado de objetos) |

### Aceleración del tiempo

A velocidades más altas, el CPU debe procesar más solicitudes de pathfinding y más decrementos de necesidades por segundo de reloj. El juego efectivamente se ralentiza cuando la cola de pathfinding crece más rápido de lo que el thread puede procesarla. El cuello de botella es CPU, no GPU.

---

## 7. Rendimiento

### Optimizaciones confirmadas

**Pathfinding dedicado a thread separado (Alpha 14)**
El cambio individual más impactante en rendimiento. Elimina A* del main thread, efetivamente doblando el tiempo de CPU disponible para lógica+render vs. pathfinding.

**Iluminación a 20Hz en thread separado (Alpha 15)**
El cálculo de iluminación era un segundo cuello de botella. Moverlo a 20Hz en thread separado libera el main thread y reduce el coste de ciclos de rendering.

**Eliminación de copias de memoria innecesarias (Alpha 15)**
"Se han optimizado muchas copias de memoria innecesarias, hace una gran diferencia en Windows especialmente." Las estructuras de datos eran suficientemente grandes para que la copia por ciclo fuera medible.

**Corrección del crecimiento ilimitado de lista de contrabando (Alpha 15)**
Un bug causaba que la lista de contrabando creciera sin límite a lo largo de cientos de días de juego, produciendo ralentización no lineal en prisiones largas.

**Sector como pre-filtro de routing**
Aunque no es HPA*, los sectores eliminan grandes porciones del mapa antes de que A* comience. Una entidad que no puede entrar en ciertos sectores no necesita explorar esos tiles.

### Lo que no está implementado

- Sin spatial partitioning más allá del grid propio (sin quadtrees, sin spatial hashing de chunks)
- Sin path sharing entre entidades que van al mismo destino
- Sin LOD para entidades distantes
- Sin dirty-flag system documentado para necesidades (parecen actualizarse todas cada ciclo)

### Límite conocido

~500 entidades en mapas grandes comienza la degradación notable. El coste del pathfinding crece super-linealmente con el tamaño del mapa. Mejoras de hardware dan rendimientos decrecientes a escala.

---

## 8. Arquitectura del código

### Motor propio en C++

Prison Architect no usa Unity, Unreal ni ningún motor comercial. Está escrito en C++ con un renderer custom — consistente con los juegos anteriores de Introversion (Uplink, Defcon, Darwinia). El equipo núcleo era efectivamente dos personas: Chris Delay (código/diseño) y Mark Morris (negocio/producción), con Johnny Knottenbelt como contribuidor especialista en pathfinding.

### Tres capas separadas

```
C++ (motor):       loop de simulación, A*, renderer, sincronización de threads
Lua (por objeto):  lógica de comportamiento de cada tipo de objeto (una VM por instancia)
Datos (texto):     definiciones de contenido — objetos, entidades, necesidades, habitaciones
```

Estas tres capas no se conocen entre sí. El motor no sabe qué tipos de objetos existen — los carga desde datos. Un objeto no sabe cómo funciona el renderer — ejecuta Lua sandboxed. Un modder puede añadir un nuevo tipo de entidad sin tocar ningún archivo de código.

### Comunicación entre componentes

No hay un event bus ni una cola de mensajes para comunicación entidad-a-entidad documentada. El mecanismo de desacoplamiento es la **cola global de trabajos**:

- Objetos generan trabajos cuando su estado cambia
- Entidades consumen trabajos de la cola
- No hay acoplamiento directo entre el objeto que genera un trabajo y la entidad que lo ejecuta

Es una arquitectura productor-consumidor donde el trabajo es el mensaje.

### Paridad formato runtime / formato save

El mismo formato jerárquico BEGIN/END se usa para:
- Definiciones de contenido en `materials.txt`
- Definiciones de necesidades en `needs.txt`
- Archivos de save `.prison`

No hay capa de serialización. El modelo de datos en memoria es isomorfo al formato en disco. Los saves son inspeccionables como texto plano y tienen la misma estructura que las definiciones de contenido.

---

## 9. UI

### Paneles de información por contexto

La UI de Prison Architect es contextual: seleccionar una entidad o área activa el panel correspondiente. No hay una pantalla global de gestión — la información está anclada al objeto seleccionado en el mundo.

### Sistema de overlays de datos

Varios overlays se activan en runtime para visualizar capas de información sobre el mapa:

**Overlay de despliegue:** colorea cada sector con su designación de acceso. Visualización directa del modelo de datos de sectores.

**Overlay de peligro/temperatura:** agregado escalar por preso que sube con necesidades insatisfechas, peleas y muertes recientes, y baja con necesidades satisfechas y asistencia a capilla. El Security Chief (investigación desbloqueada) activa una proyección predictiva del peligro, sugiriendo que el modelo tiene un componente de proyección hacia adelante.

**Overlay de supresión:** cuantificado en una escala 0–1440 puntos. Cada + representa 160 puntos (máximo 10+). Las tasas son específicas por fuente:

| Fuente | Tasa | Tipo |
|--------|------|------|
| Guardia armado | 180 pts cada 20-50 min de juego, radio 12 tiles | Pulso |
| Francotirador | Todos los presos en LOS a 30m | Pulso |
| Celda de aislamiento | 11 pts/min de juego (660/hr) | Continuo |
| Celda bloqueada | 5 pts/min de juego (300/hr) | Continuo |
| Guardia siguiendo preso | Supresión máxima instantánea | Instantáneo |
| Decay | ~1 pt/min de juego (60/hr) | Continuo |

Este modelo de pulso vs. continuo es arquitectónicamente relevante: el guardia armado no escanea el entorno continuamente — emite un "pulso de supresión" periódico con su rango como radio de efecto.

### Sistema de notificaciones

Los eventos importantes se presentan en una cola de mensajes, no como pop-ups bloqueantes. El jugador procesa las notificaciones a su ritmo.

### Herramientas de construcción

La interfaz de construcción permite designar áreas por arrastre. El sistema valida los requisitos de la habitación en tiempo real y muestra símbolos de advertencia si no se cumplen. Los objetos se arrastran desde un panel de inventario al mapa.

---

## 10. Qué copiaría para Hokage OS

### C1 — Objeto como generador de su propio trabajo

**Principio aplicado a Hokage OS:**
Los eventos de negocio deberían generar trabajos para agentes, no al revés. Cuando una venta ocurre en Etsy, genera automáticamente un trabajo para el agente de finanzas ("registrar venta"). Cuando el Explorador detecta una tendencia, genera un trabajo para el Escritor ("crear contenido sobre [tendencia]"). El agente no monitorea el estado del mundo — el estado del mundo notifica al agente.

Esto es exactamente lo que el Event Bus ya hace, pero falta el segundo paso: que los eventos del bus generen work items concretos en la cola del scheduler.

### C2 — Modelo de dos umbrales para métricas de agente

**Principio aplicado a Hokage OS:**
Las métricas de salud de los agentes (presupuesto de tokens, tasa de error, tiempo sin ejecutar) deben tener dos umbrales:
- **Umbral de acción:** el agente empieza a buscar alternativas (modelo más barato, reducir frecuencia)
- **Umbral de fallo:** el agente se marca como degradado y Jorge recibe una alerta

La ventana entre ambos umbrales evita que cualquier fluctuación menor genere alertas, pero garantiza que los problemas reales lleguen a Jorge.

### C3 — Cola de trabajos con locking In-Progress

**Principio aplicado a Hokage OS:**
Antes de que un agente empiece a procesar un work item, lo marca como "En Progreso". Si el runtime falla y relanza el agente, el work item no se procesa dos veces. Si dos agentes tuviéramos en el futuro sobre el mismo departamento, no toman el mismo trabajo.

### C4 — Prioridades de trabajo explícitas y ordenadas

**Principio aplicado a Hokage OS:**
No todos los trabajos tienen la misma urgencia. Un pipeline de prioridades claro evita que trabajos de fondo (análisis de mercado) bloqueen trabajos urgentes (ejecutar una decisión aprobada por Jorge):

```
P9: Ejecutar decisión aprobada por Jorge
P8: Responder a evento urgente (venta, alerta)
P7: Work item de pipeline activo
P6: Tarea autónoma programada
P5: Análisis periódico de fondo
```

### C5 — Verificación de alcanzabilidad antes de asignación

**Principio aplicado a Hokage OS:**
Antes de asignar un work item a un agente, verificar que el agente tiene las herramientas (tools) necesarias para ejecutarlo. Si el agente de tráfico necesita Google Trends y la herramienta está deshabilitada, el trabajo no se asigna — queda en cola hasta que la herramienta esté disponible.

### C6 — Paridad formato datos / formato persistencia

**Principio aplicado a Hokage OS:**
Los schemas de los work items, los prompts de agente, las definiciones de departamento, y el estado del runtime deberían compartir el mismo modelo de datos. No hay un "objeto de runtime" diferente del "objeto de BD". Lo que persiste en SQLite es directamente lo que el runtime opera.

### C7 — Overlay de datos para el World Engine

**Principio aplicado a Hokage OS:**
El mapa de Hokage OS debería tener overlays activables:
- Overlay de actividad: qué agente está haciendo qué ahora mismo
- Overlay de presupuesto: cuánto token budget queda por agente
- Overlay de pipeline: cuántos work items pendientes tiene cada sala
- Overlay de salud: estado general de cada sala (verde/amarillo/rojo)

Visualización directa del modelo de datos, sin lógica adicional.

### C8 — Supresión como métrica cuantificada de restricción

**Principio aplicado a Hokage OS:**
El concepto de "supresión" se puede adaptar como **autonomía**: cuánta libertad tiene un agente para actuar sin requerir aprobación. Alta autonomía = actúa solo. Baja autonomía = requiere confirmación de Jorge. La autonomía puede crecer con el historial de decisiones correctas y reducirse con errores o decisiones rechazadas.

---

## 11. Qué NO copiaría

### La complejidad de 18 necesidades

Prison Architect modela vejiga, intestinos, ropa, drogas, alcohol... porque simula seres humanos con necesidades fisiológicas. Los agentes de Hokage OS no tienen biología. Copiar este sistema es sobre-ingeniería. Las métricas relevantes para Hokage OS son 3–4, no 18.

### La clasificación de habitación por declaración explícita del jugador

En Prison Architect el jugador designa tipos de habitación porque el jugador construye la prisión físicamente. En Hokage OS los departamentos son fijos. No tiene sentido un sistema de designación manual cuando los 6 departamentos son inmutables.

### El modelo de despliegue de guardias

El Deployment screen asigna guardias a sectores con prioridades numéricas. Es una interfaz de gestión de recursos humanos físicos. Los agentes de Hokage OS no patrullan espacios físicos.

### El pathfinding por tiles

Prison Architect navega entidades por un mapa 2D físico. Los agentes de Hokage OS navegan entre tareas abstractas, no entre tiles. El pathfinding no aplica directamente — aunque sus principios de threading y sector-como-pre-filtro sí aplican al diseño del scheduler.

### La economía de contratos de limpieza y bandwidth de servidores

La economía simulada de Prison Architect (pagos por limpieza, licencias, servidor) es específica del dominio del juego. Hokage OS tiene una economía real basada en APIs externas.

---

## 12. Riesgos

### R1 — El modelo productor-consumidor de cola global puede crear starvation

Si la cola de trabajos se llena con muchos trabajos de baja prioridad, los trabajos de alta prioridad pueden encontrar la cola congestionada. Prison Architect tiene este problema documentado — los trabajos más antiguos pueden quedar sin asignar indefinidamente en situaciones de alta carga. En Hokage OS, una campaña de contenido masiva podría bloquear la ejecución de una decisión urgente de Jorge.

**Mitigación:** colas separadas por nivel de prioridad, no una única cola ordenada.

### R2 — El locking In-Progress debe tener expiración

Si un agente toma un work item In-Progress y falla (timeout de OpenRouter, crash del proceso), el trabajo queda bloqueado indefinidamente. En Prison Architect esto causa el bug de "obreros que no vuelven a recoger materiales". En Hokage OS, causaría decisiones aprobadas que nunca se ejecutan.

**Mitigación:** los locks deben tener TTL (Time To Live). Si un work item In-Progress no avanza en X minutos, vuelve a la cola.

### R3 — Pathfinding en thread separado requiere gestión cuidadosa de estado compartido

El threading de A* de Prison Architect fue implementado por un especialista (PhD en AI). La sincronización entre el thread de pathfinding y el main thread es el punto de fallo más delicado. Para el scheduler de agentes de Hokage OS, la parallelización de ejecución de agentes (Promise.allSettled) tiene riesgos análogos con el estado compartido de la BD.

### R4 — La greedy nearest-valid selection produce comportamiento subóptimo a escala

En Prison Architect, presos bloquean en recursos cercanos aunque haya mejores opciones más lejos. En Hokage OS, un agente que siempre toma el trabajo más cercano (más urgente) puede ignorar sistemáticamente trabajo valioso de menor urgencia. El scheduler necesita un mecanismo de aging: los trabajos que llevan tiempo en cola aumentan su prioridad efectiva.

### R5 — Sin mecanismo de vuelta a tarea abandonada

Prison Architect no garantiza que una tarea abandonada por interrupción se retome. Materiales dejados a medias, construcciones detenidas. En Hokage OS, si un agente abandona un work item a mitad de pipeline para atender algo urgente, el pipeline puede quedar en estado inconsistente.

---

## 13. Comparación: Prison Architect vs RimWorld vs Software Inc.

### Navegación

| Sistema | Approach | Ventajas | Límites |
|---------|----------|----------|---------|
| **RimWorld** | A* dos niveles (región + celda) + pathfinding multithreaded (1.6) | Más sofisticado. Heurística real basada en costes de región. Paralelo. | Más complejo de implementar |
| **Prison Architect** | A* plano + sector como pre-filtro + thread dedicado | Implementación más simple. Thread dedicado hace su trabajo. | Sin jerarquía real. Crece super-linealmente con el mapa |
| **Software Inc.** | A* dos niveles (meta-grafo de habitaciones + grid por habitación) | Elegante para navegación por habitaciones discretas | Single-threaded. Límite bajo |

**Ganador para Hokage OS:** RimWorld (para navegación física en el World Engine). Prison Architect (para el concepto de pre-filtro aplicado al scheduler).

---

### Simulación

| Sistema | Approach | Ventajas | Límites |
|---------|----------|----------|---------|
| **RimWorld** | Tick discreto explícito, 3 listas (normal/rare/long), escalonado por hash | Más controlado. Predecible. Permite distribución de carga | Más infraestructura |
| **Prison Architect** | Tiempo real continuo, threading explícito | Simple de entender. Threading bien aislado | Sin control fino sobre frecuencias |
| **Software Inc.** | Tiempo real con multiplicador escalar | Concepto más simple | Single-threaded, límite bajo |

**Ganador para Hokage OS:** RimWorld (tick escalonado con budget). Prison Architect aporta el concepto de threading aislado.

---

### IA

| Sistema | Approach | Ventajas | Límites |
|---------|----------|----------|---------|
| **Prison Architect** | Dual (necesidades + trabajos), greedy nearest-valid, 18 necesidades con prioridades | Sistema de necesidades más detallado y documentado | Greedy produce suboptimalidad conocida |
| **RimWorld** | Behavior tree con árbol constante de interrupción, mood system | Más sofisticado y extensible | Más complejo |
| **Software Inc.** | Behavior tree visual, 3 necesidades | Más simple | Menos detallado |

**Ganador para Hokage OS:** Prison Architect para el modelo de prioridades y dos umbrales. RimWorld para la arquitectura de interrupción de alta prioridad.

---

### Scheduler

| Sistema | Approach | Ventajas | Límites |
|---------|----------|----------|---------|
| **RimWorld** | WorkGiver → JobGiver → JobDriver, 3 capas, ReservationManager | Más limpio y extensible. Separación explícita de discovery/planning/execution | Más infraestructura |
| **Prison Architect** | Cola global, objeto-genera-job, locking In-Progress | Objeto como generador es muy elegante. Desacoplamiento natural | LIFO dentro de prioridad causa starvation |
| **Software Inc.** | Work items asignados a salas, equipo divide tiempo equitativamente | Claro para organización departamental | Degrada throughput por item |

**Ganador para Hokage OS:** combinar Prison Architect (objeto-genera-job, locking In-Progress) con RimWorld (pipeline WorkScanner → TaskBuilder → TaskDriver) y Software Inc. (sala como unidad de trabajo).

---

### World Engine

| Sistema | Approach | Ventajas | Límites |
|---------|----------|----------|---------|
| **RimWorld** | ~20 flat arrays por propiedad de tile, O(1) por cualquier consulta espacial | El más eficiente en memoria y velocidad de lookup | Más consumo de memoria por estructura |
| **Prison Architect** | Grid sparse (solo tiles no-default), objetos separados de tiles, rooms explícitas | Modelo de datos de habitación más completo. Serialización elegante | Sin jerarquía de pathfinding |
| **Software Inc.** | Edge-based walls, NavBoundary/BuildBoundary separadas, habitaciones como contenedores | Mejor modelo de mobiliario | Single-threaded |

**Ganador para Hokage OS:** RimWorld para el World Engine (flat arrays O(1)). Prison Architect para el modelo de datos de habitación y la serialización. Software Inc. para el diseño de mobiliario.

---

### Rendimiento

| Sistema | Técnicas | Límite práctico |
|---------|----------|----------------|
| **RimWorld** | Pathfinding multithreaded, lighting multithreaded, LOD off-camera, tick escalonado, staggering por hash | El más optimizado |
| **Prison Architect** | Pathfinding thread dedicado, lighting 20Hz, eliminación de copias de memoria | ~500 entidades |
| **Software Inc.** | Mesh batching por planta. Sin más optimizaciones documentadas | ~100 empleados |

**Ganador claro: RimWorld.** Prison Architect es segundo. Software Inc. es el peor en rendimiento de los tres.

---

## 14. Conclusión

Prison Architect aporta a Hokage OS tres ideas arquitectónicas que ningún otro simulador estudiado define con tanta claridad:

**El objeto como generador de su propio trabajo** es el patrón más valioso. En lugar de un scheduler central que monitorea el estado del sistema, los objetos anuncian sus propias necesidades cuando su estado cambia. Aplicado a Hokage OS: los eventos de negocio (venta detectada, tendencia encontrada, producto creado) generan work items directamente en la cola del scheduler, sin que ningún componente central tenga que supervisar todo.

**El modelo de dos umbrales** es la forma más elegante de producir comportamiento reactivo graduado sin lógica condicional por caso. Una métrica con umbral de acción y umbral de fallo produce comportamiento de "procrastinación razonable" que se parece al comportamiento inteligente sin ser inteligencia real.

**El locking In-Progress** es la solución más simple al thundering herd problem. Un trabajo reclamado no puede ser tomado por otra entidad. Aplicado al scheduler de Hokage OS, resuelve la doble ejecución de tareas sin necesidad de transacciones complejas.

Lo que no aporta: el sistema de pathfinding en tiles (no aplica a agentes abstractos), la complejidad de 18 necesidades (sobre-ingeniería para 7 agentes de negocio), y la economía de contratos y licencias (Hokage OS opera en mercados reales).

La síntesis ideal para Hokage OS combina el objeto-genera-trabajo de Prison Architect, el pipeline WorkScanner/TaskBuilder/TaskDriver de RimWorld, y la sala como unidad de trabajo de Software Inc. Son tres aproximaciones al mismo problema desde ángulos distintos, y juntas cubren todos los aspectos del scheduler de agentes que Hokage OS necesita.

---

# Recomendaciones para Hokage OS

## Imprescindible

### R1 — Evento de negocio genera work item directamente
**Patrón:** objeto-como-generador-de-trabajo (Prison Architect)  
**Aplicación:** cuando el Event Bus recibe un evento de negocio (venta, tendencia, alerta), genera automáticamente un work item en la cola del scheduler para el agente responsable.  
**Impacto técnico:** alto — elimina el polling y hace el sistema reactivo  
**Dificultad:** media — requiere mapear tipos de evento a tipos de work item  
**Prioridad Hokage OS:** Fase actual (antes de conectar tool pipeline)

---

### R2 — Locking In-Progress con TTL en work items
**Patrón:** in-progress job lock (Prison Architect)  
**Aplicación:** cuando un agente toma un work item, lo marca In-Progress. Si no avanza en X minutos (timeout configurable), vuelve a la cola automáticamente.  
**Impacto técnico:** alto — previene doble ejecución y bloqueos por agentes que fallan  
**Dificultad:** baja — un campo `locked_at` en la tabla + job que verifica TTL  
**Prioridad Hokage OS:** Fase actual (junto con scheduler fix)

---

### R3 — Prioridades explícitas en la cola de work items
**Patrón:** priority queue con niveles (Prison Architect + RimWorld)  
**Aplicación:** P9 = decisión aprobada por Jorge, P8 = evento urgente, P7 = pipeline activo, P6 = autónoma programada, P5 = análisis de fondo  
**Impacto técnico:** alto — evita que trabajo de fondo bloquee trabajo urgente  
**Dificultad:** baja — campo `priority` en la tabla + ORDER BY en el scanner  
**Prioridad Hokage OS:** Fase actual

---

## Muy recomendable

### R4 — Dos umbrales para métricas de salud de agente
**Patrón:** TimeToAction / TimeToFailure (Prison Architect)  
**Aplicación:** presupuesto de tokens bajo → el agente reduce frecuencia (acción). Presupuesto agotado → Jorge recibe alerta (fallo).  
**Impacto técnico:** medio — modifica el scheduler para verificar métricas antes de ejecutar  
**Dificultad:** media — requiere el sistema de presupuestos (tarea pendiente en roadmap)  
**Prioridad Hokage OS:** junto con implementación de presupuestos

---

### R5 — Verificación de alcanzabilidad antes de asignación
**Patrón:** reachability check antes de job assignment (Prison Architect)  
**Aplicación:** antes de asignar un work item a un agente, verificar que el agente tiene las tools necesarias habilitadas. Si no las tiene, el work item permanece en cola.  
**Impacto técnico:** medio — evita ejecuciones que fallarán por falta de herramientas  
**Dificultad:** baja — consulta de tools disponibles antes del dispatch  
**Prioridad Hokage OS:** junto con tool pipeline

---

### R6 — Aging de work items en cola
**Patrón:** mitigación de starvation (ausente en Prison Architect, recomendado como corrección de su error)  
**Aplicación:** work items que llevan más de X minutos en cola aumentan su prioridad efectiva. Evita que trabajos válidos queden bloqueados indefinidamente.  
**Impacto técnico:** medio  
**Dificultad:** baja — `enqueued_at` + fórmula de prioridad efectiva en el scanner  
**Prioridad Hokage OS:** Fase 6 (cuando la cola tenga volumen real)

---

### R7 — Overlays de datos en el World Engine
**Patrón:** data overlays activables (Prison Architect)  
**Aplicación:** modos de visualización del mapa: actividad, presupuesto, pipeline, salud. Visualización directa del modelo de datos sin lógica adicional.  
**Impacto técnico:** bajo en backend, medio en frontend  
**Dificultad:** media — requiere exponer las métricas por sala en la API  
**Prioridad Hokage OS:** Fase World Engine

---

## Opcional

### R8 — Autonomía como métrica cuantificada
**Patrón:** suppression como escala cuantificada (Prison Architect)  
**Aplicación:** cada agente tiene un score de autonomía (0–100) que aumenta con decisiones correctas históricas y disminuye con errores. Mayor autonomía → menos aprobaciones requeridas de Jorge.  
**Impacto técnico:** bajo — campo en la tabla de agentes  
**Dificultad:** alta — requiere tracking de historial de calidad de decisiones  
**Prioridad Hokage OS:** Fase 8+ (cuando haya historial suficiente)

---

### R9 — Paridad formato datos / BD
**Patrón:** isomorphic data format (Prison Architect)  
**Aplicación:** los schemas de TypeScript que describen work items, eventos y estados de agente deberían ser isomorfos a las tablas de SQLite. Sin objetos de "runtime" diferentes de los de "persistencia".  
**Impacto técnico:** bajo — refactor de tipos, no de lógica  
**Dificultad:** baja  
**Prioridad Hokage OS:** deuda técnica menor

---

## Referencias

- [Introversion Forums — Alpha 14 changelog](https://forums.introversion.co.uk/viewtopic.php?t=44984) — threading del pathfinding, crédito a Johnny Knottenbelt
- [Introversion Forums — Agent AI Architecture](https://forums.introversion.co.uk/viewtopic.php?t=45058) — dual system needs/jobs, thresholds, object-as-job-generator
- [Prison-Architect-API GitHub — needs.txt](https://github.com/originalfoo/Prison-Architect-API/blob/master/main/data/needs.txt) — 18 necesidades, prioridades, valores de decay
- [Paradox Wiki — Savegames](https://prisonarchitect.paradoxwikis.com/Savegames) — campos de tile, objetos, habitaciones
- [Paradox Wiki — Modding](https://prisonarchitect.paradoxwikis.com/Modding) — materials.txt, definición de entidades y habitaciones
- [Paradox Wiki — Sector](https://prisonarchitect.paradoxwikis.com/Sector) — tipos de sector, control de acceso, integración con pathfinding
- [Paradox Wiki — Suppression](https://prisonarchitect.paradoxwikis.com/Suppression) — escala de puntos, tasas, fuentes, decay
- [Paradox Wiki — Danger](https://prisonarchitect.paradoxwikis.com/Danger) — contribuidores y mitigadores del peligro
- [Introversion Forums — Performance](https://forums.introversion.co.uk/viewtopic.php?t=50378) — límites de escalabilidad, confirmación de A*
- [Introversion Forums — Job priority](https://forums.introversion.co.uk/viewtopic.php?t=52957) — comportamiento LIFO de la cola
- [Steam Community — Materials.txt Entities](https://steamcommunity.com/sharedfiles/filedetails/?id=496467579) — flags de entidades
- [Steam Community — Materials.txt Rooms](https://steamcommunity.com/sharedfiles/filedetails/?id=527415430) — campos de definición de habitaciones
