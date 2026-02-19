import React, { useState, useEffect, useRef, useCallback } from 'react';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const WS_URL = 'ws://localhost:8000/ws/dashboard';
const RECONNECT_MS = 3000;
const MAX_LOG = 50;

const MOCK_STUDENTS = [
  { id: 'STU-001', name: 'Aarav Sharma', status: 'active', step: 2, total: 4, alerts: 0, lang: 'Hindi' },
  { id: 'STU-002', name: 'Priya Patel', status: 'active', step: 3, total: 4, alerts: 1, lang: 'English' },
  { id: 'STU-003', name: 'Rohan Reddy', status: 'idle', step: 1, total: 4, alerts: 0, lang: 'Telugu' },
  { id: 'STU-004', name: 'Diya Verma', status: 'completed', step: 4, total: 4, alerts: 0, lang: 'Hindi' },
  { id: 'STU-005', name: 'Kabir Murugan', status: 'safety_alert', step: 2, total: 4, alerts: 3, lang: 'Tamil' },
];

const EXPERIMENTS = [
  { id: 1, name: 'Acid-Base Titration', subject: 'Chemistry', diff: 'Intermediate', steps: 4, active: true, students: 5 },
  { id: 2, name: "Newton's Second Law", subject: 'Physics', diff: 'Beginner', steps: 5, active: false, students: 0 },
  { id: 3, name: 'Cell Observation', subject: 'Biology', diff: 'Beginner', steps: 3, active: false, students: 0 },
  { id: 4, name: 'Electrolysis of Water', subject: 'Chemistry', diff: 'Advanced', steps: 6, active: false, students: 0 },
  { id: 5, name: 'Simple Pendulum', subject: 'Physics', diff: 'Beginner', steps: 4, active: false, students: 0 },
  { id: 6, name: 'Saponification Reaction', subject: 'Chemistry', diff: 'Intermediate', steps: 5, active: false, students: 0 },
];

const STEP_NAMES = ['Setup Equipment', 'Pour Acid (HCl)', 'Add Base & Indicator', 'Record Observations'];

