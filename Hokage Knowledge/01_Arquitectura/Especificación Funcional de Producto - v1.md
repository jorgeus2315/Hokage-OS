> Categoría: arquitectura de producto — documento de mayor nivel del proyecto, junto a [[VISION]] y `HOKAGE_CORE_SPECIFICATION_v1.md`
> Estado: 🆕 Nuevo — especificación funcional completa, nada implementado
> Origen: sesión 2026-08-06, encargado explícitamente como "documento de diseño de producto comparable al de un sistema operativo", sin código ni pseudocódigo, pensado para un equipo de 50 ingenieros que nunca ha visto el proyecto
> Precede a: [[Redefinición de Principios Fundamentales - 2026-08-06]] (los 8 principios de esa nota son la base de esta especificación, no se repiten aquí — se aplican)

---

## Cómo leer este documento

[[VISION]] describe el sentimiento y la identidad de producto. `HOKAGE_CORE_SPECIFICATION_v1.md` describe la arquitectura técnica sistema por sistema. Este documento es la capa que faltaba entre ambos: **el diseño funcional completo** — qué hace el sistema, cómo se comporta, cómo se siente usarlo durante horas, y qué contrato cumple cada pieza mayor, sin entrar en esquemas de base de datos ni interfaces de código. Donde este documento contradice algo ya congelado en los otros dos, este documento gana — es el más reciente y el más deliberado.

No sustituye a los ADRs ni a las notas de sistema de `02_Sistemas/` — las precede. Una vez aprobado, cada sección mayor de aquí se convertirá en su propio diseño técnico detallado antes de tocar código.

---

## 1. Filosofía del sistema

**Qué es Hokage OS.** Un sistema operativo personal impulsado por IA para dirigir empresas digitales. No gestiona tareas — dirige un equipo de especialistas autónomos en tu nombre, con un único punto de mando (Hokage) que interpreta tus objetivos, reparte el trabajo, y solo te interrumpe cuando una decisión requiere criterio humano real. Se abre como se abre un ordenador, no como se abre una app: arranca, te orienta, y te deja trabajar durante horas sin que la interfaz se interponga.

**Qué no es.** No es un dashboard — un dashboard te muestra números, Hokage OS te dice qué hacer con ellos. No es una app de mensajería con salas — hablar con veinte agentes por separado es exactamente lo que este sistema elimina. No es un framework no-code genérico — no está diseñado para construir cualquier cosa, está diseñado para dirigir *tus* negocios de una forma concreta y opinada. No es un AutoGPT que ejecuta ciegamente — cada acción con coste o riesgo real pasa por un humano.

**Principios que gobiernan toda decisión futura** (los 8 de [[Redefinición de Principios Fundamentales - 2026-08-06]], resumidos aquí como referencia rápida):
1. Hermes es el Runtime — nunca un agente, nunca tiene personalidad.
2. Hokage es la única IA con la que hablas — Director General, no un chat más.
3. Los agentes son especialistas configurables, no chatbots.
4. El contexto se compone en capas (Global / Departamento / Temporal) — nunca es plano.
5. Existe una biblioteca de conocimiento que Hokage usa por iniciativa propia.
6. El sistema debe sentirse como un sistema operativo, nunca como un dashboard.
7. Todo lo que varía con el tiempo es declarativo y configurable — lo que no varía, es código, sin disculpas.
8. *(añadido en este documento, ver §13)* El motor ejecuta; los Registry describen; la configuración instancia; el usuario personaliza.

**Un noveno principio, propuesto aquí:** *Hokage OS es un sistema, no una colección de features.* Ninguna pieza nueva se construye aislada — antes de escribir la primera línea de una funcionalidad, debe encajar explícitamente en el modelo mental ya existente (mapa → departamentos → agentes → Hokage → Jorge). Si algo no encaja en ese modelo, el modelo se revisa deliberadamente (como en esta misma sesión) — nunca se añade un apéndice que lo rompe en silencio.

**Qué lo hace sentir sistema operativo y no dashboard**, en características concretas y verificables, no en adjetivos:
- Persiste estado entre sesiones — el escritorio que dejaste es el escritorio que encuentras.
- Multitarea real — varias salas, paneles y el canal de Hokage pueden estar abiertos a la vez, no una pantalla a la vez.
- Un único punto de entrada de comandos, siempre accesible, sin navegar a ningún sitio para usarlo.
- Ventanas y paneles reorganizables por el usuario, no una disposición fija por desarrollador.
- Notificaciones del sistema con nivel de urgencia, no una lista de eventos sin jerarquía.
- Una secuencia de arranque real que orienta, no una pantalla de carga.
- "Aplicaciones" (departamentos) con identidad visual propia dentro de un chrome consistente — como abrir Finder vs abrir Terminal en el mismo Mac.
- Memoria del sistema que sobrevive al cierre — como un SO recuerda tu sesión.

