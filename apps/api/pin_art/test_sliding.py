import pytest
import io
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import lib3mf
import numpy as np
from shapely.geometry import Polygon
from pydantic import ValidationError

from pin_art.schemas import ExportRequest
from pin_art.geometry import build_plate
from pin_art.exporter import generate_export
from pin_art.sliding import profile_points, guide_cutter, ring_solid, lower_taper_dimensions
import manifold3d
from pin_art.test_geometry import read_stl, placed_solid
from pin_art.test_pin_geometries import mixed_payload
from pin_art.test_writer import read_model, read_transform
from pin_art.test_schemas import request_payload, LEGACY_LOWER_HEAD_GAP


def sliding_payload(**overrides):
    payload = request_payload(mode="print-in-place")
    payload.pop("socket", None)
    payload.pop("plate", None)
    payload.update(overrides)
    return payload


@pytest.mark.parametrize("angle", [45, 60])
@pytest.mark.parametrize("gap", [0.2, 0.3])
@pytest.mark.parametrize("shape", ["round", "square", "triangle"])
@pytest.mark.parametrize("rotation", [0, 30])
def test_actual_lower_taper_facets_have_target_normal_distance(shape, angle, gap, rotation):
    payload = sliding_payload(sliding={"clearance": 0.4, "headFlare": 0.6, "lowerHeadGap": gap, "lowerHeadAngle": angle})
    payload["parameters"].update(columns=1, rows=1, diameter=3, spacing=5, pinShape=shape, pinRotation=rotation)
    payload.update(heights=[10], pinMaterials=[1])
    request = ExportRequest.model_validate(payload)
    base, pin = [placed_solid(part) for part in build_plate(request).parts]
    mesh = pin.to_mesh64()
    vertices = np.asarray(mesh.vert_properties)[:, :3]
    gaps = []
    lower_height = 0.6 * np.tan(np.deg2rad(angle))
    mouth = min(base.slice(0).to_polygons(), key=lambda ring: Polygon(ring).area)
    for indices in np.asarray(mesh.tri_verts):
        triangle = vertices[indices]
        if triangle[:, 2].max() > lower_height + 1e-8 or np.ptp(triangle[:, 2]) < 1e-8:
            continue
        normal = np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0])
        normal /= np.linalg.norm(normal)
        if normal[2] < 0:
            normal = -normal
        projected = mouth @ normal[:2]
        gap = projected.max() - np.dot(triangle[0], normal)
        gaps.append(gap)
    assert gaps
    assert min(gaps) >= gap - 1e-8
    assert min(gaps) == pytest.approx(gap, abs=1e-5)
    lower_head = ring_solid([(profile_points(shape, 3, 0.6), 0), (profile_points(shape, 3, aligned=True), lower_height)]).rotate((0, 0, request.resolved_pin_geometries[0].rotation))
    assert lower_head.min_gap(base, 0.5) == pytest.approx(gap, abs=1e-5)
    assert lower_head.min_gap(base, 0.5) >= gap - 1e-8
    stl_payload = {**payload, "format": "stl"}
    shells = read_stl(generate_export(ExportRequest.model_validate(stl_payload))[0]).decompose()
    serialized_base = max(shells, key=lambda solid: solid.volume())
    assert lower_head.min_gap(serialized_base, 0.5) >= gap - 2e-6
    assert (base ^ pin).volume() == pytest.approx(0, abs=1e-9)


