# HOKAGE OS — Migration & Deployment Spec (Local → VPS → Escala)

> Categoría: **documento arquitectónico de subsistema** — puesta en producción y escalado.
> Estado: 🆕 Vigente (2026-08-13). Documento **E** de la preparación maestra. Deep-dive de [[HOKAGE_OS_MASTER_SPEC]] §20, reconcilia [[Seguridad, Permisos y VPS]] y [[Escalabilidad]] bajo la estrategia por etapas.
> Fuentes de verdad: [[HOKAGE_OS_MASTER_SPEC]], [[HOKAGE_AGENT_OPERATING_MODEL]], [[HOKAGE_WORLD_ENGINE_SPEC]], [[Auditoría de Arquitectura - 2026-08-13]] y el **código real actual**.
> Alcance: arquitectura de producción + migración Mac→VPS + estrategia por etapas + dependencias/contradicciones. **No implementa código, schema ni configuración** (decisión de Jorge).

**Filosofía rectora (🔒):** *mínimo coste mientras sea suficiente, sin tomar decisiones que bloqueen el crecimiento.* Ni sobreingeniería empresarial cara, ni atajos que obliguen a rehacer el Runtime, los agentes, el World Engine o la IA.

**Leyenda:** ✅ preparado · 🟡 funciona en local, adaptar · 🔜 necesario antes del deploy · 🧭 solo al escalar · 🚫 no construir aún (sobreingeniería).

---

## 0. La decisión que evita rehacer todo: descomposición de procesos "lista, no hecha"

El error que este documento evita: acoplar la lógica de negocio a "un solo proceso" de forma que escalar obligue a reescribir. La solución **no** es construir microservicios ahora — es mantener **cuatro piezas detrás de interfaces limpias desde ya**, para poder cambiar su implementación (in-memory → distribuida) sin tocar agentes/runtime/mundo:

| Pieza | Hoy (Etapa 1) | Al escalar (Etapa 3-4) | ¿Interfaz limpia hoy? |
|---|---|---|---|
| **Event Bus** | `EventEmitter` in-process | Broker pub/sub (Redis/NATS) | ✅ `bus.publish/subscribe` ya lo abstrae |
| **Session store** | `Map` en memoria | Store compartido (Redis) | 🟡 módulo `session.ts` aislado, falta interfaz |
| **Rate limiter** | `express-rate-limit` in-memory | Store compartido | 🟡 middleware, falta store pluggable |
| **Runtime/Scheduler** | En el mismo proceso que la API | Proceso **singleton** separado | 🟡 `runtime` es un módulo, falta separar arranque |

🔒 **Invariante de diseño:** estas cuatro piezas se consumen siempre a través de su interfaz, nunca por su implementación concreta. Así, Etapa 4 cambia implementaciones, no lógica de dominio. **No se construye Redis/multi-proceso ahora** (§Etapa 1) — solo se preserva la costura.

🔒 **Invariante de escala (crítico):** el **Scheduler/Runtime es un singleton**. Cuando la API/WS escale horizontalmente (Etapa 4), **solo UN proceso ejecuta agentes** — dos schedulers duplicarían ejecuciones y gasto. Esta separación (API ↔ worker) se diseña en Etapa 3, pero se tiene en cuenta desde el principio no mezclando su estado.

---

## 1. Arquitectura de producción (topología objetivo)

```
Internet
  │  (443, TLS)
  ▼
nginx (reverse proxy + TLS Let's Encrypt)
  ├─ /            → estáticos del frontend (vite build → dist/)
  ├─ /api         → backend (127.0.0.1:3000)
  └─ /ws (upgrade)→ backend WebSocket (127.0.0.1:3000)
        │
        ▼
Node backend (PM2, usuario Linux dedicado SIN sudo)
  ├─ API HTTP + WebSocket
  ├─ Runtime/Scheduler (Etapa 1-2 mismo proceso; Etapa 3 separado, singleton)
  ├─ Event Bus (in-process → broker en Etapa 3-4)
  └─ system.exec (usuario dedicado, buildSafeExecEnv)
        │
        ▼
SQLite (WAL) en volumen persistente  →  PostgreSQL (Etapa 4)
        │
        ▼
Backups (dump periódico del .db + checkpoint WAL) → almacenamiento externo
```

