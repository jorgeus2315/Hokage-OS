import bus, { AgentEvent } from './eventBus.js';
import { toolsFor, autonomousTaskFor } from '../services/roleService.js';
import { askAgent, writeAgentMemory } from '../services/aiService.js';
import { listAgents, listBusinessAgents } from '../services/agentService.js';
import { createDecision } from '../services/decisionService.js';
import { autonomyForAgent, maybeAutoApprove } from '../services/agentAutonomy.js';
import { createMessage } from '../services/messageService.js';
import { createContent } from '../services/contentService.js';
import { createMarket } from '../services/marketService.js';
import { closeMilestoneOnResult } from '../services/objectiveService.js';
import { onHokageTaskCompleted, onHokageWorkItemCancelled } from '../services/hokageOrchestrator.js';
import { get, run, all } from '../db/init.js';

// ═══════════════════════════════════════════════════════
// AGENT RUNTIME — Motor de ejecucion autonoma (8 etapas)
// ═══════════════════════════════════════════════════════

export interface AgentTask {
  agentId: number;
  agentName: string;
  agentRole: string;
  taskType: string;
  context?: string;
  // Opcional (no requerido) para no romper a los llamadores existentes sin venture
  // (p. ej. server.ts en /api/agents/:id/run) — mismo principio de compatibilidad
  // hacia atrás que askAgent() en aiService.ts.
  ventureId?: number | null;
}

export interface TaskResult {
  ok: boolean;
  response?: string;
  decision?: { title: string; risk_level: string };
  message?: { to?: number; content: string };
  error?: string;
}

// Las tareas autónomas por rol (task + interval) ya no viven aquí — su casa canónica es
// role_definitions (sembrada desde config/roleSeeds.ts). Se leen vía autonomousTaskFor()
// (roleService), con fallback a la semilla TS. Fase 1b del Registry de roles.

function nowIso(): string {
  return new Date().toISOString();
}

function applyTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(payload[key] ?? ''));
}

// Garantizar schedule para un agente (PK = agent_id)
async function ensureSchedule(agentId: number, intervalMs: number): Promise<void> {
  const row = await get<{ agent_id: number }>('SELECT agent_id FROM agent_schedules WHERE agent_id = ?', [agentId]);
  if (!row) {
    // Primer ciclo: retrasar mínimo 2 min para no saturar el arranque
    const delay = Math.min(intervalMs, 2 * 60_000);
    const nextRun = new Date(Date.now() + delay).toISOString();
    await run(
      'INSERT INTO agent_schedules (agent_id, interval_minutes, last_run_at, next_run_at) VALUES (?, ?, NULL, ?)',
      [agentId, Math.round(intervalMs / 60_000), nextRun]
    );
  }
}

// Agentes con schedule vencido
async function loadDueAgents(): Promise<Array<{ id: number; name: string; role: string; task: string; interval: number }>> {
  const now = nowIso();
  const rows = await all<{ agent_id: number; name: string; role: string; interval_minutes: number }>(
    `SELECT s.agent_id, a.name, a.role, s.interval_minutes
     FROM agent_schedules s
     JOIN agents a ON a.id = s.agent_id
     WHERE s.next_run_at <= ?`,
    [now]
  );

  const result: Array<{ id: number; name: string; role: string; task: string; interval: number }> = [];
  for (const row of rows) {
    const config = await autonomousTaskFor(row.role);
    if (!config) continue;
    result.push({
      id: row.agent_id,
      name: row.name,
      role: row.role,
      task: config.task,
      interval: row.interval_minutes * 60_000,
    });
  }
  return result;
}