@pytest.mark.parametrize("shape", ["round", "square", "triangle"])
def test_sixty_degree_lower_taper_preserves_upper_geometry_and_retention(shape):
    payload = sliding_payload(sliding={"clearance": 0.4, "headFlare": 0.6, "lowerHeadGap": 0.2, "lowerHeadAngle": 60})
    payload["parameters"].update(columns=1, rows=1, diameter=3, spacing=5, pinShape=shape)
    payload.update(heights=[10], pinMaterials=[1])
    request = ExportRequest.model_validate(payload)
    base, pin = [placed_solid(part) for part in build_plate(request).parts]
    lower_height = 0.6 * np.sqrt(3)
    payload["sliding"]["lowerHeadAngle"] = 45
    original_base, original_pin = [placed_solid(part) for part in build_plate(ExportRequest.model_validate(payload)).parts]
    np.testing.assert_allclose(pin.bounding_box(), original_pin.bounding_box(), atol=1e-9)
    for height in [1.1, 5, 12.4, 12.999]:
        assert pin.slice(height).area() == pytest.approx(original_pin.slice(height).area(), abs=1e-8)
    for height in [1.1, 1.5, 2.4, 2.999]:
        assert base.slice(height).area() == pytest.approx(original_base.slice(height).area(), abs=1e-8)
    assert pin.slice(0.6).area() > original_pin.slice(0.6).area()
    assert base.slice(0.6).area() < original_base.slice(0.6).area()
    assert pin.slice(lower_height).area() == pytest.approx(original_pin.slice(1.1).area(), abs=1e-8)
    horizontal_gap, _ = lower_taper_dimensions(0.4, 0.6, 0.2, 60)
    for shift in [-10.2, 0, horizontal_gap * np.sqrt(3)]:
        assert (base ^ pin.translate((0, 0, shift))).volume() == pytest.approx(0, abs=1e-8)
    for shift in [-10.21, horizontal_gap * np.sqrt(3) + 0.01]:
        assert (base ^ pin.translate((0, 0, shift))).volume() > 0
    assert base.status() == manifold3d.Error.NoError
    assert pin.status() == manifold3d.Error.NoError


@pytest.mark.parametrize("angle", [0, -1, 90, 120, float("nan"), float("inf")])
def test_invalid_lower_taper_angle_rejected(angle):
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(sliding_payload(sliding={"lowerHeadAngle": angle}))


@pytest.mark.parametrize("diameter", [2.5, 3])
def test_lower_surface_gap_preserves_shaft_and_retention(diameter):
    payload = sliding_payload(sliding={"clearance": 0.4, "headFlare": 0.6, "lowerHeadGap": 0.2, "lowerHeadAngle": 60})
    payload["parameters"].update(columns=1, rows=1, diameter=diameter, spacing=5)
    payload.update(heights=[10], pinMaterials=[1])
    request = ExportRequest.model_validate(payload)
    base, pin = [placed_solid(part) for part in build_plate(request).parts]
    horizontal_gap, mouth_height = lower_taper_dimensions(0.4, 0.6, 0.2, 60)
    assert np.ptp(pin.slice(0.001).to_polygons()[0], axis=0)[0] == pytest.approx(diameter + 1.2 - 0.002 / np.sqrt(3), abs=1e-6)
    assert np.ptp(pin.slice(1.5).to_polygons()[0], axis=0)[0] == pytest.approx(diameter, abs=1e-6)
    for height, width in [(0.001, diameter + 2 * (0.6 + horizontal_gap) - 0.002 / np.sqrt(3)), (mouth_height, diameter + 0.4), (1.5, diameter + 0.4), (2.4, diameter + 0.4), (2.999, diameter + 1.6 - 0.002)]:
        hole = min(base.slice(height).to_polygons(), key=lambda ring: Polygon(ring).area)
        assert np.ptp(hole, axis=0)[0] == pytest.approx(width, abs=1e-6)
    for shift in [-10.2, -5, 0, horizontal_gap * np.sqrt(3)]:
        assert (base ^ pin.translate((0, 0, shift))).volume() == pytest.approx(0, abs=1e-9)
    for shift in [-10.21, horizontal_gap * np.sqrt(3) + 0.01]:
        assert (base ^ pin.translate((0, 0, shift))).volume() > 0
    assert base.status() == manifold3d.Error.NoError
    assert pin.status() == manifold3d.Error.NoError