🔒 El backend **solo escucha en `127.0.0.1`** (ya es así, `server.ts:1168`); nginx es la única superficie pública. Firewall: solo 80/443 abiertos.

---

## 2. Estado actual auditado — qué ya está listo para producción (clase A)

Verificado en código; **no requiere trabajo** para VPS:

- ✅ **Sin paths locales.** BD por `HOKAGE_DB_PATH || data/hokage-os.db` (relativo, `path.resolve(__dirname,...)`); `REPO_ROOT` por `import.meta.url`. Cero `/Users/` en código.
- ✅ **Bind a loopback** (`127.0.0.1`), listo para vivir tras nginx.
- ✅ **Env requerido validado al arrancar** (`OPENROUTER_API_KEY`, `ADMIN_TOKEN` → `process.exit(1)` si faltan).
- ✅ **Frontend sin secretos.** F10 eliminó `VITE_ADMIN_TOKEN`; el bundle no lleva token (hay script `verify:no-secrets` que lo audita). Auth por login → cookie de sesión HttpOnly.
- ✅ **Seguridad HTTP/WS** (auth dual, CSRF por Origin, `SameSite=Lax`, rate limits, WS token en subprotocolo, cookie `Secure` cuando HTTPS vía `x-forwarded-proto`).
- ✅ **`system.exec` saneado** (`buildSafeExecEnv`: sin secretos en el hijo).
- ✅ **Migraciones aditivas** (`CREATE TABLE IF NOT EXISTS`, `ALTER ... ADD COLUMN` con guarda `columnExists`).
- ✅ **WAL activo** (evidencia `.db-wal`/`.db-shm`, ignorados por git).
- ✅ **Idempotencia base** de work_items (claim atómico `UPDATE ... WHERE status='pending'`; guardas de existencia en stage2; F11/F12 enlaces idempotentes).
- ✅ **Auditoría/observabilidad** (`audit_logs`, `event_log`, sanitizados) + endpoint `GET /api/health`.
- ✅ **Build reproducible** (`tsc && vite build` frontend; `tsc` backend → `dist/`).

---

## 3. Qué funciona en local pero debe adaptarse para VPS (clase B)

| Ítem | Local hoy | Adaptación para VPS | Etapa |
|---|---|---|---|
| **Recuperación del scheduler tras reinicio** | `stage4` devuelve `in_progress` vencidos a `pending` **por TTL** (hasta ~30 min de estancamiento tras un reinicio) | **Reconciliación al arranque:** al iniciar, `in_progress` con `locked_at` huérfano → `pending` inmediato. Aditivo, bajo riesgo. | 🔜 antes del deploy |
| **Session store** | `Map` en memoria; reinicio = re-login (1 operador) | Aceptable en Etapa 1-2 (re-login es barato). En Etapa 3 (multi-proceso) → store compartido. | 🟡 / 🧭 |
| **Cookie `Secure` + `x-forwarded-proto`** | http local, sin Secure | nginx debe pasar `x-forwarded-proto=https`; poner `SESSION_SECURE=1` | 🔜 |
| **`FRONTEND_URL` / `TRUSTED_ORIGINS` / CORS** | `localhost:5173` hardcodeado como fallback | Fijar al dominio real por env | 🔜 |
| **Logs** | `console.log` a stdout | PM2/journald + **rotación**; nivel configurable | 🔜 |
| **WAL explícito** | activo (evidencia) pero conviene PRAGMA explícito + checkpoint en backup | Confirmar `journal_mode=WAL` y checkpoint antes del dump | 🔜 |
| **Rate limiter** | in-memory por proceso | OK en 1 proceso; store compartido en Etapa 3 | 🟡 / 🧭 |
| **Event Bus** | `EventEmitter` in-process | OK en 1 proceso; broker en Etapa 3-4 (§10) | 🟡 / 🧭 |

