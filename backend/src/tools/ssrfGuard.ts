import dns from 'node:dns/promises';
import net from 'node:net';

// Guard SSRF para tools que hacen fetch a URLs controladas por un agente (web.browser).
// Un agente guiado por contenido web atacante (inyección indirecta) podría ser inducido a
// leer metadata de la nube (169.254.169.254), localhost, o servicios internos. Este módulo
// solo permite http/https hacia IPs públicas, revalidando en cada redirección.
//
// ponytail: techo conocido — DNS rebinding (TOCTOU). Entre assertPublicHost() (lookup) y el
// getaddrinfo interno de fetch(), el registro DNS podría cambiar a una IP privada. Cerrarlo
// del todo exige fijar la conexión a la IP validada con un dispatcher custom de undici — es
// una decisión arquitectónica mayor, deliberadamente no tomada aquí. Para un sistema de un
// solo operador el vector realista (agente inducido a http://169.254.169.254 / localhost) sí
// queda cubierto por la resolución + bloqueo de rango.

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
  if (net.isIP(hostname)) {
    if (ipIsPrivate(hostname)) throw new Error(`URL bloqueada: IP privada/local (${hostname})`);
    return;
  }
  const resolved = await dns.lookup(hostname, { all: true });
  if (resolved.length === 0) throw new Error(`URL bloqueada: host no resuelve (${hostname})`);
  for (const r of resolved) {
    if (ipIsPrivate(r.address)) {
      throw new Error(`URL bloqueada: ${hostname} resuelve a IP privada/local (${r.address})`);
    }
  }
}

// fetch con validación SSRF: solo http/https, host público, redirecciones manuales revalidadas.
export async function safeFetch(rawUrl: string, headers: Record<string, string>): Promise<Response> {
  let url = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(url); // lanza si la URL es inválida
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Esquema no permitido: ${parsed.protocol} (solo http/https)`);
    }
    await assertPublicHost(parsed.hostname);

    const res = await fetch(url, { headers, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;

    url = new URL(location, url).toString(); // resuelve redirecciones relativas y revalida en el próximo giro
  }
  throw new Error(`Demasiadas redirecciones (máx ${MAX_REDIRECTS})`);
}
