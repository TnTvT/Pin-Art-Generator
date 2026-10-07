import pytest
import io
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import lib3mf
import numpy as np
from pydantic import ValidationError

from pin_art.schemas import ExportRequest
from pin_art.geometry import build_plates
from pin_art.exporter import generate_export
from pin_art.sliding import profile_points, guide_cutter
import manifold3d
from pin_art.test_geometry import read_stl, placed_solid
from pin_art.test_pin_geometries import mixed_payload
from pin_art.test_writer import read_model, read_transform
from pin_art.test_schemas import request_payload


def sliding_payload(**overrides):
    payload = request_payload(mode="print-in-place")
    payload.pop("socket", None)
    payload.pop("plate", None)
    payload.update(overrides)
    return payload


@pytest.mark.parametrize("shape", ["round", "square", "triangle"])
def test_sliding_geometry_and_travel(shape):
    payload = sliding_payload()
    payload["parameters"].update(columns=1, rows=1, pinShape=shape)
    payload.update(heights=[10], pinMaterials=[1])
    request = ExportRequest.model_validate(payload)
    plate = build_plates(request)[0]
    assert len(plate.parts) == 2
    base, pin = [part.solid.transform(part.transform[:3]) for part in plate.parts]
    assert pin.bounding_box()[2] == pytest.approx(0)
    assert pin.bounding_box()[5] == pytest.approx(13)
    assert (base ^ pin).volume() == pytest.approx(0, abs=1e-9)
    for shift in [0.2, -10.2, -5]:
        assert (base ^ pin.translate((0, 0, shift))).volume() == pytest.approx(0, abs=1e-9)
    for shift in [0.21, -10.21]:
        assert (base ^ pin.translate((0, 0, shift))).volume() > 0
    reference = manifold3d.Manifold.cube((20, 20, 3)).translate((-10, -10, 0)) - guide_cutter(shape, 2, 3, 0.4, 0.4)
    assert base.volume() == pytest.approx(reference.volume(), abs=1e-8)
    assert (base - reference).volume() == pytest.approx(0, abs=1e-8)
    assert (reference - base).volume() == pytest.approx(0, abs=1e-8)
    fixtures = json.loads((Path(__file__).resolve().parents[3] / "fixtures" / "sliding-solids.json").read_text())
    fixture = next(value for value in fixtures if value["shape"] == shape)
    assert base.volume() == pytest.approx(fixture["baseVolume"], abs=1e-8)
    assert pin.volume() == pytest.approx(fixture["pinVolume"], abs=1e-8)


@pytest.mark.parametrize("settings", [{"clearance": 0}, {"headFlare": 0.3}, {"headFlare": 1.1}])
def test_invalid_sliding_settings(settings):
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(sliding_payload(sliding=settings))


def test_short_extension_rejected():
    with pytest.raises(ValidationError, match="extension"):
        ExportRequest.model_validate(sliding_payload(heights=[0.5] * 4))


def test_old_contract_rejected():
    for extra in [{"mode": "detachable"}, {"socket": {"insertionDepth": 2}}, {"plate": {"width": 256}}]:
        with pytest.raises(ValidationError):
            ExportRequest.model_validate(sliding_payload(**extra))


@pytest.mark.parametrize("fixture", json.loads((Path(__file__).resolve().parents[3] / "fixtures/sliding-profiles.json").read_text()))
def test_shared_profiles(fixture):
    np.testing.assert_allclose(profile_points(fixture["shape"], fixture["diameter"], fixture["offset"]), fixture["points"], rtol=0, atol=1e-12)


@pytest.mark.parametrize("shape", ["round", "square", "triangle"])
@pytest.mark.parametrize("angle", [0, 30, 45, 90])
@pytest.mark.parametrize("extension", [0.8, 10, 25.134567])
def test_printed_pin_is_closed_and_preserves_shape_rotation_and_extension(shape, angle, extension):
    payload = sliding_payload(format="stl", heights=[extension] * 4)
    payload["parameters"].update(pinShape=shape, pinRotation=angle)
    request = ExportRequest.model_validate(payload)
    plate = build_plates(request)[0]
    assert plate.parts[1].solid is plate.parts[2].solid
    output, filename, mime, count = generate_export(request)
    assert (filename, mime, count) == ("pin-art-print-in-place.stl", "model/stl", 1)
    solid = read_stl(output)
    assert len(solid.decompose()) == 5
    assert solid.bounding_box()[2] == 0
    assert solid.bounding_box()[5] == pytest.approx(3 + extension, abs=2e-6)
    for part in plate.parts[1:]:
        assert (placed_solid(part) ^ placed_solid(plate.parts[0])).volume() == pytest.approx(0, abs=1e-9)