---

## 4. Estrategia por etapas

### ETAPA 1 — VPS económica para el Hokage inicial 🔜

- **Infraestructura:** 1 VPS pequeña (referencia del proyecto: Hetzner CX22, 2 vCPU / 4 GB / 40 GB, **~4€/mes**), Ubuntu 24.04.
- **Servicios:** **un solo proceso** Node (API + WS + Runtime juntos) bajo **PM2** (reinicio automático, arranque en boot); **nginx** (proxy + TLS); **Certbot/Let's Encrypt**.
- **Almacenamiento:** SQLite (WAL) en el disco del VPS; `dist/` estáticos servidos por nginx.
- **Red:** solo 80/443 públicos; backend en loopback; dominio + DNS → VPS.
- **Seguridad:** usuario Linux **dedicado sin sudo** para el proceso (requisito de `system.exec`); firewall (ufw); secretos en `.env` del servidor (nunca en git); TLS; headers de seguridad en nginx.
- **Coste (cualitativo):** **muy bajo** (~pocos €/mes). Sin servicios gestionados.
- **Límites:** un proceso — el Runtime y la API comparten CPU; un crash del runtime tumba la API; deploy con microcorte; SQLite un solo escritor.
- **Señales para pasar a Etapa 2:** el número de agentes/ventures crece y el trabajo autónomo llena la cola con holgura, pero la caja aún respira.

### ETAPA 2 — crecimiento de agentes/ventures/carga 🧭

- **Infraestructura:** misma caja o un escalón más de RAM/CPU (escalado **vertical** barato).
- **Servicios:** igual que Etapa 1; se afinan intervalos del scheduler, topes de presupuesto y del `ModelRouter` para controlar coste con más agentes.
- **Almacenamiento:** SQLite todavía suficiente (un escritor, WAL); backups más frecuentes.
- **Red/Seguridad:** igual; se añade monitorización básica (health + alertas simples, p.ej. Telegram cuando el proceso cae o un agente falla 3×).
- **Coste:** **bajo** (un escalón de VPS).
- **Límites:** sigue siendo un proceso; la contención de escritura de SQLite empieza a notarse si hay mucho trabajo concurrente por venture.
- **Señales para Etapa 3:** el proceso único es cuello de botella (el scheduler bloquea la API, o se necesita deploy sin corte, o presión de memoria), **o** se quieren varias ventures activas simultáneas con carga real.

### ETAPA 3 — producción más seria / múltiples procesos 🧭

- **Infraestructura:** una caja mayor, o dos (API/WS + worker). 
- **Servicios:** **separación de procesos:** proceso(s) **API/WS** + **un** proceso **Runtime/Scheduler (singleton)**. Se introduce un **broker/store compartido** (Redis) para: Event Bus pub/sub, session store y rate limiting distribuido. La lógica de dominio no cambia — solo la implementación detrás de las interfaces de §0.
- **Almacenamiento:** SQLite aún posible si el escritor es único (el worker), pero es la frontera hacia Postgres.
- **Red/Seguridad:** igual + red interna entre procesos; secretos vía gestor (o env inyectado por el orquestador de procesos).
- **Coste:** **medio** (VPS mayor + Redis, gestionado o en la misma caja).
- **Límites:** un solo escritor de BD; una sola caja.
- **Señales para Etapa 4:** la caja se satura (CPU/RAM), **o** contención de escritura de SQLite (referencia ya fijada: >2 ventures activas simultáneas o >10 agentes → Postgres, [[Escalabilidad]]), **o** se necesita alta disponibilidad/redundancia.

### ETAPA 4 — escalado horizontal cuando realmente sea necesario 🧭

