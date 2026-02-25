# VocalLab — map generic YOLO COCO class names to lab equipment names

YOLO_TO_LAB = {
    "bottle": "beaker",
    "wine glass": "conical_flask",
    "cup": "measuring_cylinder",
    "bowl": "petri_dish",
    "spoon": "spatula",
    "knife": "conical_flask",         # Changed from glass_rod — knife is now conical flask proxy
    "scissors": "tongs",
    "vase": "volumetric_flask",
    "person": "hand",
    "cell phone": "ph_meter",
    "remote": "thermometer",
    "mouse": "dropper",
    "keyboard": "hotplate",
    "laptop": "analytical_balance",
    "book": "lab_manual",
    "clock": "stopwatch",
    "banana": "test_tube",
    "apple": "rubber_stopper",
    "orange": "watch_glass",
    "carrot": "stirring_rod",
    "toothbrush": "brush",
    "pen": "pipette",
}


def map_label(yolo_label: str) -> str:
    """Map a YOLO class name to lab equipment name. Unknown labels returned as-is."""
    if not yolo_label:
        return yolo_label
    key = yolo_label.strip().lower()
    return YOLO_TO_LAB.get(key, yolo_label)


def get_all_lab_labels():
    """Return set of all lab equipment labels (mapped names)."""
    return list(set(YOLO_TO_LAB.values()))


def get_mapping_count():
    """Return total number of label mappings."""
    return len(YOLO_TO_LAB)


# NOTE: glass_rod currently has no YOLO proxy assigned.
# To re-enable, add e.g.: "knife": "glass_rod" or another COCO object.
