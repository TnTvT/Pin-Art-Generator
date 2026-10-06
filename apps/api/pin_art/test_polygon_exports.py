import io
import json
import math
import zipfile
from xml.etree import ElementTree as ET

import lib3mf
import manifold3d
import numpy as np
import pytest

from pin_art.cross_sections import local_bounds, socket_footprint
from pin_art.exporter import generate_export
from pin_art.geometry import build_plates, plate_stl
from pin_art.layout import plan_layout
from pin_art.schemas import ExportRequest
from pin_art.test_geometry import placed_solid, read_stl
from pin_art.test_polygon_layout import polygon_payload, single_polygon_payload
from pin_art.test_writer import read_model, read_transform


@pytest.mark.parametrize("shape", ["square", "triangle"])
@pytest.mark.parametrize("rotation", [0, 30, 45, 90, 360])
@pytest.mark.parametrize("mode", ["fixed", "detachable"])
@pytest.mark.parametrize("explicit", [False, True])
def test_native_polygon_geometry_dimensions_rotation_volumes_sockets_and_stl(shape, rotation, mode, explicit):
    payload = polygon_payload(shape, rotation, mode, explicit)
    payload.update(format="stl")
    request = ExportRequest.model_validate(payload)
    plates = build_plates(request)
    pins = [part for plate in plates for part in plate.parts if part.name != "base"]
    assert all(pin.solid is pins[0].solid for pin in pins)
    assert pins[0].solid.num_vert() == (8 if shape == "square" else 6)
    unit_area = 0.5 if shape == "square" else 3 * math.sqrt(3) / 16
    bounds = local_bounds(shape, 2, rotation)
    for index, pin in enumerate(pins):
        solid = placed_solid(pin)
        length = request.heights[index] + (2 if mode == "detachable" else 0)
        bottom = 3 if mode == "fixed" else 0
        horizontal, vertical = pin.transform[:2, 3]
        np.testing.assert_allclose(solid.bounding_box(), [bounds[0] + horizontal, bounds[1] + vertical, bottom, bounds[2] + horizontal, bounds[3] + vertical, bottom + length], atol=2e-8)
        assert solid.volume() == pytest.approx(unit_area * 4 * length)
        np.testing.assert_allclose(pin.transform[:2, :2] / 2, [[math.cos(math.radians(rotation)), -math.sin(math.radians(rotation))], [math.sin(math.radians(rotation)), math.cos(math.radians(rotation))]], atol=1e-12)
        assert pin.material == request.pin_materials[index]
        if mode == "fixed":
            assert (plates[0].parts[0].solid ^ solid).is_empty()
    base = plates[0].parts[0].solid
    expected_base_volume = 1200
    if mode == "detachable":
        socket = socket_footprint(shape, 2, rotation, 0.2)
        expected_base_volume -= 4 * socket.area * 2
        assert base.slice(0.5).area() == pytest.approx(400)
        assert base.slice(2).area() == pytest.approx(400 - 4 * socket.area, abs=1e-6)
        positions = [(pin.x, pin.y) for pin in request.layout.pins] if explicit else [(-2.5, -2.5), (2.5, -2.5), (-2.5, 2.5), (2.5, 2.5)]
        for horizontal, vertical in positions:
            probe = pins[0].solid.transform(np.diag([2, 2, 2, 1])[:3]).rotate((0, 0, rotation)).translate((horizontal, vertical, 1))
            assert (base ^ probe).volume() == pytest.approx(0, abs=1e-8)
            floor_probe = probe.translate((0, 0, -1))
            assert (base ^ floor_probe).volume() == pytest.approx(unit_area * 4, abs=1e-7)
    assert base.volume() == pytest.approx(expected_base_volume, abs=1e-6)
    for plate in plates:
        readback = read_stl(plate_stl(plate))
        expected_volume = sum(placed_solid(part).volume() for part in plate.parts)
        assert readback.volume() == pytest.approx(expected_volume, rel=1e-5)
        boxes = np.array([placed_solid(part).bounding_box() for part in plate.parts])
        np.testing.assert_allclose(readback.bounding_box(), [*boxes[:, :3].min(axis=0), *boxes[:, 3:].max(axis=0)], atol=2e-5)
        assert len(readback.decompose()) == (1 if mode == "fixed" else len(plate.parts))
        assert readback.bounding_box()[2] == 0


