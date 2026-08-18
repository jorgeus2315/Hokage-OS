import { useState, useEffect, useCallback } from 'react';
import type { Agent, Building, AgentMemoryEntry, AgentTool, AgentRuntimeState } from '../shared/types';
import { ROLES } from '../shared/types';
import { api } from '../shared/api';
import { Panel, Badge } from '../shared/ui';
import { IconMemory, IconTool } from '../shared/icons';
import { StatsPanel } from '../panels/StatsPanel';
import { PipelinePanel } from '../panels/PipelinePanel';
import { OutputsPanel } from '../panels/OutputsPanel';
import { AgentConfigPanel } from '../panels/AgentConfigPanel';

export interface AgentPanelProps {
  agent: Agent;
  building: Building;
  agentStates: Record<number, AgentRuntimeState>;
  onClose: () => void;
  onAgentUpdated: () => void;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function AgentPanel({
  agent,
  building,
  agentStates,
  onClose,
  onAgentUpdated,
}: AgentPanelProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'memory' | 'tools' | 'config'>('overview');
  const [memory, setMemory] = useState<AgentMemoryEntry[]>([]);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);

  const runtimeState = agentStates[agent.id];

  const loadMemory = useCallback(async () => {
    setMemoryLoading(true);
    const data = await api.agentMemory(agent.id, 20);
    if (data) setMemory(data);
    setMemoryLoading(false);
  }, [agent.id]);

  const loadTools = useCallback(async () => {
    setToolsLoading(true);
    const data = await api.agentTools(agent.id);
    if (data) setTools(data);
    setToolsLoading(false);
  }, [agent.id]);

  useEffect(() => {
    loadMemory();
    loadTools();
  }, [loadMemory, loadTools]);

  const primary = runtimeState?.primary ?? 'IDLE';
  const modifiers = runtimeState?.modifiers;
  const activity = runtimeState?.activity ?? 0;
  const currentTask = runtimeState?.currentTask;
  const since = runtimeState?.since;

  const statusColor =
    primary === 'WORKING' || primary === 'THINKING' || primary === 'RESEARCHING'
      ? 'var(--good)'
      : primary === 'WAITING' || primary === 'REVIEWING'
      ? 'var(--amber)'
      : primary === 'ERROR'
      ? 'var(--ember)'
      : 'var(--ink-dim)';

  const statusLabel =
    primary === 'IDLE'
      ? 'Inactivo'
      : primary === 'THINKING'
      ? 'Pensando'
      : primary === 'RESEARCHING'
      ? 'Investigando'
      : primary === 'WORKING'
      ? 'Trabajando'
      : primary === 'WAITING'
      ? 'Esperando'
      : primary === 'REVIEWING'
      ? 'Revisando'
      : primary === 'COMMUNICATING'
      ? 'Comunicando'
      : primary === 'MOVING'
      ? 'Moviéndose'
      : primary === 'COMPLETED'
      ? 'Completado'
      : primary === 'ERROR'
      ? 'Error'
      : primary;

