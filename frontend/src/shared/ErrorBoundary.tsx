import { Component } from 'react';
import type { ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="hk-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <div className="hk-panel hk-panel--accent" style={{ maxWidth: 480, textAlign: 'center', padding: 32 }}>
            <div className="hk-eyebrow" style={{ color: 'var(--ember)', marginBottom: 10 }}>
              FALLO DEL SISTEMA
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 18 }}>{this.state.error.message}</div>
            <button className="hk-btn hk-btn--primary" onClick={() => window.location.reload()}>
              Reiniciar HOKAGE OS
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