@pytest.mark.parametrize("shape", ["square", "triangle"])
@pytest.mark.parametrize("rotation", [0, 30, 45, 90])
@pytest.mark.parametrize("mode", ["fixed", "detachable"])
@pytest.mark.parametrize("explicit", [False, True])
def test_rotated_3mf_strict_readback_transforms_color_profiles_reuse_and_plate_ownership(shape, rotation, mode, explicit, tmp_path):
    payload = polygon_payload(shape, rotation, mode, explicit)
    payload.update(materials=["#FFFFFF", "#FF0000"], pinMaterials=[1] * 4, filamentProfiles=["bambu-pla-basic", "bambu-pla-matte"])
    request = ExportRequest.model_validate(payload)
    plates = build_plates(request)
    output, _, _, count = generate_export(request)
    path = tmp_path / "polygon.3mf"
    path.write_bytes(output)
    model = lib3mf.get_wrapper().CreateModel()
    reader = model.QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(path))
    assert reader.GetWarningCount() == 0
    assert count == (1 if mode == "fixed" else 2)
    namespace, root, objects, _ = read_model(output)
    mesh_ids = [identifier for identifier, mesh in objects.items() if mesh.find(f"{namespace}mesh") is not None]
    assert len(mesh_ids) == 2
    expected_parts = [part for plate in plates for part in plate.parts]
    actual_mesh_ids = []
    actual_build_ids = []
    part_index = 0
    with zipfile.ZipFile(io.BytesIO(output)) as archive:
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        settings = json.loads(archive.read("Metadata/project_settings.config"))
    assert settings["filament_colour"] == ["#FFFFFF", "#FF0000"]
    assert settings["filament_ids"] == ["GFA00", "GFA01"]
    assert settings["printer_model"] == "Bambu Lab X1 Carbon"
    configs = {entry.attrib["id"]: entry for entry in config.findall("object")}
    for item in root.findall(f"{namespace}build/{namespace}item"):
        actual_build_ids.append(item.attrib["objectid"])
        assembly = objects[item.attrib["objectid"]]
        components = assembly.findall(f"{namespace}components/{namespace}component")
        part_configs = configs[item.attrib["objectid"]].findall("part")
        for component, part_config in zip(components, part_configs, strict=True):
            part = expected_parts[part_index]
            mesh = objects[component.attrib["objectid"]]
            vertices = np.array([[float(vertex.attrib[axis]) for axis in ["x", "y", "z"]] for vertex in mesh.findall(f"{namespace}mesh/{namespace}vertices/{namespace}vertex")])
            triangles = np.array([[int(triangle.attrib[axis]) for axis in ["v1", "v2", "v3"]] for triangle in mesh.findall(f"{namespace}mesh/{namespace}triangles/{namespace}triangle")], dtype=np.uint64)
            component_matrix = read_transform(component)
            metadata_matrix = np.array([float(value) for value in part_config.find("metadata[@key='matrix']").attrib["value"].split()]).reshape(4, 4)
            np.testing.assert_allclose(component_matrix, metadata_matrix, atol=1e-12)
            world = np.c_[vertices, np.ones(len(vertices))] @ component_matrix.T
            readback = manifold3d.Manifold(manifold3d.Mesh64(world[:, :3], triangles))
            assert readback.status() == manifold3d.Error.NoError
            np.testing.assert_allclose(readback.bounding_box(), placed_solid(part).bounding_box(), atol=1e-6)
            assert readback.volume() == pytest.approx(placed_solid(part).volume(), rel=1e-6)
            assert readback.bounding_box()[2] >= -1e-8
            assert part_config.find("metadata[@key='extruder']").attrib["value"] == str(part.material + 1)
            if part.name != "base":
                actual_mesh_ids.append(component.attrib["objectid"])
                assert shape in part_config.find("metadata[@key='name']").attrib["value"]
            composed_world = np.c_[vertices, np.ones(len(vertices))] @ (read_transform(item) @ metadata_matrix).T
            assert composed_world[:, 2].min() >= -1e-8
            part_index += 1
    assert part_index == len(expected_parts)
    assert len(set(actual_mesh_ids)) == 1
    plate_ids = [entry.attrib["value"] for entry in config.findall("plate/model_instance/metadata[@key='object_id']")]
    assert plate_ids == actual_build_ids
    if mode == "detachable":
        assert [len(plate.findall("model_instance")) for plate in config.findall("plate")] == [1, 4]


