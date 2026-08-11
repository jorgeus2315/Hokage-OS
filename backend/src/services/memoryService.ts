import { run, all } from '../db/init.js';
import type { MemoryEntry, MemoryCategory } from '../types/index.js';

// ═══════════════════════════════════════════════════════════════════════════
// memoryService — memoria de NEGOCIO (memory_entries, Fase 4, CORE SPEC §6).
// ═══════════════════════════════════════════════════════════════════════════
//
// Distinta de agent_memory (privada por agente, [LO QUE SÉ]): esta es memoria de negocio,
// COMPARTIDA por los agentes de un mismo venture, aislada entre ventures. Es DATO — el
// ContextComposer la inyecta bajo [MEMORIA DEL NEGOCIO], enmarcada por la nota anti-inyección.
// No concede permisos ni altera tools/autonomía/presupuesto: solo persiste y lee texto.

const TITLE_MAX = 120;
const CONTENT_MAX = 800;

export interface MemoryEntryInput {
  ventureId?: number | null;      // NULL = memoria global de instalación
  category: MemoryCategory;
  title: string;
  content: string;
  sourceAgentId?: number | null;
  relatedEntityType?: string | null;
  relatedEntityId?: number | null;
}

export async function createMemoryEntry(input: MemoryEntryInput): Promise<{ id: number }> {
  const res = await run(
    `INSERT INTO memory_entries (venture_id, category, title, content, source_agent_id, related_entity_type, related_entity_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.ventureId ?? null,
      input.category,
      input.title.slice(0, TITLE_MAX),
      input.content.slice(0, CONTENT_MAX),
      input.sourceAgentId ?? null,
      input.relatedEntityType ?? null,
      input.relatedEntityId ?? null,
    ]
  );
  return { id: res.lastID };
}

// Lectura para el ContextComposer: recencia acotada, SCOPE ESTRICTO por venture.
// - venture presente → memoria de ese venture + global (venture_id IS NULL); NUNCA otro venture.
// - sin venture → solo global. Un agente jamás recibe memoria de un venture ajeno.
export async function listBusinessMemory(
  ventureId: number | null | undefined,
  limit = 8
): Promise<Array<{ category: string; title: string; content: string }>> {
  if (ventureId != null) {
    return all(
      `SELECT category, title, content FROM memory_entries
       WHERE venture_id = ? OR venture_id IS NULL
       ORDER BY created_at DESC LIMIT ?`,
      [ventureId, limit]
    );
  }
  return all(
    `SELECT category, title, content FROM memory_entries
     WHERE venture_id IS NULL
     ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

// Lectura para la API (GET /api/memory, requireAdmin) con filtros opcionales.
export async function listMemory(filter: { ventureId?: number | null; category?: string; limit?: number }): Promise<MemoryEntry[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.ventureId !== undefined) {
    if (filter.ventureId === null) where.push('venture_id IS NULL');
    else { where.push('venture_id = ?'); params.push(filter.ventureId); }
  }
  if (filter.category) { where.push('category = ?'); params.push(filter.category); }
  const sql = `SELECT * FROM memory_entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
  params.push(filter.limit ?? 50);
  return all<MemoryEntry>(sql, params);
}