---

## 2. Experiencia de usuario — la sesión completa

**Apertura.** La secuencia de arranque (pantalla negra, texto de terminal, barra de progreso roja) no es decorativa — durante ese arranque el sistema está genuinamente recopilando el estado real: qué pasó desde la última sesión, qué decisiones esperan aprobación, qué agentes están activos, si algo falló mientras no estabas. Al terminar el arranque, lo primero que ves no es un mapa vacío — es un **briefing de Hokage**: dos o tres frases con lo esencial ("Mientras no estabas: el Explorador detectó una tendencia en X, el Escritor preparó tres borradores esperando tu aprobación, y hubo un error en Y que Hermes ya reintentó sin problema"). Esto es lo primero que ves, y es lo más importante que hay que ver — no una grilla de widgets que tú tienes que interpretar.

**Vista principal.** El mapa (Torre Hokage + departamentos alrededor) es tu escritorio persistente — siempre está ahí de fondo, siempre puedes volver a él con un solo gesto. Sobre él vive el canal de Hokage: no una sala a la que entras, sino una barra de comando siempre accesible (como Spotlight, como un command palette) donde escribes una orden o le preguntas algo, en cualquier momento, sin salir de lo que estabas haciendo.

**Interacción típica.** Escribes una orden ("crea una nueva colección para Minimal Designs"). Hokage no ejecuta a ciegas: responde con un plan breve — qué agentes participarán, qué haría primero, si necesita algo de ti — y empieza a trabajar. Si algo requiere tu aprobación (gasto, publicación, cambio estructural), aparece como una notificación accionable, no como una interrupción de pantalla completa — la apruebas o rechazas ahí mismo, sin perder lo que estabas mirando.

**Cuándo entras en una sala.** Entras en un departamento cuando quieres profundidad — revisar el trabajo real de sus agentes, ver sus métricas propias, configurar algo específico de esa especialidad. Entrar en una sala se siente como abrir una aplicación distinta dentro del mismo sistema: el contenido cambia por completo (los paneles de Finanzas no se parecen a los de Marketing), pero el chrome — cómo navegas, cómo hablas con Hokage, cómo vuelves — es siempre el mismo.

**Cuándo aparecen paneles.** Un panel aparece cuando hay algo que amerita tu atención inmediata (una decisión pendiente, una alerta) o cuando tú lo pides explícitamente (abres el panel de configuración de un agente). Nunca aparece un panel porque "toca mostrarlo" — cada aparición tiene un disparador real.

**Cómo vuelves al mapa.** Un solo gesto, siempre disponible, nunca un callejón sin salida — como Cmd+ una tecla que te devuelve al escritorio desde cualquier ventana abierta.

**Cómo trabajas durante horas.** El sistema soporta multitarea real: el mapa de fondo con actividad visible, una sala de departamento abierta en una ventana, el canal de Hokage disponible en paralelo, notificaciones llegando a la barra inferior sin interrumpir nada. Trabajas *con* el sistema como trabajarías con un SO real — varias cosas abiertas, cambiando de foco, nunca una única pantalla modal que te bloquea.

**Cierre.** No hay un "logout" en el sentido clásico — el sistema sigue funcionando 24/7 (§11). Lo que sí persiste es tu escritorio: qué salas tenías abiertas, qué layout habías configurado, dónde estaba tu atención — para que la siguiente sesión continúe donde la dejaste, no desde cero.

---

## 3. Hokage — contrato funcional del Director General

**Responsabilidades.** Recibir tus órdenes y objetivos; interpretarlos; descomponerlos en trabajo repartible; decidir qué agentes, herramientas y modelos participan en cada pieza; decidir qué contexto necesita cada agente para hacer su parte; decidir el nivel de autonomía de cada subtarea; despachar el trabajo; monitorizar el progreso; sintetizar resultados en un briefing legible; mantener memoria de qué decisiones tomó y qué resultado tuvieron, para decidir mejor la próxima vez; vigilar la salud y el coste global del sistema.

