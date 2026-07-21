import { useState, useEffect, useRef } from 'react';

const API = '/api';

interface Agent { id: number; name: string; role: string; status: string; created_at: string; }
interface Business { id: number; name: string; channel: string; category: string | null; status: string; target_revenue: number; current_revenue: number; }
interface Decision { id: number; agent_id: number | null; title: string; amount: number | null; risk_level: string; status: string; approved_by: string | null; }
interface Msg { id: number; sender_id: number | null; receiver_id: number | null; content: string; channel: string; created_at: string; }

const ROLES: Record<string, string> = { ceo: 'Director General', investigador: 'Investigador', contenido: 'Creador de Contenido', trafico: 'Trafico', soporte: 'Soporte', finanzas: 'Finanzas', operaciones: 'Operaciones' };

type Screen = 'boot' | 'menu' | 'map' | 'hokage' | 'lab' | 'estudio' | 'tienda' | 'banco' | 'taller';

const BUILDINGS = [
  { id: 'hokage', name: 'Torre Hokage', desc: 'Centro de mando', icon: '🏯', color: '#e74c3c', agent: 'ceo' },
  { id: 'lab', name: 'Laboratorio', desc: 'Investigacion de mercado', icon: '🔬', color: '#3498db', agent: 'investigador' },
  { id: 'estudio', name: 'Estudio', desc: 'Creacion de contenido', icon: '✏️', color: '#9b59b6', agent: 'contenido' },
  { id: 'tienda', name: 'Tienda', desc: 'Ventas y productos', icon: '🏪', color: '#27ae60', agent: 'trafico' },
  { id: 'banco', name: 'Banco', desc: 'Finanzas y reportes', icon: '🏦', color: '#f39c12', agent: 'finanzas' },
  { id: 'taller', name: 'Taller', desc: 'Operaciones del sistema', icon: '⚙️', color: '#1abc9c', agent: 'operaciones' },
];

