import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, get } from '../db/init.js';
import { tokenStore } from './integrationTokenStore.js';
import type { IntegrationTokens } from '../types/index.js';

// ═══ Fase 4 · Slice 1 — TokenStore (integration_tokens): roundtrip + upsert. ═══

before(async () => { await initSchema(); });

const mk = (ventureId: number, over: Partial<IntegrationTokens> = {}): IntegrationTokens => ({
  provider: 'etsy', ventureId, accessToken: 'acc', refreshToken: 'ref',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scope: 'listings_r transactions_r', ...over,
});

test('save + get roundtrip', async () => {
  const v = 2001;
  await tokenStore.saveTokens(mk(v));
  const got = await tokenStore.getTokens('etsy', v);
  assert.equal(got?.accessToken, 'acc');
  assert.equal(got?.refreshToken, 'ref');
  assert.equal(got?.scope, 'listings_r transactions_r');
  assert.equal(got?.ventureId, v);
});

test('getTokens inexistente → null', async () => {
  assert.equal(await tokenStore.getTokens('etsy', 999999), null);
});

test('upsert por (provider, venture): segundo save reemplaza, sin duplicar fila', async () => {
  const v = 2002;
  await tokenStore.saveTokens(mk(v, { accessToken: 'acc1', refreshToken: 'ref1' }));
  await tokenStore.saveTokens(mk(v, { accessToken: 'acc2', refreshToken: 'ref2' }));

  const got = await tokenStore.getTokens('etsy', v);
  assert.equal(got?.accessToken, 'acc2');
  assert.equal(got?.refreshToken, 'ref2');

  const rows = await get<{ n: number }>('SELECT COUNT(*) as n FROM integration_tokens WHERE provider = ? AND venture_id = ?', ['etsy', v]);
  assert.equal(rows?.n, 1);
});
