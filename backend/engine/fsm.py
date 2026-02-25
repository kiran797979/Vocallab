"""
╔═══════════════════════════════════════════════════════════════╗
║          VocalLab — Experiment FSM  (v2.1.0)                 ║
║  Finite State Machine for step-by-step lab guidance          ║
║                                                              ║
║  TRANSITION FLOW (v2.1):                                     ║
║    active  → (3 stable frames all required detected)         ║
║    transition → (play transition audio, wait for REMOVAL)    ║
║    removal detected → advance step → active (next step)      ║
╚═══════════════════════════════════════════════════════════════╝
"""

import os
import json
import time
import threading

# ── config paths ─────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
_CFG_PATH = os.path.join(_HERE, "..", "config", "experiment.json")

# ── language key maps ─────────────────────────────────────────────────────
_HINT_KEYS = {"en": "hint_en", "hi": "hint_hi", "te": "hint_te", "ta": "hint_ta"}
_TRANSITION_KEYS = {"en": "transition_en", "hi": "transition_hi", "te": "transition_te", "ta": "transition_ta"}

# ── stability / timing constants ──────────────────────────────────────────
FRAMES_TO_ADVANCE  = 3   # consecutive frames ALL required objects must be present
REMOVAL_FRAMES     = 2   # consecutive frames with NO required objects to end transition