**Límites — lo que Hokage nunca hace por sí solo:** gastar dinero real, publicar nada públicamente, cambiar configuración estructural (crear/eliminar un departamento, cambiar el modelo asignado a un agente), o ejecutar comandos de sistema directamente (eso pasa siempre por Hermes, con el mismo mecanismo de aprobación que ya existe). Estas cuatro categorías son, por definición, Nivel 3 de autonomía (ver abajo) — sin excepción configurable.

**Niveles de autonomía — el contrato explícito que faltaba.** Toda acción que Hokage considera pasar a un agente, o tomar él mismo, se clasifica en uno de cuatro niveles:

| Nivel | Comportamiento | Ejemplo |
|---|---|---|
| 0 — Solo informa | No actúa, solo señala una oportunidad y espera tu palabra | "Detecté una tendencia interesante, ¿investigo?" |
| 1 — Actúa y reporta | Actúa sin preguntar (trabajo reversible, bajo riesgo), lo cuenta en el próximo briefing | Investigación, borradores, análisis |
| 2 — Actúa y confirma antes del paso irreversible | Prepara todo, se detiene justo antes del punto sin retorno | "El contenido está listo, ¿lo publico?" |
| 3 — Requiere aprobación previa siempre | Nunca actúa sin luz verde explícita | Gasto, publicación, cambios estructurales, comandos de sistema |

El nivel por defecto de cada *tipo* de acción es configuración (Registry + dato, §13), no una decisión que Hokage tome de forma distinta cada vez — así el comportamiento es predecible y auditable. Este modelo formaliza y se apoya en el mecanismo de `Decision`/`risk_level` que ya existe en el sistema — no lo reemplaza, le da un contrato explícito.

**Memoria.** Hokage tiene su propia capa en el sistema de memoria multinivel (§7): qué decisiones tomó, qué resultado tuvieron, qué patrones ha observado sobre tus preferencias (qué sueles aprobar, qué sueles rechazar, tu tolerancia al riesgo por tipo de acción). Esta memoria nunca se comparte directamente con los agentes — informa exclusivamente cómo Hokage reparte y decide.

**Razonamiento y planificación — el ciclo de una orden.** (1) Interpretar la intención real, no solo el texto literal. (2) Consultar su propia memoria — ¿ya se intentó algo parecido? ¿qué funcionó, qué no? (3) Descomponer en tareas concretas. (4) Para cada tarea: decidir agente, herramientas, modelo, y qué capas de contexto necesita (§7). (5) Decidir el nivel de autonomía de cada subtarea. (6) Despachar el trabajo. (7) Monitorizar el progreso conforme llega. (8) Sintetizar el resultado en lenguaje humano para el briefing o la respuesta directa.

**Coordinación de agentes.** Hokage no ejecuta nada él mismo — despacha trabajo a través del mismo mecanismo de cola/asignación que gobierna Hermes (§4). Es la capa de *criterio* sobre una infraestructura de *ejecución* que ya existe — nunca la duplica.

**Comunicación contigo.** Hokage es la única superficie conversacional del sistema (principio 2). Se comunica de tres formas: briefing proactivo (al abrir sesión, o cuando algo lo amerita), respuesta directa a una orden tuya, y notificaciones de aprobación cuando una acción alcanza Nivel 2 o 3.

---

## 4. Hermes — contrato funcional del Runtime

Hermes no es una IA. No tiene personalidad, no conversa, no aparece como un trabajador del ecosistema. Es el kernel — la capa que hace que todo lo demás funcione, invisible cuando funciona bien, visible solo como panel de sistema/monitorización.

**Scheduler.** Decide qué trabajo se ejecuta y cuándo, con prioridad explícita, consciente de urgencia/deadline, y con reparto de cuota de recursos (coste de IA, concurrencia) entre agentes y departamentos. Debe poder crecer de un bucle único a una cola distribuida sin que nada por encima de Hermes lo note — es un detalle de implementación del kernel, no un contrato que otros sistemas dependan de conocer.

**Ejecución.** Hermes es quien realmente invoca al modelo de IA en nombre de cada agente, a través de la capa de proveedor abstraída (§ ver también "IA" en la [[Auditoría de Arquitectura - 2026-08-06|auditoría]]) — gestiona reintentos, timeouts, y fallback a un modelo secundario si el principal falla o no está disponible.

