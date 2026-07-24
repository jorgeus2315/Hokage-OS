import type { AgentRun, Decision, CommMsg } from '../shared/types';
import { Panel } from '../shared/ui';

export function StatsPanel({
  runs,
  decisions,
  messages,
}: {
  runs: AgentRun[];
  decisions: Decision[];
  messages: CommMsg[];
}) {
  const completed = runs.filter((r) => r.status === 'completed').length;
  const approved = decisions.filter((d) => d.status === 'approved').length;
  const proposed = decisions.length;

  const stats = [
    { label: 'Ejecuciones', value: runs.length },
    { label: 'Completadas', value: completed },
    { label: 'Propuestas', value: proposed },
    { label: 'Aprobadas', value: approved },
    { label: 'Mensajes enviados', value: messages.length },
    { label: 'Tasa de éxito', value: runs.length ? `${Math.round((completed / runs.length) * 100)}%` : '—' },
  ];

  return (
    <div className="hk-statgrid">
      {stats.map((s) => (
        <Panel key={s.label} className="hk-statcard">
          <div className="hk-statcard-value">{s.value}</div>
          <div className="hk-statcard-label">{s.label}</div>
        </Panel>
      ))}
    </div>
  );
}
