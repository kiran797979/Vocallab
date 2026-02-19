# backend/tune_thresholds.py
"""
Opens webcam, runs YOLO, draws lines between all detection pairs.
Shows pixel distance between each pair of objects.
Used to calibrate proximity thresholds in experiment.json.
Press 'q' to quit.
Press 's' to save screenshot with measurements.
"""

import cv2
import time
import sys
import os
import math
import numpy as np

try:
    from ultralytics import YOLO
    print("[tune] ✅ ultralytics imported successfully")
except ImportError:
    print("[tune] ❌ ultralytics not installed. Run: pip install ultralytics")
    sys.exit(1)

# ── Configuration ─────────────────────────────────────────────────────────
MODEL_PATH = os.environ.get("YOLO_MODEL", "yolov8n.pt")
CONFIDENCE_THRESHOLD = 0.4
CAMERA_INDEX = 0
WINDOW_NAME = "VocalLab - Threshold Tuner"

# ── Colors ────────────────────────────────────────────────────────────────
COLORS = [
    (0, 212, 170), (255, 107, 107), (78, 205, 196),
    (255, 195, 0), (108, 92, 231), (253, 121, 168),
    (0, 184, 148), (9, 132, 227), (214, 48, 49), (116, 185, 255),
]

# Distance line colors based on proximity
DIST_CLOSE = (0, 0, 255)      # Red = very close (danger)
DIST_MEDIUM = (0, 165, 255)   # Orange = medium
DIST_FAR = (0, 255, 0)        # Green = far (safe)

CLOSE_THRESHOLD = 100   # pixels
MEDIUM_THRESHOLD = 200  # pixels


def get_color(class_id: int) -> tuple:
    return COLORS[class_id % len(COLORS)]


def get_center(bbox):
    """Get center point of bounding box."""
    x1, y1, x2, y2 = bbox
    return (int((x1 + x2) / 2), int((y1 + y2) / 2))


def get_distance(p1, p2):
    """Euclidean distance between two points."""
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)


def get_distance_color(dist):
    """Color based on distance."""
    if dist < CLOSE_THRESHOLD:
        return DIST_CLOSE
    elif dist < MEDIUM_THRESHOLD:
        return DIST_MEDIUM
    else:
        return DIST_FAR