- **Infraestructura:** varias instancias de API/WS tras un balanceador; Runtime singleton (o **sharded por venture**, G.2) aparte; **PostgreSQL** gestionado.
- **Servicios:** API/WS stateless (sesión y rate-limit en Redis; WS con sticky o pub/sub para broadcast); bus sobre broker; scheduler con colas priorizadas si el volumen lo exige.
- **Almacenamiento:** Postgres (el **schema no cambia** — solo el driver, tras la capa `run/get/all`); backups gestionados.
- **Red/Seguridad:** LB + TLS terminando arriba; aislamiento de red por servicio.
- **Coste:** **más serio** (varias instancias + Postgres gestionado + LB).
- **Límites:** los de un sistema distribuido real (consistencia, operación) — se asumen solo cuando el negocio lo justifica.
- **Señal:** ninguna hasta que Etapa 3 se quede corta con datos reales. **No adelantar.**

---

## 5. Tratamiento por componente (mapea los 27 puntos del brief)

- **Backend/Frontend/BD/WS/Bus/Runtime (1-3, 10-12):** backend Node tras nginx; frontend estático; BD SQLite→Postgres; WS por upgrade en nginx; bus in-process→broker; runtime en-proceso→singleton separado. Ver §1, §4.
- **Persistencia y recuperación tras reinicio (4):** BD en volumen persistente; **reconciliación de work_items al arranque** (🔜, §3); `activeAgents` es proyección in-memory (se reconstruye desde BD, correcto).
- **Sesiones/auth en producción (5):** cookie HttpOnly + `Secure` (tras nginx); store en memoria Etapa 1-2 (re-login tras reinicio, aceptable), compartido Etapa 3.
- **Secretos/API keys (6):** `.env` en el servidor, fuera de git (✅ `.gitignore`), inyectados por PM2/entorno; `buildSafeExecEnv` impide fuga vía `system.exec`; Secret Management v2 ([[Gestión de Secretos y Capabilities]], C.6) cuando entren integraciones de terceros.
- **OpenRouter/AIProvider/ModelRouter/coste (7-8):** hoy OpenRouter cableado; el `AIProvider` (C §4) lo pone tras interfaz para añadir proveedores/modelos locales sin tocar agentes; el `ModelRouter` (C §4) controla calidad/coste; techos por venture/rol son el límite duro (invariante). La clave de producción: **la clave de API vive solo en el backend**, nunca en el frontend (✅).
- **SQLite/WAL/concurrencia/Postgres (9):** WAL permite lectores concurrentes + un escritor; suficiente hasta la frontera de Etapa 3-4 (>2 ventures / >10 agentes). Migración a Postgres = cambio de driver bajo `run/get/all`, **schema intacto**. Intersecta con A.7 (doc dice `better-sqlite3`, código usa `sqlite3` async — corregir doc).
- **Event Bus multi-proceso (10):** contrato (emit/listen, no persiste a SQL, `event_log` es consumidor) se **conserva**; la implementación `EventEmitter` pasa a broker pub/sub en Etapa 3-4 **sin cambiar el contrato** (ver contradicción §7.2).
- **WS y reconexión (11):** cubierto en [[HOKAGE_WORLD_ENGINE_SPEC]] §14-15: snapshot al conectar, deltas en vivo, resync por reemplazo al reconectar, STALE sin inventar estado. nginx debe permitir upgrade y timeouts largos de WS.
- **Jobs/scheduler/autonomía/recuperación (12):** FSM de 8 etapas; recuperación por TTL + reconciliación al arranque (🔜). En Etapa 3, el scheduler es el proceso singleton.
- **Idempotencia/duplicados (13):** claim atómico por `UPDATE ... WHERE status='pending'`; guardas de existencia; F12 idempotente. En multi-proceso (Etapa 4) el singleton del scheduler evita doble ejecución; si se shardea, el sharding es por venture (sin solape).
- **Backups/restauración (14):** dump periódico del `.db` con checkpoint WAL previo (o backup online de SQLite) → almacenamiento externo; restauración = reemplazar el fichero y reiniciar. Postgres (Etapa 4) → backups gestionados.
- **Migraciones de schema (15):** aditivas en `db/init.ts` al arranque (✅); una migración destructiva exige confirmación humana (invariante). Con Postgres, mismas migraciones tras la capa de acceso.
- **Logs/auditoría/métricas/health (16):** `GET /api/health` (✅) ampliable con estado de agentes/cola; `audit_logs`/`event_log`; logs a stdout→PM2 con rotación; métricas básicas primero (no stack de observabilidad — §Etapa).
- **Rate limiting distribuido (17):** in-memory basta en 1 proceso; store compartido (Redis) solo en Etapa 3+ (🧭).
- **Red/proxy/TLS/CORS/CSRF/headers (18):** nginx + Let's Encrypt; CORS restrictivo (✅, refleja origen de confianza); CSRF por Origin (✅); headers de seguridad (HSTS, X-Content-Type-Options, etc.) en nginx (🔜).
- **Aislamiento por venture (19):** ya estructural (memoria/coste/contexto scoped); en producción se mantiene idéntico; el mundo (D) no filtra estado entre ventures.
- **`system.exec` en producción (20):** usuario dedicado sin sudo (🔜, requisito de deploy); `buildSafeExecEnv` (✅); siempre *propose→approve→run*; considerar sandbox más fuerte (contenedor/namespace) como futuro, no ahora.
- **Deploy/rollback/versionado (21):** build versionado (git SHA/tag); deploy = build + `pm2 reload` (Etapa 1 con microcorte, zero-downtime en Etapa 3); rollback = checkout del tag anterior + reload + (si migración) plan de reversión de datos. **Migraciones solo aditivas** hace el rollback de código seguro sin rollback de datos.
- **CI/CD (22):** no necesario para el primer deploy (🚫 ahora); útil en Etapa 2-3 (lint+tsc+build+tests en push; deploy manual o por tag). Empezar simple.
- **Coste mínimo (23), escalabilidad V/H (24), barato mientras haya poca carga (25), diseñar-desde-el-principio (26), NO construir aún (27):** resueltos por las 4 etapas (§4) + el principio de §0 (interfaces limpias sin implementación distribuida prematura).

