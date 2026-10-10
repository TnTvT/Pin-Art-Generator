from dataclasses import dataclass
from typing import Literal

from pin_art.bambu_profile import project_profile as bambu_project_profile


PrinterId = Literal["bambu-x1c", "snapmaker-u1"]


@dataclass(frozen=True)
class PrinterProfile:
    short_name: str
    width: float
    depth: float
    height: float
    max_materials: int
    origin: tuple[float, float]
    application: str

    @property
    def center(self) -> tuple[float, float]:
        return self.origin[0] + self.width / 2, self.origin[1] + self.depth / 2


PRINTER_PROFILES: dict[PrinterId, PrinterProfile] = {
    "bambu-x1c": PrinterProfile("Bambu X1C", 256, 256, 250, 16, (0, 0), "BambuStudio-02.04.00.70"),
    "snapmaker-u1": PrinterProfile("Snapmaker U1", 270, 270, 270, 4, (0.5, 1), "Snapmaker_Orca-2.1.1"),
}
U1_PRINTER_NAME = "Snapmaker U1 (0.4 nozzle)"
U1_PROCESS_NAME = "0.20mm Standard @Snapmaker U1 (0.4 nozzle)"
U1_FILAMENT_PARENT = "Generic PLA @System"
U1_FILAMENTS = {
    "bambu-pla-basic": ("Pin Art Bambu PLA Basic @Snapmaker U1", "GFA00", "Bambu Lab", "Bambu PLA Basic; Generic PLA settings, not an official U1-tuned Bambu preset."),
    "bambu-pla-matte": ("Pin Art Bambu PLA Matte @Snapmaker U1", "GFA01", "Bambu Lab", "Bambu PLA Matte; Generic PLA settings, not an official U1-tuned Bambu preset."),
    "generic-pla": (U1_FILAMENT_PARENT, "GFL99", "Generic", ""),
}


def project_profile(printer: PrinterId, filament_profiles: list[str]) -> dict:
    if printer == "bambu-x1c":
        return bambu_project_profile(filament_profiles)
    presets = [U1_FILAMENTS[profile] for profile in filament_profiles]
    return {
        "printer_settings_id": U1_PRINTER_NAME,
        "printer_model": "Snapmaker U1",
        "printer_variant": "0.4",
        "printer_technology": "FFF",
        "nozzle_diameter": ["0.4"] * 4,
        "extruder_offset": ["0x0"] * 4,
        "single_extruder_multi_material": "0",
        "gcode_flavor": "klipper",
        "printable_area": ["0.5x1", "270.5x1", "270.5x271", "0.5x271"],
        "printable_height": "270.05",
        "curr_bed_type": "Textured PEI Plate",
        "default_bed_type": "Textured PEI Plate",
        "print_settings_id": U1_PROCESS_NAME,
        "default_print_profile": U1_PROCESS_NAME,
        "filament_settings_id": [preset[0] for preset in presets],
        "filament_ids": [preset[1] for preset in presets],
        "filament_type": ["PLA"] * len(presets),
        "filament_diameter": ["1.75"] * len(presets),
        "filament_vendor": [preset[2] for preset in presets],
        "filament_notes": [preset[3] for preset in presets],
        "inherits_group": [U1_PROCESS_NAME, *([U1_FILAMENT_PARENT] * len(presets)), U1_PRINTER_NAME],
        "different_settings_to_system": ["", *["filament_vendor;filament_notes" if profile != "generic-pla" else "" for profile in filament_profiles], ""],
    }
