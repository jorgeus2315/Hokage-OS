# Deployment & Migration Plan — Hokage OS

> Cómo llevar Hokage OS de desarrollo local a un VPS 24/7. Documento de planificación — **no se ha desplegado nada, no se ha cambiado código**.
> Generado: 2026-08-09. Opera sobre decisiones ya congeladas (`Master Roadmap - v1` **G.1**, `HOKAGE_CORE_SPECIFICATION_v1.md §11.3`): Hetzner CX22, PM2, Nginx + Certbot, SQLite hasta superar ~2 ventures activos o 10 agentes (entonces PostgreSQL). Este documento no decide arquitectura nueva — la opera.

---

## 0. Bloqueante crítico — leer antes de todo lo demás

**El Master Roadmap ya lo fija explícitamente: "G.1 depende de A.2 — seguridad cerrada antes de exponer el sistema fuera de localhost."** No es una recomendación de este documento, es una dependencia ya decidida que este plan no puede saltarse.

Verificado en el código real (`backend/src/server.ts`) para este documento:

1. **`httpServer.listen(PORT, ...)` no especifica host** → Node.js lo hace escuchar en `0.0.0.0`, todas las interfaces. Hoy, en local, esto es inofensivo (solo tu Mac). **En un VPS con IP pública, esto expone el backend completo a internet sin ningún filtro de red.**
2. **El WebSocket no exige token.** `wss.on('connection', ...)` envía el snapshot inicial completo (agentes, decisiones, departamentos, eventos recientes) a cualquiera que abra una conexión WS — no hay handshake de autenticación, a diferencia de las rutas REST mutantes (`requireAdmin`).
3. **`ADMIN_TOKEN` viaja al bundle del cliente** vía `VITE_ADMIN_TOKEN` — es inherente al diseño actual (el frontend necesita el token para llamar rutas admin), pero significa que el token es visible para cualquiera que inspeccione el JS servido — no es un secreto de servidor, es un secreto compartido con el cliente.

**Antes de ejecutar cualquier paso de este documento contra un servidor con IP pública:**
- Bind explícito a `127.0.0.1` en `httpServer.listen()`, con Nginx como único punto de entrada externo (Nginx sí en `0.0.0.0`, el backend nunca).
- Handshake de autenticación en `wss.on('connection')` — mismo `ADMIN_TOKEN` que ya usan las rutas REST, verificado antes de aceptar la conexión o de enviar el snapshot inicial.
- Confirmar con Jorge si dependía, sin saberlo, del acceso LAN sin token (nota explícita ya en el Master Roadmap A.2 — no asumir).

Esto es trabajo de código (**A.2** del Master Roadmap), no de infraestructura — **está fuera del alcance de este documento**, que es puramente de despliegue. Este plan asume que A.2 ya está resuelto antes de la Fase 3 (Nginx) en adelante. Todo lo de código/BD local (Fases 1-2) puede prepararse sin esperar a A.2 — nada de eso expone el servidor a la red.

---

## 1. Arquitectura objetivo

```
Internet
   │
   ▼
Nginx (:443, TLS via Certbot)
   │
   ├── /              → frontend/dist/ (estático, servido directo por Nginx)
   ├── /api/*          → proxy_pass → 127.0.0.1:3000 (backend Express)
   └── /ws              → proxy_pass → 127.0.0.1:3000 (upgrade WebSocket)
                              │
                              ▼
                         PM2 (proceso Node persistente)
                              │
                              ▼
                    backend/dist/server.js
                              │
                              ▼
                 backend/data/hokage-os.db (SQLite, WAL)
```

Backend y WebSocket comparten el mismo proceso/puerto (`wss = new WebSocketServer({ server: httpServer })`, sin `path` propio) — confirmado en el código real. El frontend siempre pide `/ws` (`useWebSocket.ts`), así que Nginx solo necesita enrutar ese path específico con upgrade de protocolo; el backend no necesita cambios para esto.

---

## 2. Prerrequisitos

- VPS Hetzner CX22 (2 vCPU, 4GB RAM, 40GB SSD, ~4€/mes) — ya decidido, pendiente de que Jorge lo cree.
- Ubuntu 24.04 LTS.
- Node.js v22 (misma versión que desarrollo local, según `CLAUDE.md`).
- Dominio propio apuntando al VPS (necesario para Certbot/TLS — sin dominio no hay HTTPS válido, y sin HTTPS el WebSocket en producción debería ser `wss://`, que `useWebSocket.ts` ya asume automáticamente vía `window.location.protocol`).
- Acceso SSH con clave, sin contraseña.
- **A.2 resuelto en el código** (ver §0) antes de exponer el puerto del backend más allá de loopback.