**Colas.** Todo trabajo (de agentes, de Hokage, de automatizaciones) vive en colas tipadas y priorizadas. Hermes es el único componente que altera el ciclo de vida de un ítem de cola — ningún otro sistema debería tocarlo directamente.

**Workflows.** Un workflow es una secuencia de pasos declarada como dato (qué paso sigue a cuál, bajo qué condición, quién lo ejecuta) — Hermes es el motor que la interpreta y ejecuta. Nunca una secuencia de pasos hardcodeada en código imperativo — coherente con el principio 7/8.

**Eventos.** Hermes posee el sistema nervioso del sistema — el Event Bus. Enruta eventos entre agentes, Hokage, y la interfaz. A diferencia de hoy, debe mantener un registro persistente de eventos (no solo en memoria) — necesario para que la memoria de Hokage y la auditoría a largo plazo tengan una fuente real de qué pasó.

**Memoria técnica — distinta de la memoria de conocimiento (§7).** Hermes tiene *estado operacional*, no conocimiento: qué está corriendo ahora mismo, qué falló y por qué, métricas de latencia y coste en tiempo real, logs. Esta es una capa deliberadamente separada de la memoria de agentes/departamentos/Hokage — mezclar "lo que el sistema sabe" con "lo que el sistema está haciendo ahora mismo" sería un error de diseño real.

**Herramientas.** Hermes ejecuta la invocación técnica de una herramienta una vez que un agente o Hokage decidió usarla — resolviendo credenciales vía capabilities, aplicando el gate de aprobación cuando la herramienta lo requiere (mismo mecanismo que hoy protege `system.exec`, generalizado a cualquier herramienta de riesgo).

**Recursos.** Gestiona presupuesto de coste de IA, límites de concurrencia, y cuotas por agente/departamento/venture — de forma que un agente descontrolado no pueda agotar el presupuesto de todos los demás.

**Concurrencia.** Decide cuántos agentes pueden ejecutar simultáneamente y aísla su ejecución — un agente lento o fallido no debe bloquear a los demás.

**Monitorización.** El "monitor de actividad" del sistema — salud, latencia, coste en tiempo real, tasa de error. Alimenta tanto el briefing de Hokage como un panel de sistema propio: el lugar natural para este panel es exactamente donde hoy vive la "Sala de Máquinas" — que deja de ser un departamento de negocio y pasa a ser el panel de monitorización del propio Runtime (ver §10).

---

## 5. Agentes — especialistas, no chatbots

**Ciclo de vida.** Un agente se define mediante configuración (instancia de un Registry de "tipos de rol"). Pasa por: definido → activado (asignado a un departamento y, opcionalmente, a un venture) → en espera / trabajando (gestionado íntegramente por Hermes) → pausado → archivado. En ningún punto de este ciclo "conversación abierta" es un estado — un agente trabaja, no charla.

**Instrucciones.** Ya no un párrafo de personalidad fijo. Un conjunto estructurado: objetivo del rol, límites explícitos, formato de salida esperado. Se combina en tiempo de ejecución con el contexto por capas (§7) vía el compositor de contexto — nunca se re-escribe a mano para cambiar una frase.

**Herramientas.** Lista explícita de herramientas permitidas por rol, resuelta contra el Registry de herramientas (§8) — un agente nunca tiene acceso implícito a algo que no está declarado.

**Permisos.** El nivel de autonomía por defecto de un agente (§3) puede ser más restrictivo que el de su tipo de acción general, nunca más permisivo — un agente puede tener menos confianza que la que Hokage le concedería por defecto, nunca más.

**Memoria.** Cada agente tiene su propia capa privada de aprendizaje (§7) — lo que ha aprendido en su especialidad concreta, para esta instancia concreta. No comparte automáticamente con otros agentes de su mismo rol en otro venture.

**Contexto.** Recibe exactamente tres capas: Global (siempre), su Departamento (siempre), y lo Temporal de la tarea actual — nunca el contexto completo del sistema. Este es el mecanismo directo de "minimizar coste, maximizar especialización" (principio 4).

**Objetivos.** Un agente no es solo reactivo a tareas asignadas — puede tener objetivos propios asignados por Hokage o por Jorge, ligados al sistema de objetivos ya existente, hacia los que trabaja de forma proactiva entre asignaciones puntuales.

**Métricas y rendimiento.** Coste acumulado, tasa de éxito, tiempo de respuesta, y una señal de calidad real: cuántas de sus propuestas apruebas frente a las que rechazas. Esta métrica alimenta tanto su propio panel de configuración como la memoria de Hokage sobre "qué tan bien funciona este agente" — información que Hokage usa para decidir a quién asignar la próxima vez.

