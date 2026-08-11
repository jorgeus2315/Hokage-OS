import { EventEmitter } from 'events';
import { run } from '../db/init.js';

// ═══════════════════════════════════════════════════════
// EVENT BUS — Comunicacion entre agentes en tiempo real
// ═══════════════════════════════════════════════════════

export type AgentEventType =
  | 'trend.detected'      // Explorador detecta tendencia
  | 'content.created'     // Escritor crea contenido
  | 'content.ready'       // Contenido listo para publicar
  | 'decision.created'    // Agente propone decision
  | 'decision.approved'   // Jorge aprueba
  | 'decision.rejected'   // Jorge rechaza
  | 'sale.made'           // Venta registrada
  | 'alert.triggered'     // Alerta importante
  | 'agent.task.start'    // Agente inicia tarea
  | 'agent.task.done'     // Agente termina tarea
  | 'agent.task.error'    // Agente falla
  | 'report.daily'        // Reporte diario de Finanzas
  | 'system.error'        // Error critico del sistema
  | 'objective.created'   // Jorge crea un nuevo objetivo
  | 'objective.approved'  // Jorge aprueba el plan de un objetivo
  | 'objective.achieved'  // Todos los milestones de un objetivo completados
  | 'hokage.command.created'   // Orden recibida y descompuesta en un plan
  | 'hokage.task.dispatched'   // Tarea de Hokage convertida en work_item
  | 'hokage.phase.completed'   // Todas las tareas de una fase terminaron OK
  | 'hokage.command.replanned' // Supervisor generó un plan alternativo tras un fallo
  | 'hokage.command.completed'; // Orden finalizada (completed/partial/failed)

export interface AgentEvent {
  type: AgentEventType;
  from: string;           // Nombre del agente emisor
  to?: string;            // Nombre del agente receptor (undefined = broadcast)
  payload: Record<string, unknown>;
  timestamp: Date;
}

class HokageBus extends EventEmitter {
  private history: AgentEvent[] = [];
  private maxHistory = 100;

  // Publicar evento — único punto de registro/log, sin duplicados
  publish(data: Omit<AgentEvent, 'timestamp'>): void {
    const event: AgentEvent = { ...data, timestamp: new Date() };

    this.history.unshift(event);
    if (this.history.length > this.maxHistory) {
      this.history.pop();
    }
    console.log(`[BUS] ${event.from} → ${event.to || 'todos'} :: ${event.type}`);

    super.emit(event.type, event);
    super.emit('*', event); // Listener global para Ship Comms
  }

  // Suscribirse a un tipo de evento
  subscribe(type: AgentEventType | '*', handler: (event: AgentEvent) => void): void {
    this.on(type, handler);
  }

  // Ver historial reciente
  getHistory(limit = 20): AgentEvent[] {
    return this.history.slice(0, limit);
  }

  // Ver historial filtrado por agente
  getAgentHistory(agentName: string, limit = 10): AgentEvent[] {
    return this.history
      .filter(e => e.from === agentName || e.to === agentName)
      .slice(0, limit);
  }
}

// Instancia global unica
export const bus = new HokageBus();
bus.setMaxListeners(50);

// Persistencia en event_log — Fase 2 de UI Implementation Plan.md. Suscriptor
// independiente, no forma parte del contrato de HokageBus: publish()/subscribe()/
// getHistory() no cambian, esto es un consumidor más de la misma API pública,
// igual que server.ts ya hace para el WebSocket. Async + try/catch a propósito:
// una excepción síncrona dentro de un listener de EventEmitter se propagaría a
// través de publish() y rompería a quien lo llame (agentRuntime.ts, tools, rutas
// de server.ts) — declarar el handler async evita eso, y el catch evita incluso
// el warning de unhandledRejection si la escritura falla.
bus.subscribe('*', async (event) => {
  try {
    await run(
      'INSERT INTO event_log (type, from_actor, to_actor, payload) VALUES (?, ?, ?, ?)',
      [event.type, event.from, event.to ?? null, JSON.stringify(event.payload)]
    );
  } catch (err: any) {
    console.error('[EVENT_LOG] Error persistiendo evento:', err.message);
  }
});

export default bus;
