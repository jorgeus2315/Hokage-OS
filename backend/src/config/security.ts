import crypto from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// security — helpers deterministas de endurecimiento (Fase 6). Sin estado.
// Viven aquí (no en server.ts) para poder testearlos sin arrancar el servidor.
// ═══════════════════════════════════════════════════════════════════════════

// Comparación de tokens en tiempo constante — evita el side-channel de timing de `===`.
// Devuelve false si alguno falta o difiere en longitud (la longitud no es secreta).
export function constantTimeEqual(provided: string | undefined | null, expected: string | undefined | null): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Variables que NUNCA deben viajar al proceso hijo de system.exec (Hermes). Un comando
// aprobado no debe poder exfiltrar secretos vía `env`/`echo $VAR`. Se filtran por nombre y
// por patrón (cualquier *_KEY / *TOKEN / *SECRET / *PASSWORD, además de los explícitos).
const EXEC_ENV_DENYLIST = new Set([
  'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ADMIN_TOKEN',
  'AI_MODEL', 'FRONTEND_URL', 'HOKAGE_DB_PATH',
]);
const EXEC_ENV_DENY_PATTERN = /(_KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)/i;

// Construye el entorno del proceso hijo de system.exec quitando cualquier secreto. Parte del
// entorno actual (para conservar PATH/HOME/idioma, que los comandos legítimos necesitan) y
// elimina lo sensible. NO amplía capacidades — solo reduce lo que el hijo puede leer.
export function buildSafeExecEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (EXEC_ENV_DENYLIST.has(key)) continue;
    if (EXEC_ENV_DENY_PATTERN.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}
