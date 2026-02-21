/* ═══════════════════════════════════════════════════════════════════════
   VocalLab — AI Chemistry Lab Instructor (Mobile App v3.3)
   Premium UI · Expo SDK 52 · RN-COMPATIBLE
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Dimensions, StatusBar, SafeAreaView, ScrollView,
  ActivityIndicator, Platform, Alert, Animated,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import Constants from 'expo-constants';

const { width: W, height: H } = Dimensions.get('window');
const CAMERA_H = H * 0.62;
const CONFIG_SVR = Constants.expoConfig?.extra?.backendUrl?.replace('http://', '') || '172.20.10.2:8000';
const DEFAULT_SVR = CONFIG_SVR;

// ── Palette ─────────────────────────────────────────────────────────
const C = {
  bg: '#060a13',
  surface: '#0d1424',
  card: '#111827',
  accent: '#00d4aa',
  blue: '#3b82f6',
  danger: '#ef4444',
  success: '#22c55e',
  warn: '#f59e0b',
  text: '#e2e8f0',
  dim: '#64748b',
  muted: '#334155',
  border: 'rgba(255,255,255,0.07)',
  accentBg: 'rgba(0,212,170,0.08)',
  accentBord: 'rgba(0,212,170,0.22)',
};

// ── Languages ────────────────────────────────────────────────────────
const LANGS = [
  { code: 'hi', label: 'हिंदी', flag: '🇮🇳', name: 'Hindi' },
  { code: 'en', label: 'English', flag: '🇬🇧', name: 'English' },
  { code: 'te', label: 'తెలుగు', flag: '🇮🇳', name: 'Telugu' },
  { code: 'ta', label: 'தமிழ்', flag: '🇮🇳', name: 'Tamil' },
];

// ── Box colors ──────────────────────────────────────────────────────
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

export default function App() {
  const [screen, setScreen] = useState('home');
  const [serverIP, setServerIP] = useState(DEFAULT_SVR);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [expName, setExpName] = useState('');
  const [langIdx, setLangIdx] = useState(0);

  const [fsmState, setFsmState] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [detCount, setDetCount] = useState(0);
  const [frameSize, setFrameSize] = useState({ w: 640, h: 480 });
  const [safetyAlert, setSafetyAlert] = useState(null);
  const [expDone, setExpDone] = useState(false);

  const wsRef = useRef(null);
  const camRef = useRef(null);
  const loopRef = useRef(null);
  const audioRef = useRef(null);
  const isAudioPlaying = useRef(false);
  const safetyTimeout = useRef(null);
  const scanAnim = useRef(new Animated.Value(0)).current;

  const [permission, requestPermission] = useCameraPermissions();
  const lang = LANGS[langIdx];

  // ── Animations ───────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'experiment') {
      scanAnim.setValue(0);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, { toValue: 1, duration: 2400, useNativeDriver: true }),
        Animated.timing(scanAnim, { toValue: 0, duration: 2400, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [screen]);

  // ── Audio ────────────────────────────────────────────────────────
  const playAudio = useCallback(async (url) => {
    if (isAudioPlaying.current || !url) return;
    try {
      isAudioPlaying.current = true;
      if (audioRef.current) {
        try { await audioRef.current.unloadAsync(); } catch (err) { }
      }
      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true, volume: 1.0 }
      );
      audioRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          isAudioPlaying.current = false;
          sound.unloadAsync().catch(() => { });
        }
      });
    } catch (e) {
      console.warn('[Audio Error]', e);
      isAudioPlaying.current = false;
    }
  }, []);

  // ── Safety Notifications ──────────────────────────────────────────
  const showSafetyAlert = useCallback((alert) => {
    if (!alert) return;
    setSafetyAlert(alert);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => { });
    if (safetyTimeout.current) clearTimeout(safetyTimeout.current);
    safetyTimeout.current = setTimeout(() => setSafetyAlert(null), 5000);
  }, []);

  // ── Step Parsing ──────────────────────────────────────────────────
  const formatStep = (info, fallback = {}) => ({
    current_step: info?.current_step ?? fallback.current_step ?? 0,
    total_steps: info?.total_steps ?? fallback.total_steps ?? 4,
    step_name: info?.step_name ?? fallback.step_name ?? 'Experiment Setup',
    hint: info?.hint ?? null,
    required_objects: info?.required_objects ?? [],
    detected_required: info?.detected_required ?? [],
    missing_objects: info?.missing_objects ?? [],
    progress: info?.progress ?? 0,
    time_on_step: info?.time_on_step ?? 0,
    step_status: info?.step_status ?? 'active',
  });

  // ── Server Connection ──────────────────────────────────────────────
  const testConnection = useCallback(async () => {
    setConnecting(true);
    try {
      const resp = await fetch(`http://${serverIP}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      const data = await resp.json();
      setConnected(true);
      setExpName(data.fsm_state?.experiment_name || 'Chemistry Experiment');
    } catch (e) {
      setConnected(false);
      Alert.alert('Connection Error', `Unable to reach ${serverIP}. Ensure server is running and device is on the same network.`);
    } finally {
      setConnecting(false);
    }
  }, [serverIP]);

  // ── WebSocket Messages ─────────────────────────────────────────────
  const onWSMessage = useCallback((evt) => {
    if (!evt.data) return;
    let msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }

    switch (msg.type) {
      case 'welcome':
      case 'experiment_loaded':
        setFsmState(formatStep(msg.step_info, { current_step: msg.current_step, total_steps: msg.total_steps }));
        break;
      case 'language_updated':
        if (msg.step_info) {
          setFsmState(prev => prev ? { ...prev, hint: msg.step_info.hint || prev.hint } : prev);
        }
        break;
      case 'detection_result':
        const detections = msg.detections || [];
        setBoxes(detections);
        setDetCount(detections.length);
        if (msg.frame_width) setFrameSize(s => ({ ...s, w: msg.frame_width }));
        if (msg.frame_height) setFrameSize(s => ({ ...s, h: msg.frame_height }));
        if (msg.step_info) setFsmState(formatStep(msg.step_info));
        if (msg.safety_alert) showSafetyAlert(msg.safety_alert);
        if (msg.audio_url) playAudio(`http://${serverIP}${msg.audio_url}`);
        if (msg.experiment_complete) setExpDone(true);
        break;
    }
  }, [serverIP, playAudio, showSafetyAlert]);

  // ── Navigation ─────────────────────────────────────────────────────
  const startExperiment = useCallback(async () => {
    let stat = permission;
    if (!stat?.granted) stat = await requestPermission();
    if (!stat?.granted) {
      Alert.alert('Permission Denied', 'VocalLab requires camera access to guide you through the experiment.');
      return;
    }
    setScreen('experiment');
    setFsmState(null);
    setBoxes([]);
    setDetCount(0);
    setExpDone(false);
    setSafetyAlert(null);
  }, [permission, requestPermission]);

  const goHome = useCallback(() => {
    setScreen('home');
    setFsmState(null);
    setBoxes([]);
    setDetCount(0);
    setExpDone(false);
    setSafetyAlert(null);
  }, []);

  // ── Camera Loop & WS ──────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'experiment') return;
    let wsInstance;
    let isProcessingFrame = false;

    const initWS = () => {
      try {
        wsInstance = new WebSocket(`ws://${serverIP}/ws/student`);
        wsRef.current = wsInstance;
        wsInstance.onopen = () => {
          if (wsInstance.readyState === 1) {
            wsInstance.send(JSON.stringify({ type: 'language_change', language: lang.code }));
          }
        };
        wsInstance.onmessage = onWSMessage;
        wsInstance.onclose = () => {
          wsRef.current = null;
          setTimeout(initWS, 3000);
        };
        wsInstance.onerror = (e) => console.warn('[WS Error]', e.message);
      } catch (err) {
        console.error('[WS Init Fail]', err);
        setTimeout(initWS, 3000);
      }
    };

    initWS();

    const captureFrame = async () => {
      if (screen !== 'experiment') return;
      if (camRef.current && wsRef.current?.readyState === 1 && !isProcessingFrame) {
        isProcessingFrame = true;
        try {
          const photo = await camRef.current.takePictureAsync({ base64: true, quality: 0.3, skipProcessing: true });
          if (photo?.base64 && wsRef.current?.readyState === 1) {
            wsRef.current.send(JSON.stringify({
              type: 'frame',
              data: photo.base64,
              language: lang.code,
              timestamp: Date.now()
            }));
          }
        } catch (e) {
          console.warn('[Camera Capture Error]', e.message);
        } finally {
          isProcessingFrame = false;
        }
      }
      loopRef.current = setTimeout(captureFrame, 700);
    };

    loopRef.current = setTimeout(captureFrame, 1200);

    return () => {
      clearTimeout(loopRef.current);
      if (wsInstance) { try { wsInstance.close(); } catch (e) { } }
      wsRef.current = null;
      if (audioRef.current) { try { audioRef.current.unloadAsync(); } catch (e) { } }
      if (safetyTimeout.current) clearTimeout(safetyTimeout.current);
    };
  }, [screen, serverIP, lang.code, onWSMessage]);

  const toggleLanguage = useCallback(() => {
    const nextIdx = (langIdx + 1) % LANGS.length;
    setLangIdx(nextIdx);
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'language_change', language: LANGS[nextIdx].code }));
    }
  }, [langIdx]);

  /* ─────────────────────────── RENDER HOME ────────────────────────── */
  if (screen === 'home') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <ScrollView contentContainerStyle={styles.homeScroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.hero}>
            <View style={styles.heroBg} />
            <View style={styles.logoBox}>
              <Text style={styles.logoEmoji}>🧪</Text>
            </View>
            <Text style={styles.title}>Vocal<Text style={{ color: C.accent }}>Lab</Text></Text>
            <Text style={styles.subtitle}>AI-Powered Chemistry Assistant</Text>
          </View>

          {/* Connection Card */}
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardIcon}>📡</Text>
              <Text style={styles.cardTitle}>Backend Link</Text>
              {connected && <View style={styles.liveBadge}><Text style={styles.liveText}>● ONLINE</Text></View>}
            </View>
            <TextInput
              style={[styles.input, connected && styles.inputSuccess]}
              value={serverIP}
              onChangeText={setServerIP}
              placeholder="e.g. 192.168.1.5:8000"
              placeholderTextColor={C.dim}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.mainBtn, connected && styles.btnSuccess]}
              onPress={testConnection}
              disabled={connecting}
            >
              {connecting ? <ActivityIndicator color={C.bg} /> : <Text style={styles.btnText}>{connected ? 'Re-verify Connection' : 'Establish Connection'}</Text>}
            </TouchableOpacity>
          </View>

          {/* Experiment Selection */}
          {connected && (
            <View style={[styles.card, { borderColor: C.accentBord }]}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardIcon}>🔬</Text>
                <Text style={styles.cardTitle}>Active Experiment</Text>
              </View>
              <Text style={styles.expName}>{expName}</Text>

              <View style={styles.divider} />

              <Text style={styles.label}>Select Language</Text>
              <View style={styles.langList}>
                {LANGS.map((l, i) => (
                  <TouchableOpacity
                    key={l.code}
                    style={[styles.langChip, i === langIdx && styles.langChipActive]}
                    onPress={() => setLangIdx(i)}
                  >
                    <Text style={styles.langEmoji}>{l.flag}</Text>
                    <Text style={[styles.langLabel, i === langIdx && { color: C.accent }]}>{l.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.startBtn} onPress={startExperiment}>
                <Text style={styles.startBtnText}>LAUNCH LAB INTERFACE</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.footer}>VocalLab Mobile v3.3 • Powered by Gemini & YOLO</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ──────────────────────── RENDER EXPERIMENT ─────────────────────── */
  const sx = W / frameSize.w;
  const sy = CAMERA_H / frameSize.h;
  const total = fsmState?.total_steps ?? 0;
  const active = fsmState?.current_step ?? 0;
  const progress = fsmState?.progress ?? 0;

  const scanPos = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, CAMERA_H - 2]
  });

  return (
    <View style={styles.labContainer}>
      <StatusBar hidden />

      {/* Viewport */}
      <View style={styles.viewport}>
        <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" />

        {/* Visual elements */}
        <Animated.View pointerEvents="none" style={[styles.scanLine, { transform: [{ translateY: scanPos }] }]} />
        <View pointerEvents="none" style={styles.vignette} />

        <View style={styles.hudTop}>
          <TouchableOpacity style={styles.exitBtn} onPress={goHome}>
            <Text style={styles.exitBtnText}>Exit Lab</Text>
          </TouchableOpacity>
          <View style={styles.hudInfo}>
            <View style={styles.dot} />
            <Text style={styles.hudInfoText}>{detCount} Objects Detected</Text>
          </View>
        </View>

        {/* Object Overlays */}
        {boxes.map((d, i) => {
          const b = d.bbox || [0, 0, 0, 0];
          const color = BOX_COLORS[d.label] || C.accent;
          return (
            <View
              key={i}
              pointerEvents="none"
              style={[styles.box, {
                left: b[0] * sx, top: b[1] * sy,
                width: (b[2] - b[0]) * sx, height: (b[3] - b[1]) * sy,
                borderColor: color,
                backgroundColor: color + '15'
              }]}
            >
              <View style={[styles.boxLabel, { backgroundColor: color }]}>
                <Text style={styles.boxText}>{d.label} {Math.round(d.confidence * 100)}%</Text>
              </View>
            </View>
          );
        })}

        {/* Alarms */}
        {safetyAlert && (
          <View style={styles.safetyAlert} pointerEvents="none">
            <Text style={styles.safetyIcon}>⚠️</Text>
            <Text style={styles.safetyMsg}>{safetyAlert.message}</Text>
          </View>
        )}

        {/* Completion */}
        {expDone ? (
          <View style={styles.successScreen}>
            <Text style={styles.successEmoji}>🏆</Text>
            <Text style={styles.successTitle}>Lab Complete!</Text>
            <TouchableOpacity style={styles.doneBtn} onPress={goHome}>
              <Text style={styles.doneBtnText}>Return to Dashboard</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {/* Guidance Panel */}
      <View style={styles.panel}>
        <View style={styles.panelHandle} />
        <ScrollView contentContainerStyle={styles.panelScroll} showsVerticalScrollIndicator={false}>
          {!fsmState ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={C.accent} size="large" />
              <Text style={styles.loadingText}>Calibrating Lab AI...</Text>
            </View>
          ) : (
            <>
              <View style={styles.stepHeader}>
                <View style={styles.stepCounter}>
                  <Text style={styles.stepLabel}>Step {active + 1} of {total}</Text>
                </View>
                <TouchableOpacity style={styles.langPill} onPress={toggleLanguage}>
                  <Text style={styles.langPillText}>{lang.flag} {lang.label}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.stepTitle}>{fsmState.step_name}</Text>

              <View style={styles.progressContainer}>
                <View style={[styles.progressBar, { width: `${progress}%` }]} />
              </View>
              <Text style={styles.progressText}>{Math.round(progress)}% completion for this step</Text>

              {fsmState.hint && (
                <View style={styles.hintBox}>
                  <Text style={styles.hintIcon}>💡</Text>
                  <Text style={styles.hintText}>{fsmState.hint}</Text>
                </View>
              )}

              {fsmState.missing_objects?.length > 0 && (
                <View style={styles.missingBox}>
                  <Text style={styles.missingTitle}>Required Equipment missing:</Text>
                  <View style={styles.missingList}>
                    {fsmState.missing_objects.map((o, idx) => (
                      <View key={idx} style={styles.missingPill}>
                        <Text style={styles.missingPillText}>{o.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  homeScroll: { padding: 24, paddingBottom: 60 },

  hero: { alignItems: 'center', marginVertical: 40 },
  heroBg: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: C.blue + '08', top: -100 },
  logoBox: { width: 80, height: 80, borderRadius: 24, backgroundColor: C.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.accentBord, elevation: 10, shadowColor: C.accent, shadowOpacity: 0.2, shadowRadius: 15 },
  logoEmoji: { fontSize: 40 },
  title: { fontSize: 42, fontWeight: '900', color: C.text, marginTop: 20 },
  subtitle: { color: C.dim, fontSize: 16, marginTop: 4 },

  card: { backgroundColor: C.surface, borderRadius: 24, padding: 24, marginBottom: 20, borderWidth: 1, borderColor: C.border },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  cardIcon: { fontSize: 24, marginRight: 12 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: C.text, flex: 1 },
  liveBadge: { backgroundColor: C.accent + '20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: C.accent + '40' },
  liveText: { color: C.accent, fontSize: 10, fontWeight: 'bold' },

  input: { backgroundColor: C.card, height: 56, borderRadius: 16, paddingHorizontal: 16, color: C.text, fontSize: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16 },
  inputSuccess: { borderColor: C.success + '40' },

  mainBtn: { height: 56, backgroundColor: C.accent, borderRadius: 16, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  btnSuccess: { backgroundColor: C.success },
  btnText: { color: C.bg, fontWeight: '800', fontSize: 16 },

  expName: { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 10 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 20 },
  label: { color: C.dim, fontWeight: 'bold', marginBottom: 12, fontSize: 12, textTransform: 'uppercase' },
  langList: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 24 },
  langChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, padding: 12, borderRadius: 16, marginRight: 10, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  langChipActive: { borderColor: C.accent, backgroundColor: C.accent + '10' },
  langEmoji: { fontSize: 20, marginRight: 8 },
  langLabel: { color: C.text, fontWeight: '600' },

  startBtn: { height: 64, backgroundColor: C.accent, borderRadius: 20, justifyContent: 'center', alignItems: 'center', shadowColor: C.accent, shadowOpacity: 0.4, shadowRadius: 20, elevation: 8 },
  startBtnText: { color: C.bg, fontWeight: '900', fontSize: 18, letterSpacing: 1 },
  footer: { textAlign: 'center', color: C.muted, fontSize: 12, marginTop: 20 },

  labContainer: { flex: 1, backgroundColor: '#000' },
  viewport: { height: CAMERA_H, overflow: 'hidden' },
  vignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', borderLeftWidth: 0, borderRightWidth: 0, borderTopWidth: 20, borderBottomWidth: 20, borderColor: 'rgba(0,0,0,0.3)' },
  scanLine: { position: 'absolute', width: '100%', height: 2, backgroundColor: C.accent, shadowColor: C.accent, shadowOpacity: 1, shadowRadius: 10 },

  hudTop: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, paddingTop: 40 },
  exitBtn: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  exitBtnText: { color: '#fff', fontWeight: 'bold' },
  hudInfo: { backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  hudInfoText: { color: C.accent, fontWeight: '800', fontSize: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent, marginRight: 8 },

  box: { position: 'absolute', borderWidth: 2, borderRadius: 8 },
  boxLabel: { position: 'absolute', top: -20, left: -2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  boxText: { color: '#000', fontSize: 10, fontWeight: 'bold' },

  safetyAlert: { position: 'absolute', bottom: 20, left: 20, right: 20, backgroundColor: C.danger, padding: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', elevation: 10 },
  safetyIcon: { fontSize: 24, marginRight: 12 },
  safetyMsg: { color: '#fff', fontWeight: 'bold', fontSize: 14, flex: 1 },

  successScreen: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,10,19,0.95)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  successEmoji: { fontSize: 80 },
  successTitle: { fontSize: 32, fontWeight: '900', color: '#fff', marginVertical: 20 },
  doneBtn: { backgroundColor: C.accent, paddingHorizontal: 32, paddingVertical: 18, borderRadius: 20 },
  doneBtnText: { color: C.bg, fontWeight: 'bold', fontSize: 18 },

  panel: { flex: 1, backgroundColor: C.bg, borderTopLeftRadius: 32, borderTopRightRadius: 32, marginTop: -32, borderTopWidth: 1, borderTopColor: C.accent + '20' },
  panelHandle: { width: 40, height: 5, backgroundColor: C.muted, borderRadius: 3, alignSelf: 'center', marginTop: 12 },
  panelScroll: { padding: 24, paddingBottom: 40 },
  loadingBox: { alignItems: 'center', marginTop: 40 },
  loadingText: { color: C.accent, marginTop: 16, fontWeight: '600' },

  stepHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  stepCounter: { backgroundColor: C.accent + '15', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  stepLabel: { color: C.accent, fontWeight: '800', fontSize: 12 },
  langPill: { backgroundColor: C.surface, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  langPillText: { color: C.text, fontSize: 12 },

  stepTitle: { fontSize: 24, fontWeight: '900', color: C.text, marginBottom: 16 },
  progressContainer: { height: 6, backgroundColor: C.muted, borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  progressBar: { height: '100%', backgroundColor: C.accent, borderRadius: 3 },
  progressText: { color: C.dim, fontSize: 11, fontWeight: '600' },

  hintBox: { backgroundColor: C.blue + '10', padding: 16, borderRadius: 16, flexDirection: 'row', marginTop: 24, borderWidth: 1, borderColor: C.blue + '30' },
  hintIcon: { fontSize: 20, marginRight: 12 },
  hintText: { color: '#93c5fd', flex: 1, lineHeight: 20 },

  missingBox: { marginTop: 24 },
  missingTitle: { color: C.warn, fontWeight: '800', fontSize: 12, marginBottom: 12, textTransform: 'uppercase' },
  missingList: { flexDirection: 'row', flexWrap: 'wrap' },
  missingPill: { backgroundColor: C.warn + '15', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: C.warn + '30' },
  missingPillText: { color: C.warn, fontSize: 12, fontWeight: '700' },
});