---

## 3. Código

### 3.1 Primer despliegue

1. `git clone` del repositorio en el VPS (rama `main`, mismo commit que se validó en local).
2. `cd backend && npm ci` (no `npm install` — `ci` respeta el lockfile exacto, evita que una versión de dependencia distinta a la probada en local llegue a producción).
3. `npm run build` (backend) → ejecuta `tsc`, genera `backend/dist/` desde `backend/src/` (confirmado en `tsconfig.json`: `rootDir: src`, `outDir: dist`).
4. `cd frontend && npm ci && npm run build` → `tsc && vite build`, genera `frontend/dist/` (build estático).
5. **No usar `npm run db:init`** — ese script en `backend/package.json` apunta a `src/scripts/init-db.ts`, que no existe en el repo (confirmado — solo existe `scripts/seed.ts`). El propio `server.ts` llama `initSchema()` automáticamente al arrancar; no hace falta un paso manual de inicialización de BD.
6. Verificar `backend/data/` existe y es escribible por el usuario que ejecutará el proceso (SQLite necesita crear `hokage-os.db`, `.db-wal`, `.db-shm` ahí).

### 3.2 Qué NO se despliega

- `node_modules/` de ningún lado — se instala en el servidor con `npm ci`, nunca se copia.
- `backend/data/*.db*` — es estado, no código (ver §4). No se sobreescribe en un deploy.
- `.env` de ningún lado — nunca viaja en el `git clone` (ver §5).

---

## 4. Base de datos

### 4.1 Estado actual, verificado

- Motor: SQLite vía el driver `sqlite3` (async/callback) — **no** `better-sqlite3`, pese a que `CLAUDE.md` lo documenta así (discrepancia real, ya señalada como **A.7** del Master Roadmap y en `Codebase Audit Registry.md`). No migrar el driver como parte de este despliegue — es una decisión aparte, condicional.
- `PRAGMA journal_mode = WAL` ya activo (`db/init.ts`) — implica 3 archivos por BD: `hokage-os.db`, `hokage-os.db-wal`, `hokage-os.db-shm`. Los tres deben tratarse como una unidad en cualquier backup o copia (ver §8).
- Migraciones ya son **aditivas por diseño** (`columnExists()` + `ALTER TABLE`, nunca destructivas) — confirmado en `runMigrations()`. Esto significa que un deploy nuevo puede ejecutarse sobre la BD de producción sin script de migración manual: `initSchema()` al arrancar detecta y aplica lo que falte.
- Umbral ya fijado para migrar a PostgreSQL: más de ~2 ventures activos simultáneos o 10 agentes (`Master Roadmap G.4`, ratifica `Roadmap.md` viejo). No aplica todavía — el negocio real (Minimal Designs) es la única venture activa hoy.

### 4.2 Primera puesta en marcha en el VPS

La base de datos **no se migra desde local** en el primer despliegue — nace vacía en el VPS y `initSchema()` la siembra (`seedDepartments()`, `seedDefaultVenture()`, `seedAutomations()`, `seedHermesAgent()`), exactamente igual que en cualquier instalación local nueva. Esto es deliberado: mezclar datos de desarrollo (conversaciones de prueba, decisiones de test) con el primer arranque en producción sería confuso — arranca limpio.

Si en algún momento se decide llevar datos reales ya generados en local (p. ej. si Jorge quiere conservar el historial de una venture ya en marcha), la operación es: copiar los 3 archivos `hokage-os.db*` completos (proceso backend **detenido** en ambos lados durante la copia, para evitar corrupción de WAL) — no hay proceso de exportación/importación selectiva construido, ni falta hacerlo para una migración única de archivo SQLite.

---

## 5. Secrets

### 5.1 Variables requeridas (confirmadas en el código, no supuestas)

