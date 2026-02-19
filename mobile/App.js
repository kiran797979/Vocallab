/* ═══════════════════════════════════════════════════════════════════════
   VocalLab — AI Chemistry Lab Instructor (Mobile App v2.0)
   Expo React Native (CameraView API) + WebSocket + Audio + Haptics
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Dimensions, StatusBar, SafeAreaView, ScrollView, ActivityIndicator,
  Platform, Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CAMERA_HEIGHT = SCREEN_H * 0.70;
const PANEL_HEIGHT = SCREEN_H * 0.30;
const DEFAULT_SERVER = '172.20.10.2:8000';

// ── Languages ───────────────────────────────────────────────────
const LANGUAGES = [
  { code: 'hi', label: 'हिंदी', flag: '🇮🇳', name: 'Hindi' },
  { code: 'en', label: 'English', flag: '🇬🇧', name: 'English' },
  { code: 'te', label: 'తెలుగు', flag: '🇮🇳', name: 'Telugu' },
  { code: 'ta', label: 'தமிழ்', flag: '🇮🇳', name: 'Tamil' },
];

// ── Box colours per class ───────────────────────────────────────
const BOX_COLORS = {
  beaker: '#64FF64',
  conical_flask: '#6464FF',
  measuring_cylinder: '#FFC832',
  hand: '#FF96C8',
  lab_manual: '#C8C8C8',
  dropper: '#FF6464',
  petri_dish: '#FF9F43',
  spatula: '#54A0FF',
  glass_rod: '#5F27CD',
  tongs: '#01A3A4',
  volumetric_flask: '#F368E0',
  thermometer: '#6AB04C',
  ph_meter: '#22A6B3',
  hotplate: '#EB4D4B',
  pipette: '#7ED6DF',
  stopwatch: '#DFE6E9',
  test_tube: '#BADC58',
  rubber_stopper: '#F9CA24',
  watch_glass: '#686DE0',
  stirring_rod: '#30336B',
  brush: '#95AFC0',
  analytical_balance: '#E056A0',
};

/* ═════════════════════════════════════════════════════════════════
   MAIN APP COMPONENT
   ═════════════════════════════════════════════════════════════════ */