**Configuración.** Rol, modelo asignado, herramientas, nivel de autonomía por defecto, presupuesto — todo declarativo, editable sin tocar código, siguiendo el patrón Registry+configuración (§13).

**Modelos de IA.** Cada agente tiene un modelo primario asignado por configuración, y opcionalmente uno o más modelos de respaldo para resiliencia si el primario falla. Cambiar el modelo de un rol es una operación de configuración, nunca un cambio de código — y debe *ser* así de verdad, no solo en la mitad de los casos (la auditoría encontró exactamente el caso contrario: un modelo hardcodeado bypaseando la config).

**Propuesta:** un *rol* (la definición, el Registry entry) puede tener *N instancias* (agentes reales, cada uno con su propio venture, contexto y memoria). Esto ya es parcialmente cierto en el sistema actual (vía `venture_id`) — vale la pena convertirlo en principio explícito de diseño: un rol nuevo se define una vez, se instancia tantas veces como haga falta sin volver a definirlo.

---

## 6. Sistema de conocimiento

Un repositorio unificado y etiquetable de todo lo que Jorge aporta desde fuera del sistema: imágenes, PDFs, documentación, vídeos, código, manuales, inspiración visual, datasets. Hokage decide automáticamente qué usar por tarea, sin que Jorge tenga que adjuntarlo manualmente cada vez.

**Etiquetado.** Tags libres más una capa estructurada (tipo de asset, departamento relevante, venture relevante, formato, fecha). El etiquetado no es solo manual: cualquier agente u Hokage puede "guardar" algo al conocimiento cuando lo considera valioso durante su trabajo (el Explorador encuentra una referencia visual de un competidor y la guarda con tags automáticos), no solo Jorge subiendo archivos.

**Selección automática.** Cuando el compositor de contexto arma el contexto de una tarea, consulta el sistema de conocimiento por relevancia (tags, y a futuro búsqueda semántica) e incluye solo lo más relevante dentro de un presupuesto de coste — nunca vuelca toda la biblioteca.

**Propuesta de mejora real, no cosmética:** diseñar el Sistema de Conocimiento y el Sistema de Memoria (§7) como **dos fuentes del mismo motor de recuperación**, no como dos sistemas paralelos. La memoria es conocimiento que el sistema genera/aprende; la biblioteca es conocimiento que Jorge aporta desde fuera — pero ambos responden a la misma pregunta ("¿qué es relevante para esta tarea concreta?") y deberían compartir el mismo mecanismo de etiquetado, búsqueda y ranking de relevancia. Construirlos por separado significa construir dos sistemas de búsqueda semántica que hacen básicamente lo mismo — exactamente el tipo de duplicación que el principio 7 quiere evitar.

---

## 7. Sistema de memoria multinivel

**Capas — a quién pertenece cada una:**
- **Global** — hechos verdaderos para todo el sistema: qué es Hokage OS, normas generales, objetivos globales. Editable en un único lugar, legible por todos.
- **Hokage** — patrones de decisión, tus preferencias observadas, histórico de aprobaciones/rechazos. Nunca se filtra directamente a los agentes — informa exclusivamente cómo Hokage reparte y decide (§3).
- **Departamento** — conocimiento de una especialidad (qué canales de marketing funcionan mejor para este tipo de negocio). Compartido entre los agentes de ese departamento.
- **Agente** — aprendizaje de una instancia concreta, privado a ella. Ya existe parcialmente hoy como memoria privada por agente.

**Eje de persistencia — independiente de la capa:**
- **Temporal** — vive solo mientras dura la tarea o sesión actual, se descarta después.
- **Permanente** — persiste indefinidamente, sujeta a una relevancia decreciente con el tiempo (lo no usado en mucho tiempo pierde prioridad de recuperación sin borrarse) — para que el contexto siga siendo barato de consultar según crece.

**Cómo interactúan.** Cuando el compositor de contexto arma el contexto de una tarea para un agente, consulta en este orden: Global (siempre) + Departamento del agente (siempre) + memoria propia del agente (si es relevante) + lo que sea pertinente del Sistema de Conocimiento (§6) + lo Temporal de la tarea. La memoria de Hokage nunca entra en este contexto — es exclusiva de su propio razonamiento. Todo pasa por el mismo mecanismo de composición, nunca por rutas paralelas.

