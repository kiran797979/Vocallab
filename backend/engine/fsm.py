"""
VocalLab Experiment FSM — loads config/experiment.json, processes detections,
tracks step progress, safety alerts, and step advancement.
"""
import json
import math
import time
import os
from typing import Optional, List, Dict, Any


class Detection:
    """Single detection with class_name, confidence, bbox, and center."""
    __slots__ = ("class_name", "confidence", "bbox", "cx", "cy")

    def __init__(self, class_name: str, confidence: float, bbox: list, cx: float = 0.0, cy: float = 0.0):
        self.class_name = class_name
        self.confidence = confidence
        self.bbox = bbox if bbox else [0, 0, 0, 0]
        if bbox and len(bbox) >= 4:
            self.cx = (bbox[0] + bbox[2]) / 2
            self.cy = (bbox[1] + bbox[3]) / 2
        else:
            self.cx = cx
            self.cy = cy


def _detections_from_dicts(det_list: List[Dict]) -> List[Detection]:
    """Convert detector output dicts to Detection objects."""
    out = []
    for d in (det_list or []):
        label = d.get("label") or d.get("class_name", "unknown")
        bbox = d.get("bbox", [0, 0, 0, 0])
        center = d.get("center")
        if isinstance(center, (list, tuple)) and len(center) >= 2:
            cx, cy = center[0], center[1]
        elif bbox and len(bbox) >= 4:
            cx = (bbox[0] + bbox[2]) / 2
            cy = (bbox[1] + bbox[3]) / 2
        else:
            cx, cy = 0.0, 0.0
        out.append(Detection(
            class_name=label,
            confidence=float(d.get("confidence", 0)),
            bbox=list(bbox) if bbox else [0, 0, 0, 0],
            cx=cx, cy=cy,
        ))
    return out