export default function App() {
  const [screen, setScreen] = useState('home');
  const [serverIP, setServerIP] = useState(DEFAULT_SERVER);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [experimentName, setExperimentName] = useState('');
  const [langIndex, setLangIndex] = useState(0);
  const language = LANGUAGES[langIndex].code;

  // Experiment state
  const [fsmState, setFsmState] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [detectionCount, setDetectionCount] = useState(0);
  const [frameWidth, setFrameWidth] = useState(640);
  const [frameHeight, setFrameHeight] = useState(480);
  const [safetyAlert, setSafetyAlert] = useState(null);
  const [experimentDone, setExperimentDone] = useState(false);
  const [stepNames, setStepNames] = useState([]);

  // Refs
  const wsRef = useRef(null);
  const cameraRef = useRef(null);
  const intervalRef = useRef(null);
  const audioRef = useRef(null);
  const audioPlayingRef = useRef(false);
  const safetyTimerRef = useRef(null);

  // Camera
  const [permission, requestPermission] = useCameraPermissions();

  // ── Audio playback ──────────────────────────────────────────
  const playAudio = useCallback(async (url) => {
    if (audioPlayingRef.current || !url) return;
    try {
      audioPlayingRef.current = true;
      if (audioRef.current) {
        try { await audioRef.current.unloadAsync(); } catch (_) { }
      }
      console.log('[Audio] Playing:', url);
      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true, volume: 1.0 }
      );
      audioRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          audioPlayingRef.current = false;
          sound.unloadAsync().catch(() => { });
        }
      });
    } catch (err) {
      console.warn('[Audio] Playback error:', err);
      audioPlayingRef.current = false;
    }
  }, []);

  // ── Safety alert trigger ────────────────────────────────────
  const triggerSafetyAlert = useCallback((alert) => {
    setSafetyAlert(alert);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => { });
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    safetyTimerRef.current = setTimeout(() => setSafetyAlert(null), 4500);
  }, []);

  // ── Connect to backend (health check) ──────────────────────
  const checkConnection = useCallback(async () => {
    setConnecting(true);
    try {
      const resp = await fetch(`http://${serverIP}/health`, { method: 'GET' });
      const data = await resp.json();
      setConnected(true);
      setExperimentName(data.fsm_state?.experiment_name || 'Acid-Base Titration');
      console.log('[App] Connected to', serverIP);
    } catch (err) {
      setConnected(false);
      Alert.alert('Connection Failed', `Cannot reach ${serverIP}\n\n${err.message}`);
    }
    setConnecting(false);
  }, [serverIP]);

  // ── WebSocket handler ──────────────────────────────────────
  const handleWSMessage = useCallback((event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (err) {
      console.warn('[WS] Parse error:', err);
      return;
    }
    const type = data.type || '';

    // ── WELCOME ────────────────────────────────────
    if (type === 'welcome' || type === 'experiment_loaded') {
      console.log('[App] Welcome:', data.experiment_name);
      if (data.step_names && data.step_names.length > 0) {
        setStepNames(data.step_names);
      }
      // IMMEDIATELY set FSM state → panel shows step info
      if (data.step_info) {
        console.log('[App] Setting fsmState from welcome.step_info');
        setFsmState({
          current_step: data.step_info.current_step ?? 0,
          total_steps: data.step_info.total_steps ?? data.total_steps ?? 4,
          step_name: data.step_info.step_name ?? 'Setup Equipment',
          hint: data.step_info.hint ?? null,
          required_objects: data.step_info.required_objects ?? [],
          detected_required: data.step_info.detected_required ?? [],
          missing_objects: data.step_info.missing_objects ?? [],
          progress: data.step_info.progress ?? 0,
          time_on_step: data.step_info.time_on_step ?? 0,
          step_status: data.step_info.step_status ?? 'active',
          completed: data.step_info.completed ?? false,
        });
      } else {
        setFsmState({
          current_step: data.current_step ?? 0,
          total_steps: data.total_steps ?? 4,
          step_name: (data.step_names && data.step_names[data.current_step ?? 0]) || 'Setup Equipment',
          hint: '', required_objects: [], detected_required: [],
          missing_objects: [], progress: 0, time_on_step: 0,
          step_status: 'active', completed: false,
        });
      }
      return;
    }

    // ── LANGUAGE UPDATED ───────────────────────────
    if (type === 'language_updated') {
      if (data.step_info) {
        setFsmState(prev => prev ? { ...prev, hint: data.step_info.hint ?? prev.hint } : prev);
      }
      return;
    }

    // ── DETECTION RESULT ───────────────────────────
    if (type === 'detection_result') {
      // 1. Bounding boxes
      const dets = data.detections || [];
      setBoxes(dets);
      setDetectionCount(dets.length);

      // 2. Frame dimensions for bbox scaling
      if (data.frame_width) setFrameWidth(data.frame_width);
      if (data.frame_height) setFrameHeight(data.frame_height);

      // 3. FSM state — use data.step_info directly
      if (data.step_info) {
        setFsmState({
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
      }

      // 4. Safety alert
      if (data.safety_alert) {
        triggerSafetyAlert(data.safety_alert);
      }

      // 5. Audio
      if (data.audio_url) {
        const fullUrl = `http://${serverIP}${data.audio_url}`;
        playAudio(fullUrl);
      }

      // 6. Experiment complete
      if (data.experiment_complete) {
        setExperimentDone(true);
      }
      return;
    }

    // ── PONG (ignore) ──────────────────────────────
    if (type === 'pong' || type === 'heartbeat') return;

    console.log('[WS] Unhandled message type:', type);
  }, [serverIP, playAudio, triggerSafetyAlert]);

  // ── Start experiment screen ────────────────────────────────
  const startExperiment = useCallback(() => {
    if (!permission?.granted) {
      requestPermission();
      return;
    }
    setScreen('experiment');
    setFsmState(null);
    setBoxes([]);
    setDetectionCount(0);
    setExperimentDone(false);
    setSafetyAlert(null);
  }, [permission, requestPermission]);

  // ── WebSocket connect + camera capture ─────────────────────
  useEffect(() => {
    if (screen !== 'experiment') return;

    let ws;
    let reconnectTimer;

    const connectWS = () => {
      const url = `ws://${serverIP}/ws/student`;
      console.log('[WS] Connecting:', url);
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] ✅ Connected');
        // Send language preference
        ws.send(JSON.stringify({ type: 'language_change', language }));
      };

      ws.onmessage = handleWSMessage;

      ws.onclose = () => {
        console.log('[WS] Closed — reconnecting in 3s');
        wsRef.current = null;
        reconnectTimer = setTimeout(connectWS, 3000);
      };

      ws.onerror = (err) => {
        console.warn('[WS] Error:', err.message);
      };
    };

    connectWS();

    // Start camera capture interval
    intervalRef.current = setInterval(async () => {
      if (!cameraRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.4,
          imageType: 'jpg',
          skipProcessing: true,
        });
        if (photo?.base64) {
          wsRef.current.send(JSON.stringify({
            type: 'frame',
            data: photo.base64,
            language,
            timestamp: Date.now(),
          }));
        }
      } catch (err) {
        // Camera busy, skip frame
      }
    }, 600);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) { try { ws.close(); } catch (_) { } }
      wsRef.current = null;
      if (audioRef.current) {
        try { audioRef.current.unloadAsync(); } catch (_) { }
      }
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    };
  }, [screen, serverIP, language, handleWSMessage]);

  // ── Send language change when cycling ──────────────────────
  const cycleLanguage = useCallback(() => {
    const nextIdx = (langIndex + 1) % LANGUAGES.length;
    setLangIndex(nextIdx);
    const nextLang = LANGUAGES[nextIdx].code;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'language_change', language: nextLang }));
    }
  }, [langIndex]);

  // ── Go back to home ────────────────────────────────────────
  const goHome = useCallback(() => {
    setScreen('home');
    setFsmState(null);
    setBoxes([]);
    setDetectionCount(0);
    setExperimentDone(false);
    setSafetyAlert(null);
  }, []);

  /* ═══════════════════════════════════════════════════════════
     RENDER — HOME SCREEN
     ═══════════════════════════════════════════════════════════ */
  if (screen === 'home') {
    return (
      <SafeAreaView style={s.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
        <ScrollView contentContainerStyle={s.homeScroll} keyboardShouldPersistTaps="handled">
          {/* Logo */}
          <View style={s.logoArea}>
            <Text style={s.logoEmoji}>🧪</Text>
            <Text style={s.logoText}>
              Vocal<Text style={{ color: '#00d4aa' }}>Lab</Text>
            </Text>
            <Text style={s.subtitle}>Your AI Lab Instructor</Text>
            <Text style={s.langSubtitle}>Hindi • English • Telugu • Tamil</Text>
          </View>

          {/* Server IP */}
          <View style={s.card}>
            <Text style={s.cardLabel}>Server Address</Text>
            <TextInput
              style={s.ipInput}
              value={serverIP}
              onChangeText={setServerIP}
              placeholder="172.20.10.2:8000"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[s.connectBtn, connected && s.connectedBtn]}
              onPress={checkConnection}
              disabled={connecting}
              activeOpacity={0.7}
            >
              {connecting ? (
                <ActivityIndicator color="#0a0a0a" size="small" />
              ) : (
                <Text style={s.connectBtnText}>
                  {connected ? '✅ Connected' : '🔌 Connect'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Experiment card (after connected) */}
          {connected && (
            <View style={s.card}>
              <Text style={s.expTitle}>🔬 {experimentName || 'Acid-Base Titration'}</Text>
              <View style={s.tagRow}>
                <View style={s.tag}><Text style={s.tagText}>Chemistry</Text></View>
                <View style={s.tag}><Text style={s.tagText}>4 Steps</Text></View>
                <View style={s.tag}><Text style={s.tagText}>~15 min</Text></View>
              </View>

              {/* Language selector 2×2 */}
              <Text style={[s.cardLabel, { marginTop: 16 }]}>Language</Text>
              <View style={s.langGrid}>
                {LANGUAGES.map((lang, i) => (
                  <TouchableOpacity
                    key={lang.code}
                    style={[s.langBtn, langIndex === i && s.langBtnActive]}
                    onPress={() => setLangIndex(i)}
                    activeOpacity={0.7}
                  >
                    <Text style={s.langFlag}>{lang.flag}</Text>
                    <Text style={[s.langLabel, langIndex === i && s.langLabelActive]}>
                      {lang.label}
                    </Text>
                    <Text style={s.langName}>{lang.name}</Text>
                    {langIndex === i && <Text style={s.langCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>

              {/* Start button */}
              <TouchableOpacity style={s.startBtn} onPress={startExperiment} activeOpacity={0.8}>
                <Text style={s.startBtnText}>🚀 START EXPERIMENT</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Footer */}
          <Text style={s.footer}>Powered by AMD Ryzen™ AI</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER — EXPERIMENT SCREEN
     ═══════════════════════════════════════════════════════════ */
  const scaleX = SCREEN_W / frameWidth;
  const scaleY = CAMERA_HEIGHT / frameHeight;
  const lang = LANGUAGES[langIndex];

  return (
    <View style={s.expContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* ── Camera (70% height) ─────────────────────────── */}
      <View style={s.cameraWrapper}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFillObject}
          facing="back"
        />

        {/* Overlay — absolute, outside CameraView children */}
        <View style={s.cameraOverlay} pointerEvents="box-none">
          {/* Top bar */}
          <View style={s.topBar}>
            <TouchableOpacity onPress={goHome} style={s.backBtn} activeOpacity={0.7}>
              <Text style={s.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={s.topTitle}>🧪 VocalLab</Text>
            <View style={s.detBadge}>
              <Text style={s.detBadgeText}>👁 {detectionCount}</Text>
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
            const color = BOX_COLORS[det.label] || '#00d4aa';
            const conf = det.confidence ? Math.round(det.confidence * 100) : 0;
            return (
              <View
                key={`box-${i}`}
                style={{
                  position: 'absolute', left, top, width, height,
                  borderWidth: 2, borderColor: color, borderRadius: 4,
                  backgroundColor: `${color}18`,
                }}
              >
                <View style={[s.boxLabel, { backgroundColor: color }]}>
                  <Text style={s.boxLabelText}>{det.label} {conf}%</Text>
                </View>
              </View>
            );
          })}

          {/* Safety alert banner */}
          {safetyAlert && (
            <View style={s.safetyBanner}>
              <Text style={s.safetyText}>
                🚨 {safetyAlert.message || 'Safety Alert!'}
              </Text>
            </View>
          )}

          {/* Experiment complete overlay */}
          {experimentDone && (
            <View style={s.completeOverlay}>
              <Text style={{ fontSize: 64 }}>🎉</Text>
              <Text style={s.completeTitle}>Experiment Complete!</Text>
              <Text style={s.completeSubtitle}>All steps finished successfully</Text>
              <TouchableOpacity style={s.homeBtn} onPress={goHome} activeOpacity={0.8}>
                <Text style={s.homeBtnText}>Back to Home</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* ── Bottom Panel (30% height) ──────────────────── */}
      <ScrollView style={s.bottomPanel} contentContainerStyle={s.bottomContent}>
        {!fsmState ? (
          /* Initializing */
          <View style={s.initBox}>
            <ActivityIndicator color="#00d4aa" size="large" />
            <Text style={s.initText}>Initializing...</Text>
            <Text style={s.initSub}>Point camera at lab equipment</Text>
          </View>
        ) : (
          /* Step info */
          <View style={s.stepInfoBox}>
            {/* Header row: Step X of Y + language button */}
            <View style={s.stepHeaderRow}>
              <Text style={s.stepLabel}>
                Step {(fsmState.current_step ?? 0) + 1} of {fsmState.total_steps ?? 4}
              </Text>
              <TouchableOpacity onPress={cycleLanguage} style={s.langCycleBtn} activeOpacity={0.7}>
                <Text style={s.langCycleText}>{lang.flag} {lang.label}</Text>
              </TouchableOpacity>
            </View>

            {/* Progress bar */}
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${Math.min(fsmState.progress ?? 0, 100)}%` }]} />
            </View>
            <Text style={s.progressText}>{Math.round(fsmState.progress ?? 0)}% Complete</Text>

            {/* Step name */}
            <Text style={s.stepName}>{fsmState.step_name || 'Loading...'}</Text>

            {/* Hint */}
            {fsmState.hint ? (
              <Text style={s.hintText}>{fsmState.hint}</Text>
            ) : null}

            {/* Missing objects bar */}
            {fsmState.missing_objects && fsmState.missing_objects.length > 0 && (
              <View style={s.missingBar}>
                <Text style={s.missingText}>
                  🔍 Need: {fsmState.missing_objects.join(', ')}
                </Text>
              </View>
            )}

            {/* Stats row */}
            <View style={s.statsRow}>
              <Text style={s.statItem}>👁 {detectionCount} objects</Text>
              <Text style={s.statItem}>⏱ {Math.round(fsmState.time_on_step ?? 0)}s</Text>
              <Text style={[s.statItem, { color: fsmState.step_status === 'completed' ? '#22c55e' : '#00d4aa' }]}>
                {fsmState.step_status === 'completed' ? '✅ Done' : '🔄 Active'}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════ */
const s = StyleSheet.create({
  // ── Global ──
  safeArea: { flex: 1, backgroundColor: '#0a0a0a' },
  homeScroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 40 },

  // ── Logo ──
  logoArea: { alignItems: 'center', marginBottom: 32 },
  logoEmoji: { fontSize: 56 },
  logoText: { fontSize: 36, fontWeight: '900', color: '#fff', marginTop: 8 },
  subtitle: { fontSize: 16, color: '#888', marginTop: 6 },
  langSubtitle: { fontSize: 12, color: '#555', marginTop: 4 },

  // ── Card ──
  card: {
    backgroundColor: '#141414', borderRadius: 16, padding: 20,
    marginBottom: 20, borderWidth: 1, borderColor: '#222',
  },
  cardLabel: { fontSize: 12, color: '#888', fontWeight: '700', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 1 },

  // ── IP Input ──
  ipInput: {
    backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14,
    color: '#fff', fontSize: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    borderWidth: 1, borderColor: '#333', marginBottom: 12,
  },

  // ── Connect button ──
  connectBtn: {
    backgroundColor: '#00d4aa', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center',
  },
  connectedBtn: { backgroundColor: '#22c55e' },
  connectBtnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '800' },

  // ── Experiment card ──
  expTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 12 },
  tagRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  tag: {
    backgroundColor: 'rgba(0,212,170,0.12)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(0,212,170,0.25)',
  },
  tagText: { color: '#00d4aa', fontSize: 12, fontWeight: '700' },

  // ── Language grid ──
  langGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  langBtn: {
    width: (SCREEN_W - 48 - 10) / 2, backgroundColor: '#1a1a1a',
    borderRadius: 12, padding: 14, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#333',
  },
  langBtnActive: { borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,0.08)' },
  langFlag: { fontSize: 24 },
  langLabel: { fontSize: 16, fontWeight: '700', color: '#fff', marginTop: 4 },
  langLabelActive: { color: '#00d4aa' },
  langName: { fontSize: 11, color: '#666', marginTop: 2 },
  langCheck: { position: 'absolute', top: 8, right: 10, fontSize: 14, color: '#00d4aa', fontWeight: '800' },

  // ── Start button ──
  startBtn: {
    backgroundColor: '#00d4aa', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 20,
    shadowColor: '#00d4aa', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  startBtnText: { color: '#0a0a0a', fontSize: 18, fontWeight: '900', letterSpacing: 1 },

  // ── Footer ──
  footer: { textAlign: 'center', color: '#444', fontSize: 12, marginTop: 24, fontWeight: '600' },

  // ── Experiment screen ──
  expContainer: { flex: 1, backgroundColor: '#000' },

  // ── Camera ──
  cameraWrapper: { width: SCREEN_W, height: CAMERA_HEIGHT, position: 'relative', overflow: 'hidden' },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 10 },

  // ── Top bar ──
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 50 : 36, paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8 },
  backText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  topTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  detBadge: { backgroundColor: 'rgba(0,212,170,0.25)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  detBadgeText: { color: '#00d4aa', fontSize: 13, fontWeight: '700' },

  // ── Bounding box label ──
  boxLabel: { position: 'absolute', top: -20, left: -1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  boxLabelText: { color: '#000', fontSize: 10, fontWeight: '800' },

  // ── Safety banner ──
  safetyBanner: {
    position: 'absolute', top: Platform.OS === 'ios' ? 100 : 84, left: 16, right: 16,
    backgroundColor: 'rgba(239,68,68,0.92)', borderRadius: 12, padding: 14,
    alignItems: 'center', zIndex: 100, borderWidth: 1, borderColor: '#ff6b6b',
  },
  safetyText: { color: '#fff', fontSize: 16, fontWeight: '800', textAlign: 'center' },

  // ── Complete overlay ──
  completeOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,180,100,0.88)',
    justifyContent: 'center', alignItems: 'center', zIndex: 200,
  },
  completeTitle: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 12 },
  completeSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 16, marginTop: 8 },
  homeBtn: { marginTop: 24, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 },
  homeBtnText: { color: '#0a0a0a', fontSize: 16, fontWeight: '800' },

  // ── Bottom panel ──
  bottomPanel: { height: PANEL_HEIGHT, backgroundColor: '#0a0a0a', borderTopWidth: 1, borderTopColor: '#222' },
  bottomContent: { padding: 16, paddingBottom: 32 },

  // ── Initializing ──
  initBox: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 20 },
  initText: { color: '#00d4aa', fontSize: 18, fontWeight: '700', marginTop: 12 },
  initSub: { color: '#666', fontSize: 13, marginTop: 6 },

  // ── Step info ──
  stepInfoBox: { flex: 1 },
  stepHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  stepLabel: { color: '#aaa', fontSize: 13, fontWeight: '700' },

  // ── Language cycle ──
  langCycleBtn: { backgroundColor: 'rgba(0,212,170,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(0,212,170,0.25)' },
  langCycleText: { color: '#00d4aa', fontSize: 12, fontWeight: '700' },

  // ── Progress bar ──
  progressTrack: { height: 6, backgroundColor: '#1a1a1a', borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  progressFill: { height: '100%', backgroundColor: '#00d4aa', borderRadius: 3 },
  progressText: { color: '#666', fontSize: 11, fontWeight: '600', marginBottom: 8 },

  // ── Step name + hint ──
  stepName: { color: '#00d4aa', fontSize: 17, fontWeight: '800', marginBottom: 4 },
  hintText: { color: '#999', fontSize: 13, lineHeight: 18, marginBottom: 8 },

  // ── Missing objects ──
  missingBar: {
    backgroundColor: 'rgba(255,215,0,0.12)', borderRadius: 8, padding: 10,
    marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
  },
  missingText: { color: '#ffd700', fontSize: 12, fontWeight: '700' },

  // ── Stats row ──
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  statItem: { color: '#666', fontSize: 12, fontWeight: '600' },
});