**Escritura.** Cualquier agente puede escribir a su propia memoria libremente. Escribir a memoria de Departamento o Global es una acción de mayor alcance — **propuesta de salvaguarda real**: debería requerir una señal explícita de confianza (no necesariamente aprobación humana cada vez, pero sí un umbral más alto que escribir a memoria privada), para que un agente no contamine el contexto compartido de todos con algo irrelevante o incorrecto.

**Olvido.** La memoria temporal se descarta automáticamente al cerrar la tarea. La permanente no se borra por defecto, pero su prioridad de recuperación decae con el desuso — el sistema recuerda todo, pero prioriza lo que sigue siendo útil.

---

## 8. Sistema de herramientas

Diseñado para soportar cientos de herramientas sin que añadir la número 200 sea más difícil que añadir la número 20.

- **Definición declarativa (Registry):** nombre, versión, descripción, capacidades que expone, parámetros de entrada/salida, nivel de riesgo por defecto, dependencias.
- **Permisos:** qué roles pueden usarla y si requiere aprobación antes de ejecutarse — configuración, no código por herramienta.
- **Versiones:** una herramienta evoluciona sin romper a los agentes que dependen de una versión anterior.
- **Capacidades:** la resolución de credenciales (qué API key necesita) está desacoplada de la herramienta misma — la herramienta declara *qué tipo* de capability necesita, nunca conoce el secreto real.
- **Dependencias:** una herramienta puede depender de otra, declarado explícitamente y resuelto en el registro, nunca implícito en el código.
- **Límites:** cuota de uso por agente/día, coste máximo, timeout — configurables por herramienta y por rol.
- **El motor es genérico:** sabe invocar cualquier herramienta que cumpla el contrato. Añadir una herramienta nueva es escribir su implementación y registrarla — nunca tocar el motor de ejecución. Mismo patrón que ya demostró funcionar en el `Registry` del World Engine.

---

## 9. Sistema de interfaz — el escritorio

**El Mapa** es el escritorio persistente: siempre disponible, siempre accesible con un gesto, muestra de un vistazo el estado del sistema completo (departamentos, actividad, agentes en movimiento) — como los iconos de un escritorio real.

**Barra superior** *(propuesta, no pedida explícitamente pero necesaria para la sensación de sistema operativo):* reloj, salud global del sistema, coste del día, notificaciones pendientes, y el acceso al canal de Hokage siempre visible — el equivalente a la barra de menú de un SO de escritorio.

**Panel izquierdo** — lista de agentes activos en tiempo real con su estado, el "dock de procesos en ejecución" del sistema.

**Panel derecho** — contextual: sin nada seleccionado, muestra el briefing de Hokage; con algo seleccionado (un departamento, un agente, una decisión), muestra el detalle de eso — un inspector, al estilo de herramientas profesionales de diseño/edición.

**Barra inferior** — dock de notificaciones y eventos recientes, con acceso rápido a paneles ya abiertos — una taskbar.

**Widgets** — piezas pequeñas y reutilizables que un departamento expone (ventas del día en Finanzas, cola de contenido en Marketing). Instancias de un Registry de tipos de widget, configurables por departamento (§10) — nunca hardcodeados por vista.

**Ventanas** — entrar en una sala, o abrir un panel de detalle, abre una ventana dentro del escritorio: minimizable, cerrable, y a futuro movible/redimensionable. Requiere el motor de layout que hoy no existe — es la pieza de infraestructura más urgente de toda esta sección.

**Terminales** — un tipo más de panel, reutilizable, para departamentos que lo requieran. El panel de sistema de Hermes (§4, §10) es la terminal por excelencia, pero el mecanismo es genérico.

**Notificaciones** — un sistema unificado con nivel de urgencia, accionables inline cuando corresponde (aprobar/rechazar una decisión sin salir de donde estás) — no solo el flujo de aprobación de hoy, generalizado a cualquier evento que amerite atención.

**Layouts** — la disposición de ventanas y paneles es *estado guardado*, no una disposición fija de desarrollador — coherente con el principio de que todo lo que varía es dato.

**Temas** — un único sistema de tokens de diseño (color, tipografía, espaciado) del que derivan todos los componentes. Hoy existen cuatro fuentes de paleta sin sincronizar entre sí (hallazgo real de la auditoría) — esto se consolida en una única fuente antes de construir nada de esta sección. Un tema es una instancia de configuración sobre ese sistema de tokens, lo que permite temas alternativos a futuro sin tocar un solo componente.

