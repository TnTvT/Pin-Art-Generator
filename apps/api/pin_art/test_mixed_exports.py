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
from pin_art.test_geometry import placed_solid, polygon_area, read_stl
from pin_art.test_pin_geometries import mixed_payload
from pin_art.test_writer import read_model, read_transform


@pytest.mark.parametrize("explicit", [False, True])
@pytest.mark.parametrize("mode", ["fixed", "detachable"])
@pytest.mark.parametrize("clearance", [0, 0.2])
def test_mixed_solids_sockets_and_stl_use_each_resolved_geometry(explicit, mode, clearance):
    payload = mixed_payload(mode=mode, explicit=explicit, format="stl")
    payload["socket"]["clearance"] = clearance
    request = ExportRequest.model_validate(payload)
    plates = build_plates(request)
    pins = [part for plate in plates for part in plate.parts if part.name != "base"]
    assert [pin.solid.num_vert() for pin in pins] == [128, 8, 6, 6]
    assert pins[2].solid is pins[3].solid
    assert len({pin.cache_key for pin in pins}) == 3
    areas = [polygon_area(2), 2, 3 * math.sqrt(3) / 4, 3 * math.sqrt(3) / 4]
    for index, (pin, geometry) in enumerate(zip(pins, request.resolved_pin_geometries, strict=True)):
        solid = placed_solid(pin)
        bounds = local_bounds(geometry.shape, 2, geometry.rotation)
        horizontal, vertical, bottom = pin.transform[:3, 3]
        length = request.heights[index] + (2 if mode == "detachable" else 0)
        np.testing.assert_allclose(solid.bounding_box(), [bounds[0] + horizontal, bounds[1] + vertical, bottom, bounds[2] + horizontal, bounds[3] + vertical, bottom + length], atol=1e-8)
        assert solid.volume() == pytest.approx(areas[index] * length)
        assert f"{geometry.shape} {geometry.rotation:g}deg" in pin.name
        assert pin.material == request.pin_materials[index]
        if mode == "fixed":
            assert (plates[0].parts[0].solid ^ solid).is_empty()
    if mode == "detachable":
        base = plates[0].parts[0].solid
        sockets = [socket_footprint(geometry.shape, 2, geometry.rotation, clearance) for geometry in request.resolved_pin_geometries]
        assert base.volume() == pytest.approx(1200 - 2 * sum(socket.area for socket in sockets), abs=1e-6)
        assert base.slice(0.5).area() == pytest.approx(400)
        positions = [(pin.x, pin.y) for pin in request.layout.pins] if explicit else [(-2.5, -2.5), (2.5, -2.5), (-2.5, 2.5), (2.5, 2.5)]
        for index, (pin, geometry, position) in enumerate(zip(pins, request.resolved_pin_geometries, positions, strict=True)):
            probe = pin.solid.scale((2, 2, 2)).rotate((0, 0, geometry.rotation)).translate((*position, 1))
            assert (base ^ probe).volume() == pytest.approx(0, abs=1e-7)
            assert (base ^ probe.translate((0, 0, -1))).volume() == pytest.approx(areas[index], abs=1e-7)
    for plate in plates:
        solid = read_stl(plate_stl(plate))
        assert solid.bounding_box()[2] == 0
        assert solid.volume() == pytest.approx(sum(placed_solid(part).volume() for part in plate.parts), rel=1e-5)
        assert len(solid.decompose()) == (1 if mode == "fixed" else len(plate.parts))


def test_mixed_packing_uses_individual_asymmetric_bounds_and_stable_order():
    payload = mixed_payload(mode="detachable", explicit=False)
    payload.update(heights=[5] * 25, pinMaterials=[1] * 25, plate={"width": 30, "depth": 30})
    payload["parameters"].update(rows=5, columns=5, spacing=3)
    payload["pinGeometries"] = [payload["pinGeometries"][index % 4] for index in range(25)]
    request = ExportRequest.model_validate(payload)
    layouts = plan_layout(request)
    assert len(layouts) >= 3
    assert [part.pin_index for plate in layouts[1:] for part in plate.parts] == list(range(25))
    for plate in build_plates(request):
        boxes = np.array([placed_solid(part).bounding_box() for part in plate.parts])
        minimum, maximum = boxes[:, :3].min(axis=0), boxes[:, 3:].max(axis=0)
        np.testing.assert_allclose((minimum[:2] + maximum[:2]) / 2, [15, 15], atol=1e-8)
        assert np.all(minimum[:2] >= 5 - 1e-8) and np.all(maximum[:2] <= 25 + 1e-8)
        for index, first in enumerate(boxes):
            for second in boxes[index + 1:]:
                assert first[3] + 4 <= second[0] + 1e-8 or second[3] + 4 <= first[0] + 1e-8 or first[4] + 4 <= second[1] + 1e-8 or second[4] + 4 <= first[1] + 1e-8


