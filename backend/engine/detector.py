"""
VocalLab object detector — YOLO wrapper with lab-equipment label mapping.
PyTorch 2.6 weights_only patch applied before any ultralytics import.
"""
import os
import sys
import math
import logging
import base64
import traceback

# ── PyTorch 2.6 patch (MUST be before ultralytics import) ──────
import torch
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs["weights_only"] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load
# ────────────────────────────────────────────────────────────────

import numpy as np
import cv2
from ultralytics import YOLO

# Add backend root so config.label_map is importable
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_SCRIPT_DIR)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
from config.label_map import map_label

logger = logging.getLogger(__name__)


def _resolve_model_path():
    """Try models/yolov8_titration.pt → yolov8n.pt → models/yolov8n.pt → auto-download."""
    candidates = [
        os.path.join(_BACKEND_DIR, "models", "yolov8_titration.pt"),
        os.path.join(_BACKEND_DIR, "yolov8n.pt"),
        os.path.join(_BACKEND_DIR, "models", "yolov8n.pt"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            print(f"   [Detector] ✓ Found model: {path}")
            return path
    print("   [Detector] No local model; will use yolov8n.pt (auto-download)")
    return "yolov8n.pt"


class ObjectDetector:
    """YOLO-based detector with lab-equipment label mapping."""

    def __init__(self, model_path=None, confidence=0.30):
        self.confidence = confidence
        self.total_detections = 0
        self.total_frames = 0
        path = model_path or _resolve_model_path()
        print(f"   [Detector] Loading YOLO: {path} (conf={confidence})")
        try:
            self.model = YOLO(path)
            self.model_path = path
            # Warmup
            dummy = np.zeros((640, 640, 3), dtype=np.uint8)
            for _ in range(2):
                self.model.predict(dummy, verbose=False)
            print("   [Detector] Ready ✓")
        except Exception as e:
            print(f"   [Detector] FATAL — model load failed: {e}")
            traceback.print_exc()
            self.model = None
            self.model_path = path

    def detect_frame(self, frame: np.ndarray):
        """
        Run detection on a BGR numpy frame.
        Returns (detections_list, frame_width, frame_height).
        Each detection: {"label", "confidence", "bbox": [x1,y1,x2,y2], "center": [cx,cy]}
        bbox is in PIXEL coordinates of the original frame.
        """
        detections = []
        if frame is None or frame.size == 0:
            print("   [Detector] detect_frame: empty frame")
            return detections, 0, 0

        h, w = frame.shape[:2]
        self.total_frames += 1

        if self.model is None:
            print("   [Detector] detect_frame: model not loaded")
            return detections, w, h

        try:
            results = self.model.predict(
                frame,
                conf=self.confidence,
                verbose=False,
                imgsz=640,
            )
            if not results or len(results[0].boxes) == 0:
                return detections, w, h

            names = results[0].names or {}
            for box in results[0].boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf[0].item())
                cls_id = int(box.cls[0].item())
                yolo_name = names.get(cls_id, "unknown")
                lab_label = map_label(str(yolo_name))
                cx = (x1 + x2) / 2
                cy = (y1 + y2) / 2
                detections.append({
                    "label": lab_label,
                    "confidence": round(conf, 3),
                    "bbox": [int(x1), int(y1), int(x2), int(y2)],
                    "center": [round(cx, 1), round(cy, 1)],
                })

            self.total_detections += len(detections)
            if detections:
                labels = [d["label"] for d in detections]
                print(f"   [Detector] Frame {self.total_frames}: {len(detections)} objects → {labels}")
        except Exception as e:
            logger.exception("detect_frame failed: %s", e)
            print(f"   [Detector] detect_frame error: {e}")

        return detections, w, h

    def detect_base64(self, base64_string: str):
        """
        Decode base64 image → numpy → run detection.
        Returns (detections_list, frame_width, frame_height).
        """
        try:
            # Strip data URL prefix if present
            if "," in base64_string[:120]:
                base64_string = base64_string.split(",", 1)[1]
            raw = base64.b64decode(base64_string)
            np_arr = np.frombuffer(raw, dtype=np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if frame is None:
                print("   [Detector] detect_base64: cv2.imdecode returned None")
                return [], 0, 0
            return self.detect_frame(frame)
        except Exception as e:
            logger.exception("detect_base64 failed: %s", e)
            print(f"   [Detector] detect_base64 error: {e}")
            return [], 0, 0

    @staticmethod
    def distance_between(d1: dict, d2: dict) -> float:
        """Pixel distance between two detection centers."""
        c1 = d1.get("center", [0, 0])
        c2 = d2.get("center", [0, 0])
        if isinstance(c1, (list, tuple)) and len(c1) >= 2 and isinstance(c2, (list, tuple)) and len(c2) >= 2:
            return math.sqrt((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2)
        return float("inf")

    def get_stats(self) -> dict:
        return {
            "model_path": self.model_path if hasattr(self, "model_path") else None,
            "model_loaded": self.model is not None,
            "confidence_threshold": self.confidence,
            "total_frames_processed": self.total_frames,
            "total_detections": self.total_detections,
        }
