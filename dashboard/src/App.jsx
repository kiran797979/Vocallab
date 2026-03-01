import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const WS_URL = `ws://${window.location.hostname}:8000/ws/dashboard`;
const RECONNECT_MS = 3000;
const MAX_LOG = 50;
const DEBOUNCE_MS = 250;  // batch student_update renders

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
const fmtDur = (s) => { if (!s || s < 0) return '0s'; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return m > 0 ? `${m}m ${sec}s` : `${sec}s`; };
const ago = (d) => {
  const s = Math.floor((Date.now() - d) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

// ─── COLORS ──────────────────────────────────────────────────────────────────
const C = {
  bg: '#F8FAFC',
  accent: '#2563EB',
  accentRgb: '37, 99, 235',
  blue: '#1E40AF',
  purple: '#2563EB',
  danger: '#DC2626',
  dangerRgb: '220, 38, 38',
  success: '#16A34A',
  successRgb: '22, 163, 74',
  warn: '#D97706',
  text: '#1E293B',
  dim: '#64748B',
  muted: '#94A3B8',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  borderHover: '#2563EB',
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
  const [liveStudents, setLiveStudents] = useState({});   // student_id -> latest snapshot
  const wsRef = useRef(null);
  const reconRef = useRef(null);
  const stepRef = useRef(step);
  const onMsgRef = useRef(null);
  // Debounce buffer: accumulate student snapshots, flush every DEBOUNCE_MS
  const studentBufRef = useRef({});
  const flushTimerRef = useRef(null);

  useEffect(() => { stepRef.current = step; }, [step]);

  // Flush debounced student updates into state
  const flushStudentBuf = useCallback(() => {
    const buf = studentBufRef.current;
    if (Object.keys(buf).length === 0) return;
    setLiveStudents(p => ({ ...p, ...buf }));
    studentBufRef.current = {};
  }, []);

  // Cleanup flush timer on unmount
  useEffect(() => () => { if (flushTimerRef.current) clearTimeout(flushTimerRef.current); }, []);

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
      // Buffer per-student snapshot (debounced to reduce re-renders)
      if (data.student_id) {
        studentBufRef.current[data.student_id] = {
          id: data.student_id,
          step_info: data.step_info || {},
          student_stats: data.student_stats || {},
          experiment_complete: data.experiment_complete || false,
          safety_alert: data.safety_alert || null,
          last_seen: Date.now(),
        };
        if (!flushTimerRef.current) {
          flushTimerRef.current = setTimeout(() => { flushTimerRef.current = null; flushStudentBuf(); }, DEBOUNCE_MS);
        }
      }
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
      if (data.student_id) setLiveStudents(p => { const n = { ...p }; delete n[data.student_id]; return n; });
    } else if (t === 'experiment_reset') {
      setStep(0); setObjects([]); setSafety([]); setLiveStudents({}); studentBufRef.current = {}; pushLog('info', '🔄 Experiment reset');
    } else if (t !== 'heartbeat' && t !== 'pong') {
      if (data.current_step !== undefined) setStep(data.current_step);
      if (data.objects) setObjects(data.objects);
      if (data.detections) setObjects(data.detections);
    }
  }, [pushLog]);

  useEffect(() => { onMsgRef.current = onMsg; }, [onMsg]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    // Close stale socket to prevent memory leaks
    if (wsRef.current) { try { wsRef.current.onclose = null; wsRef.current.close(); } catch {} wsRef.current = null; }
    setWs('connecting');
    try {
      const s = new WebSocket(WS_URL); wsRef.current = s;
      s.onopen = () => { setWs('connected'); if (reconRef.current) { clearTimeout(reconRef.current); reconRef.current = null; } };
      s.onmessage = (e) => { try { onMsgRef.current(JSON.parse(e.data)); setLastMsg(new Date()); } catch {} };
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

  const statusColor = ws === 'connected' ? C.success : ws === 'connecting' ? C.warn : C.danger;

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: C.bg }}>

      {/* ═══ HEADER ═══ */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        borderBottom: `1px solid ${C.border}`,
        background: '#FFFFFF',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <div style={{ maxWidth: 1320, margin: '0 auto', padding: '0 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 8,
                background: C.accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, fontSize: 18, color: '#fff',
              }}>V</div>
              <div>
                <div className="font-pixel" style={{ fontSize: 14, letterSpacing: '0.02em', color: C.text }}>
                  Vocal<span style={{ color: C.accent }}>Lab</span>
                </div>
                <div style={{ fontSize: 10, color: C.dim, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Instructor Dashboard</div>
              </div>
            </div>

            {/* Right side */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Live status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 6, background: ws === 'connected' ? '#F0FDF4' : ws === 'connecting' ? '#FFFBEB' : '#FEF2F2', border: `1px solid ${statusColor}40` }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, letterSpacing: '0.06em' }}>
                  {ws === 'connected' ? 'LIVE' : ws === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
                </span>
              </div>
              {lastMsg && <span style={{ fontSize: 11, color: C.dim, fontWeight: 500 }}>{ago(lastMsg)}</span>}
              {/* AMD */}
              <div style={{
                padding: '5px 12px', borderRadius: 6,
                background: '#EFF6FF',
                border: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700,
                display: 'flex', gap: 6, alignItems: 'center',
              }}>
                <span style={{ color: C.dim, letterSpacing: '0.1em' }}>AMD</span>
                <span style={{ color: C.accent }}>Ryzen™ AI</span>
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
                  background: active ? '#EFF6FF' : 'transparent',
                  color: active ? C.accent : C.dim,
                  border: 'none', borderBottom: `2px solid ${active ? C.accent : 'transparent'}`,
                  transition: 'all 0.2s', whiteSpace: 'nowrap', borderRadius: '6px 6px 0 0',
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
        {tab === 'students' && <StudentsTab liveStudents={liveStudents} />}
        {tab === 'library' && <LibraryTab />}
      </main>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// GLASS CARD
// ═════════════════════════════════════════════════════════════════════════════
function GlassCard({ children, style = {}, danger = false, delay = 0, hover = true, glow = false }) {
  const cls = danger ? 'card-danger' : hover ? 'card' : 'card-static';
  return (
    <div
      className={cls}
      style={{
        padding: 22, position: 'relative', overflow: 'hidden',
        animation: `fadeIn 0.4s ease-out ${delay}s both`,
        ...style,
      }}
    >
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={C.accent}
          strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
        />
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
        <h1 className="font-pixel" style={{ fontSize: 16, color: C.text }}>
          Live Experiment
        </h1>
        <p style={{ fontSize: 14, color: C.dim, marginTop: 6, fontWeight: 500 }}>Real-time progress, detections, and safety monitoring</p>
      </div>

      {/* ── Stat Row ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {[
          { icon: '🔬', label: 'Experiment', value: info?.name || 'Waiting...', color: C.accent },
          { icon: '📍', label: 'Current Step', value: step !== null ? `${step + 1} of ${total}` : '—', color: C.blue },
          { icon: '👁', label: 'Detections', value: objects.length, color: objects.length > 0 ? C.accent : C.dim },
          { icon: '🛡', label: 'Safety', value: safety.length > 0 ? `${safety.length} Alert${safety.length > 1 ? 's' : ''}` : 'Clear', color: safety.length > 0 ? C.danger : C.success },
        ].map((s, i) => (
          <GlassCard key={i} delay={0.05 + i * 0.06} style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 8,
                background: '#EFF6FF',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, flexShrink: 0,
                border: '1px solid #DBEAFE',
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
                      background: done ? C.accent : active ? '#93C5FD' : '#E2E8F0',
                      transition: 'all 0.4s ease',
                    }} />
                    {/* Step label */}
                    <div style={{
                      padding: '10px 12px', borderRadius: 10,
                      background: active ? '#EFF6FF' : '#F8FAFC',
                      border: `1px solid ${active ? '#BFDBFE' : '#E2E8F0'}`,
                      transition: 'all 0.3s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%', fontSize: 10, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          background: done ? C.accent : active ? '#DBEAFE' : '#F1F5F9',
                          color: done ? '#fff' : active ? C.accent : C.dim,
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
                fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                background: '#FEF2F2', color: C.danger,
                border: `1px solid #FECACA`,
              }}>{safety.length} ALERT{safety.length > 1 ? 'S' : ''}</span>
            )}
          </div>
          {safety.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, maxHeight: 240, overflowY: 'auto' }}>
              {safety.map((a, i) => (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8,
                  background: '#FEF2F2', border: '1px solid #FECACA',
                  animation: `slideIn 0.3s ease-out ${i * 0.05}s both`,
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: '#FEE2E2', fontSize: 14, flexShrink: 0,
                  }}>🚨</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.danger }}>{a.msg}</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{fmt(a.time)}</div>
                  </div>
                  <span style={{
                    fontSize: 8, fontWeight: 800, padding: '3px 7px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
                    background: a.sev === 'critical' ? '#FEE2E2' : '#FEF3C7',
                    color: a.sev === 'critical' ? C.danger : '#D97706',
                  }}>{a.sev}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
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
                fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                background: '#EFF6FF', color: C.accent,
                border: '1px solid #BFDBFE',
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
                    padding: '7px 14px', borderRadius: 6,
                    background: '#EFF6FF',
                    border: '1px solid #BFDBFE',
                    color: C.accent, fontSize: 12, fontWeight: 600,
                    animation: `slideIn 0.3s ease-out ${i * 0.04}s both`,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent }} />
                    {label}
                    {conf != null && <span style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace' }}>{(conf * 100).toFixed(0)}%</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>📷</div>
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
              const bgs = { danger: '#FEF2F2', step: '#EFF6FF', success: '#F0FDF4', info: '#F8FAFC' };
              const borders = { danger: C.danger, step: C.accent, success: C.success, info: '#CBD5E1' };
              const c = colors[e.type] || C.dim;
              return (
                <div key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 8,
                  background: bgs[e.type] || '#F8FAFC', borderLeft: `3px solid ${borders[e.type] || '#CBD5E1'}`,
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
            <div style={{ fontSize: 28, marginBottom: 6, opacity: 0.4 }}>📭</div>
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
function StudentsTab({ liveStudents = {} }) {
  const live = Object.values(liveStudents);
  // Derive status from live data
  const students = live.length > 0 ? live.map(st => {
    const ss = st.student_stats || {};
    const si = st.step_info || {};
    const cur = ss.current_step ?? si.current_step ?? 0;
    const tot = ss.total_steps ?? si.total_steps ?? 4;
    const complete = st.experiment_complete || ss.experiment_complete || false;
    const alerts = ss.safety_alerts_count || 0;
    const status = complete ? 'completed' : alerts > 0 ? 'safety_alert' : 'active';
    return { id: st.id, status, step: cur, total: tot, alerts, complete,
      frames: ss.frames_processed || 0, detections: ss.detections_count || 0,
      steps_done: ss.steps_completed || 0,
      time_on_step: ss.time_on_current_step || 0,
      session: ss.session_duration || 0,
      step_name: si.step_name || STEP_NAMES[cur] || `Step ${cur + 1}`,
      last_seen: st.last_seen || Date.now(),
    };
  }) : MOCK_STUDENTS.map(st => ({
    ...st, complete: st.status === 'completed', frames: 0, detections: 0,
    steps_done: st.step, time_on_step: 0, session: 0, step_name: STEP_NAMES[st.step] || '',
    last_seen: Date.now(),
  }));

  // ── Computed summary stats ──
  const summary = useMemo(() => {
    const total = students.length;
    const totalAlerts = students.reduce((a, s) => a + (s.alerts || 0), 0);
    const completed = students.filter(s => s.complete).length;
    const avgPct = total > 0 ? Math.round(students.reduce((a, s) => {
      const p = s.total > 0 ? ((s.step + (s.complete ? 1 : 0)) / s.total) * 100 : 0;
      return a + Math.min(p, 100);
    }, 0) / total) : 0;
    return { total, totalAlerts, completed, avgPct };
  }, [students]);

  const sc = {
    active: { color: C.accent, label: 'Active', bg: '#EFF6FF', borderColor: '#BFDBFE' },
    idle: { color: C.dim, label: 'Idle', bg: '#F8FAFC', borderColor: '#E2E8F0' },
    completed: { color: C.success, label: 'Done', bg: '#F0FDF4', borderColor: '#BBF7D0' },
    safety_alert: { color: C.danger, label: 'Alert', bg: '#FEF2F2', borderColor: '#FECACA' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ animation: 'fadeIn 0.4s ease-out both' }}>
        <h1 className="font-pixel" style={{ fontSize: 16, color: C.text }}>
          Class Overview
        </h1>
        <p style={{ fontSize: 14, color: C.dim, marginTop: 6, fontWeight: 500 }}>
          Monitoring {students.length} student{students.length !== 1 ? 's' : ''}{live.length > 0 ? ' (live)' : ' (demo)'} • 4 languages supported
        </p>
      </div>

      {/* ── Class Summary Panel ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, animation: 'fadeIn 0.4s ease-out 0.05s both' }}>
        {[
          { icon: '👥', label: 'Students', value: summary.total, color: C.accent },
          { icon: '📊', label: 'Avg Progress', value: `${summary.avgPct}%`, color: C.blue },
          { icon: '✅', label: 'Completed', value: summary.completed, color: C.success },
          { icon: '🛡', label: 'Safety Alerts', value: summary.totalAlerts, color: summary.totalAlerts > 0 ? C.danger : C.success },
        ].map((s, i) => (
          <div key={i} className="card-blue-top" style={{ padding: '14px 16px', animation: `fadeIn 0.4s ease-out ${0.08 + i * 0.04}s both` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 8,
                background: '#EFF6FF',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, flexShrink: 0,
                border: '1px solid #DBEAFE',
              }}>{s.icon}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="font-pixel" style={{ fontSize: 7, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8, animation: 'fadeIn 0.4s ease-out 0.1s both' }}>
        {Object.entries(sc).map(([k, v]) => {
          const n = students.filter(s => s.status === k).length;
          return n > 0 ? (
            <div key={k} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6,
              background: v.bg, border: `1px solid ${v.borderColor}`,
              fontSize: 11, fontWeight: 700, color: v.color,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: v.color }} />
              {n} {v.label}
            </div>
          ) : null;
        })}
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(370px, 1fr))', gap: 14 }}>
        {students.map((st, i) => {
          const s = sc[st.status] || sc.idle;
          const pct = st.total > 0 ? Math.round(((st.step + (st.complete ? 1 : 0)) / st.total) * 100) : 0;
          return (
            <GlassCard key={st.id} delay={i * 0.06} danger={st.status === 'safety_alert'}>
              {/* Header: avatar + id + status badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 700, color: '#fff',
                    background: st.complete ? C.success : C.accent,
                    flexShrink: 0,
                  }}>{st.name ? st.name.charAt(0) : st.id.slice(-1)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {st.name || st.id}
                    </div>
                    <div className="font-pixel" style={{ fontSize: 7, color: C.dim }}>{st.id}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {st.alerts > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
                      background: '#FEF2F2', color: C.danger,
                      border: '1px solid #FECACA',
                    }}>⚠ {st.alerts}</span>
                  )}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 6,
                    background: s.bg, border: `1px solid ${s.borderColor}`,
                    fontSize: 11, fontWeight: 700, color: s.color, flexShrink: 0,
                  }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: s.color }} />
                    {s.label}
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 5 }}>
                  <span style={{ color: C.dim, fontWeight: 500 }}>
                    {st.complete ? 'Completed' : st.step_name}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: C.dim }}>Step {st.step + (st.complete ? 1 : 0)}/{st.total}</span>
                    <span style={{ fontWeight: 700, color: st.complete ? C.success : C.accent }}>{Math.min(pct, 100)}%</span>
                  </span>
                </div>
                <div style={{ height: 4, borderRadius: 99, background: '#E2E8F0' }}>
                  <div style={{
                    height: '100%', borderRadius: 99, width: `${Math.min(pct, 100)}%`,
                    background: st.complete ? C.success : C.accent,
                    transition: 'width 0.5s',
                  }} />
                </div>
              </div>

              {/* Metrics row */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6,
                padding: '10px 0 0', borderTop: '1px solid #E2E8F0',
              }}>
                {[
                  { icon: '🎞', label: 'Frames', value: st.frames },
                  { icon: '🔍', label: 'Detections', value: st.detections },
                  { icon: '⏱', label: 'On Step', value: fmtDur(st.time_on_step) },
                  { icon: '🕐', label: 'Session', value: fmtDur(st.session) },
                ].map((m, j) => (
                  <div key={j} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 11, marginBottom: 2 }}>{m.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, transition: 'all 0.3s ease' }}>{m.value}</div>
                    <div style={{ fontSize: 9, color: C.dim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{m.label}</div>
                  </div>
                ))}
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
    Beginner: { color: C.success, bg: '#F0FDF4', borderColor: '#BBF7D0' },
    Intermediate: { color: '#D97706', bg: '#FFFBEB', borderColor: '#FDE68A' },
    Advanced: { color: C.danger, bg: '#FEF2F2', borderColor: '#FECACA' },
  };
  const si = { Chemistry: '⚗️', Physics: '⚡', Biology: '🧬' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ animation: 'fadeIn 0.4s ease-out both' }}>
        <h1 className="font-pixel" style={{ fontSize: 16, color: C.text }}>
          Experiment Library
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
                  padding: '4px 12px', borderRadius: 6,
                  background: '#EFF6FF', border: '1px solid #BFDBFE',
                  fontSize: 10, fontWeight: 700, color: C.accent,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent }} />
                  LIVE
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22,
                  background: '#EFF6FF',
                  border: '1px solid #DBEAFE', flexShrink: 0,
                }}>{si[exp.subject] || '🔬'}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{exp.subject}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exp.name}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
                  background: d.bg, color: d.color,
                  border: `1px solid ${d.borderColor}`,
                }}>{exp.diff}</span>
                <span style={{ fontSize: 11, color: C.dim, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>📋 {exp.steps} steps</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid #E2E8F0' }}>
                <span style={{ fontSize: 11, color: C.dim, fontWeight: 500 }}>
                  {exp.active ? `👥 ${exp.students} students` : 'No sessions'}
                </span>
                <button style={{
                  padding: '8px 18px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  background: exp.active ? C.accent : '#F8FAFC',
                  color: exp.active ? '#fff' : C.dim,
                  border: exp.active ? 'none' : '1px solid #E2E8F0',
                  cursor: 'pointer', transition: 'all 0.2s',
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