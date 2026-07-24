import { useEffect, useRef } from 'react';
import type { Agent, ChatMsg } from '../shared/types';
import { ROLES } from '../shared/types';
import { Markdown } from '../shared/markdown';

export function ChatPanel({
  agent,
  buildingName,
  messages,
  input,
  loading,
  onChangeInput,
  onSend,
}: {
  agent: Agent | undefined;
  buildingName: string;
  messages: ChatMsg[];
  input: string;
  loading: boolean;
  onChangeInput: (v: string) => void;
  onSend: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  return (
    <div>
      <div className="hk-chat-window" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="hk-chat-empty">
            <div className="hk-chat-empty-name">{agent?.name || buildingName}</div>
            <div className="hk-chat-empty-text">
              Hola Jorge. Soy {agent?.name}, tu {ROLES[agent?.role || ''] || agent?.role}. Escribe algo para empezar.
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`hk-msg hk-msg--${m.role}`}>
            <div className="hk-msg-bubble">
              {m.role === 'agent' && m.agentName && <div className="hk-msg-agentname">{m.agentName}</div>}
              <Markdown text={m.text} />
              <div className="hk-msg-time">{m.time}</div>
            </div>
          </div>
        ))}
        {loading && <div className="hk-chat-typing">{agent?.name || buildingName} está pensando…</div>}
      </div>
      <div className="hk-chat-input-row">
        <input
          className="hk-chat-input"
          placeholder={`Habla con ${agent?.name || buildingName}…`}
          value={input}
          onChange={(e) => onChangeInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend();
          }}
          disabled={loading}
        />
        <button className="hk-btn hk-btn--primary" onClick={onSend} disabled={loading || !input.trim()}>
          Enviar
        </button>
      </div>
    </div>
  );
}
