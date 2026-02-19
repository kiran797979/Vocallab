# backend/test_model.py
"""
Opens webcam, runs YOLOv8 model, shows bounding boxes with OpenCV.
Shows detection count + FPS counter.
Press 'q' to quit.
Press 's' to save screenshot.
Press '+'/'-' to adjust confidence threshold.
"""

import cv2
import time
import sys
import os
import numpy as np

# ── Try to load YOLO ──────────────────────────────────────────────────────
try:
    from ultralytics import YOLO
    print("[test_model] ✅ ultralytics imported successfully")
except ImportError:
    print("[test_model] ❌ ultralytics not installed. Run: pip install ultralytics")
    sys.exit(1)

# ── Configuration ─────────────────────────────────────────────────────────
MODEL_PATH = os.environ.get("YOLO_MODEL", "yolov8n.pt")
CONFIDENCE_THRESHOLD = 0.4
CAMERA_INDEX = 0
WINDOW_NAME = "VocalLab - YOLO Test"

# ── Color palette for bounding boxes ─────────────────────────────────────
COLORS = [
    (0, 212, 170),    # accent green
    (255, 107, 107),  # red
    (78, 205, 196),   # teal
    (255, 195, 0),    # yellow
    (108, 92, 231),   # purple
    (253, 121, 168),  # pink
    (0, 184, 148),    # green
    (9, 132, 227),    # blue
    (214, 48, 49),    # dark red
    (116, 185, 255),  # light blue
]


def get_color(class_id: int) -> tuple:
    """Get a consistent color for a class ID."""
    return COLORS[class_id % len(COLORS)]


