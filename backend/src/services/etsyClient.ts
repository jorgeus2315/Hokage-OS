import crypto from 'node:crypto';
import { credentialProvider } from './credentialProvider.js';
import { tokenStore } from './integrationTokenStore.js';
import type { IntegrationTokens, IntegrationStatus } from '../types/index.js';

// Fase 4 · Slice 1 (Etsy LECTURA). OAuth2 Authorization Code + PKCE. Punto único que conoce
// endpoints/cabeceras de Etsy: migrar a otro proveedor o a C.6 no toca a los consumidores.
// F3: ningún token viaja a logs, errores o auditoría.
//
// Endpoints verificados en developers.etsy.com (2026-08):
//   authorize  https://www.etsy.com/oauth/connect
//   token      https://api.etsy.com/v3/public/oauth/token
//   API base   https://api.etsy.com/v3/application
//   listings   GET /shops/{shop_id}/listings   ·   receipts GET /shops/{shop_id}/receipts
// access token TTL 3600s · refresh 90 días. Rotación no confirmada → persistimos siempre el
// refresh_token que devuelva la respuesta (si no viene, se conserva el anterior).

const PROVIDER = 'etsy' as const;
const AUTH_URL = 'https://www.etsy.com/oauth/connect';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
const API_BASE = 'https://api.etsy.com/v3/application';
const SCOPES = ['listings_r', 'transactions_r'];
const REFRESH_SKEW_MS = 60_000;   // refresca 1 min antes del vencimiento

export class EtsyNotConnectedError extends Error {
  constructor(ventureId: number) {
    super(`Etsy no conectado para la venture ${ventureId}`);
    this.name = 'EtsyNotConnectedError';
  }
}

// ─── PKCE / state (puros, testeables sin red) ──────────────────────────────
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}
export function deriveCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
export function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

// x-api-key = `keystring:shared_secret` — OBLIGATORIO en todo endpoint v3 desde el
// 2026-02-09 (antes bastaba el keystring). Verificado en developers.etsy.com. El token
// endpoint es la excepción: NO lleva x-api-key (ver exchangeCode/refresh).
function apiHeaders(clientId: string, sharedSecret: string, accessToken: string): Record<string, string> {
  return { 'x-api-key': `${clientId}:${sharedSecret}`, Authorization: `Bearer ${accessToken}` };
}