---

## 6. Migración Mac → VPS: checklist con clasificación A/B/C/D/E

| Ítem | Clase | Detalle |
|---|---|---|
| **Paths** | **A** ✅ | Sin `/Users/`; `__dirname`/`import.meta.url`. Nada que cambiar. |
| **Variables de entorno** | **B/C** | Definir en el servidor: `PORT`, `OPENROUTER_API_KEY`, `ADMIN_TOKEN`, `AI_MODEL`, `FRONTEND_URL`, `SESSION_SECURE=1`, `OWNER_NAME`. Crear `.env.example` (🔜 C). |
| **Build** | **A/C** | `tsc` (backend) + `tsc && vite build` (frontend) reproducibles; correr en el server o en CI y subir artefacto (C). |
| **Base de datos** | **B/C** | Fichero SQLite en **volumen persistente**; confirmar WAL; primer arranque crea schema. |
| **Archivos persistentes** | **C** | Definir carpeta de datos persistente (`data/`) fuera del árbol de deploy para que un redeploy no la borre. |
| **Sesiones** | **B** | Store en memoria: re-login tras reinicio (aceptable Etapa 1-2); compartido en Etapa 3. |
| **WebSocket** | **B/C** | nginx: `Upgrade`/`Connection` headers + timeouts largos; `x-forwarded-proto`. |
| **Procesos** | **C** | PM2 (arranque en boot, reinicio automático, logs). |
| **Scheduler** | **B** | Reconciliación de `in_progress` huérfanos al arranque (🔜). |
| **Secretos** | **A/C** | `.gitignore` ya cubre `.env`/`*.db` (✅); crearlos en el server (C). |
| **Configuración** | **B/C** | Fijar `FRONTEND_URL`/orígenes de confianza al dominio real. |
| **Dominio** | **C** | DNS → IP del VPS. |
| **HTTPS** | **C** | Certbot/Let's Encrypt + renovación automática. |
| **Backups** | **C/D** | Etapa 1: cron de dump del `.db`; Etapa 4: gestionado. |
| **Recuperación** | **B/C** | Restaurar = reemplazar `.db` + reiniciar; documentar el runbook. |

