import io
import json
import math
import zipfile
from xml.etree import ElementTree as ET

import lib3mf
import manifold3d
import numpy as np
import pytest

from pin_art.cross_sections import local_bounds
from pin_art.exporter import generate_export
from pin_art.geometry import build_plates, plate_stl
from pin_art.layout import plan_layout
from pin_art.schemas import ExportRequest
from pin_art.test_geometry import placed_solid, read_stl
from pin_art.test_polygon_layout import polygon_payload, single_polygon_payload
from pin_art.test_writer import read_model, read_transform


@pytest.mark.parametrize("shape", ["square", "triangle"])
@pytest.mark.parametrize("rotation", [0, 30, 45, 90, 360])
@pytest.mark.parametrize("mode", ["fixed"])
@pytest.mark.parametrize("explicit", [False, True])
def test_native_polygon_geometry_dimensions_rotation_volumes_and_stl(shape, rotation, mode, explicit):
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
        length = request.heights[index] + (0)
        bottom = 3
        horizontal, vertical = pin.transform[:2, 3]
        np.testing.assert_allclose(solid.bounding_box(), [bounds[0] + horizontal, bounds[1] + vertical, bottom, bounds[2] + horizontal, bounds[3] + vertical, bottom + length], atol=2e-8)
        assert solid.volume() == pytest.approx(unit_area * 4 * length)
        np.testing.assert_allclose(pin.transform[:2, :2] / 2, [[math.cos(math.radians(rotation)), -math.sin(math.radians(rotation))], [math.sin(math.radians(rotation)), math.cos(math.radians(rotation))]], atol=1e-12)
        assert pin.material == request.pin_materials[index]
        assert (plates[0].parts[0].solid ^ solid).is_empty()
    base = plates[0].parts[0].solid
    expected_base_volume = 1200

    assert base.volume() == pytest.approx(expected_base_volume, abs=1e-6)
    for plate in plates:
        readback = read_stl(plate_stl(plate))
        expected_volume = sum(placed_solid(part).volume() for part in plate.parts)
        assert readback.volume() == pytest.approx(expected_volume, rel=1e-5)
        boxes = np.array([placed_solid(part).bounding_box() for part in plate.parts])
        np.testing.assert_allclose(readback.bounding_box(), [*boxes[:, :3].min(axis=0), *boxes[:, 3:].max(axis=0)], atol=2e-5)
        assert len(readback.decompose()) == (1)
        assert readback.bounding_box()[2] == 0


@pytest.mark.parametrize("shape", ["square", "triangle"])
@pytest.mark.parametrize("rotation", [0, 30, 45, 90])
@pytest.mark.parametrize("mode", ["fixed"])
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
    assert count == (1)
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



@pytest.mark.parametrize("shape", ["square", "triangle"])
@pytest.mark.parametrize("mode", ["fixed"])
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
