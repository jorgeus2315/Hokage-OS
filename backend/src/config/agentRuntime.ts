import bus from './eventBus.js';
import { askAgent, writeAgentMemory } from '../services/aiService.js';
import { listAgents } from '../services/agentService.js';
import { createDecision } from '../services/decisionService.js';
import { createMessage } from '../services/messageService.js';
import { get, run, all } from '../db/init.js';

// ═══════════════════════════════════════════════════════
// AGENT RUNTIME — Motor de ejecucion autonoma de agentes
// ═══════════════════════════════════════════════════════

export interface AgentTask {
  agentId: number;
  agentName: string;
  agentRole: string;
  taskType: string;
  context?: string;
}

export interface TaskResult {
  ok: boolean;
  response?: string;
  decision?: { title: string; risk_level: string };
  message?: { to?: number; content: string };
  error?: string;
}

// Mapa de tareas autonomas por rol
const AUTONOMOUS_TASKS: Record<string, { task: string; interval: number }> = {
  investigador: {
    task: 'Analiza las tendencias actuales del mercado de productos digitales y Etsy. Detecta 1-2 oportunidades concretas con ROI estimado. Si encuentras algo valioso, indica que quieres proponer una decision.',
    interval: 30 * 60 * 1000, // 30 minutos
  },
  contenido: {
    task: 'Revisa si hay tendencias nuevas del Explorador o productos pendientes de descripcion. Si tienes trabajo, crealo. Si no, reporta que todo esta al dia.',
    interval: 20 * 60 * 1000, // 20 minutos
  },
  finanzas: {
    task: 'Genera un reporte breve del estado financiero actual. Incluye: ingresos del dia, gastos, margen y una recomendacion. Formato: INGRESOS | GASTOS | MARGEN | ALERTA.',
    interval: 60 * 60 * 1000, // 1 hora
  },
  operaciones: {
    task: 'Verifica el estado de todos los sistemas. Reporta si hay errores o problemas. Formato: Sistema | Estado | Accion.',
    interval: 15 * 60 * 1000, // 15 minutos
  },
  trafico: {
    task: 'Analiza oportunidades de visibilidad y SEO para los productos actuales. Propone 1-2 mejoras concretas.',
    interval: 45 * 60 * 1000, // 45 minutos
  },
  soporte: {
    task: 'Revisa si hay dudas o incidencias de clientes pendientes. Propone mejoras basadas en el feedback reciente. Si no hay nada pendiente, reporta que todo esta al dia.',
    interval: 40 * 60 * 1000, // 40 minutos
  },
  ceo: {
    task: 'Revisa el estado general del equipo y los negocios. Coordina al equipo y propone la siguiente accion estrategica prioritaria.',
    interval: 60 * 60 * 1000, // 1 hora
  },
};

function nowIso(): string {
  return new Date().toISOString();
}

async function ensureSchedule(agentRole: string, intervalMs: number): Promise<void> {
  const row = await get<{ agent_role: string }>('SELECT agent_role FROM agent_schedules WHERE agent_role = ?', [agentRole]);
  if (!row) {
    const nextRun = new Date(Date.now() + intervalMs).toISOString();
    await run(
      'INSERT INTO agent_schedules (agent_role, interval_minutes, last_run_at, next_run_at) VALUES (?, ?, ?, ?)',
      [agentRole, Math.round(intervalMs / 60_000), null, nextRun]
    );
  }
}

async function loadDueAgents(): Promise<Array<{ id: number; name: string; role: string; task: string; interval: number }>> {
  const now = nowIso();
  const rows = await all<{ agent_role: string }>('SELECT agent_role FROM agent_schedules WHERE next_run_at <= ?', [now]);
  const agents = await listAgents();
  const result: Array<{ id: number; name: string; role: string; task: string; interval: number }> = [];

  for (const row of rows) {
    const agent = agents.find((a) => a.role === row.agent_role);
    const config = AUTONOMOUS_TASKS[row.agent_role];
    if (!agent || !config) continue;
    result.push({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      task: config.task,
      interval: config.interval,
    });
  }

  return result;
}

class AgentRuntime {
  private running = false;
  private listenersReady = false;
  private pollTimer: NodeJS.Timeout | null = null;

  // Iniciar el runtime
  start(): void {
    if (this.running) {
      console.log('[RUNTIME] Ya esta corriendo');
      return;
    }
    this.running = true;
    console.log('[RUNTIME] Iniciando ecosistema de agentes...');
    console.time('[RUNTIME] setupEventListeners');

    if (!this.listenersReady) {
      this.setupEventListeners();
      this.listenersReady = true;
    }
    console.timeEnd('[RUNTIME] setupEventListeners');

    // Diferir el primer tick para no bloquear el arranque HTTP
    console.time('[RUNTIME] pollTick defer');
    setTimeout(() => this.pollTick(), 2000);
    console.timeEnd('[RUNTIME] pollTick defer');
  }

  // Detener el runtime
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

