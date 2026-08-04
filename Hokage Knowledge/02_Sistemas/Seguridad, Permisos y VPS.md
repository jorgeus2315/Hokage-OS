> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §11.1 y §11.3. Congelado.
> §11.2 (Secretos y credenciales) vive en su propia nota desde 2026-08-05 — ver [[Gestión de Secretos y Capabilities]].

## Seguridad, Permisos y VPS

### 11.1 Sistema de permisos

🔒 **CONGELADO, implementado.** `OWNER_NAME` sustituyó el string `'Jorge'` hardcodeado (ver [[Resumen Ejecutivo - Decisiones Congeladas|§16]]).

**Estado real:** no existe ningún sistema de permisos. Hay un único `ADMIN_TOKEN` (bearer, comparación de string) que gatea todas las rutas de mutación. No hay usuarios, no hay roles humanos, no hay distinción entre "Jorge" y "cualquiera con el token". Hallazgo concreto: `approveDecision(id, 'Jorge')` — el string `'Jorge'` está **hardcodeado como literal** en el código de aprobación, no es un valor de configuración.

**Alternativas:**
- **A. Single-owner permanente** — Hokage OS es y seguirá siendo de un único operador (Jorge). El `ADMIN_TOKEN` es suficiente para siempre.
- **B. Multi-usuario con roles** — construir un sistema de cuentas, roles (owner/operador/viewer), permisos por venture.
- **C. Single-owner ahora, diseñado para no bloquear multi-usuario después** — no se construye B, pero se deja de hardcodear "Jorge" como string literal, se pasa a un valor de configuración (`OWNER_NAME` o similar), y cualquier tabla nueva que registre "quién hizo X" usa ese valor de config, no un literal.

**Decisión para Hokage OS: C.** B es sobre-ingeniería completa para el uso actual (un fundador, un sistema). A es correcto en espíritu pero deja una trampa concreta (el string hardcodeado) que cuesta cero arreglar ahora y mucho arreglar después si alguna vez se necesita.

**Consecuencia a 2-3 años:** si Hokage OS se convierte en un producto que otros fundadores usan (no solo Jorge), B se vuelve obligatorio — y el coste de migrar desde C es mucho menor que desde A, porque C ya no tiene el nombre de Jorge cableado en la lógica de negocio.


### 11.3 VPS y despliegue

🔒 **CONGELADO**, ya bien decidido en [[ARCHITECTURE (legacy)]] §11 y `Roadmap.md`: Hetzner CX22, PM2 (proceso vivo + reinicio automático — resuelve el problema de "el runtime no sobrevive reinicios" señalado en [[Runtime, Scheduler y Event Bus]]), Nginx + Certbot, SQLite ahora, PostgreSQL cuando se supere ~2 negocios activos o 10 agentes (umbral ya fijado en `Roadmap.md`, se ratifica). No requiere ninguna decisión nueva — solo ejecución, pendiente de que Jorge cree el servidor.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Gestión de Secretos y Capabilities]] — §11.2, separada en su propia nota
- [[Founder Profile y La Fundación]] — modelo single-owner consumido por Founder Profile
- [[Plugin System - Arquitectura Completa]] — trade-off de seguridad sin sandboxing, single-owner
- [[Runtime, Scheduler y Event Bus]] — supervisor de proceso pendiente (§11.3)
- [[Escalabilidad]] — umbral de single-owner → multi-usuario
