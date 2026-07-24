import type { Decision } from '../shared/types';
import { Led, Badge } from '../shared/ui';
import { IconCheck } from '../shared/icons';
import { Markdown } from '../shared/markdown';

const RISK_TONE = { low: 'good', medium: 'amber', high: 'ember' } as const;

export function AlertsPanel({
  decisions,
  onApprove,
  onReject,
}: {
  decisions: Decision[];
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
}) {
  if (decisions.length === 0) {
    return (
      <div className="hk-empty-state">
        <div className="hk-empty-state-icon">
          <IconCheck />
        </div>
        <div className="hk-empty-state-title">Todo al día</div>
        <div className="hk-empty-state-sub">Este agente no tiene decisiones pendientes.</div>
      </div>
    );
  }
  return (
    <div>
      {decisions.map((d) => (
        <div className="hk-alert-card hk-panel" key={d.id}>
          <div className="hk-alert-head">
            <Led state={d.risk_level === 'high' ? 'alert' : 'signal'} />
            <span className="hk-alert-title">{d.title}</span>
            <Badge tone={RISK_TONE[d.risk_level as keyof typeof RISK_TONE] || 'dim'}>{d.risk_level}</Badge>
          </div>
          {d.description && (
            <div className="hk-alert-desc">
              <Markdown text={d.description} />
            </div>
          )}
          {d.reasoning && (
            <div className="hk-alert-reasoning">
              <Markdown text={d.reasoning} />
            </div>
          )}
          {d.amount != null && <div className="hk-alert-meta">Importe: ${d.amount}</div>}
          <div className="hk-alert-actions">
            <button className="hk-btn hk-btn--good hk-btn--sm hk-btn--block" onClick={() => onApprove(d.id)}>
              Aprobar
            </button>
            <button className="hk-btn hk-btn--ghost-danger hk-btn--sm hk-btn--block" onClick={() => onReject(d.id)}>
              Rechazar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
