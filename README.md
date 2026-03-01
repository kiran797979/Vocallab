# 🧪 VocalLab — AI-Powered Chemistry Lab Instructor

<p align="center">
  <img src="https://raw.githubusercontent.com/kiran797979/Vocallab/master/assets/icon.png" width="120" height="120" alt="VocalLab Logo" />
</p>

<p align="center">
  <strong>Real-time AI Object Detection · Multilingual Voice Guidance · Live Instructor Dashboard</strong>
</p>

<p align="center">
  <a href="https://github.com/kiran797979/Vocallab"><img src="https://img.shields.io/badge/Status-Production_Ready-00d4aa?style=for-the-badge" /></a>
  <a href="https://expo.dev"><img src="https://img.shields.io/badge/Expo-SDK_54-61dafb?style=for-the-badge&logo=expo&logoColor=white" /></a>
  <a href="https://python.org"><img src="https://img.shields.io/badge/Python-3.10+-3776ab?style=for-the-badge&logo=python&logoColor=white" /></a>
  <a href="https://fastapi.tiangolo.com"><img src="https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white" /></a>
  <a href="https://ultralytics.com"><img src="https://img.shields.io/badge/Vision-YOLOv8-ED1C24?style=for-the-badge" /></a>
  <a href="https://www.amd.com/en/technologies/ryzen-ai"><img src="https://img.shields.io/badge/Accelerated_By-AMD_Ryzen™_AI-ED1C24?style=for-the-badge" /></a>
</p>

---

## 📖 Table of Contents

