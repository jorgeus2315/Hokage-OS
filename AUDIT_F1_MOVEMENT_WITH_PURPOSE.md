# Auditoría Técnica F1: Movement with Purpose

**Fecha:** 2026-09-02  
**Fase:** F1 — Movement with Purpose (Fase 4.3 del Roadmap)  
**Alcance:** Verificación completa de los 8 componentes implementados según spec + invariantes de diseño

---

## Resumen Ejecutivo

| Estado | Componente |
|--------|------------|
| ✅ Implementado y verificado | 7/8 componentes core |
| ❌ **CRÍTICA: Cableado faltante** | `WorldCanvas.tsx` no registra personajes en `BehaviorSystem` |

**Conclusión:** La arquitectura está **diseñada correctamente** (BehaviorSystem como única autoridad, WorldModelClient como fuente de verdad, EventAdapter separado, orden ECS correcto, tests pasando). Sin embargo, **existe un GAP CRÍTICO de cableado** que hace que todo el sistema de "movement with purpose" esté **desactivado en producción**: los tokens se mueven solo porque `WorldCanvas` llama `engine.setTarget()` con posiciones iniciales de órbita del hub, no porque `BehaviorSystem` calcule targets basados en `AgentRuntimeState`.

---

## Verificación por Requisito

### 1. BehaviorSystem como ÚNICA autoridad de `Motion.target` ✅ ARQUITECTURA CORRECTA

**Evidencia:** `frontend/src/world/systems/BehaviorSystem.ts:95-114`

```typescript
update(ctx: WorldContext, _dt: number): void {
  this.updateHubPosition();
  for (const ecsEntityId of ctx.components.getEntitiesWith(ComponentKinds.Motion)) {
    const mapping = this.characterMappings.get(ecsEntityId);
    if (!mapping) continue; // Not a character we track
    const motion = ctx.components.getComponent<MotionComponent>(ecsEntityId, ComponentKinds.Motion);
    if (!motion) continue;
    const target = this.calculateTarget(mapping.agentId, mapping.characterEntity);
    if (target) {
      motion.target.x = target.x;  // MUTA EN LUGAR — única escritura a Motion.target
      motion.target.y = target.y;
    }
  }
}
```

- ✅ No hay `Math.random`, timers, heurísticas
- ✅ Solo usa `AgentStateStore` (backend state) + `WorldModelClient` (world model)
- ✅ `calculateTarget()` es función pura: `state + worldModel → target`

### 2. Sin movimiento decorativo ✅ CUMPLIDO EN CÓDIGO

- `useWorldState.ts:223-226` comenta explícitamente: *"Token targets are now determined by BehaviorSystem... No atHub, no roomWander, no Math.random, no timers"*
- `MovementSystem.ts` (líneas 1-50): interpola pura hacia `target` (EASE=0.06, TRAIL_EVERY=5, TRAIL_MAX=7)
- `BehaviorSystem` cubre **todos los estados**: WORKING→room, IDLE/COMPLETED→hub, ERROR→room/hub, resto→hub (conservativo)

### 3. Flujo de estado completo: Backend → WS → AgentStateStore → BehaviorSystem → Motion.target ✅

| Paso | Archivo | Verificado |
|------|---------|------------|
| Backend emite `agent.state.changed` | `backend/src/config/agentRuntime.ts` | ✅ |
| WS `initial_snapshot.agent_states` | `backend/src/server.ts:198-200` | ✅ |
| WS delta `agent.state.changed` | `backend/src/server.ts:226-228` | ✅ |
| Frontend `useAppData` hidrata `AgentStateStore` | `frontend/src/hooks/useAppData.ts:108-110, 132-134` | ✅ |
| `AgentStateStore` deduplica por signature | `frontend/src/world/state/AgentStateStore.ts:21-29` | ✅ |
| `BehaviorSystem` lee `agentStateStore.get()` | `frontend/src/world/systems/BehaviorSystem.ts:44` | ✅ |
| `BehaviorSystem` muta `Motion.target` | `frontend/src/world/systems/BehaviorSystem.ts:107-112` | ✅ |

### 4. WorldModelClient como ÚNICA fuente de verdad del world model ✅

- Hidratado desde `initial_snapshot.world_entities` + `world_relations` en `useAppData.ts:123-125`
- Métodos de acceso: `getRoomForCharacter()`, `getHomeRoomForCharacter()`, `getHub()`, `getPosition()`, `getCharacterForAgent()`
- Filtro por `ventureId` implementado y testeado (`BehaviorSystem.test.ts:324-359`)
- No hay layout logic, no hay derivación — solo data access

### 5. Mapeo correcto agent↔character↔room ✅