@pytest.mark.parametrize("shape", ["square", "triangle"])
@pytest.mark.parametrize("rotation", [0, 30, 45, 90])
def test_packing_centers_true_asymmetric_bounds_and_has_margins_and_gaps(shape, rotation):
    payload = polygon_payload(shape, rotation, mode="detachable", explicit=False)
    payload.update(heights=[5] * 25, pinMaterials=[1] * 25, plate={"width": 30, "depth": 30})
    payload["parameters"].update(rows=5, columns=5, spacing=3)
    request = ExportRequest.model_validate(payload)
    layouts = plan_layout(request)
    assert len(layouts) >= 3
    assert [part.pin_index for plate in layouts[1:] for part in plate.parts] == list(range(25))
    for plate in build_plates(request):
        boxes = [placed_solid(part).bounding_box() for part in plate.parts]
        minimum = np.min(np.array(boxes)[:, :3], axis=0)
        maximum = np.max(np.array(boxes)[:, 3:], axis=0)
        np.testing.assert_allclose((minimum[:2] + maximum[:2]) / 2, [15, 15], atol=1e-8)
        assert minimum[0] >= 5 - 1e-8 and minimum[1] >= 5 - 1e-8
        assert maximum[0] <= 25 + 1e-8 and maximum[1] <= 25 + 1e-8
        assert minimum[2] == 0
        for index, first in enumerate(boxes):
            for second in boxes[index + 1:]:
                assert first[3] + 4 <= second[0] + 1e-8 or second[3] + 4 <= first[0] + 1e-8 or first[4] + 4 <= second[1] + 1e-8 or second[4] + 4 <= first[1] + 1e-8


def test_single_triangle_plate_origin_is_not_assumed_to_be_bbox_center():
    payload = single_polygon_payload("triangle", 0, "detachable")
    request = ExportRequest.model_validate(payload)
    placement = plan_layout(request)[1].parts[0]
    assert placement.x == pytest.approx(128)
    assert placement.y == pytest.approx(127.75)


