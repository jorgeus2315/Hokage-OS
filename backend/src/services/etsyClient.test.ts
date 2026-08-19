import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { initSchema } from '../db/init.js';
import { tokenStore } from './integrationTokenStore.js';
import {
  generateCodeVerifier, deriveCodeChallenge, buildAuthorizeUrl,
  exchangeCode, getListings, getConnectionStatus, EtsyNotConnectedError,
} from './etsyClient.js';

// ═══ Fase 4 · Slice 1 — EtsyClient (OAuth + lectura), sin credenciales reales. ═══
// fetch se mockea por URL; las credenciales de app vienen de env de test.

const realFetch = globalThis.fetch;
before(async () => {
  await initSchema();
  process.env.ETSY_CLIENT_ID = 'test-keystring';
  process.env.ETSY_CLIENT_SECRET = 'test-secret';
  process.env.ETSY_REDIRECT_URI = 'https://localhost/callback';
});
afterEach(() => { globalThis.fetch = realFetch; });

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

// Un venture distinto por test para aislar el estado del token store.
let vseq = 1000;
const nextVenture = () => ++vseq;

test('PKCE: code_challenge = base64url(sha256(verifier))', () => {
  const v = generateCodeVerifier();
  const expected = crypto.createHash('sha256').update(v).digest('base64url');
  assert.equal(deriveCodeChallenge(v), expected);
  assert.notEqual(v, deriveCodeChallenge(v));   // challenge ≠ verifier
});

test('buildAuthorizeUrl incluye todos los parámetros OAuth+PKCE', () => {
  const url = new URL(buildAuthorizeUrl({ state: 'st4te', codeChallenge: 'chall' }));
  assert.equal(url.origin + url.pathname, 'https://www.etsy.com/oauth/connect');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'test-keystring');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://localhost/callback');
  assert.equal(url.searchParams.get('scope'), 'listings_r transactions_r');
  assert.equal(url.searchParams.get('state'), 'st4te');
  assert.equal(url.searchParams.get('code_challenge'), 'chall');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('exchangeCode guarda tokens y getConnectionStatus los refleja sin exponerlos', async () => {
  const ventureId = nextVenture();
  globalThis.fetch = (async (u: any) => {
    assert.ok(String(u).includes('/public/oauth/token'));
    return jsonResponse({ access_token: '42.acc', refresh_token: '42.ref', expires_in: 3600, scope: 'listings_r transactions_r' });
  }) as typeof fetch;

  await exchangeCode({ code: 'abc', codeVerifier: 'ver', ventureId });

  const status = await getConnectionStatus(ventureId);
  assert.equal(status.connected, true);
  assert.equal(status.scope, 'listings_r transactions_r');
  assert.ok(status.expiresAt && Date.parse(status.expiresAt) > Date.now());
  // F3: el status NO contiene tokens
  assert.equal((status as any).accessToken, undefined);
  assert.equal((status as any).refreshToken, undefined);

  const stored = await tokenStore.getTokens('etsy', ventureId);
  assert.equal(stored?.accessToken, '42.acc');
  assert.equal(stored?.refreshToken, '42.ref');
});

test('getListings sin conexión lanza EtsyNotConnectedError', async () => {
  await assert.rejects(() => getListings(nextVenture()), (e) => e instanceof EtsyNotConnectedError);
});

test('getListings refresca token vencido, resuelve shop y mapea listings', async () => {
  const ventureId = nextVenture();
  // Semilla: token vencido (expiresAt en el pasado).
  await tokenStore.saveTokens({
    provider: 'etsy', ventureId, accessToken: '42.old', refreshToken: '42.oldref',
    expiresAt: new Date(Date.now() - 60_000).toISOString(), scope: 'listings_r transactions_r',
  });
  globalThis.fetch = (async (u: any) => {
    const url = String(u);
    if (url.includes('/public/oauth/token')) return jsonResponse({ access_token: '42.new', refresh_token: '42.ref2', expires_in: 3600 });
    if (url.includes('/users/42/shops')) return jsonResponse({ results: [{ shop_id: 999 }] });
    if (url.includes('/shops/999/listings')) return jsonResponse({ count: 1, results: [{ listing_id: 111, title: 'Poster', price: { amount: 1500, divisor: 100, currency_code: 'USD' }, url: 'https://etsy.com/l/111' }] });
    return jsonResponse({}, 404);
  }) as typeof fetch;

  const out = await getListings(ventureId, { limit: 10 });
  assert.equal(out.total, 1);
  assert.deepEqual(out.items[0], { id: '111', title: 'Poster', price: 15, currency: 'USD', url: 'https://etsy.com/l/111' });

  // El token refrescado se persistió.
  const stored = await tokenStore.getTokens('etsy', ventureId);
  assert.equal(stored?.accessToken, '42.new');
  assert.equal(stored?.refreshToken, '42.ref2');
});

test('refresh defensivo: si la respuesta no trae refresh_token, se conserva el anterior', async () => {
  const ventureId = nextVenture();
  await tokenStore.saveTokens({
    provider: 'etsy', ventureId, accessToken: '42.old', refreshToken: '42.keepref',
    expiresAt: new Date(Date.now() - 60_000).toISOString(), scope: 'listings_r transactions_r',
  });
  globalThis.fetch = (async (u: any) => {
    const url = String(u);
    if (url.includes('/public/oauth/token')) return jsonResponse({ access_token: '42.new2', expires_in: 3600 }); // SIN refresh_token
    if (url.includes('/users/42/shops')) return jsonResponse({ results: [{ shop_id: 999 }] });
    if (url.includes('/shops/999/listings')) return jsonResponse({ count: 0, results: [] });
    return jsonResponse({}, 404);
  }) as typeof fetch;

  await getListings(ventureId);
  const stored = await tokenStore.getTokens('etsy', ventureId);
  assert.equal(stored?.accessToken, '42.new2');
  assert.equal(stored?.refreshToken, '42.keepref');   // conservado
});

test('error HTTP de Etsy se propaga saneado (sin secretos)', async () => {
  const ventureId = nextVenture();
  await tokenStore.saveTokens({
    provider: 'etsy', ventureId, accessToken: '42.acc', refreshToken: '42.ref',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scope: 'listings_r',
  });
  globalThis.fetch = (async () => jsonResponse({ error: 'invalid_shop' }, 404)) as typeof fetch;
  await assert.rejects(() => getListings(ventureId), (e: any) => {
    assert.match(e.message, /Etsy .* falló: HTTP 404/);
    assert.doesNotMatch(e.message, /42\.acc|42\.ref|test-secret/);   // nunca tokens/secretos
    return true;
  });
});