class ExperimentFSM:
    """
    Manages experiment state, step transitions, and safety checks.

    Step lifecycle
    ──────────────
    1.  "active"     — student must bring all required_objects into frame.
    2.  "transition" — triggered after FRAMES_TO_ADVANCE stable frames.
                       Plays transition audio and waits for student to
                       REMOVE all required objects from frame.
    3.  Removal detected for REMOVAL_FRAMES frames → step advances.
    4.  New step starts in "active" state (intro audio plays on first detect).
    5.  Last step (id == total_steps-1) transitions directly to experiment_complete.
    """

    def __init__(self, config_path: str = _CFG_PATH):
        self.config = self._load_config(config_path)
        self.total_steps = self.config["total_steps"]
        self._lock = threading.Lock()

        # ── timing ─────────────────────────────────────────────────────
        self.start_time    = time.time()
        self.step_start    = time.time()

        # ── step state ─────────────────────────────────────────────────
        self.current_step_index   = 0
        self.stable_count         = 0   # frames with all required objects present
        self.removal_count        = 0   # frames with no required objects (during transition)
        self.completed            = False

        # ── transition sub-state ───────────────────────────────────────
        self.in_transition        = False   # True = waiting for student to remove objects
        self.transition_sent      = False   # True = transition audio already queued

        # ── intro audio ────────────────────────────────────────────────
        self.intro_played_for_step = -1     # step index for which intro was already played

        # ── safety ─────────────────────────────────────────────────────
        srules = self.config.get("safety_rules", {})
        self.proximity_threshold  = srules.get("proximity_threshold", 150)
        self.alert_cooldown       = srules.get("alert_cooldown_seconds", 3)
        self.dangerous_pairs      = srules.get("dangerous_pairs", [])
        self._last_alert_time     = 0

        print(f"   [FSM] Loaded: {self.config['name']} ({self.total_steps} steps, "
              f"{FRAMES_TO_ADVANCE} frames to advance)")

    # ─────────────────────────────────────────────────────────────────────
    # PUBLIC API
    # ─────────────────────────────────────────────────────────────────────

    def process_detections(self, detections: list, language: str = "en") -> dict:
        """
        Core processing method called for every camera frame.

        Returns
        ───────
        {
          "step_info":          dict  — full step snapshot,
          "safety_alert":       dict | None,
          "step_advance":       bool,
          "audio_to_play":      str | None  — audio file key (no extension, no lang),
          "experiment_complete": bool,
        }
        """
        with self._lock:
            lang = language if language in _HINT_KEYS else "en"

            # ── 1. Safety check FIRST — always ──────────────────────────
            safety_alert = self._check_safety(detections)

            # ── 2. Already completed ─────────────────────────────────────
            if self.completed:
                return self._result(
                    step_info=self._build_step_info(lang),
                    safety_alert=safety_alert,
                    step_advance=False,
                    audio_to_play=None,
                    experiment_complete=True,
                )

            step_cfg = self.config["steps"][self.current_step_index]
            required = set(step_cfg.get("required_objects", []))
            detected_labels = {d["label"] for d in detections if "label" in d}
            detected_required = required & detected_labels
            all_present = detected_required == required

            # ── 3. TRANSITION state — waiting for removal ────────────────
            if self.in_transition:
                audio_to_play = None

                # Send transition audio exactly once
                if not self.transition_sent:
                    audio_to_play = step_cfg.get("audio_transition")
                    self.transition_sent = True

                # Check for removal of ALL required objects
                if all_present:
                    # Objects still visible — keep waiting
                    self.removal_count = 0
                    return self._result(
                        step_info=self._build_step_info(lang, force_transition=True),
                        safety_alert=safety_alert,
                        step_advance=False,
                        audio_to_play=audio_to_play,
                        experiment_complete=False,
                    )
                else:
                    # Objects gone (at least partially) — count removal frames
                    self.removal_count += 1
                    if self.removal_count >= REMOVAL_FRAMES:
                        # ── Advance step ─────────────────────────────────
                        return self._do_advance(lang, safety_alert)
                    else:
                        return self._result(
                            step_info=self._build_step_info(lang, force_transition=True),
                            safety_alert=safety_alert,
                            step_advance=False,
                            audio_to_play=audio_to_play,
                            experiment_complete=False,
                        )

            # ── 4. ACTIVE state — normal detection ───────────────────────
            audio_to_play = None

            if all_present and required:
                self.stable_count += 1
            else:
                self.stable_count = 0

            # Intro audio on first detection after step starts
            if detected_required and self.intro_played_for_step != self.current_step_index:
                self.intro_played_for_step = self.current_step_index
                audio_to_play = step_cfg.get("audio_intro")

            # Enter transition after enough stable frames
            if self.stable_count >= FRAMES_TO_ADVANCE:
                self.stable_count   = 0
                self.removal_count  = 0
                self.in_transition  = True
                self.transition_sent = False

                # Last step → experiment complete immediately
                if self.current_step_index >= self.total_steps - 1:
                    self.completed = True
                    self.in_transition = False
                    return self._result(
                        step_info=self._build_step_info(lang, force_complete=True),
                        safety_alert=safety_alert,
                        step_advance=True,
                        audio_to_play=step_cfg.get("audio_transition"),
                        experiment_complete=True,
                    )

                # Non-final step → enter transition state, send transition audio
                return self._result(
                    step_info=self._build_step_info(lang, force_transition=True),
                    safety_alert=safety_alert,
                    step_advance=False,
                    audio_to_play=step_cfg.get("audio_transition"),
                    experiment_complete=False,
                )

            return self._result(
                step_info=self._build_step_info(lang),
                safety_alert=safety_alert,
                step_advance=False,
                audio_to_play=audio_to_play,
                experiment_complete=False,
            )

    def get_full_state(self) -> dict:
        """Return serialisable full state snapshot."""
        return {
            "experiment_name":  self.config["name"],
            "total_steps":      self.total_steps,
            "current_step":     self.current_step_index,
            "completed":        self.completed,
            "in_transition":    self.in_transition,
            "elapsed_total":    round(time.time() - self.start_time, 1),
            "step_info":        self._build_step_info("en"),
        }

    def reset(self):
        """Reset the FSM to the beginning of the experiment."""
        with self._lock:
            self.current_step_index   = 0
            self.stable_count         = 0
            self.removal_count        = 0
            self.completed            = False
            self.in_transition        = False
            self.transition_sent      = False
            self.intro_played_for_step = -1
            self._last_alert_time     = 0
            self.start_time           = time.time()
            self.step_start           = time.time()
        print("   [FSM] Reset complete")

    # ─────────────────────────────────────────────────────────────────────
    # PRIVATE HELPERS
    # ─────────────────────────────────────────────────────────────────────

    def _do_advance(self, lang: str, safety_alert) -> dict:
        """Actually advance to the next step (called after removal detected)."""
        self.current_step_index   += 1
        self.stable_count          = 0
        self.removal_count         = 0
        self.in_transition         = False
        self.transition_sent       = False
        self.intro_played_for_step = -1  # reset so intro plays fresh
        self.step_start            = time.time()

        new_step_cfg = self.config["steps"][self.current_step_index]
        intro_audio  = new_step_cfg.get("audio_intro")
        # Mark intro as played so it doesn't double-play on next frame
        self.intro_played_for_step = self.current_step_index

        return self._result(
            step_info=self._build_step_info(lang),
            safety_alert=safety_alert,
            step_advance=True,
            audio_to_play=intro_audio,
            experiment_complete=False,
        )

    def _build_step_info(self, lang: str,
                         force_transition: bool = False,
                         force_complete: bool = False) -> dict:
        """Build step_info dict for the current step."""
        idx      = self.current_step_index
        step_cfg = self.config["steps"][idx]
        required = step_cfg.get("required_objects", [])
        now      = time.time()

        # During transition or explicit complete: progress = 100, missing = []
        if force_transition or force_complete or self.in_transition:
            detected_req = list(required)
            missing      = []
            progress     = 100.0
            step_status  = "transition" if not force_complete else "completed"
            hint_key     = _TRANSITION_KEYS.get(lang, "transition_en")
        else:
            # Will be filled by caller context — we provide defaults here
            detected_req = []
            missing      = list(required)
            progress     = 0.0
            step_status  = "active"
            hint_key     = _HINT_KEYS.get(lang, "hint_en")

        hint = step_cfg.get(hint_key) or step_cfg.get(_HINT_KEYS.get(lang, "hint_en"), "")

        return {
            "current_step":      idx,
            "total_steps":       self.total_steps,
            "step_name":         step_cfg["name"],
            "hint":              hint,
            "required_objects":  required,
            "detected_required": detected_req,
            "missing_objects":   missing,
            "progress":          progress,
            "time_on_step":      round(now - self.step_start, 1),
            "elapsed_total":     round(now - self.start_time, 1),
            "completed":         self.completed,
            "step_status":       step_status,
        }

    def _build_step_info_with_detections(self, lang: str, detected_labels: set) -> dict:
        """Build step_info with real detection data (used in active state)."""
        idx      = self.current_step_index
        step_cfg = self.config["steps"][idx]
        required = step_cfg.get("required_objects", [])
        now      = time.time()

        detected_req = [o for o in required if o in detected_labels]
        missing      = [o for o in required if o not in detected_labels]
        n_req        = len(required)
        progress     = (len(detected_req) / n_req * 100.0) if n_req else 0.0
        hint_key     = _HINT_KEYS.get(lang, "hint_en")
        hint         = step_cfg.get(hint_key, "")

        return {
            "current_step":      idx,
            "total_steps":       self.total_steps,
            "step_name":         step_cfg["name"],
            "hint":              hint,
            "required_objects":  required,
            "detected_required": detected_req,
            "missing_objects":   missing,
            "progress":          round(progress, 1),
            "time_on_step":      round(now - self.step_start, 1),
            "elapsed_total":     round(now - self.start_time, 1),
            "completed":         self.completed,
            "step_status":       "active",
        }

    def _check_safety(self, detections: list) -> dict | None:
        """Return a safety alert dict if a dangerous pair is too close, else None."""
        now = time.time()
        if now - self._last_alert_time < self.alert_cooldown:
            return None

        centers = {}
        for d in detections:
            label  = d.get("label", "")
            center = d.get("center", [0, 0])
            if label:
                centers[label] = center

        for pair in self.dangerous_pairs:
            if len(pair) < 2:
                continue
            a, b = pair[0], pair[1]
            if a in centers and b in centers:
                cx1, cy1 = centers[a]
                cx2, cy2 = centers[b]
                dist = ((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2) ** 0.5
                if dist < self.proximity_threshold:
                    self._last_alert_time = now
                    return {
                        "type":    "proximity",
                        "message": f"Warning! Keep {a} and {b} apart!",
                        "objects": [a, b],
                        "distance": round(dist, 1),
                    }
        return None

    def _result(self, step_info, safety_alert, step_advance, audio_to_play, experiment_complete) -> dict:
        return {
            "step_info":           step_info,
            "safety_alert":        safety_alert,
            "step_advance":        step_advance,
            "audio_to_play":       audio_to_play,
            "experiment_complete": experiment_complete,
        }

    @staticmethod
    def _load_config(path: str) -> dict:
        abs_path = os.path.abspath(path)
        if not os.path.isfile(abs_path):
            raise FileNotFoundError(f"[FSM] experiment.json not found: {abs_path}")
        with open(abs_path, encoding="utf-8") as f:
            return json.load(f)
