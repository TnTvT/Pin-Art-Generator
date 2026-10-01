PRINTER_NAME = "Bambu Lab X1 Carbon 0.4 nozzle"
PROCESS_NAME = "0.20mm Standard @BBL X1C"
BED_WIDTH = 256.0
BED_DEPTH = 256.0
PRINTABLE_HEIGHT = 250.0


def project_profile(filament_count: int) -> dict:
    return {
        "printer_settings_id": PRINTER_NAME,
        "printer_model": "Bambu Lab X1 Carbon",
        "printer_variant": "0.4",
        "printer_technology": "FFF",
        "printer_structure": "corexy",
        "nozzle_diameter": ["0.4"],
        "printable_area": ["0x0", "256x0", "256x256", "0x256"],
        "printable_height": str(int(PRINTABLE_HEIGHT)),
        "bed_exclude_area": ["0x0", "18x0", "18x28", "0x28"],
        "curr_bed_type": "Textured PEI Plate",
        "print_settings_id": PROCESS_NAME,
        "default_print_profile": PROCESS_NAME,
        "inherits_group": [PROCESS_NAME, *([""] * filament_count), PRINTER_NAME],
        "different_settings_to_system": [""] * (filament_count + 2),
    }
