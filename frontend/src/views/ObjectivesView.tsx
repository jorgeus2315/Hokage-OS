import { useState } from 'react';
import type { Objective, ObjMilestone, ObjPlan } from '../shared/types';
import { api } from '../shared';

const ROLE_COLOR: Record<string, string> = {
  investigador: '#4fd1c5',
  contenido: '#c77dff',
  trafico: '#f0a93b',
  finanzas: '#3ecf6a',
  operaciones: '#4f8cff',
  soporte: '#a0aec0',
  ceo: '#e8432d',
};

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  planning:  { text: 'PLANIFICANDO', color: '#555' },
  active:    { text: 'ACTIVO',       color: 'var(--signal)' },
  achieved:  { text: 'COMPLETADO',   color: 'var(--good)' },
  paused:    { text: 'PAUSADO',      color: 'var(--amber)' },
  abandoned: { text: 'ABANDONADO',   color: '#555' },
};

const MILESTONE_DOT: Record<string, { color: string; glow: boolean }> = {
  pending:     { color: '#333',             glow: false },
  in_progress: { color: 'var(--signal)',    glow: true },
  done:        { color: 'var(--good)',      glow: false },
  blocked:     { color: 'var(--ember)',     glow: false },
  skipped:     { color: '#333',             glow: false },
};

function parsePhaseTitles(plan: ObjPlan): string[] {
  try { return (JSON.parse(plan.phases) as Array<{ title: string }>).map((p) => p.title); }
  catch { return []; }
}

function MilestoneDot({ status }: { status: string }) {
  const dot = MILESTONE_DOT[status] ?? MILESTONE_DOT.pending;
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: dot.color, flexShrink: 0, marginTop: 2,
      boxShadow: dot.glow ? `0 0 6px ${dot.color}` : 'none',
    }} />
  );
}

function MilestoneRow({ m }: { m: ObjMilestone }) {
  const roleColor = m.assigned_agent_role ? (ROLE_COLOR[m.assigned_agent_role] ?? '#555') : '#555';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0',
      borderBottom: '1px solid #12121a', opacity: m.status === 'skipped' ? 0.4 : 1 }}>
      <MilestoneDot status={m.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: m.status === 'done' ? '#555' : 'var(--ink)', lineHeight: 1.4,
          textDecoration: m.status === 'done' ? 'line-through' : 'none' }}>
          {m.title}
        </div>
        {m.description && m.status !== 'done' && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2 }}>
            {m.description}
          </div>
        )}
      </div>
      {m.assigned_agent_role && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          color: roleColor, border: `1px solid ${roleColor}33`, padding: '1px 5px',
          borderRadius: 2, flexShrink: 0, opacity: 0.85 }}>
          {m.assigned_agent_role.toUpperCase()}
        </span>
      )}
    </div>
  );
}

