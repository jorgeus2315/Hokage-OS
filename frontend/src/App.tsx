import { useState, useEffect } from 'react';

const API = '/api';

interface Agent { id: number; name: string; role: string; status: string; created_at: string; }
interface Business { id: number; name: string; channel: string; category: string | null; status: string; target_revenue: number; current_revenue: number; created_at: string; }
interface Decision { id: number; agent_id: number | null; title: string; amount: number | null; risk_level: string; status: string; approved_by: string | null; created_at: string; }
interface Msg { id: number; sender_id: number | null; receiver_id: number | null; content: string; channel: string; created_at: string; }

const ROLES: Record<string, string> = { ceo: 'Director General', investigador: 'Investigador de Mercado', contenido: 'Creador de Contenido', trafico: 'Gestor de Trafico', soporte: 'Atencion al Cliente', finanzas: 'Director Financiero', operaciones: 'Director de Operaciones' };

function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [view, setView] = useState('inicio');
  const [sel, setSel] = useState<Agent | null>(null);
  const [toast, setToast] = useState('');
  const [clock, setClock] = useState('');

  const [taskIn, setTaskIn] = useState('');
  const [msgIn, setMsgIn] = useState('');
  const [commIn, setCommIn] = useState('');
  const [commCh, setCommCh] = useState(0);

  const [bN, setBN] = useState('');
  const [bCh, setBCh] = useState('etsy');
  const [bCat, setBCat] = useState('');
  const [bRev, setBRev] = useState('1000');

  const notifs = decisions.filter(d => d.status === 'proposed' || d.status === 'pending').length;

  const show = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    load();
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('es-ES', { hour12: false })), 1000);
    const r = setInterval(load, 8000);
    return () => { clearInterval(t); clearInterval(r); };
  }, []);

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

  function gn(id: number | null) { if (!id) return 'Sistema'; const a = agents.find(x => x.id === id); return a ? a.name : '#' + id; }

  async function sendMsg() {
    if (!commIn.trim()) return;
    const hId = agents.find(a => a.role === 'ceo')?.id || 1;
    await fetch(API + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender_id: hId, receiver_id: commCh > 0 ? commCh : null, content: commIn.trim() }) });
    setCommIn(''); load(); show('Mensaje enviado');
  }

  const nav = [
    { id: 'inicio', label: 'Inicio', icon: '\u25C8' },
    { id: 'equipo', label: 'Equipo', icon: '\u25C6' },
    { id: 'negocios', label: 'Negocios', icon: '\u25A0' },
    { id: 'misiones', label: 'Misiones', icon: '\u25B6' },
    { id: 'comms', label: 'Mensajes', icon: '\u25CE' },
    { id: 'ajustes', label: 'Ajustes', icon: '\u2699' },
  ];

  return (
    <div style={S.app}>
      {/* SIDEBAR */}
      <div style={S.sidebar}>
        <div style={S.logoArea}>
          <div style={S.logoIcon}>H</div>
          <div>
            <div style={S.logoText}>Hokage OS</div>
            <div style={S.logoSub}>v0.4.0</div>
          </div>
        </div>
        <div style={S.navList}>
          {nav.map(n => (
            <div key={n.id} onClick={() => { setView(n.id); setSel(null); }} style={view === n.id ? { ...S.navItem, ...S.navActive } : S.navItem}>
              <span style={S.navIcon}>{n.icon}</span>
              <span>{n.label}</span>
              {n.id === 'misiones' && notifs > 0 && <span style={S.navBadge}>{notifs}</span>}
            </div>
          ))}
        </div>
        <div style={S.sidebarBottom}>
          <div style={S.userArea}>
            <div style={S.userAvatar}>J</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Jorge</div>
              <div style={{ fontSize: 11, color: '#999' }}>Fundador</div>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div style={S.mainArea}>
        {/* TOP BAR */}
        <div style={S.topBar}>
          <div style={S.topTitle}>{nav.find(n => n.id === view)?.label || 'Inicio'}</div>
          <div style={S.topRight}>
            <div style={S.metricPill}><span style={S.metricLabel}>Agentes</span><span style={S.metricVal}>{agents.length}</span></div>
            <div style={S.metricPill}><span style={S.metricLabel}>Negocios</span><span style={S.metricVal}>{businesses.length}</span></div>
            <div style={S.metricPill}><span style={S.metricLabel}>Pendientes</span><span style={{ ...S.metricVal, color: notifs > 0 ? '#e74c3c' : '#27ae60' }}>{notifs}</span></div>
            <div style={{ fontSize: 13, color: '#999', fontFamily: 'monospace' }}>{clock}</div>
          </div>
        </div>

        {/* CONTENT */}
        <div style={S.content}>

          {/* === INICIO === */}
          {view === 'inicio' && (
            <div>
              <div style={S.welcomeCard}>
                <div style={S.welcomeAvatar}>H</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Buenos dias, Jorge</div>
                  <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5 }}>
                    Tienes {notifs} propuestas pendientes. {businesses.length > 0 ? businesses.length + ' negocio(s) activo(s).' : 'Crea tu primer negocio para empezar.'} {agents.length} agentes listos.
                  </div>
                </div>
              </div>

              <div style={S.sectionHead}>Equipo</div>
              <div style={S.agentGrid}>
                {agents.map(a => (
                  <div key={a.id} style={S.agentCard} onClick={() => setSel(a)}>
                    <div style={S.agentCardTop}>
                      <div style={S.agentAvatar}>{a.name[0]}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
                        <div style={{ fontSize: 12, color: '#888' }}>{ROLES[a.role] || a.role}</div>
                      </div>
                      <div style={a.status === 'idle' ? S.statusOk : S.statusBusy}>{a.status === 'idle' ? 'Activo' : a.status}</div>
                    </div>
                    <div style={S.progressArea}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#aaa', marginBottom: 3 }}><span>Rendimiento</span><span>85%</span></div>
                      <div style={S.progressBg}><div style={S.progressFill}></div></div>
                    </div>
                    <div style={S.agentStats}>
                      <div style={S.miniStat}><div style={{ fontSize: 16, fontWeight: 600, color: '#333' }}>0</div><div style={{ fontSize: 10, color: '#aaa' }}>Tareas</div></div>
                      <div style={S.miniStat}><div style={{ fontSize: 16, fontWeight: 600, color: '#27ae60' }}>Lv.1</div><div style={{ fontSize: 10, color: '#aaa' }}>Nivel</div></div>
                    </div>
                  </div>
                ))}
              </div>

              {decisions.filter(d => d.status === 'proposed' || d.status === 'pending').length > 0 && (
                <div>
                  <div style={S.sectionHead}>Propuestas pendientes</div>
                  {decisions.filter(d => d.status === 'proposed' || d.status === 'pending').map(d => (
                    <div key={d.id} style={S.decisionCard}>
                      <div style={S.decisionTop}>
                        <span style={{ ...S.riskDot, background: d.risk_level === 'low' ? '#27ae60' : d.risk_level === 'medium' ? '#f39c12' : '#e74c3c' }}></span>
                        <span style={{ fontWeight: 600, flex: 1 }}>{d.title}</span>
                        <span style={{ fontSize: 12, color: '#999' }}>{gn(d.agent_id)}</span>
                      </div>
                      {d.amount && <div style={{ fontSize: 13, color: '#666', margin: '6px 0' }}>Importe: ${d.amount}</div>}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button style={S.btnApprove} onClick={async () => { await fetch(API + '/decisions/' + d.id + '/approve', { method: 'PUT' }); load(); show('Aprobada'); }}>Aprobar</button>
                        <button style={S.btnReject} onClick={async () => { await fetch(API + '/decisions/' + d.id + '/reject', { method: 'PUT' }); load(); show('Rechazada'); }}>Rechazar</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {businesses.length > 0 && (
                <div>
                  <div style={S.sectionHead}>Negocios</div>
                  {businesses.map(b => (
                    <div key={b.id} style={S.bizCard}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{b.name}</div>
                        <span style={S.bizStatus}>{b.status}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>{b.channel} {b.category ? '| ' + b.category : ''}</div>
                      <div style={{ display: 'flex', gap: 24, marginTop: 10 }}>
                        <div><div style={{ fontSize: 11, color: '#aaa' }}>Meta</div><div style={{ fontSize: 16, fontWeight: 600 }}>${b.target_revenue}/mes</div></div>
                        <div><div style={{ fontSize: 11, color: '#aaa' }}>Actual</div><div style={{ fontSize: 16, fontWeight: 600, color: '#27ae60' }}>${b.current_revenue}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {messages.length > 0 && (
                <div>
                  <div style={S.sectionHead}>Mensajes recientes</div>
                  {messages.slice(0, 5).map(m => (
                    <div key={m.id} style={S.msgRow}>
                      <span style={{ fontWeight: 600, color: '#333', minWidth: 90 }}>{gn(m.sender_id)}</span>
                      <span style={{ color: '#ccc' }}>{'\u2192'}</span>
                      <span style={{ color: '#666', minWidth: 70 }}>{gn(m.receiver_id) || 'Todos'}</span>
                      <span style={{ color: '#555', flex: 1 }}>{m.content}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* === EQUIPO === */}
          {view === 'equipo' && (
            <div>
              <div style={S.sectionHead}>Todos los agentes</div>
              {agents.map(a => (
                <div key={a.id} style={S.crewRow} onClick={() => setSel(a)}>
                  <div style={S.agentAvatar}>{a.name[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{ROLES[a.role] || a.role}</div>
                  </div>
                  <div style={{ fontSize: 12, color: '#aaa' }}>Lv.1</div>
                  <div style={a.status === 'idle' ? S.statusOk : S.statusBusy}>{a.status === 'idle' ? 'Activo' : a.status}</div>
                </div>
              ))}
            </div>
          )}

          {/* === NEGOCIOS === */}
          {view === 'negocios' && (
            <div>
              <div style={S.sectionHead}>Mis negocios</div>
              {businesses.map(b => (
                <div key={b.id} style={S.bizCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{b.name}</div>
                    <span style={S.bizStatus}>{b.status}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>{b.channel} {b.category ? '| ' + b.category : ''}</div>
                  <div style={{ display: 'flex', gap: 24, marginTop: 10 }}>
                    <div><div style={{ fontSize: 11, color: '#aaa' }}>Meta</div><div style={{ fontSize: 16, fontWeight: 600 }}>${b.target_revenue}/mes</div></div>
                    <div><div style={{ fontSize: 11, color: '#aaa' }}>Actual</div><div style={{ fontSize: 16, fontWeight: 600, color: '#27ae60' }}>${b.current_revenue}</div></div>
                  </div>
                </div>
              ))}
              {businesses.length === 0 && <div style={S.emptyState}>No hay negocios todavia.</div>}

              <div style={S.sectionHead}>Crear negocio</div>
              <div style={S.formCard}>
                <input style={S.input} placeholder="Nombre del negocio" value={bN} onChange={e => setBN(e.target.value)} />
                <select style={S.input} value={bCh} onChange={e => setBCh(e.target.value)}>
                  <option value="etsy">Etsy</option>
                  <option value="shopify">Shopify</option>
                  <option value="amazon">Amazon</option>
                  <option value="propia">Web propia</option>
                </select>
                <input style={S.input} placeholder="Categoria (ej: diseno, ropa)" value={bCat} onChange={e => setBCat(e.target.value)} />
                <input style={S.input} placeholder="Meta mensual ($)" value={bRev} onChange={e => setBRev(e.target.value)} />
                <button style={S.btnPrimary} onClick={async () => {
                  if (!bN.trim()) return;
                  await fetch(API + '/businesses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: bN.trim(), channel: bCh, category: bCat.trim() || null, target_revenue: Number(bRev) }) });
                  setBN(''); setBCat(''); load(); show('Negocio creado');
                }}>Crear negocio</button>
              </div>
            </div>
          )}

          {/* === MISIONES === */}
          {view === 'misiones' && (
            <div>
              <div style={S.sectionHead}>Misiones y decisiones</div>
              {decisions.length === 0 ? <div style={S.emptyState}>No hay misiones todavia. Los agentes las crearan.</div> :
                decisions.map(d => (
                  <div key={d.id} style={S.decisionCard}>
                    <div style={S.decisionTop}>
                      <span style={{ ...S.riskDot, background: d.risk_level === 'low' ? '#27ae60' : d.risk_level === 'medium' ? '#f39c12' : '#e74c3c' }}></span>
                      <span style={{ fontWeight: 600, flex: 1 }}>{d.title}</span>
                      <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 12, background: d.status === 'proposed' || d.status === 'pending' ? '#fff3e0' : d.status === 'approved' ? '#e8f5e9' : '#fce4ec', color: d.status === 'proposed' || d.status === 'pending' ? '#f39c12' : d.status === 'approved' ? '#27ae60' : '#e74c3c' }}>
                        {d.status === 'proposed' || d.status === 'pending' ? 'Pendiente' : d.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                      </span>
                    </div>
                    {d.amount && <div style={{ fontSize: 13, color: '#666', margin: '6px 0' }}>Importe: ${d.amount}</div>}
                    <div style={{ fontSize: 12, color: '#999' }}>Agente: {gn(d.agent_id)}</div>
                    {(d.status === 'proposed' || d.status === 'pending') && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button style={S.btnApprove} onClick={async () => { await fetch(API + '/decisions/' + d.id + '/approve', { method: 'PUT' }); load(); show('Aprobada'); }}>Aprobar</button>
                        <button style={S.btnReject} onClick={async () => { await fetch(API + '/decisions/' + d.id + '/reject', { method: 'PUT' }); load(); show('Rechazada'); }}>Rechazar</button>
                      </div>
                    )}
                  </div>
                ))
              }
            </div>
          )}

          {/* === COMMS === */}
          {view === 'comms' && (
            <div>
              <div style={S.sectionHead}>Comunicaciones</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' as const }}>
                <button style={commCh === 0 ? S.chActive : S.chBtn} onClick={() => setCommCh(0)}>General</button>
                {agents.map(a => <button key={a.id} style={commCh === a.id ? S.chActive : S.chBtn} onClick={() => setCommCh(a.id)}>{a.name}</button>)}
              </div>
              <div style={S.chatArea}>
                {messages.length === 0 ? <div style={S.emptyState}>Sin mensajes.</div> :
                  messages.filter(m => commCh === 0 || m.sender_id === commCh || m.receiver_id === commCh).map(m => (
                    <div key={m.id} style={S.chatBubble}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{gn(m.sender_id)}</span>
                        <span style={{ color: '#ccc' }}>{'\u2192'}</span>
                        <span style={{ fontSize: 13, color: '#888' }}>{gn(m.receiver_id) || 'Todos'}</span>
                        <span style={{ fontSize: 11, color: '#bbb', marginLeft: 'auto' }}>{new Date(m.created_at).toLocaleTimeString('es-ES')}</span>
                      </div>
                      <div style={{ fontSize: 14, color: '#333' }}>{m.content}</div>
                    </div>
                  ))
                }
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input style={{ ...S.input, flex: 1, marginBottom: 0 }} placeholder="Escribe un mensaje..." value={commIn} onChange={e => setCommIn(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sendMsg(); }} />
                <button style={S.btnPrimary} onClick={sendMsg}>Enviar</button>
              </div>
            </div>
          )}

          {/* === AJUSTES === */}
          {view === 'ajustes' && (
            <div>
              <div style={S.sectionHead}>Ajustes</div>
              <div style={S.settingsCard}>
                <div style={S.settingsTitle}>Perfil</div>
                <div style={S.settingsRow}>Nombre: Jorge</div>
                <div style={S.settingsRow}>Idioma: Espanol</div>
                <div style={S.settingsRow}>Zona horaria: Europa/Madrid</div>
              </div>
              <div style={S.settingsCard}>
                <div style={S.settingsTitle}>Conexiones</div>
                <div style={{ ...S.settingsRow, color: '#27ae60' }}>{'\u25CF'} Backend conectado</div>
                <div style={S.settingsRow}>{'\u25CB'} Etsy - No conectado</div>
                <div style={S.settingsRow}>{'\u25CB'} Shopify - No conectado</div>
                <div style={S.settingsRow}>{'\u25CB'} PayPal - No conectado</div>
                <div style={S.settingsRow}>{'\u25CB'} OpenAI - No conectado</div>
              </div>
              <div style={S.settingsCard}>
                <div style={S.settingsTitle}>Sistema</div>
                <div style={S.settingsRow}>Version: Hokage OS v0.4.0</div>
                <div style={S.settingsRow}>Base de datos: SQLite</div>
                <div style={S.settingsRow}>Agentes activos: {agents.length}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* DETAIL PANEL */}
      {sel && (
        <div style={S.detailPanel}>
          <div style={S.detailHeader}>
            <div style={S.detailAvatar}>{sel.name[0]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{sel.name}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{ROLES[sel.role] || sel.role}</div>
            </div>
            <button style={S.closeBtn} onClick={() => setSel(null)}>{'\u2715'}</button>
          </div>

          <div style={S.detailSection}>
            <div style={S.detailLabel}>Estado</div>
            <div style={sel.status === 'idle' ? S.statusOk : S.statusBusy}>{sel.status === 'idle' ? 'Activo' : sel.status}</div>
          </div>

          <div style={S.detailSection}>
            <div style={S.detailLabel}>Nivel</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Nivel 1</div>
            <div style={S.progressBg}><div style={{ ...S.progressFill, width: '15%', background: '#3498db' }}></div></div>
            <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>150/1000 XP</div>
          </div>

          <div style={S.detailSection}>
            <div style={S.detailLabel}>Asignar tarea</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...S.input, flex: 1, marginBottom: 0 }} placeholder="Describe la tarea..." value={taskIn} onChange={e => setTaskIn(e.target.value)} />
              <button style={S.btnSmall} onClick={async () => {
                if (!taskIn.trim()) return;
                await fetch(API + '/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: sel.id, title: taskIn.trim(), risk_level: 'low' }) });
                setTaskIn(''); load(); show('Tarea asignada');
              }}>OK</button>
            </div>
          </div>

          <div style={S.detailSection}>
            <div style={S.detailLabel}>Mensaje directo</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...S.input, flex: 1, marginBottom: 0 }} placeholder="Escribe..." value={msgIn} onChange={e => setMsgIn(e.target.value)} />
              <button style={S.btnSmall} onClick={async () => {
                if (!msgIn.trim()) return;
                const hId = agents.find(a => a.role === 'ceo')?.id || 1;
                await fetch(API + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender_id: hId, receiver_id: sel.id, content: msgIn.trim() }) });
                setMsgIn(''); load(); show('Mensaje enviado');
              }}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  app: { display: 'flex', minHeight: '100vh', background: '#f8f9fa', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#333' },

  sidebar: { width: 220, background: '#fff', borderRight: '1px solid #eee', display: 'flex', flexDirection: 'column', padding: '20px 0' },
  logoArea: { display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', marginBottom: 30 },
  logoIcon: { width: 36, height: 36, borderRadius: 10, background: '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700 },
  logoText: { fontSize: 15, fontWeight: 700, letterSpacing: -0.5 },
  logoSub: { fontSize: 11, color: '#bbb' },
  navList: { flex: 1 },
  navItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', cursor: 'pointer', fontSize: 14, color: '#666', borderLeft: '3px solid transparent', transition: 'all 0.15s' },
  navActive: { color: '#111', fontWeight: 600, borderLeftColor: '#111', background: '#f5f5f5' },
  navIcon: { fontSize: 14, width: 20, textAlign: 'center' as const },
  navBadge: { marginLeft: 'auto', background: '#e74c3c', color: '#fff', fontSize: 10, fontWeight: 600, width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  sidebarBottom: { borderTop: '1px solid #eee', paddingTop: 16, marginTop: 16 },
  userArea: { display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px' },
  userAvatar: { width: 32, height: 32, borderRadius: '50%', background: '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 },

  mainArea: { flex: 1, display: 'flex', flexDirection: 'column' as const },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', borderBottom: '1px solid #eee', background: '#fff' },
  topTitle: { fontSize: 18, fontWeight: 700 },
  topRight: { display: 'flex', alignItems: 'center', gap: 16 },
  metricPill: { display: 'flex', alignItems: 'center', gap: 6, background: '#f5f5f5', padding: '4px 12px', borderRadius: 20 },
  metricLabel: { fontSize: 11, color: '#999' },
  metricVal: { fontSize: 14, fontWeight: 600 },

  content: { flex: 1, padding: 24, overflowY: 'auto' as const, maxWidth: 900 },
  sectionHead: { fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 12, marginTop: 24, letterSpacing: -0.3 },

  welcomeCard: { display: 'flex', alignItems: 'flex-start', gap: 14, padding: 20, background: '#fff', borderRadius: 12, border: '1px solid #eee', marginBottom: 8 },
  welcomeAvatar: { width: 44, height: 44, borderRadius: 12, background: '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, flexShrink: 0 },

  agentGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 },
  agentCard: { background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 16, cursor: 'pointer', transition: 'box-shadow 0.15s' },
  agentCardTop: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  agentAvatar: { width: 36, height: 36, borderRadius: 10, background: '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 },
  agentStats: { display: 'flex', gap: 8 },
  miniStat: { flex: 1, background: '#f8f9fa', borderRadius: 8, padding: '6px 8px', textAlign: 'center' as const },
  progressArea: { marginBottom: 10 },
  progressBg: { height: 4, background: '#eee', borderRadius: 2 },
  progressFill: { height: '100%', width: '85%', background: '#27ae60', borderRadius: 2 },

  statusOk: { fontSize: 11, padding: '3px 10px', borderRadius: 12, background: '#e8f5e9', color: '#27ae60', fontWeight: 600 },
  statusBusy: { fontSize: 11, padding: '3px 10px', borderRadius: 12, background: '#fff3e0', color: '#f39c12', fontWeight: 600 },

  decisionCard: { background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 16, marginBottom: 10 },
  decisionTop: { display: 'flex', alignItems: 'center', gap: 10 },
  riskDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },

  bizCard: { background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 16, marginBottom: 10 },
  bizStatus: { fontSize: 11, padding: '3px 10px', borderRadius: 12, background: '#f5f5f5', color: '#888' },

  crewRow: { display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: '#fff', borderRadius: 12, border: '1px solid #eee', marginBottom: 8, cursor: 'pointer' },

  msgRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fff', borderRadius: 10, border: '1px solid #eee', marginBottom: 6, fontSize: 13 },

  chatArea: { background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 16, minHeight: 280, maxHeight: 380, overflowY: 'auto' as const },
  chatBubble: { padding: 12, borderBottom: '1px solid #f5f5f5' },
  chBtn: { padding: '6px 14px', background: '#f5f5f5', border: '1px solid #eee', borderRadius: 20, fontSize: 12, cursor: 'pointer', color: '#666' },
  chActive: { padding: '6px 14px', background: '#111', border: '1px solid #111', borderRadius: 20, fontSize: 12, cursor: 'pointer', color: '#fff', fontWeight: 600 },

  formCard: { background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 20 },
  input: { width: '100%', padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, outline: 'none', marginBottom: 10, boxSizing: 'border-box' as const, background: '#fafafa' },
  btnPrimary: { padding: '10px 20px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%' },
  btnApprove: { padding: '7px 18px', background: '#27ae60', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnReject: { padding: '7px 18px', background: '#fff', color: '#e74c3c', border: '1px solid #e74c3c', borderRadius: 8, fontSize: 13, cursor: 'pointer' },
  btnSmall: { padding: '8px 14px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' },

  settingsCard: { background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 20, marginBottom: 12 },
  settingsTitle: { fontSize: 12, fontWeight: 600, color: '#aaa', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 10 },
  settingsRow: { fontSize: 14, color: '#555', marginBottom: 6 },

  emptyState: { color: '#bbb', textAlign: 'center' as const, padding: 40, fontSize: 14 },

  detailPanel: { width: 320, borderLeft: '1px solid #eee', background: '#fff', padding: 20, overflowY: 'auto' as const },
  detailHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 },
  detailAvatar: { width: 48, height: 48, borderRadius: 12, background: '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 },
  closeBtn: { background: 'none', border: '1px solid #ddd', width: 28, height: 28, borderRadius: 8, cursor: 'pointer', fontSize: 14, color: '#999', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  detailSection: { marginBottom: 20 },
  detailLabel: { fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 },

  toast: { position: 'fixed' as const, bottom: 24, right: 24, background: '#111', color: '#fff', padding: '12px 24px', borderRadius: 10, fontSize: 14, fontWeight: 500, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' },
};

export default App;