def main():
    conf_threshold = CONFIDENCE_THRESHOLD

    print(f"[tune] Loading model: {MODEL_PATH}")
    try:
        model = YOLO(MODEL_PATH)
        print(f"[tune] ✅ Model loaded successfully")
    except Exception as e:
        print(f"[tune] ❌ Failed to load model: {e}")
        sys.exit(1)

    print(f"[tune] Opening camera index {CAMERA_INDEX}...")
    cap = cv2.VideoCapture(CAMERA_INDEX)

    if not cap.isOpened():
        print(f"[tune] ❌ Could not open camera {CAMERA_INDEX}")
        sys.exit(1)

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"[tune] ✅ Camera opened: {actual_w}x{actual_h}")
    print(f"[tune] Distance thresholds:")
    print(f"       🔴 CLOSE  < {CLOSE_THRESHOLD}px (danger zone)")
    print(f"       🟠 MEDIUM < {MEDIUM_THRESHOLD}px (warning)")
    print(f"       🟢 FAR    >= {MEDIUM_THRESHOLD}px (safe)")
    print(f"[tune] Controls:")
    print(f"       'q' = quit")
    print(f"       's' = save screenshot")
    print(f"       '+'/'-' = adjust confidence")
    print("-" * 50)

    # FPS tracking
    fps = 0.0
    frame_count = 0
    fps_start_time = time.time()

    # Logging
    last_log_time = time.time()
    min_distance_seen = float('inf')
    max_distance_seen = 0.0

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[tune] ❌ Failed to read frame")
            break

        # ── Run YOLO ──
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
                center = get_center((x1, y1, x2, y2))
                detections.append({
                    "bbox": (x1, y1, x2, y2),
                    "confidence": conf,
                    "class_id": cls_id,
                    "class_name": cls_name,
                    "center": center,
                })

        # ── Draw bounding boxes ──
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            color = get_color(det["class_id"])
            label = f'{det["class_name"]} {det["confidence"]:.2f}'

            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

            (label_w, label_h), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
            cv2.rectangle(frame, (x1, y1 - label_h - 10), (x1 + label_w + 6, y1), color, -1)
            cv2.putText(frame, label, (x1 + 3, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 2)

            # Draw center dot
            cv2.circle(frame, det["center"], 5, color, -1)
            cv2.circle(frame, det["center"], 7, color, 2)

        # ── Draw lines between ALL pairs ──
        pair_distances = []
        for i in range(len(detections)):
            for j in range(i + 1, len(detections)):
                det_a = detections[i]
                det_b = detections[j]
                dist = get_distance(det_a["center"], det_b["center"])
                pair_distances.append({
                    "a_name": det_a["class_name"],
                    "b_name": det_b["class_name"],
                    "a_center": det_a["center"],
                    "b_center": det_b["center"],
                    "distance": dist,
                })

                # Track min/max
                if dist < min_distance_seen:
                    min_distance_seen = dist
                if dist > max_distance_seen:
                    max_distance_seen = dist

                # Line color based on distance
                line_color = get_distance_color(dist)
                thickness = 3 if dist < CLOSE_THRESHOLD else 2 if dist < MEDIUM_THRESHOLD else 1

                # Draw line
                cv2.line(frame, det_a["center"], det_b["center"], line_color, thickness)

                # Draw distance label at midpoint
                mid_x = int((det_a["center"][0] + det_b["center"][0]) / 2)
                mid_y = int((det_a["center"][1] + det_b["center"][1]) / 2)

                dist_label = f"{dist:.0f}px"
                pair_label = f"{det_a['class_name']}<->{det_b['class_name']}"

                # Background for distance text
                (dw, dh), _ = cv2.getTextSize(dist_label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
                cv2.rectangle(frame, (mid_x - 5, mid_y - dh - 8), (mid_x + dw + 5, mid_y + 5), (11, 17, 32), -1)
                cv2.putText(frame, dist_label, (mid_x, mid_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, line_color, 2)

                # Pair names slightly below
                (pw, ph), _ = cv2.getTextSize(pair_label, cv2.FONT_HERSHEY_SIMPLEX, 0.35, 1)
                cv2.putText(frame, pair_label, (mid_x - int(pw / 2), mid_y + 18),
                             cv2.FONT_HERSHEY_SIMPLEX, 0.35, (148, 163, 184), 1)

        # ── FPS ──
        frame_count += 1
        elapsed = time.time() - fps_start_time
        if elapsed >= 0.5:
            fps = frame_count / elapsed
            frame_count = 0
            fps_start_time = time.time()

        # ── HUD overlay ──
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (frame.shape[1], 80), (11, 17, 32), -1)
        frame = cv2.addWeighted(overlay, 0.8, frame, 0.2, 0)

        # Title
        cv2.putText(frame, "VocalLab Threshold Tuner", (15, 25),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 212, 170), 2)

        # Stats line 1
        cv2.putText(frame, f"FPS: {fps:.1f}  |  Objects: {len(detections)}  |  Pairs: {len(pair_distances)}",
                     (15, 48), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (148, 163, 184), 1)

        # Stats line 2
        cv2.putText(frame, f"Conf: {conf_threshold:.2f}  |  Min dist: {min_distance_seen:.0f}px  |  Max dist: {max_distance_seen:.0f}px",
                     (15, 68), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 116, 139), 1)

        # Legend (top right)
        legend_x = frame.shape[1] - 220
        cv2.putText(frame, "Distance Legend:", (legend_x, 20),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)
        cv2.circle(frame, (legend_x + 8, 35), 5, DIST_CLOSE, -1)
        cv2.putText(frame, f"< {CLOSE_THRESHOLD}px DANGER", (legend_x + 20, 40),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.35, DIST_CLOSE, 1)
        cv2.circle(frame, (legend_x + 8, 52), 5, DIST_MEDIUM, -1)
        cv2.putText(frame, f"< {MEDIUM_THRESHOLD}px WARNING", (legend_x + 20, 57),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.35, DIST_MEDIUM, 1)
        cv2.circle(frame, (legend_x + 8, 69), 5, DIST_FAR, -1)
        cv2.putText(frame, f">= {MEDIUM_THRESHOLD}px SAFE", (legend_x + 20, 74),
                     cv2.FONT_HERSHEY_SIMPLEX, 0.35, DIST_FAR, 1)

        # ── Right side panel: pair distance list ──
        if pair_distances:
            panel_x = frame.shape[1] - 320
            panel_y_start = 90
            panel_height = len(pair_distances) * 25 + 15

            overlay3 = frame.copy()
            cv2.rectangle(overlay3, (panel_x - 10, panel_y_start - 5),
                          (frame.shape[1], panel_y_start + panel_height), (11, 17, 32), -1)
            frame = cv2.addWeighted(overlay3, 0.75, frame, 0.25, 0)

            cv2.putText(frame, "PAIR DISTANCES:", (panel_x, panel_y_start + 12),
                         cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 212, 170), 1)

            sorted_pairs = sorted(pair_distances, key=lambda p: p["distance"])
            for idx, pair in enumerate(sorted_pairs):
                y = panel_y_start + 30 + (idx * 25)
                dist_color = get_distance_color(pair["distance"])
                icon = "!!" if pair["distance"] < CLOSE_THRESHOLD else "! " if pair["distance"] < MEDIUM_THRESHOLD else "  "
                text = f"{icon} {pair['a_name']} <-> {pair['b_name']}: {pair['distance']:.0f}px"
                cv2.putText(frame, text, (panel_x, y),
                             cv2.FONT_HERSHEY_SIMPLEX, 0.4, dist_color, 1)

        # ── Console logging ──
        now = time.time()
        if now - last_log_time >= 2.0:
            last_log_time = now
            if pair_distances:
                print(f"\n[tune] === Distance Report (FPS={fps:.1f}, Conf={conf_threshold:.2f}) ===")
                sorted_pairs = sorted(pair_distances, key=lambda p: p["distance"])
                for pair in sorted_pairs:
                    status = "🔴 CLOSE" if pair["distance"] < CLOSE_THRESHOLD else "🟠 MEDIUM" if pair["distance"] < MEDIUM_THRESHOLD else "🟢 FAR"
                    print(f"  {status} {pair['a_name']} <-> {pair['b_name']}: {pair['distance']:.0f}px")
                print(f"  📏 Range: {min_distance_seen:.0f}px — {max_distance_seen:.0f}px")
            else:
                obj_names = [d["class_name"] for d in detections]
                if obj_names:
                    print(f"[tune] Objects: {', '.join(obj_names)} (need 2+ for distance)")
                else:
                    print(f"[tune] No detections (FPS={fps:.1f})")

        # ── Show ──
        cv2.imshow(WINDOW_NAME, frame)

        # ── Keys ──
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            print("\n[tune] 'q' pressed — quitting...")
            break
        elif key == ord('s'):
            filename = f"tune_screenshot_{int(time.time())}.jpg"
            cv2.imwrite(filename, frame)
            print(f"[tune] 📸 Screenshot saved: {filename}")
        elif key == ord('+') or key == ord('='):
            conf_threshold = min(0.95, round(conf_threshold + 0.05, 2))
            print(f"[tune] ⬆ Confidence: {conf_threshold:.2f}")
        elif key == ord('-') or key == ord('_'):
            conf_threshold = max(0.05, round(conf_threshold - 0.05, 2))
            print(f"[tune] ⬇ Confidence: {conf_threshold:.2f}")

    # ── Summary ──
    print("\n" + "=" * 55)
    print("[tune] 📐 THRESHOLD TUNING SUMMARY")
    print(f"  Min distance seen:  {min_distance_seen:.0f}px")
    print(f"  Max distance seen:  {max_distance_seen:.0f}px")
    print(f"")
    print(f"  💡 RECOMMENDATION for experiment.json:")
    print(f"     Set 'proximity_threshold' to: {max(50, min_distance_seen * 1.2):.0f}")
    print(f"     (120% of smallest distance observed)")
    print("=" * 55)

    cap.release()
    cv2.destroyAllWindows()
    print("[tune] ✅ Done!")


if __name__ == "__main__":
    main()