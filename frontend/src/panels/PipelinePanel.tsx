import type { AgentRun } from '../shared/types';
import { Led, Badge } from '../shared/ui';

function statusTone(status: string) {
  if (status === 'completed') return 'good' as const;
  if (status === 'error') return 'ember' as const;
  return 'amber' as const;
}

export function PipelinePanel({ runs }: { runs: AgentRun[] }) {
  if (runs.length === 0) {
    return <div className="hk-feed-empty">No hay tareas en curso. El pipeline se llena cuando el agente trabaja.</div>;
  }
  return (
    <div>
      {runs.map((r) => (
        <div className="hk-pipeline-item" key={r.id}>
          <Led state={r.status === 'completed' ? 'on' : r.status === 'error' ? 'alert' : 'signal'} />
          <div className="hk-pipeline-info">
            <div className="hk-pipeline-action">{r.action}</div>
            <div className="hk-pipeline-time">{new Date(r.started_at).toLocaleString('es-ES')}</div>
          </div>
          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
        </div>
      ))}
    </div>
  );
}
