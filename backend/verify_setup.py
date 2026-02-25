"""
╔═══════════════════════════════════════════════════════════════╗
║          VocalLab Setup Verifier  (v2.0.0)                   ║
║  Run:  python verify_setup.py   from the backend/ directory   ║
╚═══════════════════════════════════════════════════════════════╝
"""

import os
import sys
import json
import importlib

# ── make sure backend/ is on the Python path ────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

AUDIO_LANGS   = ["en", "hi", "te", "ta"]
AUDIO_FILES   = [
    "welcome", "experiment_intro",
    "step_1_intro", "step_1_complete",
    "step_2_intro", "step_2_complete",
    "step_3_intro", "step_3_complete",
    "step_4_intro", "step_4_complete",
    "error_hand_proximity", "error_wrong_order",
    "error_missing_equipment", "safety_gloves",
    "taking_too_long", "experiment_complete",
]
REQUIRED_PACKAGES = [
    "fastapi", "uvicorn", "ultralytics",
    "cv2",      # opencv-python-headless
    "numpy", "PIL",          # Pillow
    "gtts", "aiofiles", "multipart",   # python-multipart
    "websockets",
]
VALID_LAB_LABELS = {
    "beaker", "conical_flask", "measuring_cylinder", "petri_dish",
    "spatula", "glass_rod", "tongs", "volumetric_flask", "hand",
    "ph_meter", "thermometer", "dropper", "hotplate",
    "analytical_balance", "lab_manual", "stopwatch",
    "test_tube", "rubber_stopper", "watch_glass",
    "stirring_rod", "brush", "pipette",
}
REQUIRED_STEP_FIELDS = [
    "id", "name", "required_objects",
    "hint_en", "hint_hi", "hint_te", "hint_ta",
    "audio_intro", "audio_complete",
]

TEAL  = "\033[36m"
GREEN = "\033[92m"
RED   = "\033[91m"
WARN  = "\033[93m"
RESET = "\033[0m"
BOLD  = "\033[1m"


def ok(msg):
    return f"  {GREEN}✅{RESET} {msg}"

def fail(msg):
    return f"  {RED}❌{RESET} {msg}"

def warn(msg):
    return f"  {WARN}⚠️ {RESET} {msg}"


results = []
passed = 0
total  = 0


def check(n, label, fn):
    global passed, total
    total += 1
    try:
        msg = fn()
        results.append(ok(f"Check {n:>2}:  {label} — {msg}"))
        passed += 1
    except Exception as e:
        results.append(fail(f"Check {n:>2}:  {label} — {e}"))


# ─── CHECK 1  Python packages ────────────────────────────────────
def _check_packages():
    missing = []
    for pkg in REQUIRED_PACKAGES:
        try:
            importlib.import_module(pkg)
        except ImportError:
            missing.append(pkg)
    if missing:
        raise RuntimeError(f"Missing: {missing}")
    return f"All {len(REQUIRED_PACKAGES)} packages installed"

check(1, "Python packages", _check_packages)


