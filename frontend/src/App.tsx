import { useState, useEffect, useRef, useCallback } from 'react';

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════
const API = '/api';
const WS_URL = 'ws://localhost:3000';

// ═══════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════
interface Agent { id: number; name: string; role: string; status: string; }
interface Business { id: number; name: string; channel: string; category: string | null; status: string; target_revenue: number; current_revenue: number; }
interface Decision { id: number; agent_id: number | null; title: string; amount: number | null; risk_level: string; status: string; }
interface Achievement { id: number; code: string; title: string; description: string; icon: string; xp_reward: number; unlocked_at: string | null; }
interface AgentRun { id: number; agent_id: number; action: string; status: string; started_at: string; }
interface WsEvent { type: string; from?: string; to?: string; payload?: Record<string, unknown>; timestamp?: string; }
interface ChatMsg { role: 'user' | 'agent'; text: string; time: string; agentName?: string; }
interface CommMsg { id: number; sender_id: number | null; receiver_id: number | null; content: string; channel: string; created_at: string; }

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

type Screen = 'boot' | 'menu' | 'map' | 'building' | 'crew' | 'missions' | 'alerts' | 'comms';

// ═══════════════════════════════════════
// HOOK: WEBSOCKET
// ═══════════════════════════════════════
function useWebSocket(url: string, onEvent: (e: WsEvent) => void) {
  const ws = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    function connect() {
      try {
        ws.current = new WebSocket(url);
        ws.current.onopen = () => { setConnected(true); console.log('[WS] Conectado'); };
        ws.current.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch {} };
        ws.current.onclose = () => { setConnected(false); setTimeout(connect, 3000); };
        ws.current.onerror = () => { ws.current?.close(); };
      } catch {}
    }
    connect();
    return () => { ws.current?.close(); };
  }, [url]);

  return connected;
}

