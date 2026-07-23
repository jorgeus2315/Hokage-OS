import bus from './eventBus.js';
import { askAgent } from '../services/aiService.js';
import { listAgents } from '../services/agentService.js';
import { createDecision } from '../agents/DecisionHandler.js';
import { createMessage } from '../agents/MessageHandler.js';
import { run, get, all } from '../db/init.js';

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
const AUTONOMOUS_TASKS: Record<string, { task: string; interval: number; model?: string }> = {
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
  ceo: {
    task: 'Revisa el estado general del equipo y los negocios. Coordina al equipo y propone la siguiente accion estrategica prioritaria.',
    interval: 60 * 60 * 1000, // 1 hora
  },
};

class AgentRuntime {
  private running = false;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private lastRun: Map<string, Date> = new Map();

  // Iniciar el runtime
  start(): void {
    if (this.running) {
      console.log('[RUNTIME] Ya esta corriendo');
      return;
    }
    this.running = true;
    console.log('[RUNTIME] Iniciando ecosistema de agentes...');

    // Conectar agentes al event bus
    this.setupEventListeners();

    // Programar tareas autonomas
    this.scheduleAgentTasks();

    console.log('[RUNTIME] Ecosistema activo. Agentes trabajando en segundo plano.');
  }

  // Detener el runtime
  stop(): void {
    this.running = false;
    this.timers.forEach(timer => clearInterval(timer));
    this.timers.clear();
    console.log('[RUNTIME] Ecosistema detenido.');
  }

  isRunning(): boolean {
    return this.running;
  }

  // Ejecutar un agente manualmente con una tarea
  async runAgent(task: AgentTask): Promise<TaskResult> {
    try {
      console.log(`[RUNTIME] Ejecutando ${task.agentName} :: ${task.taskType}`);

      // Publicar inicio
      bus.publish({
        type: 'agent.task.start',
        from: task.agentName,
        payload: { taskType: task.taskType, agentId: task.agentId },
      });

      // Llamar a la IA
      const result = await askAgent(task.agentId, task.context || task.taskType);

      if (!result.ok) {
        bus.publish({ type: 'agent.task.error', from: task.agentName, payload: { error: result.error } });
        return { ok: false, error: result.error };
      }

      const response = result.data?.response || '';

      // Guardar mensaje en comms
      await createMessage({
        sender_id: task.agentId,
        receiver_id: null,
        content: response.slice(0, 500), // Max 500 chars en comms
        channel: 'general',
      });

      // Detectar si el agente quiere proponer una decision
      const wantsDecision = response.toLowerCase().includes('propongo') ||
        response.toLowerCase().includes('recomiendo aprobar') ||
        response.toLowerCase().includes('decision:') ||
        response.toLowerCase().includes('propuesta:');

      if (wantsDecision) {
        const title = this.extractDecisionTitle(response, task.agentName);
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

      // Publicar resultado
      bus.publish({
        type: 'agent.task.done',
        from: task.agentName,
        payload: { taskType: task.taskType, response: response.slice(0, 200) },
      });

      // Actualizar last run
      this.lastRun.set(task.agentRole, new Date());

      return { ok: true, response };
    } catch (error: any) {
      bus.publish({ type: 'agent.task.error', from: task.agentName, payload: { error: error.message } });
      return { ok: false, error: error.message };
    }
  }

  // Programar tareas autonomas de cada agente
  private async scheduleAgentTasks(): Promise<void> {
    // Esperar 5 segundos para que la BD este lista
    await new Promise(r => setTimeout(r, 5000));

    try {
      const agents = await listAgents();

      for (const agent of agents) {
        const config = AUTONOMOUS_TASKS[agent.role];
        if (!config) continue;

        // Primera ejecucion: esperar un tiempo aleatorio (no todos a la vez)
        const initialDelay = Math.random() * 2 * 60 * 1000; // 0-2 minutos

        setTimeout(async () => {
          if (!this.running) return;
          await this.runAgent({
            agentId: agent.id,
            agentName: agent.name,
            agentRole: agent.role,
            taskType: 'autonomous',
            context: config.task,
          });

          // Programar ejecuciones periodicas
          const timer = setInterval(async () => {
            if (!this.running) return;
            await this.runAgent({
              agentId: agent.id,
              agentName: agent.name,
              agentRole: agent.role,
              taskType: 'autonomous',
              context: config.task,
            });
          }, config.interval);

          this.timers.set(agent.role, timer);
        }, initialDelay);

        console.log(`[RUNTIME] ${agent.name} programado cada ${config.interval / 60000} min`);
      }
    } catch (error) {
      console.error('[RUNTIME] Error programando tareas:', error);
    }
  }

  // Listeners del event bus para reacciones entre agentes
  private setupEventListeners(): void {
    // Cuando Explorador detecta tendencia → notifica a Escritor
    bus.subscribe('trend.detected', async (event) => {
      console.log(`[BUS] Tendencia detectada por ${event.from}, notificando a Escritor...`);
      try {
        const agents = await listAgents();
        const escritor = agents.find(a => a.role === 'contenido');
        if (escritor) {
          await createMessage({
            sender_id: agents.find(a => a.role === 'investigador')?.id || 1,
            receiver_id: escritor.id,
            content: `Nueva tendencia detectada: ${JSON.stringify(event.payload)}. Preparate para crear contenido.`,
            channel: 'internal',
          });
        }
      } catch {}
    });

    // Cuando hay decision creada → Hokage evalua
    bus.subscribe('decision.created', async (event) => {
      console.log(`[BUS] Decision pendiente de ${event.from}, Hokage evaluando...`);
    });

    // Cuando hay venta → Finanzas registra y Hokage celebra
    bus.subscribe('sale.made', async (event) => {
      console.log(`[BUS] Venta registrada: ${JSON.stringify(event.payload)}`);
      bus.publish({
        type: 'agent.task.done',
        from: 'Sistema',
        payload: { message: `Venta registrada: ${event.payload.amount}` },
      });
    });

    // Log de todos los eventos
    bus.subscribe('*', (event) => {
      if (event.type === 'agent.task.start' || event.type === 'agent.task.done') return;
    });
  }

  // Extraer titulo de decision del texto del agente
  private extractDecisionTitle(text: string, agentName: string): string {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.toLowerCase().includes('propongo') || line.toLowerCase().includes('recomiendo')) {
        return line.replace(/[*#]/g, '').trim().slice(0, 100);
      }
    }
    return `${agentName}: Propuesta automatica`;
  }

  // Estado actual del runtime
  getStatus(): Record<string, unknown> {
    return {
      running: this.running,
      activeTimers: this.timers.size,
      lastRuns: Object.fromEntries(this.lastRun),
      recentEvents: bus.getHistory(10),
    };
  }
}

// Instancia global
export const runtime = new AgentRuntime();
export default runtime;