| Relación | Implementación | Test |
|----------|----------------|------|
| agent → character | `WorldEntityDto` con `refKind='agent'`, `refId=agentId` | `WorldModelClient.getCharacterForAgent()` |
| character → room (works_in) | `WorldRelationDto` kind='works_in' | `WorldModelClient.getRoomForCharacter()` |
| character → room (homeRoom) | `attributes.homeRoom` en character entity | `WorldModelClient.getHomeRoomForCharacter()` |
| homeRoom precedence | `BehaviorSystem:56-58` usa `homeRoom ?? works_in` | Test línea 361-381 |

### 6. Aislamiento por venture ✅

- `WorldModelClient.hydrate()` filtra entidades por `ventureFilter` (líneas 55-58)
- `BehaviorSystem.calculateTarget()` filtra room por `ventureId` (líneas 61-63)
- Tests verifican aislamiento: `BehaviorSystem.test.ts:324-359`, `etsyTools.test.ts:303, 308`

### 7. Todos los estados manejados ✅

| Estado | Target | Test |
|--------|--------|------|
| WORKING | room asignada | ✅ línea 206-215 |
| IDLE | hub | ✅ línea 217-225 |
| COMPLETED | hub | ✅ línea 227-235 |
| ERROR | room (si tiene) / hub | ✅ línea 237-279 |
| THINKING/RESEARCHING/WAITING/REVIEWING/COMMUNICATING/MOVING | hub (conservativo) | ✅ línea 281-292 |
| Sin estado | hub (default seguro) | ✅ línea 294-301 |

### 8. Hidratación en reconexión ✅

- `initial_snapshot` incluye `world_entities`, `world_relations`, `agent_states` (server.ts:190-192, 198-200)
- `useAppData` hidrata `WorldModelClient` y `AgentStateStore` desde snapshot (líneas 122-125, 108-110)
- Deduplicación por signature evita re-procesamiento

### 9. EventAdapter separado del ECS ✅

- `frontend/src/world/events/EventAdapter.ts` traduce eventos backend → `WorldCommand` (move_to_room, return_to_hub, set_home_room, ripple)
- No toca componentes ECS directamente — solo emite comandos que el bridge/ECS consume
- `WorldEngineBridge.dispatch()` encola comandos → `WorldEngine.tick()` los entrega a systems

### 10. Orden de sistemas ECS ✅

`WorldEngineBridge.ts:88-94`:
```typescript
this.ecs.addSystem(this.behavior);   // 1º — decide target
this.ecs.addSystem(this.movement);   // 2º — interpola hacia target
this.ecs.addSystem(this.renderSync); // 3º — sincroniza visuals
this.ecs.addSystem(this.animation);  // 4º — anima refs Pixi
```
**Correcto:** Behavior ANTES de Movement → target listo antes de interpolar.

### 11. Tests que prueban invariantes ✅

11 tests en `BehaviorSystem.test.ts` cubren:
- Transiciones de estado (WORKING/IDLE/COMPLETED/ERROR/default)
- Venture filter
- Home room precedence
- Determinismo (10 iteraciones mismo resultado)
- Unregister character
- **Todos pasan** (11/11)

---

## HALLADO CRÍTICO: Cableado Faltante en WorldCanvas.tsx

### El Problema

`WorldCanvas.tsx` **nunca llama** a `engine.registerCharacter(ecsEntityId, characterEntity, agentId)`.

**Código actual (líneas 300-313):**
```typescript
for (const tk of tokens) {
  seenTokens.add(tk.id);
  const color = tk.color;
  const node = engine.get(tk.id);
  if (!node) {
    engine.upsert(tk.id, { x: tk.x, y: tk.y }, color, tk.label);  // Crea entidad ECS
  } else {
    engine.setTarget(tk.id, { x: tk.x, y: tk.y });  // SOBRESCRIBE target manualmente
    node.color = color;
    node.label = tk.label;
  }
  engine.ensureTokenVisual(tk.id, color, tk.label);
  engine.setSelectable(tk.id, tk.onClick);
}
```

**Lo que FALTA:**
```typescript
// Después de upsert(), ANTES de setTarget():
const characterEntity = worldModelClient.getCharacterForAgent(Number(tk.id));
if (characterEntity) {
  engine.registerCharacter(tk.id, characterEntity, Number(tk.id));
}
```

### Consecuencias

| Lo que pasa hoy | Lo que DEBERÍA pasar |
|-----------------|---------------------|
| `engine.setTarget()` usa posiciones de `useWorldState` (hub orbit inicial) | `BehaviorSystem` calcula target basado en `AgentRuntimeState` |
| Tokens orbitan hub **siempre** (posición inicial nunca cambia) | WORKING→room, IDLE→hub, ERROR→room |
| `characterMappings` en BehaviorSystem está **vacío** | `characterMappings` poblado → `calculateTarget()` se ejecuta |
| Movimiento "funciona" visualmente pero **no refleja estado real** | Verdad visual: posición = estado real del agente |

### Por qué no se detectó antes

