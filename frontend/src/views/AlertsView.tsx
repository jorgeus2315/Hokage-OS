import type { Agent, Decision, Building } from '../shared/types';
import { BUILDINGS } from '../shared/constants';
import { Panel, Led, Badge } from '../shared/ui';
import { BuildingGlyph, IconCheck } from '../shared/icons';
import { Markdown } from '../shared/markdown';

const RISK_TONE = { low: 'good', medium: 'amber', high: 'ember' } as const;

const CAT_TONE: Record<string, 'ember' | 'amber' | 'signal' | 'dim'> = {
  FINANCIAL:   'ember',
  LEGAL:       'ember',
  PUBLICATION: 'signal',
  STRATEGIC:   'amber',
  TECHNICAL:   'dim',
  OPERATIONAL: 'dim',
};

export function AlertsView({
  pending,
  agents,
  onApprove,
  onReject,
  onExpireAll,
}: {
  pending: Decision[];
  agents: Agent[];
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onExpireAll?: () => void;
}) {
  if (pending.length === 0) {
    return (
      <div className="hk-empty-state">
        <div className="hk-empty-state-icon">
          <IconCheck />
        </div>
        <div className="hk-empty-state-title">Todo al día</div>
        <div className="hk-empty-state-sub">No hay propuestas pendientes de revisión.</div>
      </div>
    );
  }

  return (
    <div>
      {pending.length > 5 && onExpireAll && (
        <div className="hk-flex hk-mb-16" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            {pending.length} pendientes
          </span>
          <button className="hk-btn hk-btn--sm hk-btn--ghost-danger" onClick={onExpireAll}>
            Limpiar antiguas
          </button>
        </div>
      )}
      {pending.map((d) => {
        const agent = agents.find((a) => a.id === d.agent_id);
        const building: Building | undefined = BUILDINGS.find((b) => b.role === agent?.role);
        const catTone = CAT_TONE[d.category] ?? 'dim';
        return (
          <Panel key={d.id} className="hk-mb-16">
            <div className="hk-alert-head">
              <Led state={d.risk_level === 'high' ? 'alert' : 'signal'} />
              <span className="hk-alert-title">{d.title}</span>
              <Badge tone={catTone}>{d.category ?? 'OP'}</Badge>
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
            <div className="hk-alert-meta">
              {building && (
                <span className="hk-inline-icon">
                  <BuildingGlyph glyph={building.glyph} />
                </span>
              )}
              Propuesto por {agent?.name || 'Sistema'}
            </div>
            <div className="hk-alert-actions">
              <button className="hk-btn hk-btn--good hk-btn--block" onClick={() => onApprove(d.id)}>
                Aprobar
              </button>
              <button className="hk-btn hk-btn--ghost-danger hk-btn--block" onClick={() => onReject(d.id)}>
                Rechazar
              </button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