// ═══════════════════════════════════════
// APP
// ═══════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [messages, setMessages] = useState<CommMsg[]>([]);
  const [liveEvents, setLiveEvents] = useState<WsEvent[]>([]);
  const [bootLines, setBootLines] = useState<string[]>([]);
  const [bootPct, setBootPct] = useState(0);
  const [clock, setClock] = useState('');
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);
  const [runtimeOn, setRuntimeOn] = useState(false);
  const [activeBuilding, setActiveBuilding] = useState<typeof BUILDINGS[0] | null>(null);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatIn, setChatIn] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [toast, setToast] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  const commsRef = useRef<HTMLDivElement>(null);

  const pending = decisions.filter(d => d.status === 'proposed' || d.status === 'pending');
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000); };
  const gn = (id: number | null) => { if (!id) return 'Sistema'; return agents.find(x => x.id === id)?.name || '#' + id; };

  // WebSocket
  const handleWsEvent = useCallback((e: WsEvent) => {
    setLiveEvents(prev => [e, ...prev].slice(0, 50));
    if (e.type === 'message.new') loadMessages();
    if (e.type === 'decision.new' || e.type === 'decision.approved' || e.type === 'decision.rejected') loadDecisions();
    if (e.type === 'agent.event') loadRuns();
  }, [agents]);

  const wsConnected = useWebSocket(WS_URL, handleWsEvent);

  // Boot
  useEffect(() => {
    const lines = ['HOKAGE OS v0.4.0', '', 'Iniciando sistema...', 'Conectando base de datos... OK',
      'Cargando agentes... OK', 'Verificando OpenRouter... OK', 'Activando runtime... OK',
      'Preparando ecosistema... OK', '', 'Bienvenido, Jorge.'];
    let i = 0;
    const t = setInterval(() => {
      if (i < lines.length) { setBootLines(p => [...p, lines[i]]); setBootPct(Math.round((i / lines.length) * 100)); i++; }
      else { clearInterval(t); setBootPct(100); setTimeout(() => setScreen('menu'), 800); }
    }, 220);
    return () => clearInterval(t);
  }, []);

  // Data + clock
  useEffect(() => {
    loadAll();
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('es-ES', { hour12: false })), 1000);
    const r = setInterval(loadAll, 10000);
    return () => { clearInterval(t); clearInterval(r); };
  }, []);

  // Auto scroll
  useEffect(() => { chatRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMsgs]);
  useEffect(() => { if (commsRef.current) commsRef.current.scrollTop = commsRef.current.scrollHeight; }, [messages]);

  async function loadAll() { await Promise.all([loadAgents(), loadBusinesses(), loadDecisions(), loadAchievements(), loadRuns(), loadMessages(), loadProgress()]); }
  async function loadAgents() { try { const r = await fetch(API + '/agents').then(r => r.json()); if (r.ok) setAgents(r.data); } catch {} }
  async function loadBusinesses() { try { const r = await fetch(API + '/businesses').then(r => r.json()); if (r.ok) setBusinesses(r.data); } catch {} }
  async function loadDecisions() { try { const r = await fetch(API + '/decisions').then(r => r.json()); if (r.ok) setDecisions(r.data); } catch {} }
  async function loadAchievements() { try { const r = await fetch(API + '/achievements').then(r => r.json()); if (r.ok) setAchievements(r.data); } catch {} }
  async function loadRuns() { try { const r = await fetch(API + '/agent-runs').then(r => r.json()); if (r.ok) setRuns(r.data); } catch {} }
  async function loadMessages() { try { const r = await fetch(API + '/messages').then(r => r.json()); if (r.ok) setMessages(r.data); } catch {} }
  async function loadProgress() { try { const r = await fetch(API + '/progress').then(r => r.json()); if (r.ok && r.data?.length > 0) { setXp(r.data[0].xp); setLevel(r.data[0].level); } } catch {} }

  async function sendChat() {
    if (!chatIn.trim() || !activeBuilding || chatLoading) return;
    const agent = agents.find(a => a.role === activeBuilding.role);
    if (!agent) return;
    const msg = chatIn.trim();
    setChatIn('');
    setChatMsgs(p => [...p, { role: 'user', text: msg, time: new Date().toLocaleTimeString('es-ES') }]);
    setChatLoading(true);
    try {
      const res = await fetch(`${API}/agents/${agent.id}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) });
      const json = await res.json();
      const text = json.response || json.data?.response || json.error || 'Sin respuesta';
      setChatMsgs(p => [...p, { role: 'agent', text, time: new Date().toLocaleTimeString('es-ES'), agentName: agent.name }]);
    } catch {
      setChatMsgs(p => [...p, { role: 'agent', text: 'Error de conexion.', time: new Date().toLocaleTimeString('es-ES') }]);
    }
    setChatLoading(false);
    loadMessages();
  }

  async function approve(id: number) { await fetch(`${API}/decisions/${id}/approve`, { method: 'PUT' }); loadDecisions(); show('✅ Aprobado'); }
  async function reject(id: number) { await fetch(`${API}/decisions/${id}/reject`, { method: 'PUT' }); loadDecisions(); show('❌ Rechazado'); }

  async function toggleRuntime() {
    const endpoint = runtimeOn ? '/api/runtime/stop' : '/api/runtime/start';
    await fetch(endpoint, { method: 'POST' });
    setRuntimeOn(!runtimeOn);
    show(runtimeOn ? 'Runtime detenido' : 'Runtime iniciado');
  }

  function enterBuilding(b: typeof BUILDINGS[0]) {
    setActiveBuilding(b);
    setChatMsgs([]);
    setScreen('building');
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
        <div style={{ minHeight: 220 }}>
          {bootLines.map((l, i) => (
            <div key={i} style={{ fontSize: 12, marginBottom: 4, letterSpacing: 0.5, color: !l ? 'transparent' : l.includes('OK') ? '#27ae60' : l.includes('Bienvenido') ? '#3498db' : '#555' }}>
              {l && l.includes('OK') ? <>{l.replace(' OK', '')} <span style={{ color: '#27ae60', fontWeight: 700 }}>OK</span></> : l || '\u00A0'}
            </div>
          ))}
        </div>
        <div style={{ height: 2, background: '#1a1a1a', borderRadius: 1, marginTop: 20 }}>
          <div style={{ height: '100%', background: '#e74c3c', borderRadius: 1, width: bootPct + '%', transition: 'width 0.3s' }}></div>
        </div>
        <div style={{ fontSize: 10, color: '#333', textAlign: 'center' as const, marginTop: 6 }}>{bootPct}%</div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // TOP BAR (shared)
  // ═══════════════════════════════════════
  const TopBar = ({ title }: { title: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', background: '#fff', borderBottom: '1px solid #eee', position: 'sticky' as const, top: 0, zIndex: 100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {screen !== 'map' && <button onClick={() => setScreen('map')} style={btnOutline}>← Mapa</button>}
        <span style={{ fontWeight: 700, fontSize: 15 }}><span style={{ color: '#e74c3c' }}>Hokage</span> OS · {title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: wsConnected ? '#27ae60' : '#e74c3c' }} title={wsConnected ? 'WS conectado' : 'WS desconectado'}></div>
        {pending.length > 0 && <button onClick={() => setScreen('alerts')} style={{ ...btnOutline, color: '#e74c3c', borderColor: '#e74c3c' }}>{pending.length} alertas</button>}
        <span style={{ fontSize: 12, color: '#bbb', fontFamily: 'monospace' }}>{clock}</span>
        <button onClick={() => setScreen('menu')} style={btnOutline}>Menú</button>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // MENÚ
  // ═══════════════════════════════════════
  if (screen === 'menu') return (
    <div style={{ minHeight: '100vh', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system, sans-serif' }}>
      <div style={{ width: 440, padding: 40 }}>
        <div style={{ textAlign: 'center' as const, marginBottom: 28 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1 }}><span style={{ color: '#e74c3c' }}>Hokage</span> OS</div>
          <div style={{ color: '#999', fontSize: 13, marginTop: 4 }}>Tu empresa digital inteligente</div>
        </div>

        {/* Commander */}
        <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>J</div>
              <div><div style={{ fontWeight: 700 }}>Jorge</div><div style={{ fontSize: 12, color: '#999' }}>Fundador · Lv.{level}</div></div>
            </div>
            <span style={{ fontSize: 13, color: '#666' }}>{xp} / {xpNext} XP</span>
          </div>
          <div style={{ height: 4, background: '#eee', borderRadius: 2 }}>
            <div style={{ height: '100%', background: '#e74c3c', borderRadius: 2, width: xpPct + '%', transition: 'width 0.3s' }}></div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {[{ v: agents.length, l: 'Agentes' }, { v: businesses.length, l: 'Negocios' }, { v: pending.length, l: 'Alertas', red: true }].map((s, i) => (
            <div key={i} style={{ flex: 1, background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '12px 0', textAlign: 'center' as const }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.red && s.v > 0 ? '#e74c3c' : '#111' }}>{s.v}</div>
              <div style={{ fontSize: 11, color: '#999' }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Runtime toggle */}
        <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Modo autónomo</div>
            <div style={{ fontSize: 11, color: '#999' }}>Agentes trabajando solos</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: runtimeOn ? '#27ae60' : '#ddd' }}></div>
            <button onClick={toggleRuntime} style={{ padding: '6px 14px', background: runtimeOn ? '#fee' : '#111', color: runtimeOn ? '#e74c3c' : '#fff', border: 'none', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
              {runtimeOn ? 'Detener' : 'Iniciar'}
            </button>
          </div>
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          {[
            { icon: '🏙️', title: 'Ecosistema', desc: 'Mapa con edificios y agentes', action: () => setScreen('map') },
            { icon: '💬', title: 'Ship Comms', desc: 'Mensajes entre agentes en vivo', action: () => setScreen('comms'), badge: messages.length },
            { icon: '⚔️', title: 'Misiones', desc: 'Progreso y logros', action: () => setScreen('missions') },
            { icon: '🚨', title: 'Alertas', desc: 'Decisiones pendientes', action: () => setScreen('alerts'), badge: pending.length },
            { icon: '👥', title: 'Equipo', desc: 'Estado del ship crew', action: () => setScreen('crew') },
          ].map((item, i) => (
            <button key={i} onClick={item.action} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: '#fff', border: '1px solid #eee', borderRadius: 14, cursor: 'pointer', textAlign: 'left' as const, width: '100%' }}>
              <span style={{ fontSize: 20 }}>{item.icon}</span>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{item.title}</div><div style={{ fontSize: 11, color: '#999' }}>{item.desc}</div></div>
              {item.badge ? <span style={{ background: '#e74c3c', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>{item.badge}</span> : null}
              <span style={{ color: '#ccc' }}>›</span>
            </button>
          ))}
        </div>
        <div style={{ textAlign: 'center' as const, marginTop: 20, fontSize: 11, color: '#ddd' }}>{clock} · v0.4.0 · WS {wsConnected ? '●' : '○'}</div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // MAPA
  // ═══════════════════════════════════════
  if (screen === 'map') return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: '-apple-system, sans-serif' }}>
      <TopBar title="Ecosistema" />
      <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>

        {/* Ship Crew en vivo */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#27ae60' }}></div>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#27ae60', letterSpacing: 1 }}>SHIP CREW · {agents.length} online</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#bbb' }}>WS {wsConnected ? '● conectado' : '○ desconectado'}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
            {agents.map(a => {
              const lastRun = runs.filter(r => r.agent_id === a.id)[0];
              const b = BUILDINGS.find(b => b.role === a.role);
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8f8f8', borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }} onClick={() => { const building = BUILDINGS.find(bl => bl.role === a.role); if (building) enterBuilding(building); }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: b?.color || '#27ae60' }}></div>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</span>
                  <span style={{ fontSize: 10, color: '#999' }}>{lastRun?.action || 'En espera'}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live events */}
        {liveEvents.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 1, marginBottom: 8 }}>EVENTOS EN VIVO</div>
            {liveEvents.slice(0, 3).map((e, i) => (
              <div key={i} style={{ fontSize: 11, color: '#666', marginBottom: 3 }}>
                <span style={{ color: e.type?.includes('done') ? '#27ae60' : e.type?.includes('error') ? '#e74c3c' : '#3498db', fontWeight: 600 }}>{e.type}</span>
                {e.from && <span style={{ color: '#999' }}> · {e.from}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Edificios */}
        <div style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>Haz clic en un edificio para entrar</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
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
                {hasPending && <div style={{ position: 'absolute' as const, top: 10, right: 10, width: 9, height: 9, borderRadius: '50%', background: '#e74c3c' }}></div>}
                <div style={{ fontSize: 30, marginBottom: 8 }}>{b.icon}</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{b.name}</div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>{b.desc}</div>
                {ag && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#f8f9fa', borderRadius: 10 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: b.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{ag.name[0]}</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{ag.name}</div>
                      <div style={{ fontSize: 10, color: '#27ae60' }}>{lastRun?.action || 'Activo'}</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Nav rápido */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => setScreen('comms')} style={quickBtn}>💬 Ship Comms {messages.length > 0 ? `(${messages.length})` : ''}</button>
          <button onClick={() => setScreen('alerts')} style={{ ...quickBtn, color: pending.length > 0 ? '#e74c3c' : '#666', borderColor: pending.length > 0 ? '#ffd0d0' : '#eee' }}>🚨 Alertas {pending.length > 0 ? `(${pending.length})` : ''}</button>
          <button onClick={() => setScreen('crew')} style={quickBtn}>👥 Equipo</button>
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // EDIFICIO (chat IA real)
  // ═══════════════════════════════════════
  if (screen === 'building' && activeBuilding) {
    const building = activeBuilding;
    const buildingAgent = agents.find(a => a.role === building.role);
    const buildingPending = pending.filter(d => d.agent_id === buildingAgent?.id);

    return (
      <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: '-apple-system, sans-serif' }}>
        <TopBar title={building.name} />
        <div style={{ display: 'flex', gap: 20, padding: 24, maxWidth: 1000, margin: '0 auto' }}>

          {/* Chat */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 26 }}>{building.icon}</span>
              <div><div style={{ fontSize: 17, fontWeight: 700 }}>{building.name}</div><div style={{ fontSize: 12, color: '#888' }}>{building.desc}</div></div>
            </div>

            <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #eee', padding: 20, height: 420, overflowY: 'auto' as const, marginBottom: 12 }}>
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
                    {m.agentName && m.role === 'agent' && <div style={{ fontSize: 11, fontWeight: 600, color: building.color, marginBottom: 4 }}>{m.agentName}</div>}
                    {m.text}
                    <div style={{ fontSize: 10, color: m.role === 'user' ? '#888' : '#bbb', marginTop: 4 }}>{m.time}</div>
                  </div>
                </div>
              ))}
              {chatLoading && <div style={{ padding: '10px 14px', background: '#f8f9fa', borderRadius: 14, display: 'inline-block', color: '#888', fontSize: 13 }}>Pensando...</div>}
              <div ref={chatRef}></div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ flex: 1, padding: '11px 14px', border: '1px solid #ddd', borderRadius: 10, fontSize: 14, outline: 'none', background: '#fafafa' }}
                placeholder={`Habla con ${buildingAgent?.name || building.name}...`}
                value={chatIn} onChange={e => setChatIn(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
                disabled={chatLoading} />
              <button onClick={sendChat} disabled={chatLoading} style={{ padding: '11px 20px', background: '#111', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Enviar</button>
            </div>
          </div>

          {/* Panel lateral */}
          <div style={{ width: 270 }}>
            {/* Agente info */}
            {buildingAgent && (
              <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, marginBottom: 8 }}>AGENTE</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 12, background: building.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700 }}>{buildingAgent.name[0]}</div>
                  <div>
                    <div style={{ fontWeight: 700 }}>{buildingAgent.name}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{ROLES[buildingAgent.role]}</div>
                    <div style={{ fontSize: 11, color: '#27ae60', marginTop: 2 }}>● Activo</div>
                  </div>
                </div>
              </div>
            )}

            {/* Ejecutar agente manualmente */}
            {buildingAgent && (
              <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, marginBottom: 8 }}>ACCIONES</div>
                <button onClick={async () => {
                  await fetch(`${API}/agents/${buildingAgent.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'Ejecuta tu tarea principal ahora.' }) });
                  show(`${buildingAgent.name} ejecutando...`);
                  setTimeout(loadMessages, 3000);
                }} style={{ width: '100%', padding: '8px 0', background: building.color, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 6 }}>
                  Ejecutar ahora
                </button>
              </div>
            )}

            {/* Pendientes */}
            {buildingPending.length > 0 && (
              <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, marginBottom: 8 }}>PENDIENTES</div>
                {buildingPending.map(d => (
                  <div key={d.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid #f5f5f5' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{d.title}</div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button onClick={() => approve(d.id)} style={{ flex: 1, padding: '5px 0', background: '#27ae60', color: '#fff', border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Aprobar</button>
                      <button onClick={() => reject(d.id)} style={{ flex: 1, padding: '5px 0', background: '#fff', color: '#e74c3c', border: '1px solid #e74c3c', borderRadius: 7, fontSize: 11, cursor: 'pointer' }}>Rechazar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Otras estaciones */}
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, marginBottom: 8 }}>OTRAS ESTACIONES</div>
              {BUILDINGS.filter(b => b.id !== building.id).map(b => (
                <div key={b.id} onClick={() => enterBuilding(b)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', cursor: 'pointer', borderBottom: '1px solid #f5f5f5' }}>
                  <span style={{ fontSize: 14 }}>{b.icon}</span>
                  <span style={{ fontSize: 12, color: '#555' }}>{b.name}</span>
                  <div style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: b.color }}></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════
  // SHIP COMMS (mensajes en vivo)
  // ═══════════════════════════════════════
  if (screen === 'comms') return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: '-apple-system, sans-serif' }}>
      <TopBar title="Ship Comms" />
      <div style={{ display: 'flex', gap: 20, padding: 24, maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#27ae60' }}></div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#27ae60', letterSpacing: 1 }}>SHIP COMMS · {agents.length} online</span>
          </div>
          <div ref={commsRef} style={{ background: '#fff', borderRadius: 16, border: '1px solid #eee', padding: 20, height: 500, overflowY: 'auto' as const }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center' as const, color: '#ccc', paddingTop: 80 }}>Los agentes aun no han enviado mensajes. Espera a que el runtime se active.</div>
            ) : (
              [...messages].reverse().map(m => (
                <div key={m.id} style={{ marginBottom: 14, padding: 12, background: '#f8f9fa', borderRadius: 12 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: BUILDINGS.find(b => b.role === agents.find(a => a.id === m.sender_id)?.role)?.color || '#333' }}>{gn(m.sender_id)}</span>
                    <span style={{ color: '#ccc' }}>→</span>
                    <span style={{ fontSize: 13, color: '#888' }}>{m.receiver_id ? gn(m.receiver_id) : 'Todos'}</span>
                    <span style={{ fontSize: 11, color: '#bbb', marginLeft: 'auto' }}>{new Date(m.created_at).toLocaleTimeString('es-ES')}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#444', lineHeight: 1.5 }}>{m.content}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Eventos en vivo */}
        <div style={{ width: 260 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, marginBottom: 10 }}>EVENTOS EN VIVO</div>
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 14, height: 500, overflowY: 'auto' as const }}>
            {liveEvents.length === 0 ? (
              <div style={{ fontSize: 12, color: '#ccc', textAlign: 'center' as const, paddingTop: 40 }}>Sin eventos todavia.</div>
            ) : (
              liveEvents.map((e, i) => (
                <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: e.type?.includes('done') ? '#27ae60' : e.type?.includes('error') ? '#e74c3c' : '#3498db', marginBottom: 2 }}>{e.type}</div>
                  {e.from && <div style={{ fontSize: 10, color: '#999' }}>{e.from}</div>}
                </div>
              ))
            )}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#27ae60' }}></div>
          <span style={{ fontSize: 11, color: '#27ae60', fontWeight: 700, letterSpacing: 1 }}>STATION ONLINE · {agents.length} agentes</span>
        </div>
        {agents.map(a => {
          const lastRun = runs.filter(r => r.agent_id === a.id)[0];
          const b = BUILDINGS.find(bl => bl.role === a.role);
          return (
            <div key={a.id} onClick={() => b && enterBuilding(b)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, background: '#fff', borderRadius: 14, border: '1px solid #eee', marginBottom: 8, cursor: 'pointer' }}>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: b?.color || '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 }}>{a.name[0]}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{ROLES[a.role] || a.role}</div>
                {lastRun && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{lastRun.action} · {new Date(lastRun.started_at).toLocaleTimeString('es-ES')}</div>}
              </div>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#27ae60' }}></div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ═══════════════════════════════════════
  // MISIONES
  // ═══════════════════════════════════════
  if (screen === 'missions') return (
    <div style={{ minHeight: '100vh', background: '#f5f5f7', fontFamily: '-apple-system, sans-serif' }}>
      <TopBar title="Misiones" />
      <div style={{ padding: 24, maxWidth: 700, margin: '0 auto' }}>
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #eee', padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div><div style={{ fontSize: 11, color: '#aaa', letterSpacing: 1 }}>COMMANDER</div><div style={{ fontSize: 22, fontWeight: 800 }}>LV.{level} Jorge</div></div>
            <span style={{ fontSize: 13, color: '#666' }}>{xp} / {xpNext} XP</span>
          </div>
          <div style={{ height: 8, background: '#eee', borderRadius: 4 }}>
            <div style={{ height: '100%', background: '#e74c3c', borderRadius: 4, width: xpPct + '%', transition: 'width 0.3s' }}></div>
          </div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Logros</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {achievements.map(a => (
            <div key={a.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 14, opacity: a.unlocked_at ? 1 : 0.5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>{a.icon}</span>
                <div><div style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</div><div style={{ fontSize: 11, color: '#e74c3c', fontWeight: 600 }}>+{a.xp_reward} XP</div></div>
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
  // ALERTAS
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
                  {b && <span style={{ marginRight: 6 }}>{b.icon}</span>}
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

  return <div style={{ fontFamily: '-apple-system, sans-serif', padding: 40, color: '#999' }}>Cargando...</div>;
}

// ═══════════════════════════════════════
// ESTILOS COMPARTIDOS
// ═══════════════════════════════════════
const btnOutline: React.CSSProperties = {
  background: 'none', border: '1px solid #eee', borderRadius: 8,
  padding: '5px 12px', cursor: 'pointer', fontSize: 13, color: '#666'
};

const quickBtn: React.CSSProperties = {
  flex: 1, padding: '10px 0', background: '#fff', border: '1px solid #eee',
  borderRadius: 10, fontSize: 12, cursor: 'pointer', color: '#666', fontWeight: 500
};
