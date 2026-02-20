/* ═══════════════════════════════════════════════════════════════════════
   VocalLab — AI Chemistry Lab Instructor (Mobile App v3.0)
   Premium UI · Expo React Native · CameraView + WebSocket + Audio + Haptics
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Dimensions, StatusBar, SafeAreaView, ScrollView, ActivityIndicator,
  Platform, Alert, Animated,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

const { width: W, height: H } = Dimensions.get('window');
const CAMERA_H = H * 0.62;
const PANEL_H = H * 0.38;
const DEFAULT_SERVER = '172.20.10.2:8000';

// ── Palette (mirrors dashboard) ─────────────────────────────────────
const C = {
  bg: '#060a13',
  surface: '#0d1424',
  card: '#111827',
  accent: '#00d4aa',
  blue: '#3b82f6',
  purple: '#a855f7',
  danger: '#ef4444',
  success: '#22c55e',
  warn: '#f59e0b',
  text: '#e2e8f0',
  dim: '#64748b',
  muted: '#334155',
  border: 'rgba(255,255,255,0.07)',
  accentBg: 'rgba(0,212,170,0.08)',
  accentBorder: 'rgba(0,212,170,0.22)',
};

// ── Languages ────────────────────────────────────────────────────────
const LANGUAGES = [
  { code: 'hi', label: 'हिंदी', flag: '🇮🇳', name: 'Hindi' },
  { code: 'en', label: 'English', flag: '🇬🇧', name: 'English' },
  { code: 'te', label: 'తెలుగు', flag: '🇮🇳', name: 'Telugu' },
  { code: 'ta', label: 'தமிழ்', flag: '🇮🇳', name: 'Tamil' },
];

// ── Bounding box colours ─────────────────────────────────────────────
const BOX_COLORS = {
  beaker: '#64FF64', conical_flask: '#6464FF', measuring_cylinder: '#FFC832',
  hand: '#FF96C8', lab_manual: '#C8C8C8', dropper: '#FF6464',
  petri_dish: '#FF9F43', spatula: '#54A0FF', glass_rod: '#5F27CD',
  tongs: '#01A3A4', volumetric_flask: '#F368E0', thermometer: '#6AB04C',
  ph_meter: '#22A6B3', hotplate: '#EB4D4B', pipette: '#7ED6DF',
  stopwatch: '#DFE6E9', test_tube: '#BADC58', rubber_stopper: '#F9CA24',
  watch_glass: '#686DE0', stirring_rod: '#30336B', brush: '#95AFC0',
  analytical_balance: '#E056A0',
};

/* ═══════════════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════════════ */
export default function App() {
  const [screen, setScreen] = useState('home');
  const [serverIP, setServerIP] = useState(DEFAULT_SERVER);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [experimentName, setExperimentName] = useState('');
  const [langIndex, setLangIndex] = useState(0);
  const language = LANGUAGES[langIndex].code;

  const [fsmState, setFsmState] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [detectionCount, setDetectionCount] = useState(0);
  const [frameWidth, setFrameWidth] = useState(640);
  const [frameHeight, setFrameHeight] = useState(480);
  const [safetyAlert, setSafetyAlert] = useState(null);
  const [experimentDone, setExperimentDone] = useState(false);
  const [stepNames, setStepNames] = useState([]);

  const wsRef = useRef(null);
  const cameraRef = useRef(null);
  const intervalRef = useRef(null);
  const audioRef = useRef(null);
  const audioPlayingRef = useRef(false);
  const safetyTimerRef = useRef(null);
  const scanAnim = useRef(new Animated.Value(0)).current;

  const [permission, requestPermission] = useCameraPermissions();

  // ── Scan line animation ──────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'experiment') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, { toValue: 1, duration: 2400, useNativeDriver: true }),
        Animated.timing(scanAnim, { toValue: 0, duration: 2400, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [screen, scanAnim]);

  // ── Audio ────────────────────────────────────────────────────────
  const playAudio = useCallback(async (url) => {
    if (audioPlayingRef.current || !url) return;
    try {
      audioPlayingRef.current = true;
      if (audioRef.current) { try { await audioRef.current.unloadAsync(); } catch (_) { } }
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true, volume: 1.0 });
      audioRef.current = sound;
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.didJustFinish) { audioPlayingRef.current = false; sound.unloadAsync().catch(() => { }); }
      });
    } catch (err) {
      console.warn('[Audio]', err);
      audioPlayingRef.current = false;
    }
  }, []);

  // ── Safety alert ─────────────────────────────────────────────────
  const triggerSafetyAlert = useCallback((alert) => {
    setSafetyAlert(alert);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => { });
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    safetyTimerRef.current = setTimeout(() => setSafetyAlert(null), 4500);
  }, []);

  // ── Connect ──────────────────────────────────────────────────────
  const checkConnection = useCallback(async () => {
    setConnecting(true);
    try {
      const resp = await fetch(`http://${serverIP}/health`);
      const data = await resp.json();
      setConnected(true);
      setExperimentName(data.fsm_state?.experiment_name || 'Acid-Base Titration');
    } catch (err) {
      setConnected(false);
      Alert.alert('Connection Failed', `Cannot reach ${serverIP}\n\n${err.message}`);
    }
    setConnecting(false);
  }, [serverIP]);

  // ── WS message handler ───────────────────────────────────────────
  const handleWSMessage = useCallback((event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    const type = data.type || '';

    if (type === 'welcome' || type === 'experiment_loaded') {
      if (data.step_names?.length) setStepNames(data.step_names);
      const si = data.step_info;
      setFsmState(si ? {
        current_step: si.current_step ?? 0,
        total_steps: si.total_steps ?? data.total_steps ?? 4,
        step_name: si.step_name ?? 'Setup Equipment',
        hint: si.hint ?? null,
        required_objects: si.required_objects ?? [],
        detected_required: si.detected_required ?? [],
        missing_objects: si.missing_objects ?? [],
        progress: si.progress ?? 0,
        time_on_step: si.time_on_step ?? 0,
        step_status: si.step_status ?? 'active',
        completed: si.completed ?? false,
      } : {
        current_step: data.current_step ?? 0,
        total_steps: data.total_steps ?? 4,
        step_name: (data.step_names?.[data.current_step ?? 0]) || 'Setup Equipment',
        hint: '', required_objects: [], detected_required: [],
        missing_objects: [], progress: 0, time_on_step: 0,
        step_status: 'active', completed: false,
      });
      return;
    }
    if (type === 'language_updated') {
      if (data.step_info) setFsmState(p => p ? { ...p, hint: data.step_info.hint ?? p.hint } : p);
      return;
    }
    if (type === 'detection_result') {
      const dets = data.detections || [];
      setBoxes(dets); setDetectionCount(dets.length);
      if (data.frame_width) setFrameWidth(data.frame_width);
      if (data.frame_height) setFrameHeight(data.frame_height);
      if (data.step_info) setFsmState({
        current_step: data.step_info.current_step ?? 0,
        total_steps: data.step_info.total_steps ?? 4,
        step_name: data.step_info.step_name ?? 'Processing...',
        hint: data.step_info.hint ?? null,
        required_objects: data.step_info.required_objects ?? [],
        detected_required: data.step_info.detected_required ?? [],
        missing_objects: data.step_info.missing_objects ?? [],
        progress: data.step_info.progress ?? 0,
        time_on_step: data.step_info.time_on_step ?? 0,
        step_status: data.step_info.step_status ?? 'active',
        completed: data.step_info.completed ?? false,
      });
      if (data.safety_alert) triggerSafetyAlert(data.safety_alert);
      if (data.audio_url) playAudio(`http://${serverIP}${data.audio_url}`);
      if (data.experiment_complete) setExperimentDone(true);
      return;
    }
    if (type === 'pong' || type === 'heartbeat') return;
  }, [serverIP, playAudio, triggerSafetyAlert]);

  // ── Start experiment ─────────────────────────────────────────────
  const startExperiment = useCallback(() => {
    if (!permission?.granted) { requestPermission(); return; }
    setScreen('experiment');
    setFsmState(null); setBoxes([]); setDetectionCount(0);
    setExperimentDone(false); setSafetyAlert(null);
  }, [permission, requestPermission]);

  // ── WS + camera capture ──────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'experiment') return;
    let ws, reconnectTimer;
    const connectWS = () => {
      ws = new WebSocket(`ws://${serverIP}/ws/student`);
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'language_change', language }));
      ws.onmessage = handleWSMessage;
      ws.onclose = () => { wsRef.current = null; reconnectTimer = setTimeout(connectWS, 3000); };
      ws.onerror = (e) => console.warn('[WS]', e.message);
    };
    connectWS();
    intervalRef.current = setInterval(async () => {
      if (!cameraRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;
      try {
        const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.4, imageType: 'jpg', skipProcessing: true });
        if (photo?.base64) wsRef.current.send(JSON.stringify({ type: 'frame', data: photo.base64, language, timestamp: Date.now() }));
      } catch (_) { }
    }, 600);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) { try { ws.close(); } catch (_) { } }
      wsRef.current = null;
      if (audioRef.current) { try { audioRef.current.unloadAsync(); } catch (_) { } }
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    };
  }, [screen, serverIP, language, handleWSMessage]);

  // ── Cycle language ───────────────────────────────────────────────
  const cycleLanguage = useCallback(() => {
    const next = (langIndex + 1) % LANGUAGES.length;
    setLangIndex(next);
    wsRef.current?.readyState === WebSocket.OPEN &&
      wsRef.current.send(JSON.stringify({ type: 'language_change', language: LANGUAGES[next].code }));
  }, [langIndex]);

  // ── Go home ──────────────────────────────────────────────────────
  const goHome = useCallback(() => {
    setScreen('home'); setFsmState(null); setBoxes([]);
    setDetectionCount(0); setExperimentDone(false); setSafetyAlert(null);
  }, []);

  /* ────────────────────────────── HOME ────────────────────────────── */
  if (screen === 'home') {
    const lang = LANGUAGES[langIndex];
    return (
      <SafeAreaView style={s.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <ScrollView contentContainerStyle={s.homeScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* ── Hero ── */}
          <View style={s.hero}>
            {/* Glow orb behind */}
            <View style={s.glowOrb} />
            <View style={s.logoIconWrap}>
              <Text style={s.logoIconText}>🧪</Text>
            </View>
            <Text style={s.heroTitle}>
              <Text style={{ color: C.text }}>Vocal</Text>
              <Text style={{ color: C.accent }}>Lab</Text>
            </Text>
            <Text style={s.heroSub}>AI Chemistry Lab Instructor</Text>
            <View style={s.versionChip}>
              <View style={s.versionDot} />
              <Text style={s.versionText}>v2.0 · AMD Ryzen™ AI</Text>
            </View>
          </View>

          {/* ── Server card ── */}
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardIcon}>🔌</Text>
              <Text style={s.cardTitle}>Server Connection</Text>
              {connected && <View style={s.livePill}><View style={s.liveDot} /><Text style={s.liveText}>LIVE</Text></View>}
            </View>
            <TextInput
              style={[s.ipInput, connected && s.ipInputConnected]}
              value={serverIP}
              onChangeText={setServerIP}
              placeholder="192.168.x.x:8000"
              placeholderTextColor={C.dim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="default"
            />
            <TouchableOpacity
              style={[s.connectBtn, connected && s.connectBtnActive]}
              onPress={checkConnection}
              disabled={connecting}
              activeOpacity={0.75}
            >
              {connecting
                ? <ActivityIndicator color={C.bg} size="small" />
                : <Text style={s.connectBtnText}>{connected ? '✅  Connected' : '⚡  Connect'}</Text>
              }
            </TouchableOpacity>
          </View>

          {/* ── Experiment card ── */}
          {connected && (
            <View style={[s.card, { borderColor: C.accentBorder }]}>
              <View style={s.cardHeader}>
                <Text style={s.cardIcon}>🔬</Text>
                <Text style={s.cardTitle}>{experimentName || 'Acid-Base Titration'}</Text>
              </View>

              {/* Tags */}
              <View style={s.tagRow}>
                {['Chemistry', '4 Steps', '~15 min', 'Intermediate'].map(t => (
                  <View key={t} style={s.tag}><Text style={s.tagText}>{t}</Text></View>
                ))}
              </View>

              {/* Divider */}
              <View style={s.divider} />

              {/* Language section */}
              <Text style={s.sectionLabel}>🌐  Language</Text>
              <View style={s.langGrid}>
                {LANGUAGES.map((lng, i) => (
                  <TouchableOpacity
                    key={lng.code}
                    style={[s.langBtn, langIndex === i && s.langBtnActive]}
                    onPress={() => setLangIndex(i)}
                    activeOpacity={0.7}
                  >
                    <Text style={s.langFlag}>{lng.flag}</Text>
                    <Text style={[s.langLabel, langIndex === i && { color: C.accent }]}>{lng.label}</Text>
                    <Text style={s.langName}>{lng.name}</Text>
                    {langIndex === i && <Text style={s.langCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>

              {/* Start CTA */}
              <TouchableOpacity style={s.startBtn} onPress={startExperiment} activeOpacity={0.8}>
                <View style={s.startBtnInner}>
                  <Text style={s.startBtnText}>🚀  START EXPERIMENT</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Features row (when not connected yet) ── */}
          {!connected && (
            <View style={s.featuresRow}>
              {[
                { icon: '👁', label: 'Real-time\nDetection' },
                { icon: '🗣', label: 'Audio\nGuidance' },
                { icon: '🛡', label: 'Safety\nMonitoring' },
                { icon: '🌍', label: '4 Language\nSupport' },
              ].map(f => (
                <View key={f.label} style={s.featureCard}>
                  <Text style={s.featureIcon}>{f.icon}</Text>
                  <Text style={s.featureLabel}>{f.label}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={s.footer}>Powered by AMD Ryzen™ AI · VocalLab v2.0</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ──────────────────────────── EXPERIMENT ────────────────────────── */
  const scaleX = W / frameWidth;
  const scaleY = CAMERA_H / frameHeight;
  const lang = LANGUAGES[langIndex];
  const scanY = scanAnim.interpolate({ inputRange: [0, 1], outputRange: [0, CAMERA_H - 4] });
  const total = fsmState?.total_steps ?? 4;
  const cur = fsmState?.current_step ?? 0;
  const pct = Math.min(fsmState?.progress ?? 0, 100);

  return (
    <View style={s.expContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* ── Camera (62%) ─────────────────────────────────────────── */}
      <View style={s.cameraWrapper}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing="back" />

        {/* Dark vignette */}
        <View style={s.vignette} pointerEvents="none" />

        {/* Scan line */}
        <Animated.View style={[s.scanLine, { transform: [{ translateY: scanY }] }]} pointerEvents="none" />

        {/* Corner brackets (viewfinder) */}
        <View style={s.viewfinderWrap} pointerEvents="none">
          {['tl', 'tr', 'bl', 'br'].map(pos => (
            <View key={pos} style={[s.corner, s[`corner_${pos}`]]} />
          ))}
        </View>

        {/* Overlay (interactive) */}
        <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">

          {/* Top HUD */}
          <View style={s.topHUD}>
            <TouchableOpacity onPress={goHome} style={s.backBtn} activeOpacity={0.7}>
              <Text style={s.backText}>‹ Back</Text>
            </TouchableOpacity>

            <View style={s.topCenter}>
              <Text style={s.topEmoji}>🧪</Text>
              <Text style={s.topTitle}>VocalLab</Text>
            </View>

            <View style={s.detBadge}>
              <View style={s.liveDotSmall} />
              <Text style={s.detText}>{detectionCount} obj</Text>
            </View>
          </View>

          {/* Bounding boxes */}
          {boxes.map((det, i) => {
            const bbox = det.bbox || [];
            if (bbox.length < 4) return null;
            const left = bbox[0] * scaleX;
            const top = bbox[1] * scaleY;
            const width = (bbox[2] - bbox[0]) * scaleX;
            const height = (bbox[3] - bbox[1]) * scaleY;
            const color = BOX_COLORS[det.label] || C.accent;
            const conf = det.confidence ? Math.round(det.confidence * 100) : 0;
            return (
              <View key={`b${i}`} style={{
                position: 'absolute', left, top, width, height,
                borderWidth: 1.5, borderColor: color, borderRadius: 6,
                backgroundColor: `${color}12`
              }}>
                <View style={[s.boxLabel, { backgroundColor: color }]}>
                  <Text style={s.boxLabelText}>{det.label} {conf}%</Text>
                </View>
              </View>
            );
          })}

          {/* Safety alert */}
          {safetyAlert && (
            <View style={s.safetyBanner}>
              <Text style={s.safetyEmoji}>🚨</Text>
              <Text style={s.safetyText}>{safetyAlert.message || 'Safety Alert!'}</Text>
            </View>
          )}

          {/* Experiment complete */}
          {experimentDone && (
            <View style={s.completeOverlay}>
              <Text style={{ fontSize: 72 }}>🎉</Text>
              <Text style={s.completeTitle}>Experiment Complete!</Text>
              <Text style={s.completeSub}>All steps finished successfully</Text>
              <TouchableOpacity style={s.homeBtn} onPress={goHome} activeOpacity={0.8}>
                <Text style={s.homeBtnText}>Back to Home</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* ── Bottom Panel (38%) ───────────────────────────────────── */}
      <View style={s.bottomPanel}>
        {/* Drag handle */}
        <View style={s.dragHandle} />

        <ScrollView contentContainerStyle={s.bottomContent} showsVerticalScrollIndicator={false}>
          {!fsmState ? (
            <View style={s.initBox}>
              <ActivityIndicator color={C.accent} size="large" />
              <Text style={s.initText}>Initializing...</Text>
              <Text style={s.initSub}>Point camera at lab equipment</Text>
            </View>
          ) : (
            <>
              {/* Step dots + lang button */}
              <View style={s.stepHeaderRow}>
                <View style={s.stepDots}>
                  {Array.from({ length: total }).map((_, i) => (
                    <View key={i} style={[s.dot,
                    i < cur && s.dotDone,
                    i === cur && s.dotActive,
                    ]} />
                  ))}
                </View>
                <TouchableOpacity onPress={cycleLanguage} style={s.langPill} activeOpacity={0.7}>
                  <Text style={s.langPillText}>{lang.flag} {lang.label}</Text>
                </TouchableOpacity>
              </View>

              {/* Step name + status */}
              <View style={s.stepNameRow}>
                <View style={[s.stepStatusChip, fsmState.step_status === 'completed' && s.stepStatusDone]}>
                  <Text style={[s.stepStatusText, fsmState.step_status === 'completed' && { color: C.success }]}>
                    {fsmState.step_status === 'completed' ? '✓ Done' : '● Active'}
                  </Text>
                </View>
                <Text style={s.stepCounter}>Step {cur + 1} / {total}</Text>
              </View>
              <Text style={s.stepName}>{fsmState.step_name || 'Loading...'}</Text>

              {/* Progress bar */}
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${pct}%` }]} />
              </View>
              <Text style={s.progressPct}>{Math.round(pct)}% complete</Text>

              {/* Hint */}
              {fsmState.hint ? (
                <View style={s.hintCard}>
                  <Text style={s.hintIcon}>💡</Text>
                  <Text style={s.hintText}>{fsmState.hint}</Text>
                </View>
              ) : null}

              {/* Missing objects */}
              {fsmState.missing_objects?.length > 0 && (
                <View style={s.missingCard}>
                  <Text style={s.missingLabel}>🔍  Still needed:</Text>
                  <View style={s.chipRow}>
                    {fsmState.missing_objects.map((obj, i) => (
                      <View key={i} style={s.chip}>
                        <Text style={s.chipText}>{obj.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Stats row */}
              <View style={s.statsRow}>
                <View style={s.statBox}>
                  <Text style={s.statVal}>{detectionCount}</Text>
                  <Text style={s.statLabel}>Objects</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statBox}>
                  <Text style={s.statVal}>{Math.round(fsmState.time_on_step ?? 0)}s</Text>
                  <Text style={s.statLabel}>On Step</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statBox}>
                  <Text style={[s.statVal, { color: C.accent }]}>{Math.round(pct)}%</Text>
                  <Text style={s.statLabel}>Progress</Text>
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════ */
const CORNER_SIZE = 28;
const CORNER_THICK = 3;
const CORNER_OFFSET = 40;

const s = StyleSheet.create({
  // ── Safe area ──
  safeArea: { flex: 1, backgroundColor: C.bg },
  homeScroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 48 },

  // ── Hero ──
  hero: { alignItems: 'center', marginBottom: 28, paddingTop: 20, position: 'relative' },
  glowOrb: {
    position: 'absolute', top: 0, width: 260, height: 180,
    borderRadius: 130,
    backgroundColor: 'rgba(0,212,170,0.05)',
    // RN doesn't support filter:blur natively, just a soft glow via large borderRadius
  },
  logoIconWrap: {
    width: 76, height: 76, borderRadius: 22,
    backgroundColor: C.surface,
    borderWidth: 1.5, borderColor: C.accentBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35, shadowRadius: 18, elevation: 12,
  },
  logoIconText: { fontSize: 38 },
  heroTitle: { fontSize: 38, fontWeight: '900', letterSpacing: -1, marginBottom: 6 },
  heroSub: { fontSize: 15, color: C.dim, fontWeight: '500', marginBottom: 14 },
  versionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surface, borderRadius: 99,
    paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
  },
  versionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent },
  versionText: { color: C.dim, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  // ── Card ──
  card: {
    backgroundColor: C.surface, borderRadius: 20,
    borderWidth: 1, borderColor: C.border,
    padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  cardIcon: { fontSize: 20 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: C.text, flex: 1 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 16 },
  sectionLabel: { fontSize: 11, color: C.dim, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },

  // ── Live pill ──
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,212,170,0.1)', borderRadius: 99,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: C.accentBorder,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent },
  liveText: { color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },

  // ── IP Input ──
  ipInput: {
    backgroundColor: '#0d1424', borderRadius: 14, padding: 14,
    color: C.text, fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    borderWidth: 1.5, borderColor: C.border, marginBottom: 12,
  },
  ipInputConnected: { borderColor: 'rgba(34,197,94,0.4)' },

  // ── Connect button ──
  connectBtn: {
    backgroundColor: C.accent, borderRadius: 14,
    paddingVertical: 15, alignItems: 'center',
    shadowColor: C.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 8,
  },
  connectBtnActive: { backgroundColor: C.success },
  connectBtnText: { color: C.bg, fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },

  // ── Tags ──
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    backgroundColor: C.accentBg, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: C.accentBorder,
  },
  tagText: { color: C.accent, fontSize: 11, fontWeight: '700' },

  // ── Language grid ──
  langGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  langBtn: {
    width: (W - 40 - 10) / 2, backgroundColor: C.card,
    borderRadius: 14, padding: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: C.border, position: 'relative',
  },
  langBtnActive: { borderColor: C.accent, backgroundColor: C.accentBg },
  langFlag: { fontSize: 26 },
  langLabel: { fontSize: 15, fontWeight: '800', color: C.text, marginTop: 5 },
  langName: { fontSize: 11, color: C.dim, marginTop: 2 },
  langCheck: { position: 'absolute', top: 10, right: 12, fontSize: 13, color: C.accent, fontWeight: '900' },

  // ── Start button ──
  startBtn: {
    borderRadius: 16, marginTop: 20,
    backgroundColor: C.accent,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 14, elevation: 10,
    overflow: 'hidden',
  },
  startBtnInner: { paddingVertical: 17, alignItems: 'center' },
  startBtnText: { color: C.bg, fontSize: 17, fontWeight: '900', letterSpacing: 1.5 },

  // ── Features row ──
  featuresRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  featureCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 16,
    borderWidth: 1, borderColor: C.border,
    padding: 14, alignItems: 'center',
  },
  featureIcon: { fontSize: 24, marginBottom: 8 },
  featureLabel: { color: C.dim, fontSize: 10, fontWeight: '700', textAlign: 'center', lineHeight: 14 },

  // ── Footer ──
  footer: { textAlign: 'center', color: C.muted, fontSize: 11, marginTop: 24, fontWeight: '600' },

  // ── Experiment container ──
  expContainer: { flex: 1, backgroundColor: '#000' },

  // ── Camera ──
  cameraWrapper: { width: W, height: CAMERA_H, position: 'relative', overflow: 'hidden' },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    // Subtle dark edges
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
  },

  // ── Scan line ──
  scanLine: {
    position: 'absolute', left: 0, right: 0, height: 2,
    backgroundColor: 'rgba(0,212,170,0.45)',
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8, shadowRadius: 8,
  },

  // ── Viewfinder corners ──
  viewfinderWrap: { position: 'absolute', inset: 0 },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE, height: CORNER_SIZE,
  },
  corner_tl: {
    top: CORNER_OFFSET, left: CORNER_OFFSET,
    borderTopWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK, borderColor: C.accent,
    borderTopLeftRadius: 4,
  },
  corner_tr: {
    top: CORNER_OFFSET, right: CORNER_OFFSET,
    borderTopWidth: CORNER_THICK, borderRightWidth: CORNER_THICK, borderColor: C.accent,
    borderTopRightRadius: 4,
  },
  corner_bl: {
    bottom: CORNER_OFFSET, left: CORNER_OFFSET,
    borderBottomWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK, borderColor: C.accent,
    borderBottomLeftRadius: 4,
  },
  corner_br: {
    bottom: CORNER_OFFSET, right: CORNER_OFFSET,
    borderBottomWidth: CORNER_THICK, borderRightWidth: CORNER_THICK, borderColor: C.accent,
    borderBottomRightRadius: 4,
  },

  // ── Top HUD ──
  topHUD: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 54 : 36, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(10px)',
  },
  backBtn: {
    paddingVertical: 7, paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  backText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  topCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topEmoji: { fontSize: 16 },
  topTitle: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  detBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.accentBg, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 99, borderWidth: 1, borderColor: C.accentBorder,
  },
  liveDotSmall: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.accent },
  detText: { color: C.accent, fontSize: 12, fontWeight: '700' },

  // ── Box labels ──
  boxLabel: { position: 'absolute', top: -20, left: -1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  boxLabelText: { color: '#000', fontSize: 9, fontWeight: '900' },

  // ── Safety banner ──
  safetyBanner: {
    position: 'absolute', top: Platform.OS === 'ios' ? 106 : 90,
    left: 16, right: 16,
    backgroundColor: 'rgba(239,68,68,0.93)',
    borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: 'rgba(255,100,100,0.4)', zIndex: 100,
  },
  safetyEmoji: { fontSize: 20 },
  safetyText: { color: '#fff', fontSize: 14, fontWeight: '800', flex: 1 },

  // ── Complete overlay ──
  completeOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,20,10,0.92)',
    justifyContent: 'center', alignItems: 'center', zIndex: 200,
  },
  completeTitle: { color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 16, letterSpacing: -0.5 },
  completeSub: { color: 'rgba(255,255,255,0.6)', fontSize: 15, marginTop: 8 },
  homeBtn: {
    marginTop: 28, backgroundColor: C.accent, borderRadius: 14,
    paddingHorizontal: 32, paddingVertical: 14,
  },
  homeBtnText: { color: C.bg, fontSize: 15, fontWeight: '900' },

  // ── Bottom panel ──
  bottomPanel: {
    flex: 1, backgroundColor: C.bg,
    borderTopWidth: 1, borderTopColor: 'rgba(0,212,170,0.12)',
  },
  dragHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: C.muted, alignSelf: 'center', marginTop: 10, marginBottom: 4,
  },
  bottomContent: { paddingHorizontal: 20, paddingBottom: 28 },

  // ── Init ──
  initBox: { alignItems: 'center', paddingVertical: 28 },
  initText: { color: C.accent, fontSize: 17, fontWeight: '800', marginTop: 14 },
  initSub: { color: C.dim, fontSize: 13, marginTop: 6 },

  // ── Step header ──
  stepHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 12 },
  stepDots: { flexDirection: 'row', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.muted },
  dotDone: { backgroundColor: C.accent, width: 8 },
  dotActive: { backgroundColor: C.accent, width: 22, borderRadius: 4 },

  // ── Lang pill ──
  langPill: {
    backgroundColor: C.accentBg, borderRadius: 99,
    paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: C.accentBorder,
  },
  langPillText: { color: C.accent, fontSize: 12, fontWeight: '700' },

  // ── Step name ──
  stepNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  stepStatusChip: {
    backgroundColor: 'rgba(0,212,170,0.1)', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.accentBorder,
  },
  stepStatusDone: { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.3)' },
  stepStatusText: { fontSize: 10, fontWeight: '800', color: C.accent },
  stepCounter: { fontSize: 12, fontWeight: '700', color: C.dim },
  stepName: { fontSize: 18, fontWeight: '900', color: C.text, marginBottom: 10, letterSpacing: -0.4 },

  // ── Progress bar ──
  progressTrack: { height: 5, backgroundColor: C.muted, borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  progressFill: { height: '100%', backgroundColor: C.accent, borderRadius: 3 },
  progressPct: { fontSize: 11, color: C.dim, fontWeight: '700', marginBottom: 10 },

  // ── Hint ──
  hintCard: {
    backgroundColor: 'rgba(59,130,246,0.08)', borderRadius: 12, padding: 12,
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)', marginBottom: 10,
  },
  hintIcon: { fontSize: 16, marginTop: 1 },
  hintText: { color: '#93c5fd', fontSize: 13, lineHeight: 19, flex: 1, fontWeight: '500' },

  // ── Missing objects ──
  missingCard: {
    backgroundColor: 'rgba(245,158,11,0.07)', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)', marginBottom: 10,
  },
  missingLabel: { color: C.warn, fontSize: 11, fontWeight: '800', marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)',
  },
  chipText: { color: C.warn, fontSize: 11, fontWeight: '700' },

  // ── Stats row ──
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, padding: 14,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 20, fontWeight: '900', color: C.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 10, color: C.dim, fontWeight: '700', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, height: 32, backgroundColor: C.border },
});