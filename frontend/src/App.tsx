import { useEffect, useState } from 'react';
import { BootView } from './views/BootView';
import { GameLayout } from './views/GameLayout';
import { LoginView } from './views/LoginView';
import { auth, setSessionExpiredHandler } from './shared/api';

export default function App() {
  const [authState, setAuthState] = useState<'checking' | 'in' | 'out'>('checking');
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    // Un 401 en cualquier llamada (sesión ausente/expirada) devuelve al login, sin bucles.
    setSessionExpiredHandler(() => setAuthState('out'));
    auth.session().then((s) => setAuthState(s?.authenticated ? 'in' : 'out'));
    return () => setSessionExpiredHandler(null);
  }, []);

  if (authState === 'checking') {
    return <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--void-deep)', color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)' }}>Cargando…</div>;
  }
  if (authState === 'out') return <LoginView onLogin={() => setAuthState('in')} />;
  if (!booted) return <BootView onDone={() => setBooted(true)} />;
  return <GameLayout />;
}
