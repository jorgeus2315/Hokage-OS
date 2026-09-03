# UI Vision Master

> Fuente de verdad para la experiencia visual e interacción de Hokage OS.
>
> Este documento define **qué debe sentir, mostrar y permitir hacer la interfaz**.  
> No define todavía la implementación técnica concreta. La implementación debe adaptarse a la arquitectura real de Hokage OS.

---

# 1. Visión general

Hokage OS no debe sentirse como un dashboard empresarial tradicional.

Debe sentirse como un **ecosistema operativo visual vivo**, donde los agentes, departamentos, tareas, sistemas y conexiones existen dentro de un mundo representado visualmente.

La interfaz principal es un **mapa operativo**.

El mapa representa físicamente el ecosistema:

- Torre Hokage.
- Departamentos.
- Salas especializadas.
- Agentes.
- Zona de entrada/descarga.
- Tiendas.
- Banco.
- Caminos y conexiones.
- Elementos decorativos.
- Actividad del sistema.

El usuario debe poder observar el sistema y, al mismo tiempo, controlarlo.

La interfaz debe permitir pasar de:

**visión general → sala → agente → tarea → detalle → intervención**

sin perder el contexto del mapa.

---

# 2. Principios de experiencia

## 2.1 El mapa es el centro

La pantalla principal gira alrededor del mapa.

Los paneles no deben convertir la aplicación en una colección de páginas independientes.

Cuando se abre una sala o un agente:

- el mapa permanece visible;
- el usuario mantiene el contexto espacial;
- el panel aparece sobre el mundo;
- cerrar el panel devuelve exactamente al estado anterior.

---

## 2.2 El sistema debe sentirse vivo

Los agentes no deben ser únicamente filas en una tabla.

Deben existir visualmente dentro del mundo.

Pueden:

- caminar;
- entrar en salas;
- salir de salas;
- reunirse;
- trabajar;
- esperar;
- transportar elementos;
- cambiar de estado.

Las animaciones deben representar estados o actividad real cuando sea posible.

No utilizar movimiento simplemente como decoración.

---

## 2.3 Cada sala tiene una función

Cada departamento debe representar una parte concreta del ecosistema.

Ejemplos:

- Labs Uchiha → investigación.
- Diseños → creación y evaluación.
- Reuniones → colaboración y coordinación.
- Tiendas → operación comercial.
- Banco → información financiera.
- Torre Hokage → supervisión, conversación y control.

La interfaz de cada sala debe estar especializada en su función.

No utilizar el mismo dashboard para todas las salas.

---

## 2.4 El usuario debe entender qué ocurre rápidamente

La interfaz debe responder visualmente a preguntas como:

- ¿Qué está pasando?
- ¿Qué están haciendo los agentes?
- ¿Hay algo bloqueado?
- ¿Necesitan mi aprobación?
- ¿Qué ha ocurrido recientemente?
- ¿Qué está funcionando mal?
- ¿Dónde tengo que intervenir?

El usuario no debería tener que abrir múltiples pantallas para descubrir algo importante.

---

# 3. Experiencia al iniciar Hokage

Al entrar en Hokage OS se muestra el **escritorio principal**.

La vista inicial debe contener:

- mapa;
- Torre Hokage;
- departamentos;
- agentes;
- navegación principal;
- lista de agentes;
- zona comercial;
- acceso a Hokage;
- ajustes;
- editor del mapa;
- control START/STOP;
- chat rápido con Hokage.

La pantalla debe transmitir inmediatamente:

> "Este es un sistema operativo vivo y ahora mismo puedo ver qué está ocurriendo."

---

# 4. Escritorio principal

La distribución conceptual actual es:

```text
┌─────────────────────────────────────────────────────────────────┐
│                         NAVEGACIÓN                              │
│                                                                 │
│  🏠 Inicio     ⚙ Ajustes              Editar mapa    + Agentes │
│                                                                 │
├──────────────┬────────────────────────────────┬─────────────────┤
│              │                                │                 │
│   AGENTES    │                                │     TIENDAS     │
│              │             MAPA               │                 │
│   Agent 1    │                                │   Ventas hoy    │
│   Agent 2    │        Torre Hokage            │   Pedidos       │
│   Agent 3    │             │                  │   Catálogo      │
│   Agent 4    │       ┌─────┴─────┐            │                 │
│              │       │   SALAS   │            │                 │
│              │       └───────────┘            │                 │
│              │                                │                 │
│              │                                │                 │
├──────────────┴────────────────────────────────┴─────────────────┤
│              START / STOP                    CHAT HOKAGE        │
└─────────────────────────────────────────────────────────────────┘


Esta representación es conceptual.

La implementación puede adaptar tamaños y posiciones para conseguir una composición visual mejor.

---

# 5. Navegación principal

## 5.1 Inicio / Casa

El icono de casa lleva a la interfaz principal de Hokage.

La experiencia debe acercarse a una especie de **JARVIS / centro de control personal**.

Desde aquí el usuario puede:

- hablar con Hokage;
- preguntar por el sistema;
- dar órdenes;
- pedir auditorías;
- revisar el estado general;
- consultar agentes;
- consultar conexiones;
- detectar problemas.

---

## 5.2 Ajustes

Debe existir un panel de ajustes general.

No debe convertirse en un panel gigantesco.

Solo debe contener aquello que sea realmente necesario.

Categorías posibles:

### Audio

- volumen general;
- volumen de efectos;
- voz;
- activar/desactivar sonidos.

### Conexiones

- estado de conexiones;
- servicios conectados;
- estado de sincronización.

### Seguridad

- información relevante;
- sesiones;
- permisos;
- alertas.

### Privacidad

- configuración relevante;
- información sobre datos;
- permisos de acceso.

### Sistema

- versión;
- estado;
- información básica.

La configuración avanzada debe vivir donde tenga sentido, por ejemplo dentro de cada agente, tienda o sistema.

---

# 6. Editor del mapa

Debe existir un botón:

**Editar mapa**

Al activarlo se entra en un modo especial de edición.

En este modo el usuario puede:

- seleccionar salas;
- crear salas;
- eliminar salas;
- mover salas;
- configurar salas;
- cambiar propiedades;
- configurar agentes;
- asignar modelos;
- definir responsabilidades;
- configurar comportamiento.

El modo edición debe diferenciarse visualmente del modo normal.

Debe evitarse que un click accidental modifique la estructura del mundo.

---

# 7. Añadir agentes

Debe existir un botón:

**+ Añadir agente**

Debe abrir un flujo de creación.

El usuario debe poder configurar, cuando la arquitectura lo permita:

- nombre;
- avatar/personaje;
- modelo;
- departamento;
- instrucciones;
- herramientas;
- conexiones;
- permisos;
- autonomía;
- tareas;
- memoria/configuración.

La interfaz no debe crear un sistema paralelo de agentes.

Debe utilizar el sistema de agentes real de Hokage OS.

---

# 8. Control START / STOP

Debe existir un control global:

**START / STOP**

Debe representar el estado real del sistema.

START:

- iniciar la operación del ecosistema cuando corresponda.

STOP:

- detener la ejecución de forma segura.

El botón no debe limitarse a cambiar un estado visual.

Debe estar conectado con el runtime real.

Las operaciones potencialmente peligrosas deben poder requerir confirmación.

---

# 9. Mapa

El mapa es el elemento visual principal.

Debe representar:

- Torre Hokage.
- Salas/departamentos.
- Caminos.
- conexiones.
- agentes.
- actividad.
- vehículos.
- objetos.
- zona de descarga.
- elementos ambientales.

Los edificios/salas deben ser claramente reconocibles y clickable.

La decoración puede evolucionar y ser enriquecida visualmente por IA, pero nunca debe perjudicar:

- legibilidad;
- navegación;
- interacción;
- rendimiento.

---

# 10. Salas

Las salas representan departamentos o sistemas especializados.

Al hacer click en una sala:

**NO navegar a una página completamente distinta.**

Debe abrirse un panel contextual sobre el mapa.

El usuario debe seguir viendo el mundo detrás.

El panel puede ocupar una parte importante de la pantalla, pero debe conservarse la sensación de estar dentro del mismo sistema.

---

# 11. Labs Uchiha — Investigación

Labs Uchiha es el espacio dedicado a investigación.

## Vista de la sala

Debe mostrar:

- identidad del laboratorio;
- actividad actual;
- agente responsable;
- progreso;
- porcentaje;
- línea temporal de actividad;
- hallazgos;
- propuestas;
- investigaciones.

---

## Actividad actual

Ejemplo conceptual:

> Investigación de nuevas estrategias  
> Agente: Research Agent  
> Progreso: 78%

Visualmente:

```
████████░░ 78%
```

Debe utilizar datos reales cuando estén disponibles.

---

## Línea de actividad

Debe existir una timeline visual.

Ejemplo:

```
10:32  Investigación iniciada
10:41  Datos recopilados
10:52  Hipótesis creada
11:03  Evaluación
11:10  Pendiente de aprobación
```

---

## Hallazgos

Cada hallazgo/propuesta puede mostrar:

- título;
- descripción;
- evidencia;
- agente;
- fecha;
- estado.

Acciones:

- Aprobar.
- Rechazar.
- Revisar.

Las acciones deben ejecutar operaciones reales cuando exista backend.

Toda decisión importante debe poder quedar registrada.

---

# 12. Sala de Diseños

La sala de Diseños representa el proceso creativo.

Debe mostrar:

- últimos diseños;
- referencias;
- resultados;
- tiendas;
- feedback;
- aprendizaje del agente.

---

## 12.1 Últimos diseños

Debe existir una galería de diseños recientes.

Cada diseño es clickable.

Al seleccionarlo:

- se amplía;
- se muestran detalles;
- se muestran referencias;
- se muestra contexto;
- se muestra agente;
- se muestra fecha;
- se muestra resultado.

---

## 12.2 Referencias

Debe existir una zona para proporcionar referencias.

Tipos:

- texto;
- imágenes;
- archivos;
- ideas;
- instrucciones.

El usuario debe poder alimentar al agente con nuevas referencias.

---

## 12.3 Tiendas

Debe poder definirse:

- qué tienda utiliza un diseño;
- qué producto corresponde;
- dónde se publicará;
- información relacionada.

---

## 12.4 Resultados

Debe poder verse el resultado de diseños/productos.

El usuario debe poder proporcionar feedback:

- Me gusta.
- No me gusta.
- Mejorar.
- Rehacer.
- Aprobar.

---

## 12.5 Aprendizaje

El feedback debe poder alimentar el sistema de memoria/preferencias.

Ejemplo:

```
Resultado
↓
Feedback del usuario
↓
Preferencia aprendida
↓
Memoria / conocimiento
↓
Futuras decisiones del agente
```

El aprendizaje debe ser explícito y trazable.

No modificar silenciosamente instrucciones críticas del agente.

---

# 13. Sala de Reuniones

La Sala de Reuniones es el **centro de coordinación visual**.

Aquí los agentes aparecen físicamente reunidos.

Debe existir:

- mesa;
- agentes sentados;
- animaciones de conversación;
- actividad;
- estados;
- flujo de trabajo.

Los agentes pueden:

- hablar;
- escuchar;
- trabajar;
- esperar;
- intervenir;
- recibir instrucciones.

---

## 13.1 Actividad

Debe existir una vista para observar todas las actividades en curso.

Ejemplo:

```
AGENTE A
Analizando investigación
███████░░░ 72%

