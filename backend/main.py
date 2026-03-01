"""
╔═══════════════════════════════════════════════════════════════╗
║   VocalLab — AI Chemistry Lab Instructor   (Backend v2.1)    ║
║   FastAPI + YOLOv8 + WebSocket + Multi-language              ║
║   Enhanced for Proxy Mode + Stability + Demo Mode            ║
╚═══════════════════════════════════════════════════════════════╝

PyTorch 2.6 weights_only patch applied at top.
"""

# ── PyTorch 2.6 safety patch — MUST be before any ultralytics / torch import ───
import torch as _torch
_original_load = _torch.load
def _patched_load(*a, **kw):
    kw["weights_only"] = False
    return _original_load(*a, **kw)
_torch.load = _patched_load
# ───────────────────────────────────────────────────────────────────────────────

import os
import sys
import json
import time
import asyncio
import logging
import traceback
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from typing import List, Dict, Tuple, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse

# Ensure backend/ is importable
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from engine.detector import ObjectDetector
from engine.fsm import ExperimentFSM
from config.label_map import PROXY_MODE, map_label, get_fallback_mapping

# ═══════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════
VERSION = "2.1.0"
DEMO_MODE = True  # Enable demo mode for testing without real equipment

# Detection settings
DETECTION_CONFIDENCE = 0.35
DETECTION_IMGSZ = 640
MAX_FPS = 2  # Maximum processing frames per second

# Safety settings
SAFETY_COOLDOWN_SECONDS = 3
SAFETY_PROXIMITY_THRESHOLD = 150  # pixels

# Demo mode settings
DEMO_SIMULATION_DELAY = 3  # seconds to simulate detection if objects not found (reduced for faster testing)

# ═══════════════════════════════════════════════════════════════════════
# GLOBALS
# ═══════════════════════════════════════════════════════════════════════
detector: ObjectDetector = None
fsm: ExperimentFSM = None

server_stats = {
    "start_time": time.time(),
    "frames_processed": 0,
    "total_detections": 0,
    "step_advances": 0,
    "safety_alerts": 0,
    "demo_simulations": 0,
}