@pytest.mark.parametrize("explicit", [False, True])
def test_socket_cache_identity_includes_ordered_resolved_geometry_and_positions(explicit):
    payload = mixed_payload(mode="detachable", explicit=explicit)
    original = build_plates(ExportRequest.model_validate(payload))[0].parts[0].cache_key
    payload["pinGeometries"][2]["rotation"] = 45
    assert build_plates(ExportRequest.model_validate(payload))[0].parts[0].cache_key != original
    payload["pinGeometries"][2]["rotation"] = 90
    payload["pinGeometries"][0], payload["pinGeometries"][1] = payload["pinGeometries"][1], payload["pinGeometries"][0]
    swapped = build_plates(ExportRequest.model_validate(payload))[0].parts[0].cache_key
    assert swapped != original
    payload["parameters"].update(pinShape="round", pinRotation=111)
    assert build_plates(ExportRequest.model_validate(payload))[0].parts[0].cache_key == swapped
    if explicit:
        payload["layout"]["pins"][0]["x"] += 0.1
    else:
        payload["parameters"]["spacing"] += 0.1
    assert build_plates(ExportRequest.model_validate(payload))[0].parts[0].cache_key != swapped


def test_mixed_zip_manifest_has_per_pin_geometry_identity_and_grounded_plates():
    request = ExportRequest.model_validate(mixed_payload(mode="detachable", format="stl"))
    output, filename, mime, count = generate_export(request)
    assert filename.endswith(".zip") and mime == "application/zip" and count == 2
    with zipfile.ZipFile(io.BytesIO(output)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        expected = [geometry.model_dump() for geometry in request.resolved_pin_geometries]
        assert manifest["pinGeometries"] == expected
        parts = [part for plate in manifest["plates"][1:] for part in plate["parts"]]
        assert [{"shape": part["shape"], "rotation": part["rotation"]} for part in parts] == expected
        assert [part["pinIndex"] for part in parts] == list(range(4))
        for pin, part in zip(request.layout.pins, parts, strict=True):
            assert pin.id in part["name"]
        for plate in manifest["plates"]:
            assert read_stl(archive.read(plate["file"])).bounding_box()[2] == 0


@pytest.mark.parametrize("explicit", [False, True])
@pytest.mark.parametrize("mode", ["fixed", "detachable"])
def test_mixed_3mf_strict_readback_bounds_profiles_resource_reuse_and_plate_ownership(explicit, mode, tmp_path):
    payload = mixed_payload(mode=mode, explicit=explicit)
    payload.update(materials=["#FFFFFF", "#FFFFFF", "#FF0000", "#ffffff"],
                   filamentProfiles=["bambu-pla-basic", "bambu-pla-matte", "generic-pla", "bambu-pla-basic"],
                   pinMaterials=[1, 2, 1, 3])
    if mode == "detachable":
        payload.update(heights=[5 + index / 10 for index in range(25)],
                       pinMaterials=[payload["pinMaterials"][index % 4] for index in range(25)],
                       pinGeometries=[payload["pinGeometries"][index % 4] for index in range(25)],
                       plate={"width": 30, "depth": 30})
        payload["parameters"].update(spacing=3)
        if explicit:
            payload["layout"]["pins"] = [{"id": f"pin:{index}", "x": (index % 5 - 2) * 3, "y": (index // 5 - 2) * 3} for index in range(25)]
        else:
            payload["parameters"].update(rows=5, columns=5)
    request = ExportRequest.model_validate(payload)
    plates = build_plates(request)
    output, _, _, count = generate_export(request)
    assert (count == 1) if mode == "fixed" else (count >= 3)
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
    expected = [part for plate in plates for part in plate.parts]
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
    assert [len(plate.findall("model_instance")) for plate in config.findall("plate")] == ([1] if mode == "fixed" else [len(plate.parts) for plate in plates])


@pytest.mark.parametrize("count", [35, 36])
def test_mixed_packing_preserves_thirty_six_plate_limit(count):
    payload = mixed_payload(mode="detachable", explicit=True)
    payload["parameters"].update(width=50, depth=50)
    payload["layout"]["regions"][0]["outer"] = [[-25, -25], [25, -25], [25, 25], [-25, 25]]
    payload["layout"]["pins"] = [{"id": f"pin:{index}", "x": (index % 6 - 2.5) * 5, "y": (index // 6 - 2.5) * 5} for index in range(count)]
    payload.update(heights=[1] * count, pinMaterials=[0] * count,
                   pinGeometries=[payload["pinGeometries"][index % 4] for index in range(count)])
    request = ExportRequest.model_validate(payload)
    request.parameters.width = request.parameters.depth = 2
    request.plate.width = request.plate.depth = 12
    if count == 35:
        assert len(plan_layout(request)) == 36
    else:
        with pytest.raises(ValueError, match="36 plates"):
            plan_layout(request)
