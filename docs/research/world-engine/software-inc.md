# Software Inc. — Arquitectura de simulación empresarial
> Categoría: world-engine  
> Analizado: 2026-08-02  
> Relevancia para Hokage OS: **muy alta**  
> Fuente principal: developer blog oficial (coredumping.com), wiki de modding, Steam community, análisis de la API pública de SIPL

---

## Objetivo del análisis

Software Inc. (Coredumping, 2015–actualidad) es el referente más directo para Hokage OS: simula una empresa de software con empleados autónomos, departamentos, oficinas, productos y economía. El objetivo de este análisis es extraer sus decisiones arquitectónicas y determinar cuáles merece la pena adoptar, adaptar o descartar.

---

## 1. Visión general

### Qué es

Software Inc. es un simulador de gestión empresarial en tiempo real. El jugador funda una empresa de software, diseña sus oficinas, contrata empleados, los organiza en equipos y gestiona el ciclo completo de desarrollo: diseño → alpha → beta → lanzamiento → soporte.

### Qué intenta simular

Tres sistemas interdependientes:

- **Espacio físico:** oficinas, habitaciones, plantas, mobiliario. Los empleados se mueven físicamente por el edificio.
- **Empresa:** equipos, roles, proyectos, flujo de trabajo, economía.
- **Mercado:** empresas competidoras, cuota de mercado, ciclo de vida de productos.

### Pilares de diseño

1. **Agentes físicamente presentes.** Los empleados no son entradas en una tabla. Ocupan espacio, tienen una posición, se desplazan, buscan recursos (café, comida, sillas de reunión).
2. **La habitación como unidad de trabajo.** El trabajo no se asigna a empleados individuales — se asigna a equipos, y los equipos tienen una habitación. La habitación es el contexto de trabajo.
3. **Necesidades como interruptores de comportamiento.** Hambre, energía y satisfacción no son métricas cosméticas. Cuando cruzan umbrales, interrumpen el trabajo y disparan comportamientos de búsqueda (comida, descanso, demanda de aumento).
4. **Pipeline de proyecto como máquina de estados.** Un proyecto no es un porcentaje de progreso. Es una secuencia de fases discretas, cada una con sus propios responsables y condiciones de avance.

---

## 2. Arquitectura del mundo

### Sistema de grid — muros en aristas, no en celdas

El mapa usa un grid donde los muros se ubican en los **bordes de las celdas**, no en celdas completas. Este modelo (estilo The Sims) maximiza el área interior utilizable. El desarrollador migró explícitamente desde el modelo de Prison Architect (muros que ocupan celdas completas) porque perdía demasiado espacio.

Cuando se modifica un muro, el sistema reconstruye todas las habitaciones de esa planta completa. El desarrollador lo describe como "un algoritmo retorcido que reconstruye todas las habitaciones cuando cambias algo." Es costoso pero infrecuente — los muros no cambian en tiempo de juego, solo en modo construcción.

### Plantas y edificios

Los edificios soportan hasta diez plantas. Cada planta es una capa independiente con su propio grid de habitaciones. Las plantas se conectan por ascensores, que son nodos en el meta-grafo de pathfinding.

Existe una **habitación sentinel invisible en la planta baja** que actúa como nodo de conexión al exterior. Todos los grafos de habitaciones de planta baja conectan a través de ella. Es la solución técnica para el problema de "cómo salen y entran los empleados al edificio".

### Modelo de datos de una habitación

El manager singleton `GameSettings.sRoomManager` posee todas las habitaciones y el estado del mobiliario. Cada habitación expone:

- Referencia al equipo asignado (o nulo si es compartida)
- Inventario de mobiliario
- Métricas de entorno: temperatura, iluminación, calidad del aire, ruido
- Color exterior (configurable en runtime)

Las habitaciones no tienen posición explícita de empleados — los empleados son entidades con posición propia que se encuentran en la habitación según su ubicación en el grid.

### Mobiliario

Cada pieza de mobiliario declara dos polígonos separados:

- **BuildBoundary:** colisión durante la colocación (qué espacio ocupa físicamente)
- **NavBoundary:** obstáculo para la navegación (qué espacio bloquea el paso)

Ambos pueden diferir en forma. Un escritorio puede ocupar una celda de colisión pero bloquear un área mayor para caminar. Esta separación permite que el sistema de pathfinding sea preciso sin acoplarse al modelo físico de los objetos.