  return (
    <div className="hk-game-overlay hk-game-overlay--panel hk-agent-panel">
      <div className="hk-game-right-panel" style={{ maxWidth: 520 }}>
        <div className="hk-game-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                background: statusColor, boxShadow: `0 0 10px ${statusColor}`,
              }}
            />
            <span className="hk-game-panel-title">{agent.name}</span>
            <Badge tone="dim" style={{ fontSize: 10 }}>{ROLES[agent.role] || agent.role}</Badge>
          </div>
          <button className="hk-game-panel-close" onClick={onClose} aria-label="Cerrar panel">
            ✕
          </button>
        </div>

        <div className="hk-game-panel-body">
          {/* Header compacto con estado vivo */}
          <Panel className="hk-mb-12">
            <div className="hk-flex hk-gap-12 hk-flex-wrap">
              <div style={{ flex: 1, minWidth: 180 }}>
                <div className="hk-eyebrow" style={{ marginBottom: 6 }}>ESTADO ACTUAL</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: statusColor, boxShadow: `0 0 8px ${statusColor}`,
                    }}
                  />
                  <span style={{ fontWeight: 600, fontSize: 13, color: statusColor }}>{statusLabel}</span>
                  {modifiers?.awaitingApproval && (
                    <Badge tone="amber" style={{ fontSize: 9 }}>PENDING APPROVAL</Badge>
                  )}
                  {modifiers?.hasError && <Badge tone="ember" style={{ fontSize: 9 }}>ERROR</Badge>}
                  {modifiers?.blocked && <Badge tone="dim" style={{ fontSize: 9 }}>BLOQUEADO</Badge>}
                  {modifiers?.reviewing && <Badge tone="signal" style={{ fontSize: 9 }}>REVIEW</Badge>}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div className="hk-eyebrow" style={{ marginBottom: 6 }}>ACTIVIDAD</div>
                <div style={{ height: 6, background: 'var(--void-deep)', border: '1px solid var(--line)', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    className="hk-bar-fill"
                    style={{
                      width: `${Math.round(activity * 100)}%`, height: '100%',
                      background: `linear-gradient(90deg, var(--good-dim), var(--good))`,
                      boxShadow: `0 0 6px var(--good)`, transition: 'width 0.4s ease',
                    }}
                  />
                </div>
                <div style={{ marginTop: 4, fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace' }}>
                  {since ? `Desde ${timeAgo(since)}` : 'Sin actividad reciente'}
                </div>
              </div>
            </div>

            {currentTask && (
              <div style={{ marginTop: 12, padding: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4 }}>
                <div className="hk-flex hk-gap-8" style={{ fontSize: 11 }}>
                  <span style={{ color: 'var(--ink-faint)' }}>TAREA ACTUAL</span>
                  <span style={{ fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace' }}>{currentTask.kind}</span>
                  {currentTask.tool && (
                    <>
                      <span style={{ color: 'var(--ink-faint)' }}>· tool:</span>
                      <span style={{ color: 'var(--signal)', fontFamily: 'IBM Plex Mono, monospace' }}>{currentTask.tool}</span>
                    </>
                  )}
                  <span style={{ color: 'var(--ink-faint)', marginLeft: 'auto' }}>
                    {timeAgo(currentTask.startedAt)} atrás
                  </span>
                </div>
              </div>
            )}
          </Panel>

          {/* Tabs de navegación */}
          <div className="hk-section-tabs" style={{ marginBottom: 12, display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            {[
              { id: 'overview', label: 'Resumen', icon: '📊' },
              { id: 'memory', label: 'Memoria', icon: '🧠' },
              { id: 'tools', label: 'Tools', icon: '🔧' },
              { id: 'config', label: 'Config', icon: '⚙️' },
            ].map((t) => (
              <button
                key={t.id}
                className={`hk-section-tab${activeTab === t.id ? ' hk-section-tab--active' : ''}`}
                onClick={() => setActiveTab(t.id as typeof activeTab)}
                style={{
                  padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 4,
                  background: activeTab === t.id ? 'var(--surface)' : 'transparent',
                  color: activeTab === t.id ? building.color : 'var(--ink)',
                  fontSize: 11, cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Contenido por tab */}
          <div style={{ minHeight: 200 }}>
            {activeTab === 'overview' && (
              <div>
                <StatsPanel agentId={agent.id} />
                <PipelinePanel agentId={agent.id} />
                <OutputsPanel agentId={agent.id} variant="all" />
              </div>
            )}

            {activeTab === 'memory' && (
              <Panel>
                <div className="hk-flex hk-gap-8" style={{ marginBottom: 12, alignItems: 'center' }}>
                  <div className="hk-eyebrow" style={{ marginBottom: 0 }}>MEMORIA PRIVADA DEL AGENTE</div>
                  <IconMemory style={{ color: building.color }} />
                </div>
                {memoryLoading ? (
                  <div className="hk-feed-empty">Cargando memoria…</div>
                ) : memory.length === 0 ? (
                  <div className="hk-feed-empty">Sin entradas de memoria todavía.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {memory.map((entry) => (
                      <div
                        key={entry.id}
                        style={{
                          padding: '10px 12px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderLeft: `3px solid ${building.color}`,
                          borderRadius: 4,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: building.color, fontFamily: 'IBM Plex Mono, monospace' }}>
                            {entry.key}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'IBM Plex Mono, monospace' }}>
                            {timeAgo(entry.created_at)}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.4, fontFamily: 'IBM Plex Mono, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {entry.value}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--ink-faint)' }}>
                          Categoría: {entry.category} · Venture: {entry.venture_id === 0 ? 'global' : entry.venture_id}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            {activeTab === 'tools' && (
              <Panel>
                <div className="hk-flex hk-gap-8" style={{ marginBottom: 12, alignItems: 'center' }}>
                  <div className="hk-eyebrow" style={{ marginBottom: 0 }}>TOOLS DISPONIBLES PARA {agent.role.toUpperCase()}</div>
                  <IconTool style={{ color: building.color }} />
                </div>
                {toolsLoading ? (
                  <div className="hk-feed-empty">Cargando tools…</div>
                ) : tools.length === 0 ? (
                  <div className="hk-feed-empty">Sin tools asignadas a este rol.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {tools.map((tool) => (
                      <div
                        key={tool}
                        style={{
                          padding: '8px 12px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderLeft: `3px solid var(--signal)`,
                          borderRadius: 4,
                          display: 'flex', alignItems: 'center', gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--signal)', fontFamily: 'IBM Plex Mono, monospace' }}>
                          {tool}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            {activeTab === 'config' && (
              <AgentConfigPanel
                agent={agent}
                accentColor={building.color}
                onSaved={onAgentUpdated}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}