import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initSchema, run } from '../db/init.js';
import { tokenStore } from '../services/integrationTokenStore.js';
// Se importa el tool VÍA registry.js (no ./index.js) a propósito: index.ts ↔ registry.ts
// forman un ciclo (aiService → registry → index, documentado en agentMemoryService.ts).
// registry.js es la entrada segura — carga index.ts completo antes de construir su Map, así
// que evita el TDZ "Cannot access 'EtsyTool' before initialization". No se toca código fuente.
import { get as getTool } from './registry.js';
import { toolsForRole } from '../config/agentModels.js';
import type { EtsyReceiptOutput, EtsyMockReceiptOutput, SalesRecordOutput } from './types.js';

let salesVentureSeq = 9000;
const nextSalesVenture = async () => {
  const id = ++salesVentureSeq;
  await run(`INSERT INTO ventures (id, name, type, status, goal, revenue_target_usd) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, `Test Venture ${id}`, 'store', 'active', 'Test', 1000]);
  return id;
};

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

// ═══ Fase 4.3 — Mock Receipts + Sales Record ═══

test('etsy.mock_receipts: registrado y contrato read-only', () => {
  const tool = getTool('etsy.mock_receipts');
  assert.ok(tool, 'etsy.mock_receipts debe estar registrado');
  assert.equal(tool!.id, 'etsy.mock_receipts');
  assert.equal(tool!.status, 'ready');
  assert.equal(tool!.requiredApproval, false);
  assert.equal(tool!.category, 'marketplace');
});

test('etsy.mock_receipts: genera receipts deterministas sin ventureId → error', async () => {
  const res = await getTool('etsy.mock_receipts')!.execute({ limit: 5 }, { agentId: 1 });
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /ventureId/);
});

test('etsy.mock_receipts: genera receipts deterministas con ventureId', async () => {
  const ventureId = 9001;
  const res1 = await getTool('etsy.mock_receipts')!.execute({ limit: 5 }, { agentId: 1, ventureId });
  const res2 = await getTool('etsy.mock_receipts')!.execute({ limit: 5 }, { agentId: 1, ventureId });
  const data1 = res1.data as EtsyMockReceiptOutput;
  const data2 = res2.data as EtsyMockReceiptOutput;

  assert.equal(res1.ok, true);
  assert.equal(res2.ok, true);
  assert.equal(data1.total, 5);
  assert.equal(data2.total, 5);
  // Determinista: misma secuencia en ambas llamadas
  for (let i = 0; i < 5; i++) {
    assert.equal(data1.items[i].id, data2.items[i].id, `Receipt ${i} debe ser idéntico entre llamadas`);
    assert.equal(data1.items[i].total, data2.items[i].total);
    assert.equal(data1.items[i].currency, data2.items[i].currency);
    assert.equal(data1.items[i].status, data2.items[i].status);
    assert.ok(data1.items[i].createdAt && data1.items[i].createdAt.startsWith('20'));
  }
  // Verifica que NUNCA llama a fetch real
  let fetchCalled = false;
  globalThis.fetch = (async () => { fetchCalled = true; return new Response('{}'); }) as typeof fetch;
  await getTool('etsy.mock_receipts')!.execute({ limit: 1 }, { agentId: 1, ventureId });
  assert.equal(fetchCalled, false, 'etsy.mock_receipts NO debe llamar a fetch real');
});

test('etsy.mock_receipts: venture isolation — V1 y V2 generan IDs distintos', async () => {
  const v1 = await getTool('etsy.mock_receipts')!.execute({ limit: 3 }, { agentId: 1, ventureId: 100 });
  const v2 = await getTool('etsy.mock_receipts')!.execute({ limit: 3 }, { agentId: 1, ventureId: 200 });
  const d1 = v1.data as EtsyMockReceiptOutput;
  const d2 = v2.data as EtsyMockReceiptOutput;

  assert.equal(v1.ok, true);
  assert.equal(v2.ok, true);
  // IDs contienen ventureId en el prefijo
  for (const item of d1.items) assert.ok(item.id.startsWith('mock_100_'));
  for (const item of d2.items) assert.ok(item.id.startsWith('mock_200_'));
});

test('sales.record: registrado y contrato operational', () => {
  const tool = getTool('sales.record');
  assert.ok(tool, 'sales.record debe estar registrado');
  assert.equal(tool!.id, 'sales.record');
  assert.equal(tool!.status, 'ready');
  assert.equal(tool!.requiredApproval, false);
  assert.equal(tool!.category, 'pipeline');
});

test('sales.record: sin ventureId → error', async () => {
  const res = await getTool('sales.record')!.execute(
    { receipts: [{ id: 'r1', total: 10, currency: 'USD', status: 'paid', createdAt: new Date().toISOString() }] },
    { agentId: 1 }
  );
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /ventureId/);
});

test('sales.record: inserta ventas nuevas y emite sale.received', async () => {
  const ventureId = await nextSalesVenture();
  const receipts = [
    { id: `sale_${ventureId}_a`, total: 25.50, currency: 'USD', status: 'paid', createdAt: '2024-01-15T10:00:00Z' },
    { id: `sale_${ventureId}_b`, total: 12.00, currency: 'EUR', status: 'paid', createdAt: '2024-01-16T14:00:00Z' },
  ];
  const res = await getTool('sales.record')!.execute({ receipts }, { agentId: 1, ventureId });
  const data = res.data as SalesRecordOutput;

  assert.equal(res.ok, true);
  assert.equal(data.recorded, 2);
  assert.equal(data.skipped, 0);
  assert.equal(data.total, 2);

  // Verificar en BD
  const { get } = await import('../db/init.js');
  const count = await get<{ c: number }>('SELECT COUNT(*) as c FROM sales WHERE venture_id = ?', [ventureId]);
  assert.equal(count?.c, 2);
});

test('sales.record: deduplicación — segunda llamada no duplica', async () => {
  const ventureId = await nextSalesVenture();
  const receipts = [
    { id: `sale_${ventureId}_x`, total: 30, currency: 'USD', status: 'paid', createdAt: '2024-01-10T08:00:00Z' },
  ];
  // Primera inserción
  const r1 = await getTool('sales.record')!.execute({ receipts }, { agentId: 1, ventureId });
  assert.equal(r1.ok, true);
  const d1 = r1.data as SalesRecordOutput;
  assert.equal(d1.recorded, 1);
  assert.equal(d1.skipped, 0);

  // Segunda inserción del mismo receipt
  const r2 = await getTool('sales.record')!.execute({ receipts }, { agentId: 1, ventureId });
  assert.equal(r2.ok, true);
  const d2 = r2.data as SalesRecordOutput;
  assert.equal(d2.recorded, 0, 'Segunda llamada no debe insertar de nuevo');
  assert.equal(d2.skipped, 1, 'Debe contarse como skipped');

  // Verificar en BD: solo 1 fila
  const { get } = await import('../db/init.js');
  const count = await get<{ c: number }>('SELECT COUNT(*) as c FROM sales WHERE venture_id = ?', [ventureId]);
  assert.equal(count?.c, 1, 'BD debe tener solo 1 fila por UNIQUE(venture_id, receipt_id)');
});

test('sales.record: venture isolation — V1 no afecta V2', async () => {
  const v1 = await nextSalesVenture();
  const v2 = await nextSalesVenture();
  const receipts = [
    { id: `sale_shared_1`, total: 10, currency: 'USD', status: 'paid', createdAt: '2024-01-01T00:00:00Z' },
  ];

  await getTool('sales.record')!.execute({ receipts }, { agentId: 1, ventureId: v1 });
  await getTool('sales.record')!.execute({ receipts }, { agentId: 1, ventureId: v2 });

  const { get } = await import('../db/init.js');
  const c1 = await get<{ c: number }>('SELECT COUNT(*) as c FROM sales WHERE venture_id = ?', [v1]);
  const c2 = await get<{ c: number }>('SELECT COUNT(*) as c FROM sales WHERE venture_id = ?', [v2]);
  assert.equal(c1?.c, 1);
  assert.equal(c2?.c, 1);
});

test('sales.record: array vacío → ok con ceros', async () => {
  const res = await getTool('sales.record')!.execute({ receipts: [] }, { agentId: 1, ventureId: 9995 });
  const data = res.data as SalesRecordOutput;
  assert.equal(res.ok, true);
  assert.equal(data.recorded, 0);
  assert.equal(data.skipped, 0);
  assert.equal(data.total, 0);
});

test('grant: finanzas tiene etsy.mock_receipts y sales.record', () => {
  const tools = toolsForRole('finanzas');
  assert.ok(tools.includes('etsy.mock_receipts'), 'finanzas debe tener etsy.mock_receipts');
  assert.ok(tools.includes('sales.record'), 'finanzas debe tener sales.record');
});