# ═══════════════════════════════════════════════════════════════════════
# CONNECTION MANAGER
# ═══════════════════════════════════════════════════════════════════════
class ConnectionManager:
    def __init__(self):
        self.student_connections: Dict[str, WebSocket] = {}  # student_id -> WebSocket
        self.dashboard_connections: List[WebSocket] = []
        self.student_fsms: Dict[str, ExperimentFSM] = {}    # student_id -> live FSM instance
        self.student_stats: Dict[str, Dict] = {}             # student_id -> metrics counters

    async def connect_student(self, ws: WebSocket, student_id: str = None):
        if not student_id:
            student_id = f"STU-{int(time.time() * 1000)}-{len(self.student_connections)}"
        await ws.accept()
        self.student_connections[student_id] = ws
        # Create isolated FSM instance for this student
        if student_id not in self.student_fsms:
            try:
                self.student_fsms[student_id] = ExperimentFSM(demo_mode=DEMO_MODE, demo_timeout=DEMO_SIMULATION_DELAY)
            except Exception as e:
                print(f"   [CM] FSM creation failed for {student_id}: {e}")
                self.student_fsms[student_id] = None
        # Initialize per-student metrics
        if student_id not in self.student_stats:
            self.student_stats[student_id] = {
                "frames_processed": 0,
                "detections_count": 0,
                "safety_alerts_count": 0,
                "steps_completed": 0,
                "connected_at": time.time(),
            }
        print(f"   [CM] Student connected: {student_id} (total: {len(self.student_connections)})")
        return student_id

    async def connect_dashboard(self, ws: WebSocket):
        await ws.accept()
        self.dashboard_connections.append(ws)
        print(f"   [CM] Dashboard connected (total: {len(self.dashboard_connections)})")

    def disconnect_student(self, student_id: str):
        if student_id in self.student_connections:
            self.student_connections.pop(student_id)
        if student_id in self.student_fsms:
            self.student_fsms.pop(student_id)
        self.student_stats.pop(student_id, None)
        print(f"   [CM] Student disconnected: {student_id} (total: {len(self.student_connections)})")

    def disconnect_dashboard(self, ws: WebSocket):
        if ws in self.dashboard_connections:
            self.dashboard_connections.remove(ws)
        print(f"   [CM] Dashboard disconnected (total: {len(self.dashboard_connections)})")

    async def broadcast_to_dashboards(self, message: dict, exclude_ws: WebSocket = None):
        """Send JSON to all dashboard clients. Remove dead connections."""
        if not self.dashboard_connections:
            return
        text = json.dumps(message)
        dead = []
        for ws in self.dashboard_connections:
            if ws == exclude_ws:
                continue
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect_dashboard(ws)

    async def send_to_student(self, student_id: str, message: dict):
        """Send message to specific student."""
        if student_id in self.student_connections:
            ws = self.student_connections[student_id]
            try:
                await ws.send_text(json.dumps(message))
                return True
            except Exception as e:
                print(f"   [CM] Error sending to {student_id}: {e}")
                self.disconnect_student(student_id)
        return False

    async def broadcast_to_students(self, message: dict):
        """Send JSON to all student clients. Remove dead connections."""
        if not self.student_connections:
            return
        text = json.dumps(message)
        dead = []
        for student_id, ws in list(self.student_connections.items()):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(student_id)
        for student_id in dead:
            self.disconnect_student(student_id)


    def get_student_snapshot(self, student_id: str) -> dict:
        """Build a full per-student metrics snapshot (counters + FSM-derived fields)."""
        stats = self.student_stats.get(student_id, {})
        sfsm = self.student_fsms.get(student_id)
        now = time.time()
        return {
            "student_id": student_id,
            "frames_processed": stats.get("frames_processed", 0),
            "detections_count": stats.get("detections_count", 0),
            "safety_alerts_count": stats.get("safety_alerts_count", 0),
            "steps_completed": stats.get("steps_completed", 0),
            "current_step": sfsm.current_step_index if sfsm else 0,
            "total_steps": sfsm.total_steps if sfsm else 0,
            "experiment_complete": sfsm.completed if sfsm else False,
            "time_on_current_step": round(now - sfsm.step_start, 1) if sfsm else 0.0,
            "session_duration": round(now - stats.get("connected_at", now), 1),
        }

    def get_all_student_snapshots(self) -> list:
        """Return metrics for every connected student."""
        return [self.get_student_snapshot(sid) for sid in self.student_connections]


manager = ConnectionManager()


# ═══════════════════════════════════════════════════════════════════════
# BANNER
# ═══════════════════════════════════════════════════════════════════════
def print_banner():
    teal = "\033[36m"
    green = "\033[92m"
    reset = "\033[0m"
    bold = "\033[1m"
    print(f"""
{teal}╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   {bold}{green}🧪 VocalLab{reset}{teal}  — AI Chemistry Lab Instructor              ║
║      Version {VERSION}  •  FastAPI + YOLOv8 + WebSocket       ║
║      Enhanced for Proxy Mode + Stability + Demo Mode          ║
║      Powered by AMD Ryzen™ AI                                 ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝{reset}
""")


