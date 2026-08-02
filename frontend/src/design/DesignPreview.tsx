import { GlowText, ProgressBar, StatusDot, TerminalCard, AgentAvatar } from './components';
import { BUILDINGS } from '../shared/constants';

export function DesignPreview() {
  return (
    <div className="hk-app">
      <div className="hk-shell">
        <div className="hk-eyebrow" style={{ marginBottom: 8 }}>Design System / Sesión 1</div>
        <h1 className="hk-display" style={{ fontSize: 24, marginBottom: 28 }}>
          HOKAGE <GlowText tone="ember">OS</GlowText>
        </h1>

        <div className="hk-eyebrow" style={{ marginBottom: 10 }}>GlowText</div>
        <div style={{ display: 'flex', gap: 24, marginBottom: 28, flexWrap: 'wrap' }}>
          <GlowText tone="ember" size={20}>Alerta crítica</GlowText>
          <GlowText tone="signal" size={20}>Dato en vivo</GlowText>
          <GlowText tone="amber" size={20}>Pendiente</GlowText>
          <GlowText tone="good" size={20}>Operativo</GlowText>
        </div>

        <div className="hk-eyebrow" style={{ marginBottom: 10 }}>ProgressBar</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 360, marginBottom: 28 }}>
          <ProgressBar pct={72} tone="ember" label="Ejecución" />
          <ProgressBar pct={45} tone="signal" label="Investigación" />
          <ProgressBar pct={90} tone="good" label="Salud del sistema" animated={false} />
        </div>

        <div className="hk-eyebrow" style={{ marginBottom: 10 }}>StatusDot</div>
        <div style={{ display: 'flex', gap: 20, marginBottom: 28, flexWrap: 'wrap' }}>
          <StatusDot status="online" label="En línea" />
          <StatusDot status="warning" label="Advertencia" />
          <StatusDot status="error" label="Error" />
          <StatusDot status="idle" label="Inactivo" />
        </div>

        <div className="hk-eyebrow" style={{ marginBottom: 10 }}>TerminalCard</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 28 }}>
          <TerminalCard title="Sin acento">
            Card base sin color de acento, usa el borde tenue por defecto.
          </TerminalCard>
          <TerminalCard title="Acento ember" tone="ember">
            Bordes con glow ember en las esquinas.
          </TerminalCard>
          <TerminalCard title="Acento signal" tone="signal">
            Bordes con glow signal en las esquinas.
          </TerminalCard>
        </div>

        <div className="hk-eyebrow" style={{ marginBottom: 10 }}>AgentAvatar</div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 40, flexWrap: 'wrap' }}>
          {BUILDINGS.map((b) => (
            <div key={b.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <AgentAvatar name={b.name} role={b.role} size="lg" />
              <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)' }}>{b.role}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