**Backend** (`backend/.env`, verificado contra `server.ts` líneas 9-17 y `handoff.md`):
```
PORT=3000
OPENROUTER_API_KEY=...
AI_MODEL=anthropic/claude-haiku-4-5
ADMIN_TOKEN=...
```
`server.ts` ya valida al arrancar que `OPENROUTER_API_KEY` y `ADMIN_TOKEN` existan (`REQUIRED_ENV`) — si faltan, el proceso no arranca (`process.exit(1)`). Esto es una salvaguarda real, no algo que este plan tenga que añadir.

Pendientes para cuando existan (no bloquean el despliegue de hoy, `handoff.md` ya los lista):
```
FRONTEND_URL=https://hokage.tudominio.com   # necesario para que CORS/isTrustedOrigin acepte el dominio real
ETSY_CLIENT_ID=...
ETSY_CLIENT_SECRET=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```
**`FRONTEND_URL` sí es bloqueante en la práctica**: `server.ts` construye `TRUSTED_ORIGINS` a partir de `FRONTEND_URL || 'http://localhost:5173'` — sin fijarlo al dominio real de producción, CORS rechazará al frontend desplegado.

**Frontend** (`frontend/.env`, leído en build-time por Vite, confirmado en `shared/api.ts`):
```
VITE_ADMIN_TOKEN=...
```
Mismo valor que `ADMIN_TOKEN` del backend — es intencional (ver §0, punto 3: el token es compartido con el cliente por diseño actual).

### 5.2 Cómo llegan al VPS

- **Nunca por git** — ambos `.env` están correctamente excluidos (`backend/.gitignore` tiene `*.env`, confirmado). No cambiar esto.
- Transferir por `scp` directo a `backend/.env` y `frontend/.env` en el servidor, una sola vez, fuera de cualquier pipeline automatizado — o pegarlos manualmente por SSH. No usar variables de entorno del shell de CI/CD hasta que exista un pipeline real (no existe hoy).
- Permisos de archivo: `chmod 600 backend/.env` — solo el usuario que ejecuta el proceso puede leerlo.
- El `VITE_ADMIN_TOKEN` del frontend se **hornea en el build** (`npm run build` lo incrusta en el JS servido) — cambiar el token exige rebuild + redeploy del frontend, no solo reiniciar el backend.

### 5.3 Rotación

No hay mecanismo de rotación automática (`SecretProvider`/Secret Management, `HOKAGE_CORE_SPECIFICATION_v1.md §11.2`, está diseñado pero no implementado — **C.6** del Master Roadmap, v2.0). Rotar `ADMIN_TOKEN` hoy es manual: generar valor nuevo → actualizar los dos `.env` → rebuild frontend → reiniciar backend (PM2) → invalidar el valor viejo. Documentar aquí, no automatizar todavía — no está en alcance de este despliegue inicial.

---

## 6. Servicios

### 6.1 PM2

Proceso único: el backend (`backend/dist/server.js`). El frontend es estático, Nginx lo sirve directamente — no necesita PM2 ni proceso Node propio.

```
pm2 start backend/dist/server.js --name hokage-backend --cwd backend
pm2 save
pm2 startup   # genera el script systemd para que PM2 sobreviva a un reinicio del VPS
```

- Reinicio automático si el proceso cae — resuelve directamente el problema ya documentado en `ARCHITECTURE.md §11` ("el runtime no sobrevive reinicios").
- `pm2 logs hokage-backend` para logs en vivo; PM2 rota logs automáticamente (evita que crezcan sin límite en disco, relevante dado que `console.log` se usa profusamente en el backend real — `[RUNTIME]`, `[BUS]`, `[DB]`, etc., confirmado en el código).
- Variable de entorno `NODE_ENV=production` — afecta directamente `structuredErrorHandler` (`errorHandler.ts`), que solo expone `stack`/`details` en el JSON de error cuando `NODE_ENV === 'development'`. Sin fijarla, producción filtraría stack traces a cualquier cliente.

### 6.2 Nginx

Dos responsabilidades: servir el frontend estático, y actuar como reverse proxy del backend — **nunca exponer el puerto 3000 directamente** (ver §0).

```nginx
server {
  listen 443 ssl;
  server_name hokage.tudominio.com;

  root /ruta/a/frontend/dist;
  index index.html;
  location / {
    try_files $uri /index.html;   # SPA — cualquier ruta no encontrada cae a index.html
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location /ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;   # WS de larga duración — el timeout por defecto de Nginx lo cortaría
  }
}
```

