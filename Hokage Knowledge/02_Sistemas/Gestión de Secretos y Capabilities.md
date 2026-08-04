> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §11.2. Congelado — v2, definitiva.
> Separada de [[Seguridad, Permisos y VPS]] el 2026-08-05 — auditoría de estructura: 4+ sistemas (Plugin System, Economía v2, Voz, Founder Profile) citaban específicamente este apartado como su propio sistema, nunca §11 entero. Más fiel a "un sistema, una nota".

## Secretos y credenciales

🔒 **CONGELADO — v2, definitiva.** Jorge aceptó el diseño base (v1, abajo conservado como fundamento) y pidió reforzarlo con tres principios de crecimiento antes de darlo por cerrado. Los tres son compatibles — se evaluaron, no se aceptaron a ciegas — con un límite honesto anotado explícitamente donde correspondía, no disimulado.

#### Por qué importa

Hoy solo existen 2 secretos (`OPENROUTER_API_KEY`, `ADMIN_TOKEN`), gestionados a mano. El [[Founder Profile y La Fundación|Setup Wizard (§12.3)]] y los Business Modules ([[Plugin System - Arquitectura Completa|§8.4]]) van a necesitar credenciales de Etsy, Shopify, GitHub, futuros servidores MCP ([[Plugin System - Arquitectura Completa|§8.5]]) y lo que venga.

#### El problema de fondo (fundamento v1, sigue vigente)

Hay **dos tipos de secreto completamente distintos**:

1. **Estáticos** (`OPENROUTER_API_KEY`, un GitHub PAT): no rotan solos.
2. **OAuth2 con refresh** (Etsy, Shopify): el `access_token` caduca en horas y se renueva solo con un `refresh_token` — no puede vivir en `.env`, algo tiene que escribirlo automáticamente.

**Alternativas evaluadas (sin cambios respecto a la v1):** A (todo en `.env`) no resuelve OAuth. B (todo cifrado en SQLite, el Wizard escribe vía formulario) contradice la instrucción explícita de no escribir secretos por HTTP y además crea un problema circular (la clave maestra que cifraría la BD tiene que vivir en algún sitio — vuelve a ser `.env`, protegiendo algo más grande). **C — híbrido — sigue siendo la decisión correcta**, ahora reforzada con tres capas que la hacen sustituible, capaz y multi-venture sin reescribirse.

#### Los tres principios, evaluados

**1. `SecretProvider` — todo el sistema depende de una interfaz, nunca de `.env` directamente.**
Compatible, y corrige un defecto real de la v1: ahí los secretos estáticos se leían con `process.env` directo desde cada Tool, mientras que los OAuth pasaban por un servicio — dos caminos de consumo distintos para el mismo concepto. Se unifican en una única interfaz.

**2. Agentes y Tools piden capacidades (`ai`, `etsy`, `shopify`, `github`), nunca secretos concretos.**
Compatible — es una capa que se coloca encima de `SecretProvider`, no lo sustituye. Beneficio inmediato no pedido pero gratis: si mañana cambia el proveedor de IA, ningún Tool que pida la capacidad `ai` se entera.

**3. Los secretos deben poder pertenecer a un Workspace/Venture, no al servidor.**
Compatible **con un límite explícito**: solo tiene sentido para credenciales **OAuth2** (que ya tienen un sitio propio en la app donde vivir cifradas). Un secreto **estático no puede ser de-venture** — no existe un `.env` por venture, y forzarlo por HTTP violaría la regla ya fijada. Etsy y Shopify, las dos integraciones nombradas, son ambas OAuth2 — el límite no afecta a ningún caso real de hoy. "Workspace" no se construye como tabla nueva: hoy Workspace = la instalación única (igual que en el resto de este documento, §11.1 ya fijó single-owner) — el diseño deja el hueco (`scope`) para que un `workspace_id` se añada después de forma aditiva, exactamente como se hizo con `venture_id` en el resto del Core, sin que eso sea trabajo de hoy.

#### Arquitectura (v2)

