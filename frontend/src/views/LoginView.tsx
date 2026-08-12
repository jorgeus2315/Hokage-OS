import { useState } from 'react';
import { auth } from '../shared/api';

// Login de operador único (Fase 10). La credencial (el ADMIN_TOKEN de backend) se envía una vez
// y el navegador recibe SOLO una cookie de sesión HttpOnly — nada sensible queda en el bundle ni
// en storage. Nunca se guarda la contraseña.
export function LoginView({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError('');
    const ok = await auth.login(password);
    setBusy(false);
    if (ok) { setPassword(''); onLogin(); }
    else setError('Credenciales inválidas');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--void-deep)' }}>
      <form onSubmit={submit} style={{ width: 360, maxWidth: '90vw', display: 'grid', gap: 14, padding: 28, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, letterSpacing: 2 }}>
            <span style={{ color: 'var(--ember)' }}>HOKAGE</span> <span style={{ color: 'var(--ink)' }}>OS</span>
          </div>
          <div style={{ color: 'var(--ink-dim)', fontSize: 12, marginTop: 4 }}>Acceso de operador</div>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Credencial"
          autoFocus
          autoComplete="current-password"
          style={{ background: 'var(--void)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 6, padding: '10px 12px', fontFamily: 'var(--font-mono)' }}
        />
        <button className="hk-btn hk-btn--primary hk-btn--block" type="submit" disabled={busy || !password}>
          {busy ? 'Verificando…' : 'Entrar'}
        </button>
        {error && <div style={{ color: 'var(--ember)', fontSize: 13, textAlign: 'center' }}>{error}</div>}
      </form>
    </div>
  );
}