Otros campos relevantes del mobiliario:
- `CanAssign` — si un empleado puede ser asignado a esta pieza (mesa de trabajo, silla de reunión)
- `InFloor` — el objeto está embebido en el suelo
- `GridSizeOverride` — modifica la resolución local del grid
- `Height1 / Height2` — límites verticales (para objetos de pared)

---

## 3. Simulación

### Ciclo de simulación

El tiempo está gestionado por el singleton `TimeOfDay.Instance`. El ciclo de simulación es **de hilo único** — toda la lógica de empleados, economía y IA corre en el thread principal de Unity. Esta es la limitación de escalabilidad más importante del sistema.

### Tick del mundo

El juego no expone un tick rate fijo en su API de modding. Las cadencias documentadas son:
- `OnHourPassed` — evento más granular disponible para mods
- `OnMonthPassed` — para economía y estadísticas
- `OnProductReleased`, `OnCompanyFounded` — eventos de negocio de grano grueso

### Aceleración del tiempo

La configuración "días por mes" (1–7) es un **multiplicador escalar sobre las tasas de progreso**, no una restructuración del ciclo. Si el mes tiene 8 días, cada unidad de trabajo cuesta 8 veces más tiempo real — la cantidad total de trabajo por mes no cambia. El jugador tiene más tiempo real para reaccionar, no más trabajo real completado.

La pausa y la aceleración se implementan como equivalentes a `Time.timeScale` de Unity.

### Rendimiento

El CEO del sistema de rendimiento es el **hilo principal de la CPU**. El desarrollador lo confirmó explícitamente:

> "Employee simulation is currently the biggest bottleneck and it is completely CPU bound."

Perfiles de CPU mostraron 65–75% de carga en un núcleo mientras los demás permanecían al 5–20%. El motivo de la falta de multithreading: la complejidad del locking de memoria compartida y que las APIs de Unity no son accesibles desde hilos no principales.

Límites prácticos observados en la comunidad:
- Por encima de 100 empleados: degradación perceptible
- 350–500 empleados: rendimiento severo, < 20 FPS
- 500+: potencialmente < 1 FPS

---

## 4. IA de los personajes

### Arquitectura — árboles de comportamiento

La IA de empleados usa **behavior trees**. El desarrollador construyó un editor visual para diseñarlos: se dibujan estados y conexiones en la pantalla, y el editor genera automáticamente código C# como `partial class .impl.cs`. El árbol más temprano documentado era "Work = mirar pantalla hasta GoHome". Versiones posteriores añadieron nodos como `WantCoffee`, confirmando la adición incremental de ramas de necesidad.

### Sistema de necesidades

Tres variables de estado con umbrales de interrupción:

| Necesidad | Comportamiento al cruzar umbral |
|-----------|--------------------------------|
| Hambre | Empleado busca fuente de comida (cantina, cocina) |
| Energía | Empleado descansa |
| Satisfacción | Empleado puede generar demanda de aumento |

Las necesidades son interruptores que **compiten con el trabajo** en el árbol de comportamiento. No son métricas de fondo — activamente interrumpen la tarea en curso cuando cruzan su umbral.

### Asignación de tareas

Las tareas están **bloqueadas por rol**:
- Diseñadores: documentos de diseño
- Programadores: builds alpha, corrección de bugs
- Artistas: assets alpha
- Marketers: campañas de marketing

Los leads con alta especialización en Automatización gestionan el pipeline completo de su equipo de forma autónoma. Cuando no hay lead activo, el jugador asigna manualmente los work items a habitaciones/equipos.

### Compatibilidad de equipo

Cada empleado tiene exactamente **dos rasgos de personalidad** (bueno, malo, o neutro). El sistema evalúa pares de rasgos incompatibles entre miembros del equipo. La compatibilidad resultante modifica la efectividad y satisfacción del equipo. Un equipo con baja compatibilidad produce menos aunque sus skills sean altas.

### Reuniones

Las reuniones requieren mobiliario físico (mesas + sillas). El sistema:
1. Localiza mesas en la sala de reuniones
2. Ejecuta un algoritmo de agrupación de mesas contiguas
3. Asigna sillas al grupo más grande disponible
4. El líder programa la reunión en esa ubicación
5. La reunión completada aumenta la satisfacción del equipo

Este patrón — un evento de negocio que requiere la presencia física de mobiliario específico — es arquitectónicamente interesante: el mundo físico tiene consecuencias en el mundo de negocio.