- **Clase A (ya preparado):** paths, bind loopback, frontend sin secretos, migraciones aditivas, `.gitignore`, `buildSafeExecEnv`, health.
- **Clase B (adaptar):** sesiones, cookie Secure/proxy, orígenes/CORS, logs+rotación, reconciliación de scheduler, WAL explícito.
- **Clase C (antes del primer deploy):** VPS+usuario dedicado, nginx+TLS, PM2, dominio/DNS, `.env` en server, carpeta de datos persistente, backups básicos, runbook.
- **Clase D (solo al escalar):** Redis (sesión/rate-limit/bus), separación de procesos, Postgres, LB, rate limit distribuido, CI/CD completo.
- **Clase E (NO construir aún):** Kubernetes, multi-región, colas de mensajes dedicadas, microservicios, autoscaling, stack de observabilidad (Prometheus/Grafana), Postgres antes de la señal, scheduler sharded, sandbox de contenedor para exec, service mesh.

---

## 7. Contradicciones entre A/C/D y la arquitectura de producción

No las resuelvo aquí; las documento con impacto y la decisión pendiente.

### 7.1 Session store in-memory (A §15) vs. multi-proceso (Etapa 3-4)
- **Naturaleza:** A marca el store en memoria como techo consciente de proceso único. No es contradicción oculta — es una **dependencia de etapa**.
- **Impacto:** Etapa 3 (varios procesos API) rompe el login si el store no se comparte.
- **Decisión pendiente:** en Etapa 3, mover sesiones a store compartido (Redis) tras una interfaz `SessionStore`. Diseñar la interfaz en Etapa 1 (barato), implementar el store en Etapa 3.

### 7.2 Event Bus "in-process, nunca persiste" (ADR-003, A §17) vs. multi-instancia (Etapa 4)
- **Naturaleza:** ADR-003 congela que el bus **no es capa de persistencia** y hoy es `EventEmitter`. Un broker pub/sub (Redis/NATS) es **transporte distribuido, no persistencia** → **compatible con el contrato**, pero la *implementación* `EventEmitter` debe ser sustituible.
- **Impacto:** si en Etapa 1 algún consumidor asume `EventEmitter` concreto (listeners locales), Etapa 4 obliga a refactor.
- **Decisión pendiente:** ratificar que el **contrato** `publish/subscribe/getHistory` es la única superficie permitida (ya lo es en `eventBus.ts`); prohibir acceso a `EventEmitter` por debajo. Con eso, Etapa 4 cambia la implementación sin tocar dominio. **No** es un cambio de ADR-003 — es una nota de implementación.

### 7.3 SQLite un-escritor vs. escalado horizontal (Etapa 4)
- **Naturaleza:** SQLite (WAL) soporta un escritor; multi-instancia con múltiples escritores no. Ya anticipado (Postgres, G.4).
- **Impacto:** el scheduler singleton mantiene un solo escritor hasta Etapa 4; el salto a Postgres es de driver (schema intacto).
- **Decisión pendiente:** confirmar que toda escritura pasa por `run/get/all` (para que el swap sea local) y fijar el disparador exacto (la referencia ">2 ventures / >10 agentes" es cualitativa).