def _distance(a: Detection, b: Detection) -> float:
    return math.sqrt((a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2)


_HINT_KEYS = {"en": "hint_en", "hi": "hint_hi", "te": "hint_te", "ta": "hint_ta"}


class ExperimentFSM:
    """Finite state machine for chemistry experiment steps."""

    def __init__(self, config_path: str = None):
        if config_path is None:
            backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            config_path = os.path.join(backend, "config", "experiment.json")
        with open(config_path, "r", encoding="utf-8") as f:
            self.config = json.load(f)
        self.config_path = config_path
        self.steps = self.config["steps"]
        self.total_steps = self.config["total_steps"]
        self.current_step_index = 0
        self.stable_count = 0
        self.stable_frames_required = 3   # 3 consecutive for faster demo
        self.step_start_time = time.time()
        self.experiment_start_time = time.time()
        self.completed = False
        self.last_safety_alert_time = 0.0
        self.step_advances = 0
        self.safety_alerts_count = 0

        # Safety rules
        self.safety_rules = self.config.get("safety_rules") or {}
        self.proximity_threshold = self.safety_rules.get("proximity_threshold", 150)
        self.alert_cooldown_seconds = self.safety_rules.get("alert_cooldown_seconds", 3)
        self.dangerous_pairs = self.safety_rules.get("dangerous_pairs") or []

        print(f"   [FSM] Loaded: {self.config['name']} ({self.total_steps} steps, {self.stable_frames_required} frames to advance)")

    def get_current_step(self) -> Optional[Dict]:
        if self.completed or self.current_step_index >= len(self.steps):
            return None
        return self.steps[self.current_step_index]

    def _build_step_info(self, language: str = "en", detected_labels: set = None) -> Dict:
        """Build step_info dict with ALL fields the mobile app needs."""
        if self.completed or self.current_step_index >= len(self.steps):
            return {
                "current_step": self.total_steps,
                "total_steps": self.total_steps,
                "step_name": "Experiment Complete!",
                "hint": "All steps completed successfully!",
                "required_objects": [],
                "detected_required": [],
                "missing_objects": [],
                "progress": 100.0,
                "time_on_step": 0,
                "elapsed_total": round(time.time() - self.experiment_start_time, 1),
                "completed": True,
                "step_status": "completed",
            }

        step = self.steps[self.current_step_index]
        required = step.get("required_objects", [])
        detected_labels = detected_labels or set()
        detected_required = [obj for obj in required if obj in detected_labels]
        missing_objects = [obj for obj in required if obj not in detected_labels]

        # Within-step progress
        progress = round((len(detected_required) / len(required)) * 100, 1) if required else 100.0

        # Hint based on language
        hint_key = _HINT_KEYS.get(language, "hint_en")
        hint = step.get(hint_key, step.get("hint_en", ""))

        return {
            "current_step": self.current_step_index,
            "total_steps": self.total_steps,
            "step_name": step["name"],
            "hint": hint,
            "required_objects": list(required),
            "detected_required": detected_required,
            "missing_objects": missing_objects,
            "progress": progress,
            "time_on_step": round(time.time() - self.step_start_time, 1),
            "elapsed_total": round(time.time() - self.experiment_start_time, 1),
            "completed": False,
            "step_status": "active",
        }

    def _check_safety(self, detections: List[Detection]) -> Optional[Dict]:
        now = time.time()
        if now - self.last_safety_alert_time < self.alert_cooldown_seconds:
            return None
        det_by_label = {}
        for d in detections:
            det_by_label[d.class_name] = d
        for pair in self.dangerous_pairs:
            a, b = pair[0], pair[1]
            obj_a = det_by_label.get(a)
            obj_b = det_by_label.get(b)
            if not obj_a or not obj_b:
                continue
            dist = _distance(obj_a, obj_b)
            if dist < self.proximity_threshold:
                self.last_safety_alert_time = now
                self.safety_alerts_count += 1
                print(f"   [FSM] ⚠️ SAFETY: {a} too close to {b} ({dist:.0f}px < {self.proximity_threshold}px)")
                return {
                    "severity": "high",
                    "message": f"Keep hands away from {b}!",
                    "pair": [a, b],
                    "distance_px": round(dist, 1),
                    "threshold_px": self.proximity_threshold,
                }
        return None

    def process_detections(self, detections: List[Dict], language: str = "en") -> Dict[str, Any]:
        """Process detection dicts from detector. Returns full result dict."""
        detected_labels = set()
        for d in (detections or []):
            label = d.get("label") or d.get("class_name", "")
            if label:
                detected_labels.add(label)

        result = {
            "step_info": self._build_step_info(language, detected_labels),
            "safety_alert": None,
            "step_advance": False,
            "audio_to_play": None,
            "experiment_complete": False,
        }

        if self.completed:
            result["experiment_complete"] = True
            result["step_info"] = self._build_step_info(language, detected_labels)
            return result

        dets = _detections_from_dicts(detections)

        # 1) Safety check
        safety = self._check_safety(dets)
        if safety:
            result["safety_alert"] = safety
            result["audio_to_play"] = "error_hand_proximity"
            return result

        # 2) Step completion check
        step = self.get_current_step()
        if step is None:
            self.completed = True
            result["experiment_complete"] = True
            result["step_info"] = self._build_step_info(language, detected_labels)
            return result

        required = set(step.get("required_objects") or [])
        det_label_set = {d.class_name for d in dets}

        if not required.issubset(det_label_set):
            self.stable_count = 0
            return result

        self.stable_count += 1
        print(f"   [FSM] Step {self.current_step_index} stable {self.stable_count}/{self.stable_frames_required}")

        if self.stable_count < self.stable_frames_required:
            return result

        # STEP ADVANCE
        self.stable_count = 0
        completed_step = step
        self.current_step_index += 1
        self.step_start_time = time.time()
        self.step_advances += 1

        result["step_advance"] = True
        result["audio_to_play"] = completed_step.get("audio_complete")

        print(f"   [FSM] ✅ Step '{completed_step['name']}' COMPLETE → step {self.current_step_index}")

        if self.current_step_index >= len(self.steps):
            self.completed = True
            result["experiment_complete"] = True
            print("   [FSM] 🎉 EXPERIMENT COMPLETE!")
        else:
            next_step = self.steps[self.current_step_index]
            print(f"   [FSM] Next: '{next_step['name']}' needs {next_step.get('required_objects', [])}")

        result["step_info"] = self._build_step_info(language, set())
        return result

    def get_full_state(self, language: str = "en") -> Dict:
        return {
            "experiment_name": self.config["name"],
            "total_steps": self.total_steps,
            "current_step": self.current_step_index,
            "step_info": self._build_step_info(language),
            "completed": self.completed,
        }

    def reset(self):
        print("   [FSM] Resetting to step 0")
        self.__init__(config_path=self.config_path)

    def get_stats(self) -> dict:
        return {
            "current_step": self.current_step_index,
            "total_steps": self.total_steps,
            "completed": self.completed,
            "step_advances": self.step_advances,
            "safety_alerts": self.safety_alerts_count,
            "elapsed_total": round(time.time() - self.experiment_start_time, 1),
        }