---

## 5. Empresas

### Representación de una empresa

`GameSettings.MyCompany` es el objeto de la empresa del jugador. `MarketSimulation.Active` gestiona todas las empresas (jugador + competidores IA).

### Equipos — abstracción sobre habitaciones

Los equipos son entidades lógicas asignadas a habitaciones, no definidas por ellas. Un equipo existe aunque su habitación cambie. La habitación asignada a un equipo activa el control de acceso en el pathfinding — otros empleados no pueden atravesarla.

Si un equipo tiene múltiples work items activos, el tiempo de todos los empleados se divide equitativamente entre ellos. Esto degrada el throughput por item de forma lineal: dos items = cada item avanza a la mitad de velocidad.

### Pipeline de proyecto

El proyecto avanza por fases discretas como una **máquina de estados**:

```
Design Document
  → (calidad óptima alcanzada)
  → Alpha (Programadores + Artistas)
  → Delay (opcional — saltarlo añade bugs)
  → Beta (corrección de bugs)
  → Release
  → Support (hasta bugs = 0)
```

Cada fase es un work item independiente con su propio estado de progreso. No hay un porcentaje global de proyecto — hay una fase activa con su propio equipo responsable.

### Economía

Fuentes de ingresos:
- Ventas de productos: `score = (calidad / precio) * complejidad * reconocimiento de marca * awareness`
- Trabajo contractual
- Dividendos de acciones
- Patentes

La fórmula de calidad incorpora: tier de herramientas (compiladores, motores), skills del equipo, balance de atributos del Design Document (Innovación, Estabilidad, Usabilidad), y adherencia al tiempo óptimo de desarrollo.

### Empresas IA

Las empresas competidoras se configuran con parámetros de simulación:
- Probabilidad de fundarse por año
- Rango de empleados
- Multiplicador de carga de trabajo (un valor de 0.25 significa 4 productos simultáneos)

---

## 6. Escalabilidad

El cuello de botella es el CPU single-threaded. Software Inc. no implementa ninguna de las técnicas estándar de escalabilidad de simulación:

- Sin tick escalonado (todos los empleados actualizan cada frame)
- Sin LOD para personajes (no hay reducción de detalle por distancia)
- Sin paralelización de IA
- Sin pooling de paths documentado

La única optimización de rendering documentada es el **merge de geometría por planta**: todos los muros, ventanas y puertas de una planta se fusionan en un único mesh al construir. Esto reduce las draw calls del edificio, pero no afecta el coste de simulación.

La consecuencia práctica es que el juego tiene un límite orgánico de ~100–350 empleados antes de degradarse significativamente. El desarrollador reconoció el problema pero no lo solucionó por la complejidad de añadir multithreading a un sistema Unity ya maduro.

---

## 7. Interfaz

### Sistema de ventanas

El gestor de UI es `HUD.Instance`. El juego tiene 22 ventanas independientes, rediseñadas completamente cuando se migró de Unity OnGUI al sistema Canvas. Las ventanas son redimensionables y modulares.

### Panel de habitación — el patrón más relevante

El panel de habitación muestra:
- Equipo asignado y work items activos (lista colapsable y fijable)
- Métricas de entorno (iluminación, temperatura, ruido, calidad del aire) como overlay activable
- Inventario de mobiliario en contexto

Los work items pueden arrastrarse directamente desde el panel de habitación a otra habitación para reasignarlos. El panel es **contextual**: muestra la información relevante al objeto seleccionado en ese momento.

### Panel de empresa

- RRHH: gestión de equipos, headcount, salarios
- Finanzas: cashflow por producto, valoración, posición accionarial
- Lista de productos: estado del pipeline por producto

### Sistema de notificaciones

El sistema reemplazó mensajes de texto en pantalla por una **cola de mensajes estilo Dungeon Keeper** que reduce la carga visual. Los eventos de empleados (demanda de aumento, queja) aparecen como alertas en esta cola, no como pop-ups bloqueantes.

### Overlay de datos

Un modo de visualización opcional pinta cada habitación con un color representando su métrica de entorno actual (temperatura, iluminación). Es una capa de renderizado separada activada en runtime, no una escena distinta.

### Selección y highlights

La selección usa un shader de stencil buffer en tres pasos:
1. Renderizar el mesh completo en el stencil buffer (sin output visual)
2. Eliminar el interior del mesh del stencil
3. Renderizar el residuo del stencil sin depth testing (aparece encima de todo)

