> **Snapshot histórico de sesión, no estado vigente.** Migrado desde `handoff.md` (raíz del repo) — Fase 8 de la migración documental, 2026-08-05.
>
> Log de desarrollo de una sesión concreta (Goal System) — commits, bugs encontrados/corregidos, variables de entorno del momento. Valor real y vigente: **Etsy y VPS seguían sin conectar entonces y siguen sin conectar hoy** (ver [[Escalabilidad]], [[Seguridad, Permisos y VPS]]) — el resto (bugs de CSS/debounce puntuales, comandos de esa sesión) es histórico, sin acción pendiente asociada hoy.

---

# Handoff — Hokage OS

Última actualización: 2026-08-03

---

## Objetivo del proyecto

Hokage OS es el compañero intelectual de Jorge para construir y gestionar empresas digitales.
No es un dashboard ni un asistente. Es un sistema que piensa con Jorge, cuestiona sus ideas,
ejecuta mediante agentes autónomos y solo interrumpe cuando necesita una decisión humana real.

Meta económica concreta: generar €1000/mes con Minimal Designs en Etsy.

---

## Estado actual — qué funciona

### Backend (localhost:3000)
- Express + SQLite + TypeScript corriendo con `tsx`
- 7 agentes ejecutándose en modo autónomo 24/7 (mientras el Mac esté encendido)
- Event Bus con 14 tipos de eventos registrados
- agentRuntime con 8 etapas FSM + scheduler por agente
- Pipeline automático: tendencia → contenido → decisión → Jorge aprueba → publicación
- Automations: reglas event-triggered entre agentes
- Ventures y Assets: estructura de negocio

### Goal System (completado y verificado en esta sesión)
- `POST /api/objectives` → Hokage descompone en JSON → plan + milestones guardados en BD
- `PUT /api/objectives/:id/plan/approve` → crea work_items para cada milestone
- agentRuntime ejecuta los work_items, cierra milestones, marca objetivo como `achieved`
- **Verificación real**: objetivo "1000€/mes con Minimal Designs" creado y marcado `achieved`
  con 12/12 milestones completados en la misma sesión

### Frontend (localhost:5173)
- React + Vite + TypeScript
- Screens: Boot → Menú → Mapa (PixiJS) → Building → Ship Comms → Ship Crew → Alertas → Ventures → Objetivos
- WebSocket conectado con snapshot inicial y eventos en tiempo real
- ObjectivesView: input terminal, fases expandibles, LEDs de estado, barra de confianza

---

## Archivos modificados en la última sesión

### Backend
| Archivo | Qué cambió |
|---------|-----------|
| `backend/src/server.ts` | Rutas Goal System: GET/POST /objectives, PUT /approve, PATCH |
| `backend/src/services/aiService.ts` | Nueva función `callAIJson()` para llamadas JSON directas sin prompt conversacional |
| `backend/src/config/eventBus.ts` | 3 nuevos tipos: `objective.created`, `objective.approved`, `objective.achieved` |
| `backend/src/config/agentRuntime.ts` | Stage3 incluye `milestone_id`; cierre automático de milestone y objetivo |
| `backend/src/db/init.ts` | Tablas `objectives`, `obj_plans`, `obj_milestones`; migración `milestone_id` en work_items |
| `backend/src/scripts/seed.ts` | Prompt Hokage reescrito: socio estratégico con criterio, no asistente |

### Frontend
| Archivo | Qué cambió |
|---------|-----------|
| `frontend/src/views/ObjectivesView.tsx` | Nueva vista completa del Goal System |
| `frontend/src/views/MapView.tsx` | Botón "Objetivos" en rail izquierdo con contador |
| `frontend/src/App.tsx` | Screen `objetivos` registrada; paso de props a MapView |
| `frontend/src/hooks/useAppData.ts` | `objectives` state + `loadObjectives` + WS handler |
| `frontend/src/shared/api.ts` | `objectives()`, `createObjective()`, `approvePlan()`, `updateObjective()`; PATCH añadido a métodos autenticados |
| `frontend/src/shared/types.ts` | Tipos `Objective`, `ObjPlan`, `ObjMilestone`, `ObjectiveStatus`, `MilestoneStatus` |
| `frontend/src/shared/icons.tsx` | `IconTarget` (concentric circles) |
| `frontend/src/styles.css` | `.hk-btn--ghost-signal` para botón Objetivos activo |

### Configuración
| Archivo | Qué cambió |
|---------|-----------|
| `CLAUDE.md` | Sección §0 nueva: Filosofía fundacional + 4 filtros de decisión obligatorios |
| `frontend/.env` | Creado con `VITE_ADMIN_TOKEN=hokage-local-dev` |
| `.gitignore` | Creado (asegurarse de que `.env` esté incluido antes de hacer push) |

---

## Lo que se intentó y falló

### Intento 1: askAgent() para descomposición
`askAgent(hokage.id, decompositionPrompt)` usaba el prompt conversacional de Hokage
("Eres el socio estratégico de Jorge...") junto con `max_tokens: 1200`.
La IA ignoraba la instrucción de responder solo JSON y añadía texto conversacional.
El parser extraía `{}` vacío → `planData.phases = []` → 0 milestones creados.

