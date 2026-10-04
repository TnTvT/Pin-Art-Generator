import zipfile
import io
import json
import math

import lib3mf
import pytest
from pydantic import ValidationError

from pin_art.schemas import ExportRequest
from pin_art.geometry import build_plates, plate_stl
from pin_art.writer import export_3mf
from pin_art.exporter import generate_export


def shape_request(mode="fixed"):
    return {
        "format": "3mf", "mode": mode,
        "parameters": {"width": 40, "depth": 20, "thickness": 3, "spacing": 5, "diameter": 2, "extension": 20},
        "layout": {"regions": [{"outer": [[-20, -10], [20, -10], [20, 10], [-20, 10]], "holes": [[[-3, -3], [-3, 3], [3, 3], [3, -3]]]}],
                   "pins": [{"id": "left", "x": -10, "y": 0}, {"id": "right", "x": 10, "y": 0}], "edgePadding": 2},
        "heights": [10, 20], "materials": ["#8e9089", "#00b1b7"], "baseMaterial": 0, "pinMaterials": [1, 1],
    }


@pytest.mark.parametrize("mode", ["fixed", "detachable"])
def test_shape_exports_keep_holes_positions_and_plates(mode, tmp_path):
    request = ExportRequest.model_validate(shape_request(mode))
    plates = build_plates(request)
    assert len(plates) == (1 if mode == "fixed" else 2)
    assert plates[0].parts[0].solid.volume() == pytest.approx((800 - 36) * 3 - (2 * 3.141592653589793 * 1.1 ** 2 * 2 if mode == "detachable" else 0), rel=0.001)
    assert len(plate_stl(plates[0])) > 84
    path = tmp_path / "shape.3mf"
    path.write_bytes(export_3mf(request, plates))
    reader = lib3mf.get_wrapper().CreateModel().QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(path))
    assert reader.GetWarningCount() == 0
    assert "left" in plates[-1].parts[-2].name
    assert "right" in plates[-1].parts[-1].name
    with zipfile.ZipFile(io.BytesIO(path.read_bytes())) as archive:
        assert "Metadata/project_settings.config" in archive.namelist()


@pytest.mark.parametrize("failure", ["hole", "padding", "duplicate", "self-intersect", "counts"])
def test_layout_validation_rejects_invalid_snapshots(failure):
    payload = shape_request()
    if failure == "hole": payload["layout"]["pins"][0]["x"] = 0
    if failure == "padding": payload["layout"]["pins"][0]["x"] = -19
    if failure == "duplicate": payload["layout"]["pins"][1]["id"] = "left"
    if failure == "self-intersect": payload["layout"]["regions"][0]["outer"] = [[-20, -10], [20, 10], [-20, 10], [20, -10]]
    if failure == "counts": payload["heights"] = [10]
    with pytest.raises(ValidationError): ExportRequest.model_validate(payload)


@pytest.mark.parametrize("mode", ["fixed", "detachable"])
def test_disconnected_regions_preserve_assembly_coordinates_and_closed_solids(mode):
    payload = shape_request(mode)
    payload["layout"]["regions"] = [
        {"outer": [[-20, -10], [-5, -10], [-5, 10], [-20, 10]], "holes": []},
        {"outer": [[5, -10], [20, -10], [20, 10], [5, 10]], "holes": []},
    ]
    request = ExportRequest.model_validate(payload)
    plates = build_plates(request)
    assert len(plates[0].parts[0].solid.decompose()) == 2
    assert len(plate_stl(plates[0])) > 84
    if mode == "fixed":
        assert tuple(plates[0].parts[1].transform[:3, 3]) == (-10, 0, 3)
        assert tuple(plates[0].parts[2].transform[:3, 3]) == (10, 0, 3)
    else:
        payload["format"] = "stl"
        output, name, mime, plate_count = generate_export(ExportRequest.model_validate(payload))
        assert plate_count == 2
        with zipfile.ZipFile(io.BytesIO(output)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["layout"]["pins"][0] == {"id": "left", "x": -10, "y": 0}
            assert "left" in manifest["plates"][1]["parts"][0]["name"]
            assert "12.000 mm" in manifest["plates"][1]["parts"][0]["name"]


@pytest.mark.parametrize("mode", ["fixed", "detachable"])
def test_curved_contours_survive_strict_3mf_read_back(mode, tmp_path):
    payload = shape_request(mode)
    outer = [[20 * math.cos(index * math.pi / 32), 10 * math.sin(index * math.pi / 32)] for index in range(64)]
    payload["layout"]["regions"] = [{"outer": outer, "holes": []}]
    payload["filamentProfiles"] = ["bambu-pla-basic", "bambu-pla-matte"]
    request = ExportRequest.model_validate(payload)
    output, _, _, count = generate_export(request)
    path = tmp_path / "curved.3mf"
    path.write_bytes(output)
    model = lib3mf.get_wrapper().CreateModel()
    reader = model.QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(path))
    assert reader.GetWarningCount() == 0
    assert count == (1 if mode == "fixed" else 2)


@pytest.mark.parametrize("failure", ["wall", "hole-wall", "floor", "bounds", "vertices", "overlapping-regions"])
def test_detachable_shape_validation_does_not_repair_or_remove_pins(failure):
    payload = shape_request("detachable")
    if failure == "wall":
        payload["layout"]["pins"][1].update(x=-7.5)
    if failure == "hole-wall":
        payload["layout"]["pins"][0].update(x=-4.5)
        payload["layout"]["edgePadding"] = 0
    if failure == "floor":
        payload["parameters"]["thickness"] = 2.5
    if failure == "bounds":
        payload["parameters"]["width"] = 41
    if failure == "vertices":
        payload["layout"]["regions"][0]["holes"] = [[[-1,-1], [-1,1], [1,1], [1,-1]]] * 5000
    if failure == "overlapping-regions":
        payload["layout"]["regions"].append(payload["layout"]["regions"][0])
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(payload)