@pytest.mark.parametrize("explicit", [False, True])
def test_mixed_3mf_keeps_assembled_positions_colors_profiles_and_plate_ownership(explicit, tmp_path):
    payload = mixed_payload(mode="print-in-place", explicit=explicit)
    payload.update(heights=[4, 9, 13, 13], filamentProfiles=["bambu-pla-basic", "bambu-pla-matte"])
    request = ExportRequest.model_validate(payload)
    plate = build_plates(request)[0]
    output, filename, mime, count = generate_export(request)
    assert filename.endswith(".3mf") and mime == "model/3mf" and count == 1
    path = tmp_path / filename
    path.write_bytes(output)
    model = lib3mf.get_wrapper().CreateModel()
    reader = model.QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(path))
    assert reader.GetWarningCount() == 0
    namespace, root, objects, config = read_model(output)
    item = root.find(f"{namespace}build/{namespace}item")
    assert len(root.findall(f"{namespace}build/{namespace}item")) == 1
    assert len(config.findall("plate")) == 1
    assert config.find("plate/model_instance/metadata[@key='object_id']").attrib["value"] == item.attrib["objectid"]
    components = objects[item.attrib["objectid"]].findall(f"{namespace}components/{namespace}component")
    assert len(components) == 5
    for part, component in zip(plate.parts, components, strict=True):
        mesh = objects[component.attrib["objectid"]]
        vertices = np.array([[float(vertex.attrib[axis]) for axis in ["x", "y", "z"]] for vertex in mesh.findall(f"{namespace}mesh/{namespace}vertices/{namespace}vertex")])
        world = np.c_[vertices, np.ones(len(vertices))] @ (read_transform(item) @ read_transform(component)).T
        bounds = np.array(placed_solid(part).bounding_box())
        bounds[[0, 1, 3, 4]] += 128
        np.testing.assert_allclose([*world[:, :3].min(axis=0), *world[:, :3].max(axis=0)], bounds, atol=1e-6)
    assert plate.parts[3].solid is plate.parts[4].solid
    assert components[3].attrib["objectid"] != components[4].attrib["objectid"]
    with zipfile.ZipFile(io.BytesIO(output)) as archive:
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        assert settings["filament_ids"] == ["GFA00", "GFA01"]
        assert settings["printer_model"] == "Bambu Lab X1 Carbon"
        assert len(ET.fromstring(archive.read("Metadata/model_settings.config")).findall("object/part")) == 5


@pytest.mark.parametrize("failure", ["guide-wall", "mouth-wall", "edge", "floor", "head", "bed", "height"])
def test_mechanical_failures_are_actionable(failure):
    payload = sliding_payload()
    if failure == "guide-wall":
        payload["parameters"].update(spacing=3.1)
    elif failure == "mouth-wall":
        payload["parameters"].update(spacing=3.3)
    elif failure == "edge":
        payload["parameters"].update(width=7)
    elif failure == "floor":
        payload["parameters"].update(thickness=1.5)
    elif failure == "head":
        payload.update(sliding={"headFlare": 0.3})
    elif failure == "bed":
        payload["parameters"].update(width=247)
    else:
        payload.update(heights=[248] * 4)
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(payload)


def test_holes_multiple_regions_and_cache_identity():
    from pin_art.test_shape_layout import shape_request

    payload = shape_request("print-in-place")
    original = ExportRequest.model_validate(payload)
    base = build_plates(original)[0].parts[0]
    assert base.solid.slice(1.5).area() < 764
    payload["layout"]["regions"] = [
        {"outer": [[-20, -10], [-5, -10], [-5, 10], [-20, 10]], "holes": []},
        {"outer": [[5, -10], [20, -10], [20, 10], [5, 10]], "holes": []},
    ]
    request = ExportRequest.model_validate(payload)
    assert len(build_plates(request)[0].parts[0].solid.decompose()) == 2
    payload["layout"]["pins"][0]["x"] += 0.1
    assert build_plates(ExportRequest.model_validate(payload))[0].parts[0].cache_key != base.cache_key