Los objetos heredan de una clase base `Selectable`. Un `SelectorController` singleton gestiona los selectables activos.

---

## 8. Flujo interno del sistema

```
TimeOfDay.Instance.Tick()
  ├── Para cada actor en sActorManager.Actors:
  │   └── BehaviorTree.Evaluate()
  │       ├── ¿Hambre > umbral? → GoToFood()
  │       ├── ¿Energía < umbral? → GoToRest()
  │       ├── ¿Satisfacción < umbral? → TriggerRaiseDemand()
  │       └── ¿Tiene work item asignado? → ExecuteWorkTick()
  │           └── WorkItem.Progress += skill * toolTier * teamCompatibility
  │
  ├── Para cada WorkItem activo:
  │   ├── Avanzar progreso según empleados asignados
  │   └── ¿Progreso >= threshold? → AdvancePhase()
  │
  └── OnHourPassed → [market updates, salary costs, server costs]
      OnMonthPassed → [revenue, product score recalculation]
```

El pathfinding no está en este ciclo principal — se dispara bajo demanda cuando un actor necesita navegar a un destino nuevo.

---

## Patrones reutilizables

### P1 — La habitación como unidad de trabajo, no el empleado

**Principio:** el trabajo no se asigna a individuos. Se asigna a un equipo, y el equipo tiene una habitación. La habitación es el contenedor de trabajo. Los empleados en esa habitación consumen el trabajo disponible según sus capacidades.

**Por qué importa:** desacopla la asignación de trabajo de la disponibilidad individual. Si un empleado falta, el trabajo no se bloquea — otros miembros del equipo lo absorben. La abstracción es el equipo-habitación, no el individuo.

---

### P2 — Dos polígonos por objeto: colisión y navegación separadas

**Principio:** cada entidad física declara independientemente su área de colisión (para colocación) y su área de obstáculo (para navegación). Ambos pueden diferir en forma.

**Por qué importa:** permite que el sistema de pathfinding sea preciso sin estar acoplado al modelo físico de los objetos. Un escritorio puede ocupar una celda pero bloquear tres para caminar.

---

### P3 — Habitación sentinel como nodo de conexión

**Principio:** una habitación especial invisible actúa como nodo universal de entrada/salida en el grafo de pathfinding. Todas las habitaciones de planta baja conectan a través de ella al exterior.

**Por qué importa:** elegante solución al problema de conectividad en grafos de habitaciones. Evita que cada habitación necesite conocer la topología del edificio completo.

---

### P4 — El pipeline de proyecto como máquina de estados discreta

**Principio:** un proyecto no tiene un porcentaje global. Tiene fases discretas, cada una con su propio equipo responsable, sus propias condiciones de avance, y su propio estado de progreso.

**Por qué importa:** hace explícitos los bloqueos entre fases. No puedes pasar de Alpha a Beta hasta que los criterios de Alpha estén cumplidos. El trabajo invisible (deuda técnica, bugs) emerge como consecuencia de saltarse fases.

---

### P5 — Necesidades como interruptores de comportamiento de alta prioridad

**Principio:** las necesidades no son métricas de fondo. Son condiciones de interrupción que compiten directamente con el trabajo en el árbol de comportamiento. Cuando cruzan su umbral, ganan prioridad sobre cualquier otra tarea.

**Por qué importa:** produce comportamiento emergente realista sin lógica especial por caso. No hay código para "si el empleado tiene hambre y está trabajando, parar". El árbol de comportamiento lo gestiona solo.

---

### P6 — Panel contextual por habitación

**Principio:** la unidad de información es la habitación, no la empresa ni el empleado. El panel de habitación muestra: equipo asignado, work items activos, métricas de entorno. El usuario navega haciendo clic en habitaciones, no en menús globales.

**Por qué importa:** el flujo de atención del usuario es espacial. Va al lugar donde ocurre el problema, no a un panel abstracto.

---

### P7 — Tiempo como multiplicador escalar, no como cadencia diferente

**Principio:** la aceleración del tiempo no cambia el ciclo de simulación. Cambia el multiplicador de las tasas de progreso. La misma cantidad de trabajo ocurre por mes real — solo cambia cuánto tiempo real tiene el usuario para reaccionar.

**Por qué importa:** simplifica enormemente la implementación. No hay lógica condicional por velocidad de simulación. Todo el código de avance de estado trabaja en "unidades de trabajo por tick", y el multiplicador es exterior a él.

