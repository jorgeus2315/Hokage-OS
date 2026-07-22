import { useState, useEffect, useRef } from 'react';

const API = '/api';

// ═══════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════
interface Agent { id: number; name: string; role: string; status: string; created_at: string; }
interface Business { id: number; name: string; channel: string; category: string | null; status: string; target_revenue: number; current_revenue: number; }
interface Decision { id: number; agent_id: number | null; title: string; amount: number | null; risk_level: string; status: string; }
interface Achievement { id: number; code: string; title: string; description: string; icon: string; xp_reward: number; unlocked_at: string | null; }
interface AgentRun { id: number; agent_id: number; action: string; status: string; started_at: string; }
interface ChatMsg { role: 'user' | 'agent'; text: string; time: string; }

const ROLES: Record<string, string> = {
  ceo: 'Director General', investigador: 'Investigador', contenido: 'Escritor',
  trafico: 'Trafico', soporte: 'Soporte', finanzas: 'Finanzas', operaciones: 'Operaciones'
};

const BUILDINGS = [
  { id: 'hokage', name: 'Torre Hokage', desc: 'Centro de mando', icon: '🏯', color: '#e74c3c', role: 'ceo' },
  { id: 'lab', name: 'Laboratorio', desc: 'Investigacion', icon: '🔬', color: '#3498db', role: 'investigador' },
  { id: 'estudio', name: 'Estudio', desc: 'Contenido', icon: '✏️', color: '#9b59b6', role: 'contenido' },
  { id: 'tienda', name: 'Tienda', desc: 'Ventas', icon: '🏪', color: '#27ae60', role: 'trafico' },
  { id: 'banco', name: 'Banco', desc: 'Finanzas', icon: '🏦', color: '#f39c12', role: 'finanzas' },
  { id: 'taller', name: 'Taller', desc: 'Operaciones', icon: '⚙️', color: '#1abc9c', role: 'operaciones' },
];

type Screen = 'boot' | 'menu' | 'map' | 'hokage' | 'lab' | 'estudio' | 'tienda' | 'banco' | 'taller' | 'crew' | 'missions' | 'alerts';