@pytest.mark.parametrize("fixture", json.loads((Path(__file__).resolve().parents[3] / "fixtures/sliding-release.json").read_text()))
def test_shared_lower_taper_solids_and_rotated_retention(fixture):
    for angle in [0, 30, 90]:
        payload = sliding_payload(sliding={key: fixture[key] for key in ["clearance", "headFlare", "lowerHeadGap", "lowerHeadAngle"]}, heights=[fixture["extension"]], pinMaterials=[1])
        payload["parameters"].update(columns=1, rows=1, diameter=fixture["diameter"], thickness=fixture["thickness"], spacing=5, pinShape=fixture["shape"], pinRotation=angle)
        request = ExportRequest.model_validate(payload)
        base, pin = [placed_solid(part) for part in build_plate(request).parts]
        assert base.volume() == pytest.approx(fixture["baseVolume"], abs=1e-8)
        assert pin.volume() == pytest.approx(fixture["pinVolume"], abs=1e-8)
        reference = manifold3d.Manifold.cube((20, 20, 3)).translate((-10, -10, 0)) - guide_cutter(fixture["shape"], fixture["diameter"], 3, 0.4, 0.6, fixture["lowerHeadGap"], fixture["lowerHeadAngle"]).rotate((0, 0, request.resolved_pin_geometries[0].rotation))
        assert (base - reference).volume() == pytest.approx(0, abs=1e-8)
        assert (reference - base).volume() == pytest.approx(0, abs=1e-8)
        horizontal_gap, _ = lower_taper_dimensions(0.4, 0.6, fixture["lowerHeadGap"], fixture["lowerHeadAngle"])
        upward_limit = horizontal_gap * np.tan(np.deg2rad(fixture["lowerHeadAngle"]))
        for shift in [-10.2, -5, 0, upward_limit]:
            assert (base ^ pin.translate((0, 0, shift))).volume() == pytest.approx(0, abs=1e-8)
        for shift in [-10.21, upward_limit + 0.01]:
            assert (base ^ pin.translate((0, 0, shift))).volume() > 0


def test_head_tapers_cannot_consume_entire_pin_length():
    payload = sliding_payload(sliding={"clearance": 2, "headFlare": 1.2, "lowerHeadGap": 0.01, "lowerHeadAngle": 85})
    payload["parameters"].update(columns=1, rows=1, spacing=10, thickness=5, extension=2.4)
    payload.update(heights=[2.4], pinMaterials=[1])
    with pytest.raises(ValidationError, match="positive shaft length"):
        ExportRequest.model_validate(payload)


def test_guide_thickness_accounts_for_lower_taper_and_surface_gap():
    payload = sliding_payload(sliding={"clearance": 0.4, "headFlare": 0.6, "lowerHeadGap": 0.2, "lowerHeadAngle": 60})
    _, mouth_height = lower_taper_dimensions(0.4, 0.6, 0.2, 60)
    payload["parameters"].update(thickness=1 + 0.6 + mouth_height)
    request = ExportRequest.model_validate(payload)
    base = placed_solid(build_plate(request).parts[0])
    assert base.status() == manifold3d.Error.NoError
    payload["parameters"]["thickness"] -= 0.01
    with pytest.raises(ValidationError, match="Guide thickness"):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("gap", [0, -0.1, float("nan"), float("inf"), 0.5])
