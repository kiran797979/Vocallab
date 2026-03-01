# VocalLab — map generic YOLO COCO class names to lab equipment names
# Enhanced for proxy mode with robust fallback matching and logging

PROXY_MODE = True  # Enable strict proxy mapping

YOLO_TO_LAB = {
    # Primary household items → lab equipment
    "glass": "beaker",
    "bottle": "conical_flask",
    "cup": "measuring_cylinder",
    "spoon": "spatula",
    "mouse": "dropper",
    "phone": "ph_meter",
    "book": "lab_manual",
    "bowl": "petri_dish",
    "vase": "volumetric_flask",
    "banana": "test_tube",
    "clock": "stopwatch",
    "pen": "pipette",
    "toothbrush": "brush",
    "carrot": "stirring_rod",
    "apple": "rubber_stopper",
    "orange": "watch_glass",

    # Additional mappings for better detection
    "wine glass": "conical_flask",
    "plastic bottle": "conical_flask",
    "mug": "measuring_cylinder",
    "fork": "spatula",
    "keyboard": "hotplate",
    "laptop": "analytical_balance",
    "cell phone": "ph_meter",
    "remote": "thermometer",
    "scissors": "tongs",
    "knife": "conical_flask",
    "eraser": "rubber_stopper",
    "ruler": "stirring_rod",
    "calculator": "analytical_balance",
    "notebook": "lab_manual",
    "paper": "lab_manual",
    "pencil": "stirring_rod",
    "marker": "stirring_rod",
    "highlighter": "stirring_rod",
    "stapler": "analytical_balance",
    "tape": "lab_manual",
    "glue": "lab_manual",
}

# Enhanced mapping with fuzzy matching
FUZZY_MAPPINGS = {
    "glass": ["beaker", "conical_flask", "measuring_cylinder"],
    "bottle": ["conical_flask", "beaker", "volumetric_flask"],
    "cup": ["measuring_cylinder", "beaker", "petri_dish"],
    "spoon": ["spatula", "stirring_rod", "dropper"],
    "mouse": ["dropper", "pipette", "stirring_rod"],
    "phone": ["ph_meter", "analytical_balance", "stopwatch"],
    "book": ["lab_manual", "petri_dish", "watch_glass"],
}

import logging
import re
from typing import List, Tuple

logger = logging.getLogger(__name__)

def map_label(yolo_label: str) -> str:
    """
    Map a YOLO class name to lab equipment name with enhanced proxy mode.
    Returns the mapped lab label string.
    """
    if not yolo_label:
        return "unknown"

    original_label = yolo_label.strip().lower()
    key = original_label

    # Try exact match first
    if key in YOLO_TO_LAB:
        mapped = YOLO_TO_LAB[key]
        if PROXY_MODE:
            logger.debug(f"Proxy mapping: {original_label} → {mapped}")
        return mapped

    # Try fuzzy matching for common household items
    for fuzzy_key, lab_options in FUZZY_MAPPINGS.items():
        if fuzzy_key in original_label:
            # Choose most appropriate lab equipment
            if "glass" in original_label:
                mapped = "beaker"
            elif "bottle" in original_label:
                mapped = "conical_flask"
            elif "cup" in original_label:
                mapped = "measuring_cylinder"
            elif "spoon" in original_label:
                mapped = "spatula"
            elif "mouse" in original_label:
                mapped = "dropper"
            elif "phone" in original_label:
                mapped = "ph_meter"
            elif "book" in original_label:
                mapped = "lab_manual"
            else:
                mapped = lab_options[0]  # Default to first option

            if PROXY_MODE:
                logger.debug(f"Fuzzy mapping: {original_label} → {mapped}")
            return mapped

    # Fallback: return original label if no mapping found
    if PROXY_MODE:
        logger.debug(f"No mapping found for: {original_label}")
    return original_label


def get_all_lab_labels():
    """Return set of all lab equipment labels (mapped names)."""
    return list(set(YOLO_TO_LAB.values()))


def get_mapping_count():
    """Return total number of label mappings."""
    return len(YOLO_TO_LAB)


def get_fallback_mapping(yolo_label: str) -> str:
    """
    Get fallback mapping for demo mode.
    If required objects not detected, simulate detection after 5 seconds.
    """
    if not yolo_label:
        return "unknown"

    original_label = yolo_label.strip().lower()

    # Common household items that should be mapped
    if any(item in original_label for item in ["glass", "bottle", "cup", "spoon", "phone", "book"]):
        return map_label(yolo_label)

    # Default fallback
    return "unknown"