// ═══════════════════════════════════════
// APP PRINCIPAL
// ═══════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [bootLines, setBootLines] = useState<string[]>([]);
  const [bootProgress, setBootProgress] = useState(0);
  const [clock, setClock] = useState('');
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);
  const [activeBuilding, setActiveBuilding] = useState<typeof BUILDINGS[0] | null>(null);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatIn, setChatIn] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const pending = decisions.filter(d => d.status === 'proposed' || d.status === 'pending');

  // Boot
  useEffect(() => {
    const lines = [
      'HOKAGE OS v0.4.0',
      '',
      'Inicializando sistema...',
      'Conectando base de datos... OK',
      'Cargando agentes... OK',
      'Verificando OpenRouter... OK',
      'Activando modulos IA... OK',
      'Preparando ecosistema... OK',
      '',
      'Bienvenido, Jorge.',
    ];
    let i = 0;
    const t = setInterval(() => {
      if (i < lines.length) {
        setBootLines(p => [...p, lines[i]]);
        setBootProgress(Math.round((i / lines.length) * 100));
        i++;
      } else {
        clearInterval(t);
        setBootProgress(100);
        setTimeout(() => setScreen('menu'), 800);
      }
    }, 220);
    return () => clearInterval(t);
  }, []);

  // Data + clock
  useEffect(() => {
    loadAll();
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('es-ES', { hour12: false })), 1000);
    const r = setInterval(loadAll, 8000);
    return () => { clearInterval(t); clearInterval(r); };
  }, []);

  // Auto scroll chat
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [chatMsgs]);

  async function loadAll() {
    try {
      const [a, b, d, ac, ru, pr] = await Promise.all([
        fetch(API + '/agents').then(r => r.json()),
        fetch(API + '/businesses').then(r => r.json()),
        fetch(API + '/decisions').then(r => r.json()),
        fetch(API + '/achievements').then(r => r.json()),
        fetch(API + '/agent-runs').then(r => r.json()),
        fetch(API + '/progress').then(r => r.json()),
      ]);
      if (a.ok) setAgents(a.data);
      if (b.ok) setBusinesses(b.data);
      if (d.ok) setDecisions(d.data);
      if (ac.ok) setAchievements(ac.data);
      if (ru.ok) setRuns(ru.data);
      if (pr.ok && pr.data?.length > 0) { setXp(pr.data[0].xp); setLevel(pr.data[0].level); }
    } catch {}
  }

  async function sendChat() {
    if (!chatIn.trim() || !activeBuilding || chatLoading) return;
    const agent = agents.find(a => a.role === activeBuilding.role);
    if (!agent) return;
    const msg = chatIn.trim();
    setChatIn('');
    setChatMsgs(p => [...p, { role: 'user', text: msg, time: new Date().toLocaleTimeString('es-ES') }]);
    setChatLoading(true);
    try {
      const res = await fetch(API + '/agents/' + agent.id + '/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const json = await res.json();
      if (json.ok) {
        setChatMsgs(p => [...p, { role: 'agent', text: json.response, time: new Date().toLocaleTimeString('es-ES') }]);
      } else {
        setChatMsgs(p => [...p, { role: 'agent', text: 'Error: ' + json.error, time: new Date().toLocaleTimeString('es-ES') }]);
      }
    } catch {
      setChatMsgs(p => [...p, { role: 'agent', text: 'Error de conexion.', time: new Date().toLocaleTimeString('es-ES') }]);
    }
    setChatLoading(false);
    loadAll();
  }

  async function approve(id: number) {
    await fetch(API + '/decisions/' + id + '/approve', { method: 'PUT' });
    loadAll();
  }

  async function reject(id: number) {
    await fetch(API + '/decisions/' + id + '/reject', { method: 'PUT' });
    loadAll();
  }

  function enterBuilding(b: typeof BUILDINGS[0]) {
    setActiveBuilding(b);
    setChatMsgs([]);
    setScreen(b.id as Screen);
  }

  const xpNext = level * 1000;
  const xpPct = Math.min(100, (xp / xpNext) * 100);

  // ═══════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════
  if (screen === 'boot') return (
    <div style={{ minHeight: '100vh', background: '#0f0f13', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Courier New', monospace" }}>
      <div style={{ width: 420, padding: 40 }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 6, marginBottom: 36, textAlign: 'center' as const }}>
          <span style={{ color: '#e74c3c' }}>HOKAGE</span><span style={{ color: '#444' }}> OS</span>
        </div>
        <div style={{ minHeight: 200 }}>
          {bootLines.map((l, i) => (
            <div key={i} style={{ fontSize: 12, color: !l ? 'transparent' : l.includes('OK') ? '#27ae60' : l.includes('Bienvenido') ? '#3498db' : l === '' ? 'transparent' : '#555', marginBottom: 4, letterSpacing: 0.5 }}>
              {l && l.includes('OK') ? <>{l.replace(' OK', '')} <span style={{ color: '#27ae60', fontWeight: 700 }}>OK</span></> : l || '\u00A0'}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 24, height: 2, background: '#1a1a1a', borderRadius: 1 }}>
          <div style={{ height: '100%', background: '#e74c3c', borderRadius: 1, width: bootProgress + '%', transition: 'width 0.3s' }}></div>
        </div>
        <div style={{ fontSize: 11, color: '#333', textAlign: 'center' as const, marginTop: 8 }}>{bootProgress}%</div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // MENÚ PRINCIPAL
  // ═══════════════════════════════════════
  if (screen === 'menu') return (
    <div style={{ minHeight: '100vh', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system, sans-serif' }}>
      <div style={{ width: 440, padding: 40 }}>
        <div style={{ textAlign: 'center' as const, marginBottom: 32 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1 }}>
            <span style={{ color: '#e74c3c' }}>Hokage</span> OS
          </div>
          <div style={{ color: '#999', fontSize: 13, marginTop: 4 }}>Tu empresa digital inteligente</div>
        </div>

        {/* Commander card */}
        <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>J</div>
              <div><div style={{ fontWeight: 700 }}>Jorge</div><div style={{ fontSize: 12, color: '#999' }}>Fundador · Lv.{level}</div></div>
            </div>
            <div style={{ fontSize: 13, color: '#666' }}>{xp} / {xpNext} XP</div>
          </div>
          <div style={{ height: 4, background: '#eee', borderRadius: 2 }}>
            <div style={{ height: '100%', background: '#e74c3c', borderRadius: 2, width: xpPct + '%', transition: 'width 0.3s' }}></div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
          {[{ v: agents.length, l: 'Agentes' }, { v: businesses.length, l: 'Negocios' }, { v: pending.length, l: 'Alertas', red: pending.length > 0 }].map((s, i) => (
            <div key={i} style={{ flex: 1, background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '12px 0', textAlign: 'center' as const }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.red ? '#e74c3c' : '#111' }}>{s.v}</div>
              <div style={{ fontSize: 11, color: '#999' }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Menu items */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          {[
            { icon: '🏙️', title: 'Ecosistema', desc: 'Ver mapa y agentes trabajando', action: () => setScreen('map') },
            { icon: '🏯', title: 'Hablar con Hokage', desc: pending.length > 0 ? pending.length + ' alertas pendientes' : 'Resumen y estrategia', action: () => { setActiveBuilding(BUILDINGS[0]); setChatMsgs([]); setScreen('hokage'); }, badge: pending.length },
            { icon: '⚔️', title: 'Misiones', desc: 'Ver progreso y logros', action: () => setScreen('missions') },
            { icon: '🚨', title: 'Alertas', desc: 'Aprobar o rechazar propuestas', action: () => setScreen('alerts'), badge: pending.length },
          ].map((item, i) => (
            <button key={i} onClick={item.action} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: '#fff', border: '1px solid #eee', borderRadius: 14, cursor: 'pointer', textAlign: 'left' as const, width: '100%' }}>
              <span style={{ fontSize: 22 }}>{item.icon}</span>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div><div style={{ fontSize: 12, color: '#999' }}>{item.desc}</div></div>
              {item.badge ? <span style={{ background: '#e74c3c', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{item.badge}</span> : null}
              <span style={{ color: '#ccc' }}>›</span>
            </button>
          ))}
        </div>
        <div style={{ textAlign: 'center' as const, marginTop: 24, fontSize: 11, color: '#ddd' }}>{clock} · v0.4.0</div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // TOP BAR (compartida)
  // ═══════════════════════════════════════
  const TopBar = ({ title }: { title: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', background: '#fff', borderBottom: '1px solid #eee', position: 'sticky' as const, top: 0, zIndex: 100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {screen !== 'map' && (
          <button onClick={() => setScreen('map')} style={{ background: 'none', border: '1px solid #eee', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 13, color: '#666' }}>← Mapa</button>
        )}
        <span style={{ fontWeight: 700, fontSize: 15 }}><span style={{ color: '#e74c3c' }}>Hokage</span> OS · {title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {pending.length > 0 && <span style={{ background: '#e74c3c', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 12, cursor: 'pointer' }} onClick={() => setScreen('alerts')}>{pending.length} alertas</span>}
        <span style={{ fontSize: 12, color: '#bbb', fontFamily: 'monospace' }}>{clock}</span>
        <button onClick={() => setScreen('menu')} style={{ background: 'none', border: '1px solid #eee', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontSize: 13, color: '#666' }}>Menú</button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // MAPA ECOSISTEMA
  // ═══════════════════════════════════════
  if (screen === 'map') return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: '-apple-system, sans-serif' }}>
      <TopBar title="Ecosistema" />
      <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>

        {/* Ship crew status */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 10 }}>Ship Crew</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
            {agents.map(a => {
              const lastRun = runs.filter(r => r.agent_id === a.id)[0];
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8f8f8', borderRadius: 8, padding: '6px 10px' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#27ae60', display: 'inline-block' }}></span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</span>
                  <span style={{ fontSize: 11, color: '#999' }}>{lastRun ? lastRun.action : 'En espera'}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Edificios */}
        <div style={{ fontSize: 13, color: '#999', marginBottom: 14 }}>Haz clic en un edificio para entrar</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {BUILDINGS.map(b => {
            const ag = agents.find(a => a.role === b.role);
            const lastRun = ag ? runs.filter(r => r.agent_id === ag.id)[0] : null;
            const hasPending = pending.some(d => d.agent_id === ag?.id);
            return (
              <div key={b.id} onClick={() => enterBuilding(b)} style={{ background: '#fff', borderRadius: 16, padding: 20, cursor: 'pointer', border: '2px solid transparent', transition: 'all 0.15s', position: 'relative' as const, overflow: 'hidden' }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = b.color; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLDivElement).style.transform = 'none'; }}
              >
                <div style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 3, background: b.color }}></div>
                {hasPending && <div style={{ position: 'absolute' as const, top: 10, right: 10, width: 10, height: 10, borderRadius: '50%', background: '#e74c3c' }}></div>}
                <div style={{ fontSize: 32, marginBottom: 10 }}>{b.icon}</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{b.name}</div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>{b.desc}</div>
                {ag && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f8f9fa', borderRadius: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 8, background: b.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{ag.name[0]}</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{ag.name}</div>
                      <div style={{ fontSize: 10, color: '#27ae60' }}>{lastRun ? lastRun.action : 'Activo'}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Nav rápido */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={() => setScreen('missions')} style={quickBtn}>⚔️ Misiones</button>
          <button onClick={() => setScreen('alerts')} style={{ ...quickBtn, color: pending.length > 0 ? '#e74c3c' : '#666', borderColor: pending.length > 0 ? '#e74c3c' : '#eee' }}>🚨 Alertas {pending.length > 0 ? '(' + pending.length + ')' : ''}</button>
          <button onClick={() => setScreen('crew')} style={quickBtn}>👥 Equipo</button>
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // INTERIOR EDIFICIO (con chat IA real)
  // ═══════════════════════════════════════
  const building = activeBuilding || BUILDINGS[0];
  const buildingAgent = agents.find(a => a.role === building.role);

  if (['hokage', 'lab', 'estudio', 'tienda', 'banco', 'taller'].includes(screen)) return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: '-apple-system, sans-serif' }}>
      <TopBar title={building.name} />
      <div style={{ display: 'flex', gap: 20, padding: 24, maxWidth: 1000, margin: '0 auto' }}>

        {/* Chat con IA */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 28 }}>{building.icon}</span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{building.name}</div>
              <div style={{ fontSize: 13, color: '#888' }}>{building.desc}</div>
            </div>
          </div>

          <div ref={chatRef} style={{ background: '#fff', borderRadius: 16, border: '1px solid #eee', padding: 20, height: 400, overflowY: 'auto' as const, marginBottom: 12 }}>
            {chatMsgs.length === 0 && (
              <div style={{ padding: 16, background: '#f8f9fa', borderRadius: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: building.color }}>{buildingAgent?.name || building.name}</div>
                <div style={{ fontSize: 14, color: '#555', lineHeight: 1.6 }}>
                  Hola Jorge. Soy {buildingAgent?.name}, tu {ROLES[building.role] || building.role}. Escribe algo para empezar.
                </div>
              </div>
            )}
            {chatMsgs.map((m, i) => (
              <div key={i} style={{ marginBottom: 12, display: 'flex', flexDirection: m.role === 'user' ? 'row-reverse' as const : 'row' as const, gap: 8 }}>
                <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: 14, background: m.role === 'user' ? '#111' : '#f8f9fa', color: m.role === 'user' ? '#fff' : '#333', fontSize: 14, lineHeight: 1.5 }}>
                  {m.text}
                  <div style={{ fontSize: 10, color: m.role === 'user' ? '#888' : '#bbb', marginTop: 4 }}>{m.time}</div>
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ padding: '10px 14px', background: '#f8f9fa', borderRadius: 14, display: 'inline-block', color: '#888', fontSize: 13 }}>
                Pensando...
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ flex: 1, padding: '11px 14px', border: '1px solid #ddd', borderRadius: 10, fontSize: 14, outline: 'none', background: '#fafafa' }}
              placeholder={'Habla con ' + (buildingAgent?.name || building.name) + '...'}
              value={chatIn}
              onChange={e => setChatIn(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
              disabled={chatLoading}
            />
            <button onClick={sendChat} disabled={chatLoading} style={{ padding: '11px 22px', background: '#111', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Enviar
            </button>
          </div>
        </div>

        {/* Panel lateral */}
        <div style={{ width: 280 }}>
          {/* Agente info */}
          {buildingAgent && (
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 10 }}>Agente</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: building.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700 }}>{buildingAgent.name[0]}</div>
                <div>
                  <div style={{ fontWeight: 700 }}>{buildingAgent.name}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{ROLES[buildingAgent.role]}</div>
                  <div style={{ fontSize: 11, color: '#27ae60', marginTop: 2 }}>● Activo</div>
                </div>
              </div>
            </div>
          )}

          {/* Pendientes de esta estacion */}
          {pending.filter(d => d.agent_id === buildingAgent?.id).length > 0 && (
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 10 }}>Pendientes</div>
              {pending.filter(d => d.agent_id === buildingAgent?.id).map(d => (
                <div key={d.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{d.title}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => approve(d.id)} style={{ flex: 1, padding: '6px 0', background: '#27ae60', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Aprobar</button>
                    <button onClick={() => reject(d.id)} style={{ flex: 1, padding: '6px 0', background: '#fff', color: '#e74c3c', border: '1px solid #e74c3c', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Rechazar</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Otros edificios */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 10 }}>Otras estaciones</div>
            {BUILDINGS.filter(b => b.id !== screen).map(b => (
              <div key={b.id} onClick={() => enterBuilding(b)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer', borderBottom: '1px solid #f5f5f5' }}>
                <span style={{ fontSize: 16 }}>{b.icon}</span>
                <span style={{ fontSize: 13, color: '#555' }}>{b.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // SHIP CREW
  // ═══════════════════════════════════════
  if (screen === 'crew') return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: '-apple-system, sans-serif' }}>
      <TopBar title="Ship Crew" />
      <div style={{ padding: 24, maxWidth: 700, margin: '0 auto' }}>
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#27ae60', display: 'inline-block' }}></span>
          <span style={{ fontSize: 13, color: '#27ae60', fontWeight: 600 }}>STATION ONLINE</span>
        </div>
        {agents.map(a => {
          const lastRun = runs.filter(r => r.agent_id === a.id)[0];
          const building = BUILDINGS.find(b => b.role === a.role);
          return (
            <div key={a.id} onClick={() => building && enterBuilding(building)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, background: '#fff', borderRadius: 14, border: '1px solid #eee', marginBottom: 8, cursor: 'pointer' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: building?.color || '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700 }}>{a.name[0]}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{ROLES[a.role] || a.role}</div>
                {lastRun && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{lastRun.action} · {new Date(lastRun.started_at).toLocaleTimeString('es-ES')}</div>}
              </div>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#27ae60' }}></div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // MISIONES Y LOGROS
  // ═══════════════════════════════════════
  if (screen === 'missions') return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: '-apple-system, sans-serif' }}>
      <TopBar title="Misiones" />
      <div style={{ padding: 24, maxWidth: 700, margin: '0 auto' }}>

        {/* Commander */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #eee', padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, color: '#aaa', letterSpacing: 1 }}>COMMANDER</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>LV.{level} Jorge</div>
            </div>
            <div style={{ fontSize: 13, color: '#666' }}>{xp} / {xpNext} XP</div>
          </div>
          <div style={{ height: 8, background: '#eee', borderRadius: 4 }}>
            <div style={{ height: '100%', background: '#e74c3c', borderRadius: 4, width: xpPct + '%', transition: 'width 0.3s' }}></div>
          </div>
        </div>

        {/* Logros */}
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Logros</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {achievements.map(a => (
            <div key={a.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 14, opacity: a.unlocked_at ? 1 : 0.5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 22 }}>{a.icon}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: '#e74c3c', fontWeight: 600 }}>+{a.xp_reward} XP</div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#888' }}>{a.description}</div>
              {a.unlocked_at && <div style={{ fontSize: 11, color: '#27ae60', marginTop: 6, fontWeight: 600 }}>✓ Completado</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // ALERTAS (APPROVE / REJECT)
  // ═══════════════════════════════════════
  if (screen === 'alerts') return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: '-apple-system, sans-serif' }}>
      <TopBar title="Alertas" />
      <div style={{ padding: 24, maxWidth: 700, margin: '0 auto' }}>
        {pending.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #eee', padding: 40, textAlign: 'center' as const }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Todo al dia</div>
            <div style={{ color: '#aaa', fontSize: 13 }}>No hay propuestas pendientes.</div>
          </div>
        ) : (
          pending.map(d => {
            const ag = agents.find(a => a.id === d.agent_id);
            const b = BUILDINGS.find(bl => bl.role === ag?.role);
            return (
              <div key={d.id} style={{ background: '#fff', borderRadius: 16, border: '1px solid #eee', padding: 20, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: d.risk_level === 'low' ? '#27ae60' : d.risk_level === 'medium' ? '#f39c12' : '#e74c3c', display: 'inline-block' }}></span>
                  <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{d.title}</span>
                  <span style={{ fontSize: 11, padding: '2px 10px', background: '#fff3e0', color: '#f39c12', borderRadius: 10, fontWeight: 600 }}>REVISION</span>
                </div>
                {d.amount && <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>Importe: ${d.amount}</div>}
                <div style={{ fontSize: 12, color: '#aaa', marginBottom: 12 }}>
                  {b && <span style={{ marginRight: 8 }}>{b.icon}</span>}
                  Propuesto por: {ag?.name || 'Sistema'}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => approve(d.id)} style={{ flex: 1, padding: '10px 0', background: '#27ae60', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>APROBAR</button>
                  <button onClick={() => reject(d.id)} style={{ flex: 1, padding: '10px 0', background: '#fff', color: '#e74c3c', border: '2px solid #e74c3c', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>RECHAZAR</button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return <div>Cargando...</div>;
}

const quickBtn: React.CSSProperties = {
  flex: 1, padding: '10px 0', background: '#fff', border: '1px solid #eee',
  borderRadius: 10, fontSize: 13, cursor: 'pointer', color: '#666', fontWeight: 500
};