# ═══════════════════════════════════════════════════════════════════════
# LIFESPAN — load model + FSM on startup
# ═══════════════════════════════════════════════════════════════════════
@asynccontextmanager
async def lifespan(app: FastAPI):
    global detector, fsm
    print_banner()

    # Mount audio
    audio_dir = os.path.join(_BACKEND_DIR, "audio")
    if os.path.isdir(audio_dir):
        app.mount("/audio", StaticFiles(directory=audio_dir), name="audio")
        print(f"   [Main] Audio mounted at /audio ({audio_dir})")

        # Validate audio files
        for lang in ["en", "hi", "te", "ta"]:
            lang_dir = os.path.join(audio_dir, lang)
            if os.path.isdir(lang_dir):
                count = len([f for f in os.listdir(lang_dir) if f.endswith(".mp3")])
                print(f"   [Main]   └─ /{lang}/ → {count} files")
            else:
                print(f"   [Main]   └─ /{lang}/ → MISSING!")
    else:
        print(f"   [Main] ⚠ Audio directory not found: {audio_dir}")

    # Load detector
    print("   [Main] Loading AI engine...")
    try:
        detector = ObjectDetector(model_path="yolov8n.pt", confidence=DETECTION_CONFIDENCE)
        print("   [Main] Detector OK ✓")
    except Exception as e:
        print(f"   [Main] Detector FAILED: {e}")
        traceback.print_exc()
        detector = None

    # Load FSM (for reference, each student gets isolated FSM)
    try:
        fsm = ExperimentFSM(demo_mode=DEMO_MODE, demo_timeout=DEMO_SIMULATION_DELAY)
        print(f"   [Main] FSM OK ✓ (demo_mode={DEMO_MODE})")
    except Exception as e:
        print(f"   [Main] FSM FAILED: {e}")
        traceback.print_exc()
        fsm = None

    # Start heartbeat task
    heartbeat_task = asyncio.create_task(_heartbeat_loop())
    print("   [Main] Heartbeat task started")

    print(f"""
{'='*60}
  VocalLab Backend READY  (v{VERSION})
  API:          http://localhost:8000
  Student WS:   ws://localhost:8000/ws/student
  Dashboard WS: ws://localhost:8000/ws/dashboard
  Audio:        http://localhost:8000/audio/{{lang}}/{{file}}.mp3
{'='*60}
""")

    yield

    heartbeat_task.cancel()
    print("   [Main] Server shutting down")


async def _heartbeat_loop():
    while True:
        try:
            await asyncio.sleep(25)
            msg = {"type": "heartbeat", "timestamp": datetime.now(timezone.utc).isoformat(), "server_version": VERSION}
            await manager.broadcast_to_dashboards(msg)
        except asyncio.CancelledError:
            break
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════
# FASTAPI APP
# ═══════════════════════════════════════════════════════════════════════
app = FastAPI(
    title="VocalLab",
    description="AI Chemistry Lab Instructor — Real-time object detection + step guidance",
    version=VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════════════════
# REQUEST LOGGING MIDDLEWARE
# ═══════════════════════════════════════════════════════════════════════
@app.middleware("http")
async def log_requests(request, call_next):
    t0 = time.time()
    try:
        response = await call_next(request)
        elapsed = round((time.time() - t0) * 1000, 1)
        if not request.url.path.startswith("/audio"):   # skip static file noise
            print(f"   [HTTP] {request.method} {request.url.path} → {response.status_code}  ({elapsed}ms)")
        return response
    except Exception as exc:
        elapsed = round((time.time() - t0) * 1000, 1)
        print(f"   [HTTP] {request.method} {request.url.path} → 500 UNHANDLED ({elapsed}ms): {exc}")
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(exc), "path": request.url.path})


# ═══════════════════════════════════════════════════════════════════════
# GLOBAL ERROR HANDLER — server never crashes
# ═══════════════════════════════════════════════════════════════════════
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    print(f"   [ERR] Unhandled exception on {request.url.path}: {exc}")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc), "path": str(request.url.path)},
    )


# ═══════════════════════════════════════════════════════════════════════
# REST ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════
@app.get("/")
async def root():
    return {
        "app": "VocalLab",
        "version": VERSION,
        "status": "running",
        "model_loaded": detector is not None and detector.model is not None,
        "fsm_loaded": fsm is not None,
        "uptime": round(time.time() - server_stats["start_time"], 1),
        "demo_mode": DEMO_MODE,
        "proxy_mode": PROXY_MODE,
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_loaded": detector is not None and detector.model is not None,
        "fsm_loaded": fsm is not None,
        "fsm_state": fsm.get_full_state() if fsm else None,
        "dashboard_clients": len(manager.dashboard_connections),
        "student_clients": len(manager.student_connections),
        "server_stats": server_stats,
    }


