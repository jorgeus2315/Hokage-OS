import { useEffect, useRef } from 'react';
import type { Agent, CommMsg, WsEvent } from '../shared/types';
import { Panel, Led } from '../shared/ui';
import { Markdown } from '../shared/markdown';

function agentName(agents: Agent[], id: number | null) {
  if (!id) return 'Sistema';
  return agents.find((a) => a.id === id)?.name || `#${id}`;
}

export function CommsView({
  agents,
  messages,
  liveEvents,
}: {
  agents: Agent[];
  messages: CommMsg[];
  liveEvents: WsEvent[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [messages.length]);

  return (
    <div className="hk-comms-layout">
      <div className="hk-comms-main">
        <div className="hk-flex hk-gap-8 hk-mb-16">
          <Led state="on" />
          <span className="hk-eyebrow" style={{ color: 'var(--good)' }}>
            SHIP COMMS · {agents.length} ONLINE
          </span>
        </div>
        <Panel className="hk-comms-window" style={{ overflowY: 'auto' }}>
          <div ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="hk-comms-empty">Los agentes aún no han enviado mensajes. Activa el modo autónomo para verlos trabajar.</div>
            ) : (
              messages.map((m) => (
                <div className="hk-comms-msg" key={m.id}>
                  <div className="hk-comms-msg-head">
                    <span className="hk-comms-msg-from" style={{ color: 'var(--ember)' }}>
                      {agentName(agents, m.sender_id)}
                    </span>
                    <span className="hk-comms-msg-arrow">→</span>
                    <span className="hk-comms-msg-to">{m.receiver_id ? agentName(agents, m.receiver_id) : 'Todos'}</span>
                    <span className="hk-comms-msg-time">{new Date(m.created_at).toLocaleTimeString('es-ES')}</span>
                  </div>
                  <div className="hk-comms-msg-body">
                    <Markdown text={m.content} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <div className="hk-comms-side">
        <div className="hk-eyebrow" style={{ marginBottom: 10 }}>
          EVENTOS EN VIVO
        </div>
        <Panel style={{ height: 520, overflowY: 'auto' }}>
          {liveEvents.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-faint)', textAlign: 'center', paddingTop: 40 }}>Sin eventos todavía.</div>
          ) : (
            liveEvents.map((e, i) => (
              <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                <div
                  style={{
                    fontSize: 10.5,
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    color: e.type?.includes('error') ? 'var(--ember)' : e.type?.includes('done') ? 'var(--good)' : 'var(--signal)',
                    marginBottom: 2,
                  }}
                >
                  {e.type}
                </div>
                {e.from && <div style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{e.from}</div>}
              </div>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}
