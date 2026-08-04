> 🔒 **CONGELADO — arquitectura completa, capa puramente cosmética.** Décimo sistema de la fase de diseño, cierra (junto a [[Crecimiento de la Ciudad - World Engine]]) la arquitectura del World Engine antes de continuar el frontend, decisión de Jorge 2026-08-05.

## Por qué importa

[[VISION|VISION.md]] pide una ciudad viva; un ciclo día/noche con clima y estaciones es parte de esa ambición. Pero el principio rector (§0, [[Frontend World Engine]]) es estricto: *"si algo se mueve en la interfaz es porque un evento del backend dijo que se moviera"*, con una única excepción cosmética ya aceptada — el deambular ocioso de un agente sin tarea. El ciclo día/noche se diseña como una segunda excepción cosmética de la misma familia, nunca como estado de negocio.

## Principio de diseño — capa ambiental, aislada del Event Adapter y del Animation Director

El ciclo día/noche vive en un **`AmbientSystem`** nuevo dentro del World Engine, al mismo nivel que `MovementSystem`/`AnimationSystem`/`ParticleSystem`/`TTLSystem` ya definidos en [[Frontend World Engine|§2.1]] — pero con una diferencia estructural explícita: **nunca recibe `WorldCommand`s del Event Adapter.** Los demás Systems reaccionan a eventos reales del backend; `AmbientSystem` reacciona únicamente a su propio reloj interno. Esto no es una omisión — es la garantía de que "es de noche" jamás se confunda con "el backend dijo que es de noche", porque el backend no sabe que esto existe.

```text
World Engine (tick ~60/s)
 ├── EntityStore
 ├── Systems (en orden)
 │    1. IntentSystem        aplica WorldCommands (eventos reales del backend)
 │    2. MovementSystem
 │    3. AnimationSystem
 │    4. ParticleSystem
 │    5. TTLSystem
 │    6. AmbientSystem       ← nuevo, NUNCA lee WorldCommands, solo su propio reloj
 └── snapshot()
```

## `AmbientClockProvider` — mismo patrón de proveedor intercambiable que Secretos, Finanzas y Voz

```typescript
// world/ambientProvider.ts
interface AmbientState {
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night';
  progress: number;        // 0-1 dentro de la fase actual, para transiciones suaves
  weather?: 'clear' | 'rain' | 'snow' | 'fog';
  season?: 'spring' | 'summer' | 'autumn' | 'winter';
  specialEvent?: string;   // hueco reservado, sin valor en v1
}

interface AmbientClockProvider {
  id: string;  // 'real-clock' | 'simulated-clock' | ...
  getState(): AmbientState;
}
```

`RealClockProvider` (única implementación en v1): mapea la hora real del sistema a `timeOfDay` (amanecer/día/atardecer/noche por franja horaria) y opcionalmente estación por fecha real. Un `SimulatedClockProvider` futuro (tiempo acelerado, ciclo corto para demos) implementa la misma interfaz sin que `AmbientSystem` ni el Renderer cambien una línea — exactamente la misma garantía de sustituibilidad que [[Gestión de Secretos y Capabilities|SecretProvider]], [[Economía v2 - Sistema Financiero|FinanceProvider]] y [[Arquitectura de Voz - Hermes|SttProvider/TtsProvider]] ya demostraron en esta ronda de diseño. Clima y eventos especiales quedan como campos reservados en `AmbientState` sin proveedor real en v1 — mismo principio de "hueco dejado, no construido preventivamente" que el resto del documento.

## Renderizado — reutiliza mecanismos existentes, no inventa nuevos

- **Iluminación dinámica:** un filtro de color global sobre `WorldCanvas` (tipo `ColorMatrixFilter` de PixiJS) que interpola entre paletas día/noche según `progress` — una capa de composición, no un componente nuevo por entidad.
- **Ventanas de edificios que se iluminan de noche:** estado puramente visual por departamento, **desacoplado del componente `Status` real** (que sigue reflejando idle/working/error del backend) — nunca se mezclan los dos conceptos de "iluminado".
- **Clima:** reutiliza el `ParticleSystem` ya existente (lluvia/nieve como partículas), mismo mecanismo que ya sirve para las partículas de moneda de ventas — ninguna infraestructura nueva de partículas.
- **Eventos estacionales:** hueco en `AmbientState.specialEvent`, sin implementación — activable más adelante (p.ej. decoración de fin de año) sin rediseñar el sistema.

## Activable/desactivable sin afectar al resto del sistema

`AmbientSystem` se controla con un flag simple (`ENABLE_AMBIENT_CYCLE`, mismo espíritu que el patrón de feature-flag/canary ya usado en [[Plugin System - Arquitectura Completa|§7]]). Desactivado: `WorldCanvas` renderiza con iluminación neutra fija, exactamente el comportamiento de hoy — cero efecto en `MovementSystem`, `AnimationSystem`, `ParticleSystem`, Event Adapter, o cualquier lógica de agentes. La garantía dura, explícita: **ningún System de negocio lee `AmbientState`, y `AmbientSystem` no escribe en ningún componente que otro System lea.** Es una capa de solo-render, sin acoplamiento.

## Consecuencias a 2-3 años

El ciclo día/noche puede evolucionar de "tinte de color por hora real" a "clima real vía API + eventos estacionales editoriales" sin tocar el backend ni el Event Adapter — cada mejora es una implementación nueva de `AmbientClockProvider` o una extensión de `AmbientState`, nunca un cambio de arquitectura. El riesgo conocido y aceptado: si en el futuro alguien intenta "colgar" lógica de negocio real del ciclo ambiental (p.ej. "los agentes trabajan menos de noche"), eso rompe la separación deliberada de esta nota — se anota aquí explícitamente como algo que **no debe pasar** sin una decisión de arquitectura nueva y consciente, igual que Claude (§9.2) no se automatiza sin su propia sección dedicada.

---

## Relacionado

- [[Frontend World Engine]]
- [[Crecimiento de la Ciudad - World Engine]]
- [[Frontend - Decisiones v2]]
- [[Gestión de Secretos y Capabilities]]
- [[Economía v2 - Sistema Financiero]]
- [[Arquitectura de Voz - Hermes]]
- [[INDEX]]