function App() {
  const [screen, setScreen] = useState<Screen>('boot');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [bootLines, setBootLines] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const [clock, setClock] = useState('');
  const [chatIn, setChatIn] = useState('');
  const [bN, setBN] = useState('');
  const [bCh, setBCh] = useState('etsy');
  const [bCat, setBCat] = useState('');
  const [bRev, setBRev] = useState('1000');
  const chatRef = useRef<HTMLDivElement>(null);

  const notifs = decisions.filter(d => d.status === 'proposed' || d.status === 'pending').length;
  const show = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000); };
  const gn = (id: number | null) => { if (!id) return 'Sistema'; const a = agents.find(x => x.id === id); return a ? a.name : '#' + id; };
  const getAgent = (role: string) => agents.find(a => a.role === role);

  // Boot sequence
  useEffect(() => {
    const ls = ['HOKAGE OS v0.4.0', '', 'Inicializando sistema...', 'Conectando base de datos... OK', 'Cargando agentes... OK', 'Verificando APIs... OK', 'Sincronizando datos... OK', 'Preparando ecosistema... OK', '', 'Bienvenido, Jorge.', 'Tu equipo esta listo.'];
    let i = 0;
    const t = setInterval(() => {
      if (i < ls.length) { setBootLines(p => [...p, ls[i]]); i++; }
      else { clearInterval(t); setTimeout(() => setScreen('menu'), 1000); }
    }, 200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('es-ES', { hour12: false })), 1000);
    const r = setInterval(load, 8000);
    return () => { clearInterval(t); clearInterval(r); };
  }, []);

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages]);

  async function load() {
    try {
      const [a, b, d, m] = await Promise.all([
        fetch(API + '/agents').then(r => r.json()),
        fetch(API + '/businesses').then(r => r.json()),
        fetch(API + '/decisions').then(r => r.json()),
        fetch(API + '/messages').then(r => r.json()),
      ]);
      if (a.ok) setAgents(a.data);
      if (b.ok) setBusinesses(b.data);
      if (d.ok) setDecisions(d.data);
      if (m.ok) setMessages(m.data);
    } catch {}
  }

  async function sendChat() {
    if (!chatIn.trim()) return;
    const hId = agents.find(a => a.role === 'ceo')?.id || 1;
    await fetch(API + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender_id: hId, receiver_id: null, content: chatIn.trim() }) });
    setChatIn(''); load();
  }

  // ════════════════════════════════════════
  // BOOT SCREEN
  // ════════════════════════════════════════
  if (screen === 'boot') return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Courier New', monospace" }}>
      <div style={{ maxWidth: 460, width: '100%', padding: 40 }}>
        <div style={{ fontSize: 28, color: '#fff', fontWeight: 800, letterSpacing: 6, marginBottom: 40, textAlign: 'center' as const }}>
          <span style={{ color: '#e74c3c' }}>HOKAGE</span> <span style={{ color: '#555' }}>OS</span>
        </div>
        {bootLines.map((l, i) => (
          <div key={i} style={{ fontSize: 13, color: !l || l === '' ? 'transparent' : l.includes('OK') ? '#27ae60' : l.includes('Bienvenido') || l.includes('listo') ? '#3498db' : '#555', marginBottom: 5, letterSpacing: 0.5 }}>
            {l && l.includes('OK') ? <>{l.replace(' OK', '')} <span style={{ color: '#27ae60', fontWeight: 600 }}>OK</span></> : l || '\u00A0'}
          </div>
        ))}
        <div style={{ marginTop: 24, height: 3, background: '#1a1a2e', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: '#e74c3c', borderRadius: 2, width: (bootLines.length / 11 * 100) + '%', transition: 'width 0.3s ease' }}></div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════
  // MAIN MENU
  // ════════════════════════════════════════
  if (screen === 'menu') return (
    <div style={{ minHeight: '100vh', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system, sans-serif' }}>
      <div style={{ maxWidth: 480, width: '100%', padding: 40 }}>
        <div style={{ textAlign: 'center' as const, marginBottom: 40 }}>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1 }}>
            <span style={{ color: '#e74c3c' }}>Hokage</span> <span style={{ color: '#333' }}>OS</span>
          </div>
          <div style={{ color: '#999', fontSize: 13, marginTop: 6 }}>Tu empresa digital inteligente</div>
        </div>

        {/* Quick stats */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
          <div style={menuStat}><div style={{ fontSize: 24, fontWeight: 700 }}>{agents.length}</div><div style={{ fontSize: 11, color: '#999' }}>Agentes</div></div>
          <div style={menuStat}><div style={{ fontSize: 24, fontWeight: 700 }}>{businesses.length}</div><div style={{ fontSize: 11, color: '#999' }}>Negocios</div></div>
          <div style={menuStat}><div style={{ fontSize: 24, fontWeight: 700, color: notifs > 0 ? '#e74c3c' : '#27ae60' }}>{notifs}</div><div style={{ fontSize: 11, color: '#999' }}>Pendientes</div></div>
        </div>

        {/* Menu options */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
          <button style={menuBtn} onClick={() => setScreen('map')}>
            <span style={{ fontSize: 20 }}>🏙️</span>
            <div style={{ flex: 1, textAlign: 'left' as const }}><div style={{ fontWeight: 600 }}>Entrar al ecosistema</div><div style={{ fontSize: 12, color: '#999' }}>Ver el mapa y tus agentes trabajando</div></div>
            <span style={{ color: '#ccc' }}>{'\u203A'}</span>
          </button>
          <button style={menuBtn} onClick={() => setScreen('hokage')}>
            <span style={{ fontSize: 20 }}>🏯</span>
            <div style={{ flex: 1, textAlign: 'left' as const }}><div style={{ fontWeight: 600 }}>Hablar con Hokage</div><div style={{ fontSize: 12, color: '#999' }}>Resumen del dia y decisiones pendientes</div></div>
            {notifs > 0 && <span style={{ background: '#e74c3c', color: '#fff', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>{notifs}</span>}
            <span style={{ color: '#ccc' }}>{'\u203A'}</span>
          </button>
          <button style={menuBtn} onClick={() => setScreen('tienda')}>
            <span style={{ fontSize: 20 }}>📊</span>
            <div style={{ flex: 1, textAlign: 'left' as const }}><div style={{ fontWeight: 600 }}>Mis negocios</div><div style={{ fontSize: 12, color: '#999' }}>Gestion rapida de negocios y productos</div></div>
            <span style={{ color: '#ccc' }}>{'\u203A'}</span>
          </button>
        </div>

        <div style={{ textAlign: 'center' as const, marginTop: 32, fontSize: 12, color: '#ccc' }}>v0.4.0 · {clock}</div>
      </div>
    </div>
  );

  // ════════════════════════════════════════
  // TOP BAR (shared by map and building views)
  // ════════════════════════════════════════
  const topBar = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', background: '#fff', borderBottom: '1px solid #eee' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {screen !== 'map' && <button style={{ background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }} onClick={() => setScreen('map')}>{'\u2190'} Mapa</button>}
        <span style={{ fontWeight: 700, fontSize: 16 }}><span style={{ color: '#e74c3c' }}>Hokage</span> OS</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 12, color: '#999' }}>Agentes: {agents.length}</span>
        <span style={{ fontSize: 12, color: '#999' }}>Negocios: {businesses.length}</span>
        {notifs > 0 && <span style={{ background: '#e74c3c', color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12 }}>{notifs} pendientes</span>}
        <span style={{ fontSize: 13, color: '#bbb', fontFamily: 'monospace' }}>{clock}</span>
        <button style={{ background: 'none', border: '1px solid #ddd', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }} onClick={() => setScreen('menu')}>Menu</button>
      </div>
    </div>
  );

  // ════════════════════════════════════════
  // MAP VIEW
  // ════════════════════════════════════════
  if (screen === 'map') return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: '-apple-system, sans-serif' }}>
      {topBar}
      <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>Ecosistema</h2>
          <p style={{ color: '#888', fontSize: 13, margin: 0 }}>Haz clic en un edificio para entrar</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {BUILDINGS.map(b => {
            const ag = getAgent(b.agent);
            return (
              <div key={b.id} onClick={() => setScreen(b.id as Screen)} style={{ background: '#fff', borderRadius: 16, padding: 24, cursor: 'pointer', border: '2px solid transparent', transition: 'all 0.2s', position: 'relative' as const, overflow: 'hidden' }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = b.color; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLDivElement).style.transform = 'none'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
              >
                <div style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 4, background: b.color }}></div>
                <div style={{ fontSize: 36, marginBottom: 12 }}>{b.icon}</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{b.name}</div>
                <div style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>{b.desc}</div>
                {ag && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8f9fa', borderRadius: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: b.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{ag.name[0]}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{ag.name}</div>
                      <div style={{ fontSize: 11, color: '#27ae60' }}>Activo</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════
  // TORRE HOKAGE (Chat + Decisions)
  // ════════════════════════════════════════
  if (screen === 'hokage') return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: '-apple-system, sans-serif' }}>
      {topBar}
      <div style={{ display: 'flex', gap: 20, padding: 24, maxWidth: 1000, margin: '0 auto' }}>
        {/* Chat */}
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>🏯 Torre Hokage</h2>
          <div ref={chatRef} style={{ background: '#fff', borderRadius: 16, border: '1px solid #eee', padding: 20, minHeight: 360, maxHeight: 420, overflowY: 'auto' as const }}>
            {/* Welcome message */}
            <div style={{ padding: 14, background: '#f8f9fa', borderRadius: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Hokage</div>
              <div style={{ fontSize: 14, color: '#444', lineHeight: 1.6 }}>
                Buenos dias, Jorge. {notifs > 0 ? 'Tienes ' + notifs + ' propuestas pendientes de aprobacion.' : 'No hay nada pendiente.'} {businesses.length > 0 ? 'Tus negocios estan en marcha.' : 'Todavia no tienes negocios. Te recomiendo crear uno.'} {agents.length} agentes estan trabajando.
              </div>
            </div>
            {messages.map(m => (
              <div key={m.id} style={{ padding: 12, borderBottom: '1px solid #f5f5f5' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{gn(m.sender_id)}</span>
                  <span style={{ fontSize: 11, color: '#bbb', marginLeft: 'auto' }}>{new Date(m.created_at).toLocaleTimeString('es-ES')}</span>
                </div>
                <div style={{ fontSize: 14, color: '#444' }}>{m.content}</div>
              </div>
            ))}
            {messages.length === 0 && <div style={{ color: '#ccc', textAlign: 'center' as const, padding: 40 }}>Escribe algo para empezar.</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input style={inputStyle} placeholder="Habla con Hokage..." value={chatIn} onChange={e => setChatIn(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sendChat(); }} />
            <button style={btnPrimary} onClick={sendChat}>Enviar</button>
          </div>
        </div>

        {/* Decisions */}
        <div style={{ width: 320 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Decisiones pendientes</h3>
          {decisions.filter(d => d.status === 'proposed' || d.status === 'pending').length === 0 ? (
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, textAlign: 'center' as const, color: '#bbb', border: '1px solid #eee' }}>Todo aprobado. Sin pendientes.</div>
          ) : (
            decisions.filter(d => d.status === 'proposed' || d.status === 'pending').map(d => (
              <div key={d.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 14, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.risk_level === 'low' ? '#27ae60' : d.risk_level === 'medium' ? '#f39c12' : '#e74c3c' }}></span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{d.title}</span>
                </div>
                {d.amount && <div style={{ fontSize: 13, color: '#888' }}>Importe: ${d.amount}</div>}
                <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>De: {gn(d.agent_id)}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={{ ...btnPrimary, background: '#27ae60', flex: 1, padding: '7px 0' }} onClick={async () => { await fetch(API + '/decisions/' + d.id + '/approve', { method: 'PUT' }); load(); show('Aprobada'); }}>Aprobar</button>
                  <button style={{ padding: '7px 14px', background: '#fff', color: '#e74c3c', border: '1px solid #e74c3c', borderRadius: 8, fontSize: 13, cursor: 'pointer' }} onClick={async () => { await fetch(API + '/decisions/' + d.id + '/reject', { method: 'PUT' }); load(); show('Rechazada'); }}>No</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════
  // LABORATORIO (Investigacion)
  // ════════════════════════════════════════
  if (screen === 'lab') return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: '-apple-system, sans-serif' }}>
      {topBar}
      <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>🔬 Laboratorio</h2>
        <p style={{ color: '#888', fontSize: 13, margin: '0 0 20px' }}>El Explorador investiga tendencias y oportunidades.</p>
        <div style={buildingCard}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Estado del Explorador</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ color: '#27ae60' }}>{'\u25CF'}</span><span>Activo - Monitoreando tendencias</span></div>
          <div style={{ marginTop: 16, padding: 14, background: '#f8f9fa', borderRadius: 10 }}>
            <div style={{ fontSize: 13, color: '#666' }}>Las tendencias y oportunidades apareceran aqui cuando el Explorador las detecte. Conecta una API de tendencias para activarlo.</div>
          </div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════
  // ESTUDIO (Contenido)
  // ════════════════════════════════════════
  if (screen === 'estudio') return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: '-apple-system, sans-serif' }}>
      {topBar}
      <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>{'\u270F\uFE0F'} Estudio</h2>
        <p style={{ color: '#888', fontSize: 13, margin: '0 0 20px' }}>El Escritor crea contenido para tus negocios.</p>
        <div style={buildingCard}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Contenido generado</div>
          <div style={{ color: '#aaa', textAlign: 'center' as const, padding: 30 }}>Sin contenido todavia. El Escritor generara descripciones y textos cuando tengas productos.</div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════
  // TIENDA (Negocios + Productos)
  // ════════════════════════════════════════
  if (screen === 'tienda') return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: '-apple-system, sans-serif' }}>
      {topBar}
      <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>{'\uD83C\uDFEA'} Tienda</h2>
        <p style={{ color: '#888', fontSize: 13, margin: '0 0 20px' }}>Gestion de negocios y productos.</p>

        {businesses.map(b => (
          <div key={b.id} style={buildingCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{b.name}</div>
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, background: '#e8f5e9', color: '#27ae60' }}>{b.status}</span>
            </div>
            <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>{b.channel} {b.category ? '| ' + b.category : ''}</div>
            <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
              <div><div style={{ fontSize: 11, color: '#aaa' }}>Meta</div><div style={{ fontSize: 18, fontWeight: 700 }}>${b.target_revenue}/mes</div></div>
              <div><div style={{ fontSize: 11, color: '#aaa' }}>Actual</div><div style={{ fontSize: 18, fontWeight: 700, color: '#27ae60' }}>${b.current_revenue}</div></div>
            </div>
            {b.target_revenue > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ height: 6, background: '#eee', borderRadius: 3 }}>
                  <div style={{ height: '100%', background: '#27ae60', borderRadius: 3, width: Math.min(100, (b.current_revenue / b.target_revenue) * 100) + '%', transition: 'width 0.3s' }}></div>
                </div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{Math.round((b.current_revenue / b.target_revenue) * 100)}% de la meta</div>
              </div>
            )}
          </div>
        ))}
        {businesses.length === 0 && <div style={{ ...buildingCard, textAlign: 'center' as const, color: '#bbb' }}>Sin negocios todavia.</div>}

        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '24px 0 12px' }}>Crear negocio</h3>
        <div style={buildingCard}>
          <input style={inputStyle} placeholder="Nombre del negocio" value={bN} onChange={e => setBN(e.target.value)} />
          <select style={inputStyle} value={bCh} onChange={e => setBCh(e.target.value)}>
            <option value="etsy">Etsy</option><option value="shopify">Shopify</option><option value="amazon">Amazon</option><option value="propia">Web propia</option>
          </select>
          <input style={inputStyle} placeholder="Categoria (ej: diseno, ropa)" value={bCat} onChange={e => setBCat(e.target.value)} />
          <input style={inputStyle} placeholder="Meta mensual ($)" value={bRev} onChange={e => setBRev(e.target.value)} />
          <button style={btnPrimary} onClick={async () => {
            if (!bN.trim()) return;
            await fetch(API + '/businesses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: bN.trim(), channel: bCh, category: bCat.trim() || null, target_revenue: Number(bRev) }) });
            setBN(''); setBCat(''); load(); show('Negocio creado');
          }}>Crear negocio</button>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════
  // BANCO (Finanzas)
  // ════════════════════════════════════════
  if (screen === 'banco') return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: '-apple-system, sans-serif' }}>
      {topBar}
      <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>{'\uD83C\uDFE6'} Banco</h2>
        <p style={{ color: '#888', fontSize: 13, margin: '0 0 20px' }}>Finanzas y reportes economicos.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          <div style={buildingCard}><div style={{ fontSize: 11, color: '#aaa' }}>Ingresos totales</div><div style={{ fontSize: 24, fontWeight: 700, color: '#27ae60' }}>$0.00</div></div>
          <div style={buildingCard}><div style={{ fontSize: 11, color: '#aaa' }}>Gastos totales</div><div style={{ fontSize: 24, fontWeight: 700, color: '#e74c3c' }}>$0.00</div></div>
          <div style={buildingCard}><div style={{ fontSize: 11, color: '#aaa' }}>Beneficio</div><div style={{ fontSize: 24, fontWeight: 700 }}>$0.00</div></div>
        </div>
        <div style={buildingCard}>
          <div style={{ color: '#aaa', textAlign: 'center' as const, padding: 30 }}>Los reportes financieros apareceran cuando conectes plataformas de pago.</div>
        </div>
      </div>
    </div>
  );

  // ════════════════════════════════════════
  // TALLER (Operaciones)
  // ════════════════════════════════════════
  if (screen === 'taller') return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: '-apple-system, sans-serif' }}>
      {topBar}
      <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>{'\u2699\uFE0F'} Taller</h2>
        <p style={{ color: '#888', fontSize: 13, margin: '0 0 20px' }}>Estado del sistema y operaciones.</p>
        <div style={buildingCard}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Estado del sistema</div>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}><span>Backend</span><span style={{ color: '#27ae60', fontWeight: 600 }}>{'\u25CF'} Conectado</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}><span>Base de datos</span><span style={{ color: '#27ae60', fontWeight: 600 }}>{'\u25CF'} SQLite activo</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}><span>Agentes</span><span style={{ color: '#27ae60', fontWeight: 600 }}>{agents.length} activos</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}><span>APIs externas</span><span style={{ color: '#f39c12', fontWeight: 600 }}>{'\u25CF'} Sin conectar</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}><span>Version</span><span style={{ fontWeight: 600 }}>v0.4.0</span></div>
          </div>
        </div>
      </div>
    </div>
  );

  return <div>Cargando...</div>;
}

// ════════════════════════════════════════
// SHARED STYLES
// ════════════════════════════════════════

const menuStat: React.CSSProperties = { flex: 1, background: '#fff', borderRadius: 16, padding: '16px 20px', textAlign: 'center', border: '1px solid #eee' };
const menuBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', background: '#fff', border: '1px solid #eee', borderRadius: 14, cursor: 'pointer', fontSize: 14, textAlign: 'left', width: '100%', transition: 'all 0.15s' };
const buildingCard: React.CSSProperties = { background: '#fff', borderRadius: 14, border: '1px solid #eee', padding: 20, marginBottom: 12 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '11px 14px', border: '1px solid #ddd', borderRadius: 10, fontSize: 14, outline: 'none', marginBottom: 10, boxSizing: 'border-box', background: '#fafafa' };
const btnPrimary: React.CSSProperties = { padding: '11px 24px', background: '#111', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%' };

export default App;
