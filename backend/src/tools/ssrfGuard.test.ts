import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ipIsPrivate, assertPublicHost, safeFetch } from './ssrfGuard.js';

// ═══ Tests de SSRF (Fase 6). Solo casos SIN red: rangos, IP-literales y esquemas. ═══

test('ipIsPrivate: rangos privados / locales / metadata se bloquean', () => {
  for (const ip of [
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254',                 // metadata cloud (AWS/GCP)
    '100.64.0.1',                      // CGNAT
    '0.0.0.0', '224.0.0.1',
    '::1', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1', '::ffff:127.0.0.1',
  ]) {
    assert.equal(ipIsPrivate(ip), true, `esperaba privada: ${ip}`);
  }
});

test('ipIsPrivate: IPs públicas se permiten', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(ipIsPrivate(ip), false, `esperaba pública: ${ip}`);
  }
});

test('assertPublicHost: IP-literal privada/local lanza (sin DNS)', async () => {
  await assert.rejects(() => assertPublicHost('127.0.0.1'), /privada|local/);
  await assert.rejects(() => assertPublicHost('169.254.169.254'), /privada|local/);
  await assert.rejects(() => assertPublicHost('::1'), /privada|local/);
});

test('assertPublicHost: IP-literal pública no lanza', async () => {
  await assert.doesNotReject(() => assertPublicHost('8.8.8.8'));
});

test('safeFetch: esquemas no http/https se rechazan antes de conectar', async () => {
  await assert.rejects(() => safeFetch('file:///etc/passwd', {}), /Esquema no permitido/);
  await assert.rejects(() => safeFetch('ftp://example.com/', {}), /Esquema no permitido/);
  await assert.rejects(() => safeFetch('gopher://x/', {}), /Esquema no permitido/);
});

test('safeFetch: host IP-literal privado/metadata se bloquea (incl. userinfo e IPv6)', async () => {
  await assert.rejects(() => safeFetch('http://127.0.0.1/', {}), /privada|local/);
  await assert.rejects(() => safeFetch('http://169.254.169.254/latest/meta-data/', {}), /privada|local/);
  await assert.rejects(() => safeFetch('http://[::1]/', {}), /privada|local/);
  // userinfo no debe confundir el hostname real (127.0.0.1)
  await assert.rejects(() => safeFetch('http://expected.com@127.0.0.1/', {}), /privada|local/);
});
