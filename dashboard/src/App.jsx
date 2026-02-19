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

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const T = {
  bg: '#0b1120',
  surface: '#111827',
  surface2: '#1a2332',
  border: '#1e293b',
  accent: '#00d4aa',
  accentDim: 'rgba(0,212,170,0.12)',
  danger: '#ef4444',
  dangerDim: 'rgba(239,68,68,0.10)',
  success: '#22c55e',
  text: '#e2e8f0',
  textDim: '#64748b',
  textMuted: '#475569',
};

// ─── MAIN APP (logic preserved exactly) ──────────────────────────────────────
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

  const onMsg = useCallback(
    (data) => {
      const t = data.type || data.event || '';
      const now = new Date();

      if (t === 'experiment_loaded' || t === 'init') {
        setInfo({ name: data.experiment_name || data.name || 'Acid-Base Titration', steps: data.total_steps || 4 });
        if (data.current_step !== undefined) setStep(data.current_step);
        pushLog('info', `Experiment: ${data.experiment_name || 'Acid-Base Titration'}`);
      } else if (t === 'student_update') {
        if (data.detections) setObjects(data.detections);
        if (data.step_info) {
          const prevStep = stepRef.current;
          const newStep = data.step_info.current_step;
          setStep(newStep);
          if (prevStep !== newStep) {
            pushLog('step', `Step ${(newStep || 0) + 1}: ${data.step_info.step_name || STEP_NAMES[newStep] || 'Unknown'}`);
          }
        }
        if (data.safety_alert) {
          setSafety((p) =>
            [{ id: Date.now(), msg: data.safety_alert.message || 'Safety alert', sev: data.safety_alert.severity || 'high', time: now }, ...p].slice(0, MAX_LOG)
          );
          pushLog('danger', `⚠ ${data.safety_alert.message || 'Safety alert'}`);
        }
        if (data.experiment_complete) pushLog('success', '🎉 Experiment completed!');
      } else if (t === 'step_advance') {
        const s = data.step ?? data.current_step ?? data.step_index;
        setStep(s);
        pushLog('step', `Step ${(s || 0) + 1}: ${data.step_name || STEP_NAMES[s] || 'Unknown'}`);
      } else if (t === 'safety_alert') {
        setSafety((p) =>
          [{ id: Date.now(), msg: data.message || 'Safety alert', sev: data.severity || 'high', time: now }, ...p].slice(0, MAX_LOG)
        );
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
        setStep(0); setObjects([]); setSafety([]);
        pushLog('info', '🔄 Experiment reset');
      } else if (t === 'heartbeat' || t === 'pong') {
        // silent
      } else {
        if (data.current_step !== undefined) setStep(data.current_step);
        if (data.objects) setObjects(data.objects);
        if (data.detections) setObjects(data.detections);
      }
    },
    [pushLog]
  );

  useEffect(() => { onMsgRef.current = onMsg; }, [onMsg]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setWs('connecting');
    try {
      const s = new WebSocket(WS_URL);
      wsRef.current = s;
      s.onopen = () => {
        setWs('connected');
        if (reconRef.current) { clearTimeout(reconRef.current); reconRef.current = null; }
      };
      s.onmessage = (e) => {
        try { onMsgRef.current(JSON.parse(e.data)); setLastMsg(new Date()); }
        catch (err) { console.warn('[WS] Parse error', err); }
      };
      s.onclose = () => {
        setWs('disconnected'); wsRef.current = null;
        reconRef.current = setTimeout(connect, RECONNECT_MS);
      };
      s.onerror = () => setWs('disconnected');
    } catch (err) {
      setWs('disconnected');
      reconRef.current = setTimeout(connect, RECONNECT_MS);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); if (reconRef.current) clearTimeout(reconRef.current); };
  }, [connect]);

  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((t) => t + 1), 5000); return () => clearInterval(i); }, []);

  const statusColor = ws === 'connected' ? T.accent : ws === 'connecting' ? '#fbbf24' : T.danger;

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: T.bg, color: T.text }}>

      {/* ─── HEADER ─────────────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(11,17,32,0.85)', backdropFilter: 'blur(16px)',
        borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px' }}>
          {/* Top row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: `linear-gradient(135deg, ${T.accent}, #00a389)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, fontSize: 16, color: T.bg,
              }}>V</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.2 }}>
                  Vocal<span style={{ color: T.accent }}>Lab</span>
                </div>
                <div style={{ fontSize: 11, color: T.textDim, fontWeight: 500 }}>Instructor Dashboard</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Status pill */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 8,
                background: `${statusColor}18`, border: `1px solid ${statusColor}40`,
              }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', background: statusColor,
                  animation: ws === 'connected' ? 'pulse-dot 2s ease-in-out infinite' : ws === 'connecting' ? 'pulse-dot 1s ease-in-out infinite' : 'none',
                }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {ws === 'connected' ? 'LIVE' : ws === 'connecting' ? '...' : 'OFFLINE'}
                </span>
              </div>
              {lastMsg && <span style={{ fontSize: 11, color: T.textDim }}>{ago(lastMsg)}</span>}
              {/* AMD badge */}
              <div style={{
                padding: '4px 10px', borderRadius: 6,
                background: T.accentDim, border: `1px solid ${T.accent}30`,
                fontSize: 10, fontWeight: 700, color: T.accent,
                display: 'flex', gap: 4, alignItems: 'center',
              }}>
                <span style={{ color: T.textDim, fontWeight: 600, letterSpacing: '0.08em' }}>AMD</span>
                Ryzen™ AI
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <nav style={{ display: 'flex', gap: 0, borderTop: `1px solid ${T.border}` }}>
            {[
              { id: 'live', icon: '🔬', label: 'Live Experiment' },
              { id: 'students', icon: '👥', label: 'Class Overview' },
              { id: 'library', icon: '📚', label: 'Experiment Library' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '14px 20px', fontSize: 13, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: tab === t.id ? `${T.accent}08` : 'transparent',
                  color: tab === t.id ? T.accent : T.textDim,
                  border: 'none',
                  borderBottom: `2px solid ${tab === t.id ? T.accent : 'transparent'}`,
                  cursor: 'pointer', transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* ─── MAIN ───────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, maxWidth: 1280, margin: '0 auto', width: '100%', padding: '24px 24px 48px' }}>
        {tab === 'live' && <LiveTab info={info} step={step} objects={objects} safety={safety} log={log} />}
        {tab === 'students' && <StudentsTab />}
        {tab === 'library' && <LibraryTab />}
      </main>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CARD
// ═════════════════════════════════════════════════════════════════════════════
function Card({ children, style = {}, danger = false, delay = 0 }) {
  return (
    <div style={{
      background: danger ? '#160d1e' : T.surface,
      border: `1px solid ${danger ? 'rgba(239,68,68,0.25)' : T.border}`,
      borderRadius: 14, padding: 20, overflow: 'hidden',
      animation: `fadeIn 0.45s ease-out ${delay}s both`,
      ...style,
    }}>
      {children}
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
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Live Experiment</h1>
        <p style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>Real-time progress, detections, and safety monitoring</p>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <Stat icon="🔬" label="Experiment" value={info?.name || 'Waiting...'} delay={0.05} />
        <Stat icon="📍" label="Current Step" value={step !== null ? `${step + 1} of ${total}` : '—'} color={T.accent} delay={0.1} />
        <Stat icon="👁" label="Detections" value={objects.length} color={objects.length > 0 ? T.accent : T.textDim} delay={0.15} />
        <Stat icon="🛡" label="Safety" value={safety.length > 0 ? `${safety.length} Alert${safety.length > 1 ? 's' : ''}` : 'Clear'} color={safety.length > 0 ? T.danger : T.success} delay={0.2} />
      </div>

      {/* ── Step Progress (horizontal) ─────────────────────────────── */}
      <Card delay={0.12}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>📋 Step Progress</h3>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.accent }}>{pct}%</span>
        </div>

        {/* Progress bar */}
        <div style={{ height: 6, borderRadius: 99, background: T.surface2, marginBottom: 20 }}>
          <div style={{
            height: '100%', borderRadius: 99, transition: 'width 0.6s ease',
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${T.accent}, #00a389)`,
          }} />
        </div>

        {/* Step pills in a row */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${total}, 1fr)`, gap: 12 }}>
          {STEP_NAMES.map((name, i) => {
            const done = step !== null && i < step;
            const active = step !== null && i === step;
            return (
              <div key={i} style={{
                padding: '12px 14px', borderRadius: 10,
                background: active ? T.accentDim : done ? 'rgba(0,212,170,0.06)' : T.surface2,
                border: `1px solid ${active ? T.accent + '50' : done ? T.accent + '20' : T.border}`,
                transition: 'all 0.3s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: done ? T.accent : active ? T.accent + '30' : T.border,
                    color: done ? T.bg : active ? T.accent : T.textDim,
                    animation: active ? 'glow 2s ease-in-out infinite' : 'none',
                  }}>
                    {done ? '✓' : i + 1}
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: active ? T.accent : done ? T.textDim : T.text,
                    textDecoration: done ? 'line-through' : 'none',
                  }}>{name}</span>
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, color: active ? T.accent : done ? T.success : T.textMuted, marginLeft: 32 }}>
                  {active ? '● In progress' : done ? '✓ Complete' : 'Pending'}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Row: Safety + Detected Objects ──────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Safety Alerts */}
        <Card danger={safety.length > 0} delay={0.18}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>🛡️ Safety</h3>
            {safety.length > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                background: T.dangerDim, color: T.danger, border: `1px solid ${T.danger}30`,
              }}>{safety.length} alert{safety.length > 1 ? 's' : ''}</span>
            )}
          </div>
          {safety.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
              {safety.map((a, i) => (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
                  background: T.dangerDim, border: `1px solid ${T.danger}20`,
                  animation: `slide-in 0.3s ease-out ${i * 0.05}s both`,
                }}>
                  <span style={{ fontSize: 14 }}>🚨</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#fca5a5' }}>{a.msg}</div>
                    <div style={{ fontSize: 10, color: T.textDim, marginTop: 2 }}>{fmt(a.time)}</div>
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase',
                    background: a.sev === 'critical' ? `${T.danger}30` : 'rgba(249,115,22,0.2)',
                    color: a.sev === 'critical' ? '#fca5a5' : '#fdba74',
                  }}>{a.sev}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '28px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 6 }}>✅</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.success }}>All Clear</div>
              <div style={{ fontSize: 11, color: T.textDim, marginTop: 4 }}>Following safety protocol</div>
            </div>
          )}
        </Card>

        {/* Detected Objects */}
        <Card delay={0.22}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>👁️ Detections</h3>
            {objects.length > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                background: T.accentDim, color: T.accent, border: `1px solid ${T.accent}30`,
              }}>{objects.length} found</span>
            )}
          </div>
          {objects.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {objects.map((obj, i) => {
                const label = typeof obj === 'string' ? obj : obj.label || obj.name || obj.class || 'unknown';
                const conf = typeof obj === 'object' ? obj.confidence || obj.conf : null;
                return (
                  <div key={`${label}-${i}`} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
                    background: T.accentDim, border: `1px solid ${T.accent}25`, color: T.accent,
                    fontSize: 12, fontWeight: 600,
                    animation: `slide-in 0.3s ease-out ${i * 0.04}s both`,
                  }}>
                    {label}
                    {conf != null && <span style={{ fontSize: 10, color: T.textDim, fontFamily: 'monospace' }}>{(conf * 100).toFixed(0)}%</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '28px 0' }}>
              <div style={{ fontSize: 28, marginBottom: 6, opacity: 0.35 }}>📷</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: T.textDim }}>No objects detected</div>
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>Point camera at lab equipment</div>
            </div>
          )}
        </Card>
      </div>

      {/* ── Event Log (full width) ──────────────────────────────────── */}
      <Card delay={0.26}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>📜 Event Log</h3>
          {log.length > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, color: T.textDim }}>{log.length} events</span>
          )}
        </div>
        {log.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
            {log.map((e, i) => {
              const colors = { danger: T.danger, step: T.accent, success: T.success, info: T.textDim };
              const icons = { danger: '🚨', step: '📍', success: '🎉', info: 'ℹ️' };
              const c = colors[e.type] || T.textDim;
              return (
                <div key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8,
                  background: `${c}10`, borderLeft: `3px solid ${c}`,
                  animation: `slide-in 0.3s ease-out ${Math.min(i, 4) * 0.05}s both`,
                }}>
                  <span style={{ fontSize: 11, flexShrink: 0 }}>{icons[e.type] || 'ℹ️'}</span>
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{e.msg}</span>
                  <span style={{ fontSize: 11, color: T.textDim, fontFamily: 'monospace', flexShrink: 0 }}>{fmt(e.time)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '28px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 6, opacity: 0.35 }}>📭</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: T.textDim }}>No events yet</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>Events appear when the experiment starts</div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STAT CARD
// ═════════════════════════════════════════════════════════════════════════════
function Stat({ icon, label, value, color = T.accent, delay = 0 }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
      padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
      animation: `fadeIn 0.4s ease-out ${delay}s both`,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, flexShrink: 0,
      }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STUDENTS TAB
// ═════════════════════════════════════════════════════════════════════════════
function StudentsTab() {
  const sc = {
    active: { bg: T.accentDim, color: T.accent, label: 'Active' },
    idle: { bg: `${T.textDim}18`, color: T.textDim, label: 'Idle' },
    completed: { bg: `${T.success}18`, color: T.success, label: 'Done' },
    safety_alert: { bg: T.dangerDim, color: T.danger, label: 'Alert' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Class Overview</h1>
        <p style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>
          Monitoring {MOCK_STUDENTS.length} students • 4 languages supported
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {Object.entries(sc).map(([k, v]) => {
          const n = MOCK_STUDENTS.filter((s) => s.status === k).length;
          return n > 0 ? (
            <div key={k} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 8,
              background: v.bg, border: `1px solid ${v.color}30`, fontSize: 11, fontWeight: 700, color: v.color,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: v.color }} />
              {n} {v.label}
            </div>
          ) : null;
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {MOCK_STUDENTS.map((st, i) => {
          const s = sc[st.status] || sc.idle;
          const pct = Math.round((st.step / st.total) * 100);
          return (
            <Card key={st.id} delay={i * 0.06}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, background: 'linear-gradient(135deg, rgba(0,212,170,0.3), rgba(59,130,246,0.3))', flexShrink: 0,
                  }}>{st.name.charAt(0)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.name}</div>
                    <div style={{ fontSize: 11, color: T.textDim, fontFamily: 'monospace' }}>{st.id}</div>
                  </div>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 99,
                  background: s.bg, border: `1px solid ${s.color}30`, fontSize: 11, fontWeight: 700, color: s.color, flexShrink: 0,
                }}>
                  <div style={{
                    width: 5, height: 5, borderRadius: '50%', background: s.color,
                    animation: st.status === 'active' ? 'pulse-dot 1.4s ease-in-out infinite' : 'none',
                  }} />
                  {s.label}
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
                  <span style={{ color: T.textDim }}>Step {st.step}/{st.total}</span>
                  <span style={{ fontWeight: 700, color: T.accent }}>{pct}%</span>
                </div>
                <div style={{ height: 5, borderRadius: 99, background: T.surface2 }}>
                  <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: `linear-gradient(90deg, ${T.accent}, #00a389)`, transition: 'width 0.6s' }} />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: T.textDim }}>🌐 {st.lang}</span>
                {st.alerts > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                    background: T.dangerDim, color: T.danger, border: `1px solid ${T.danger}20`,
                  }}>⚠ {st.alerts}</span>
                )}
              </div>
            </Card>
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
    Beginner: { color: T.success },
    Intermediate: { color: '#eab308' },
    Advanced: { color: T.danger },
  };
  const si = { Chemistry: '⚗️', Physics: '⚡', Biology: '🧬' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Experiment Library</h1>
        <p style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>
          {EXPERIMENTS.length} experiments • {EXPERIMENTS.filter((e) => e.active).length} live now
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {EXPERIMENTS.map((exp, i) => {
          const d = dc[exp.diff] || { color: T.textDim };
          return (
            <Card key={exp.id} delay={i * 0.06} style={{ position: 'relative' }}>
              {exp.active && (
                <div style={{
                  position: 'absolute', top: 14, right: 14,
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '3px 10px', borderRadius: 99,
                  background: T.accentDim, border: `1px solid ${T.accent}35`,
                  fontSize: 10, fontWeight: 700, color: T.accent,
                }}>
                  <div style={{
                    width: 5, height: 5, borderRadius: '50%', background: T.accent,
                    animation: 'pulse-dot 1.4s ease-in-out infinite',
                  }} />
                  LIVE
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, background: T.surface2, flexShrink: 0,
                }}>{si[exp.subject] || '🔬'}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{exp.subject}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exp.name}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
                  background: `${d.color}18`, color: d.color, border: `1px solid ${d.color}35`,
                }}>{exp.diff}</span>
                <span style={{ fontSize: 11, color: T.textDim, display: 'flex', alignItems: 'center', gap: 4 }}>📋 {exp.steps} steps</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
                <span style={{ fontSize: 11, color: T.textDim }}>
                  {exp.active ? `👥 ${exp.students} students` : 'No sessions'}
                </span>
                <button style={{
                  padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  background: exp.active ? T.accent : T.surface2,
                  color: exp.active ? T.bg : T.textDim,
                  border: exp.active ? 'none' : `1px solid ${T.border}`,
                  cursor: 'pointer', transition: 'all 0.2s',
                }}>
                  {exp.active ? 'View Live →' : 'Start'}
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
