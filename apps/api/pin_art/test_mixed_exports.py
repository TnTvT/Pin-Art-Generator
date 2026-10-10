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
from pin_art.geometry import build_plate, plate_stl
from pin_art.schemas import ExportRequest
from pin_art.test_geometry import placed_solid, polygon_area, read_stl
from pin_art.test_pin_geometries import mixed_payload
from pin_art.test_writer import read_model, read_transform


@pytest.mark.parametrize("explicit", [False, True])
@pytest.mark.parametrize("mode", ["fixed"])
def test_mixed_solids_and_stl_use_each_resolved_geometry(explicit, mode):
    payload = mixed_payload(mode=mode, explicit=explicit, format="stl")
    request = ExportRequest.model_validate(payload)
    plate = build_plate(request)
    pins = [part for part in plate.parts if part.name != "base"]
    assert [pin.solid.num_vert() for pin in pins] == [128, 8, 6, 6]
    assert pins[2].solid is pins[3].solid
    assert len({pin.cache_key for pin in pins}) == 3
    areas = [polygon_area(2), 2, 3 * math.sqrt(3) / 4, 3 * math.sqrt(3) / 4]
    for index, (pin, geometry) in enumerate(zip(pins, request.resolved_pin_geometries, strict=True)):
        solid = placed_solid(pin)
        bounds = local_bounds(geometry.shape, 2, geometry.rotation)
        horizontal, vertical, bottom = pin.transform[:3, 3]
        length = request.heights[index] + (0)
        np.testing.assert_allclose(solid.bounding_box(), [bounds[0] + horizontal, bounds[1] + vertical, bottom, bounds[2] + horizontal, bounds[3] + vertical, bottom + length], atol=1e-8)
        assert solid.volume() == pytest.approx(areas[index] * length)
        assert f"{geometry.shape} {geometry.rotation:g}deg" in pin.name
        assert pin.material == request.pin_materials[index]
        assert (plate.parts[0].solid ^ solid).is_empty()

    solid = read_stl(plate_stl(plate))
    assert solid.bounding_box()[2] == 0
    assert solid.volume() == pytest.approx(sum(placed_solid(part).volume() for part in plate.parts), rel=1e-5)
    assert len(solid.decompose()) == (1)


@pytest.mark.parametrize("explicit", [False, True])
@pytest.mark.parametrize("mode", ["fixed"])
def test_mixed_3mf_strict_readback_bounds_profiles_resource_reuse_and_plate_ownership(explicit, mode, tmp_path):
    payload = mixed_payload(mode=mode, explicit=explicit)
    payload.update(materials=["#FFFFFF", "#FFFFFF", "#FF0000", "#ffffff"],
                   filamentProfiles=["bambu-pla-basic", "bambu-pla-matte", "generic-pla", "bambu-pla-basic"],
                   pinMaterials=[1, 2, 1, 3])

    request = ExportRequest.model_validate(payload)
    plate = build_plate(request)
    output, _, _, count = generate_export(request)
    assert count == 1
    path = tmp_path / "mixed.3mf"
    path.write_bytes(output)
    model = lib3mf.get_wrapper().CreateModel()
    reader = model.QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(path))
    assert reader.GetWarningCount() == 0
    namespace, root, objects, _ = read_model(output)
    with zipfile.ZipFile(io.BytesIO(output)) as archive:
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        settings = json.loads(archive.read("Metadata/project_settings.config"))
    assert settings["filament_colour"] == ["#FFFFFF", "#FFFFFF", "#FF0000"]
    assert settings["filament_ids"] == ["GFA00", "GFA01", "GFL99"]
    assert settings["printer_model"] == "Bambu Lab X1 Carbon"
    configs = {entry.attrib["id"]: entry for entry in config.findall("object")}
    expected = [part for part in plate.parts]
    palette_indices = [1, 2, 3, 1]
    reused = {}
    part_index = 0
    build_ids = []
    for item in root.findall(f"{namespace}build/{namespace}item"):
        build_ids.append(item.attrib["objectid"])
        components = objects[item.attrib["objectid"]].findall(f"{namespace}components/{namespace}component")
        for component, part_config in zip(components, configs[item.attrib["objectid"]].findall("part"), strict=True):
            part = expected[part_index]
            mesh_id = component.attrib["objectid"]
            mesh = objects[mesh_id]
            vertices = np.array([[float(vertex.attrib[axis]) for axis in ["x", "y", "z"]] for vertex in mesh.findall(f"{namespace}mesh/{namespace}vertices/{namespace}vertex")])
            triangles = np.array([[int(triangle.attrib[axis]) for axis in ["v1", "v2", "v3"]] for triangle in mesh.findall(f"{namespace}mesh/{namespace}triangles/{namespace}triangle")], dtype=np.uint64)
            matrix = read_transform(component)
            metadata_matrix = np.array([float(value) for value in part_config.find("metadata[@key='matrix']").attrib["value"].split()]).reshape(4, 4)
            np.testing.assert_allclose(matrix, metadata_matrix, atol=1e-12)
            world = np.c_[vertices, np.ones(len(vertices))] @ matrix.T
            readback = manifold3d.Manifold(manifold3d.Mesh64(world[:, :3], triangles))
            assert readback.status() == manifold3d.Error.NoError
            np.testing.assert_allclose(readback.bounding_box(), placed_solid(part).bounding_box(), atol=1e-6)
            assert readback.volume() == pytest.approx(placed_solid(part).volume(), rel=1e-6)
            assert part_config.find("metadata[@key='name']").attrib["value"] == part.name
            assert part_config.find("metadata[@key='extruder']").attrib["value"] == str(palette_indices[part.material])
            built = np.c_[vertices, np.ones(len(vertices))] @ (read_transform(item) @ matrix).T
            assert built[:, 2].min() == pytest.approx(3 if mode == "fixed" and part.pin_index is not None else 0, abs=1e-8)
            key = (part.cache_key, palette_indices[part.material])
            assert reused.setdefault(key, mesh_id) == mesh_id
            part_index += 1
    assert part_index == len(expected)
    assert len(set(reused.values())) == len(reused) == 5
    plate_ids = [entry.attrib["value"] for entry in config.findall("plate/model_instance/metadata[@key='object_id']")]
    assert plate_ids == build_ids
    assert [len(plate.findall("model_instance")) for plate in config.findall("plate")] == ([1])
