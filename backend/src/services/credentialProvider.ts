import type { IntegrationProvider } from '../types/index.js';

// Fase 4 (F1-migratable) — proveedor de CREDENCIALES DE APP (estáticas, no rotativas):
// client_id/keystring + shared secret + redirect_uri. Hoy respaldado por variables de
// entorno; mañana sustituible por C.6 Secret Management implementando esta misma interfaz,
// sin tocar EtsyClient. Los secretos NUNCA se registran ni se devuelven por API.

export interface AppCredentials {
  clientId: string;      // Etsy: keystring
  sharedSecret: string;  // Etsy: shared secret
  redirectUri: string;   // debe coincidir byte a byte con el registrado en la app
}

export interface CredentialProvider {
  getAppCredentials(provider: IntegrationProvider): AppCredentials;
}

// Mapa por proveedor (data-driven, sin ramas if por-nombre dispersas). Añadir un
// proveedor futuro es una entrada más aquí, no un condicional nuevo.
const ENV_KEYS: Record<IntegrationProvider, { clientId: string; sharedSecret: string; redirectUri: string }> = {
  etsy: { clientId: 'ETSY_CLIENT_ID', sharedSecret: 'ETSY_CLIENT_SECRET', redirectUri: 'ETSY_REDIRECT_URI' },
};

class EnvCredentialProvider implements CredentialProvider {
  getAppCredentials(provider: IntegrationProvider): AppCredentials {
    const keys = ENV_KEYS[provider];
    if (!keys) throw new Error(`Proveedor de integración no soportado: ${provider}`);
    const clientId = process.env[keys.clientId];
    const sharedSecret = process.env[keys.sharedSecret];
    const redirectUri = process.env[keys.redirectUri];
    // El error nombra las VARIABLES que faltan, nunca valores (F3).
    if (!clientId || !sharedSecret || !redirectUri) {
      throw new Error(
        `Credenciales de ${provider} no configuradas: faltan ${[
          !clientId && keys.clientId,
          !sharedSecret && keys.sharedSecret,
          !redirectUri && keys.redirectUri,
        ].filter(Boolean).join(', ')}`
      );
    }
    return { clientId, sharedSecret, redirectUri };
  }
}

// Seam único que consume EtsyClient. Reemplazar por la impl de C.6 es cambiar esta línea.
export const credentialProvider: CredentialProvider = new EnvCredentialProvider();