---

### P8 — Mesh batching por planta para geometría estática

**Principio:** cuando la geometría de una planta cambia (construir muro, añadir ventana), todos los elementos de esa planta se fusionan en un único mesh que se envía como una sola draw call.

**Por qué importa:** convierte O(N) draw calls en O(1) para la geometría de edificio. Decisión de rendering con alto impacto en escenas complejas.

---

### P9 — Compatibilidad de equipo como modificador de efectividad

**Principio:** la productividad de un equipo no es la suma de las skills individuales. Está modulada por la compatibilidad entre personalidades. Un equipo de alta skill y baja compatibilidad puede producir menos que uno de skill media y alta compatibilidad.

**Por qué importa:** produce dinámicas emergentes de gestión. La composición del equipo importa, no solo la suma de skills.

---

### P10 — Cola de notificaciones no bloqueante

**Principio:** los eventos importantes (demanda de aumento, alerta de bug, proyecto completado) van a una cola de mensajes que el usuario puede revisar a su ritmo. No son pop-ups bloqueantes que interrumpen el flujo.

**Por qué importa:** en un sistema con muchos eventos simultáneos, los pop-ups bloqueantes son insoportables. La cola respeta el flujo del usuario.

---

## Qué NO copiaría

### La simulación de empleados single-threaded

El mayor error arquitectónico de Software Inc. es no haber planificado la paralelización desde el inicio. El resultado es un límite orgánico de ~100 empleados antes de degradar. Hokage OS tiene la oportunidad de hacer lo correcto desde el principio: separar la simulación en subsistemas independientes que puedan ejecutarse en paralelo.

### La complejidad del sistema de calidad de productos

La fórmula de calidad de Software Inc. — que incorpora tier de herramientas, skills, atributos de diseño, tiempo óptimo de desarrollo y reconocimiento de marca — es específica del dominio del juego. Hokage OS no produce software; gestiona negocios digitales con agentes IA. La economía relevante es distinta.

### El editor visual de behavior trees

El desarrollador construyó un editor gráfico para diseñar árboles de comportamiento y generar código. Esto tiene sentido cuando los comportamientos cambian frecuentemente durante el desarrollo de un juego. En Hokage OS los agentes tienen comportamientos estables definidos en código TypeScript. Un editor visual sería sobre-ingeniería.

### El sistema de rasgos de personalidad de empleados

Exactamente dos rasgos por empleado con pares de incompatibilidad. Esto modela psicología humana simplificada para un contexto de juego. Los agentes de Hokage OS no tienen psicología — tienen roles y capacidades. El concepto de "compatibilidad de equipo" puede traducirse, pero no la mecánica de rasgos.

### Las diez plantas de edificio

Software Inc. necesita múltiples plantas porque los jugadores construyen físicamente su empresa. Hokage OS tiene un número fijo de departamentos. La arquitectura vertical no añade valor.

### El sistema de acciones de mercado completo

La simulación de competidores IA con parámetros de founding rate, product pace y market share requiere datos de mercado real. Software Inc. simula un mercado ficticio. Hokage OS opera en mercados reales (Etsy, Shopify). La economía de Hokage OS viene de APIs externas, no de un simulador interno.

---

## Cómo adaptaría estas ideas a Hokage OS

### Sala como unidad de trabajo (P1)

La sala (Laboratorio, Estudio, Banco, Torre Hokage) es el equivalente directo de la habitación de Software Inc. El trabajo no se asigna al agente — se asigna a la sala. El agente en esa sala lo ejecuta. Si hay múltiples tareas en una sala, el agente las gestiona secuencialmente según prioridad.

Esto ya está parcialmente implementado (departments en BD), pero falta cerrar el loop: que la sala tenga work items asignados y el agente los consuma.

### Panel contextual de sala (P6)

ARCHITECTURE.md ya define esto: cada sala tiene una terminal con Chat | Live Feed | Stats | Pipeline | Alertas. Es exactamente el patrón de Software Inc. pero para agentes IA. Lo que falta es que el Pipeline muestre work items reales con estado de fase, no solo texto.

### Pipeline de proyecto como máquina de estados (P4)

Cuando Hokage OS gestione un producto digital (un listing de Etsy, una campaña de contenido), ese producto debería tener fases discretas:

