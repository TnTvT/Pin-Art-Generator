import zipfile
import io
import json
import math

import lib3mf
import pytest
from pydantic import ValidationError

from pin_art.schemas import ExportRequest
from pin_art.geometry import build_plate, plate_stl
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


@pytest.mark.parametrize("mode", ["fixed"])
def test_shape_exports_keep_holes_positions_and_plates(mode, tmp_path):
    request = ExportRequest.model_validate(shape_request(mode))
    plate = build_plate(request)
    assert plate.parts[0].solid.volume() == pytest.approx((800 - 36) * 3 - (0), rel=0.001)
    assert len(plate_stl(plate)) > 84
    path = tmp_path / "shape.3mf"
    path.write_bytes(export_3mf(request, plate))
    reader = lib3mf.get_wrapper().CreateModel().QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(path))
    assert reader.GetWarningCount() == 0
    assert "left" in plate.parts[-2].name
    assert "right" in plate.parts[-1].name
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


@pytest.mark.parametrize("mode", ["fixed"])
def test_disconnected_regions_preserve_assembly_coordinates_and_closed_solids(mode):
    payload = shape_request(mode)
    payload["layout"]["regions"] = [
        {"outer": [[-20, -10], [-5, -10], [-5, 10], [-20, 10]], "holes": []},
        {"outer": [[5, -10], [20, -10], [20, 10], [5, 10]], "holes": []},
    ]
    request = ExportRequest.model_validate(payload)
    plate = build_plate(request)
    assert len(plate.parts[0].solid.decompose()) == 2
    assert len(plate_stl(plate)) > 84
    assert tuple(plate.parts[1].transform[:3, 3]) == (-10, 0, 3)
    assert tuple(plate.parts[2].transform[:3, 3]) == (10, 0, 3)


@pytest.mark.parametrize("mode", ["fixed"])
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
    assert count == (1)