def main():
    conf_threshold = CONFIDENCE_THRESHOLD

    print(f"[test_model] Loading model: {MODEL_PATH}")
    try:
        model = YOLO(MODEL_PATH)
        print(f"[test_model] ✅ Model loaded successfully")
        print(f"[test_model] Model classes: {len(model.names)} classes available")
    except Exception as e:
        print(f"[test_model] ❌ Failed to load model: {e}")
        sys.exit(1)

    print(f"[test_model] Opening camera index {CAMERA_INDEX}...")
    cap = cv2.VideoCapture(CAMERA_INDEX)

    if not cap.isOpened():
        print(f"[test_model] ❌ Could not open camera {CAMERA_INDEX}")
        print("[test_model] Try setting CAMERA_INDEX or check camera permissions")
        sys.exit(1)

    # Set camera resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"[test_model] ✅ Camera opened: {actual_w}x{actual_h}")
    print(f"[test_model] Confidence threshold: {conf_threshold}")
    print(f"[test_model] Controls:")
    print(f"           'q' = quit")
    print(f"           's' = save screenshot")
    print(f"           '+' = increase confidence threshold by 0.05")
    print(f"           '-' = decrease confidence threshold by 0.05")
    print("-" * 50)

    # FPS tracking
    fps = 0.0
    frame_count = 0
    fps_start_time = time.time()
    fps_update_interval = 0.5  # update FPS display every 0.5s

    # For periodic console logging
    last_log_time = time.time()
    log_interval = 2.0  # log to console every 2 seconds

    total_frames = 0
    app_start_time = time.time()

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[test_model] ❌ Failed to read frame from camera")
            break

        total_frames += 1

        # ── Run YOLO inference ──
        results = model(frame, conf=conf_threshold, verbose=False)
        result = results[0]

        # ── Parse detections ──
        detections = []
        if result.boxes is not None and len(result.boxes) > 0:
            for box in result.boxes:
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                cls_name = model.names.get(cls_id, f"class_{cls_id}")
                detections.append({
                    "bbox": (x1, y1, x2, y2),
                    "confidence": conf,
                    "class_id": cls_id,
                    "class_name": cls_name,
                })

        # ── Draw bounding boxes ──
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            color = get_color(det["class_id"])
            label = f'{det["class_name"]} {det["confidence"]:.2f}'

            # Draw box
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

            # Draw label background
            (label_w, label_h), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            cv2.rectangle(frame, (x1, y1 - label_h - 10), (x1 + label_w + 6, y1), color, -1)
            cv2.putText(frame, label, (x1 + 3, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

        # ── FPS Calculation ──
        frame_count += 1
        elapsed = time.time() - fps_start_time
        if elapsed >= fps_update_interval:
            fps = frame_count / elapsed
            frame_count = 0
            fps_start_time = time.time()

        # ── Draw HUD overlay ──
        # Dark banner at top
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (frame.shape[1], 70), (11, 17, 32), -1)
        frame = cv2.addWeighted(overlay, 0.8, frame, 0.2, 0)

        # Title
        cv2.putText(frame, "VocalLab YOLO Test", (15, 25),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 212, 170), 2)

        # FPS
        fps_color = (0, 255, 0) if fps >= 20 else (0, 255, 255) if fps >= 10 else (0, 0, 255)
        fps_text = f"FPS: {fps:.1f}"
        cv2.putText(frame, fps_text, (15, 50),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.55, fps_color, 1)

        # Confidence threshold
        conf_text = f"Conf: {conf_threshold:.2f}"
        cv2.putText(frame, conf_text, (15, 65),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.45, (148, 163, 184), 1)

        # Detection count (top right)
        det_text = f"Detections: {len(detections)}"
        (tw, _), _ = cv2.getTextSize(det_text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        cv2.putText(frame, det_text, (frame.shape[1] - tw - 15, 25),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 212, 170), 1)

        # Model name (top right, below detection count)
        model_text = f"Model: {os.path.basename(MODEL_PATH)}"
        (mw, _), _ = cv2.getTextSize(model_text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        cv2.putText(frame, model_text, (frame.shape[1] - mw - 15, 48),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 116, 139), 1)

        # Controls hint (top right, below model name)
        hint_text = "q=quit s=screenshot +/-=conf"
        (hw, _), _ = cv2.getTextSize(hint_text, cv2.FONT_HERSHEY_SIMPLEX, 0.35, 1)
        cv2.putText(frame, hint_text, (frame.shape[1] - hw - 15, 65),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.35, (100, 116, 139), 1)

        # ── Draw detection list at bottom ──
        if detections:
            list_y_start = frame.shape[0] - 10 - (len(detections) * 22)
            # Background
            overlay2 = frame.copy()
            cv2.rectangle(overlay2, (0, list_y_start - 10), (300, frame.shape[0]), (11, 17, 32), -1)
            frame = cv2.addWeighted(overlay2, 0.7, frame, 0.3, 0)

            for i, det in enumerate(detections):
                y_pos = list_y_start + (i * 22)
                color = get_color(det["class_id"])
                text = f"  {det['class_name']}: {det['confidence']:.2f}"
                cv2.circle(frame, (15, y_pos - 4), 5, color, -1)
                cv2.putText(frame, text, (25, y_pos), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 220, 220), 1)

        # ── Console logging every 2 seconds ──
        now = time.time()
        if now - last_log_time >= log_interval:
            last_log_time = now
            det_names = [d["class_name"] for d in detections]
            avg_fps = total_frames / (now - app_start_time) if (now - app_start_time) > 0 else 0
            if det_names:
                print(f"[test_model] FPS={fps:.1f} (avg {avg_fps:.1f}) | Detections={len(detections)} | Conf={conf_threshold:.2f} | Objects: {', '.join(det_names)}")
            else:
                print(f"[test_model] FPS={fps:.1f} (avg {avg_fps:.1f}) | No detections | Conf={conf_threshold:.2f}")

        # ── Show frame ──
        cv2.imshow(WINDOW_NAME, frame)

        # ── Key handling ──
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            print("\n[test_model] 'q' pressed — quitting...")
            break
        elif key == ord('s'):
            filename = f"screenshot_{int(time.time())}.jpg"
            cv2.imwrite(filename, frame)
            print(f"[test_model] 📸 Screenshot saved: {filename}")
        elif key == ord('+') or key == ord('='):
            conf_threshold = min(0.95, conf_threshold + 0.05)
            conf_threshold = round(conf_threshold, 2)
            print(f"[test_model] ⬆ Confidence threshold: {conf_threshold:.2f}")
        elif key == ord('-') or key == ord('_'):
            conf_threshold = max(0.05, conf_threshold - 0.05)
            conf_threshold = round(conf_threshold, 2)
            print(f"[test_model] ⬇ Confidence threshold: {conf_threshold:.2f}")

    # ── Cleanup ──
    total_time = time.time() - app_start_time
    avg_fps_final = total_frames / total_time if total_time > 0 else 0

    print("\n" + "=" * 50)
    print("[test_model] Session Summary")
    print(f"  Total frames:    {total_frames}")
    print(f"  Total time:      {total_time:.1f}s")
    print(f"  Average FPS:     {avg_fps_final:.1f}")
    print(f"  Model:           {os.path.basename(MODEL_PATH)}")
    print(f"  Final conf:      {conf_threshold:.2f}")
    print("=" * 50)

    cap.release()
    cv2.destroyAllWindows()
    print("[test_model] ✅ Cleanup complete. Goodbye!")


if __name__ == "__main__":
    main()