```
Investigación (Explorador)
  → Creación (Escritor)
  → Revisión (Hokage)
  → [DECISION: publicar] → Jorge aprueba
  → Publicación (Vendedor)
  → Seguimiento (Tráfico)
```

Cada fase es un work item con un agente responsable y criterios de avance. No un porcentaje global.

### Necesidades como métricas de salud del agente (P5)

Los agentes de Hokage OS no tienen hambre, pero tienen métricas análogas:
- **Presupuesto de tokens:** si el agente ha gastado demasiado en el período, entra en modo de bajo consumo
- **Tasa de error:** si OpenRouter falla repetidamente, el agente entra en modo de espera
- **Decisiones pendientes:** si hay decisiones sin respuesta de Jorge, el agente puede estar bloqueado

Estas métricas deberían comportarse como interrupciones de alta prioridad en el scheduler, no como simples campos en una tabla.

### Cola de notificaciones no bloqueante (P10)

El sistema de alertas de Hokage OS ya usa WebSocket. Pero hoy cada alerta importante (decisión pendiente, error de agente, venta registrada) puede apilarse visualmente sin control. La cola de mensajes estilo Software Inc. ordena y agrupa estas alertas, permitiendo al usuario procesarlas a su ritmo.

### Multiplicador escalar de tiempo (P7)

Para el modo de prueba/demo, el scheduler de agentes podría tener un multiplicador de velocidad que reduzca los intervalos (30 min → 3 min) sin cambiar la lógica. Esto facilita el testing sin alterar el código de simulación.

---

## Riesgos de adoptar su arquitectura

### R1 — El single-thread es un antipatrón que se hereda fácilmente

El mayor riesgo de inspirarse en Software Inc. es reproducir su error: diseñar el simulation loop como una función secuencial que itera sobre todos los agentes. En Node.js esto es `for await` — exactamente lo que Hokage OS tiene ahora. La solución es `Promise.allSettled` para agentes independientes, desde el principio.

### R2 — La sala como unidad de trabajo puede crear silos de información

Si cada agente solo ve el trabajo de su sala, los eventos cross-departamento (el Explorador detecta una tendencia que debería activar al Escritor) necesitan un mecanismo explícito de comunicación. En Software Inc. esto se resuelve con reuniones físicas. En Hokage OS se resuelve con el Event Bus. El riesgo es que sin ese mecanismo, las salas sean islas.

### R3 — El pipeline de fases es difícil de gestionar sin un estado global de proyecto

Software Inc. tiene un proyecto como entidad de primera clase con su propio estado. Si Hokage OS quiere implementar pipelines multi-fase (investigación → contenido → publicación), necesita un objeto `Project` o `Campaign` en BD que agrupe los work items y mantenga el estado global del pipeline. Sin esa entidad, el pipeline se implementa como convención en los prompts, no como arquitectura real.

### R4 — La compatibilidad de equipo añade complejidad sin datos reales

Software Inc. puede simular compatibilidad de equipo porque controla todos los parámetros. En Hokage OS, la "compatibilidad" entre agentes emerge de los datos reales: ¿el Explorador está encontrando tendencias que el Escritor puede usar? Medir esto requiere datos de negocio real, no un sistema interno de rasgos.

---

## Conclusión

Software Inc. es el referente más directo para la capa visual y organizativa de Hokage OS. Sus decisiones más valiosas son:

**La sala como unidad de trabajo** — no el agente individual. **El pipeline de proyecto como máquina de estados** — no un porcentaje global. **El panel contextual de sala** — la unidad de información para el usuario. **La cola de notificaciones no bloqueante** — el usuario procesa eventos a su ritmo.

Sus decisiones que no se deben replicar son igualmente claras: **el simulation loop single-threaded** y **la simulación de economía y mercado interna** (Hokage OS opera en mercados reales).

La diferencia fundamental entre los dos sistemas es que Software Inc. simula todos sus datos. Hokage OS consume datos reales de APIs externas. Esa diferencia cambia la naturaleza de todo: el pipeline de proyecto no termina cuando un porcentaje llega a 100% — termina cuando una publicación aparece en Etsy. El éxito no es una puntuación interna — es una venta real. Esto hace que la arquitectura de Hokage OS sea potencialmente más valiosa, pero también más difícil: depende de integraciones reales que fallan, se retrasan y cambian.

---

# Recomendaciones para Hokage OS

## Imprescindible