def test_detachable_zip_records_shape_rotation_and_identity_and_stl_plates():
    payload = polygon_payload("triangle", 30, "detachable")
    payload["format"] = "stl"
    output, filename, mime, count = generate_export(ExportRequest.model_validate(payload))
    assert filename.endswith(".zip") and mime == "application/zip" and count == 2
    with zipfile.ZipFile(io.BytesIO(output)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["pinShape"] == "triangle"
        assert manifest["pinRotation"] == 30
        assert manifest["diameter"] == 2
        assert manifest["layout"] == payload["layout"]
        assert manifest["heights"] == payload["heights"]
        for plate in manifest["plates"]:
            assert read_stl(archive.read(plate["file"])).bounding_box()[2] == 0
        names = [part["name"] for part in manifest["plates"][1]["parts"]]
        assert all("triangle" in name and "30" in name for name in names)
        assert all(pin["id"] in name for pin, name in zip(payload["layout"]["pins"], names, strict=True))


def test_shape_geometry_cache_keys_and_socket_base_keys_are_not_incompatible():
    plates = []
    for shape, angle in [("round", 0), ("square", 0), ("square", 30), ("triangle", 30)]:
        payload = polygon_payload(shape, angle, "detachable")
        plates.append(build_plates(ExportRequest.model_validate(payload)))
    assert plates[1][1].parts[0].solid is plates[2][1].parts[0].solid
    assert plates[1][1].parts[0].cache_key == plates[2][1].parts[0].cache_key
    assert len({plate[1].parts[0].cache_key for plate in plates}) == 3
    assert len({plate[0].parts[0].cache_key for plate in plates}) == 4


def test_round_rotation_has_no_geometry_layout_or_resource_effect():
    payload = polygon_payload("round", 0, "detachable")
    first = build_plates(ExportRequest.model_validate(payload))
    payload["parameters"]["pinRotation"] = 37
    second = build_plates(ExportRequest.model_validate(payload))
    for first_plate, second_plate in zip(first, second, strict=True):
        assert plate_stl(first_plate) == plate_stl(second_plate)
        for first_part, second_part in zip(first_plate.parts, second_plate.parts, strict=True):
            assert first_part.name == second_part.name
            assert first_part.cache_key == second_part.cache_key
            np.testing.assert_array_equal(first_part.transform, second_part.transform)


@pytest.mark.parametrize("shape", ["square", "triangle"])
@pytest.mark.parametrize("rotation", [0, 30, 45, 90])
def test_zero_clearance_socket_keeps_original_polygon_floor_and_insertion_depth(shape, rotation):
    payload = single_polygon_payload(shape, rotation, "detachable")
    payload["socket"]["clearance"] = 0
    request = ExportRequest.model_validate(payload)
    base = build_plates(request)[0].parts[0].solid
    area = 2 if shape == "square" else 3 * math.sqrt(3) / 4
    assert base.volume() == pytest.approx(1200 - area * 2, abs=1e-6)
    assert base.slice(0.999).area() == pytest.approx(400)
    assert base.slice(1.001).area() == pytest.approx(400 - area, abs=1e-6)
    assert base.slice(2.999).area() == pytest.approx(400 - area, abs=1e-6)
    assert read_stl(plate_stl(build_plates(request)[0])).volume() == pytest.approx(base.volume(), rel=1e-6)


@pytest.mark.parametrize("shape", ["square", "triangle"])
@pytest.mark.parametrize("mode", ["fixed", "detachable"])
@pytest.mark.parametrize("contour", ["hole", "curved", "disconnected"])
def test_polygon_exports_keep_holes_curved_and_disconnected_regions(shape, mode, contour, tmp_path):
    payload = polygon_payload(shape, 30, mode)
    if contour == "hole":
        payload["layout"]["regions"][0]["holes"] = [[[-1, -1], [1, -1], [1, 1], [-1, 1]]]
    elif contour == "curved":
        payload["layout"]["regions"] = [{"outer": [[10 * math.cos(index * math.pi / 32), 10 * math.sin(index * math.pi / 32)] for index in range(64)], "holes": []}]
    else:
        payload["layout"]["regions"] = [
            {"outer": [[-10, -10], [-1, -10], [-1, 10], [-10, 10]], "holes": []},
            {"outer": [[1, -10], [10, -10], [10, 10], [1, 10]], "holes": []},
        ]
        for pin in payload["layout"]["pins"]:
            pin["x"] *= 2
    request = ExportRequest.model_validate(payload)
    plates = build_plates(request)
    assert len(plates[0].parts[0].solid.decompose()) == (2 if contour == "disconnected" else 1)
    for plate in plates:
        read_stl(plate_stl(plate))
    output, _, _, _ = generate_export(request)
    path = tmp_path / "contours.3mf"
    path.write_bytes(output)
    model = lib3mf.get_wrapper().CreateModel()
    reader = model.QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(path))
    assert reader.GetWarningCount() == 0


@pytest.mark.parametrize("shape", ["square", "triangle"])
def test_bounds_aware_packing_rejects_oversized_parts_and_plate_overflow(shape):
    from pydantic import ValidationError

    payload = single_polygon_payload(shape, 30, "detachable")
    payload["parameters"]["diameter"] = 300
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(payload)
    payload = polygon_payload(shape, 30, "detachable", explicit=False)
    payload.update(heights=[1] * 100, pinMaterials=[0] * 100)
    payload["parameters"].update(columns=10, rows=10, width=50, depth=50)
    request = ExportRequest.model_validate(payload)
    request.plate.width = 12
    request.plate.depth = 12
    request.parameters.width = 1
    request.parameters.depth = 1
    with pytest.raises(ValueError, match="36"):
        plan_layout(request)
    request.parameters.diameter = 3
    with pytest.raises(ValueError, match="pin"):
        plan_layout(request)
