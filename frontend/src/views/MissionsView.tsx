import type { Achievement } from '../shared/types';
import { Panel, Bar } from '../shared/ui';
import { IconMedal, IconCheck } from '../shared/icons';

export function MissionsView({ level, xp, xpNext, achievements }: { level: number; xp: number; xpNext: number; achievements: Achievement[] }) {
  const xpPct = Math.min(100, (xp / xpNext) * 100);

  return (
    <div>
      <Panel className="hk-rank-card" accent>
        <div className="hk-rank-top">
          <div>
            <div className="hk-eyebrow">COMANDANTE</div>
            <div className="hk-rank-level">
              NV.{level} <em>Jorge</em>
            </div>
          </div>
          <div className="hk-rank-xp">
            {xp} / {xpNext} XP
          </div>
        </div>
        <Bar pct={xpPct} />
      </Panel>

      <div className="hk-section-heading">Logros</div>
      <div className="hk-achv-grid">
        {achievements.length === 0 && (
          <div style={{ color: 'var(--ink-faint)', fontSize: 12.5 }}>Sin logros registrados todavía.</div>
        )}
        {achievements.map((a) => (
          <Panel key={a.id} className={`hk-achv-card${a.unlocked_at ? ' hk-achv-card--unlocked' : ''}`}>
            <div className="hk-achv-head">
              <span className="hk-achv-glyph">
                <IconMedal />
              </span>
              <div>
                <div className="hk-achv-title">{a.title}</div>
                <div className="hk-achv-xp">+{a.xp_reward} XP</div>
              </div>
            </div>
            <div className="hk-achv-desc">{a.description}</div>
            {a.unlocked_at && (
              <div className="hk-achv-done">
                <IconCheck /> Completado
              </div>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}