**Fix**: nueva función `callAIJson()` en aiService.ts con system prompt mínimo,
`max_tokens: 2000`, modelo `claude-haiku-4-5`, extracción robusta `{...}`.

### Intento 2: form_input para el campo de objetivos
`form_input(ref, value)` rellena el DOM pero no dispara el evento `onChange` de React.
El estado del componente no se actualiza → al enviar el formulario, `title` era vacío.

**Fix**: usar `triple_click` para enfocar + `computer.type()` para simular keystrokes reales.

### Intento 3: scroll nativo para APROBAR PLAN
El botón quedaba fuera del viewport por la longitud del card (12 milestones).
`computer.scroll()` timeout por el browser pane oculto.

**Fix**: `javascript_tool` con `button.scrollIntoView(); button.click()`.

### Bug que resultó ser falso
Se asumió que los roles de milestones ("investigador", "contenido") no coincidirían
con los roles de la BD. **Incorrecto**: los roles en BD son exactamente esos nombres
y el approve route los resuelve correctamente con `SELECT id FROM agents WHERE role = ?`.
El primer objetivo creado completó los 12/12 milestones en minutos.

---

## Problemas reales pendientes

### Crítico
1. **Scroll en ObjectivesView** — el TopBar se desplaza con el contenido en cards largas.
   El `hk-shell` necesita `overflow-y: auto` aislado de la TopBar.

2. **No hay retry si callAIJson falla** — si la IA devuelve null (timeout, error de red),
   el objetivo queda en estado `planning` sin plan y sin botón para reintentar.

3. **loadObjectives sin debounce** — se llama en cada evento WS. Con muchos eventos
   simultáneos genera 18 GETs seguidos y activa el rate limiter (429).

### Menor
4. `"1 activos"` — typo gramatical, debería ser `"1 activo"` (singular).
5. `max_tokens: 1200` en askAgent puede truncar respuestas largas silenciosamente.
6. Ship Comms sin paginación real (395 mensajes acumulados, el scroll es inútil).
7. `frontend/.env` debe añadirse al `.gitignore` antes de cualquier push a GitHub.

---

## Plan siguiente — por orden de impacto

### 1. Fix scroll ObjectivesView (20 min)
Problema de CSS puro. El card largo empuja el TopBar fuera del viewport.

### 2. Debounce en loadObjectives (15 min)
Limitar llamadas a máx 1 por segundo para evitar el 429 del rate limiter.

### 3. VPS Hetzner CX22 — requiere acción de Jorge
Jorge crea el servidor (hetzner.com, Ubuntu 24.04, CX22, ~4€/mes).
Una vez creado: PM2 + Nginx + Let's Encrypt + deploy completo en una sesión.
Sin esto, los agentes solo corren con el Mac encendido.

### 4. Etsy API (Fase 6) — requiere credenciales de Jorge
Registrar app en developers.etsy.com → OAuth v3 → ETSY_CLIENT_ID + ETSY_CLIENT_SECRET en .env.
Con esto: Finanzas lee ventas reales, Explorador detecta tendencias de productos reales.

### 5. Notificaciones Telegram (Fase 9)
BotFather → token → TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID en .env.
Hokage manda mensaje cuando hay decisión pendiente o milestone completado.

---

## Variables de entorno necesarias

### Backend (`backend/.env`)
```
PORT=3000
OPENROUTER_API_KEY=sk-or-v1-...
AI_MODEL=anthropic/claude-haiku-4-5
ADMIN_TOKEN=hokage-local-dev
```

### Frontend (`frontend/.env`)
```
VITE_ADMIN_TOKEN=hokage-local-dev
```

### Pendientes para producción
```
FRONTEND_URL=https://hokage.tudominio.com
ETSY_CLIENT_ID=...
ETSY_CLIENT_SECRET=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

---

## Comandos útiles

```bash
# Arrancar backend
cd backend && npx tsx src/server.ts

# Arrancar frontend
cd frontend && npx vite

# Verificar compilación TypeScript
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit

# Ver estado de la BD
sqlite3 backend/data/hokage-os.db "SELECT id, title, status FROM objectives;"
sqlite3 backend/data/hokage-os.db "SELECT COUNT(*), status FROM obj_milestones GROUP BY status;"

# Ver logs del agentRuntime en vivo
# (se muestran en la terminal donde corre el backend)
```

---

## Arquitectura de datos del Goal System

```
objectives
  └── obj_plans (1:1 por objetivo activo)
        └── obj_milestones (N por plan)
              └── work_items.milestone_id (FK)
                    └── agent_id → agents.role → agentRuntime lo ejecuta
```

Flujo:
1. Jorge escribe objetivo en lenguaje natural
2. `callAIJson()` → Hokage devuelve JSON con fases y milestones
3. Plan + milestones guardados en BD (`status: proposed`)
4. Jorge aprueba → work_items creados (`priority: 8`, `milestone_id` seteado)
5. agentRuntime ejecuta work_items en stage3
6. Al completar: milestone → `done`, si todos → objetivo → `achieved`
7. WS broadcast `objective.achieved` → frontend actualiza

---

## Relacionado

- [[Roadmap - Snapshot 2026-08-02]]
- [[Goal System]]
- [[Seguridad, Permisos y VPS]]
- [[INDEX]]
