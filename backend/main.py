"""
╔═══════════════════════════════════════════════════════════════╗
║   VocalLab — AI Chemistry Lab Instructor   (Backend v2.0)    ║
║   FastAPI + YOLOv8 + WebSocket + Multi-language              ║
╚═══════════════════════════════════════════════════════════════╝

PyTorch 2.6 weights_only patch applied at top.
"""

# ── PyTorch 2.6 safety patch — MUST be before any ultralytics / torch import ──
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
from typing import List

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

# ═══════════════════════════════════════════════════════════════════════
# GLOBALS
# ═══════════════════════════════════════════════════════════════════════
VERSION = "2.0.0"
detector: ObjectDetector = None
fsm: ExperimentFSM = None

server_stats = {
    "start_time": time.time(),
    "frames_processed": 0,
    "total_detections": 0,
    "step_advances": 0,
    "safety_alerts": 0,
}


# ═══════════════════════════════════════════════════════════════════════
# CONNECTION MANAGER
# ═══════════════════════════════════════════════════════════════════════
class ConnectionManager:
    def __init__(self):
        self.student_connections: List[WebSocket] = []
        self.dashboard_connections: List[WebSocket] = []

    async def connect_student(self, ws: WebSocket):
        await ws.accept()
        self.student_connections.append(ws)
        print(f"   [CM] Student connected (total: {len(self.student_connections)})")

    async def connect_dashboard(self, ws: WebSocket):
        await ws.accept()
        self.dashboard_connections.append(ws)
        print(f"   [CM] Dashboard connected (total: {len(self.dashboard_connections)})")

    def disconnect_student(self, ws: WebSocket):
        if ws in self.student_connections:
            self.student_connections.remove(ws)
        print(f"   [CM] Student disconnected (total: {len(self.student_connections)})")

    def disconnect_dashboard(self, ws: WebSocket):
        if ws in self.dashboard_connections:
            self.dashboard_connections.remove(ws)
        print(f"   [CM] Dashboard disconnected (total: {len(self.dashboard_connections)})")

    async def broadcast_to_dashboards(self, message: dict):
        """Send JSON to all dashboard clients. Remove dead connections."""
        if not self.dashboard_connections:
            return
        text = json.dumps(message)
        dead = []
        for ws in self.dashboard_connections:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect_dashboard(ws)

    async def broadcast_to_students(self, message: dict):
        if not self.student_connections:
            return
        text = json.dumps(message)
        dead = []
        for ws in self.student_connections:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect_student(ws)


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
        detector = ObjectDetector()
        print("   [Main] Detector OK ✓")
    except Exception as e:
        print(f"   [Main] Detector FAILED: {e}")
        traceback.print_exc()
        detector = None

    # Load FSM
    try:
        fsm = ExperimentFSM()
        print("   [Main] FSM OK ✓")
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
    return {"steps": fsm.steps, "total": fsm.total_steps}


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
    if not fsm:
        raise HTTPException(500, "FSM not loaded")
    fsm.reset()
    server_stats["step_advances"] = 0
    server_stats["safety_alerts"] = 0
    await manager.broadcast_to_dashboards({
        "type": "experiment_reset",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **fsm.get_full_state(),
    })
    await manager.broadcast_to_students({
        "type": "welcome",
        "server_version": VERSION,
        "experiment_name": fsm.config["name"],
        "total_steps": fsm.total_steps,
        "current_step": fsm.current_step_index,
        "step_info": fsm._build_step_info("en"),
        "model_loaded": detector is not None and detector.model is not None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"status": "reset", "state": fsm.get_full_state()}


@app.get("/stats")
async def server_statistics():
    return {
        **server_stats,
        "uptime": round(time.time() - server_stats["start_time"], 1),
        "students_connected": len(manager.student_connections),
        "dashboards_connected": len(manager.dashboard_connections),
        "detector": detector.get_stats() if detector else None,
        "fsm": fsm.get_stats() if fsm else None,
    }


# ═══════════════════════════════════════════════════════════════════════
# WEBSOCKET — STUDENT
# ═══════════════════════════════════════════════════════════════════════
@app.websocket("/ws/student")
async def ws_student(websocket: WebSocket):
    await manager.connect_student(websocket)
    language = "en"
    last_frame_time = 0.0
    min_frame_interval = 0.5   # max 2 fps
    student_stats = {"frames": 0, "detections": 0, "alerts": 0}

    try:
        # ── Send welcome with COMPLETE experiment info ───
        step_names = [s["name"] for s in fsm.steps] if fsm else []
        welcome = {
            "type": "welcome",
            "server_version": VERSION,
            "experiment_name": fsm.config["name"] if fsm else "Unknown",
            "total_steps": fsm.total_steps if fsm else 0,
            "current_step": fsm.current_step_index if fsm else 0,
            "step_names": step_names,
            "step_info": fsm._build_step_info(language) if fsm else None,
            "model_loaded": detector is not None and detector.model is not None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await websocket.send_text(json.dumps(welcome))
        print(f"   [Main] Sent welcome (exp={welcome['experiment_name']}, steps={welcome['total_steps']})")

        # Notify dashboards
        await manager.broadcast_to_dashboards({
            "type": "student_connected",
            "student_count": len(manager.student_connections),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            msg_type = msg.get("type", "")

            # ── LANGUAGE CHANGE ─────────────────────────
            if msg_type == "language_change":
                language = msg.get("language", "en")
                print(f"   [Main] Language changed to: {language}")
                
                audio_url = None
                if fsm:
                    # Reset intro tracker so it can play in the new language
                    fsm.intro_played_for_step = -1 
                    
                    info = fsm._build_step_info(language)
                    step = fsm.get_current_step()
                    if step and step.get("audio_intro"):
                        audio_url = f"/audio/{language}/{step['audio_intro']}.mp3"
                    
                    await websocket.send_text(json.dumps({
                        "type": "language_updated",
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
                # Rate limit
                now = time.time()
                if now - last_frame_time < min_frame_interval:
                    continue
                last_frame_time = now

                base64_data = msg.get("data", "")
                if not base64_data:
                    continue

                frame_lang = msg.get("language", language)
                if frame_lang != language:
                    language = frame_lang

                server_stats["frames_processed"] += 1
                student_stats["frames"] += 1

                # Detect
                detections = []
                frame_width, frame_height = 640, 480
                try:
                    if detector and detector.model:
                        detections, frame_width, frame_height = detector.detect_base64(base64_data)
                        server_stats["total_detections"] += len(detections)
                        student_stats["detections"] += len(detections)
                except Exception as e:
                    print(f"   [Main] Detection error: {e}")

                # FSM
                fsm_result = {}
                audio_url = None
                try:
                    if fsm:
                        fsm_result = fsm.process_detections(detections, language)

                        # Build audio URL
                        audio_key = fsm_result.get("audio_to_play")
                        if audio_key:
                            audio_url = f"/audio/{language}/{audio_key}.mp3"

                        if fsm_result.get("step_advance"):
                            server_stats["step_advances"] += 1
                            # Immediately queue the next step's intro audio
                            next_step = fsm.get_current_step()
                            if next_step and next_step.get("audio_intro") and not audio_url:
                                audio_url = f"/audio/{language}/{next_step['audio_intro']}.mp3"
                                fsm.intro_played_for_step = fsm.current_step_index

                        if fsm_result.get("safety_alert"):
                            server_stats["safety_alerts"] += 1
                            student_stats["alerts"] += 1
                except Exception as e:
                    print(f"   [Main] FSM error: {e}")
                    traceback.print_exc()

                # Build response
                step_info = fsm_result.get("step_info") or (fsm._build_step_info(language) if fsm else {})
                response = {
                    "type": "detection_result",
                    "detections": detections,
                    "count": len(detections),
                    "frame_width": frame_width,
                    "frame_height": frame_height,
                    "step_info": step_info,
                    "safety_alert": fsm_result.get("safety_alert"),
                    "audio_url": audio_url,
                    "step_advance": fsm_result.get("step_advance", False),
                    "experiment_complete": fsm_result.get("experiment_complete", False),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                await websocket.send_text(json.dumps(response))

                # Broadcast to dashboards
                dashboard_msg = {
                    "type": "student_update",
                    "detections": detections,
                    "count": len(detections),
                    "step_info": step_info,
                    "safety_alert": fsm_result.get("safety_alert"),
                    "step_advance": fsm_result.get("step_advance", False),
                    "experiment_complete": fsm_result.get("experiment_complete", False),
                    "student_stats": student_stats,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                await manager.broadcast_to_dashboards(dashboard_msg)

    except WebSocketDisconnect:
        print("   [Main] Student disconnected normally")
    except Exception as e:
        print(f"   [Main] Student WS error: {e}")
        traceback.print_exc()
    finally:
        manager.disconnect_student(websocket)
        await manager.broadcast_to_dashboards({
            "type": "student_disconnected",
            "student_count": len(manager.student_connections),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })


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
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            msg_type = msg.get("type", "")

            if msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong", "timestamp": datetime.now(timezone.utc).isoformat()}))
            elif msg_type == "request_state":
                state = {"type": "experiment_loaded", "timestamp": datetime.now(timezone.utc).isoformat()}
                if fsm:
                    state.update(fsm.get_full_state())
                await websocket.send_text(json.dumps(state))

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
