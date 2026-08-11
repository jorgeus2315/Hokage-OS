import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constantTimeEqual, buildSafeExecEnv } from './security.js';
import { sendError, structuredErrorHandler, type AppError } from '../middleware/errorHandler.js';

// ═══ Tests de endurecimiento (Fase 6): comparación de token, saneado de env, no-fuga en 5xx. ═══

test('constantTimeEqual: solo coincide con valor idéntico', () => {
  assert.equal(constantTimeEqual('secreto-largo', 'secreto-largo'), true);
  assert.equal(constantTimeEqual('secreto-largo', 'secreto-larga'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);   // longitudes distintas
  assert.equal(constantTimeEqual('', ''), false);          // vacío nunca coincide
  assert.equal(constantTimeEqual(undefined, 'abc'), false);
  assert.equal(constantTimeEqual('abc', undefined), false);
});

test('buildSafeExecEnv: elimina secretos, conserva lo operativo', () => {
  const base = {
    PATH: '/usr/bin', HOME: '/home/x', LANG: 'es_ES.UTF-8', NORMAL_VAR: 'ok',
    OPENROUTER_API_KEY: 'sk-xxx', ADMIN_TOKEN: 'tok', ANTHROPIC_API_KEY: 'a',
    MY_SECRET: 's', FOO_TOKEN: 't', DB_PASSWORD: 'p', SOME_PRIVATE_KEY: 'k',
  };
  const safe = buildSafeExecEnv(base);
  // conservados
  assert.equal(safe.PATH, '/usr/bin');
  assert.equal(safe.HOME, '/home/x');
  assert.equal(safe.LANG, 'es_ES.UTF-8');
  assert.equal(safe.NORMAL_VAR, 'ok');
  // eliminados (denylist + patrón)
  for (const k of ['OPENROUTER_API_KEY', 'ADMIN_TOKEN', 'ANTHROPIC_API_KEY', 'MY_SECRET', 'FOO_TOKEN', 'DB_PASSWORD', 'SOME_PRIVATE_KEY']) {
    assert.equal(safe[k], undefined, `${k} debería estar eliminado`);
  }
});

// Mock mínimo de Response de Express.
function mockRes() {
  return {
    statusCode: 0,
    body: null as Record<string, unknown> | null,
    req: { headers: {} as Record<string, string> },
    status(s: number) { this.statusCode = s; return this; },
    json(b: Record<string, unknown>) { this.body = b; return this; },
  };
}

test('errorHandler: un 5xx NO filtra el mensaje interno al cliente (sin dev)', () => {
  const prev = process.env.NODE_ENV;
  delete process.env.NODE_ENV; // producción
  try {
    const res = mockRes();
    const err = new Error('SQLITE_ERROR: no such table: /ruta/interna') as AppError;
    err.status = 500;
    structuredErrorHandler(err, res.req as never, res as never, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body?.error, 'Error interno del servidor'); // genérico
    assert.equal(res.body?.stack, undefined);
    assert.equal((res.body as { error: string }).error.includes('SQLITE'), false);
  } finally {
    if (prev !== undefined) process.env.NODE_ENV = prev;
  }
});

test('errorHandler: un 4xx SÍ conserva el mensaje de validación', () => {
  const res = mockRes();
  const err = new Error('Venture inexistente: 999') as AppError;
  err.status = 400;
  structuredErrorHandler(err, res.req as never, res as never, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body?.error, 'Venture inexistente: 999');
});

test('sendError: honra el status del llamador (4xx conserva mensaje, 5xx se genericiza)', () => {
  const prev = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  try {
    const r4 = mockRes();
    sendError(r4 as never, 400, new Error('texto vacío'), 'fallback');
    assert.equal(r4.statusCode, 400);
    assert.equal(r4.body?.error, 'texto vacío');

    const r5 = mockRes();
    sendError(r5 as never, 500, new Error('detalle interno /home/app/x.ts:42'), 'fallback');
    assert.equal(r5.statusCode, 500);
    assert.equal(r5.body?.error, 'Error interno del servidor');
  } finally {
    if (prev !== undefined) process.env.NODE_ENV = prev;
  }
});