AGENTE B
Preparando propuesta
████░░░░░░ 41%

AGENTE C
Esperando aprobación
WAITING
```

---

## 13.2 Conversaciones

Debe existir un chat/timeline donde puedan verse las comunicaciones operativas entre agentes.

Debe poder identificarse:

- quién habló;
- cuándo;
- sobre qué tarea;
- qué decisión se tomó.

No mostrar automáticamente razonamiento interno privado de modelos.

La interfaz debe mostrar **comunicación operativa y eventos que el sistema permita exponer**.

---

## 13.3 Intervención

El usuario debe poder intervenir.

Puede:

- escribir;
- hablar;
- dirigirse a todos;
- dirigirse a un agente concreto;
- dirigirse a Hokage.

Ejemplo:

> "Parad esta investigación y priorizad la propuesta B."

La intervención humana debe quedar registrada como tal.

---

# 14. Tiendas

La sala Tiendas representa la operación comercial.

Debe poder manejar múltiples tiendas.

Ejemplo:

- Etsy 1.
- Etsy 2.
- Etsy 3.
- Shopify.
- futuras plataformas.

---

## 14.1 Selector de tienda

Debe existir un selector claro.

Al cambiar de tienda:

**todo el contenido debe corresponder a esa tienda.**

No mezclar datos entre cuentas.

---

## 14.2 Resumen

Mostrar:

- ventas;
- ingresos;
- pedidos;
- productos activos;
- rendimiento;
- periodo seleccionado.

---

## 14.3 Periodo

Debe poder seleccionarse:

- Hoy.
- 7 días.
- 30 días.
- Personalizado.

Las métricas deben actualizarse conjuntamente.

---

## 14.4 Actividad

Mostrar:

- productos subidos;
- productos modificados;
- anuncios;
- pedidos;
- incidencias;
- sincronizaciones;
- cambios relevantes.

---

## 14.5 Catálogo

Debe existir acceso al catálogo de la tienda seleccionada.

Mostrar:

- imagen;
- nombre;
- precio;
- estado;
- stock cuando exista;
- ventas;
- rendimiento.

Cada producto debe ser clickable.

---

## 14.6 Anuncios

Mostrar:

- anuncios activos;
- estado;
- productos asociados;
- rendimiento;
- actividad.

---

## 14.7 Salud de la tienda

Debe existir una sección de estado rápido.

Ejemplo:

```
🟢 Conectada
🟢 Sincronización: hace 2 min
🟢 24 productos activos
🟡 3 productos necesitan atención
🔴 1 anuncio con error
```

Debe ser una de las primeras cosas visibles.

---

## 14.8 Ajustes

Configurar cuando corresponda:

- conexión;
- sincronización;
- automatización;
- permisos;
- reglas;
- configuración de la tienda.

Las credenciales nunca deben mostrarse directamente.

---

# 15. Banco

El Banco representa la información financiera.

Debe concentrar:

- ventas;
- ingresos;
- gastos;
- beneficios;
- evolución;
- estadísticas;
- movimientos;
- alertas.

La actividad financiera debe permanecer aquí y no mezclarse innecesariamente con el panel de Tiendas.

---

# 16. Torre Hokage

La Torre Hokage es el **centro de supervisión y control**.

Debe existir una interfaz visual dedicada.

---

## 16.1 Avatar / presencia

Debe existir una representación visual del Hokage.

---

## 16.2 Preguntas rápidas

Debe existir una serie de acciones predefinidas.

Ejemplos:

- ¿Todo funciona correctamente?
- Revisar conexiones.
- Ejecutar auditoría.
- Revisar agentes.
- Revisar errores.
- Revisar seguridad.
- Revisar rendimiento.
- Mostrar tareas pendientes.
- ¿Qué necesita mi atención?
- Proponer mejoras.

Estas acciones deben ejecutar operaciones reales cuando exista backend.

No deben ser botones decorativos.

---

## 16.3 Chat

En la parte inferior debe existir un chat permanente.

Debe permitir:

- preguntas;
- órdenes;
- auditorías;
- consultas;
- decisiones.

Ejemplos:

> "Audita los agentes."

> "¿Qué está fallando?"

> "¿Qué tareas están bloqueadas?"

> "Revisa las conexiones."

> "Detén esta tarea."

> "¿Qué debería mejorar?"

---

## 16.4 Acciones sensibles

Las instrucciones potencialmente destructivas deben requerir confirmación.

Ejemplo:

> "¿Quieres detener todos los agentes?"

Debe existir diferencia entre:

- consulta;
- recomendación;
- acción;
- acción destructiva.

---

# 17. Panel universal de Agente

Todos los agentes deben tener una misma interfaz contextual.

Da igual si se selecciona:

- desde la columna izquierda;
- desde el mapa;
- desde una sala;
- desde una reunión.

Debe abrirse el mismo panel de agente.

---

## 17.1 Identidad

Mostrar:

- nombre;
- avatar;
- modelo;
- estado.

---

## 17.2 Actividad

Mostrar:

- tarea actual;
- actividad;
- progreso;
- estado;
- actividad reciente.

---

## 17.3 Modelo

Debe poder visualizarse el modelo actual.

Cuando la arquitectura lo permita:

**Cambiar modelo**

---

## 17.4 Conexiones

Mostrar:

- servicios;
- APIs;
- herramientas;
- tiendas;
- bases de conocimiento;
- conexiones disponibles.

---

## 17.5 Configuración

Separar:

- comportamiento;
- instrucciones;
- herramientas;
- permisos;
- autonomía;
- conexiones;
- configuración general.

No convertirlo en un único textarea gigante.

---

## 17.6 Autonomía

Debe reflejar los niveles de autonomía definidos por el sistema.

Ejemplo:

> Autonomía — Nivel 2  
> Ejecuta acciones que no requieren aprobación.

La UI debe representar el sistema de autonomía real, no crear otro paralelo.

---

# 18. Barra de agentes

En el lateral izquierdo existe una lista de agentes.

Cada entrada muestra:

- nombre;
- modelo;
- actividad;
- estado;
- porcentaje/progreso.

Ejemplo:

```
Uchiha Research
Claude
Investigando
████████░░ 80%
```

Debe ser clickable.

---

# 19. Zona de descarga

Debe existir una zona física dentro del mapa.

Representa la entrada de elementos externos al ecosistema.

Pueden llegar:

- vehículos;
- productos;
- archivos;
- información;
- datos;
- resultados;
- elementos del backend.

Visualmente pueden representarse mediante:

- cajas;
- paquetes;
- documentos;
- archivos;
- contenedores.

Cuando sea posible, debe existir relación entre el objeto visual y el evento real que lo originó.

---

# 20. Chat rápido

Debe existir una zona de chat accesible desde la pantalla principal.

Su función es permitir contactar rápidamente con Hokage sin tener que abandonar el mapa.

Debe poder:

- enviar mensajes;
- recibir respuestas;
- abrir conversación completa;
- recibir avisos importantes.

---

# 21. Estados del sistema

La interfaz debe representar estados claros.

Estados posibles:

- IDLE
- RUNNING
- PAUSED
- WAITING
- ERROR
- COMPLETED
- BLOCKED
- OFFLINE
- DISCONNECTED

Los estados deben ser visualmente reconocibles.

No depender únicamente del color.

---

# 22. Actividad global

Debe existir una representación coherente de actividad.

La actividad puede aparecer en:

- agentes;
- salas;
- reuniones;
- tiendas;
- Torre Hokage;
- timeline.

Debe existir una relación clara entre:

```
EVENTO
↓
ACTIVIDAD
↓
AGENTE / SALA
↓
ESTADO
↓
RESULTADO
```

---

# 23. Animaciones

La interfaz debe sentirse viva.

Animaciones posibles:

### Agentes

- caminar;
- entrar;
- salir;
- sentarse;
- trabajar;
- esperar;
- conversar.

### Mundo

- vehículos;
- puertas;
- iluminación;
- actividad de edificios;
- llegada de paquetes.

### UI

- apertura de panel;
- cierre;
- transición;
- progreso;
- notificación;
- estados.

Las animaciones deben tener propósito.

No utilizar animaciones excesivas.

---

# 24. Sonido

Debe existir un sistema de sonido.

Posibles sonidos:

- click;
- apertura de panel;
- cierre;
- notificación;
- tarea completada;
- error;
- mensaje Hokage;
- evento importante.

Debe poder configurarse:

- volumen;
- sonidos activados/desactivados;
- voz.

No reproducir sonidos constantemente.

El sonido debe reforzar el estado del sistema, no distraer.

---

# 25. Temas y estética

La interfaz debe tener identidad propia.

Debe transmitir:

- tecnología;
- centro de operaciones;
- profundidad;
- mundo vivo;
- sofisticación;
- claridad.

No debe parecer:

- un CRM;
- un panel administrativo;
- un dashboard genérico;
- una colección de componentes sin identidad.

La IA puede encargarse de desarrollar la estética final dentro de estas restricciones.

---

# 26. Tipografía

La tipografía debe priorizar:

1. legibilidad;
2. jerarquía;
3. identidad;
4. consistencia.

Debe existir una jerarquía clara entre:

- títulos;
- nombres;
- estados;
- métricas;
- acciones;
- texto secundario.

---

# 27. Iconografía

Los iconos deben ser consistentes.

Deben utilizarse para:

- navegación;
- estados;
- acciones;
- herramientas;
- conexiones;
- configuración.

No utilizar iconos arbitrarios mezclando estilos incompatibles.

---

# 28. Responsive

Prioridad:

1. Desktop.
2. Pantallas grandes.
3. Laptop.

La experiencia principal debe mantenerse alrededor del mapa.

En pantallas pequeñas se pueden reorganizar:

- agentes;
- tiendas;
- chat;
- paneles.

No sacrificar la experiencia principal del mapa por conseguir un responsive perfecto en móvil.

---

# 29. Datos reales

La interfaz debe utilizar datos reales siempre que existan.

No crear permanentemente:

```
Claude
87%
Analizando...
```

como valores hardcodeados.

Si los datos todavía no existen:

- identificar qué falta;
- definir el contrato necesario;
- utilizar mocks únicamente durante desarrollo;
- mantenerlos aislados;
- sustituirlos posteriormente por datos reales.

---

# 30. Backend

La UI no debe ser independiente del backend.

Cada capacidad importante debe tener una relación:

```
UI
↓
API / SERVICE
↓
BACKEND
↓
DATABASE / EVENT / RUNTIME
```

Antes de crear algo nuevo debe comprobarse si ya existe:

- endpoint;
- servicio;
- evento;
- tabla;
- modelo;
- estado;
- sistema realtime.

No duplicar sistemas existentes.

---

# 31. Tiempo real

Siempre que sea posible, utilizar información realtime para:

- actividad;
- agentes;
- progreso;
- estados;
- mensajes;
- eventos;
- tareas;
- tiendas;
- conexiones.

Preferir mecanismos existentes antes de crear sistemas paralelos.

---

# 32. Seguridad

La UI nunca debe ser la única barrera de seguridad.

Las operaciones sensibles deben comprobar permisos en backend.

Especialmente:

- eliminar agentes;
- eliminar salas;
- cambiar permisos;
- modificar conexiones;
- cambiar autonomía;
- detener sistemas;
- ejecutar acciones externas.

Las acciones importantes deben quedar auditadas.

---

# 33. Accesibilidad

La interfaz debe seguir siendo usable aunque existan elementos visuales complejos.

Debe existir:

- contraste suficiente;
- estados no dependientes únicamente del color;
- targets clickables claros;
- feedback visual;
- navegación comprensible.

---

# 34. Rendimiento

El mapa puede contener muchos elementos.

La implementación debe considerar:

- renderizado eficiente;
- agentes;
- animaciones;
- partículas;
- overlays;
- paneles;
- realtime.

No sacrificar rendimiento por efectos visuales innecesarios.

---

# 35. Qué NO debe hacer la interfaz

NO:

- convertir todo en tablas;
- convertir todo en dashboard;
- ocultar el mapa al abrir cualquier panel;
- crear páginas independientes para cada sala sin necesidad;
- llenar cada pantalla de información;
- utilizar animaciones sin propósito;
- inventar datos reales;
- mostrar credenciales;
- duplicar configuraciones;
- crear sistemas paralelos de agentes;
- crear sistemas paralelos de memoria;
- crear sistemas paralelos de eventos;
- crear APIs duplicadas;
- hacer que botones importantes no hagan nada;
- ocultar errores;
- modificar configuraciones críticas silenciosamente.

---

# 36. Regla de simplicidad

La interfaz puede ser técnicamente muy compleja por debajo.

Pero para el usuario debe ser sencilla.

La pregunta principal siempre debe ser:

> "¿Qué necesita saber o hacer el usuario ahora?"

No mostrar toda la complejidad interna simultáneamente.

La información avanzada debe aparecer bajo demanda.

---

# 37. Jerarquía de información

La interfaz debe priorizar:

### Nivel 1 — ¿Está todo bien?

Estado global.

### Nivel 2 — ¿Qué está pasando?

Actividad.

### Nivel 3 — ¿Quién lo está haciendo?

Agente.

### Nivel 4 — ¿Qué está haciendo?

Tarea.

### Nivel 5 — ¿Qué resultado ha producido?

Resultado.

### Nivel 6 — ¿Necesito intervenir?

Acción requerida.

---

# 38. Filosofía visual

Hokage OS debe transmitir la sensación de:

> "Tengo un pequeño mundo trabajando para mí."

No:

> "Estoy mirando una aplicación de gestión."

El usuario debe poder entrar en el sistema, mirar el mapa y entender visualmente que:

- los agentes existen;
- trabajan;
- colaboran;
- producen resultados;
- se comunican;
- las salas tienen funciones;
- el sistema está vivo.

---

# 39. Relación entre mapa y paneles

La regla general es:

```
MAPA
  ↓