`proxy_read_timeout` alto es necesario porque el WebSocket del frontend se mantiene abierto indefinidamente (reconexión con backoff exponencial ya implementada en `useWebSocket.ts`, pero mejor no forzarla innecesariamente cada hora por un timeout de proxy).

### 6.3 Certbot

`certbot --nginx -d hokage.tudominio.com` — renovación automática vía el timer systemd que Certbot instala solo, ya decidido en `HOKAGE_CORE_SPECIFICATION_v1.md §11.3`. Sin pasos adicionales.

---

## 7. WebSocket en producción

Ya cubierto en detalle en §1 y §6.2 — resumen de los puntos que importan:
- El frontend calcula la URL solo (`useWebSocket.ts::wsUrl()`): `wss://` si la página se sirve por `https:`, mismo host, path `/ws`. **No necesita ninguna variable de entorno nueva** — se adapta solo al dominio real una vez Nginx está configurado con TLS.
- El backend no distingue el WS por path internamente (`new WebSocketServer({ server: httpServer })` sin `path`) — es Nginx quien decide que solo `/ws` llega ahí. No es necesario ni recomendable cambiar esto en el backend para el despliegue.
- **Pendiente de A.2**: hoy cualquier conexión WS recibe el snapshot inicial sin autenticarse. En producción esto es visible a cualquiera con la URL — bloqueante real, no cosmético (ver §0).

---

## 8. Backups

No existe hoy ningún mecanismo de backup — es infraestructura nueva de este plan, no algo que ya exista en el código.

### 8.1 Qué respaldar

Los 3 archivos de `backend/data/` como unidad (`hokage-os.db`, `.db-wal`, `.db-shm`) — nunca copiar solo el `.db` con WAL activo, se perderían escrituras aún no volcadas al archivo principal.

### 8.2 Cómo (SQLite-safe, sin detener el proceso)

```bash
sqlite3 backend/data/hokage-os.db ".backup /ruta/backups/hokage-os-$(date +%Y%m%d-%H%M).db"
```
`.backup` es la vía oficial de SQLite para copiar una BD en uso de forma consistente, incluso en WAL — no es un simple `cp`. No requiere detener PM2.

### 8.3 Cuándo y retención (propuesta, a confirmar con Jorge — es una decisión de producto, no solo técnica)

- Cron diario (p. ej. 04:00, hora de bajo uso).
- Retención: 7 backups diarios + 4 semanales — rotación simple por `find ... -mtime +N -delete`, sin infraestructura adicional.
- Copiar los backups fuera del propio VPS periódicamente (p. ej. descarga manual o a un bucket S3-compatible) — si el VPS entero falla, un backup que vive solo en el mismo disco no protege de nada. **No implementado en este plan** — se deja como decisión explícita pendiente, no como omisión silenciosa.

### 8.4 `.env` como parte del backup

Los `.env` (backend y frontend) deben respaldarse también, fuera del propio VPS, cifrados o en un gestor de secretos personal — perderlos exige reconstruir credenciales de OpenRouter/Etsy manualmente. No van en el mismo backup automatizado que la BD (son secretos, no datos operativos) — respaldo manual, una vez, tras cada cambio.

---

## 9. Actualizaciones (deploy de una versión nueva)

Proceso para llevar un cambio ya validado en local al VPS:

1. **Backup de BD antes de nada** (§8.2) — barato, y las migraciones aditivas son seguras pero un backup previo no cuesta nada.
2. `git pull` en el VPS (mismo commit ya probado en local con `tsc --noEmit` limpio — nunca desplegar algo no verificado localmente primero, mismo principio que ya rige cada fase de `UI Implementation Plan.md`).
3. `cd backend && npm ci && npm run build` (solo si `package.json`/lockfile cambiaron; si no, alcanza con `npm run build`).
4. `cd frontend && npm ci && npm run build`.
5. `pm2 restart hokage-backend` — el arranque ejecuta `initSchema()`, que aplica cualquier migración aditiva nueva automáticamente (confirmado: así es como ya funciona hoy en local, `runMigrations()` corre en cada boot y es idempotente vía `columnExists()`).
6. Nginx recoge el `frontend/dist/` nuevo sin reinicio propio (sirve archivos estáticos directamente del disco).
7. Verificar `GET /api/health` responde `ok` y `runtime: true` (mismo endpoint que ya existe, confirmado en `server.ts`).
8. Verificar en el navegador: WebSocket conecta, snapshot inicial llega, el mapa muestra actividad.

