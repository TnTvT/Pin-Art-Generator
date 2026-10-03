PRINTER_NAME = "Bambu Lab X1 Carbon 0.4 nozzle"
PROCESS_NAME = "0.20mm Standard @BBL X1C"
BED_WIDTH = 256.0
BED_DEPTH = 256.0
PRINTABLE_HEIGHT = 250.0
FILAMENT_PRESETS = {
    "bambu-pla-basic": ("Bambu PLA Basic @BBL X1C", "GFA00", "Bambu Lab"),
    "bambu-pla-matte": ("Bambu PLA Matte @BBL X1C", "GFA01", "Bambu Lab"),
    "generic-pla": ("Generic PLA", "GFL99", "Generic"),
}


def project_profile(filament_profiles: list[str]) -> dict:
    presets = [FILAMENT_PRESETS[profile] for profile in filament_profiles]
    names = [preset[0] for preset in presets]
    return {
        "printer_settings_id": PRINTER_NAME,
        "printer_model": "Bambu Lab X1 Carbon",
        "printer_variant": "0.4",
        "printer_technology": "FFF",
        "printer_structure": "corexy",
        "nozzle_diameter": ["0.4"],
        "extruder_variant_list": ["Direct Drive Standard"],
        "printable_area": ["0x0", "256x0", "256x256", "0x256"],
        "printable_height": str(int(PRINTABLE_HEIGHT)),
        "bed_exclude_area": ["0x0", "18x0", "18x28", "0x28"],
        "curr_bed_type": "Textured PEI Plate",
        "print_settings_id": PROCESS_NAME,
        "default_print_profile": PROCESS_NAME,
        "filament_settings_id": names,
        "filament_ids": [preset[1] for preset in presets],
        "filament_type": ["PLA"] * len(presets),
        "filament_vendor": [preset[2] for preset in presets],
        "filament_extruder_variant": ["Direct Drive Standard"] * len(presets),
        "filament_self_index": [str(index + 1) for index in range(len(presets))],
        "inherits_group": [PROCESS_NAME, *names, PRINTER_NAME],
        "different_settings_to_system": [""] * (len(presets) + 2),
    }