SALA
  ↓
PANEL
  ↓
ACTIVIDAD
  ↓
DETALLE
  ↓
ACCIÓN
```

Ejemplo:

```
Mapa
 ↓
Labs Uchiha
 ↓
Investigación
 ↓
Hallazgo
 ↓
Revisar
 ↓
Aprobar
```

El usuario nunca debe perder completamente el contexto.

---

# 40. Experiencia ideal

Una experiencia ideal sería:

1. El usuario abre Hokage OS.
2. Ve el mapa.
3. Observa agentes trabajando.
4. Ve actividad en las salas.
5. Detecta una alerta.
6. Hace click en una sala.
7. Se abre el panel de la sala.
8. Ve qué está ocurriendo.
9. Selecciona un agente.
10. Ve su actividad.
11. Abre la reunión.
12. Observa la coordinación.
13. Interviene si es necesario.
14. Vuelve al mapa.
15. Abre Hokage.
16. Pregunta qué queda pendiente.
17. Hokage responde con el estado real.
18. El usuario toma una decisión.

La experiencia debe ser continua.

---

# 41. Principio arquitectónico

Esta especificación define la experiencia visual.

No autoriza a crear una arquitectura paralela.

La implementación debe respetar los principios arquitectónicos existentes de Hokage OS, especialmente:

- configuración declarativa;
- Registry;
- separación entre motor y configuración;
- agentes configurables;
- Hermes como runtime;
- Hokage como orquestador;
- memoria/contexto;
- eventos;
- ECS del mapa;
- sistemas existentes.

Cuando una necesidad visual requiera una nueva capacidad backend:

1. identificar primero si ya existe;
2. reutilizarla si existe;
3. extenderla si es necesario;
4. crear una nueva capacidad únicamente cuando esté justificado.

---

# 42. Regla de fuente de verdad

Este documento define:

- experiencia;
- navegación;
- composición;
- comportamiento esperado;
- información visible;
- interacciones.

La arquitectura técnica define:

- cómo se implementa;
- dónde viven los datos;
- qué servicios existen;
- qué APIs se utilizan;
- cómo se sincroniza.

Si existe conflicto entre estética y arquitectura:

**la arquitectura no se rompe para conseguir una maqueta visual.**

La solución debe adaptar la UI a la arquitectura o evolucionar la arquitectura deliberadamente.

---

# 43. Decisiones pendientes

Estas decisiones pueden concretarse durante implementación:

- estética visual final;
- paleta;
- tipografía definitiva;
- assets;
- modelos 3D/2D;
- sprites;
- animaciones concretas;
- sonidos;
- diseño exacto de cada ventana;
- tamaños exactos;
- responsive detallado;
- tecnología concreta para determinadas visualizaciones;
- componentes específicos.

Estas decisiones deben tomarse manteniendo la visión definida aquí.

---

# 44. Estado del documento

**Estado:** Fuente de verdad de UX/UI.

**Objetivo:** Guiar el diseño e implementación de la interfaz completa de Hokage OS.

**No es:** una especificación técnica de implementación.

**Siguiente paso:** convertir esta visión en un plan técnico de implementación basado en la arquitectura y código real del proyecto.