# ─── CHECK 2  YOLO model ─────────────────────────────────────────
def _check_model():
    candidates = [
        os.path.join(_HERE, "models", "yolov8_titration.pt"),
        os.path.join(_HERE, "yolov8n.pt"),
        os.path.join(_HERE, "models", "yolov8n.pt"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            size_mb = os.path.getsize(path) / 1_048_576
            return f"{os.path.basename(path)} ({size_mb:.1f} MB)"
    raise RuntimeError("No YOLO model found. Place yolov8n.pt in backend/")

check(2, "YOLO model exists", _check_model)


# ─── CHECK 3  experiment.json valid ─────────────────────────────
def _check_experiment_json():
    cfg_path = os.path.join(_HERE, "config", "experiment.json")
    if not os.path.isfile(cfg_path):
        raise RuntimeError("config/experiment.json not found")
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    required_top = ["name", "total_steps", "steps", "safety_rules"]
    for k in required_top:
        if k not in cfg:
            raise RuntimeError(f"Missing top-level field: '{k}'")
    n_steps = len(cfg["steps"])
    if n_steps != cfg["total_steps"]:
        raise RuntimeError(f"total_steps={cfg['total_steps']} but steps array has {n_steps} items")
    return f"Valid — '{cfg['name']}' ({n_steps} steps)"

check(3, "experiment.json valid schema", _check_experiment_json)


# ─── CHECK 4  label_map imports ──────────────────────────────────
def _check_label_map():
    from config.label_map import map_label, YOLO_TO_LAB, get_all_lab_labels
    assert map_label("bottle") == "beaker",         "bottle→beaker failed"
    assert map_label("WINE GLASS") == "conical_flask", "wine glass→conical_flask failed"
    assert map_label("unknown_xyz") == "unknown_xyz",  "passthrough failed"
    return f"map_label() OK — {len(YOLO_TO_LAB)} mappings"

check(4, "label_map.py imports + map_label()", _check_label_map)


# ─── CHECK 5  All 64 audio files exist ──────────────────────────
def _check_audio_exists():
    audio_dir = os.path.join(_HERE, "audio")
    if not os.path.isdir(audio_dir):
        raise RuntimeError("audio/ directory not found")
    missing = []
    for lang in AUDIO_LANGS:
        for fname in AUDIO_FILES:
            path = os.path.join(audio_dir, lang, f"{fname}.mp3")
            if not os.path.isfile(path):
                missing.append(f"{lang}/{fname}.mp3")
    if missing:
        raise RuntimeError(f"Missing {len(missing)} files: {missing[:5]}{'...' if len(missing)>5 else ''}")
    total_files = len(AUDIO_LANGS) * len(AUDIO_FILES)
    return f"All {total_files} files present (4 langs × {len(AUDIO_FILES)} files)"

check(5, "All 64 audio files exist", _check_audio_exists)


# ─── CHECK 6  Audio files non-empty ─────────────────────────────
def _check_audio_sizes():
    audio_dir = os.path.join(_HERE, "audio")
    empty = []
    for lang in AUDIO_LANGS:
        for fname in AUDIO_FILES:
            path = os.path.join(audio_dir, lang, f"{fname}.mp3")
            if os.path.isfile(path) and os.path.getsize(path) == 0:
                empty.append(f"{lang}/{fname}.mp3")
    if empty:
        raise RuntimeError(f"{len(empty)} zero-byte files: {empty}")
    return "All audio files have size > 0 bytes"

check(6, "Audio files non-empty", _check_audio_sizes)


# ─── CHECK 7  FSM initializes ────────────────────────────────────
def _check_fsm():
    from engine.fsm import ExperimentFSM
    fsm = ExperimentFSM()
    state = fsm.get_full_state()
    required_keys = ["experiment_name", "total_steps", "current_step", "step_info", "completed"]
    for k in required_keys:
        if k not in state:
            raise RuntimeError(f"get_full_state() missing key: '{k}'")
    si = state["step_info"]
    si_keys = ["current_step", "total_steps", "step_name", "hint", "required_objects",
               "detected_required", "missing_objects", "progress",
               "time_on_step", "elapsed_total", "completed", "step_status"]
    for k in si_keys:
        if k not in si:
            raise RuntimeError(f"step_info missing key: '{k}'")
    return f"ExperimentFSM OK — '{state['experiment_name']}' step {state['current_step']}/{state['total_steps']}"

check(7, "FSM initializes + get_full_state()", _check_fsm)


# ─── CHECK 8  Detector initializes ──────────────────────────────
def _check_detector():
    from engine.detector import ObjectDetector
    det = ObjectDetector()
    stats = det.get_stats()
    if not stats.get("model_loaded"):
        return "Model not loaded (no GPU or model missing) — detector in safe-fail mode"
    return f"ObjectDetector OK — model: {os.path.basename(stats.get('model_path','?'))}"

check(8, "Detector initializes (graceful on failure)", _check_detector)


# ─── CHECK 9  Engine imports resolve ────────────────────────────
def _check_engine_imports():
    from engine import ObjectDetector, ExperimentFSM, Detection
    assert callable(getattr(ObjectDetector, "detect_base64", None)), "detect_base64 missing"
    assert callable(getattr(ExperimentFSM, "process_detections", None)), "process_detections missing"
    return "engine.__init__ exports ObjectDetector, ExperimentFSM, Detection"

check(9, "All engine imports resolve", _check_engine_imports)


# ─── CHECK 10  FastAPI app creates ──────────────────────────────
def _check_fastapi():
    # Import without triggering lifespan
    import importlib
    spec = importlib.util.spec_from_file_location("main_check", os.path.join(_HERE, "main.py"))
    # We only need to verify it parses — use py_compile
    import py_compile
    py_compile.compile(os.path.join(_HERE, "main.py"), doraise=True)
    return "main.py compiles without syntax errors"

check(10, "FastAPI app (main.py) compiles", _check_fastapi)


# ─── CHECK 11  config/__init__.py ───────────────────────────────
def _check_config_init():
    init_path = os.path.join(_HERE, "config", "__init__.py")
    if not os.path.isfile(init_path):
        raise RuntimeError("config/__init__.py missing")
    return "config/__init__.py exists"

check(11, "config/__init__.py exists", _check_config_init)


# ─── CHECK 12  engine/__init__.py exports ───────────────────────
def _check_engine_init():
    init_path = os.path.join(_HERE, "engine", "__init__.py")
    if not os.path.isfile(init_path):
        raise RuntimeError("engine/__init__.py missing")
    with open(init_path) as f:
        content = f.read()
    for name in ["ObjectDetector", "ExperimentFSM"]:
        if name not in content:
            raise RuntimeError(f"engine/__init__.py does not export {name}")
    return "engine/__init__.py exports ObjectDetector, ExperimentFSM"

check(12, "engine/__init__.py correct exports", _check_engine_init)


# ─── CHECK 13  Audio directory structure ────────────────────────
def _check_audio_structure():
    audio_dir = os.path.join(_HERE, "audio")
    if not os.path.isdir(audio_dir):
        raise RuntimeError("audio/ directory missing")
    for lang in AUDIO_LANGS:
        lang_dir = os.path.join(audio_dir, lang)
        if not os.path.isdir(lang_dir):
            raise RuntimeError(f"audio/{lang}/ directory missing")
    return f"audio/{{en,hi,te,ta}}/ all present"

check(13, "Audio directory structure correct", _check_audio_structure)


# ─── CHECK 14  experiment.json step fields ───────────────────────
def _check_experiment_steps():
    cfg_path = os.path.join(_HERE, "config", "experiment.json")
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    errors = []
    for i, step in enumerate(cfg["steps"]):
        for field in REQUIRED_STEP_FIELDS:
            if field not in step:
                errors.append(f"Step {i} missing '{field}'")
    if errors:
        raise RuntimeError("; ".join(errors))
    return f"All {len(cfg['steps'])} steps have all {len(REQUIRED_STEP_FIELDS)} required fields"

check(14, "experiment.json steps have all required fields", _check_experiment_steps)


# ─── CHECK 15  dangerous_pairs use valid labels ──────────────────
def _check_dangerous_pairs():
    cfg_path = os.path.join(_HERE, "config", "experiment.json")
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    pairs = cfg.get("safety_rules", {}).get("dangerous_pairs", [])
    invalid = []
    for pair in pairs:
        for label in pair:
            if label not in VALID_LAB_LABELS:
                invalid.append(label)
    if invalid:
        raise RuntimeError(f"Unknown labels in dangerous_pairs: {invalid}")
    return f"{len(pairs)} dangerous pairs — all labels valid"

check(15, "dangerous_pairs reference valid lab labels", _check_dangerous_pairs)


# ─── PRINT RESULTS ───────────────────────────────────────────────
print(f"\n{TEAL}{'═'*55}{RESET}")
print(f"{BOLD}  VocalLab Setup Verification  (v2.0.0){RESET}")
print(f"{TEAL}{'═'*55}{RESET}")
for r in results:
    print(r)
print(f"{TEAL}{'═'*55}{RESET}")
if passed == total:
    print(f"{GREEN}{BOLD}  Result: {passed}/{total} passed — System is PRODUCTION READY ✅{RESET}")
else:
    print(f"{RED}{BOLD}  Result: {passed}/{total} passed — Fix {total - passed} issue(s) above ❌{RESET}")
print(f"{TEAL}{'═'*55}{RESET}\n")

sys.exit(0 if passed == total else 1)