  // Ejecutar un agente manualmente con una tarea
  async runAgent(task: AgentTask): Promise<TaskResult> {
    try {
      console.log(`[RUNTIME] Ejecutando ${task.agentName} :: ${task.taskType}`);

      bus.publish({
        type: 'agent.task.start',
        from: task.agentName,
        payload: { taskType: task.taskType, agentId: task.agentId },
      });

      // Inyectar instrucciones de marcadores estructurados
      const taskPrompt = `${task.context || task.taskType}

INSTRUCCIONES DE FORMATO:
- Si necesitas que Jorge apruebe algo (publicar contenido, gastar dinero, cambiar configuración), añade: [DECISION: título en menos de 80 caracteres]
- Si descubres un hecho relevante para recordar en el futuro, añade: [MEMORIA: clave_snake_case=valor en menos de 150 caracteres] (máximo 3 por respuesta)
- Usa los marcadores solo cuando realmente sean necesarios.`;

      const result = await askAgent(task.agentId, taskPrompt);

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

      // Parsear y persistir hechos semánticos que el agente quiso recordar
      const memoryMatches = [...response.matchAll(/\[MEMORIA:\s*([a-z_][a-z0-9_]*)\s*=\s*([^\]]{1,150})\]/gi)];
      for (const match of memoryMatches.slice(0, 3)) {
        const key = match[1].trim().toLowerCase();
        const value = match[2].trim();
        await writeAgentMemory(task.agentId, key, value);
      }

      // Detección precisa de decisiones: solo si el agente usó el marcador estructurado
      const decisionMatch = response.match(/\[DECISION:\s*([^\]]{5,100})\]/i);

      if (decisionMatch) {
        const title = decisionMatch[1].trim();
        await createDecision({
          agent_id: task.agentId,
          title,
          description: response.slice(0, 300),
          reasoning: `Generado automaticamente por ${task.agentName} durante tarea autonoma`,
          risk_level: 'low',
          amount: null,
        });

        bus.publish({
          type: 'decision.created',
          from: task.agentName,
          payload: { title, agentId: task.agentId },
        });
      }

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

  // Programar tareas autonomas basadas en agent_schedules
  private async scheduleAgentTasks(): Promise<void> {
    try {
      const agents = await listAgents();

      for (const agent of agents) {
        const config = AUTONOMOUS_TASKS[agent.role];
        if (!config) continue;

        await ensureSchedule(agent.role, config.interval);
      }

      console.log('[RUNTIME] Schedules sincronizadas para roles activos.');
    } catch (error) {
      console.error('[RUNTIME] Error programando tareas:', error);
    }
  }

  // Tick global: ejecuta roles pendientes y reprograma su siguiente ejecucion
  private async pollTick(): Promise<void> {
    if (!this.running) return;
    console.time('[RUNTIME] pollTick');

    try {
      console.time('[RUNTIME] loadDueAgents');
      const due = await loadDueAgents();
      console.timeEnd('[RUNTIME] loadDueAgents');
      console.log(`[RUNTIME] Agents due: ${due.length}`);

      for (const agent of due) {
        const config = AUTONOMOUS_TASKS[agent.role];
        if (!config) continue;

        console.time(`[RUNTIME] runAgent ${agent.role}`);
        await this.runAgent({
          agentId: agent.id,
          agentName: agent.name,
          agentRole: agent.role,
          taskType: 'autonomous',
          context: agent.task,
        });
        console.timeEnd(`[RUNTIME] runAgent ${agent.role}`);

        const nextRun = new Date(Date.now() + agent.interval).toISOString();
        await run(
          'UPDATE agent_schedules SET last_run_at = ?, next_run_at = ? WHERE agent_role = ?',
          [nowIso(), nextRun, agent.role]
        );
      }
    } catch (error) {
      console.error('[RUNTIME] Error en pollTick:', error);
    } finally {
      console.timeEnd('[RUNTIME] pollTick');
      if (this.running) {
        this.pollTimer = setTimeout(() => this.pollTick(), 10_000);
      }
    }
  }

  // Listeners del event bus para reacciones entre agentes
  private setupEventListeners(): void {
    bus.subscribe('trend.detected', async (event) => {
      console.log(`[BUS] Tendencia detectada por ${event.from}, notificando a Escritor...`);
      try {
        const agents = await listAgents();
        const escritor = agents.find((a) => a.role === 'contenido');
        if (escritor) {
          await createMessage({
            sender_id: agents.find((a) => a.role === 'investigador')?.id || 1,
            receiver_id: escritor.id,
            content: `Nueva tendencia detectada: ${JSON.stringify(event.payload)}. Preparate para crear contenido.`,
            channel: 'internal',
          });
        }
      } catch {}
    });

    bus.subscribe('decision.created', async (event) => {
      console.log(`[BUS] Decision pendiente de ${event.from}, Hokage evaluando...`);
    });

    bus.subscribe('sale.made', async (event) => {
      console.log(`[BUS] Venta registrada: ${JSON.stringify(event.payload)}`);
      bus.publish({
        type: 'agent.task.done',
        from: 'Sistema',
        payload: { message: `Venta registrada: ${event.payload.amount}` },
      });
    });

    bus.subscribe('*', (event) => {
      if (event.type === 'agent.task.start' || event.type === 'agent.task.done') return;
    });
  }

  // Estado actual del runtime
  getStatus(): Record<string, unknown> {
    return {
      running: this.running,
      activeTimers: this.pollTimer ? 1 : 0,
      recentEvents: bus.getHistory(10),
    };
  }
}

// Instancia global
export const runtime = new AgentRuntime();
export default runtime;