**Editor visual** — un modo donde reorganizas el escritorio (mover/redimensionar paneles, reposicionar salas en el mapa), construido sobre el mismo motor de layout — no un sistema aparte con su propia lógica.

**Sistema de paneles** — cada panel es una instancia de un Registry de "tipos de panel" (chat, configuración, estadísticas, terminal, etc. — ya existen como pestañas por sala, generalizados aquí a piezas reutilizables). Qué paneles tiene una sala concreta es configuración por departamento (§10), nunca código por sala.

**Persistencia del layout** — se guarda en el backend, no solo en el navegador, para que el estado del escritorio sobreviva entre sesiones y dispositivos — coherente con "un sistema operativo recuerda tu estado."

---

## 10. Sistema de departamentos

Cada sala representa un departamento distinto, y debe sentirse como una aplicación distinta dentro del mismo sistema operativo — mismo chrome, contenido completamente diferente.

- Un departamento se define declarativamente: qué paneles tiene (de los tipos disponibles en §9), qué widgets muestra, qué acciones rápidas ofrece, qué métricas destaca, si necesita terminal propia, qué herramientas son relevantes ahí.
- El chrome (navegación, barra superior, vuelta al mapa) es idéntico entre departamentos — la consistencia de un mismo sistema operativo. El contenido varía por completo — la sensación de aplicaciones distintas.
- **Tipos de departamento como plantillas reutilizables** (Registry de "tipos": Marketing, Ventas, Finanzas, Producción, Sistema) — crear un departamento nuevo es instanciar un tipo y personalizarlo, nunca programar una vista desde cero. Esta es la aplicación directa del principio de "todo declarativo" a esta sección concreta, y la que más directamente responde a "quiero añadir departamentos dentro de un año sin reescribir arquitectura."
- **La Sala de Máquinas deja de ser un departamento de negocio.** Con Hermes fuera de la tabla de agentes (principio 1), su sala pasa a ser un tipo distinto — "Panel de Sistema" — mismo chrome que cualquier departamento, pero su contenido es la monitorización del Runtime (§4: colas, salud, coste, concurrencia), no métricas de un negocio. Resuelve de forma natural dónde vive Hermes visualmente sin reintroducir el problema que motivó sacarlo de la tabla de agentes.

---

## 11. Automatización — el sistema cuando no estás conectado

Hokage OS funciona 24/7. Cuando no estás, Hermes sigue ejecutando el trabajo que Hokage ya priorizó, y Hokage sigue tomando las decisiones de Nivel 0/1 (§3) que no requieren tu palabra: investigar tendencias, optimizar lo que ya existe, detectar anomalías y errores, lanzar tareas de mantenimiento, coordinar agentes según los workflows/automatizaciones activas, generar informes de progreso, y **preparar** (nunca ejecutar) las propuestas de Nivel 2/3 para que esperen tu aprobación cuando vuelvas.

Al reconectar, recibes el briefing (§2) — un resumen curado, no un volcado de eventos crudos.

**Propuesta — "modo nocturno":** un estado explícito donde el nivel de autonomía por defecto sube temporalmente (Hokage puede tomar decisiones de Nivel 2 que normalmente esperarían tu confirmación), dentro de límites de coste estrictos, con reversión automática de cualquier acción si algo empieza a salir mal (pausar una campaña que muestra señales de fallo, por ejemplo). Esto haría el trabajo nocturno genuinamente más productivo sin aumentar el riesgo real — el sistema se vuelve más audaz solo cuando el coste del error está acotado y es reversible.

---

## 12. Escalabilidad

Cientos de agentes, herramientas y departamentos; múltiples negocios, modelos y proveedores de IA; plugins; aplicaciones nuevas — sin rediseñar la arquitectura. Esto no es una promesa aparte: es una consecuencia directa de que las secciones 3 a 11 se construyan, sin excepción, sobre el patrón Registry + configuración (§13). Añadir un agente, una herramienta, un departamento, un tema o un workflow nuevo es siempre instanciar desde un Registry existente — nunca escribir un tipo nuevo de código, salvo que sea una capacidad genuinamente nueva (en cuyo caso se añade un registro nuevo, sin tocar el motor existente).