@app.get("/experiment")
async def experiment_info():
    if not fsm:
        raise HTTPException(500, "FSM not loaded")
    return fsm.get_full_state()


@app.get("/experiment/steps")
async def experiment_steps():
    if not fsm:
        raise HTTPException(500, "FSM not loaded")
    return {"steps": fsm.config["steps"], "total": fsm.total_steps}


@app.post("/detect")
async def detect_image(body: dict):
    if not detector or not detector.model:
        raise HTTPException(503, "Model not loaded")
    b64 = body.get("image") or body.get("data") or body.get("base64", "")
    if not b64:
        raise HTTPException(400, "Missing 'image' field (base64)")
    dets, w, h = detector.detect_base64(b64)
    return {"detections": dets, "count": len(dets), "frame_width": w, "frame_height": h}


@app.post("/reset")
async def reset_experiment():
    # Reset global reference FSM
    if fsm:
        fsm.reset()
    # Reset all per-student FSM instances
    for sid, student_fsm in list(manager.student_fsms.items()):
        if student_fsm:
            try:
                student_fsm.reset()
            except Exception as e:
                print(f"   [Main] Reset failed for {sid}: {e}")
    server_stats["step_advances"] = 0
    server_stats["safety_alerts"] = 0
    num_students = len(manager.student_connections)
    print(f"   [Main] Experiment reset (students={num_students}, dashboards={len(manager.dashboard_connections)})")
    # Build a reference state from global FSM for dashboard/broadcast
    ref_fsm = fsm or (next(iter(manager.student_fsms.values()), None))
    try:
        state = ref_fsm.get_full_state() if ref_fsm else {}
        await manager.broadcast_to_dashboards({
            "type": "experiment_reset",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **state,
        })
    except Exception as e:
        print(f"   [Main] Reset broadcast to dashboards failed: {e}")
    try:
        welcome = {
            "type": "welcome",
            "server_version": VERSION,
            "experiment_name": ref_fsm.config["name"] if ref_fsm else "Unknown",
            "total_steps": ref_fsm.total_steps if ref_fsm else 0,
            "current_step": 0,
            "step_info": ref_fsm._build_step_info("en") if ref_fsm else {},
            "model_loaded": detector is not None and detector.model is not None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await manager.broadcast_to_students(welcome)
    except Exception as e:
        print(f"   [Main] Reset broadcast to students failed: {e}")
    return {"status": "reset", "students_reset": num_students, "state": ref_fsm.get_full_state() if ref_fsm else {}}


@app.get("/stats")
async def server_statistics():
    return {
        **server_stats,
        "uptime": round(time.time() - server_stats["start_time"], 1),
        "students_connected": len(manager.student_connections),
        "dashboards_connected": len(manager.dashboard_connections),
        "detector": detector.get_stats() if detector else None,
        "fsm": fsm.get_stats() if fsm else None,
        "students": manager.get_all_student_snapshots(),
    }


# ═══════════════════════════════════════════════════════════════════════
# WEBSOCKET — STUDENT
# ═══════════════════════════════════════════════════════════════════════
@app.websocket("/ws/student")
async def ws_student(websocket: WebSocket):
    student_id = None
    language = "en"
    last_frame_time = 0.0
    min_frame_interval = 1.0 / MAX_FPS  # based on MAX_FPS

    try:
        # Connect student and get isolated FSM instance
        student_id = await manager.connect_student(websocket)
        student_fsm = manager.student_fsms.get(student_id)
        student_stats = manager.student_stats.get(student_id, {})

        # Send welcome with student-specific state
        step_names = [s["name"] for s in student_fsm.config["steps"]] if student_fsm else []
        welcome = {
            "type": "welcome",
            "server_version": VERSION,
            "experiment_name": student_fsm.config["name"] if student_fsm else "Unknown",
            "total_steps": student_fsm.total_steps if student_fsm else 0,
            "current_step": student_fsm.current_step_index if student_fsm else 0,
            "step_names": step_names,
            "step_info": student_fsm._build_step_info("en") if student_fsm else None,
            "model_loaded": detector is not None and detector.model is not None,
            "demo_mode": DEMO_MODE,
            "proxy_mode": PROXY_MODE,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await websocket.send_text(json.dumps(welcome))
        print(f"   [Main] Sent welcome to {student_id} (exp={welcome['experiment_name']}, steps={welcome['total_steps']})")

        # Notify dashboards
        await manager.broadcast_to_dashboards({
            "type": "student_connected",
            "student_id": student_id,
            "student_count": len(manager.student_connections),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        while True:
            try:
                raw = await websocket.receive_text()
            except Exception:
                break  # connection lost — exit loop cleanly
            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue
            if not isinstance(msg, dict):
                continue
            msg_type = msg.get("type", "")

            try:
                # ── LANGUAGE CHANGE ─────────────────────────
                if msg_type == "language_change":
                    language = msg.get("language", "en")
                    if not isinstance(language, str) or language not in ("en", "hi", "te", "ta"):
                        language = "en"
                    print(f"   [WS] Lang → {language} for {student_id}")

                    audio_url = None
                    if student_fsm:
                        student_fsm.intro_played_for_step = -1
                        info = student_fsm._build_step_info(language)
                        step = student_fsm.get_current_step()
                        if step and step.get("audio_intro"):
                            audio_url = f"/audio/{language}/{step['audio_intro']}.mp3"

                        await websocket.send_text(json.dumps({
                            "type": "language_updated",
                            "student_id": student_id,
                            "language": language,
                            "step_info": info,
                            "audio_url": audio_url
                        }))
                    continue

                # ── PING ────────────────────────────────────
                if msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong", "timestamp": datetime.now(timezone.utc).isoformat()}))
                    continue

                # ── FRAME ───────────────────────────────────
                if msg_type == "frame":
                    # Rate limit based on MAX_FPS
                    now = time.time()
                    if now - last_frame_time < min_frame_interval:
                        continue
                    last_frame_time = now

                    base64_data = msg.get("data", "")
                    if not isinstance(base64_data, str) or not base64_data:
                        continue

                    frame_lang = msg.get("language", language)
                    if isinstance(frame_lang, str) and frame_lang != language:
                        language = frame_lang

                    server_stats["frames_processed"] += 1
                    student_stats["frames_processed"] = student_stats.get("frames_processed", 0) + 1

                    # Detect objects
                    detections = []
                    frame_width, frame_height = 640, 480
                    try:
                        if detector and detector.model:
                            detections, frame_width, frame_height = detector.detect_base64(base64_data)
                            server_stats["total_detections"] += len(detections)
                            student_stats["detections_count"] = student_stats.get("detections_count", 0) + len(detections)
                    except Exception as e:
                        print(f"   [WS] Detection error for {student_id}: {e}")

                    # Process detections through student's FSM
                    fsm_result = {}
                    audio_url = None
                    try:
                        if student_fsm:
                            fsm_result = student_fsm.process_detections(detections, language)

                            audio_key = fsm_result.get("audio_to_play")
                            if audio_key:
                                audio_url = f"/audio/{language}/{audio_key}.mp3"

                            if fsm_result.get("step_advance"):
                                server_stats["step_advances"] += 1
                                student_stats["steps_completed"] = student_stats.get("steps_completed", 0) + 1
                                print(f"   [WS] Step advance for {student_id} → step {student_fsm.current_step_index}")
                                next_step = student_fsm.get_current_step()
                                if next_step and next_step.get("audio_intro") and not audio_url:
                                    audio_url = f"/audio/{language}/{next_step['audio_intro']}.mp3"
                                    student_fsm.intro_played_for_step = student_fsm.current_step_index

                            if fsm_result.get("safety_alert"):
                                server_stats["safety_alerts"] += 1
                                student_stats["safety_alerts_count"] = student_stats.get("safety_alerts_count", 0) + 1
                                print(f"   [WS] Safety alert for {student_id}")
                    except Exception as e:
                        print(f"   [WS] FSM error for {student_id}: {e}")

                    # Build response
                    step_info = fsm_result.get("step_info") or (student_fsm._build_step_info(language) if student_fsm else {})
                    ts = datetime.now(timezone.utc).isoformat()
                    response = {
                        "type": "detection_result",
                        "student_id": student_id,
                        "detections": detections,
                        "count": len(detections),
                        "frame_width": frame_width,
                        "frame_height": frame_height,
                        "step_info": step_info,
                        "safety_alert": fsm_result.get("safety_alert"),
                        "audio_url": audio_url,
                        "step_advance": fsm_result.get("step_advance", False),
                        "experiment_complete": fsm_result.get("experiment_complete", False),
                        "timestamp": ts,
                    }
                    await websocket.send_text(json.dumps(response))

                    # Broadcast to dashboards with rich per-student metrics
                    dashboard_msg = {
                        "type": "student_update",
                        "student_id": student_id,
                        "detections": detections,
                        "count": len(detections),
                        "step_info": step_info,
                        "safety_alert": fsm_result.get("safety_alert"),
                        "step_advance": fsm_result.get("step_advance", False),
                        "experiment_complete": fsm_result.get("experiment_complete", False),
                        "student_stats": manager.get_student_snapshot(student_id),
                        "timestamp": ts,
                    }
                    await manager.broadcast_to_dashboards(dashboard_msg)

            except WebSocketDisconnect:
                raise  # re-raise so outer handler runs cleanup
            except Exception as e:
                print(f"   [WS] Error processing message for {student_id}: {e}")

    except WebSocketDisconnect:
        print(f"   [Main] Student {student_id} disconnected normally")
    except Exception as e:
        print(f"   [Main] Student {student_id} WS error: {e}")
        traceback.print_exc()
    finally:
        if student_id:
            manager.disconnect_student(student_id)
            try:
                await manager.broadcast_to_dashboards({
                    "type": "student_disconnected",
                    "student_id": student_id,
                    "student_count": len(manager.student_connections),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
            except Exception:
                pass  # don't crash cleanup on broadcast failure


# ═══════════════════════════════════════════════════════════════════════
# WEBSOCKET — DASHBOARD
# ═══════════════════════════════════════════════════════════════════════
@app.websocket("/ws/dashboard")
async def ws_dashboard(websocket: WebSocket):
    await manager.connect_dashboard(websocket)
    try:
        # Send full state immediately
        init = {"type": "experiment_loaded", "timestamp": datetime.now(timezone.utc).isoformat()}
        if fsm:
            init.update(fsm.get_full_state())
        await websocket.send_text(json.dumps(init))
        print(f"   [Main] Dashboard init sent (exp={init.get('experiment_name', '?')})")

        while True:
            try:
                raw = await websocket.receive_text()
            except Exception:
                break
            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue
            if not isinstance(msg, dict):
                continue
            msg_type = msg.get("type", "")

            try:
                if msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong", "timestamp": datetime.now(timezone.utc).isoformat()}))
                elif msg_type == "request_state":
                    state = {"type": "experiment_loaded", "timestamp": datetime.now(timezone.utc).isoformat()}
                    if fsm:
                        state.update(fsm.get_full_state())
                    await websocket.send_text(json.dumps(state))
            except WebSocketDisconnect:
                raise
            except Exception as e:
                print(f"   [WS] Dashboard message error: {e}")

    except WebSocketDisconnect:
        print("   [Main] Dashboard disconnected normally")
    except Exception as e:
        print(f"   [Main] Dashboard WS error: {e}")
    finally:
        manager.disconnect_dashboard(websocket)


# ═══════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)