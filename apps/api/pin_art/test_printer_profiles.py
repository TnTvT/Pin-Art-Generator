import io
import json
import zipfile
from pathlib import Path

import lib3mf
import numpy as np
import pytest
from pydantic import ValidationError

from pin_art.geometry import build_plates
from pin_art.printer_profiles import PRINTER_PROFILES
from pin_art.schemas import ExportRequest
from pin_art.test_schemas import request_payload
from pin_art.test_writer import read_model, read_transform
from pin_art.writer import export_3mf


def test_shared_printer_envelopes_material_budgets_and_centers():
    fixtures = json.loads((Path(__file__).resolve().parents[3] / "fixtures/printer-profiles.json").read_text())
    for fixture in fixtures:
        profile = PRINTER_PROFILES[fixture["id"]]
        assert (profile.width, profile.depth, profile.height, profile.max_materials) == (fixture["width"], fixture["depth"], fixture["height"], fixture["maxMaterials"])
        assert list(profile.center) == fixture["center"]


def test_printer_defaults_and_allowlist():
    assert ExportRequest.model_validate(request_payload()).printer == "bambu-x1c"
    payload = request_payload(printer="snapmaker-u1")
    assert ExportRequest.model_validate(payload).model_dump(by_alias=True)["printer"] == "snapmaker-u1"
    for printer in ("unknown", "https://example.com/profile", None, 1):
        with pytest.raises(ValidationError):
            ExportRequest.model_validate(request_payload(printer=printer))


def test_u1_envelope_and_printer_independent_stl():
    payload = request_payload(printer="snapmaker-u1", heights=[267] * 4)
    payload["parameters"].update(width=270, depth=270)
    assert ExportRequest.model_validate(payload).printer == "snapmaker-u1"
    for dimension in ("width", "depth"):
        invalid = request_payload(printer="snapmaker-u1")
        invalid["parameters"][dimension] = 270.1
        with pytest.raises(ValidationError, match="270.*270"):
            ExportRequest.model_validate(invalid)
        invalid["format"] = "stl"
        ExportRequest.model_validate(invalid)
    with pytest.raises(ValidationError, match="270 mm"):
        ExportRequest.model_validate(request_payload(printer="snapmaker-u1", heights=[268] * 4))
    payload["mode"] = "print-in-place"
    with pytest.raises(ValidationError, match="5 mm margins"):
        ExportRequest.model_validate(payload)
    payload["parameters"].update(width=260, depth=260)
    ExportRequest.model_validate(payload)


def test_u1_counts_only_used_rgb_profile_pairs_including_base():
    payload = request_payload(printer="snapmaker-u1", materials=["#000000", "#111111", "#222222", "#333333", "#444444"], pinMaterials=[1, 2, 3, 4])
    with pytest.raises(ValidationError, match="4.*including the base"):
        ExportRequest.model_validate(payload)
    payload["format"] = "stl"
    ExportRequest.model_validate(payload)
    payload["format"] = "3mf"
    payload["pinMaterials"] = [1, 2, 3, 3]
    ExportRequest.model_validate(payload)
    payload["pinMaterials"] = [1, 2, 3, 4]
    payload["materials"][4] = "#333333"
    ExportRequest.model_validate(payload)
    payload["filamentProfiles"] = ["generic-pla"] * 4 + ["bambu-pla-matte"]
    with pytest.raises(ValidationError, match="4.*including the base"):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("mode", ["fixed", "print-in-place"])
def test_u1_package_profile_colors_and_centered_assembly(mode, tmp_path):
    payload = request_payload(printer="snapmaker-u1", mode=mode, filamentProfiles=["bambu-pla-basic", "bambu-pla-matte"])
    payload["pinGeometries"] = [{"shape": "round", "rotation": 0}, {"shape": "square", "rotation": 27}, {"shape": "triangle", "rotation": 145}, {"shape": "round", "rotation": 0}]
    request = ExportRequest.model_validate(payload)
    data = export_3mf(request, build_plates(request))
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        assert settings["printer_settings_id"] == "Snapmaker U1 (0.4 nozzle)"
        assert settings["print_settings_id"] == "0.20mm Standard @Snapmaker U1 (0.4 nozzle)"
        assert settings["nozzle_diameter"] == ["0.4"] * 4
        assert settings["single_extruder_multi_material"] == "0"
        assert settings["gcode_flavor"] == "klipper"
        assert settings["printable_area"] == ["0.5x1", "270.5x1", "270.5x271", "0.5x271"]
        assert settings["filament_colour"] == ["#112233", "#AABBCC"]
        assert not any("X1C" in name for name in settings["filament_settings_id"])
        assert settings["filament_vendor"] == ["Bambu Lab"] * 2
        assert settings["inherits_group"] == [settings["print_settings_id"], "Generic PLA @System", "Generic PLA @System", settings["printer_settings_id"]]
        assert "extruder_variant_list" not in settings
    namespace, root, objects, _ = read_model(data)
    application = root.find(f"{namespace}metadata[@name='Application']")
    assert application.text.startswith("Snapmaker_Orca-")
    item = root.find(f"{namespace}build/{namespace}item")
    np.testing.assert_allclose(read_transform(item)[:3, 3], [135.5, 136, 0])
    assembly = objects[item.attrib["objectid"]]
    assert len(assembly.findall(f"{namespace}components/{namespace}component")) == 5
    for component in assembly.findall(f"{namespace}components/{namespace}component"):
        mesh = objects[component.attrib["objectid"]]
        vertices = np.array([[float(vertex.attrib[axis]) for axis in ["x", "y", "z"]] for vertex in mesh.findall(f"{namespace}mesh/{namespace}vertices/{namespace}vertex")])
        world = np.c_[vertices, np.ones(len(vertices))] @ (read_transform(item) @ read_transform(component)).T
        assert world[:, 2].min() == pytest.approx(0 if mode == "print-in-place" or mesh.attrib["name"] == "base" else 3, abs=1e-6)
        assert world[:, 2].max() <= 10 + 1e-6
    output = tmp_path / "u1.3mf"
    output.write_bytes(data)
    model = lib3mf.get_wrapper().CreateModel()
    reader = model.QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(output))
    assert reader.GetWarningCount() == 0


def test_u1_compacts_palette_but_keeps_same_rgb_different_profiles():
    payload = request_payload(printer="snapmaker-u1", materials=["#FFFFFF"] * 4,
                              filamentProfiles=["bambu-pla-basic", "bambu-pla-matte", "generic-pla", "bambu-pla-basic"], pinMaterials=[1, 3, 1, 0])
    request = ExportRequest.model_validate(payload)
    with zipfile.ZipFile(io.BytesIO(export_3mf(request, build_plates(request)))) as archive:
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        assert settings["filament_colour"] == ["#FFFFFF", "#FFFFFF"]
        assert settings["filament_ids"] == ["GFA00", "GFA01"]
        assert "Basic" in settings["filament_notes"][0]
        assert "Matte" in settings["filament_notes"][1]
        assert settings["different_settings_to_system"] == ["", "filament_vendor;filament_notes", "filament_vendor;filament_notes", ""]