def test_invalid_or_conflicting_surface_gap_rejected(gap):
    payload = sliding_payload(sliding={"clearance": 0.4, "headFlare": 0.6, "lowerHeadGap": gap})
    payload["parameters"].update(spacing=4)
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("shape", ["round", "square", "triangle"])
def test_sliding_geometry_and_travel(shape):
    payload = sliding_payload()
    payload["parameters"].update(columns=1, rows=1, pinShape=shape)
    payload.update(heights=[10], pinMaterials=[1])
    request = ExportRequest.model_validate(payload)
    plate = build_plate(request)
    assert len(plate.parts) == 2
    base, pin = [part.solid.transform(part.transform[:3]) for part in plate.parts]
    assert pin.bounding_box()[2] == pytest.approx(0)
    assert pin.bounding_box()[5] == pytest.approx(13)
    assert (base ^ pin).volume() == pytest.approx(0, abs=1e-9)
    for shift in [0.2, -10.2, -5]:
        assert (base ^ pin.translate((0, 0, shift))).volume() == pytest.approx(0, abs=1e-9)
    for shift in [0.21, -10.21]:
        assert (base ^ pin.translate((0, 0, shift))).volume() > 0
    reference = manifold3d.Manifold.cube((20, 20, 3)).translate((-10, -10, 0)) - guide_cutter(shape, 2, 3, 0.4, 0.4, LEGACY_LOWER_HEAD_GAP, 45)
    assert base.volume() == pytest.approx(reference.volume(), abs=1e-8)
    assert (base - reference).volume() == pytest.approx(0, abs=1e-8)
    assert (reference - base).volume() == pytest.approx(0, abs=1e-8)
    fixtures = json.loads((Path(__file__).resolve().parents[3] / "fixtures" / "sliding-solids.json").read_text())
    fixture = next(value for value in fixtures if value["shape"] == shape)
    assert base.volume() == pytest.approx(fixture["baseVolume"], abs=1e-8)
    assert pin.volume() == pytest.approx(fixture["pinVolume"], abs=1e-8)


@pytest.mark.parametrize("format", ["stl", "3mf"])
def test_default_heads_have_reference_retention_and_export_separate_closed_solids(format, tmp_path):
    payload = sliding_payload(format=format)
    payload.pop("sliding")
    payload["parameters"]["spacing"] = 4.5
    request = ExportRequest.model_validate(payload)
    plate = build_plate(request)
    base, *pins = [placed_solid(part) for part in plate.parts]
    head = profile_points("round", 2, request.sliding.head_flare)
    guide = profile_points("round", 2, request.sliding.clearance / 2)
    assert np.ptp(head[:, 0]) == pytest.approx(3.4)
    assert np.ptp(guide[:, 0]) == pytest.approx(2.6)
    assert (np.ptp(head[:, 0]) - np.ptp(guide[:, 0])) / 2 == pytest.approx(0.4)
    for pin, extension in zip(pins, request.heights):
        assert pin.status() == manifold3d.Error.NoError
        assert pin.bounding_box()[2] == pytest.approx(0)
        assert pin.bounding_box()[5] == pytest.approx(3 + extension)
        assert pin.bounding_box()[3] - pin.bounding_box()[0] == pytest.approx(3.4)
        assert (base ^ pin).volume() == pytest.approx(0, abs=1e-9)
        horizontal_gap, _ = lower_taper_dimensions(0.6, 0.7, 0.3, 45)
        assert (base ^ pin.translate((0, 0, horizontal_gap + 0.01))).volume() > 0
    assert base.status() == manifold3d.Error.NoError
    output, filename, mime, count = generate_export(request)
    assert count == 1
    if format == "stl":
        assert len(read_stl(output).decompose()) == 5
    else:
        path = tmp_path / filename
        path.write_bytes(output)
        model = lib3mf.get_wrapper().CreateModel()
        reader = model.QueryReader("3mf")
        reader.SetStrictModeActive(True)
        reader.ReadFromFile(str(path))
        assert reader.GetWarningCount() == 0


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
    plate = build_plate(request)
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
    plate = build_plate(request)
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
    base = build_plate(original).parts[0]
    assert base.solid.slice(1.5).area() < 764
    payload["layout"]["regions"] = [
        {"outer": [[-20, -10], [-5, -10], [-5, 10], [-20, 10]], "holes": []},
        {"outer": [[5, -10], [20, -10], [20, 10], [5, 10]], "holes": []},
    ]
    request = ExportRequest.model_validate(payload)
    assert len(build_plate(request).parts[0].solid.decompose()) == 2
    payload["layout"]["pins"][0]["x"] += 0.1
    assert build_plate(ExportRequest.model_validate(payload)).parts[0].cache_key != base.cache_key