```
                    ┌─────────────────────────────────────┐
   Tools/Agentes →  │  CapabilityResolver                  │   Principio 2
                    │  resolve('etsy', { ventureId })      │
                    └──────────────────┬────────────────────┘
                                       │ mira qué SecretDefinition respalda la capability
                    ┌──────────────────▼────────────────────┐
                    │  secret_definitions (SQLite)           │
                    │  id · label · capability · kind        │
                    │  scope ('installation'|'venture')      │
                    │  env_var · required · docs_url          │
                    └──────────────────┬────────────────────┘
                                       │
                    ┌──────────────────▼────────────────────┐
   Principio 1  →   │  SecretProvider (interfaz)              │
                    │  getStatic(envVar)                      │
                    │  getDynamic(defId, ventureId)            │
                    │  setDynamic(defId, ventureId, value)     │  ← solo el propio backend
                    └───────┬──────────────────────┬──────────┘
                            │ kind='static'         │ kind='oauth2'
                            ▼                       ▼
                  ┌──────────────────┐   ┌──────────────────────────┐
                  │ LocalEnvProvider │   │ secret_values (cifrado)   │  Principio 3
                  │ → process.env    │   │ definition_id · venture_id│
                  │ (scope siempre   │   │ (NULL=instalación)        │
                  │  'installation') │   │ value_enc · expires_at     │
                  └──────────────────┘   └──────────────────────────┘
```

Implementaciones futuras de `SecretProvider` (Docker secrets, Vault, AWS Secrets Manager) sustituyen `LocalEnvProvider` entero sin que `CapabilityResolver`, `secret_definitions` ni un solo Tool cambien una línea — es exactamente la garantía que pedía el principio 1.

#### 1. Capacidades — lo único que agentes y Tools conocen

```typescript
// config/capabilities.ts
interface Capability {
  id: string;                 // 'ai' | 'etsy' | 'shopify' | 'github'
  secretDefinitionId: string; // qué definición la resuelve
  scope: 'installation' | 'venture';
}

interface CapabilityResolver {
  resolve(capabilityId: string, ctx?: { ventureId?: number }): Promise<string | null>;
}
```

Un `Tool` nunca llama a `secretProvider.get('etsy_oauth')`. Llama a `capabilities.resolve('etsy', { ventureId: ctx.ventureId })`. El resolver mira qué `SecretDefinition` respalda `'etsy'`, y según su `scope`, delega en `SecretProvider.getStatic()` o `getDynamic(defId, ventureId)`. El Tool nunca sabe si detrás hay `.env`, una tabla cifrada, o Vault.

#### 2. `SecretProvider` — la interfaz que hace todo lo demás sustituible

```typescript
// config/secretProvider.ts
interface SecretProvider {
  getStatic(envVar: string): string | null;
  getDynamic(definitionId: string, ventureId: number | null): Promise<{ value: string; expiresAt?: string } | null>;
  setDynamic(definitionId: string, ventureId: number | null, value: { value: string; expiresAt?: string }): Promise<void>;
}
```

`LocalEnvProvider` (única implementación en v1): `getStatic` lee `process.env`; `getDynamic`/`setDynamic` leen/escriben `secret_values` cifrado (AES-256-GCM, clave en `OAUTH_ENCRYPTION_KEY` del `.env`, alcance mínimo — solo protege esta tabla, no el sistema entero). `setDynamic` **nunca lo invoca una ruta HTTP que reciba un valor de un formulario** — solo el callback OAuth (ver abajo) y el refresco silencioso.

#### 3. Definiciones — código, con `capability` y `scope` explícitos

```typescript
// tools/index.ts, junto a cada Tool — mismo principio que el contrato de Tool, §8.2
export const EtsySecretDefinition: SecretDefinition = {
  id: 'etsy_oauth', label: 'Etsy (OAuth)', capability: 'etsy',
  kind: 'oauth2', scope: 'venture',   // cada venture conecta SU PROPIA tienda Etsy
  docsUrl: 'https://www.etsy.com/developers/register',
  validate: async (ctx) => { /* llamada de lectura mínima a la API de Etsy */ },
};

export const GithubSecretDefinition: SecretDefinition = {
  id: 'github_pat', label: 'GitHub', capability: 'github',
  kind: 'static', scope: 'installation',   // Hermes/despliegue no es de un venture
  envVar: 'GITHUB_PAT',
};
```

Al arrancar, `initSchema()` sincroniza estas definiciones con `secret_definitions` (`INSERT OR REPLACE`, mismo patrón que ya sincroniza `agents.model` contra `agentModels.ts`) — la tabla nunca diverge del código.

#### 4. OAuth2 — la única excepción real a "nunca por HTTP", y ahora venture-aware

Etsy y Shopify redirigen con un `code` de un solo uso — inevitable en OAuth2, y categóricamente distinto de "pegar una API key en un formulario": el `code` no es la credencial, es un ticket que el backend cambia server-to-server.

