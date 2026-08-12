import crypto from 'node:crypto';
import { constantTimeEqual } from './security.js';

// ═══════════════════════════════════════════════════════════════════════════
// session — autenticación de sesión de operador único (Fase 10).
// ═══════════════════════════════════════════════════════════════════════════
//
// El backend sigue siendo la autoridad (F6). El navegador SOLO recibe una cookie de sesión
// HttpOnly; el ADMIN_TOKEN nunca sale al cliente ni vive en el bundle. La credencial de login
// se compara con ADMIN_TOKEN en tiempo constante (mecanismo de F6). Store en memoria: un solo
// operador, un solo proceso; un reinicio del backend obliga a re-login (aceptable, documentado).

export const SESSION_COOKIE = 'hokage_session';
const TTL_MS = 12 * 60 * 60 * 1000; // 12 h — expiración absoluta

// sessionId → expiración (ms epoch)
const SESSIONS = new Map<string, number>();

export function createSession(): string {
  const id = crypto.randomBytes(32).toString('hex');
  SESSIONS.set(id, Date.now() + TTL_MS);
  return id;
}

// Regeneración tras login: destruye la sesión previa (anti session-fixation) y crea una nueva.
export function regenerateSession(previousId?: string | null): string {
  if (previousId) SESSIONS.delete(previousId);
  return createSession();
}

export function validateSession(id: string | undefined | null): boolean {
  if (!id) return false;
  const exp = SESSIONS.get(id);
  if (exp === undefined) return false;
  if (Date.now() > exp) { SESSIONS.delete(id); return false; } // expirada → limpiar
  return true;
}

export function destroySession(id: string | undefined | null): void {
  if (id) SESSIONS.delete(id);
}

export function activeSessionCount(): number {
  let n = 0;
  const now = Date.now();
  for (const exp of SESSIONS.values()) if (exp > now) n++;
  return n;
}

// Solo para tests deterministas de expiración: fuerza el vencimiento de una sesión.
export function _expireForTest(id: string): void {
  if (SESSIONS.has(id)) SESSIONS.set(id, Date.now() - 1);
}

// ── Cookies ──────────────────────────────────────────────────────────────────
export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function serializeSessionCookie(id: string, opts: { secure: boolean }): string {
  const attrs = [
    `${SESSION_COOKIE}=${id}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ];
  if (opts.secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie(opts: { secure: boolean }): string {
  const attrs = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (opts.secure) attrs.push('Secure');
  return attrs.join('; ');
}

// ── Decisión de autenticación + CSRF (PURA — testeable sin servidor) ─────────
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export function isMutating(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
}

// Origin permitido (defensa CSRF para el camino de sesión): el Origin (o el Referer como
// fallback) debe ser un origen de confianza. Un POST forjado desde otro sitio traería un
// Origin ajeno → rechazado (además de SameSite=Lax en la cookie).
export function originAllowed(origin: string | undefined, referer: string | undefined, trusted: Set<string>): boolean {
  const o = origin || originOf(referer);
  return !!o && trusted.has(o);
}

export interface AuthInput {
  method: string;
  adminTokenHeader?: string;   // x-admin-token / Bearer (clientes máquina/CLI)
  cookieHeader?: string;
  origin?: string;
  referer?: string;
}
export interface AuthConfig {
  adminToken: string | undefined;
  trustedOrigins: Set<string>;
}

// Autoridad backend: token válido (máquina, no vulnerable a CSRF por ser cabecera custom) O
// sesión válida (navegador). Para mutaciones por sesión se exige Origin de confianza (CSRF).
export function evaluateAuth(input: AuthInput, cfg: AuthConfig): { ok: boolean; status: number; reason?: string } {
  if (input.adminTokenHeader && constantTimeEqual(input.adminTokenHeader, cfg.adminToken)) {
    return { ok: true, status: 200 }; // auth por token (CLI/máquina) — sin CSRF (cabecera custom)
  }
  const sid = parseCookies(input.cookieHeader)[SESSION_COOKIE];
  if (validateSession(sid)) {
    if (isMutating(input.method) && !originAllowed(input.origin, input.referer, cfg.trustedOrigins)) {
      return { ok: false, status: 403, reason: 'csrf' };
    }
    return { ok: true, status: 200 };
  }
  return { ok: false, status: 401, reason: 'unauthenticated' };
}