El techo real de escalabilidad deja de ser arquitectónico y pasa a ser de recursos — coste, concurrencia, latencia del scheduler de Hermes. Esos son problemas de ingeniería de sistemas conocidos (sharding, colas distribuidas) que se abordan cuando el volumen real lo exija, no de antemano — sobre-diseñar esa parte hoy sería la misma sobre-abstracción que el principio 7 ya advierte evitar.

---

## 13. Filosofía de configuración

El principio, ya dado por Jorge, se formaliza aquí en cuatro capas explícitas — una capa más que la propuesta original de tres (motor/registro/configuración) de la sesión anterior, separando *instanciar* de *personalizar*, una distinción real que vale la pena mantener:

1. **Motor (código).** Sabe ejecutar cualquier cosa que cumpla un contrato. No conoce instancias concretas — un `RenderSyncSystem` no sabe qué es un "hub" o una "sala", solo sabe crear/actualizar/destruir lo que el Registry le describe.
2. **Registry (código, extensible).** Declara los tipos posibles — `kind → definición`. Añadir un tipo nuevo es un archivo nuevo, nunca una modificación al motor.
3. **Configuración (dato).** Instancia tipos concretos con parámetros concretos — esta herramienta con esta credencial, este departamento con estos paneles, este agente con este modelo.
4. **Personalización (dato, editable en caliente por el usuario).** Ajustes que Jorge cambia directamente sin pasar por "configuración de sistema" — el layout de su escritorio, el tema visual activo, qué widgets ve en cada panel.

**El límite deliberado, para no convertir esto en un lenguaje de configuración innecesario:** solo se configura lo que tiene valor de negocio real o puede cambiar con el tiempo — los diez sistemas listados por Jorge (agentes, paneles, salas, herramientas, modelos, workflows, layouts, temas, assets, comportamiento). Todo lo demás — constantes de interacción física, umbrales que nadie va a querer tocar, detalles de implementación de un `System` — se queda como código, sin disculpas ni indirección innecesaria.

---

## 14. Oportunidades de mejora propuestas en este documento (resumen)

1. **Unificar Memoria (§7) y Sistema de Conocimiento (§6)** en un único motor de recuperación con el mismo mecanismo de etiquetado/búsqueda/relevancia — evita construir dos sistemas de búsqueda semántica que responden a la misma pregunta.
2. **Salvaguarda de confianza para escritura a memoria compartida** (Departamento/Global) — evita que un agente contamine el contexto de todos con algo irrelevante.
3. **"Modo nocturno" con autonomía elevada y reversión automática** — más productividad 24/7 sin más riesgo real, acotado a acciones de coste bajo y reversible.
4. **Un rol puede tener N instancias** — principio explícito, no solo consecuencia accidental de `venture_id`.
5. **Barra superior tipo "menu bar"** — pieza de interfaz no solicitada explícitamente pero necesaria para que el sistema se sienta un SO, no solo un mapa con paneles.
6. **La Sala de Máquinas como "Panel de Sistema", tipo de departamento distinto al de negocio** — resuelve dónde vive Hermes visualmente sin reabrir el problema que motivó sacarlo de la tabla de agentes.
7. **Niveles de autonomía explícitos (0-3), formalizados y configurables por tipo de acción** — convierte en contrato legible algo que hoy es un `risk_level` implícito.
8. **Persistencia de layout en backend, no solo en el navegador** — para que "el estado del escritorio" sea un concepto del sistema, no del dispositivo.

---

## Qué queda fuera de este documento

Esto es diseño de producto y de comportamiento, no diseño técnico detallado. No define esquemas de base de datos, contratos de API, ni interfaces de código — cada sección mayor (Hokage, Hermes, agentes, memoria, herramientas, interfaz, departamentos) se convertirá en su propio ADR o nota de sistema técnico una vez que este documento esté aprobado. Nada de lo descrito aquí está implementado.

## Relacionado

- [[Redefinición de Principios Fundamentales - 2026-08-06]]
- [[Auditoría de Arquitectura - 2026-08-06]]
- [[VISION]]
- [[Núcleo - Arquitectura del Core]]
- [[Runtime, Scheduler y Event Bus]]
- [[ADR-002 - Agent Runtime]]
- [[Memory System]]
- [[Plugin System - Arquitectura Completa]]
- [[Gestión de Secretos y Capabilities]]
- [[Frontend World Engine]]
- [[Plan de Migración ECS]]
- [[Escalabilidad]]
- [[Resumen Ejecutivo - Decisiones Congeladas]]
- [[INDEX]]
