> 📏 **Línea base para validar cada fase de [[Plan de Migración ECS]].** Extraída línea a línea del código real el 2026-08-05, antes de tocar nada. Cada fase futura se valida comparando contra estos números exactos — si algo cambia sin que la fase lo pidiera explícitamente, es una regresión, no una mejora.

## Movimiento

- Interpolación lerp: `pos += (target - pos) * EASE`, `EASE = 0.06`, aplicado cada frame del ticker de Pixi (no escalado por delta-time — depende del framerate real).
- Trail: se registra un punto cada `TRAIL_EVERY = 5` frames, máximo `TRAIL_MAX = 7` puntos guardados, los más viejos se descartan (`shift()`).
- Deambular ocioso (agente sin tarea): dos mecanismos independientes en `useWorldState.ts`, **ambos vía `setInterval`, uno por agente**:
  - `atHub`: cada `4000 + stagger` ms (`stagger = 2500 + (agentId*733) % 4000`), decide aleatoriamente (`Math.random() < 0.5`) si el agente vuelve al hub o se queda en su sala — salvo que esté `working`, en cuyo caso siempre `false`.
  - `roomWander`: cada `3200 + (agentId*613) % 2800` ms, genera un offset aleatorio `{dx: ±30, dy: ±14}` sobre la posición base de la sala.
- Posición "en el hub": órbita circular, radio `TOKEN_ORBIT = 220`, ángulo `idx * (360/N) + 20` grados sobre `WORLD_CENTER = {1000, 1000}`.

## Selección (click)

- No hay estado de selección ni hover — un click en hub/sala/token dispara directamente su `onClick` (navegación), sin resaltado visual de "seleccionado".
- Mecanismo: `container.eventMode = 'static'`, `pointertap` listener, callback guardado como `__onClick` vía `Object.assign` sobre el container Pixi, reasignado cada frame del ticker (siempre el callback más reciente de las props).
- Hit area: hub = círculo radio 72; sala = rectángulo `154×104` (`RW×RH`); token = círculo radio `13*2.2 = 28.6`.

## Cámara

- Pan: arrastre con umbral `PAN_THRESHOLD = 4px` antes de empezar a mover — evita que un click se interprete como pan accidental.
- Zoom: rueda del ratón, `ZOOM_MIN = 0.25`, `ZOOM_MAX = 2.5`, `ZOOM_STEP = 0.1` (multiplicativo sobre la escala actual), **anclado al cursor** (el punto bajo el ratón no se mueve al hacer zoom).
- Encuadre inicial (`fitScene`): calcula bounding box de hub+salas con margen `140px`, escala para que quepa en pantalla con un tope de `1.4×` (nunca hace zoom-in más allá de eso al encuadrar).

## Animaciones (fórmulas exactas, todas `t = performance.now()/1000`)

| Elemento | Fórmula | Notas |
|---|---|---|
| Glow del hub | `0.45 + 0.55*sin(t*1.3)` | alpha |
| `alertDot` de sala (decisión pendiente) | `0.6 + 0.4*sin(t*5)` | alpha, solo si `pending` |
| `activeDot` de sala (agente activo) | `0.6 + 0.4*sin(t*4+1)` | alpha, solo si `active` |
| Glow exterior de sala — activa | `activityLevel * (0.55 + 0.45*sin(t*1.8))` | |
| Glow exterior de sala — con error | `0.3 + 0.2*sin(t*4)`, tint ámbar | |
| Glow exterior de sala — pendiente | `0.35 + 0.25*sin(t*2.5)` | |
| Glow exterior de sala — idle | `max(0.04, activityLevel*0.6)` | sin pulso, estático |
| Fill interior de sala — activa | `0.7 + 0.3*sin(t*2.2)` | |
| Barra de actividad (bottom bar) — activa | ancho `= barW * (0.3 + 0.7*abs(sin(t*0.4 + hash(id)*π)))` | |
| Pulse ring de sala (pendiente/error) | escala `1 + sin(t*2.8)*0.02`, alpha `0.28 + 0.18*sin(t*2.8)` | |
| Ring de token — `justActed` | alpha `0.5+0.4*fp`, escala `0.85+0.3*fp` donde `fp = 0.5+0.5*sin(t*9)`, tint ámbar | anillo exterior con fórmula espejada, tint ember |
| Ring de token — `working` | alpha `0.2+0.28*sp`, escala `0.88+0.18*sp` donde `sp = 0.5+0.5*sin(t*3.2)`, tint ember | |
| Scan line | periodo `12s`, barrido de `hub.x-700` a `hub.x+700`, dos trazos (alpha 0.025 y 0.045) | puramente decorativo, no ligado a ninguna entidad |

## Renderizado (z-order y capas)

Orden real de `addChild` sobre el container `world` (determina qué se dibuja encima de qué, hoy **implícito por orden de inserción, sin `zIndex`**):

1. `gridGfx` (rejilla de fondo)
2. `trailGfx` (estelas de movimiento)
3. `scanGfx` (línea de escaneo)
4. `rippleGfx` (ondas de eventos)
5. `orbit` (elipse orbital del hub)
6. `spokes` (líneas + pulsos de datos hub↔sala)
7. `hubContainer`
8. Salas (`roomGfx`, añadidas dinámicamente conforme llegan en `rooms[]`)
9. Tokens (`tokenGfx`, añadidos dinámicamente conforme llegan en `tokens[]`)

Minimapa: contenedor aparte (`minimapContainer`), esquina inferior derecha, `150×110px`, padding `12px`, refleja hub/salas/tokens con la misma paleta de color, más un rectángulo de viewport.

## Efectos (partículas / ripples)

- **Data pulses en spokes** (procedurales, sin ciclo de vida — se recalculan cada frame desde `t`): salas activas = 4 paquetes a velocidad `0.28`; salas idle = 2 paquetes a velocidad `0.16`. Posición = interpolación lineal hub→sala con `progress = (t*speed + hash(roomId) + p/numPackets) % 1`; tamaño y alpha siguen `sin(progress*π)`.
- **Ripples** (con ciclo de vida real): se spawean al detectar un `RippleEvent` nuevo (dedup por `id`), duran `1800ms`, dos anillos escalonados por `0.28` de edad relativa, color según tipo de evento (`error`→ember, `done`→signal, resto→amber). Se destruyen (`splice`) al llegar a `age >= 1`.

## Colores (paleta usada por el World Engine — no confundir con el design system general)

```
void 0x0a0b0d · panel 0x12141a · line 0x1e2229 · ember 0xe8432d · emberDim 0x7a2418
signal 0x4fd1c5 · amber 0xf0a93b · good 0x3ecf6a · ink 0xe8e6e1 · inkFaint 0x4a4d53 · inkDim 0x8a8d93
```

---

## Cómo usar este documento

Después de cada fase del [[Plan de Migración ECS]], recorrer esta lista y confirmar visualmente que cada número/fórmula se sigue cumpliendo exactamente. Si una fase cambia intencionadamente algo de aquí (no debería, salvo excepción ya documentada en el plan), este documento se actualiza en el mismo commit — nunca queda desincronizado del comportamiento real.

## Relacionado

- [[Plan de Migración ECS]]
- [[Frontend World Engine]]
- [[INDEX]]