// Crear work_item en la cola
async function createWorkItem(params: {
  agentId: number;
  ventureId?: number | null;
  type: 'autonomous_run' | 'event_triggered' | 'decision_execution';
  priority?: number;
  context?: string;
}): Promise<number> {
  const result = await run(
    `INSERT INTO work_items (agent_id, venture_id, type, priority, status, context)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [params.agentId, params.ventureId ?? null, params.type, params.priority ?? 6, params.context ?? null]
  );
  return result.lastID;
}

class AgentRuntime {
  private running = false;
  private listenersReady = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private busEventQueue: AgentEvent[] = [];
  private activeAgents: Set<number> = new Set();

  start(): void {
    if (this.running) {
      console.log('[RUNTIME] Ya esta corriendo');
      return;
    }
    this.running = true;
    console.log('[RUNTIME] Iniciando ecosistema de agentes...');

    if (!this.listenersReady) {
      this.setupEventListeners();
      this.listenersReady = true;
    }

    // Diferir primer tick para no bloquear el arranque HTTP
    setTimeout(() => this.pollTick(), 2000);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[RUNTIME] Ecosistema detenido.');
  }

  isRunning(): boolean {
    return this.running;
  }

  // Ejecutar agente con un prompt (usado desde HTTP y desde el scheduler)
  async runAgent(task: AgentTask): Promise<TaskResult> {
    try {
      console.log(`[RUNTIME] Ejecutando ${task.agentName} :: ${task.taskType}`);

      bus.publish({
        type: 'agent.task.start',
        from: task.agentName,
        payload: { taskType: task.taskType, agentId: task.agentId },
      });

      // Migración marcadores → Tool Calling (HOKAGE_CORE_SPECIFICATION_v1.md §2): un rol con
      // la tool de reemplazo disponible NUNCA ve la instrucción del marcador viejo — si ambas
      // conviven en el prompt, el modelo tiende a preferir el marcador (verificado en Fase 1).
      // El regex de agentRuntime.ts se queda como red de seguridad, pero deja de ofrecerse
      // activamente en cuanto el rol tiene el tool real.
      const roleTools = await toolsFor(task.agentRole);
      // Autonomía del agente (Fase 2): Nivel 0 = observador (sin acciones ni marcadores).
      const autonomy = await autonomyForAgent(task.agentId);
      const formatLines: string[] = [];
      if (autonomy <= 0) {
        formatLines.push('- Estás en modo OBSERVADOR: analiza e informa con claridad, pero NO uses herramientas de acción ni marcadores. No propongas decisiones ni crees contenido.');
      } else {
      if (!roleTools.includes('trend.report')) {
        formatLines.push('- Si detectas una tendencia de mercado accionable, añade: [TENDENCIA: keyword | descripcion breve]');
      }
      if (!roleTools.includes('content.create')) {
        formatLines.push('- Si acabas de crear contenido listo para distribuir, añade: [CONTENIDO: keyword | resumen de 1 linea]');
      }
      if (!roleTools.includes('decision.create')) {
        formatLines.push('- Si necesitas que Jorge apruebe algo (publicar contenido, gastar dinero, cambiar configuración), añade: [DECISION: título en menos de 80 caracteres]');
      }
      if (!roleTools.includes('memory.write')) {
        formatLines.push('- Si descubres un hecho relevante para recordar en el futuro, añade: [MEMORIA: clave_snake_case=valor en menos de 150 caracteres] (máximo 3 por respuesta)');
      }
      formatLines.push('- Usa los marcadores solo cuando realmente sean necesarios.');
      if (roleTools.includes('trend.report')) {
        formatLines.push('- Para reportar una tendencia, llama SIEMPRE a la tool trend.report — nunca uses [TENDENCIA: ...].');
      }
      if (roleTools.includes('content.create')) {
        formatLines.push('- Para registrar contenido creado, llama SIEMPRE a la tool content.create — nunca uses [CONTENIDO: ...].');
      }
      if (roleTools.includes('memory.write')) {
        formatLines.push('- Para recordar un hecho relevante, llama SIEMPRE a la tool memory.write — nunca uses [MEMORIA: ...].');
      }
      if (roleTools.includes('decision.create')) {
        formatLines.push('- Para pedir aprobación de Jorge, llama SIEMPRE a la tool decision.create — nunca uses [DECISION: ...]. Rellena siempre "description" con el porqué, no la dejes vacía.');
      }
      }

      const taskPrompt = `${task.context || task.taskType}

INSTRUCCIONES DE FORMATO:
${formatLines.join('\n')}`;

      const result = await askAgent(task.agentId, taskPrompt, task.ventureId);

      if (!result.ok) {
        bus.publish({ type: 'agent.task.error', from: task.agentName, payload: { error: result.error } });
        return { ok: false, error: result.error };
      }

      const response = result.data?.response || '';

      await createMessage({
        sender_id: task.agentId,
        receiver_id: null,
        content: response.slice(0, 500),
        channel: 'general',
      });

      // Efectos por marcador gateados por autonomía (Fase 2): Nivel 0 (observador) NO persiste
      // memoria, contenido, tendencias ni decisiones — solo informa (el createMessage de arriba).
      // Nivel 1+ los procesa. Esto cubre también a roles tool-capable si el modelo emite un
      // marcador pese a tener la tool: el regex de red de seguridad queda igualmente gateado.
      if (autonomy >= 1) {
      const memoryMatches = [...response.matchAll(/\[MEMORIA:\s*([a-z_][a-z0-9_]*)\s*=\s*([^\]]{1,150})\]/gi)];
      for (const match of memoryMatches.slice(0, 3)) {
        await writeAgentMemory(task.agentId, match[1].trim().toLowerCase(), match[2].trim(), task.ventureId);
      }

      // Contenido listo del Escritor → persiste como output real + dispara pipeline Tráfico
      const contenidoMatches = [...response.matchAll(/\[CONTENIDO:\s*([^|]{2,60})\|([^\]]{5,120})\]/gi)];
      for (const match of contenidoMatches.slice(0, 2)) {
        const keyword = match[1].trim();
        const summary = match[2].trim();
        await createContent({
          agent_id: task.agentId,
          platform: 'seo',
          body: `${keyword} — ${summary}`,
          status: 'draft',
        }).catch((err) => console.error('[PIPELINE] Error guardando content:', err.message));
        bus.publish({
          type: 'content.created',
          from: task.agentName,
          payload: { keyword, summary, agentId: task.agentId, createdAt: nowIso() },
        });
        console.log(`[PIPELINE] content.created → ${keyword}`);
      }

      // Tendencias detectadas por el Explorador → persiste como output real + dispara pipeline Escritor
      const tendenciaMatches = [...response.matchAll(/\[TENDENCIA:\s*([^|]{2,60})\|([^\]]{5,120})\]/gi)];
      for (const match of tendenciaMatches.slice(0, 3)) {
        const keyword = match[1].trim();
        const description = match[2].trim();
        await createMarket({
          agent_id: task.agentId,
          keyword,
          source: 'agent',
          payload: JSON.stringify({ description }),
        }).catch((err) => console.error('[PIPELINE] Error guardando market:', err.message));
        bus.publish({
          type: 'trend.detected',
          from: task.agentName,
          payload: { keyword, description, detectedAt: nowIso() },
        });
        console.log(`[PIPELINE] trend.detected → ${keyword}`);
      }

      const decisionMatch = response.match(/\[DECISION:\s*([^\]]{5,100})\]/i);
      if (decisionMatch) {
        const title = decisionMatch[1].trim();
        const decision = await createDecision({
          agent_id: task.agentId,
          title,
          description: response.slice(0, 300),
          reasoning: `Generado automaticamente por ${task.agentName} durante tarea autonoma`,
          risk_level: 'low',
          amount: null,
        });
        bus.publish({ type: 'decision.created', from: task.agentName, payload: { title, agentId: task.agentId } });
        await maybeAutoApprove(decision); // Nivel 2+: auto-aprueba si no es crítica
      }
      } // fin gate autonomía >= 1

      bus.publish({
        type: 'agent.task.done',
        from: task.agentName,
        payload: { taskType: task.taskType, response: response.slice(0, 200) },
      });

      return { ok: true, response };
    } catch (error: any) {
      bus.publish({ type: 'agent.task.error', from: task.agentName, payload: { error: error.message } });
      return { ok: false, error: error.message };
    }
  }

  // ══════════════════════════════════════════════
  // TICK — 8 etapas fijas en orden determinista
  // ══════════════════════════════════════════════
  private async pollTick(): Promise<void> {
    if (!this.running) return;

    try {
      await this.stage1_drainBusEvents();
      await this.stage2_assignWork();
      await this.stage3_executeAgents();   // incluye Etapa 5 (guardar resultado) inline
      await this.stage4_checkTTLs();
      // Etapa 6: pipeline derivado gestionado via bus eventos en stage1_drainBusEvents
      await this.stage7_closeDecisionLoop();
      await this.stage8_updateMetrics();
    } catch (error) {
      console.error('[RUNTIME] Error en pollTick:', error);
    } finally {
      if (this.running) {
        this.pollTimer = setTimeout(() => this.pollTick(), 10_000);
      }
    }
  }

  // Etapa 1: vaciar cola de eventos → buscar automations activas → crear work_items
  private async stage1_drainBusEvents(): Promise<void> {
    const events = this.busEventQueue.splice(0);
    if (events.length === 0) return;

    const agents = await listAgents();

    for (const event of events) {
      const automations = await all<{
        id: number;
        name: string;
        action_agent_role: string | null;
        action_priority: number;
        action_context_template: string | null;
      }>(
        `SELECT id, name, action_agent_role, action_priority, action_context_template
         FROM automations
         WHERE trigger_event = ? AND active = 1`,
        [event.type]
      );

      for (const automation of automations) {
        if (!automation.action_agent_role) continue;
        const agent = agents.find((a) => a.role === automation.action_agent_role);
        if (!agent) continue;

        const payload = (event.payload ?? {}) as Record<string, unknown>;
        const context = automation.action_context_template
          ? applyTemplate(automation.action_context_template, payload)
          : JSON.stringify(payload);

        await createWorkItem({
          agentId: agent.id,
          type: 'event_triggered',
          priority: automation.action_priority,
          context,
        });

        const senderAgent = agents.find((a) => a.name === event.from);
        if (senderAgent && senderAgent.id !== agent.id) {
          await createMessage({
            sender_id: senderAgent.id,
            receiver_id: agent.id,
            content: context.slice(0, 300),
            channel: 'internal',
          });
        }
        console.log(`[AUTOMATION] "${automation.name}" → ${agent.name} (${event.type})`);
      }
    }
  }

  // Etapa 2: garantizar schedules + crear work_items para agentes vencidos + bloquear pending
  private async stage2_assignWork(): Promise<void> {
    // B.1: el scheduling autónomo opera sobre agentes de NEGOCIO. Hermes (kernel) queda fuera
    // de forma explícita — ya lo estaba de hecho (sin autonomous_task nunca obtenía schedule).
    const agents = await listBusinessAgents();

    for (const agent of agents) {
      const config = await autonomousTaskFor(agent.role);
      if (config) await ensureSchedule(agent.id, config.interval);
    }

    const due = await loadDueAgents();
    for (const agent of due) {
      const existing = await get<{ count: number }>(
        `SELECT COUNT(*) as count FROM work_items WHERE agent_id = ? AND type = 'autonomous_run' AND status IN ('pending', 'in_progress')`,
        [agent.id]
      );
      if (!existing || existing.count === 0) {
        await createWorkItem({ agentId: agent.id, type: 'autonomous_run', priority: 5, context: agent.task });
      }
      const nextRun = new Date(Date.now() + agent.interval).toISOString();
      await run(
        'UPDATE agent_schedules SET last_run_at = ?, next_run_at = ? WHERE agent_id = ?',
        [nowIso(), nextRun, agent.id]
      );
    }

    // Bloquear pending: uno por agente, prioridad mayor primero
    const pending = await all<{ id: number; agent_id: number }>(
      `SELECT w.id, w.agent_id FROM work_items w
       WHERE w.status = 'pending'
       AND NOT EXISTS (
         SELECT 1 FROM work_items w2
         WHERE w2.agent_id = w.agent_id AND w2.status = 'in_progress'
       )
       ORDER BY w.priority DESC, w.created_at ASC
       LIMIT 5`
    );

    for (const item of pending) {
      // Verificar presupuesto antes de asignar
      const budget = await get<{ monthly_limit_usd: number; current_month_usd: number; status: string }>(
        'SELECT monthly_limit_usd, current_month_usd, status FROM agent_budgets WHERE agent_id = ?',
        [item.agent_id]
      );
      if (budget) {
        const pct = budget.current_month_usd / budget.monthly_limit_usd;
        if (budget.status === 'paused' || pct >= 1.0) {
          console.warn(`[STAGE2] Agente ${item.agent_id} bloqueado por presupuesto (${(pct * 100).toFixed(0)}%)`);
          await run(`UPDATE work_items SET status = 'cancelled', resolved_at = datetime('now') WHERE id = ?`, [item.id]);
          // Si era una tarea de Hokage: libera su reserva de venture y avanza el comando (Fase 7).
          await onHokageWorkItemCancelled(item.id).catch((err) => console.error('[HOKAGE] Error liberando reserva:', err.message));
          continue;
        }
        if (pct >= 0.8) {
          console.warn(`[STAGE2] Agente ${item.agent_id} al ${(pct * 100).toFixed(0)}% del límite mensual`);
        }
      }

      await run(
        `UPDATE work_items SET status = 'in_progress', locked_at = ? WHERE id = ? AND status = 'pending'`,
        [nowIso(), item.id]
      );
      this.activeAgents.add(item.agent_id);
    }
  }

  // Etapa 3: ejecutar work_items in_progress (+ Etapa 5 inline: guardar resultado)
  private async stage3_executeAgents(): Promise<void> {
    const inProgress = await all<{ id: number; agent_id: number; type: string; context: string | null; milestone_id: number | null; venture_id: number | null }>(
      `SELECT w.id, w.agent_id, w.type, w.context, w.milestone_id, w.venture_id
       FROM work_items w
       WHERE w.status = 'in_progress'
       ORDER BY w.priority DESC, w.created_at ASC
       LIMIT 3`
    );

    if (inProgress.length === 0) return;

    const agents = await listAgents();

    for (const item of inProgress) {
      const agent = agents.find((a) => a.id === item.agent_id);
      if (!agent) continue;

      let taskContext = item.context ?? 'Reporta tu estado actual.';

      if (item.type === 'decision_execution' && item.context) {
        try {
          const ctx = JSON.parse(item.context) as { decision_id?: number };
          if (ctx.decision_id) {
            const decision = await get<{ title: string; description: string }>(
              'SELECT title, description FROM decisions WHERE id = ?',
              [ctx.decision_id]
            );
            if (decision) {
              taskContext = `Jorge ha aprobado la siguiente decision. Ejecuta la accion necesaria y reporta que hiciste.\n\nDecision aprobada: ${decision.title}\nContexto: ${decision.description ?? '(sin descripcion adicional)'}`;
            }
          }
        } catch {}
      }

      // venture_id viaja estructural (Fase 3, UI Implementation Plan.md) — ya no se
      // antepone como texto al contexto; llega a askAgent()/ToolContext tal cual.
      const result = await this.runAgent({
        agentId: agent.id,
        agentName: agent.name,
        agentRole: agent.role,
        taskType: item.type,
        context: taskContext,
        ventureId: item.venture_id,
      });

      // Etapa 5 inline: persistir resultado
      await run(
        `UPDATE work_items SET status = ?, result = ?, resolved_at = ?, locked_at = NULL WHERE id = ?`,
        [result.ok ? 'done' : 'failed', (result.response ?? result.error ?? '').slice(0, 2000), nowIso(), item.id]
      );
      this.activeAgents.delete(item.agent_id);

      // Cerrar milestone si este work_item estaba vinculado a uno
      if (item.milestone_id) {
        await closeMilestoneOnResult(item.milestone_id, result.ok);
      }

      // Avanzar el plan del orquestador si este work_item era una tarea de Hokage (Fase 5).
      // Aditivo y gateado por tipo: no afecta a ningún work_item existente.
      if (item.type === 'hokage_task') {
        await onHokageTaskCompleted(item.id, result.ok, result.response ?? result.error ?? '')
          .catch((err) => console.error('[HOKAGE] Error avanzando comando:', err.message));
      }
    }
  }

  // Etapa 4: TTL expirados → devolver a pending (o cancelar tras 3 reintentos)
  private async stage4_checkTTLs(): Promise<void> {
    await run(
      `UPDATE work_items
       SET status = 'pending', locked_at = NULL, retry_count = retry_count + 1
       WHERE status = 'in_progress'
       AND locked_at IS NOT NULL
       AND datetime(locked_at, '+' || ttl_minutes || ' minutes') < datetime('now')
       AND retry_count < 3`
    );
    await run(
      `UPDATE work_items
       SET status = 'cancelled', resolved_at = datetime('now')
       WHERE status = 'in_progress'
       AND locked_at IS NOT NULL
       AND datetime(locked_at, '+' || ttl_minutes || ' minutes') < datetime('now')
       AND retry_count >= 3`
    );
  }

  // Etapa 7: decisiones aprobadas sin work_item de ejecucion → crear P9
  private async stage7_closeDecisionLoop(): Promise<void> {
    const orphaned = await all<{ id: number; agent_id: number; venture_id: number | null }>(
      `SELECT d.id, d.agent_id, d.venture_id FROM decisions d
       WHERE d.status = 'approved'
       AND d.agent_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM work_items w
         WHERE w.type = 'decision_execution'
         AND json_extract(w.context, '$.decision_id') = d.id
         AND w.status != 'cancelled'
       )
       LIMIT 5`
    );

    for (const decision of orphaned) {
      await createWorkItem({
        agentId: decision.agent_id,
        ventureId: decision.venture_id,
        type: 'decision_execution',
        priority: 9,
        context: JSON.stringify({ decision_id: decision.id }),
      });
      console.log(`[STAGE7] Decision ${decision.id} → work_item de ejecucion creado`);
    }
  }

  // Etapa 8: metricas del ciclo + auto-expirar decisiones antiguas
  private async stage8_updateMetrics(): Promise<void> {
    // Auto-expirar proposals sin revisar más de 48h (evita acumulación)
    const expired = await run(
      `UPDATE decisions SET status = 'expired'
       WHERE status IN ('proposed', 'pending')
       AND datetime(created_at, '+48 hours') < datetime('now')`
    );
    if (expired.changes > 0) {
      console.log(`[STAGE8] ${expired.changes} decisiones antiguas expiradas automáticamente`);
    }

    const counts = await get<{ pending: number; in_progress: number; done: number; failed: number }>(
      `SELECT
         SUM(CASE WHEN status='pending'     THEN 1 ELSE 0 END) as pending,
         SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as in_progress,
         SUM(CASE WHEN status='done'        THEN 1 ELSE 0 END) as done,
         SUM(CASE WHEN status='failed'      THEN 1 ELSE 0 END) as failed
       FROM work_items`
    );
    if (counts && (counts.pending > 0 || counts.in_progress > 0)) {
      console.log(`[STAGE8] queue — pending:${counts.pending} active:${counts.in_progress} done:${counts.done} failed:${counts.failed}`);
    }
  }

  // Bus listeners: solo encolar, nunca procesar inline
  private setupEventListeners(): void {
    bus.subscribe('trend.detected',    (event) => this.busEventQueue.push(event));
    bus.subscribe('content.created',   (event) => this.busEventQueue.push(event));
    bus.subscribe('decision.approved', (event) => this.busEventQueue.push(event));
    bus.subscribe('decision.created',  (event) => this.busEventQueue.push(event));
    bus.subscribe('sale.made',         (event) => this.busEventQueue.push(event));
  }

  getStatus(): Record<string, unknown> {
    return {
      running: this.running,
      activeAgents: [...this.activeAgents],
      queuedEvents: this.busEventQueue.length,
      recentEvents: bus.getHistory(10),
    };
  }
}

export const runtime = new AgentRuntime();
export default runtime;
