import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema } from '../db/init.js';
import { tokenStore } from '../services/integrationTokenStore.js';
// Se importa el tool VÍA registry.js (no ./index.js) a propósito: index.ts ↔ registry.ts
// forman un ciclo (aiService → registry → index, documentado en agentMemoryService.ts).
// registry.js es la entrada segura — carga index.ts completo antes de construir su Map, así
// que evita el TDZ "Cannot access 'EtsyTool' before initialization". No se toca código fuente.
import { get as getTool } from './registry.js';
import { toolsForRole } from '../config/agentModels.js';
import type { EtsyReceiptOutput } from './types.js';

// ═══ Fase 4 · Slice 2 — Tool etsy.receipts (LECTURA) + grant a trafico. ═══
// fetch se mockea por URL; credenciales de app desde env de test (mismo patrón que
// etsyClient.test.ts). Sin credenciales reales, sin escritura, sin red de verdad.

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

let vseq = 6000;
const nextVenture = () => ++vseq;

test('etsy.receipts: registrado y con contrato read-only', () => {
  const tool = getTool('etsy.receipts');
  assert.ok(tool, 'etsy.receipts debe estar registrado');
  assert.equal(tool!.id, 'etsy.receipts');
  assert.equal(tool!.status, 'ready');
  assert.equal(tool!.requiredApproval, false);
  assert.equal(tool!.category, 'marketplace');
});

test('etsy.receipts: lee receipts del shop propio → forma normalizada', async () => {
  const ventureId = nextVenture();
  await tokenStore.saveTokens({
    provider: 'etsy', ventureId, accessToken: '42.acc', refreshToken: '42.ref',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scope: 'listings_r transactions_r',
  });
  const seen: string[] = [];
  globalThis.fetch = (async (u: any) => {
    const url = String(u);
    seen.push(url);
    if (url.includes('/users/42/shops')) return jsonResponse({ shop_id: 777 });
    if (url.includes('/shops/777/receipts')) {
      return jsonResponse({
        count: 1,
        results: [{ receipt_id: 9, grandtotal: { amount: 2500, divisor: 100, currency_code: 'EUR' }, status: 'paid', created_timestamp: 1700000000 }],
      });
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;

  const res = await getTool('etsy.receipts')!.execute({ limit: 10 }, { agentId: 1, ventureId });
  const data = res.data as EtsyReceiptOutput;

  assert.equal(res.ok, true);
  assert.equal(data.total, 1);
  assert.equal(data.items.length, 1);
  const r = data.items[0];
  assert.equal(r.id, '9');
  assert.equal(r.total, 25);              // 2500 / divisor 100
  assert.equal(r.currency, 'EUR');
  assert.equal(r.status, 'paid');
  assert.ok(r.createdAt && r.createdAt.startsWith('20'));
  // Solo endpoints de lectura (shops + receipts); nunca escritura.
  assert.ok(seen.some((u) => u.includes('/receipts')));
  assert.ok(!seen.some((u) => /\/listings\/\d+|\/images|\/createReceipt/i.test(u)));
});

test('etsy.receipts: sin ventureId → error limpio, sin llamar a la API', async () => {
  let called = false;
  globalThis.fetch = (async () => { called = true; return jsonResponse({}); }) as typeof fetch;
  const res = await getTool('etsy.receipts')!.execute({}, { agentId: 1 });   // ctx sin ventureId
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /ventureId/);
  assert.equal(called, false);
});

test('etsy.receipts: venture no conectada → error EtsyNotConnected, no lanza', async () => {
  const ventureId = nextVenture();   // sin token guardado
  const res = await getTool('etsy.receipts')!.execute({}, { agentId: 1, ventureId });
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /no conectado/i);
});

test('grant: trafico tiene etsy.listings y etsy.receipts (solo lectura)', () => {
  const tools = toolsForRole('trafico');
  assert.ok(tools.includes('etsy.listings'), 'trafico debe tener etsy.listings');
  assert.ok(tools.includes('etsy.receipts'), 'trafico debe tener etsy.receipts');
  assert.ok(!tools.some((t) => t.startsWith('etsy') && /create|publish|update|write/i.test(t)), 'ningún tool etsy de escritura');
});
