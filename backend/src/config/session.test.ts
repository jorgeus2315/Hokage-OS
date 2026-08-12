import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession, regenerateSession, validateSession, destroySession, _expireForTest,
  parseCookies, serializeSessionCookie, clearSessionCookie, originAllowed, evaluateAuth, SESSION_COOKIE,
} from './session.js';

// ═══ Tests de autenticación de sesión + CSRF (Fase 10). evaluateAuth es la autoridad real
// que usan requireAdmin y el gate global de /api. Puros, sin servidor. ═══

const CFG = { adminToken: 'admin-token-xyz', trustedOrigins: new Set(['http://localhost:5173']) };
const cookie = (id: string) => `foo=1; ${SESSION_COOKIE}=${id}; bar=2`;

test('sesión: crear → válida; destruir → inválida', () => {
  const id = createSession();
  assert.equal(validateSession(id), true);
  destroySession(id);
  assert.equal(validateSession(id), false);
});

test('sesión expirada → inválida', () => {
  const id = createSession();
  _expireForTest(id);
  assert.equal(validateSession(id), false);
});

test('regeneración: destruye la sesión previa y crea otra distinta (anti session-fixation)', () => {
  const old = createSession();
  const neu = regenerateSession(old);
  assert.notEqual(neu, old);
  assert.equal(validateSession(old), false);
  assert.equal(validateSession(neu), true);
});

test('cookie: flags correctos (HttpOnly, SameSite=Lax, Path, Max-Age, Secure condicional)', () => {
  const insecure = serializeSessionCookie('abc', { secure: false });
  assert.match(insecure, /HttpOnly/);
  assert.match(insecure, /SameSite=Lax/);
  assert.match(insecure, /Path=\//);
  assert.match(insecure, /Max-Age=\d+/);
  assert.ok(!/Secure/.test(insecure), 'sin Secure en http (dev)');
  assert.match(serializeSessionCookie('abc', { secure: true }), /Secure/);
  assert.match(clearSessionCookie({ secure: false }), /Max-Age=0/);
});

test('parseCookies extrae la cookie de sesión', () => {
  assert.equal(parseCookies(cookie('xyz'))[SESSION_COOKIE], 'xyz');
  assert.deepEqual(parseCookies(undefined), {});
});

test('originAllowed: confianza por Origin y fallback a Referer', () => {
  assert.equal(originAllowed('http://localhost:5173', undefined, CFG.trustedOrigins), true);
  assert.equal(originAllowed('http://evil.com', undefined, CFG.trustedOrigins), false);
  assert.equal(originAllowed(undefined, 'http://localhost:5173/x', CFG.trustedOrigins), true);
  assert.equal(originAllowed(undefined, undefined, CFG.trustedOrigins), false);
});

test('evaluateAuth: sin credenciales → 401', () => {
  const r = evaluateAuth({ method: 'GET' }, CFG);
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test('evaluateAuth: token de máquina válido → ok en cualquier método, sin CSRF', () => {
  assert.equal(evaluateAuth({ method: 'POST', adminTokenHeader: 'admin-token-xyz' }, CFG).ok, true);
  assert.equal(evaluateAuth({ method: 'GET', adminTokenHeader: 'admin-token-xyz' }, CFG).ok, true);
  assert.equal(evaluateAuth({ method: 'POST', adminTokenHeader: 'incorrecto' }, CFG).ok, false);
});

test('evaluateAuth: sesión válida + GET → ok (endpoint sensible con sesión)', () => {
  const id = createSession();
  assert.equal(evaluateAuth({ method: 'GET', cookieHeader: cookie(id) }, CFG).ok, true);
});

test('evaluateAuth: mutación por sesión exige Origin de confianza (CSRF)', () => {
  const id = createSession();
  assert.equal(evaluateAuth({ method: 'POST', cookieHeader: cookie(id), origin: 'http://localhost:5173' }, CFG).ok, true);
  const evil = evaluateAuth({ method: 'POST', cookieHeader: cookie(id), origin: 'http://evil.com' }, CFG);
  assert.equal(evil.ok, false);
  assert.equal(evil.status, 403);
  assert.equal(evil.reason, 'csrf');
  const noOrigin = evaluateAuth({ method: 'DELETE', cookieHeader: cookie(id) }, CFG);
  assert.equal(noOrigin.ok, false);
  assert.equal(noOrigin.status, 403);
});

test('evaluateAuth: cookie de sesión inexistente → 401 (endpoint sensible sin sesión)', () => {
  assert.equal(evaluateAuth({ method: 'GET', cookieHeader: cookie('no-existe') }, CFG).ok, false);
  assert.equal(evaluateAuth({ method: 'GET', cookieHeader: cookie('no-existe') }, CFG).status, 401);
});
