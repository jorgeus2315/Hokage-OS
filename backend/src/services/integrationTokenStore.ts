import { run, get } from '../db/init.js';
import type { IntegrationProvider, IntegrationTokens } from '../types/index.js';

// Fase 4 (F1-migratable) — almacén de TOKENS OAuth rotativos por (proveedor, venture).
// Contrato estable que usa EtsyClient; hoy respaldado por la tabla `integration_tokens`,
// mañana sustituible por C.6 Secret Management implementando esta misma interfaz.
// F3: los tokens viven solo aquí; jamás se devuelven por API ni se registran en auditoría.

export interface TokenStore {
  getTokens(provider: IntegrationProvider, ventureId: number): Promise<IntegrationTokens | null>;
  saveTokens(tokens: IntegrationTokens): Promise<void>;
}

interface TokenRow {
  provider: string;
  venture_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string;
}

class SqliteTokenStore implements TokenStore {
  async getTokens(provider: IntegrationProvider, ventureId: number): Promise<IntegrationTokens | null> {
    const row = await get<TokenRow>(
      'SELECT provider, venture_id, access_token, refresh_token, expires_at, scope FROM integration_tokens WHERE provider = ? AND venture_id = ?',
      [provider, ventureId],
    );
    if (!row) return null;
    return {
      provider: row.provider as IntegrationProvider,
      ventureId: row.venture_id,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at,
      scope: row.scope,
    };
  }

  // Upsert por (provider, venture_id): un token vivo por par. Actualiza in-place en refresh.
  async saveTokens(t: IntegrationTokens): Promise<void> {
    await run(
      `INSERT INTO integration_tokens (provider, venture_id, access_token, refresh_token, expires_at, scope, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(provider, venture_id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         updated_at = datetime('now')`,
      [t.provider, t.ventureId, t.accessToken, t.refreshToken, t.expiresAt, t.scope],
    );
  }
}

// Seam único que consume EtsyClient. Reemplazar por la impl de C.6 es cambiar esta línea.
export const tokenStore: TokenStore = new SqliteTokenStore();