**1. Adoptar el pipeline multi-fase para proyectos/campañas**
El work item actual es atómico (un prompt, una respuesta). Para que Hokage OS funcione como un sistema autónomo real, los proyectos necesitan fases: investigación → creación → revisión → aprobación → publicación. Cada fase tiene un agente responsable y criterios de avance. Sin esto, los agentes no colaboran — solo trabajan en paralelo sin conexión.

**2. Sala como unidad de trabajo, no agente individual**
El trabajo debería asignarse a salas (departamentos), no directamente a agentes. El agente en la sala lo ejecuta. Este desacoplamiento permite que la lógica de qué hacer (WorkScanner por sala) sea independiente de quién lo hace (el agente asignado a esa sala).

**3. Métricas de salud del agente como interruptores de comportamiento**
Token budget consumido, tasa de error, decisiones bloqueadas — estas deben ser condiciones de interrupción en el scheduler, no métricas pasivas. Si un agente ha superado su presupuesto diario, no debería ejecutarse aunque sea su turno.

## Muy recomendable

**4. Panel contextual de sala como unidad de UI**
El usuario navega haciendo clic en salas, no en menús globales. Cada sala muestra: agente asignado, tarea actual, pipeline de work items, métricas de actividad, alertas propias. Ya definido en ARCHITECTURE.md — falta implementarlo con datos reales.

**5. Cola de notificaciones agrupada y no bloqueante**
Las alertas de decisiones, errores y eventos de negocio van a una cola priorizada. El usuario las procesa cuando quiere. No son pop-ups que interrumpen. Las decisiones pendientes tienen un indicador persistente, no una alerta puntual.

**6. Multiplicador de velocidad de simulación para desarrollo y testing**
Un parámetro de entorno (`SIMULATION_SPEED_MULTIPLIER`) que reduzca todos los intervalos del scheduler proporcionalmente. En desarrollo, 1 minuto simula 30 minutos de operación. No cambia la lógica, solo el timing.

**7. Objeto Project/Campaign como entidad de primera clase en BD**
Para implementar el pipeline multi-fase, se necesita una tabla `campaigns` (o `projects`) que agrupe work items y mantenga el estado global del pipeline. Sin esta entidad, el pipeline vive solo en la cabeza del agente y no es observable ni debuggeable.

## Opcional

**8. Overlay de métricas por sala en el mapa**
Un modo de visualización que pinta cada sala con un color representando una métrica: última actividad, presupuesto consumido, decisiones pendientes. Útil para diagnóstico visual rápido, pero no esencial para el funcionamiento.

**9. Compatibilidad de equipo como métrica emergente**
Medir si los agentes están generando valor en conjunto: ¿el Explorador produce insights que el Escritor usa? ¿Las propuestas del Escritor se aprueban o se rechazan frecuentemente? Esta métrica emerge de datos reales, no de un sistema interno de rasgos. Reportable pero no accionable en Fase 5–6.

**10. Highlight con stencil buffer para selección en el mapa**
El shader de tres pasos de Software Inc. para los highlights de selección es más correcto que un simple contorno o color de fondo. Aplicable cuando el World Engine tenga su diseño visual definitivo.

---

## Referencias

- [Coredumping — Pathfinding devlog](https://softwareinc.coredumping.com/pathfinding/)
- [Coredumping — Office management devlog](https://softwareinc.coredumping.com/seventh-update-office-management/)
- [Coredumping — Behavior trees devlog](https://softwareinc.coredumping.com/behavior-trees/)
- [Coredumping — Visual upgrade devlog](https://softwareinc.coredumping.com/eleventh-update-visual-upgrade/)
- [Coredumping — First steps devlog](https://softwareinc.coredumping.com/second-update-first-steps/)
- [Software Inc. Wiki — Code Modding](https://softwareinc.coredumping.com/wiki/index.php/Code_Modding)
- [Software Inc. Wiki — Data Modding](https://softwareinc.coredumping.com/wiki/index.php/Data_Modding)
- [Software Inc. Wiki — Furniture Modding](https://softwareinc.coredumping.com/wiki/index.php/Furniture_Modding)
- [Steam — Performance discussion](https://steamcommunity.com/app/362620/discussions/0/520518053428175889)
- [Steam Guide — Project Management](https://steamcommunity.com/sharedfiles/filedetails/?id=2349892329)
- [Steam Guide — Market Overlap](https://steamcommunity.com/sharedfiles/filedetails/?id=3323666699)