function ObjectiveCard({
  obj, approving, onApprove, onAbandon,
}: {
  obj: Objective;
  approving: number | null;
  onApprove: (id: number) => void;
  onAbandon: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(obj.plan?.status === 'proposed' || obj.status === 'active');
  const plan = obj.plan;
  const milestones = plan?.milestones ?? [];
  const total = milestones.length;
  const done = milestones.filter((m) => m.status === 'done').length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  const phaseTitles = plan ? parsePhaseTitles(plan) : [];

  const statusInfo = STATUS_LABEL[obj.status] ?? STATUS_LABEL.planning;
  const isProposed = plan?.status === 'proposed';
  const isApproving = approving === obj.id;

  const groupedByPhase: Record<number, ObjMilestone[]> = {};
  for (const m of milestones) {
    if (!groupedByPhase[m.phase_index]) groupedByPhase[m.phase_index] = [];
    groupedByPhase[m.phase_index].push(m);
  }
  const phaseIndices = Object.keys(groupedByPhase).map(Number).sort((a, b) => a - b);

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${isProposed ? 'var(--amber)' : '#1a1a2e'}`,
      borderRadius: 4, overflow: 'hidden',
      boxShadow: isProposed ? '0 0 12px #ffcc0022' : 'none',
      transition: 'border-color 0.2s' }}>

      {/* Cabecera */}
      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
        onClick={() => setExpanded((p) => !p)}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em',
          color: statusInfo.color, border: `1px solid ${statusInfo.color}44`, padding: '2px 6px', borderRadius: 2, flexShrink: 0 }}>
          {statusInfo.text}
        </span>
        <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--ink)', letterSpacing: '0.05em' }}>
          {obj.title}
        </div>
        {plan && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)', flexShrink: 0 }}>
            {done}/{total}
          </span>
        )}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          {'>'}
        </span>
      </div>

      {/* Barra de progreso */}
      {plan && total > 0 && (
        <div style={{ height: 2, background: '#1a1a2e', margin: '0 16px' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: progress === 100 ? 'var(--good)' : 'var(--signal)',
            transition: 'width 0.4s', boxShadow: `0 0 6px var(--signal)` }} />
        </div>
      )}

      {/* Panel expandido */}
      {expanded && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid #1a1a2e' }}>

          {/* Goal estructurado */}
          {obj.goal && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-dim)', marginBottom: 12,
              borderLeft: '2px solid var(--signal)', paddingLeft: 10, lineHeight: 1.5 }}>
              {obj.goal}
            </div>
          )}

          {/* Criterio de éxito */}
          {obj.success_criteria && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--signal)', marginBottom: 12, opacity: 0.8 }}>
              META: {obj.success_criteria}
            </div>
          )}

          {/* Confianza de Hokage */}
          {plan && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.1em' }}>
                CONFIANZA HOKAGE
              </span>
              <div style={{ flex: 1, height: 3, background: '#1a1a2e', borderRadius: 2 }}>
                <div style={{ height: '100%', width: `${plan.confidence}%`, borderRadius: 2,
                  background: plan.confidence >= 75 ? 'var(--good)' : plan.confidence >= 50 ? 'var(--amber)' : 'var(--ember)',
                  transition: 'width 0.4s' }} />
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-faint)' }}>
                {plan.confidence}%
              </span>
              {plan.estimated_weeks && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-faint)' }}>
                  ~{plan.estimated_weeks}s
                </span>
              )}
            </div>
          )}

          {/* Fases y milestones */}
          {phaseIndices.map((phaseIdx) => {
            const phaseMilestones = groupedByPhase[phaseIdx];
            const phaseTitle = phaseTitles[phaseIdx] ?? `Fase ${phaseIdx + 1}`;
            const phaseDone = phaseMilestones.filter((m) => m.status === 'done').length;
            return (
              <div key={phaseIdx} style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em',
                  color: phaseDone === phaseMilestones.length ? 'var(--good)' : 'var(--ink-faint)',
                  marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>— {phaseTitle.toUpperCase()}</span>
                  <span>{phaseDone}/{phaseMilestones.length}</span>
                </div>
                {phaseMilestones.map((m) => <MilestoneRow key={m.id} m={m} />)}
              </div>
            );
          })}

          {/* Sin plan todavía */}
          {!plan && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-faint)', textAlign: 'center', padding: '8px 0' }}>
              Hokage está analizando el objetivo...
            </div>
          )}

          {/* Botones de acción */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {isProposed && (
              <button
                onClick={() => onApprove(obj.id)}
                disabled={isApproving}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em',
                  padding: '7px 14px', border: '1px solid var(--amber)', background: 'transparent',
                  color: 'var(--amber)', cursor: isApproving ? 'wait' : 'pointer', borderRadius: 2,
                  boxShadow: isApproving ? 'none' : '0 0 8px #ffcc0033',
                  opacity: isApproving ? 0.6 : 1, transition: 'all 0.15s' }}>
                {isApproving ? 'ACTIVANDO...' : '[ APROBAR PLAN ]'}
              </button>
            )}
            {obj.status !== 'abandoned' && obj.status !== 'achieved' && (
              <button
                onClick={() => onAbandon(obj.id)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 10, padding: '6px 10px',
                  border: '1px solid #333', background: 'transparent', color: '#555',
                  cursor: 'pointer', borderRadius: 2 }}>
                ABANDONAR
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ObjectivesView({
  objectives,
  onReload,
}: {
  objectives: Objective[];
  onReload: () => void;
}) {
  const [input, setInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || creating) return;
    setCreating(true);
    await api.createObjective(input.trim());
    setInput('');
    setCreating(false);
    onReload();
  }

  async function handleApprove(objectiveId: number) {
    setApproving(objectiveId);
    await api.approvePlan(objectiveId);
    setApproving(null);
    onReload();
  }

  async function handleAbandon(objectiveId: number) {
    await api.updateObjective(objectiveId, { status: 'abandoned' });
    onReload();
  }

  const active = objectives.filter((o) => o.status !== 'abandoned');
  const proposed = active.filter((o) => o.plan?.status === 'proposed');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '0 0 40px' }}>

      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, paddingBottom: 12,
        borderBottom: '1px solid #1a1a2e' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.1em', color: 'var(--ink)' }}>
          OBJETIVOS
        </div>
        {proposed.length > 0 && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--amber)',
            border: '1px solid var(--amber)', padding: '2px 6px', borderRadius: 2,
            boxShadow: '0 0 6px #ffcc0033' }}>
            {proposed.length} PLAN{proposed.length > 1 ? 'ES' : ''} SIN APROBAR
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-faint)' }}>
          {active.length} activos
        </span>
      </div>

      {/* Input de objetivo */}
      <form onSubmit={handleCreate}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center',
          border: `1px solid ${focused ? 'var(--signal)' : '#1a1a2e'}`, borderRadius: 3,
          background: 'var(--surface)', transition: 'border-color 0.15s',
          boxShadow: focused ? '0 0 10px #00ccff22' : 'none' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: creating ? 'var(--amber)' : 'var(--signal)',
            padding: '0 12px', userSelect: 'none', flexShrink: 0 }}>
            {creating ? '○' : '>'}
          </span>
          <input
            value={creating ? 'Hokage analizando el objetivo...' : input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={creating}
            placeholder="Define tu próximo objetivo en lenguaje natural..."
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontFamily: 'var(--font-mono)', fontSize: 13, color: creating ? 'var(--amber)' : 'var(--ink)',
              padding: '13px 0', caretColor: 'var(--signal)', opacity: creating ? 0.7 : 1 }}
          />
          <button
            type="submit"
            disabled={!input.trim() || creating}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em',
              padding: '0 16px', height: '100%', border: 'none', borderLeft: '1px solid #1a1a2e',
              background: 'transparent', color: input.trim() && !creating ? 'var(--signal)' : '#333',
              cursor: input.trim() && !creating ? 'pointer' : 'default', transition: 'color 0.15s',
              flexShrink: 0 }}>
            ENVIAR
          </button>
        </div>
      </form>

      {/* Lista de objetivos */}
      {active.length === 0 && !creating ? (
        <div style={{ textAlign: 'center', padding: '48px 0', fontFamily: 'var(--font-mono)',
          fontSize: 12, color: 'var(--ink-faint)', lineHeight: 2 }}>
          Sin objetivos activos.<br />
          <span style={{ color: 'var(--signal)', opacity: 0.6 }}>
            Escribe el primero arriba.
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {active.map((obj) => (
            <ObjectiveCard
              key={obj.id}
              obj={obj}
              approving={approving}
              onApprove={handleApprove}
              onAbandon={handleAbandon}
            />
          ))}
        </div>
      )}
    </div>
  );
}