const fmt = (d) => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const ago = (d) => {
  const s = Math.floor((Date.now() - d) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

// ─── COLORS ──────────────────────────────────────────────────────────────────
const C = {
  bg: '#060a13',
  accent: '#00d4aa',
  accentRgb: '0, 212, 170',
  blue: '#3b82f6',
  purple: '#a855f7',
  danger: '#ef4444',
  dangerRgb: '239, 68, 68',
  success: '#22c55e',
  successRgb: '34, 197, 94',
  warn: '#f59e0b',
  text: '#e2e8f0',
  dim: '#64748b',
  muted: '#475569',
  surface: 'rgba(15, 23, 42, 0.5)',
  border: 'rgba(255, 255, 255, 0.06)',
  borderHover: 'rgba(0, 212, 170, 0.2)',
};

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [ws, setWs] = useState('disconnected');
  const [tab, setTab] = useState('live');
  const [info, setInfo] = useState(null);
  const [step, setStep] = useState(null);
  const [objects, setObjects] = useState([]);
  const [safety, setSafety] = useState([]);
  const [log, setLog] = useState([]);
  const [lastMsg, setLastMsg] = useState(null);
  const wsRef = useRef(null);
  const reconRef = useRef(null);
  const stepRef = useRef(step);
  const onMsgRef = useRef(null);

  useEffect(() => { stepRef.current = step; }, [step]);

  const pushLog = useCallback((type, msg) => {
    setLog((p) => [{ id: Date.now() + Math.random(), type, msg, time: new Date() }, ...p].slice(0, MAX_LOG));
  }, []);

  const onMsg = useCallback((data) => {
    const t = data.type || data.event || '';
    const now = new Date();
    if (t === 'experiment_loaded' || t === 'init') {
      setInfo({ name: data.experiment_name || data.name || 'Acid-Base Titration', steps: data.total_steps || 4 });
      if (data.current_step !== undefined) setStep(data.current_step);
      pushLog('info', `Experiment: ${data.experiment_name || 'Acid-Base Titration'}`);
    } else if (t === 'student_update') {
      if (data.detections) setObjects(data.detections);
      if (data.step_info) {
        const prev = stepRef.current, next = data.step_info.current_step;
        setStep(next);
        if (prev !== next) pushLog('step', `Step ${(next || 0) + 1}: ${data.step_info.step_name || STEP_NAMES[next] || 'Unknown'}`);
      }
      if (data.safety_alert) {
        setSafety(p => [{ id: Date.now(), msg: data.safety_alert.message || 'Safety alert', sev: data.safety_alert.severity || 'high', time: now }, ...p].slice(0, MAX_LOG));
        pushLog('danger', `⚠ ${data.safety_alert.message || 'Safety alert'}`);
      }
      if (data.experiment_complete) pushLog('success', '🎉 Experiment completed!');
    } else if (t === 'step_advance') {
      const s = data.step ?? data.current_step ?? data.step_index;
      setStep(s); pushLog('step', `Step ${(s || 0) + 1}: ${data.step_name || STEP_NAMES[s] || 'Unknown'}`);
    } else if (t === 'safety_alert') {
      setSafety(p => [{ id: Date.now(), msg: data.message || 'Safety alert', sev: data.severity || 'high', time: now }, ...p].slice(0, MAX_LOG));
      pushLog('danger', `⚠ ${data.message || 'Safety alert'}`);
    } else if (t === 'detection' || t === 'detections') {
      setObjects(data.objects || data.detections || []);
    } else if (t === 'experiment_complete' || t === 'complete') {
      pushLog('success', '🎉 Experiment completed!');
    } else if (t === 'student_connected') {
      pushLog('info', `Student connected (${data.student_count || 1} total)`);
    } else if (t === 'student_disconnected') {
      pushLog('info', `Student disconnected (${data.student_count || 0} total)`);
    } else if (t === 'experiment_reset') {
      setStep(0); setObjects([]); setSafety([]); pushLog('info', '🔄 Experiment reset');
    } else if (t !== 'heartbeat' && t !== 'pong') {
      if (data.current_step !== undefined) setStep(data.current_step);
      if (data.objects) setObjects(data.objects);
      if (data.detections) setObjects(data.detections);
    }
  }, [pushLog]);

  useEffect(() => { onMsgRef.current = onMsg; }, [onMsg]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setWs('connecting');
    try {
      const s = new WebSocket(WS_URL); wsRef.current = s;
      s.onopen = () => { setWs('connected'); if (reconRef.current) { clearTimeout(reconRef.current); reconRef.current = null; } };
      s.onmessage = (e) => { try { onMsgRef.current(JSON.parse(e.data)); setLastMsg(new Date()); } catch { } };
      s.onclose = () => { setWs('disconnected'); wsRef.current = null; reconRef.current = setTimeout(connect, RECONNECT_MS); };
      s.onerror = () => setWs('disconnected');
    } catch { setWs('disconnected'); reconRef.current = setTimeout(connect, RECONNECT_MS); }
  }, []);

  useEffect(() => { connect(); return () => { wsRef.current?.close(); if (reconRef.current) clearTimeout(reconRef.current); }; }, [connect]);
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick(t => t + 1), 5000); return () => clearInterval(i); }, []);

  const tabs = [
    { id: 'live', icon: '🔬', label: 'Live Experiment' },
    { id: 'students', icon: '👥', label: 'Class Overview' },
    { id: 'library', icon: '📚', label: 'Experiment Library' },
  ];

  const statusColor = ws === 'connected' ? C.accent : ws === 'connecting' ? C.warn : C.danger;

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Animated mesh background */}
      <div className="mesh-bg" />

      {/* ═══ HEADER ═══ */}
      <header className="glass-static" style={{
        position: 'sticky', top: 0, zIndex: 50, borderRadius: 0,
        borderBottom: `1px solid ${C.border}`,
        background: 'rgba(6, 10, 19, 0.8)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
      }}>
        <div style={{ maxWidth: 1320, margin: '0 auto', padding: '0 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: `linear-gradient(135deg, ${C.accent}, ${C.blue})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, fontSize: 18, color: '#fff',
                boxShadow: `0 0 20px rgba(${C.accentRgb}, 0.3)`,
              }}>V</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em' }}>
                  Vocal<span className="gradient-text">Lab</span>
                </div>
                <div style={{ fontSize: 10, color: C.dim, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Instructor Dashboard</div>
              </div>
            </div>

            {/* Right side */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Live status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 99, background: `${statusColor}12`, border: `1px solid ${statusColor}30` }}>
                <div style={{ position: 'relative' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
                  {ws === 'connected' && <div style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `2px solid ${statusColor}`, animation: 'ripple 2s ease-out infinite' }} />}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, letterSpacing: '0.06em' }}>
                  {ws === 'connected' ? 'LIVE' : ws === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
                </span>
              </div>
              {lastMsg && <span style={{ fontSize: 11, color: C.dim, fontWeight: 500 }}>{ago(lastMsg)}</span>}
              {/* AMD */}
              <div style={{
                padding: '5px 12px', borderRadius: 8,
                background: 'linear-gradient(135deg, rgba(0,212,170,0.08), rgba(59,130,246,0.08))',
                border: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700,
                display: 'flex', gap: 6, alignItems: 'center',
              }}>
                <span style={{ color: C.dim, letterSpacing: '0.1em' }}>AMD</span>
                <span className="gradient-text">Ryzen™ AI</span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <nav style={{ display: 'flex', gap: 2, marginTop: -1 }}>
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  padding: '12px 20px', fontSize: 13, fontWeight: active ? 700 : 500,
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                  background: active ? `rgba(${C.accentRgb}, 0.06)` : 'transparent',
                  color: active ? C.accent : C.dim,
                  border: 'none', borderBottom: `2px solid ${active ? C.accent : 'transparent'}`,
                  transition: 'all 0.25s', whiteSpace: 'nowrap', borderRadius: '8px 8px 0 0',
                }}>
                  <span style={{ fontSize: 15 }}>{t.icon}</span> {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ═══ MAIN ═══ */}
      <main style={{ flex: 1, maxWidth: 1320, margin: '0 auto', width: '100%', padding: '28px 28px 60px', position: 'relative', zIndex: 1 }}>
        {tab === 'live' && <LiveTab info={info} step={step} objects={objects} safety={safety} log={log} />}
        {tab === 'students' && <StudentsTab />}
        {tab === 'library' && <LibraryTab />}
      </main>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// GLASS CARD
