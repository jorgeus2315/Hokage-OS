import { EventEmitter } from 'events';

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
  | 'system.error';       // Error critico del sistema

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

export default bus;