```
Jorge → GET /api/secrets/etsy_oauth/oauth/start?venture_id=3   (requireAdmin)
      → redirect a Etsy (el `venture_id` viaja en el `state` firmado del OAuth)
Etsy  → el usuario autoriza
      → redirect a GET /api/secrets/etsy_oauth/oauth/callback?code=...&state=...
Backend → valida state → recupera venture_id=3
        → intercambia code por tokens (server-to-server)
        → SecretProvider.setDynamic('etsy_oauth', 3, { value, expiresAt })
        → nunca expone los tokens de vuelta al navegador
```

Cada venture conecta su propia tienda Etsy de forma independiente — `secret_values` tiene `UNIQUE(definition_id, venture_id)`, así que el venture 1 y el venture 2 tienen filas separadas, cifradas por separado. **Renovación**: `getDynamic` comprueba `expires_at`; si venció, usa el `refresh_token` para pedir uno nuevo y llama a `setDynamic` con el resultado — transparente para el Tool.

#### 5. Validación

`validate(ctx?)` en cada `SecretDefinition` — para las `scope='venture'` recibe `{ ventureId }`. `POST /api/secrets/:id/validate?venture_id=N` (requireAdmin) la ejecuta y persiste el resultado junto al valor (en `secret_values` si es de venture, en `secret_definitions` si es de instalación).

#### 6. API expuesta (toda `requireAdmin` salvo el callback)

```
GET  /api/secrets?venture_id=N          → estado de todas las definiciones aplicables
                                            (globales siempre + las de venture si se pasa venture_id)
                                            { id, label, capability, kind, scope, present, last_validated_at, last_validation_ok }
                                            — JAMÁS un valor
POST /api/secrets/:id/validate?venture_id=N
GET  /api/secrets/:id/oauth/start?venture_id=N    (solo kind='oauth2')
GET  /api/secrets/:id/oauth/callback              (público — lo llama el proveedor; protegido por `state`, no por ADMIN_TOKEN)
```

Sigue siendo la fuente real detrás de §12.1 (System Profile, ver [[Founder Profile y La Fundación]]): ahora con `capability`, `scope` y venture opcional.

#### 7. Desarrollo local vs VPS/producción

Sin cambios respecto a la v1: `.env` nunca se commitea, nunca viaja por HTTP, nunca lo genera el Wizard. `secret_values` viaja con el resto de la BD SQLite (ya cifrada en reposo). `OAUTH_ENCRYPTION_KEY` es distinta por entorno, generada una vez, nunca reutilizada. Aplicar un cambio en `.env`: reinicio manual en local, `pm2 restart hokage-backend` en VPS (ver 11.3 abajo). Se mantiene `.env.example` regenerado desde `secret_definitions` (solo las `scope='installation'`, nunca las de venture — esas no tienen entrada en `.env`).

#### Consecuencias a 2-3 años

Una integración nueva declara su `Capability` + `SecretDefinition` junto a su `Tool` — aparece sola en `GET /api/secrets`, ningún Tool existente cambia. Sustituir el backend de secretos (Vault, AWS Secrets Manager) es escribir una clase nueva que implemente `SecretProvider` — cero cambios en `CapabilityResolver`, Tools o rutas. Un segundo, tercer o vigésimo venture conecta su propia Etsy/Shopify sin coordinación entre ellos — cada uno con sus propias filas cifradas, sin que el código sepa ni le importe cuántos hay. El único límite que el diseño no resuelve — un secreto estático de-venture — es exactamente el tipo de problema que no existe todavía: el día que aparezca (una integración sin OAuth2 que necesite credenciales distintas por negocio), la señal de disparo es clara y ya está anotada aquí, no descubierta a medio construir.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Seguridad, Permisos y VPS]] — §11.1 (permisos) y §11.3 (VPS), de donde se separó esta nota
- [[Founder Profile y La Fundación]] — Setup Wizard y System Profile consumen este sistema
- [[Plugin System - Arquitectura Completa]] — Business Modules y MCP necesitan credenciales
- [[Economía v2 - Sistema Financiero]] — FinanceProvider reutiliza este mismo patrón
- [[Arquitectura de Voz - Hermes]] — SttProvider/TtsProvider reutilizan este mismo patrón
- [[Ciclo Día-Noche - World Engine]] — AmbientClockProvider reutiliza este mismo patrón
- [[ADR-005 - Tool Runtime y Plugin Contract]]
- [[Escalabilidad]] — umbral de single-owner → multi-usuario