1. Los tests de `BehaviorSystem` **sí llaman** `system.registerCharacter()` en `beforeEach` (líneas 194-197)
2. `WorldCanvas` usa `engine.upsert()` + `engine.setTarget()` (API legacy Fase 1) que **bypassa** BehaviorSystem
3. Visualmente los tokens aparecen en pantalla y se interpolan (MovementSystem funciona), pero el **origen del target es erróneo**

### Clasificación: **CRÍTICA**

- Viola **I2: Verdad Visual** — movimiento no traza a hechos reales del sistema
- Viola requisito explícito: *"BehaviorSystem as sole Motion.target authority"*
- Hace que **todo el trabajo de F1 esté inactivo en producción**
- Riesgo: comportamiento divergente entre tests (pasan) y app real (fallan silenciosamente)

---

## Riesgos Adicionales (MEDIA/BAJA)

### MEDIA: `useWorldState` sigue calculando `isWorking` localmente (línea 177)
```typescript
const isWorking = (agentId: number) => agentStates[agentId]?.primary === 'WORKING';
```
- Debería usar `agentStateStore.get(agentId)?.primary` para consistencia
- Hoy usa `agentStates` prop (snapshot REST) que puede estar desfasado vs `AgentStateStore` (WS deltas)

### MEDIA: `WorldCanvas` pasa `tokens` con `working: boolean` derivado localmente (línea 246)
- `token.working` se usa solo para visuals (anillo pulsante, minimapa) — no para movimiento
- Pero crea duplicación de lógica de estado

### BAJA: `WorldCanvas` no limpia `characterMappings` al remover tokens
- `engine.remove()` llama `behavior.unregisterCharacter()` (Bridge:139) — **esto SÍ está bien**
- Verificar que `remove()` se llama cuando token desaparece (líneas 315-318)

---

## Plan de Corrección

### Mínimo (Fix CRÍTICO)

En `WorldCanvas.tsx`, dentro del bucle de tokens (tras `upsert`):

```typescript
// Registrar personaje para BehaviorSystem — F1: Movement with Purpose
const characterEntity = worldModelClient.getCharacterForAgent(Number(tk.id));
if (characterEntity) {
  engine.registerCharacter(tk.id, characterEntity, Number(tk.id));
}
```

### Recomendado (Limpieza)

1. Eliminar `engine.setTarget(tk.id, { x: tk.x, y: tk.y })` — BehaviorSystem ya muta target
2. Usar `agentStateStore` en vez de `agentStates` prop para `isWorking`/`calcActivityLevel`
3. Añadir test de integración que verifique: agent WORKING → token se mueve a room

---

## Verificación Post-Fix

```bash
# 1. Build
cd frontend && npm run build

# 2. Tests
npx vitest run

# 3. Manual: iniciar backend + frontend
# - Poner agente en WORKING (via /api/agents/:id/run)
# - Verificar en mapa: token sale de órbita hub → va a su sala
# - Poner agente en IDLE → token regresa a hub
```

---

## Archivos Auditados

| Archivo | Estado |
|---------|--------|
| `frontend/src/world/systems/BehaviorSystem.ts` | ✅ Correcto |
| `frontend/src/world/systems/BehaviorSystem.test.ts` | ✅ 11 tests pasan |
| `frontend/src/world/client/WorldModelClient.ts` | ✅ Correcto |
| `frontend/src/world/state/AgentStateStore.ts` | ✅ Correcto |
| `frontend/src/world/events/EventAdapter.ts` | ✅ Correcto |
| `frontend/src/world/WorldEngineBridge.ts` | ✅ Orden ECS correcto |
| `frontend/src/hooks/useWorldState.ts` | ✅ Sin movimiento decorativo |
| `frontend/src/hooks/useAppData.ts` | ✅ Hidratación correcta |
| `backend/src/server.ts` | ✅ Snapshot incluye world model |
| `frontend/src/world/WorldCanvas.tsx` | ❌ **FALTA registerCharacter()** |
| `frontend/src/world/systems/MovementSystem.ts` | ✅ Interpolación pura |
| `frontend/src/world/ecs/WorldEngine.ts` | ✅ Tick ordenado |

---

## Conclusión

**La arquitectura F1 es sólida y correcta.** El diseño cumple todos los principios: BehavioralSystem como única autoridad, WorldModelClient como verdad, sin movimiento decorativo, venture isolation, estado completo, reconexión, EventAdapter separado, orden ECS, tests.

**Pero el cableado final en WorldCanvas.tsx está roto.** Sin `registerCharacter()`, el BehaviorSystem no tiene mapeos de personajes y no puede funcionar. El movimiento actual es **puramente decorativo** (hub orbit estático + interpolación hacia posiciones iniciales), violando el principio fundacional de "Verdad Visual".

**Acción requerida:** Añadir 3 líneas en `WorldCanvas.tsx` para registrar personajes. Luego verificar end-to-end que WORKING→room, IDLE→hub funciona con agentes reales.