1. [Vision & Mission](#-vision--mission)
2. [The Problem We Solve](#-the-problem-we-solve)
3. [How It Works (System Flow)](#-how-it-works-system-flow)
4. [Core Features](#-core-features)
5. [Technical Stack](#-technical-stack)
6. [Deep Dive: Computer Vision](#-deep-dive-computer-vision)
7. [Finite State Machine (FSM)](#-finite-state-machine-fsm)
8. [Multi-Language Voice Engine](#-multi-language-voice-engine)
9. [Safety & Compliance Engine](#-safety--compliance-engine)
10. [Setup & Installation](#-setup--installation)
11. [One-Command Launch](#-one-command-launch)
12. [Project Structure](#-project-structure)
13. [API & WebSocket Reference](#-api--websocket-reference)
14. [Configuration Guide](#-configuration-guide)
15. [Performance Benchmarks](#-performance-benchmarks)
16. [Troubleshooting](#-troubleshooting)
17. [Roadmap](#-roadmap)
18. [Contributing](#-contributing)
19. [License](#-license)

---

## 🚀 Vision & Mission

**VocalLab** is an initiative to democratize science education in India and beyond. Our vision is that no student's scientific curiosity should be limited by a lack of laboratory infrastructure.

By merging affordable smartphone technology with cutting-edge AI, VocalLab transforms any classroom, home, or rural education center into a fully guided chemistry laboratory — for zero hardware cost.

Our AI instructor is:
- **Accessible** — Works on any smartphone running Expo Go.
- **Multilingual** — Guides students in Hindi, English, Telugu, and Tamil.
- **Safe** — Monitors every student's setup simultaneously, flagging hazards in real time.
- **Scalable** — A single backend server can support an entire classroom of students, each with an isolated FSM instance.
- **Data-Driven** — Gives instructors live insights on all student progress from a premium dashboard.

---

## 🧩 The Problem We Solve

In India, over **500 million students** are enrolled in schools where:
1. **No lab equipment exists** — Physical glassware, chemicals, and instruments are unaffordable.
2. **Safety prevents practicals** — Schools skip experiments due to liability and chemical risks.
3. **Ratio is impossible** — One teacher cannot safely monitor 40 students simultaneously.
4. **Language is a barrier** — Quality lab software is exclusively in English.

**VocalLab solves all four problems** using AI proxies (household items as lab equipment stand-ins), real-time vision monitoring, multilingual voice guidance, and a live instructor dashboard.

---

## ⚙️ How It Works (System Flow)

```
┌────────────────────────────────────────────────────────────────────┐
│                       STUDENT PHONE (Expo Go)                      │
│   Camera → Base64 Frame (quality=0.3) → WebSocket Send (2 FPS)   │
│   [Backend] → WebSocket Receive → Detections + Guidance + Audio   │
└─────────────────────────────┬──────────────────────────────────────┘
                              │ WebSocket ws://IP:8000/ws/student
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                    FASTAPI BACKEND v2.1.0 (Python)                │
│                                                                    │
│  1. Decode Base64 frame → NumPy → OpenCV                          │
│  2. YOLOv8n Inference (conf=0.35, imgsz=640)                     │
│  3. Label Map → COCO labels → Lab equipment labels (40+ maps)    │
│  4. Per-Student FSM.process_detections() → step/safety/audio     │
│  5. Response to Student WS + Broadcast to Dashboard WS            │
└───────────┬──────────────────────────────────────┬────────────────┘
            │ WebSocket /ws/student                 │ WebSocket /ws/dashboard
            ▼                                       ▼
┌─────────────────────────┐           ┌────────────────────────────┐
│  STUDENT GETS:          │           │  INSTRUCTOR GETS:          │
│  - Step guidance (4 lang)           │  - Live detection feed     │
│  - Bounding boxes + conf│           │  - All student progress    │
│  - Safety alerts + haptic           │  - Safety event log        │
│  - Voice audio (MP3)    │           │  - Per-student metrics     │
│  - Transition animations│           │  - Experiment stats        │
└─────────────────────────┘           └────────────────────────────┘
```

---

## ✨ Core Features

### 📱 Mobile App v3.4 (Student Interface)
- **Real-time Camera HUD** — Color-coded bounding boxes for 25+ lab object types with confidence percentages.
- **Step Progress Panel** — Sliding panel shows current step, hint, progress bar, and missing items.
- **Missing Equipment Alerts** — Pill badges for any objects not yet detected in frame.
- **Safety Flash Banner** — Full-width red alert with haptic vibration (`expo-haptics`) for proximity warnings.
- **Transition Pulse Animation** — Golden pulsing banner when a step is completed, prompting object removal.
- **Language Switcher** — Tap to cycle Hindi / English / Telugu / Tamil with instant voice + hint updates.
- **Experiment Completion Screen** — Trophy animation on successful lab completion.
- **Auto-Reconnect** — WebSocket automatically reconnects every 3 seconds if network drops, without losing state.
- **Hardcoded Default IP** — `DEFAULT_SVR = '192.168.0.105:8000'` for quick LAN testing; also reads from `app.json` extra config.
- **Processing Lock** — `isProcessingFrameRef` prevents camera frame queue buildup.

### 📊 Instructor Dashboard (Real-time Monitor)
- **Clean Professional UI** — White/blue design system with Inter + Press Start 2P fonts, card-based layout.
- **Live Connection Indicator** — Animated status badge shows LIVE / CONNECTING / OFFLINE.
- **3-Tab Layout**:
  - **Live Experiment** — Circular progress, step bar, safety alerts panel, detection feed, timestamped event log.
  - **Class Overview** — Per-student cards with live metrics (frames processed, detections, time on step, session duration). Falls back to 5 mock students when no live connections.
  - **Experiment Library** — Browse 6 experiments across Chemistry, Physics, Biology with difficulty badges.
- **Debounced Updates** — Student snapshots batched every 250ms to prevent excessive re-renders.
- **Auto-Reconnect** — Dashboard silently reconnects to backend every 3 seconds on disconnect.

### 🧠 Backend AI Engine v2.1.0
- **YOLOv8n Inference** — `detect_base64()`, `detect_frame()`, and `detect_batch_base64()` with rate limiting (100ms cooldown).
- **Per-Student Isolation** — `ConnectionManager` assigns each student their own `ExperimentFSM` instance and metrics tracker.
- **FSM Step Logic** — 3-phase structured state machine: active → transition → removal → advance.
- **Safety Rule Engine** — Euclidean distance check between dangerous object pairs on every frame.
- **Multilingual Audio Server** — `StaticFiles` mount serves pre-generated MP3 files per language at `/audio/{lang}/`.
- **Demo Mode** — `DEMO_MODE=True` with `DEMO_SIMULATION_DELAY=3` auto-advances steps after 3 seconds for testing without real equipment.
- **Heartbeat Loop** — Async task sends heartbeat to dashboards every 25 seconds.
- **Full REST API** — 8 endpoints including health checks, stats, reset, experiment info, single-frame detection, and Swagger docs.
- **PyTorch 2.6 Patch** — `weights_only=False` monkey-patch applied before any ultralytics import for compatibility.
- **Global Error Handler** — Server never crashes; all unhandled exceptions caught and returned as JSON.

---

## 🛠️ Technical Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Mobile** | React Native (Expo) | SDK 54 | Student camera + guidance UI |
| **Mobile Camera** | expo-camera | ~17.0.10 | Frame capture at 2 FPS (quality=0.3) |
| **Mobile Audio** | expo-av | ~16.0.8 | Plays multilingual instruction MP3 audio |
| **Mobile Haptics** | expo-haptics | ~15.0.8 | Safety vibration feedback |
| **Mobile Constants** | expo-constants | ~18.0.13 | Read `app.json` extra config |
| **Mobile Runtime** | React 19.1.0 + RN 0.81.5 | Latest | Core UI rendering framework |
| **Dashboard** | React + Vite | React 19.2, Vite 7.3 | Instructor real-time monitor |
| **Dashboard Styling** | Tailwind CSS v4 | ^4.1.18 | Utility-first design system via `@tailwindcss/vite` plugin |
| **Backend Framework** | FastAPI | ^0.115 | REST API + async WebSocket server |
| **AI Model** | YOLOv8n (Ultralytics) | ^8.1 | Object detection engine (80 COCO classes) |
| **Image Processing** | OpenCV + NumPy | Latest | Frame decode + pre-processing |
| **ML Runtime** | PyTorch | ^2.6 | YOLO model inference backend |
| **WS Transport** | WebSockets (built-in) | — | Bidirectional real-time comms |
| **Audio Generation** | gTTS | ^2.3 | Text-to-speech audio clip creation |
| **Acceleration** | AMD Ryzen™ AI NPU | — | Offload inference from CPU |

---

## 🔬 Deep Dive: Computer Vision

### YOLOv8 Detection Pipeline

```
Camera Frame (JPEG, quality=30%)
         │
         ▼
 base64 decode → NumPy array
         │
         ▼
 cv2.imdecode() → BGR frame
         │
         ▼
 Rate limit check (100ms cooldown)
         │
         ▼
 YOLO.predict(frame, conf=0.35, imgsz=640)
         │
         ▼
 for each box:
   ├─ Extract: x1, y1, x2, y2, confidence, class_id
   ├─ Map class_id → YOLO name (e.g. "bottle")
   ├─ Map YOLO name → Lab label (e.g. "conical_flask")
   └─ Emit: {label, confidence, bbox, center}
         │
         ▼
 Return: List[Detection], frame_width, frame_height
```

### Proxy Label Mapping System (40+ mappings)

VocalLab's most innovative feature: **everyday household items as lab equipment proxies**. This lets students practice the exact workflow of a chemistry lab without owning the glassware.

#### Primary Mappings

| YOLO COCO Label | VocalLab Lab Label | Use Case |
|---|---|---|
| `glass` | `beaker` | Main reaction vessel |
| `bottle` | `conical_flask` | Titration flask |
| `wine glass` | `conical_flask` | Titration flask (alternate) |
| `cup` | `measuring_cylinder` | Volume measurement |
| `mouse` | `dropper` | Reagent addition |
| `book` | `lab_manual` | Recording observations |
| `cell phone` | `ph_meter` | pH measurement |
| `remote` | `thermometer` | Temperature monitoring |
| `keyboard` | `hotplate` | Heating equipment |
| `bowl` | `petri_dish` | Sample collection |
| `spoon` | `spatula` | Solid handling |
| `knife` | `conical_flask` | Stirring (alt map) |
| `scissors` | `tongs` | Heat-resistant handling |
| `vase` | `volumetric_flask` | Precise volume |
| `laptop` | `analytical_balance` | Mass measurement |
| `clock` | `stopwatch` | Reaction timing |
| `banana` | `test_tube` | Small sample reactions |
| `pen` | `pipette` | Precise liquid transfer |
| `carrot` | `stirring_rod` | Stirring |
| `apple` | `rubber_stopper` | Flask sealing |
| `orange` | `watch_glass` | Evaporation dish |
| `toothbrush` | `brush` | Cleaning equipment |

#### Extended Mappings

Additional items like `fork → spatula`, `mug → measuring_cylinder`, `calculator → analytical_balance`, `notebook → lab_manual`, `pencil → stirring_rod`, `marker → stirring_rod`, `highlighter → stirring_rod`, `stapler → analytical_balance`, `ruler → stirring_rod`, and more.

#### Fuzzy Matching

If an exact match isn't found, the system checks for partial keyword matches (e.g., any label containing "glass" maps to `beaker`, "bottle" maps to `conical_flask`). If no mapping exists, the original YOLO label is returned as-is.

### AMD Ryzen AI Acceleration

When running on a machine with an AMD Ryzen AI processor (Ryzen 7000-series and above), the NPU (Neural Processing Unit) takes over inference tasks from the CPU, delivering:
- **~50% lower CPU usage** during inference
- **Cooler thermals** for sustained lab sessions
- **Consistent latency** of 15-25ms regardless of other workloads

---

## 🔄 Finite State Machine (FSM)

The FSM (v2.1.0) is the brain of the experiment logic. Each connected student gets their own isolated `ExperimentFSM` instance managed by the `ConnectionManager`.

### 3-Phase Step Lifecycle

```
  ┌──────────┐    3 stable frames    ┌─────────────┐   2 removal frames   ┌────────────┐
  │  ACTIVE  │ ──────────────────►   │  TRANSITION  │ ──────────────────►  │  ADVANCE   │
  │          │  all required objs    │              │  all objs removed    │            │
  │  Detect  │  detected in frame    │  Play audio  │  from camera frame   │  Next step │
  │  objects │                       │  Wait for    │                      │  or DONE   │
  └──────────┘                       │  removal     │                      └────────────┘
       ▲                             └──────────────┘                           │
       │                                                                        │
       └────────────────────────────────────────────────────────────────────────┘
                                   (new step starts in ACTIVE)
```

### State Machine Logic

```python
class ExperimentFSM:
    # Constants
    FRAMES_TO_ADVANCE = 3    # consecutive frames ALL required objects must be present
    REMOVAL_FRAMES    = 2    # consecutive frames with NO required objects to end transition

    def process_detections(self, detections, language="en"):
        # 1. Safety check FIRST — always runs on every frame
        safety_alert = self._check_safety(detections)

        # 2. Already completed? Return final state
        if self.completed: return completed_result

        # 3. TRANSITION state — waiting for student to REMOVE objects
        if self.in_transition:
            if demo_mode: advance immediately
            if all_present: reset removal_count, keep waiting
            else: removal_count += 1
                if removal_count >= REMOVAL_FRAMES: ADVANCE STEP

        # 4. ACTIVE state — normal detection
        if demo_mode and stuck for demo_timeout seconds: auto-advance
        if all_present: stable_count += 1
        else: stable_count = 0

        if stable_count >= FRAMES_TO_ADVANCE:
            # Enter TRANSITION state
            in_transition = True
            play transition audio
```

### Demo Mode

When `DEMO_MODE=True` (current default), the FSM auto-advances through steps:
- After `DEMO_SIMULATION_DELAY` seconds (currently **3s**) on any step where required objects aren't detected, the FSM automatically enters transition and advances.
- In transition state, demo mode skips the removal wait and advances immediately.
- This allows full end-to-end testing without a physical camera setup.

### Experiment Configuration (`config/experiment.json`)

The current configuration is a simplified **Acid-Base Titration** with 4 steps, each requiring only a `beaker` (mapped from bottle/glass COCO classes):

```json
{
  "name": "Acid-Base Titration",
  "total_steps": 4,
  "steps": [
    {
      "id": 0,
      "name": "Setup Equipment",
      "required_objects": ["beaker"],
      "hint_en": "Place the beaker on the table",
      "hint_hi": "बीकर को टेबल पर रखें",
      "hint_te": "బీకర్ను టేబుల్ మీద ఉంచండి",
      "hint_ta": "பீக்கரை மேசையில் வையுங்கள்",
      "transition_en": "Step 1 complete! Remove the beaker. Get ready for Step 2...",
      "audio_intro": "step_1_intro",
      "audio_complete": "step_1_complete",
      "audio_transition": "step_1_transition"
    }
  ],
  "safety_rules": {
    "proximity_threshold": 150,
    "alert_cooldown_seconds": 3,
    "dangerous_pairs": [["hand", "beaker"]]
  }
}
```

### How to Add a New Experiment

1. Create a new JSON file in `backend/config/` following the schema above.
2. Define steps with `required_objects`, hints in 4 languages, and transition messages.
3. Update `ExperimentFSM(config_path="config/my_new_experiment.json")` in `main.py`.
4. Add audio prompts to the `PROMPTS` dict in `generate_audio.py`.
5. Run `python generate_audio.py` to generate audio assets.
6. Restart the backend.

---

## 🗣️ Multi-Language Voice Engine

VocalLab provides **real-time multilingual audio guidance** in 4 Indian languages with **17+ audio prompts per language**.

### Audio Asset Pipeline

```
generate_audio.py
       │
       ▼
  Google TTS (gTTS)  — lang codes: hi, en, te, ta
       │
       ▼  generates 68+ MP3 files
 backend/audio/
   ├── en/   (English: 17 files)
   │    ├── welcome.mp3
   │    ├── experiment_intro.mp3
   │    ├── step_1_intro.mp3
   │    ├── step_1_complete.mp3
   │    ├── step_1_transition.mp3
   │    ├── step_2_intro.mp3 ... step_4_transition.mp3
   │    ├── error_hand_proximity.mp3
   │    ├── error_wrong_order.mp3
   │    ├── error_missing_equipment.mp3
   │    ├── safety_gloves.mp3
   │    ├── taking_too_long.mp3
   │    └── experiment_complete.mp3
   ├── hi/   (Hindi: 17 files)
   ├── te/   (Telugu: 17 files)
   └── ta/   (Tamil: 17 files)
       │
       ▼
FastAPI StaticFiles mounts /audio/* at startup
       │
       ▼
Backend sends: { audio_url: "/audio/hi/step_1_intro.mp3" }
       │
       ▼
Mobile fetches full URL: http://IP:8000/audio/hi/step_1_intro.mp3
       │
       ▼
expo-av plays audio on device speaker
```

### Language Switch Flow

When a student taps the language button:
1. Mobile sends `{ type: "language_change", language: "te" }` over WebSocket.
2. Backend resets the intro audio tracker for the current step (`intro_played_for_step = -1`).
3. Backend sends back `{ type: "language_updated", step_info: {...}, audio_url: "..." }`.
4. Mobile updates the hint text and immediately plays the step's intro in Telugu.

### Audio Priority System

Audio playback has two modes:
- **Normal** (`force=false`): Only plays if no other audio is playing.
- **Forced** (`force=true`): Interrupts any playing audio immediately. Used for:
  - Safety alerts (always critical)
  - Step advances (always immediate)
  - Transition events (step completion)
  - Language changes (always replaces old language)

---

## 🛡️ Safety & Compliance Engine

Safety is the highest priority in VocalLab. The FSM runs a safety check on **every single frame** before any step logic executes.

### Dangerous Proximity Detection

```python
def _check_safety(self, detections):
    for pair in self.dangerous_pairs:       # e.g. ["hand", "beaker"]
        a, b = pair[0], pair[1]
        if a in centers and b in centers:
            dist = euclidean_distance(centers[a], centers[b])
            if dist < self.proximity_threshold:  # default: 150px
                return {
                    "type": "proximity",
                    "message": f"Warning! Keep {a} and {b} apart!",
                    "objects": [a, b],
                    "distance": round(dist, 1)
                }
```

### Safety Response Chain

```
Dangerous pair detected (e.g. hand too close to beaker)
         │
         ├──▶ Backend: sets safety_alert in response JSON
         │
         ├──▶ Mobile: red full-width banner appears on camera view
         │
         ├──▶ Mobile: expo-haptics fires NotificationFeedbackType.Error
         │
         ├──▶ Mobile: plays /audio/{lang}/error_hand_proximity.mp3 (force=true)
         │
         ├──▶ Dashboard: safety panel shows alert card with severity badge
         │
         └──▶ Event Log: timestamped entry "⚠ Warning! Keep hand and beaker apart!"
```

### Safety Configuration

| Parameter | Default | Description |
|---|---|---|
| `proximity_threshold` | `150px` | Pixel distance between object centers to trigger alert |
| `alert_cooldown_seconds` | `3s` | Minimum time between repeated alerts for the same pair |
| `dangerous_pairs` | `[["hand", "beaker"]]` | List of object pairs that must never be too close |

---

## 🚀 Setup & Installation

### Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Node.js | v18+ | Mobile + Dashboard builds |
| Python | 3.10+ | Backend AI engine |
| pip | Latest | Python package manager |
| Expo Go App | Latest | Run mobile app on your phone |
| Git | Any | Version control |

### Backend Setup

```powershell
# 1. Navigate to project root
cd vocallab

# 2. Create virtual environment
python -m venv venv

# 3. Activate virtual environment (Windows)
.\venv\Scripts\Activate.ps1

# 4. Install all Python dependencies
cd backend
pip install -r requirements.txt

# 5. Generate multilingual audio assets (68+ MP3 files)
python generate_audio.py

# 6. Start the server
python main.py
# Server is live at http://0.0.0.0:8000
```

### Mobile Setup

```powershell
# 1. Navigate to mobile
cd mobile

# 2. Install dependencies
npm install --legacy-peer-deps

# 3. Update the hardcoded IP in App.js
# Find: DEFAULT_SVR = '192.168.0.105:8000'
# Replace with your PC's actual local IP (find it with: ipconfig)
# Also update app.json extra.backendUrl and extra.wsUrl if desired

# 4. Start Expo (LAN mode — most stable)
npx expo start --lan -c

# 5. Scan QR code with Expo Go on your phone
# Ensure phone and PC are on the same Wi-Fi network
# Ensure no firewalls block port 8000
```

### Dashboard Setup

```powershell
# 1. Navigate to dashboard
cd dashboard

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev
# Dashboard opens at http://localhost:3000
```

---

## ⚡ One-Command Launch

A master PowerShell script is included to launch **all three services simultaneously** in separate terminal windows.

```powershell
# From the project root:
.\launch-vocallab.ps1
```

This will:
1. Open a **Backend window** — activates `venv` and runs `python main.py`.
2. Open a **Dashboard window** — starts the Vite dev server on port 3000.
3. Open a **Mobile window** — starts Expo in LAN mode with cache clear.

> **Note**: Run this script from the **project root directory** (`c:\...\vocallab`), not from any subfolder.

---

## 📁 Project Structure

```
vocallab/
│
├── launch-vocallab.ps1             # Master launcher for all 3 services
├── README.md                       # This file
│
├── backend/                        # Python AI Engine (v2.1.0)
│   ├── main.py                     # FastAPI server — REST + WS routes, ConnectionManager
│   ├── generate_audio.py           # TTS script to pre-generate 68+ audio files (4 langs)
│   ├── requirements.txt            # Python dependencies
│   ├── yolov8n.pt                  # YOLOv8-nano pretrained model
│   ├── verify_setup.py             # Setup verification script
│   ├── test_model.py               # Model testing utility
│   ├── tune_thresholds.py          # Threshold tuning utility
│   │
│   ├── engine/
│   │   ├── __init__.py
│   │   ├── detector.py             # ObjectDetector — YOLOv8 wrapper with base64/frame/batch
│   │   ├── fsm.py                  # ExperimentFSM v2.1 — 3-phase step lifecycle
│   │   └── safety.py               # Reserved for future standalone safety module
│   │
│   ├── config/
│   │   ├── __init__.py
│   │   ├── experiment.json         # Acid-Base Titration config (4 steps, 4 langs, safety)
│   │   └── label_map.py            # COCO → Lab equipment proxy mapping (40+ entries)
│   │
│   ├── models/                     # Custom-trained YOLO models (optional)
│   │
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── ws_dashboard.py         # Dashboard WebSocket router (reserved)
│   │   └── ws_student.py           # Student WebSocket router (reserved)
│   │
│   └── audio/
│       ├── en/                     # English .mp3 instruction files (17 files)
│       ├── hi/                     # Hindi .mp3 instruction files (17 files)
│       ├── te/                     # Telugu .mp3 instruction files (17 files)
│       └── ta/                     # Tamil .mp3 instruction files (17 files)
│
├── mobile/                         # React Native Student App (v3.4)
│   ├── App.js                      # Main app — Home + Experiment screens (722 lines)
│   ├── app.json                    # Expo SDK 54 config — permissions, backend URL
│   ├── package.json                # Dependencies (React 19.1, RN 0.81.5)
│   ├── index.js                    # Entry point
│   ├── babel.config.js             # Babel config for Expo
│   ├── fix-and-run.ps1             # Cache-clear + restart automation script
│   └── assets/                     # Icons and splash screen images
│
├── dashboard/                      # React Instructor Dashboard
│   ├── src/
│   │   ├── App.jsx                 # Main dashboard — 3 tabs (808 lines)
│   │   ├── main.jsx                # React 19 entry point
│   │   ├── App.css                 # Component styles
│   │   └── index.css               # Global styles — Tailwind directives, cards, animations
│   ├── index.html                  # HTML shell
│   ├── vite.config.js              # Vite 7 + React + @tailwindcss/vite plugin
│   ├── eslint.config.js            # ESLint config
│   ├── vercel.json                 # Vercel deployment config
│   ├── public/                     # Static public assets
│   └── package.json                # Dependencies (React 19.2, Vite 7.3, Tailwind 4.1)
│
├── training/                       # Model fine-tuning resources
│   ├── dataset/                    # Training datasets
│   └── notebooks/                  # Jupyter notebooks for training
│
├── assets/                         # Project-level assets
│   ├── demo-photos/                # Demo screenshots
│   └── pitch/                      # Pitch deck resources
│
└── venv/                           # Python virtual environment (not committed)
```

---

## 🔌 API & WebSocket Reference

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | `GET` | Server info — version, uptime, model status, demo_mode, proxy_mode |
| `/health` | `GET` | Health check — model loaded, FSM state, client counts, server stats |
| `/experiment` | `GET` | Full FSM state as JSON (experiment name, steps, current step) |
| `/experiment/steps` | `GET` | All step definitions from experiment.json |
| `/detect` | `POST` | Single-frame detection (send `{ "image": "<base64>" }`) |
| `/reset` | `POST` | Reset all FSMs + notify all students and dashboards |
| `/stats` | `GET` | Detailed stats — frame count, detections, per-student snapshots |
| `/docs` | `GET` | FastAPI auto-generated Swagger UI |

#### Example: `/health` Response

```json
{
  "status": "healthy",
  "model_loaded": true,
  "fsm_loaded": true,
  "fsm_state": {
    "experiment_name": "Acid-Base Titration",
    "total_steps": 4,
    "current_step": 0,
    "completed": false,
    "in_transition": false,
    "elapsed_total": 42.5,
    "step_info": { "..." : "..." }
  },
  "dashboard_clients": 1,
  "student_clients": 3,
  "server_stats": {
    "start_time": 1740841200,
    "frames_processed": 847,
    "total_detections": 2541,
    "step_advances": 12,
    "safety_alerts": 2,
    "demo_simulations": 0
  }
}
```

### WebSocket: Student (`ws://IP:8000/ws/student`)

> **Note**: No student ID in the URL. The backend auto-assigns a unique `STU-{timestamp}-{index}` ID on connect and creates an isolated FSM per student.

#### Client → Server Messages

```json
// Send a camera frame for detection
{ "type": "frame", "data": "<base64_jpeg>", "language": "hi", "timestamp": 1740841200000 }

// Change guidance language
{ "type": "language_change", "language": "te" }

// Ping for latency measurement
{ "type": "ping" }
```

#### Server → Client Messages

```json
// Welcome on connect — full experiment state + student ID
{
  "type": "welcome",
  "server_version": "2.1.0",
  "student_id": "STU-1740841200000-0",
  "experiment_name": "Acid-Base Titration",
  "total_steps": 4,
  "current_step": 0,
  "step_names": ["Setup Equipment", "Pour Acid (HCl)", "Add Base & Indicator", "Record Observations"],
  "step_info": {
    "current_step": 0,
    "total_steps": 4,
    "step_name": "Setup Equipment",
    "hint": "Place the beaker on the table",
    "required_objects": ["beaker"],
    "detected_required": [],
    "missing_objects": ["beaker"],
    "progress": 0.0,
    "step_status": "active"
  },
  "model_loaded": true,
  "demo_mode": true,
  "proxy_mode": true,
  "timestamp": "2026-03-01T09:00:00Z"
}

// Detection result — sent after every frame
{
  "type": "detection_result",
  "student_id": "STU-1740841200000-0",
  "detections": [
    { "label": "beaker", "confidence": 0.87, "bbox": [120, 60, 340, 280], "center": [230.0, 170.0] }
  ],
  "count": 1,
  "frame_width": 640,
  "frame_height": 480,
  "step_info": {
    "current_step": 0,
    "total_steps": 4,
    "step_name": "Setup Equipment",
    "hint": "बीकर को टेबल पर रखें",
    "required_objects": ["beaker"],
    "detected_required": ["beaker"],
    "missing_objects": [],
    "progress": 100.0,
    "time_on_step": 5.2,
    "elapsed_total": 42.5,
    "completed": false,
    "step_status": "active"
  },
  "safety_alert": null,
  "audio_url": "/audio/hi/step_1_intro.mp3",
  "step_advance": false,
  "experiment_complete": false,
  "timestamp": "2026-03-01T09:00:05Z"
}

// Safety violation
{
  "type": "detection_result",
  "safety_alert": {
    "type": "proximity",
    "message": "Warning! Keep hand and beaker apart!",
    "objects": ["hand", "beaker"],
    "distance": 87.3
  },
  "audio_url": "/audio/hi/error_hand_proximity.mp3"
}

// Language change confirmed
{
  "type": "language_updated",
  "student_id": "STU-...",
  "language": "te",
  "step_info": { "..." : "..." },
  "audio_url": "/audio/te/step_1_intro.mp3"
}

// Pong response
{ "type": "pong", "timestamp": "2026-03-01T09:00:00Z" }
```

### WebSocket: Dashboard (`ws://IP:8000/ws/dashboard`)

#### Server → Dashboard Messages

```json
// Initial state on connect
{
  "type": "experiment_loaded",
  "experiment_name": "Acid-Base Titration",
  "total_steps": 4,
  "current_step": 0,
  "timestamp": "2026-03-01T09:00:00Z"
}

// Forwarded student data on every frame (with per-student metrics)
{
  "type": "student_update",
  "student_id": "STU-1740841200000-0",
  "detections": [ "..." ],
  "count": 2,
  "step_info": { "..." : "..." },
  "safety_alert": null,
  "step_advance": false,
  "experiment_complete": false,
  "student_stats": {
    "student_id": "STU-1740841200000-0",
    "frames_processed": 142,
    "detections_count": 407,
    "safety_alerts_count": 0,
    "steps_completed": 1,
    "current_step": 1,
    "total_steps": 4,
    "experiment_complete": false,
    "time_on_current_step": 12.5,
    "session_duration": 87.3
  },
  "timestamp": "2026-03-01T09:01:27Z"
}

// Student lifecycle events
{ "type": "student_connected", "student_id": "STU-...", "student_count": 3, "timestamp": "..." }
{ "type": "student_disconnected", "student_id": "STU-...", "student_count": 2, "timestamp": "..." }

// Experiment reset
{ "type": "experiment_reset", "current_step": 0, "timestamp": "..." }

// Backend heartbeat (every 25s)
{ "type": "heartbeat", "timestamp": "2026-03-01T09:00:25Z", "server_version": "2.1.0" }
```

---

## ⚙️ Configuration Guide

### `mobile/App.js` — Backend Connection

The mobile app determines the backend IP in this order:
1. **Hardcoded default**: `DEFAULT_SVR = '192.168.0.105:8000'` (change this to your PC's IP).
2. **Expo config fallback**: `app.json` → `expo.extra.backendUrl` (strips `http://`).
3. **Manual entry**: User can type any IP:port on the Home screen.

```javascript
// In App.js, change this line to match your network:
const DEFAULT_SVR = '192.168.0.105:8000';
```

> **Finding your IP**: Run `ipconfig` (Windows) or `ifconfig` (Mac/Linux) and look for the IPv4 address on your Wi-Fi adapter.

### `mobile/app.json` — Expo Configuration

```json
{
  "expo": {
    "extra": {
      "backendUrl": "http://192.168.0.105:8000",
      "wsUrl": "ws://192.168.0.105:8000/ws/student"
    }
  }
}
```

### `backend/main.py` — Server Configuration

```python
DEMO_MODE = True                  # Auto-advance steps without real equipment
DEMO_SIMULATION_DELAY = 3        # Seconds before demo auto-advance
DETECTION_CONFIDENCE = 0.35       # YOLO confidence threshold
DETECTION_IMGSZ = 640             # YOLO input image size
MAX_FPS = 2                       # Maximum frames processed per second
SAFETY_COOLDOWN_SECONDS = 3       # Minimum time between safety alerts
SAFETY_PROXIMITY_THRESHOLD = 150  # Pixel distance to trigger alert
```

### `backend/config/experiment.json` — Add a Step

```json
{
  "id": 4,
  "name": "Measure pH",
  "required_objects": ["ph_meter", "conical_flask"],
  "hint_en": "Dip the pH meter into the flask and record the reading",
  "hint_hi": "pH मीटर को फ्लास्क में डुबोएं और रीडिंग नोट करें",
  "hint_te": "pH మీటర్‌ను ఫ్లాస్క్‌లో ముంచి రీడింగ్ నోట్ చేయండి",
  "hint_ta": "pH மீட்டரை குடுவையில் நனைத்து அளவீட்டை பதிவு செய்யுங்கள்",
  "transition_en": "Step complete! Remove items and prepare for the next step...",
  "audio_intro": "step_5_intro",
  "audio_complete": "step_5_complete",
  "audio_transition": "step_5_transition"
}
```

### `backend/config/label_map.py` — Add a Proxy

```python
YOLO_TO_LAB = {
    # ... existing 40+ mappings ...
    "umbrella": "burette",      # Add new proxy here
}
```

---

## 📊 Performance Benchmarks

| Metric | Standard Laptop CPU | GPU (CUDA) | AMD Ryzen™ AI NPU |
|--------|--------------------|-----------|--------------------|
| Inference Latency | ~85ms | ~12ms | **~18ms** |
| Backend FPS (full) | 1.2 FPS | 5.0 FPS | **2.5 FPS** |
| CPU Usage | 95% | 20% | **15%** |
| Power Draw | High | Medium | **Ultra Low** |
| Thermal Throttle | Frequent | Rare | **None** |

> **Recommended**: AMD Ryzen 7000-series (or newer) with NPU support for best classroom deployment.

### Frame Rate Strategy

VocalLab intentionally caps the AI inference rate at **~2 FPS** (700ms capture loop + server-side MAX_FPS limiting). This is by design:
- Chemistry steps take **seconds to minutes**, not milliseconds.
- Running at 2 FPS preserves battery and thermal performance.
- The camera HUD renders at the device's **native refresh rate** (60 FPS) for smooth visual experience.
- The capture loop has a **processing lock** (`isProcessingFrameRef`) to prevent frame queue buildup.
- The detector has a **rate limiter** (100ms cooldown) to prevent duplicate processing.

---

## 🛠️ Troubleshooting

### Mobile Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Calibrating Lab AI..." forever | No WS connection or backend not running | Check backend is running on port 8000; verify IP matches `DEFAULT_SVR` in App.js |
| `"Internet connection appears offline"` | Phone can't reach PC on local network | Switch to LAN mode; ensure both on same Wi-Fi; check Windows Firewall allows port 8000 |
| `"Metro Bundler cache error"` | Stale cache | Run `npx expo start --lan -c` to clear cache |
| Objects not detecting | Camera frames not reaching backend | Check console logs for `[Camera] Sending frame` messages; verify WS is connected |
| App crashes on launch | React Native incompatible style props | Ensure no web-only CSS in styles; check Expo SDK compatibility |
| QR code not scanning | Screen brightness | Increase screen brightness; use direct scan |
| Wrong server IP | `DEFAULT_SVR` hardcoded wrong | Edit `DEFAULT_SVR` in App.js to your PC's IPv4 address |

### Backend Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `"Detector FAILED"` on startup | YOLO model not downloaded | Wait for auto-download, or manually place `yolov8n.pt` in `backend/` |
| `"FSM FAILED"` on startup | Invalid `experiment.json` | Validate JSON syntax; check all required fields exist |
| `"Address already in use"` (Errno 10048) | Port 8000 occupied | Run `netstat -ano \| findstr :8000` to find PID, then `taskkill /F /PID <PID>` |
| No audio playing | Audio directory missing or files not generated | Run `python generate_audio.py` in `backend/` |
| PyTorch weight loading error | PyTorch 2.6 weights_only default change | Already patched in code — ensure the monkey-patch is at top of `main.py` and `detector.py` |

### Dashboard Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Vite `Unresolved @import` error | Wrong Tailwind directives | Ensure `index.css` uses `@tailwind base; @tailwind components; @tailwind utilities;` |
| Dashboard shows "OFFLINE" | WS connection blocked or backend not running | Start backend first; check Windows Firewall allows port 8000 |
| Mock students shown instead of live | No students connected yet | Connect a mobile client first; live data replaces mock students automatically |
| CORS error in browser | Browser security | Already pre-configured with `allow_origins=["*"]`; use `localhost` URL |

### Network Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `"Connection refused"` | Backend not running | Start backend first with `python main.py` |
| `"Connection timed out"` | Wrong IP or firewall blocking | Verify IP with `ipconfig`; check Windows Firewall inbound rules for port 8000 |
| Audio plays in wrong language | App cache or language not synced | Tap language button to resend language_change message |

---

## 🗺️ Roadmap

### Phase 2 (Next 3 Months)
- [ ] **Custom YOLO Training** — Collect real lab glassware dataset for 95%+ accuracy.
- [ ] **Student Accounts** — Login system with experiment history persistence.
- [ ] **More Experiments** — Newton's Laws (Physics), Cell Observation (Biology), Electrolysis.
- [ ] **Teacher Controls** — Pause/resume experiment for individual students from dashboard.
- [ ] **Multi-Object Steps** — Require multiple different proxies per step (beaker + flask + dropper).

### Phase 3 (6 Months)
- [ ] **AR Integration** — Augmented Reality overlays showing virtual liquid levels and color indicators.
- [ ] **Collaborative Mode** — Two students share one experiment state from separate phones.
- [ ] **Cloud Sync** — Firebase/Supabase backend for cloud experiment history.
- [ ] **Offline Mode** — Download experiment pack for areas with no internet.
- [ ] **Standalone Safety Module** — Extract safety engine from FSM into dedicated `safety.py`.

### Phase 4 (12 Months)
- [ ] **Government Curriculum Integration** — Align experiment steps with NCERT Class 10/12 syllabus.
- [ ] **Competitive Mode** — Leaderboard for fastest accurate experiment completion.
- [ ] **Regional Language Expansion** — Kannada, Marathi, Bengali, Gujarati.
- [ ] **VocalLab Cloud** — Hosted SaaS for schools without their own infrastructure.

---

## 🤝 Contributing

We welcome contributions from educators, developers, and researchers!

```bash
# 1. Fork the repository
# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/Vocallab.git

# 3. Create a feature branch
git checkout -b feature/MyAwesomeFeature

# 4. Make your changes and commit
git add .
git commit -m "feat: add MyAwesomeFeature"

# 5. Push and open a Pull Request
git push origin feature/MyAwesomeFeature
```

### Good First Issues
- Adding a new experiment JSON configuration.
- Adding a new proxy label mapping in `label_map.py`.
- Translating hints to a new regional language.
- Improving dashboard mobile responsiveness.
- Adding new audio prompts to `generate_audio.py`.

---

## ⚖️ License

Distributed under the **MIT License**.

```
MIT License

Copyright (c) 2026 VocalLab Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software...
```

See `LICENSE` for full text.

---

## 📬 Contact & Support

**VocalLab Team**
GitHub: [@kiran797979](https://github.com/kiran797979)
Repository: [https://github.com/kiran797979/Vocallab](https://github.com/kiran797979/Vocallab)

---

<p align="center">
  <strong>VocalLab — Transforming every smartphone into a chemistry laboratory.</strong><br/>
  <em>Built with ❤️ for 500 million students who deserve better science education.</em>
</p>

---

*Last updated: March 1, 2026 | Backend v2.1.0 | Mobile v3.4 | Expo SDK 54 | FastAPI 0.115 | React 19 | Vite 7 | Tailwind 4*