**Ninguna migración destructiva de schema existe hoy** (`runMigrations()` es 100% aditiva) — esto simplifica mucho el proceso de actualización: no hay "modo mantenimiento" que coordinar, el proceso puede reiniciarse con la BD en cualquier estado consistente.

---

## 10. Rollback

Dos escenarios distintos, con procedimiento distinto:

### 10.1 El código nuevo falla, la BD no cambió de forma incompatible

El caso común, dado que las migraciones son aditivas:
1. `git checkout <commit-anterior-conocido-bueno>`.
2. `npm run build` en ambos paquetes.
3. `pm2 restart hokage-backend`.
4. La BD no necesita tocarse — columnas añadidas por una migración aditiva que el código viejo no conoce simplemente se ignoran (nunca se leen), no rompen nada.

### 10.2 Algo corrompió datos o una migración tuvo un efecto no deseado

Más raro, dado el patrón aditivo actual, pero el procedimiento debe existir:
1. `pm2 stop hokage-backend` — detener escrituras.
2. Restaurar el backup más reciente previo al deploy (§8.2): copiar los 3 archivos `hokage-os.db*` del backup sobre `backend/data/`.
3. `git checkout` al commit correspondiente a ese backup (el código y la BD deben ser coherentes entre sí — restaurar una BD vieja con código nuevo puede fallar si el código nuevo asume una columna que la BD restaurada no tiene todavía).
4. `pm2 restart hokage-backend`.
5. Verificar `/api/health` y una sesión manual básica antes de considerarlo resuelto.

### 10.3 Qué no hacer

- No editar `hokage-os.db` a mano en producción para "arreglar" algo rápido — cualquier corrección de datos pasa por una migración aditiva nueva, revisada como el resto del código, nunca por un `UPDATE` manual sin registro.
- No hacer rollback de código sin considerar si alguna migración aditiva ya corrió — es seguro en el sentido de "no rompe", pero el código viejo restaurado no sabrá aprovechar columnas nuevas hasta que se vuelva a desplegar la versión correspondiente.

---

## 11. Monitorización post-deploy

Lo que ya existe y se reutiliza (nada nuevo que construir para esto):
- `GET /api/health` — estado del proceso, `runtime.isRunning()`, número de clientes WS conectados. Apto para un health check externo (UptimeRobot, o el propio `curl` en un cron).
- `pm2 logs` / `pm2 monit` — CPU, memoria, reinicios del proceso.
- `pm2 startup` ya cubre "el proceso revive si el VPS se reinicia".

Lo que está diseñado pero no implementado, fuera de alcance de este despliegue inicial:
- Notificación Telegram cuando el proceso cae o un agente falla 3 veces seguidas (`Roadmap.md`, Fase 5, pendiente de `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`).
- Persistencia del Event Bus (`event_log`, **Fase 2** de `UI Implementation Plan.md`) — una vez implementada, da visibilidad histórica real más allá de los logs de PM2.

---

## 12. Checklist final antes de ir a producción

- [ ] **A.2 resuelto en código** (bind a loopback + auth de WebSocket) — bloqueante, ver §0.
- [ ] `backend/.env` y `frontend/.env` creados en el VPS con los valores reales, permisos `600`.
- [ ] `FRONTEND_URL` fijado al dominio real (`server.ts` lo necesita para CORS).
- [ ] `NODE_ENV=production` fijado para PM2 (evita filtrar stack traces).
- [ ] Nginx configurado con los 3 `location` de §6.2, TLS vía Certbot activo.
- [ ] PM2 con `pm2 save` + `pm2 startup` ejecutados (sobrevive a reinicio del VPS).
- [ ] Backup inicial de la BD recién sembrada tomado y verificado (`§8.2`, confirmar que el archivo `.backup` generado abre correctamente).
- [ ] `GET /api/health` responde `ok` desde fuera del VPS (vía el dominio, no solo `localhost`).
- [ ] Sesión manual completa desde el navegador: boot, mapa, WebSocket conecta, una sala abre, una decisión se aprueba.
- [ ] Cron de backup diario instalado y confirmado que corre (revisar el primer backup automático al día siguiente, no asumir).

---

No se ha desplegado nada ni modificado código para producir este documento.
