# ADR-004 — Memory System
> Categoría: decisión de arquitectura
> Estado: 🔒 Congelado v3, arquitectura completa lista para implementar
> Sintetizado desde `HOKAGE_CORE_SPECIFICATION_v1.md` §6 — Fase 7 de la migración documental

---

## Contexto

`CLAUDE.md` pide "memoria semántica que permite a Hokage recordar por qué fracasó algo hace 6 meses". Lo único que existe hoy, `agent_memory`, es una tabla privada por agente — no sirve para esto. Jorge, al reabrir esta sección: *"No memoria de chat. Memoria empresarial. Debe recordar: decisiones, errores, intentos, investigaciones, resultados, aprendizajes, contexto."*

Memory System fue elegido como el sistema a diseñar tras comparar cuatro candidatos (Memory System, Founder Profile, Secret Management, Hermes v2) contra el filtro de 4 preguntas del principio rector y contra dependencias reales — ver [[Resumen Ejecutivo - Decisiones Congeladas]] para el razonamiento completo de por qué ganó frente a Founder Profile.

## Decisión

### Captura automática, no agentes que recuerdan escribir

Pedir a un agente que "recuerde escribir en la memoria" es frágil. La mayoría de las 7 categorías que pide Jorge ya son efecto colateral de datos que el sistema **ya genera** — una decisión rechazada ya tiene `reasoning`; un `work_item` cancelado tras 3 reintentos ya es un error. La memoria empresarial se construye enganchando esos momentos, no inventando un flujo nuevo de "agente escribe recuerdo" como único mecanismo.

### Prerrequisito real: threading estructural de `venture_id`

Hoy no existe ningún campo `ventureId` estructural entre `stage3_executeAgents()` y el resto del pipeline — solo el prefijo de texto `[VENTURE: nombre]` (ver [[Modelo Multi-Venture]]). Sin esto, `memory_entries` no puede filtrar por venture en la lectura. Se cierra como primer paso de esta fase, antes de las tools nuevas: `AgentTask.ventureId`, paso a `runAgent()`, parámetro en `askAgent()`, y `ToolContext.ventureId` sustituyendo al campo muerto `businessId`.

### Dos escrituras, dos tools — no una sola con un parámetro

`agent_memory` (existente) es clave-valor con upsert — "lo que sé", se sobrescribe. `memory_entries` (nuevo) es un log append-only — "lo que aprendí", nunca se sobrescribe. Son dos semánticas de escritura incompatibles. Meterlas en una tool con un parámetro `scope` repetiría la ambigüedad que la migración de marcadores a Tools ([[ADR-005 - Tool Runtime y Plugin Contract]]) se propuso eliminar.

`memory.write` (ya construido, Fase 3 de esa migración) no se toca — sigue siendo memoria privada por agente. **`memory.remember`** es la tool nueva, disponible a los 6 roles tool-capable, con categorías `error | attempt | research | learning | context` (`decision` y `result` quedan reservadas a la captura automática, para que no compitan dos fuentes de verdad sobre el mismo hecho).

### Schema

```sql
CREATE TABLE memory_entries (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  venture_id           INTEGER REFERENCES ventures(id),  -- NULL = memoria de instalación
  category             TEXT NOT NULL,
  title                TEXT NOT NULL,
  content              TEXT NOT NULL,
  source_agent_id      INTEGER REFERENCES agents(id),
  related_entity_type  TEXT,
  related_entity_id    INTEGER,
  created_at           TEXT DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE memory_entries_fts USING fts5(title, content, content=memory_entries);
```

Sin vector store — sobre-ingeniería para el volumen real. FTS5 se crea junto a la tabla base pero no se usa todavía para inyección automática en el prompt; queda lista para un futuro panel de búsqueda manual.

### Captura automática — puntos de enganche verificados

- **Decisión aprobada/rechazada** → `decisionResolvers.ts`, `category='decision'`.
- **Work item cancelado tras 3 reintentos** → `stage4_checkTTLs()`, `category='error'` (requiere reescribir el `UPDATE` masivo como `SELECT` + captura por fila).
- **Objetivo confirmado alcanzado** → `objectiveService.ts`, `category='result'`.
- **Consulta a Claude respondida** → entrada manual vía `POST /api/memory/learning`, `category='learning'`.
- **Objetivo abandonado — NO se engancha:** verificado por grep que ningún código pone jamás `objectives.status = 'abandoned'`. No se construye un hook para un estado que no existe en la práctica.

### Lectura — simple a propósito, no búsqueda semántica

Bloque `[MEMORIA DEL NEGOCIO]` en `askAgent()`, junto al ya existente `[LO QUE SÉ]`:

```sql
SELECT category, title, content FROM memory_entries
WHERE venture_id = ? OR venture_id IS NULL
ORDER BY created_at DESC LIMIT 8
```

No se usa `memory_entries_fts` para esto — el agente no "pregunta" nada, solo recibe contexto; construir un derivador de términos de búsqueda sería la misma sobre-ingeniería ya rechazada una vez (vector store, en la v1). Recencia acotada (8 entradas) es simple, predecible y barata en tokens.

## Retención

Sin poda en v1 — miles de filas son triviales para SQLite, y borrar memoria contradice el propósito del sistema.

## Consecuencias

Con captura automática desde el primer venture, el historial de "qué se intentó y por qué falló" empieza a acumularse desde ya — cuando llegue un segundo o tercer negocio, Hokage ya tiene años de contexto real que consultar. El threading de `venture_id` cerrado aquí deja de ser un hack que cada tool futura reinventa — `memory.remember` es el primer consumidor, pero cualquier tool posterior lo hereda gratis.

## Relacionado

- [[Memory System]]
- [[ADR-005 - Tool Runtime y Plugin Contract]]
- [[ADR-006 - Multi-Venture]]
- [[Modelo Multi-Venture]]
- [[Founder Profile y La Fundación]]
- [[Resumen Ejecutivo - Decisiones Congeladas]]
- [[INDEX]]