// ═════════════════════════════════════════════════════════════════════════════
function GlassCard({ children, style = {}, danger = false, delay = 0, hover = true, glow = false }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={hover ? 'glass' : 'glass-static'}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        padding: 22, position: 'relative', overflow: 'hidden',
        animation: `fadeIn 0.5s ease-out ${delay}s both`,
        ...(danger ? { background: 'rgba(30, 10, 20, 0.5)', borderColor: `rgba(${C.dangerRgb}, 0.2)` } : {}),
        ...(glow && !danger ? { animation: `fadeIn 0.5s ease-out ${delay}s both, borderGlow 3s ease-in-out infinite` } : {}),
        ...style,
      }}
    >
      {/* Subtle top accent line */}
      {glow && !danger && (
        <div style={{
          position: 'absolute', top: 0, left: '10%', right: '10%', height: 1,
          background: `linear-gradient(90deg, transparent, rgba(${C.accentRgb}, 0.4), transparent)`,
        }} />
      )}
      {children}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CIRCULAR PROGRESS
// ═════════════════════════════════════════════════════════════════════════════
function CircularProgress({ value, size = 80, strokeWidth = 6 }) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (value / 100) * circ;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={`url(#grad-${size})`}
          strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease-out', filter: `drop-shadow(0 0 6px rgba(${C.accentRgb}, 0.4))` }}
        />
        <defs>
          <linearGradient id={`grad-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={C.accent} />
            <stop offset="100%" stopColor={C.blue} />
          </linearGradient>
        </defs>
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <span style={{ fontSize: size > 60 ? 20 : 14, fontWeight: 800, color: C.text }}>{value}%</span>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// LIVE TAB
// ═════════════════════════════════════════════════════════════════════════════
function LiveTab({ info, step, objects, safety, log }) {
  const total = info?.steps || 4;
  const pct = step !== null ? Math.round(((step + 1) / total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Title */}
      <div style={{ animation: 'fadeIn 0.4s ease-out both' }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em' }}>
          Live <span className="gradient-text">Experiment</span>
        </h1>
        <p style={{ fontSize: 14, color: C.dim, marginTop: 6, fontWeight: 500 }}>Real-time progress, detections, and safety monitoring</p>
      </div>

      {/* ── Stat Row ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {[
          { icon: '🔬', label: 'Experiment', value: info?.name || 'Waiting...', color: C.accent },
          { icon: '📍', label: 'Current Step', value: step !== null ? `${step + 1} of ${total}` : '—', color: C.accent },
          { icon: '👁', label: 'Detections', value: objects.length, color: objects.length > 0 ? C.accent : C.dim },
          { icon: '🛡', label: 'Safety', value: safety.length > 0 ? `${safety.length} Alert${safety.length > 1 ? 's' : ''}` : 'Clear', color: safety.length > 0 ? C.danger : C.success },
        ].map((s, i) => (
          <GlassCard key={i} delay={0.05 + i * 0.06} style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: `${s.color}12`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, flexShrink: 0,
                border: `1px solid ${s.color}20`,
              }}>{s.icon}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: s.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.value}</div>
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* ── Step Progress ───────────────────────────────────────────── */}
      <GlassCard glow delay={0.15}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {/* Circular progress */}
          <CircularProgress value={pct} size={88} strokeWidth={7} />

          {/* Steps */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                📋 <span>Step Progress</span>
              </h3>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.dim }}>{step !== null ? `Step ${step + 1} of ${total}` : 'Not started'}</span>
            </div>

            {/* Step bar */}
            <div style={{ display: 'flex', gap: 6 }}>
              {STEP_NAMES.map((name, i) => {
                const done = step !== null && i < step;
                const active = step !== null && i === step;
                return (
                  <div key={i} style={{ flex: 1 }}>
                    {/* Bar segment */}
                    <div style={{
                      height: 4, borderRadius: 99, marginBottom: 10,
                      background: done ? `linear-gradient(90deg, ${C.accent}, ${C.blue})` : active ? `rgba(${C.accentRgb}, 0.35)` : 'rgba(255,255,255,0.06)',
                      boxShadow: done ? `0 0 8px rgba(${C.accentRgb}, 0.3)` : 'none',
                      transition: 'all 0.6s ease',
                    }} />
                    {/* Step label */}
                    <div style={{
                      padding: '10px 12px', borderRadius: 10,
                      background: active ? `rgba(${C.accentRgb}, 0.08)` : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${active ? `rgba(${C.accentRgb}, 0.25)` : 'rgba(255,255,255,0.04)'}`,
                      transition: 'all 0.3s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%', fontSize: 10, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          background: done ? `linear-gradient(135deg, ${C.accent}, ${C.blue})` : active ? `rgba(${C.accentRgb}, 0.2)` : 'rgba(255,255,255,0.06)',
                          color: done || active ? '#fff' : C.dim,
                          boxShadow: active ? `0 0 12px rgba(${C.accentRgb}, 0.3)` : 'none',
                          animation: active ? 'pulseGlow 2s ease-in-out infinite' : 'none',
                        }}>
                          {done ? '✓' : i + 1}
                        </div>
                        <span style={{
                          fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          color: active ? C.accent : done ? C.dim : C.text,
                          textDecoration: done ? 'line-through' : 'none',
                        }}>{name}</span>
                      </div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: active ? C.accent : done ? C.success : C.muted, marginTop: 4, marginLeft: 30 }}>
                        {active ? '● In progress' : done ? '✓ Complete' : 'Pending'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </GlassCard>

      {/* ── Safety + Detections ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Safety */}
        <GlassCard danger={safety.length > 0} glow={safety.length === 0} delay={0.22} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>🛡️ Safety Status</h3>
            {safety.length > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 99,
                background: `rgba(${C.dangerRgb}, 0.15)`, color: C.danger,
                border: `1px solid rgba(${C.dangerRgb}, 0.3)`,
                animation: 'pulseDot 1.4s ease-in-out infinite',
              }}>{safety.length} ALERT{safety.length > 1 ? 'S' : ''}</span>
            )}
          </div>
          {safety.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, maxHeight: 240, overflowY: 'auto' }}>
              {safety.map((a, i) => (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 12,
                  background: `rgba(${C.dangerRgb}, 0.06)`, border: `1px solid rgba(${C.dangerRgb}, 0.12)`,
                  animation: `slideIn 0.35s ease-out ${i * 0.05}s both`,
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: `rgba(${C.dangerRgb}, 0.12)`, fontSize: 14, flexShrink: 0,
                  }}>🚨</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#fca5a5' }}>{a.msg}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{fmt(a.time)}</div>
                  </div>
                  <span style={{
                    fontSize: 8, fontWeight: 800, padding: '3px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
                    background: a.sev === 'critical' ? `rgba(${C.dangerRgb}, 0.2)` : 'rgba(249,115,22,0.15)',
                    color: a.sev === 'critical' ? '#fca5a5' : '#fdba74',
                  }}>{a.sev}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 8, animation: 'float 3s ease-in-out infinite' }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.success }}>All Clear</div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>Following safety protocol</div>
            </div>
          )}
        </GlassCard>

        {/* Detections */}
        <GlassCard glow delay={0.26} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>👁️ Detected Objects</h3>
            {objects.length > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 99,
                background: `rgba(${C.accentRgb}, 0.1)`, color: C.accent,
                border: `1px solid rgba(${C.accentRgb}, 0.25)`,
              }}>{objects.length} found</span>
            )}
          </div>
          {objects.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1 }}>
              {objects.map((obj, i) => {
                const label = typeof obj === 'string' ? obj : obj.label || obj.name || obj.class || 'unknown';
                const conf = typeof obj === 'object' ? obj.confidence || obj.conf : null;
                return (
                  <div key={`${label}-${i}`} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 10,
                    background: `rgba(${C.accentRgb}, 0.08)`,
                    border: `1px solid rgba(${C.accentRgb}, 0.18)`,
                    color: C.accent, fontSize: 12, fontWeight: 600,
                    animation: `slideIn 0.3s ease-out ${i * 0.04}s both`,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, boxShadow: `0 0 6px rgba(${C.accentRgb}, 0.5)` }} />
                    {label}
                    {conf != null && <span style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace' }}>{(conf * 100).toFixed(0)}%</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3, animation: 'float 4s ease-in-out infinite' }}>📷</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.dim }}>No objects detected</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Point camera at lab equipment</div>
            </div>
          )}
        </GlassCard>
      </div>

      {/* ── Event Log ───────────────────────────────────────────────── */}
      <GlassCard glow delay={0.3}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>📜 Event Log</h3>
          {log.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: C.dim }}>{log.length} events</span>}
        </div>
        {log.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
            {log.map((e, i) => {
              const colors = { danger: C.danger, step: C.accent, success: C.success, info: C.dim };
              const icons = { danger: '🚨', step: '📍', success: '🎉', info: 'ℹ️' };
              const rgb = { danger: C.dangerRgb, step: C.accentRgb, success: C.successRgb, info: '100,116,139' };
              const c = colors[e.type] || C.dim;
              const r = rgb[e.type] || '100,116,139';
              return (
                <div key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 10,
                  background: `rgba(${r}, 0.05)`, borderLeft: `3px solid rgba(${r}, 0.6)`,
                  animation: `slideIn 0.3s ease-out ${Math.min(i, 4) * 0.04}s both`,
                }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{icons[e.type] || 'ℹ️'}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{e.msg}</span>
                  <span style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace', flexShrink: 0, fontWeight: 500 }}>{fmt(e.time)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 6, opacity: 0.3, animation: 'float 3.5s ease-in-out infinite' }}>📭</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.dim }}>No events yet</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Events appear when the experiment starts</div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STUDENTS TAB
// ═════════════════════════════════════════════════════════════════════════════
function StudentsTab() {
  const sc = {
    active: { color: C.accent, label: 'Active', rgb: C.accentRgb },
    idle: { color: C.dim, label: 'Idle', rgb: '100,116,139' },
    completed: { color: C.success, label: 'Done', rgb: C.successRgb },
    safety_alert: { color: C.danger, label: 'Alert', rgb: C.dangerRgb },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ animation: 'fadeIn 0.4s ease-out both' }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em' }}>
          Class <span className="gradient-text">Overview</span>
        </h1>
        <p style={{ fontSize: 14, color: C.dim, marginTop: 6, fontWeight: 500 }}>Monitoring {MOCK_STUDENTS.length} students • 4 languages supported</p>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8, animation: 'fadeIn 0.4s ease-out 0.1s both' }}>
        {Object.entries(sc).map(([k, v]) => {
          const n = MOCK_STUDENTS.filter(s => s.status === k).length;
          return n > 0 ? (
            <div key={k} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 99,
              background: `rgba(${v.rgb}, 0.08)`, border: `1px solid rgba(${v.rgb}, 0.2)`,
              fontSize: 11, fontWeight: 700, color: v.color,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: v.color, animation: k === 'active' ? 'pulseDot 1.4s ease-in-out infinite' : 'none' }} />
              {n} {v.label}
            </div>
          ) : null;
        })}
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {MOCK_STUDENTS.map((st, i) => {
          const s = sc[st.status] || sc.idle;
          const pct = Math.round((st.step / st.total) * 100);
          return (
            <GlassCard key={st.id} delay={i * 0.06}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 700,
                    background: `linear-gradient(135deg, rgba(${C.accentRgb}, 0.25), rgba(59,130,246,0.25))`,
                    boxShadow: `0 0 16px rgba(${C.accentRgb}, 0.1)`, flexShrink: 0,
                  }}>{st.name.charAt(0)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.name}</div>
                    <div style={{ fontSize: 11, color: C.dim, fontFamily: 'monospace' }}>{st.id}</div>
                  </div>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 99,
                  background: `rgba(${s.rgb}, 0.08)`, border: `1px solid rgba(${s.rgb}, 0.2)`,
                  fontSize: 11, fontWeight: 700, color: s.color, flexShrink: 0,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: s.color, animation: st.status === 'active' ? 'pulseDot 1.4s ease-in-out infinite' : 'none' }} />
                  {s.label}
                </div>
              </div>

              {/* Progress */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: C.dim }}>Step {st.step}/{st.total}</span>
                  <span style={{ fontWeight: 700, color: C.accent }}>{pct}%</span>
                </div>
                <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.05)' }}>
                  <div style={{
                    height: '100%', borderRadius: 99, width: `${pct}%`,
                    background: `linear-gradient(90deg, ${C.accent}, ${C.blue})`,
                    boxShadow: `0 0 8px rgba(${C.accentRgb}, 0.3)`,
                    transition: 'width 0.6s',
                  }} />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: C.dim }}>🌐 {st.lang}</span>
                {st.alerts > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                    background: `rgba(${C.dangerRgb}, 0.1)`, color: C.danger,
                    border: `1px solid rgba(${C.dangerRgb}, 0.15)`,
                  }}>⚠ {st.alerts}</span>
                )}
              </div>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// LIBRARY TAB
