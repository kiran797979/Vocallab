# 🧪 VocalLab — AI-Powered Chemistry Lab Instructor

[![Status](https://img.shields.io/badge/Status-Production-00d4aa?style=for-the-badge)](https://github.com/kiran797979/Vocallab)
[![Python](https://img.shields.io/badge/Python-3.10+-3776ab?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![React Native](https://img.shields.io/badge/React%20Native-Expo-61dafb?style=for-the-badge&logo=react&logoColor=black)](https://expo.dev)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

> **Real-time AI lab assistant that guides students through chemistry experiments using computer vision, voice instructions, and safety monitoring — in 4 Indian languages.**

---

## 🎯 What It Does

- 📱 **Phone becomes a lab assistant** — point camera at equipment, get step-by-step voice guidance
- 🔬 **YOLOv8 object detection** — identifies beakers, flasks, droppers, and 20+ lab items in real-time
- 🗣️ **4-language support** — Hindi (हिंदी), English, Telugu (తెలుగు), Tamil (தமிழ்) voice instructions
- 🛡️ **Safety monitoring** — alerts when hands get too close to chemicals with haptic feedback
- 📊 **Instructor dashboard** — real-time monitoring of student progress, detections, and safety events

---

## 🏗️ Architecture

```
┌─────────────┐    WebSocket     ┌──────────────────┐    WebSocket    ┌─────────────┐
│  📱 Mobile  │ ◄──────────────► │  🖥️  Backend     │ ◄────────────► │ 📊 Dashboard│
│  (Expo RN)  │   frames/results │  (FastAPI+YOLO)  │   live updates │  (React+Vite)│
│             │                  │                  │                │             │
│ • Camera    │                  │ • YOLOv8 detect  │                │ • Step view │
│ • Audio     │                  │ • FSM engine     │                │ • Safety log│
│ • Haptics   │                  │ • Audio serve    │                │ • Detection │
│ • Bbox draw │                  │ • Safety check   │                │ • Events    │
└─────────────┘                  └──────────────────┘                └─────────────┘
                                        │
                                 AMD Ryzen™ AI
```

---

## 🛠️ Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Backend** | FastAPI + Python 3.10+ | REST/WebSocket server, orchestration |
| **Detection** | YOLOv8 (Ultralytics) | Real-time object detection |
| **Mobile** | React Native (Expo) | Camera, audio, haptic feedback |
| **Dashboard** | React + Vite + Tailwind v4 | Instructor monitoring interface |
| **Voice** | Google TTS (gTTS) | Multi-language audio generation |
| **Hardware** | AMD Ryzen™ AI | Accelerated AI inference |

---

## ✨ Features

### 📱 Mobile App
- Real-time camera with bounding box overlay
- Step-by-step guidance with progress tracking
- Missing objects indicator ("🔍 Need: conical_flask, dropper")
- Language cycling (Hindi ↔ English ↔ Telugu ↔ Tamil)
- Safety alert banner with haptic feedback
- Audio playback for instructions and warnings
- Auto-reconnecting WebSocket

### 📊 Instructor Dashboard
- Live experiment progress with step timeline
- Detected objects panel with confidence scores
- Safety alerts log with severity levels
- Real-time event log
- Class overview with mock student cards
- Experiment library browser

### 🖥️ Backend
- ConnectionManager for multiple students + dashboards
- Frame rate limiting (2 FPS max)
- Per-student stats tracking
- Server stats endpoint
- Startup validation of audio files
- PyTorch 2.6 compatibility patch
- Heartbeat to keep dashboards alive

---

## 🔬 Experiment: Acid-Base Titration

| Step | Name | Required Objects | Audio |
|------|------|-----------------|-------|
| 1 | Setup Equipment | `beaker`, `conical_flask` | step_1_intro.mp3 |
| 2 | Pour Acid (HCl) | `beaker`, `conical_flask`, `dropper` | step_2_intro.mp3 |
| 3 | Add Base & Indicator | `beaker`, `conical_flask`, `dropper` | step_3_intro.mp3 |
| 4 | Record Observations | `beaker`, `lab_manual` | step_4_intro.mp3 |

**Real props mapping:** bottle → beaker, wine glass → conical_flask, mouse → dropper, book → lab_manual, person → hand

---

## 🏷️ Label Mapping (YOLO COCO → Lab Equipment)

| YOLO Class | Lab Equipment | YOLO Class | Lab Equipment |
|-----------|---------------|-----------|---------------|
| bottle | beaker | person | hand |
| wine glass | conical_flask | cell phone | ph_meter |
| cup | measuring_cylinder | remote | thermometer |
| bowl | petri_dish | mouse | dropper |
| spoon | spatula | keyboard | hotplate |
| knife | glass_rod | laptop | analytical_balance |
| scissors | tongs | book | lab_manual |
| vase | volumetric_flask | clock | stopwatch |
| banana | test_tube | apple | rubber_stopper |
| orange | watch_glass | carrot | stirring_rod |
| toothbrush | brush | pen | pipette |

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- Expo CLI (`npx expo`)
- Phone with Expo Go app

### 1️⃣ Backend
```bash
cd backend

# Create virtual environment
python -m venv ../venv
# Windows:
..\venv\Scripts\activate
# macOS/Linux:
# source ../venv/bin/activate

# Install dependencies
pip install fastapi uvicorn websockets ultralytics opencv-python-headless numpy Pillow gtts aiofiles python-multipart torch torchvision

# Generate audio files (first time only)
python generate_audio.py

# Run server
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2️⃣ Dashboard
```bash
cd dashboard
npm install
npm run dev
# → http://localhost:3000
```

### 3️⃣ Mobile
```bash
cd mobile
npm install
npx expo start
# Scan QR code with Expo Go on your phone
```

---

## 📁 Project Structure

```
vocallab/
├── backend/
│   ├── config/
│   │   ├── __init__.py
│   │   ├── experiment.json      # Experiment steps, safety rules, hints
│   │   └── label_map.py         # YOLO → lab equipment mapping
│   ├── engine/
│   │   ├── __init__.py
│   │   ├── detector.py          # YOLOv8 wrapper with label mapping
│   │   └── fsm.py               # Experiment state machine
│   ├── audio/
│   │   ├── en/ (16 mp3)         # English audio
│   │   ├── hi/ (16 mp3)         # Hindi audio
│   │   ├── te/ (16 mp3)         # Telugu audio
│   │   └── ta/ (16 mp3)         # Tamil audio
│   ├── main.py                  # FastAPI server (REST + WebSocket)
│   ├── generate_audio.py        # Generate TTS audio files
│   ├── test_model.py            # Model testing utility
│   └── yolov8n.pt               # YOLOv8 nano model
├── mobile/
│   ├── App.js                   # Expo React Native app
│   ├── app.json                 # Expo configuration
│   └── package.json
├── dashboard/
│   ├── src/
│   │   ├── App.jsx              # React dashboard
│   │   ├── index.css            # Tailwind + custom styles
│   │   └── main.jsx             # Entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── .gitignore
└── README.md
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|---------|-------------|
| `GET` | `/` | Server status + uptime |
| `GET` | `/health` | Detailed health check |
| `GET` | `/experiment` | Current experiment state |
| `GET` | `/experiment/steps` | Step definitions |
| `POST` | `/detect` | Run YOLO on base64 image |
| `POST` | `/reset` | Reset experiment FSM |
| `GET` | `/stats` | Server statistics |
| `WS` | `/ws/student` | Mobile app WebSocket |
| `WS` | `/ws/dashboard` | Dashboard WebSocket |

---

## 🎬 Demo Script (2 minutes)

1. **Open** dashboard on laptop → show "Waiting for student..."
2. **Open** mobile app → connect to server → select Hindi
3. **Start** experiment → camera view with "Step 1: Setup Equipment"
4. **Point** camera at bottle (→beaker) and wine glass (→flask) → boxes appear
5. **Watch** progress bar fill → step advances to Step 2
6. **Bring** hand close to beaker → 🚨 SAFETY ALERT with haptic
7. **Show** dashboard → live step updates, detection list, safety log
8. **Switch** language to Telugu → hint text changes immediately
9. **Complete** remaining steps → 🎉 experiment complete overlay

---

## 🌍 Impact

> **Built for 500M+ Indian students** who lack access to quality laboratory experiences. VocalLab transforms any smartphone into an AI-powered lab instructor, bridging the gap between theoretical knowledge and practical skills.

- 🏫 **Rural schools** — no expensive lab equipment tracking needed
- 🗣️ **Regional languages** — instructions in students' native tongue
- 🛡️ **Lab safety** — AI monitoring prevents accidents
- 📊 **Teacher insight** — real-time dashboard for remote supervision
- 💰 **Zero cost** — uses everyday objects as lab equipment proxies

---

## ⚡ Powered by AMD Ryzen™ AI

VocalLab leverages AMD Ryzen™ AI for accelerated YOLOv8 inference, enabling real-time object detection at 2+ FPS with minimal latency on consumer hardware.

---

<p align="center">
  <b>🧪 VocalLab</b> — Making science education accessible, safe, and multilingual.
  <br/>
  <sub>Built with ❤️ for the AMD Pervasive AI Developer Contest</sub>
</p>
