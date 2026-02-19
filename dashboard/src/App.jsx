import React, { useState, useEffect, useRef, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
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

  const pushLog = useCallback((type, msg) => {
    setLog((p) => [{ id: Date.now() + Math.random(), type, msg, time: new Date() }, ...p].slice(0, MAX_LOG));
  }, []);

  const onMsg = useCallback(
    (data) => {
      const t = data.type || data.event || '';
      const now = new Date();
      console.log('[WS] Message received:', t, data);

      if (t === 'experiment_loaded' || t === 'init') {
        setInfo({ name: data.experiment_name || data.name || 'Acid-Base Titration', steps: data.total_steps || 4 });
        if (data.current_step !== undefined) setStep(data.current_step);
        pushLog('info', `Experiment: ${data.experiment_name || 'Acid-Base Titration'}`);

      } else if (t === 'student_update') {
        // ─── Main real-time update from student frames ───
        if (data.detections) setObjects(data.detections);
        if (data.step_info) {
          const prevStep = step;
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
        if (data.experiment_complete) {
          pushLog('success', '🎉 Experiment completed!');
        }

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
        setStep(0);
        setObjects([]);
        setSafety([]);
        pushLog('info', '🔄 Experiment reset');

      } else if (t === 'heartbeat' || t === 'pong') {
        // Silent

      } else {
        if (data.current_step !== undefined) setStep(data.current_step);
        if (data.objects) setObjects(data.objects);
        if (data.detections) setObjects(data.detections);
      }
    },
    [pushLog, step]
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setWs('connecting');
    console.log('[WS] Connecting to', WS_URL);
    try {
      const s = new WebSocket(WS_URL);
      wsRef.current = s;
      s.onopen = () => {
        setWs('connected');
        if (reconRef.current) {
          clearTimeout(reconRef.current);
          reconRef.current = null;
        }
        console.log('[WS] ✅ Connected');
      };
      s.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          onMsg(d);
          setLastMsg(new Date());
        } catch (err) {
          console.warn('[WS] Parse error', err);
        }
      };
      s.onclose = () => {
        setWs('disconnected');
        wsRef.current = null;
        reconRef.current = setTimeout(connect, RECONNECT_MS);
        console.log('[WS] Disconnected, reconnecting in', RECONNECT_MS, 'ms');
      };
      s.onerror = () => setWs('disconnected');
    } catch (err) {
      setWs('disconnected');
      reconRef.current = setTimeout(connect, RECONNECT_MS);
      console.warn('[WS] Error', err);
    }
  }, [onMsg]);

  useEffect(() => {
    console.log('[App] Mounted');
    connect();
    return () => {
      wsRef.current?.close();
      if (reconRef.current) clearTimeout(reconRef.current);
    };
  }, [connect]);

  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((t) => t + 1), 5000);
    return () => clearInterval(i);
  }, []);

  const tabs = [
    { id: 'live', icon: '🔬', label: 'Live Experiment' },
    { id: 'students', icon: '👥', label: 'Class Overview' },
    { id: 'library', icon: '📚', label: 'Experiment Library' },
  ];

  return (
    <div
      className="min-h-screen min-h-[100dvh] flex flex-col w-full overflow-x-hidden"
      style={{
        background: 'linear-gradient(180deg, #0a0f1e 0%, #0d1321 50%, #0a0f1e 100%)',
        color: '#f1f5f9',
      }}
    >
      {/* ════════ HEADER ════════ */}
      <header
        className="sticky top-0 z-50 shrink-0 w-full"
        style={{
          background: 'rgba(10, 15, 30, 0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid #1e2d3d',
        }}
      >
        {/* Top bar: logo + status + branding */}
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-2 sm:gap-4 h-14 sm:h-16 min-h-[56px]">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <div
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center text-base sm:text-lg font-black shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #00d4aa, #00a389)',
                  color: '#0a0f1e',
                }}
              >
                V
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-base sm:text-lg font-extrabold tracking-tight leading-tight truncate" style={{ color: '#f1f5f9' }}>
                  Vocal<span style={{ color: '#00d4aa' }}>Lab</span>
                </span>
                <span className="text-[10px] sm:text-xs font-medium leading-tight truncate hidden sm:block" style={{ color: '#64748b' }}>Instructor Dashboard</span>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              <div
                className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg min-h-[44px] sm:min-h-0"
                style={{
                  background:
                    ws === 'connected'
                      ? 'rgba(0, 212, 170, 0.12)'
                      : ws === 'connecting'
                        ? 'rgba(251, 191, 36, 0.12)'
                        : 'rgba(239, 68, 68, 0.12)',
                  border: `1px solid ${ws === 'connected' ? 'rgba(0, 212, 170, 0.3)' : ws === 'connecting' ? 'rgba(251, 191, 36, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                }}
              >
                <div
                  className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0"
                  style={{
                    background: ws === 'connected' ? '#00d4aa' : ws === 'connecting' ? '#fbbf24' : '#ef4444',
                    animation:
                      ws === 'connected' ? 'glowPulse 2s ease-in-out infinite' : ws === 'connecting' ? 'blinkDot 1.4s ease-in-out infinite' : 'none',
                  }}
                />
                <span
                  className="text-[10px] sm:text-xs font-bold uppercase tracking-wider"
                  style={{
                    color: ws === 'connected' ? '#00d4aa' : ws === 'connecting' ? '#fbbf24' : '#ef4444',
                  }}
                >
                  {ws === 'connected' ? 'LIVE' : ws === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
                </span>
              </div>
              {lastMsg && (
                <span className="text-xs hidden md:inline whitespace-nowrap" style={{ color: '#64748b' }}>
                  {ago(lastMsg)}
                </span>
              )}
              <div
                className="hidden sm:flex items-center gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg"
                style={{
                  background: 'rgba(0, 212, 170, 0.08)',
                  border: '1px solid rgba(0, 212, 170, 0.2)',
                }}
              >
                <span className="text-[9px] sm:text-[9px] font-semibold tracking-widest" style={{ color: '#64748b' }}>AMD</span>
                <span style={{ color: '#00d4aa', fontSize: '10px', fontWeight: 800 }}>Ryzen™ AI</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tab bar — scrollable on small screens, touch-friendly */}
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" style={{ borderTop: '1px solid #1e2d3d' }}>
          <nav className="flex overflow-x-auto overflow-y-hidden flex-nowrap gap-0 scroll-smooth -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist" style={{ WebkitOverflowScrolling: 'touch' }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  setTab(t.id);
                  console.log('[App] Tab changed to', t.id);
                }}
                className="px-4 sm:px-6 py-3.5 sm:py-4 text-xs sm:text-sm font-semibold flex items-center gap-1.5 sm:gap-2 border-b-2 shrink-0 min-h-[48px] min-w-[120px] sm:min-w-0 transition-colors touch-manipulation"
                style={{
                  color: tab === t.id ? '#00d4aa' : '#94a3b8',
                  borderBottomColor: tab === t.id ? '#00d4aa' : 'transparent',
                  background: tab === t.id ? 'rgba(0, 212, 170, 0.04)' : 'transparent',
                }}
              >
                <span className="opacity-90">{t.icon}</span>
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.id === 'live' ? 'Live' : t.id === 'students' ? 'Class' : 'Library'}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* ════════ MAIN CONTENT ════════ */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8 box-border overflow-x-hidden">
        {tab === 'live' && <LiveTab info={info} step={step} objects={objects} safety={safety} log={log} ws={ws} />}
        {tab === 'students' && <StudentsTab />}
        {tab === 'library' && <LibraryTab />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD WRAPPER — consistent 16px radius, padding, border
// ═══════════════════════════════════════════════════════════════════════════
function Card({ children, className = '', glow = false, danger = false, style = {} }) {
  return (
    <div
      className={`rounded-xl sm:rounded-2xl p-4 sm:p-6 transition-all duration-200 ${className}`}
      style={{
        background: danger ? '#18101f' : '#111828',
        border: `1px solid ${danger ? 'rgba(239, 68, 68, 0.25)' : glow ? 'rgba(0, 212, 170, 0.2)' : '#1e2d3d'}`,
        boxShadow: glow ? '0 0 24px rgba(0, 212, 170, 0.05)' : danger ? '0 0 24px rgba(239, 68, 68, 0.05)' : '0 1px 0 0 rgba(255,255,255,0.03), 0 4px 12px rgba(0,0,0,0.25)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Section card header: title + optional badge (same pattern everywhere)
function SectionHeader({ icon, title, badge, badgeStyle = {} }) {
  return (
    <div className="flex items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-5">
      <h3 className="text-xs sm:text-sm font-bold flex items-center gap-2 shrink-0 min-w-0" style={{ color: '#f1f5f9' }}>
        <span>{icon}</span>
        {title}
      </h3>
      {badge != null && (
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-md shrink-0"
          style={{
            background: 'rgba(0, 212, 170, 0.12)',
            color: '#00d4aa',
            border: '1px solid rgba(0, 212, 170, 0.2)',
            ...badgeStyle,
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STAT CARD — equal height, clear label/value hierarchy
// ═══════════════════════════════════════════════════════════════════════════
function StatCard({ icon, label, value, color = '#00d4aa', delayMs = 0 }) {
  const bgFromRgb = color === '#00d4aa' ? '0, 212, 170' : color === '#ef4444' ? '239, 68, 68' : color === '#22c55e' ? '34, 197, 94' : '100, 116, 139';
  return (
    <div
      className="rounded-xl sm:rounded-2xl p-4 sm:p-5 flex items-center gap-3 sm:gap-4 min-h-[72px] sm:min-h-[88px]"
      style={{
        background: '#111828',
        border: '1px solid #1e2d3d',
        boxShadow: '0 1px 0 0 rgba(255,255,255,0.02), 0 4px 12px rgba(0,0,0,0.2)',
        animation: 'fadeUp 0.4s ease-out both',
        animationDelay: `${delayMs}ms`,
      }}
    >
      <div
        className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl flex items-center justify-center text-base sm:text-lg shrink-0"
        style={{ background: `rgba(${bgFromRgb}, 0.14)` }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider mb-0.5 sm:mb-1 truncate" style={{ color: '#64748b' }}>
          {label}
        </p>
        <p className="text-sm sm:text-base font-bold truncate break-words" style={{ color }}>{value}</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE TAB
// ═══════════════════════════════════════════════════════════════════════════
function LiveTab({ info, step, objects, safety, log, ws }) {
  const total = info?.steps || 4;

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Page title */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: '#f1f5f9' }}>Live Experiment</h1>
        <p className="text-xs sm:text-sm mt-1" style={{ color: '#64748b' }}>Real-time experiment progress, detections, and safety status</p>
      </div>

      {/* Key metrics — responsive grid */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider mb-3 sm:mb-4" style={{ color: '#64748b' }}>Key metrics</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard icon="🔬" label="Experiment" value={info?.name || 'Waiting...'} delayMs={60} />
          <StatCard icon="📍" label="Current Step" value={step !== null ? `${step + 1} of ${total}` : 'Not started'} color="#00d4aa" delayMs={120} />
          <StatCard icon="👁️" label="Detections" value={objects.length.toString()} color={objects.length > 0 ? '#00d4aa' : '#64748b'} delayMs={180} />
          <StatCard icon="🛡️" label="Safety Alerts" value={safety.length.toString()} color={safety.length > 0 ? '#ef4444' : '#22c55e'} delayMs={240} />
        </div>
      </section>

      {/* Two-column layout — stacks on mobile/tablet */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4 sm:gap-6">
        {/* Left column: Steps + Detections */}
        <div className="xl:col-span-5 space-y-4 sm:space-y-6">
          <Card glow style={{ animation: 'fadeUp 0.4s ease-out both', animationDelay: '0.08s' }}>
            <SectionHeader
              icon="📋"
              title="Step Timeline"
              badge={step !== null ? `${Math.round(((step + 1) / total) * 100)}%` : null}
            />

            <div className="space-y-0">
              {STEP_NAMES.map((name, i) => {
                const done = step !== null && i < step;
                const active = step !== null && i === step;
                return (
                  <div key={i} className="flex gap-3 sm:gap-4">
                    <div className="flex flex-col items-center">
                      <div
                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold shrink-0 transition-all duration-500"
                        style={{
                          background: done ? '#00d4aa' : active ? 'rgba(0, 212, 170, 0.18)' : '#1a2332',
                          color: done ? '#0a0f1e' : active ? '#00d4aa' : '#64748b',
                          border: active ? '2px solid #00d4aa' : done ? 'none' : '1px solid #2a3444',
                          boxShadow: active ? '0 0 0 4px rgba(0, 212, 170, 0.2)' : 'none',
                          animation: active ? 'glowPulse 2s ease-in-out infinite' : 'none',
                        }}
                      >
                        {done ? '✓' : i + 1}
                      </div>
                      {i < STEP_NAMES.length - 1 && (
                        <div
                          className="w-0.5 h-6 sm:h-8 rounded-full"
                          style={{ background: done ? '#00d4aa' : '#1e2d3d' }}
                        />
                      )}
                    </div>
                    <div className="pt-1.5 sm:pt-2 pb-3 sm:pb-4">
                      <p
                        className="text-xs sm:text-sm font-semibold"
                        style={{
                          color: active ? '#00d4aa' : done ? '#64748b' : '#94a3b8',
                          textDecoration: done ? 'line-through' : 'none',
                        }}
                      >
                        {name}
                      </p>
                      {active && (
                        <p className="text-xs mt-1" style={{ color: '#00d4aa' }}>
                          🔄 In Progress...
                        </p>
                      )}
                      {done && (
                        <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                          ✓ Done
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {step === null && (
              <div className="text-center pt-3 sm:pt-4 mt-2" style={{ borderTop: '1px solid #1e2d3d' }}>
                <p className="text-xs sm:text-sm" style={{ color: '#64748b' }}>⏳ Waiting for student...</p>
              </div>
            )}
          </Card>

          <Card glow style={{ animation: 'fadeUp 0.4s ease-out both', animationDelay: '0.12s' }}>
            <SectionHeader icon="👁️" title="Detected Objects" />
            {objects.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {objects.map((obj, i) => {
                  const label = typeof obj === 'string' ? obj : obj.label || obj.name || obj.class || 'unknown';
                  const conf = typeof obj === 'object' ? obj.confidence || obj.conf : null;
                  return (
                    <div
                      key={`${label}-${i}`}
                      className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-xs sm:text-sm font-semibold"
                      style={{
                        background: 'rgba(0, 212, 170, 0.1)',
                        border: '1px solid rgba(0, 212, 170, 0.22)',
                        color: '#00d4aa',
                        animation: 'slideIn 0.35s ease-out both',
                        animationDelay: `${i * 0.05}s`,
                      }}
                    >
                      {label}
                      {conf != null && (
                        <span className="text-xs font-mono" style={{ color: '#64748b' }}>
                          {(conf * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6 sm:py-8">
                <div className="text-3xl sm:text-4xl mb-2 sm:mb-3 opacity-40">📷</div>
                <p className="text-xs sm:text-sm font-medium" style={{ color: '#64748b' }}>No objects detected</p>
                <p className="text-[10px] sm:text-xs mt-1" style={{ color: '#475569' }}>Point phone camera at lab equipment</p>
              </div>
            )}
          </Card>
        </div>

        {/* Right column: Safety + Event Log */}
        <div className="xl:col-span-7 space-y-4 sm:space-y-6">
          <Card danger={safety.length > 0} glow={safety.length === 0} style={{ animation: 'fadeUp 0.4s ease-out both', animationDelay: '0.08s' }}>
            <div className="flex items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-5 flex-wrap">
              <h3 className="text-xs sm:text-sm font-bold flex items-center gap-2 shrink-0" style={{ color: '#f1f5f9' }}>🛡️ Safety Alerts</h3>
              {safety.length > 0 ? (
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className="text-xs font-bold px-2.5 py-1 rounded-md"
                    style={{
                      background: 'rgba(239, 68, 68, 0.18)',
                      color: '#ef4444',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                    }}
                  >
                    {safety.length}
                  </span>
                  <span className="text-xs font-bold" style={{ color: '#ef4444', animation: 'blinkDot 1.4s ease-in-out infinite' }}>⚠ ATTENTION</span>
                </div>
              ) : null}
            </div>

            {safety.length > 0 ? (
              <div className="space-y-3 max-h-48 sm:max-h-60 md:max-h-72 overflow-y-auto pr-1">
                {safety.map((a, i) => (
                  <div
                    key={a.id}
                    className="flex items-start gap-2 sm:gap-3 p-3 sm:p-4 rounded-lg sm:rounded-xl"
                    style={{
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.18)',
                      animation: 'slideIn 0.35s ease-out both',
                      animationDelay: `${(i + 1) * 0.06}s`,
                    }}
                  >
                    <div
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 text-xs sm:text-sm"
                      style={{ background: 'rgba(239, 68, 68, 0.18)' }}
                    >
                      🚨
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-semibold break-words" style={{ color: '#fca5a5' }}>{a.msg}</p>
                      <p className="text-[10px] sm:text-xs mt-0.5 sm:mt-1" style={{ color: '#64748b' }}>{fmt(a.time)}</p>
                    </div>
                    <span
                      className="text-[10px] sm:text-xs font-bold uppercase px-1.5 sm:px-2 py-0.5 rounded shrink-0"
                      style={{
                        background: a.sev === 'critical' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(249, 115, 22, 0.2)',
                        color: a.sev === 'critical' ? '#fca5a5' : '#fdba74',
                      }}
                    >
                      {a.sev}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 sm:py-10">
                <div className="text-4xl sm:text-5xl mb-2 sm:mb-3">✅</div>
                <p className="text-xs sm:text-sm font-bold" style={{ color: '#22c55e' }}>All Clear</p>
                <p className="text-[10px] sm:text-xs mt-1" style={{ color: '#64748b' }}>Student is following safety protocol</p>
              </div>
            )}
          </Card>

          <Card glow style={{ animation: 'fadeUp 0.4s ease-out both', animationDelay: '0.12s' }}>
            <SectionHeader icon="📜" title="Event Log" badge={log.length > 0 ? `${log.length} events` : null} badgeStyle={{ background: 'rgba(100, 116, 139, 0.15)', color: '#94a3b8', border: '1px solid rgba(100, 116, 139, 0.25)' }} />

            {log.length > 0 ? (
              <div className="space-y-2 max-h-56 sm:max-h-64 md:max-h-80 overflow-y-auto pr-1">
                {log.map((e, i) => {
                  const colors = { danger: '#ef4444', step: '#00d4aa', success: '#22c55e', info: '#64748b' };
                  const icons = { danger: '🚨', step: '📍', success: '🎉', info: 'ℹ️' };
                  const c = colors[e.type] || '#64748b';
                  const r = c === '#ef4444' ? '239, 68, 68' : c === '#00d4aa' ? '0, 212, 170' : c === '#22c55e' ? '34, 197, 94' : '100, 116, 139';
                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl"
                      style={{
                        background: `rgba(${r}, 0.08)`,
                        borderLeft: `3px solid ${c}`,
                        animation: 'slideIn 0.35s ease-out both',
                        animationDelay: `${Math.min(i + 1, 5) * 0.06}s`,
                      }}
                    >
                      <span className="text-[10px] sm:text-xs shrink-0">{icons[e.type] || 'ℹ️'}</span>
                      <span className="flex-1 text-xs sm:text-sm truncate min-w-0" style={{ color: '#e2e8f0' }}>{e.msg}</span>
                      <span className="text-[10px] sm:text-xs font-mono shrink-0" style={{ color: '#64748b' }}>{fmt(e.time)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 sm:py-10">
                <div className="text-3xl sm:text-4xl mb-2 sm:mb-3 opacity-40">📭</div>
                <p className="text-xs sm:text-sm font-medium" style={{ color: '#64748b' }}>No events yet</p>
                <p className="text-[10px] sm:text-xs mt-1" style={{ color: '#475569' }}>Events appear when the experiment starts</p>
              </div>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STUDENTS TAB
// ═══════════════════════════════════════════════════════════════════════════
function StudentsTab() {
  const sc = {
    active: { bg: 'rgba(0, 212, 170, 0.12)', color: '#00d4aa', dot: '#00d4aa', label: 'Active' },
    idle: { bg: 'rgba(100, 116, 139, 0.12)', color: '#64748b', dot: '#64748b', label: 'Idle' },
    completed: { bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e', dot: '#22c55e', label: 'Done' },
    safety_alert: { bg: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', dot: '#ef4444', label: 'Alert' },
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: '#f1f5f9' }}>Class Overview</h1>
          <p className="text-xs sm:text-sm mt-1" style={{ color: '#64748b' }}>
            Monitoring {MOCK_STUDENTS.length} students • 4 languages supported
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(sc).map(([k, v]) => {
            const n = MOCK_STUDENTS.filter((s) => s.status === k).length;
            return n > 0 ? (
              <div
                key={k}
                className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg min-h-[40px] sm:min-h-0"
                style={{ background: v.bg, border: `1px solid ${v.color}40` }}
              >
                <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0" style={{ background: v.dot }} />
                <span className="text-[10px] sm:text-xs font-bold" style={{ color: v.color }}>{n} {v.label}</span>
              </div>
            ) : null;
          })}
        </div>
      </div>

      {/* Student cards grid */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider mb-3 sm:mb-4" style={{ color: '#64748b' }}>Students</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
          {MOCK_STUDENTS.map((st, i) => {
            const s = sc[st.status] || sc.idle;
            const pct = Math.round((st.step / st.total) * 100);
            return (
              <div
                key={st.id}
                className="rounded-xl sm:rounded-2xl p-4 sm:p-6 transition-all duration-300"
                style={{
                  background: '#111828',
                  border: '1px solid #1e2d3d',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  animation: 'fadeUp 0.5s ease-out both',
                  animationDelay: `${(i + 1) * 0.06}s`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(0, 212, 170, 0.35)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#1e2d3d';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-4 sm:mb-5 flex-wrap">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <div
                      className="w-9 h-9 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold shrink-0"
                      style={{
                        color: '#f1f5f9',
                        background: 'linear-gradient(135deg, rgba(0, 212, 170, 0.35), rgba(59, 130, 246, 0.35))',
                      }}
                    >
                      {st.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-bold truncate" style={{ color: '#f1f5f9' }}>{st.name}</p>
                      <p className="text-[10px] sm:text-xs font-mono truncate" style={{ color: '#64748b' }}>{st.id}</p>
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full shrink-0"
                    style={{ background: s.bg, border: `1px solid ${s.color}33` }}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: s.dot,
                        animation: st.status === 'active' ? 'blinkDot 1.4s ease-in-out infinite' : 'none',
                      }}
                    />
                    <span className="text-xs font-bold" style={{ color: s.color }}>{s.label}</span>
                  </div>
                </div>

                <div className="mb-3 sm:mb-4">
                  <div className="flex justify-between text-[10px] sm:text-xs mb-1.5 sm:mb-2">
                    <span style={{ color: '#64748b' }}>Step {st.step} / {st.total}</span>
                    <span className="font-bold" style={{ color: '#00d4aa' }}>{pct}%</span>
                  </div>
                  <div className="w-full h-1.5 sm:h-2 rounded-full" style={{ background: '#1a2332' }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #00d4aa, #00a389)' }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] sm:text-xs font-medium" style={{ color: '#64748b' }}>🌐 {st.lang}</span>
                  {st.alerts > 0 && (
                    <div
                      className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg"
                      style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                    >
                      <span className="text-[10px] sm:text-xs">⚠️</span>
                      <span className="text-[10px] sm:text-xs font-bold" style={{ color: '#ef4444' }}>
                        {st.alerts} alert{st.alerts > 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LIBRARY TAB
// ═══════════════════════════════════════════════════════════════════════════
function LibraryTab() {
  const dc = {
    Beginner: { color: '#22c55e', rgb: '34, 197, 94' },
    Intermediate: { color: '#eab308', rgb: '234, 179, 8' },
    Advanced: { color: '#ef4444', rgb: '239, 68, 68' },
  };
  const si = { Chemistry: '⚗️', Physics: '⚡', Biology: '🧬' };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: '#f1f5f9' }}>Experiment Library</h1>
        <p className="text-xs sm:text-sm mt-1" style={{ color: '#64748b' }}>
          {EXPERIMENTS.length} experiments • {EXPERIMENTS.filter((e) => e.active).length} live now
        </p>
      </div>

      {/* Experiment cards grid */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider mb-3 sm:mb-4" style={{ color: '#64748b' }}>All experiments</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
          {EXPERIMENTS.map((exp, i) => {
            const diffStyle = dc[exp.diff] || { color: '#64748b', rgb: '100, 116, 139' };
            const color = diffStyle.color;
            return (
              <div
                key={exp.id}
                className="rounded-xl sm:rounded-2xl p-4 sm:p-6 relative overflow-hidden transition-all duration-300"
                style={{
                  background: '#111828',
                  border: `1px solid ${exp.active ? 'rgba(0, 212, 170, 0.3)' : '#1e2d3d'}`,
                  boxShadow: exp.active ? '0 0 20px rgba(0, 212, 170, 0.06)' : '0 1px 3px rgba(0,0,0,0.2)',
                  animation: 'fadeUp 0.5s ease-out both',
                  animationDelay: `${(i + 1) * 0.06}s`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(0, 212, 170, 0.4)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = exp.active ? 'rgba(0, 212, 170, 0.3)' : '#1e2d3d';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = exp.active ? '0 0 20px rgba(0, 212, 170, 0.06)' : '0 1px 3px rgba(0,0,0,0.2)';
                }}
              >
                {exp.active && (
                  <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
                    <span
                      className="flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold"
                      style={{
                        background: 'rgba(0, 212, 170, 0.15)',
                        color: '#00d4aa',
                        border: '1px solid rgba(0, 212, 170, 0.3)',
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: '#00d4aa', animation: 'blinkDot 1.4s ease-in-out infinite' }}
                      />
                      LIVE
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-5">
                  <div
                    className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg sm:rounded-xl flex items-center justify-center text-xl sm:text-2xl shrink-0"
                    style={{ background: '#1a2332' }}
                  >
                    {si[exp.subject] || '🔬'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest" style={{ color: '#64748b' }}>
                      {exp.subject}
                    </p>
                    <h3 className="text-sm sm:text-base font-bold mt-0.5 truncate" style={{ color: '#f1f5f9' }}>{exp.name}</h3>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-5 flex-wrap">
                  <span
                    className="text-[10px] sm:text-xs font-bold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full"
                    style={{
                      background: `rgba(${diffStyle.rgb}, 0.12)`,
                      color: diffStyle.color,
                      border: `1px solid rgba(${diffStyle.rgb}, 0.35)`,
                    }}
                  >
                    {exp.diff}
                  </span>
                  <span className="text-[10px] sm:text-xs" style={{ color: '#64748b' }}>📋 {exp.steps} steps</span>
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 sm:pt-4 flex-wrap" style={{ borderTop: '1px solid #1e2d3d' }}>
                  <span className="text-[10px] sm:text-xs" style={{ color: '#64748b' }}>
                    {exp.active ? `👥 ${exp.students} students` : 'No sessions'}
                  </span>
                  <button
                    className="text-xs font-bold px-3 sm:px-4 py-2 rounded-lg transition-all duration-200 min-h-[44px] touch-manipulation"
                    style={{
                      background: exp.active ? '#00d4aa' : '#1a2332',
                      color: exp.active ? '#0a0f1e' : '#64748b',
                      border: exp.active ? 'none' : '1px solid #2a3444',
                    }}
                    onMouseEnter={(e) => {
                      if (!exp.active) {
                        e.currentTarget.style.background = '#2a3444';
                        e.currentTarget.style.color = '#f1f5f9';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!exp.active) {
                        e.currentTarget.style.background = '#1a2332';
                        e.currentTarget.style.color = '#64748b';
                      }
                    }}
                  >
                    {exp.active ? 'View Live →' : 'Start'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
