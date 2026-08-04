import { useState, useEffect, useCallback } from 'react';
import type { Agent } from '../shared/types';
import { api } from '../shared/api';

const OPENROUTER_MODELS = [
  { id: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'anthropic/claude-opus-4-5', label: 'Claude Opus 4.5' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
];

export function AgentConfigPanel({
  agent,
  accentColor = 'var(--signal)',
  onSaved,
}: {
  agent: Agent;
  accentColor?: string;
  onSaved: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState(agent.name);
  const [model, setModel] = useState(agent.model || '');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.getAgentPrompt(agent.id).then((r) => {
      setPrompt(r?.content ?? '');
      setLoaded(true);
    });
    setName(agent.name);
    setModel(agent.model || '');
  }, [agent.id, agent.name, agent.model]);

  const save = useCallback(async () => {
    setSaving(true);
    setMsg('');
    const tasks = [
      api.setAgentPrompt(agent.id, prompt || `Eres ${name} de HOKAGE OS. Tu rol es ${agent.role}.`),
      api.updateAgent(agent.id, { name: name.trim(), model: model.trim() }),
    ];
    await Promise.all(tasks);
    setSaving(false);
    setMsg('Guardado');
    onSaved();
    setTimeout(() => setMsg(''), 2500);
  }, [agent.id, agent.role, prompt, name, model, onSaved]);

  if (!loaded) return <div style={{ padding: 20, color: 'var(--ink-faint)', fontSize: 12 }}>Cargando…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
      <div>
        <div className="hk-eyebrow" style={{ marginBottom: 6 }}>NOMBRE DEL AGENTE</div>
        <input
          className="hk-config-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del agente"
        />
      </div>
      <div>
        <div className="hk-eyebrow" style={{ marginBottom: 6 }}>MODELO IA</div>
        <select
          className="hk-config-input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {OPENROUTER_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>
      <div style={{ flex: 1 }}>
        <div className="hk-eyebrow" style={{ marginBottom: 6 }}>PROMPT DEL AGENTE</div>
        <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 6, lineHeight: 1.5 }}>
          Define quién es este agente, qué hace, cómo piensa y qué no debe hacer.
          El prompt maestro global se añade automáticamente antes de este.
        </div>
        <textarea
          className="hk-config-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={12}
          placeholder={`Eres ${agent.name} de HOKAGE OS.\nTu rol es ${agent.role}.\n\nTus responsabilidades son:\n- ...\n\nNunca debes:\n- ...`}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          className="hk-btn hk-btn--sm"
          style={{ background: accentColor, color: '#000', borderColor: accentColor }}
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {msg && (
          <span style={{ fontSize: 11, color: 'var(--good)' }}>✓ {msg}</span>
        )}
      </div>
    </div>
  );
}
