> Fuente: `HOKAGE_CORE_SPECIFICATION_v1.md` §14. Congelado.

## 14. Escalabilidad

🔒 **CONGELADO**, síntesis de los umbrales ya fijados en distintos puntos de este documento y de `Roadmap.md`:

| Límite conocido | Umbral | Qué hacer al llegar |
|---|---|---|
| SQLite → PostgreSQL | 2+ negocios activos simultáneos o 10+ agentes | Ya decidido en [[Roadmap - Snapshot 2026-08-02|Roadmap]], sin trabajo adicional de diseño |
| Scheduler centralizado → distribuido | Cola con latencia perceptible, decenas de agentes | Revisitar [[Runtime, Scheduler y Event Bus|§2]] — no antes |
| Roles de agente: código → datos | El día que se pida un rol nuevo sin tocar TypeScript | Revisitar [[Agentes - Modelo y Decisión|§4]] — no antes |
| `memory_entries` sin poda → con poda/archivado | Volumen real empieza a afectar el tamaño de la BD o el coste de la lectura por turno | Revisitar [[Memory System|§6]] — no antes |
| Tool interface propio → MCP | Integraciones externas > ~15-20 | Revisitar [[Plugin System - Arquitectura Completa|§8.5]] — no antes |
| Plugins sin sandboxing → aislamiento real (proceso separado/permisos restringidos) | Un plugin lo escribe alguien que no sea Jorge (colaborador, tercero) | Revisitar [[Plugin System - Arquitectura Completa|§8.6]] "Seguridad" — no antes |
| Permisos single-owner → multi-usuario | Un segundo fundador usa Hokage OS | Revisitar [[Seguridad, Permisos y VPS|§11.1]] — no antes |
| API sin paginación → `limit`/`offset`/filtro por venture | 2+ ventures activos simultáneos (coincide con el umbral de Postgres) | Paginar `agents`/`decisions`/`ventures`/`objectives`/`messages`, filtrar `useAppData.ts` por venture activo |
| Cero tests automatizados → smoke-test mínimo | Antes de la siguiente migración de BD que toque tablas con FK (ya causó una regresión real esta sesión) | Un test del ciclo Decision→approve→work_item + verificación post-migración, no cobertura amplia |

Esta tabla es, deliberadamente, la forma de evitar sobre-construir: cada fila es una decisión ya tomada sobre **cuándo** revisar algo, no una promesa de construirlo ahora.

---

## Notas relacionadas

- [[INDEX]] — mapa general de la bóveda
- [[Núcleo - Arquitectura del Core]]
- [[Runtime, Scheduler y Event Bus]] · [[Agentes - Modelo y Decisión]] · [[Memory System]] · [[Plugin System - Arquitectura Completa]] · [[Seguridad, Permisos y VPS]] — sistemas con umbral de revisión anotado aquí
- [[Roadmap - Snapshot 2026-08-02|Roadmap]]