### 7.4 Runtime en el proceso de la API (hoy) vs. Scheduler singleton al escalar
- **Naturaleza:** hoy `server.ts` arranca API + WS + Runtime juntos. Escalar la API horizontalmente **sin separar el runtime** duplicaría ejecuciones de agentes (doble gasto).
- **Impacto:** es la contradicción de producción **más importante**: afecta corrección (idempotencia) y coste, no solo rendimiento.
- **Decisión pendiente:** en Etapa 3, separar el arranque del runtime en un proceso propio (singleton). Diseñar desde ya el módulo `runtime` para que su arranque sea independiente del de la API (no mezclar su estado con el de las rutas). **No** separar procesos ahora (Etapa 1 es un proceso) — solo no acoplar.

### 7.5 `AgentRuntimeState` (D) y producción
- **Naturaleza:** D exige que el estado del mundo venga del runtime real. En Etapa 3 (runtime separado), el estado debe publicarse por el bus/broker para que las instancias de API/WS lo reenvíen a los clientes.
- **Impacto:** refuerza 7.2 (el bus debe poder cruzar procesos) y 7.4 (el runtime es la fuente del estado).
- **Decisión pendiente:** el `runtime_state_snapshot` y los deltas se emiten por el bus; en Etapa 3 el broker los distribuye a todas las instancias API/WS. Ninguna instancia inventa estado (invariante de D).

---

## 8. Decisiones que E CONGELA 🔒

1. **El backend solo escucha en loopback; nginx es la única superficie pública** (ya es así, se ratifica como invariante de producción).
2. **Estrategia por 4 etapas** con "mínimo coste suficiente sin bloquear crecimiento"; **no** se construye infraestructura distribuida antes de su señal.
3. **Cuatro piezas detrás de interfaz limpia desde Etapa 1** (bus, sesión, rate-limit, runtime) para permitir swap a distribuido sin tocar dominio.
4. **El Scheduler/Runtime es un singleton**; la API/WS puede escalar, el runtime no se duplica.
5. **Migraciones solo aditivas** → rollback de código seguro sin rollback de datos.
6. **El schema no cambia al migrar de SQLite a Postgres**; solo el driver, bajo `run/get/all`.
7. **El contrato del Event Bus se conserva** (emit/listen, no persiste); solo cambia su implementación al escalar.
8. **Secretos solo en el backend/servidor**, nunca en el bundle del frontend; `system.exec` bajo usuario dedicado sin sudo en producción.
9. **`.env`/datos persistentes fuera del árbol de deploy y de git.**

---

## 9. Decisiones que siguen ABIERTAS ⚠️

**De E:**
1. **Disparador exacto SQLite→Postgres** (la referencia >2 ventures / >10 agentes es cualitativa).
2. **Elección de broker/store** en Etapa 3 (Redis vs. alternativa) — no ahora.
3. **Momento y forma de CI/CD** (manual → por tag → pipeline).
4. **Estrategia de backup exacta** (frecuencia, retención, destino externo).
5. **A.7:** corregir `CLAUDE.md` (`better-sqlite3`→`sqlite3`) o migrar driver — recomendado: corregir doc.

**De C/D que permanecen (no cerradas por E):** matriz `ModelRouter` + quality floors · umbrales de feedback · autonomía por-agente · motor de relevancia · resultado pobre · mapeo fino de `AgentRuntimeState` · lenguaje visual por estado.

---

## 10. Dependencias críticas (todo el sistema)

```
FUNDACIÓN
  AgentRuntimeState real (C-1 = D-1)  ──►  World Engine real (D)  y  selección por historial/dedup (C)
        │                                        │
        ▼                                        ▼
  eventos de estado (D-2)  ─────────────►  useWorldState puro / borrar Math.random (D-3)

IA (paralelo, independiente del mundo)
  AIProvider (C-2)  ──►  ModelRouter + quality floors (C-3)  ──►  valor esperado (C-7)

HERMES (en curso)
  B.2 (kernel + system.status)  ──►  B.3 (departments.type / Panel de Sistema = VisualKind 'system')

PRODUCCIÓN
  reconciliación scheduler (E-pre) ─► Etapa 1 deploy (nginx+TLS+PM2+usuario dedicado+backups)
  interfaces limpias (bus/sesión/rate/runtime) ─► Etapa 3 (procesos + Redis) ─► Etapa 4 (Postgres + horizontal)
```

