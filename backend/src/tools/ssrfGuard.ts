import dns from 'node:dns/promises';
import dnsCb from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

// Guard SSRF para tools que hacen fetch a URLs controladas por un agente (web.browser).
// Un agente guiado por contenido web atacante (inyección indirecta) podría ser inducido a
// leer metadata de la nube (169.254.169.254), localhost, o servicios internos. Este módulo
// solo permite http/https hacia IPs públicas, revalidando en cada redirección.
//
// TOCTOU / DNS-rebinding CERRADO (Fase 6): la validación y la conexión usan la MISMA
// resolución. ssrfLookup() resuelve, exige que TODAS las IPs sean públicas y devuelve la IP
// validada; undici (dispatcher) conecta a ESA IP sin volver a resolver. Ya no hay ventana
// entre validar y conectar. La comprobación previa (assertPublicHost) se mantiene para
// bloquear IP-literales (undici no llama al lookup con un literal) y para fallar antes con un
// mensaje claro — defensa en profundidad, no la garantía principal.

const MAX_REDIRECTS = 3;

export function ipIsPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0) return true;                        // "this host"
    if (a === 10) return true;                       // privada
    if (a === 127) return true;                      // loopback
    if (a === 169 && b === 254) return true;         // link-local + metadata cloud
    if (a === 172 && b >= 16 && b <= 31) return true;// privada
    if (a === 192 && b === 168) return true;         // privada
    if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT (RFC 6598)
    if (a >= 224) return true;                        // multicast/reservado/broadcast
    return false;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;      // loopback / unspecified
    if (s.startsWith('fe80')) return true;           // link-local
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // ULA (privada)
    if (s.startsWith('ff')) return true;             // multicast
    if (s.startsWith('::ffff:')) return ipIsPrivate(s.slice('::ffff:'.length)); // IPv4-mapped
    return false;
  }
  return true; // forma desconocida → bloquear por defecto
}

// Lanza si el hostname resuelve (o ya es) una IP privada/local. IP literal → comprobación directa.
export async function assertPublicHost(hostname: string): Promise<void> {
  // URL.hostname devuelve los IPv6 entre corchetes ([::1]); net.isIP los quiere sin ellos.
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (ipIsPrivate(host)) throw new Error(`URL bloqueada: IP privada/local (${host})`);
    return;
  }
  const resolved = await dns.lookup(host, { all: true });
  if (resolved.length === 0) throw new Error(`URL bloqueada: host no resuelve (${hostname})`);
  for (const r of resolved) {
    if (ipIsPrivate(r.address)) {
      throw new Error(`URL bloqueada: ${hostname} resuelve a IP privada/local (${r.address})`);
    }
  }
}

// Lookup que RESUELVE, valida que TODAS las IPs son públicas y fija la conexión a la IP
// validada. undici lo llama en el momento de conectar y conecta al resultado devuelto aquí,
// sin re-resolver → cierra el TOCTOU. Firma de Node net.LookupFunction (callback single).
function ssrfLookup(
  hostname: string,
  options: { family?: number | 'IPv4' | 'IPv6'; hints?: number },
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
): void {
  const fam = options?.family;
  const family = fam === 'IPv4' ? 4 : fam === 'IPv6' ? 6 : typeof fam === 'number' ? fam : 0;
  dnsCb.lookup(hostname, { all: true, family, hints: options?.hints }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    if (list.length === 0) return callback(new Error(`URL bloqueada: host no resuelve (${hostname})`), '', 0);
    for (const a of list) {
      if (ipIsPrivate(a.address)) {
        return callback(new Error(`URL bloqueada: ${hostname} resuelve a IP privada/local (${a.address})`), '', 0);
      }
    }
    const chosen = list[0];
    callback(null, chosen.address, chosen.family);
  });
}

// Dispatcher único con el lookup validador. Reutilizado en cada conexión (pooling de undici).
const ssrfAgent = new Agent({ connect: { lookup: ssrfLookup } });

export interface SafeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

// fetch con validación SSRF: solo http/https, host público, IP fijada, redirecciones revalidadas.
export async function safeFetch(rawUrl: string, headers: Record<string, string>): Promise<SafeResponse> {
  let url = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(url); // lanza si la URL es inválida
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Esquema no permitido: ${parsed.protocol} (solo http/https)`);
    }
    await assertPublicHost(parsed.hostname); // bloquea IP-literales privadas y pre-valida el host

    const res = await undiciFetch(url, { headers, redirect: 'manual', dispatcher: ssrfAgent });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;

    url = new URL(location, url).toString(); // resuelve redirecciones relativas y revalida en el próximo giro
  }
  throw new Error(`Demasiadas redirecciones (máx ${MAX_REDIRECTS})`);
}