// ═════════════════════════════════════════════════════════════════════════════
function LibraryTab() {
  const dc = {
    Beginner: { color: C.success, rgb: C.successRgb },
    Intermediate: { color: '#eab308', rgb: '234,179,8' },
    Advanced: { color: C.danger, rgb: C.dangerRgb },
  };
  const si = { Chemistry: '⚗️', Physics: '⚡', Biology: '🧬' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ animation: 'fadeIn 0.4s ease-out both' }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em' }}>
          Experiment <span className="gradient-text">Library</span>
        </h1>
        <p style={{ fontSize: 14, color: C.dim, marginTop: 6, fontWeight: 500 }}>
          {EXPERIMENTS.length} experiments • {EXPERIMENTS.filter(e => e.active).length} live now
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {EXPERIMENTS.map((exp, i) => {
          const d = dc[exp.diff] || { color: C.dim, rgb: '100,116,139' };
          return (
            <GlassCard key={exp.id} delay={i * 0.06} style={{ position: 'relative' }}>
              {/* Live badge */}
              {exp.active && (
                <div style={{
                  position: 'absolute', top: 16, right: 16,
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 12px', borderRadius: 99,
                  background: `rgba(${C.accentRgb}, 0.1)`, border: `1px solid rgba(${C.accentRgb}, 0.25)`,
                  fontSize: 10, fontWeight: 700, color: C.accent,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent, animation: 'pulseDot 1.4s ease-in-out infinite', boxShadow: `0 0 6px rgba(${C.accentRgb}, 0.5)` }} />
                  LIVE
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22,
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
                  border: `1px solid ${C.border}`, flexShrink: 0,
                }}>{si[exp.subject] || '🔬'}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{exp.subject}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exp.name}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '4px 12px', borderRadius: 99,
                  background: `rgba(${d.rgb}, 0.1)`, color: d.color,
                  border: `1px solid rgba(${d.rgb}, 0.25)`,
                }}>{exp.diff}</span>
                <span style={{ fontSize: 11, color: C.dim, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>📋 {exp.steps} steps</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 11, color: C.dim, fontWeight: 500 }}>
                  {exp.active ? `👥 ${exp.students} students` : 'No sessions'}
                </span>
                <button style={{
                  padding: '8px 18px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                  background: exp.active ? `linear-gradient(135deg, ${C.accent}, ${C.blue})` : 'rgba(255,255,255,0.04)',
                  color: exp.active ? '#fff' : C.dim,
                  border: exp.active ? 'none' : `1px solid ${C.border}`,
                  cursor: 'pointer', transition: 'all 0.25s',
                  boxShadow: exp.active ? `0 0 20px rgba(${C.accentRgb}, 0.25)` : 'none',
                }}>
                  {exp.active ? 'View Live →' : 'Start'}
                </button>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}