export function buildAuthorizeUrl(params: { state: string; codeChallenge: string }): string {
  const { clientId, redirectUri } = credentialProvider.getAppCredentials(PROVIDER);
  const u = new URL(AUTH_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('state', params.state);
  u.searchParams.set('code_challenge', params.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

// El access token de Etsy lleva prefijo numérico `{user_id}.{token}`.
function userIdFromToken(accessToken: string): string {
  const prefix = accessToken.split('.')[0];
  if (!prefix || !/^\d+$/.test(prefix)) throw new Error('Access token de Etsy con formato inesperado');
  return prefix;
}

// Respuesta de token → persistencia. Defensivo con rotación: usa el refresh nuevo si viene,
// si no conserva el anterior. Nunca registra el cuerpo (contiene tokens).
async function persistTokenResponse(ventureId: number, json: any, fallbackRefresh?: string): Promise<IntegrationTokens> {
  const accessToken: string | undefined = json?.access_token;
  const refreshToken: string | undefined = json?.refresh_token ?? fallbackRefresh;
  if (!accessToken || !refreshToken) throw new Error('Respuesta de token de Etsy incompleta');
  const expiresAt = new Date(Date.now() + (Number(json?.expires_in) || 3600) * 1000).toISOString();
  const scope: string = typeof json?.scope === 'string' ? json.scope : SCOPES.join(' ');
  const tokens: IntegrationTokens = { provider: PROVIDER, ventureId, accessToken, refreshToken, expiresAt, scope };
  await tokenStore.saveTokens(tokens);
  return tokens;
}

// Lanza con contexto saneado (status + error público de Etsy), nunca nuestros secretos.
async function parseJsonOrThrow(res: Response, context: string): Promise<any> {
  if (!res.ok) {
    let detail = '';
    try { const b = await res.json() as any; detail = b?.error || b?.error_description || ''; } catch { /* body no-JSON */ }
    throw new Error(`Etsy ${context} falló: HTTP ${res.status}${detail ? ` (${String(detail).slice(0, 120)})` : ''}`);
  }
  return res.json();
}

export async function exchangeCode(input: { code: string; codeVerifier: string; ventureId: number }): Promise<void> {
  const { clientId, redirectUri } = credentialProvider.getAppCredentials(PROVIDER);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code: input.code,
    code_verifier: input.codeVerifier,
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = await parseJsonOrThrow(res, 'intercambio de código');
  await persistTokenResponse(input.ventureId, json);
}

// Access token vigente, refrescando si vence. Devuelve también el user_id derivado del token.
async function getFreshAccess(ventureId: number): Promise<{ accessToken: string; userId: string }> {
  const t = await tokenStore.getTokens(PROVIDER, ventureId);
  if (!t) throw new EtsyNotConnectedError(ventureId);
  if (Date.parse(t.expiresAt) - Date.now() > REFRESH_SKEW_MS) {
    return { accessToken: t.accessToken, userId: userIdFromToken(t.accessToken) };
  }
  const { clientId } = credentialProvider.getAppCredentials(PROVIDER);
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: t.refreshToken });
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = await parseJsonOrThrow(res, 'refresh de token');
  const saved = await persistTokenResponse(ventureId, json, t.refreshToken);
  return { accessToken: saved.accessToken, userId: userIdFromToken(saved.accessToken) };
}

// Resolución de shop: user_id (prefijo del token) → GET /users/{user_id}/shops
// (getShopByOwnerUserId, verificado en developers.etsy.com). La respuesta puede venir como
// objeto directo o envuelta en results[]; se manejan ambas. Toma el primer shop del usuario.
async function resolveShopId(clientId: string, sharedSecret: string, accessToken: string, userId: string): Promise<number> {
  const res = await fetch(`${API_BASE}/users/${userId}/shops`, { headers: apiHeaders(clientId, sharedSecret, accessToken) });
  const json = await parseJsonOrThrow(res, 'resolución de shop');
  const shop = Array.isArray(json?.results) ? json.results[0] : json;
  const shopId = shop?.shop_id;
  if (typeof shopId !== 'number') throw new Error('No se pudo resolver el shop_id de Etsy');
  return shopId;
}

export interface EtsyListing { id: string; title: string; price: number; currency: string; url: string }
export interface EtsyReceipt { id: string; total: number; currency: string; status: string; createdAt: string | null }

// LECTURA: listings activos del shop propio → forma estable {total, items}.
export async function getListings(ventureId: number, opts: { limit?: number } = {}): Promise<{ total: number; items: EtsyListing[] }> {
  const { clientId, sharedSecret } = credentialProvider.getAppCredentials(PROVIDER);
  const { accessToken, userId } = await getFreshAccess(ventureId);
  const shopId = await resolveShopId(clientId, sharedSecret, accessToken, userId);
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const res = await fetch(`${API_BASE}/shops/${shopId}/listings?limit=${limit}`, { headers: apiHeaders(clientId, sharedSecret, accessToken) });
  const json = await parseJsonOrThrow(res, 'getListings');
  const rows: any[] = Array.isArray(json?.results) ? json.results : [];
  const items: EtsyListing[] = rows.map((r) => ({
    id: String(r?.listing_id ?? ''),
    title: String(r?.title ?? ''),
    price: Number(r?.price?.amount ?? 0) / (Number(r?.price?.divisor) || 1),
    currency: String(r?.price?.currency_code ?? ''),
    url: String(r?.url ?? ''),
  }));
  return { total: Number(json?.count ?? items.length), items };
}

// LECTURA: pedidos (receipts) del shop propio. Forma mínima; el modelo sales/orders definitivo
// se diseñará a partir de respuestas reales (F5, diferido).
export async function getReceipts(ventureId: number, opts: { limit?: number } = {}): Promise<{ total: number; items: EtsyReceipt[] }> {
  const { clientId, sharedSecret } = credentialProvider.getAppCredentials(PROVIDER);
  const { accessToken, userId } = await getFreshAccess(ventureId);
  const shopId = await resolveShopId(clientId, sharedSecret, accessToken, userId);
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const res = await fetch(`${API_BASE}/shops/${shopId}/receipts?limit=${limit}`, { headers: apiHeaders(clientId, sharedSecret, accessToken) });
  const json = await parseJsonOrThrow(res, 'getReceipts');
  const rows: any[] = Array.isArray(json?.results) ? json.results : [];
  const items: EtsyReceipt[] = rows.map((r) => ({
    id: String(r?.receipt_id ?? ''),
    total: Number(r?.grandtotal?.amount ?? 0) / (Number(r?.grandtotal?.divisor) || 1),
    currency: String(r?.grandtotal?.currency_code ?? ''),
    status: String(r?.status ?? ''),
    createdAt: r?.created_timestamp ? new Date(Number(r.created_timestamp) * 1000).toISOString() : null,
  }));
  return { total: Number(json?.count ?? items.length), items };
}

// LECTURA: reviews del shop propio.
export interface EtsyReview {
  id: string;
  listingId: string;
  rating: number;
  review: string;
  reviewer: string;
  createdAt: string | null;
}

export async function getReviews(ventureId: number, opts: { limit?: number; listingId?: string } = {}): Promise<{ total: number; items: EtsyReview[] }> {
  const { clientId, sharedSecret } = credentialProvider.getAppCredentials(PROVIDER);
  const { accessToken, userId } = await getFreshAccess(ventureId);
  const shopId = await resolveShopId(clientId, sharedSecret, accessToken, userId);
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  let url = `${API_BASE}/shops/${shopId}/reviews?limit=${limit}`;
  if (opts.listingId) url += `&listing_id=${opts.listingId}`;
  const res = await fetch(url, { headers: apiHeaders(clientId, sharedSecret, accessToken) });
  const json = await parseJsonOrThrow(res, 'getReviews');
  const rows: any[] = Array.isArray(json?.results) ? json.results : [];
  const items: EtsyReview[] = rows.map((r) => ({
    id: String(r?.review_id ?? ''),
    listingId: String(r?.listing_id ?? ''),
    rating: Number(r?.rating ?? 0),
    review: String(r?.review ?? ''),
    reviewer: String(r?.buyer_user_id ?? ''),
    createdAt: r?.created_timestamp ? new Date(Number(r.created_timestamp) * 1000).toISOString() : null,
  }));
  return { total: Number(json?.count ?? items.length), items };
}

// LECTURA: analytics de un listing específico.
export interface EtsyListingAnalytics {
  listingId: string;
  views: number;
  visits: number;
  favorites: number;
  orders: number;
  revenue: number;
  currency: string;
  conversionRate: number;
}

export async function getListingAnalytics(ventureId: number, listingId: string): Promise<EtsyListingAnalytics | null> {
  const { clientId, sharedSecret } = credentialProvider.getAppCredentials(PROVIDER);
  const { accessToken, userId } = await getFreshAccess(ventureId);
  const shopId = await resolveShopId(clientId, sharedSecret, accessToken, userId);
  const res = await fetch(`${API_BASE}/shops/${shopId}/listings/${listingId}/analytics`, { headers: apiHeaders(clientId, sharedSecret, accessToken) });
  if (!res.ok) {
    if (res.status === 404) return null;
    await parseJsonOrThrow(res, 'getListingAnalytics');
  }
  const json = await res.json();
  // Etsy analytics response structure (can vary, handle defensively)
  const stats = json?.results?.[0] || json;
  return {
    listingId,
    views: Number(stats?.views ?? 0),
    visits: Number(stats?.visits ?? 0),
    favorites: Number(stats?.favorites ?? 0),
    orders: Number(stats?.orders ?? 0),
    revenue: Number(stats?.revenue?.amount ?? 0) / (Number(stats?.revenue?.divisor) || 1),
    currency: String(stats?.revenue?.currency_code ?? 'USD'),
    conversionRate: stats?.visits ? Number(stats?.orders ?? 0) / Number(stats?.visits) : 0,
  };
}

// Estado de conexión SIN exponer tokens (F3).
export async function getConnectionStatus(ventureId: number): Promise<IntegrationStatus> {
  const t = await tokenStore.getTokens(PROVIDER, ventureId);
  return {
    provider: PROVIDER,
    ventureId,
    connected: !!t,
    scope: t?.scope ?? null,
    expiresAt: t?.expiresAt ?? null,
  };
}

// ─── ESCRITURA (requieren Decision aprobada) ─────────────────────────────────

export interface EtsyCreateListingInput {
  title: string;
  description: string;
  price: number;
  currency: string;
  quantity: number;
  tags?: string[];
  materials?: string[];
  whoMade?: 'i_did' | 'someone_else' | 'collective';
  whenMade?: string; // e.g., '2024', '2020_2024', 'made_to_order'
  taxonomyId?: number;
  shippingProfileId?: number;
  returnPolicyId?: number;
}

export interface EtsyUpdateListingInput {
  listingId: string;
  title?: string;
  description?: string;
  price?: number;
  currency?: string;
  quantity?: number;
  tags?: string[];
  state?: 'active' | 'draft' | 'expired';
}

export interface EtsyCreateReplyInput {
  reviewId: string;
  message: string;
}

export interface EtsyListingCreated {
  listingId: string;
  title: string;
  state: string;
  url: string;
}

export interface EtsyListingUpdated {
  listingId: string;
  updated: boolean;
}

export interface EtsyReplyCreated {
  replyId: string;
  reviewId: string;
}

// Crea un listing nuevo en Etsy. Requiere scope 'listings_w' (no en read scopes actuales).
export async function createListing(ventureId: number, input: EtsyCreateListingInput): Promise<EtsyListingCreated> {
  const { clientId, sharedSecret } = credentialProvider.getAppCredentials(PROVIDER);
  const { accessToken, userId } = await getFreshAccess(ventureId);
  const shopId = await resolveShopId(clientId, sharedSecret, accessToken, userId);

  const body = new URLSearchParams();
  body.set('title', input.title);
  body.set('description', input.description);
  body.set('price', String(input.price));
  body.set('currency', input.currency);
  body.set('quantity', String(input.quantity));
  body.set('who_made', input.whoMade || 'i_did');
  if (input.whenMade) body.set('when_made', input.whenMade);
  if (input.taxonomyId) body.set('taxonomy_id', String(input.taxonomyId));
  if (input.shippingProfileId) body.set('shipping_profile_id', String(input.shippingProfileId));
  if (input.returnPolicyId) body.set('return_policy_id', String(input.returnPolicyId));
  if (input.tags?.length) body.set('tags', input.tags.join(',').slice(0, 1000));
  if (input.materials?.length) body.set('materials', input.materials.join(',').slice(0, 1000));

  const res = await fetch(`${API_BASE}/shops/${shopId}/listings`, {
    method: 'POST',
    headers: { ...apiHeaders(clientId, sharedSecret, accessToken), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await parseJsonOrThrow(res, 'createListing');
  return {
    listingId: String(json?.listing_id ?? ''),
    title: String(json?.title ?? input.title),
    state: String(json?.state ?? 'draft'),
    url: String(json?.url ?? ''),
  };
}

// Actualiza un listing existente. Requiere scope 'listings_w'.
export async function updateListing(ventureId: number, input: EtsyUpdateListingInput): Promise<EtsyListingUpdated> {
  const { clientId, sharedSecret } = credentialProvider.getAppCredentials(PROVIDER);
  const { accessToken, userId } = await getFreshAccess(ventureId);
  const shopId = await resolveShopId(clientId, sharedSecret, accessToken, userId);

  const { listingId, ...fields } = input;
  const body = new URLSearchParams();
  if (fields.title) body.set('title', fields.title);
  if (fields.description) body.set('description', fields.description);
  if (fields.price != null) body.set('price', String(fields.price));
  if (fields.currency) body.set('currency', fields.currency);
  if (fields.quantity != null) body.set('quantity', String(fields.quantity));
  if (fields.state) body.set('state', fields.state);
  if (fields.tags?.length) body.set('tags', fields.tags.join(',').slice(0, 1000));

  const res = await fetch(`${API_BASE}/shops/${shopId}/listings/${listingId}`, {
    method: 'PATCH',
    headers: { ...apiHeaders(clientId, sharedSecret, accessToken), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await parseJsonOrThrow(res, 'updateListing');
  return {
    listingId,
    updated: true,
  };
}

// Responde a una review. Requiere scope 'transactions_w' (o similar según Etsy).
export async function createReply(ventureId: number, input: EtsyCreateReplyInput): Promise<EtsyReplyCreated> {
  const { clientId, sharedSecret } = credentialProvider.getAppCredentials(PROVIDER);
  const { accessToken, userId } = await getFreshAccess(ventureId);
  const shopId = await resolveShopId(clientId, sharedSecret, accessToken, userId);

  const body = new URLSearchParams();
  body.set('message', input.message);

  const res = await fetch(`${API_BASE}/shops/${shopId}/reviews/${input.reviewId}/replies`, {
    method: 'POST',
    headers: { ...apiHeaders(clientId, sharedSecret, accessToken), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await parseJsonOrThrow(res, 'createReply');
  return {
    replyId: String(json?.reply_id ?? ''),
    reviewId: input.reviewId,
  };
}