**El nodo raíz de todo es `AgentRuntimeState` (C-1/D-1):** habilita el mundo real, la selección de agente, la deduplicación y el estado que producción debe distribuir. Es el primer cambio estructural.

---

## 11. Orden recomendado de implementación de TODO el sistema

Ordenado por dependencia real, minimizando rehacer trabajo. Cada bloque deja el sistema compilando, con tests y con constancia de problema/riesgo (§18 del brief global). **No ejecutar aún — a fijar contigo.**

**BLOQUE 0 — barato e inmediato (sin dependencias)**
- 0.1 Corregir `CLAUDE.md` driver (A.7). Reconciliación documental de §9.1 Hermes (con B.2).
- 0.2 **Fijar decisiones abiertas mínimas** para arrancar: mapeo fino de `AgentRuntimeState` (D §3.2) y suelo/ matriz inicial del `ModelRouter`.

**BLOQUE 1 — la fundación (habilitador nº1)**
- 1.1 **C-1/D-1 — `AgentRuntimeState` real** (backend, aditivo, solo lectura).
- 1.2 **D-2 — eventos de estado** (deltas por bus/WS).
- 1.3 **D-3 — `useWorldState` puro; ELIMINAR `Math.random`/`setInterval`** y heurísticas de tiempo. *(Aquí el mundo pasa a real.)*
- 1.4 **D-4/D-5 — estados visuales + comandos extendidos** (registries).

**BLOQUE 2 — cerrar Hermes-kernel (Fase B en curso)**
- 2.1 **B.2 — kernel sin voz + `system.status` + superficie de comando** (`system.status` también sirve a observabilidad de producción).
- 2.2 **B.3 — `departments.type` + Panel de Sistema** (VisualKind 'system').

**BLOQUE 3 — calidad/coste de IA (paralelizable con 1-2)**
- 3.1 **C-2 — `AIProvider`** (frontera de proveedor).
- 3.2 **C-3 — `ModelRouter` + quality floors** (calidad primero).

**BLOQUE 4 — primer deploy real (Etapa 1) — alto valor: Hokage 24/7 sin el Mac**
- 4.1 **E-pre — reconciliación de scheduler al arranque** + WAL explícito + `.env.example` + runbook.
- 4.2 **Etapa 1 — VPS + nginx + TLS + PM2 + usuario dedicado + backups** (requiere que Jorge provisione el servidor).

**BLOQUE 5 — modelo de agente más rico (según prioridad de negocio)**
- 5.1 **C-4 — feedback→conocimiento** (tras fijar umbrales).
- 5.2 **C-5 — hand-off dirigido** → **D §10 COMMUNICATING**.
- 5.3 **C-7 — valor esperado** en coste/scheduler. **D-6 — reconexión/STALE**.

**BLOQUE 6 — escala (SOLO cuando la señal llegue)**
- 6.1 **Etapa 3 — separar procesos (API ↔ worker singleton) + Redis** (bus/sesión/rate-limit).
- 6.2 **Etapa 4 — Postgres + horizontal + LB**; **D-7/G.2 — LOD/clustering / scheduler sharded**.

🔒 **Regla de secuencia:** nada de producción distribuida (Bloque 6) antes de su señal; nada de features que acoplen el proveedor de IA antes del Bloque 3; y **el mundo real (Bloque 1) antes de pulir lo visual**, para no pulir una simulación falsa.

---

*Documento E — cierra la serie de preparación maestra (A `HOKAGE_OS_MASTER_SPEC` · B `Auditoría de Arquitectura - 2026-08-13` · C `HOKAGE_AGENT_OPERATING_MODEL` · D `HOKAGE_WORLD_ENGINE_SPEC` · E este). No implementar código hasta fijar el orden del §11 con Jorge.*
