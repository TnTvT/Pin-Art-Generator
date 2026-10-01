import io
import json
import zipfile
from xml.etree import ElementTree as ET

import lib3mf
import manifold3d
import numpy as np
import pytest

from pin_art.geometry import Part, Plate, build_plates
from pin_art.schemas import ExportRequest
from pin_art.writer import export_3mf


def small_request(mode="detachable"):
    return ExportRequest.model_validate({
        "format": "3mf", "mode": mode,
        "parameters": {"width": 12, "depth": 12, "thickness": 3, "columns": 2,
                       "rows": 1, "spacing": 5, "diameter": 2, "extension": 10},
        "heights": [5, 10], "materials": ["#FFFFFF", "#FF0000"],
        "baseMaterial": 0, "pinMaterials": [1, 1],
        "plate": {"width": 32, "depth": 32},
    })


def test_colored_multiplate_package_reads_strictly(tmp_path):
    base = Part("Socket base", manifold3d.Manifold.cube((12, 12, 3)), 0, np.eye(4), "base")
    pin = Part("Pin R1 C1 · 7 mm", manifold3d.Manifold.cylinder(1, .5, .5, 64), 1, np.eye(4), "pin")
    plates = [Plate(0, [base]), Plate(1, [pin])]
    output = tmp_path / "parts.3mf"
    output.write_bytes(export_3mf(small_request(), plates))
    wrapper = lib3mf.get_wrapper()
    model = wrapper.CreateModel()
    reader = model.QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(output))
    assert reader.GetWarningCount() == 0
    assert model.GetBuildItems().Count() == 2
    with zipfile.ZipFile(output) as archive:
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        assert len(config.findall("plate")) == 2
        assert [entry.attrib["value"] for entry in config.findall("object/part/metadata[@key='extruder']")] == ["1", "2"]
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        assert settings["filament_colour"] == ["#FFFFFF", "#FF0000"]
        assert settings["printer_settings_id"] == "Bambu Lab X1 Carbon 0.4 nozzle"
        assert settings["printer_model"] == "Bambu Lab X1 Carbon"
        assert settings["nozzle_diameter"] == ["0.4"]
        assert settings["printable_area"] == ["0x0", "256x0", "256x256", "0x256"]
        assert settings["printable_height"] == "250"
        assert settings["print_settings_id"] == "0.20mm Standard @BBL X1C"
        assert settings["inherits_group"] == ["0.20mm Standard @BBL X1C", "", "", "Bambu Lab X1 Carbon 0.4 nozzle"]
        assert "nozzle_temperature" not in settings
        root = ET.fromstring(archive.read("3D/3dmodel.model"))
        namespace = {"m": "http://schemas.microsoft.com/3dmanufacturing/material/2015/02"}
        assert len(root.findall(".//m:color", namespace)) == 2
        types = ET.fromstring(archive.read("[Content_Types].xml"))
        assert any(entry.attrib.get("Extension") == "config" for entry in types)
        relationships = ET.fromstring(archive.read("_rels/.rels"))
        assert sum(entry.attrib["Type"].endswith("/3dmodel") for entry in relationships) == 1


def test_identical_materials_are_compacted(tmp_path):
    request = small_request()
    request.materials = ["#FF0000", "#FF0000"]
    part = Part("Base", manifold3d.Manifold.cube((1, 1, 1)), 0, np.eye(4), "base")
    second = Part("Pin", manifold3d.Manifold.cube((1, 1, 1)), 1, np.eye(4), "pin")
    with zipfile.ZipFile(io.BytesIO(export_3mf(request, [Plate(0, [part, second])]))) as archive:
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        assert settings["filament_colour"] == ["#FF0000"]
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        assert {entry.attrib["value"] for entry in config.findall("object/part/metadata[@key='extruder']")} == {"1"}


def test_actual_parts_preserve_names_geometry_properties_and_plate_membership():
    request = small_request()
    request.plate.width = 22
    request.plate.depth = 22
    request.pin_materials = [1, 0]
    plates = build_plates(request)
    assert len(plates) == 2
    with zipfile.ZipFile(io.BytesIO(export_3mf(request, plates))) as archive:
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        names = [entry.attrib["value"] for entry in config.findall("object/metadata[@key='name']")]
        assert names == ["base", "Pin R01 C01 7.000 mm", "Pin R01 C02 12.000 mm"]
        namespace = "{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"
        root = ET.fromstring(archive.read("3D/3dmodel.model"))
        objects = {entry.attrib["id"]: entry for entry in root.findall(f"{namespace}resources/{namespace}object")}
        build_ids = {entry.attrib["objectid"] for entry in root.findall(f"{namespace}build/{namespace}item")}
        metadata_ids = [entry.attrib["value"] for entry in config.findall("plate/model_instance/metadata[@key='object_id']")]
        assert set(metadata_ids) == build_ids
        assert len(metadata_ids) == len(build_ids)
        colors = []
        for object_config in config.findall("object"):
            for part_config in object_config.findall("part"):
                mesh = objects[part_config.attrib["id"]]
                assert "pid" in mesh.attrib
                colors.append(mesh.attrib["pindex"])
        assert colors == ["0", "1", "0"]


def read_model(data):
    namespace = "{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        root = ET.fromstring(archive.read("3D/3dmodel.model"))
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
    objects = {entry.attrib["id"]: entry for entry in root.findall(f"{namespace}resources/{namespace}object")}
    return namespace, root, objects, config


def read_transform(element):
    values = np.array([float(value) for value in element.attrib.get("transform", "1 0 0 0 1 0 0 0 1 0 0 0").split()])
    transform = np.eye(4)
    transform[:3, :] = values.reshape(4, 3).T
    return transform


def test_shared_meshes_are_centered_so_bambu_does_not_shift_repeated_pins():
    request = small_request("fixed")
    namespace, root, objects, config = read_model(export_3mf(request, build_plates(request)))
    item = root.find(f"{namespace}build/{namespace}item")
    components = objects[item.attrib["objectid"]].findall(f"{namespace}components/{namespace}component")
    part_metadata = config.find("object").findall("part")
    assert len(part_metadata) == len(components) == 3
    assert [part.find("metadata[@key='name']").attrib["value"] for part in part_metadata] == ["base", "Pin R01 C01 5.000 mm", "Pin R01 C02 10.000 mm"]
    assert components[1].attrib["objectid"] == components[2].attrib["objectid"]
    for index, component in enumerate(components):
        mesh = objects[component.attrib["objectid"]]
        vertices = np.array([[float(vertex.attrib[axis]) for axis in ["x", "y", "z"]] for vertex in mesh.findall(f"{namespace}mesh/{namespace}vertices/{namespace}vertex")])
        np.testing.assert_allclose((vertices.min(axis=0) + vertices.max(axis=0)) / 2, 0, atol=1e-7)
        world = np.c_[vertices, np.ones(len(vertices))] @ (read_transform(item) @ read_transform(component)).T
        assert world[:, 2].min() == (0 if index == 0 else 3)
        assert world[:, 2].max() == (3 if index == 0 else 3 + request.heights[index - 1])


def test_physical_x1c_plate_origins_and_centering_ignore_custom_packing_area():
    request = small_request()
    namespace, root, objects, config = read_model(export_3mf(request, build_plates(request)))
    items = {item.attrib["objectid"]: item for item in root.findall(f"{namespace}build/{namespace}item")}
    assert len(config.findall("plate")) == 2
    for plate_index, plate in enumerate(config.findall("plate")):
        positions = []
        for entry in plate.findall("model_instance/metadata[@key='object_id']"):
            item = items[entry.attrib["value"]]
            component = objects[item.attrib["objectid"]].find(f"{namespace}components/{namespace}component")
            mesh = objects[component.attrib["objectid"]]
            vertices = np.array([[float(vertex.attrib[axis]) for axis in ["x", "y", "z"]] for vertex in mesh.findall(f"{namespace}mesh/{namespace}vertices/{namespace}vertex")])
            positions.extend((np.c_[vertices, np.ones(len(vertices))] @ (read_transform(item) @ read_transform(component)).T)[:, :3])
        positions = np.array(positions)
        center = (positions.min(axis=0) + positions.max(axis=0)) / 2
        np.testing.assert_allclose(center[:2], [128 + plate_index * 307.2, 128])
        assert positions[:, 2].min() == 0


@pytest.mark.parametrize("mode", ["fixed", "detachable"])
def test_fractional_pin_heights_preserve_contact_with_base_or_plate(mode):
    request = small_request(mode)
    request.heights = [8.02507837, 7.0834999]
    namespace, root, objects, _ = read_model(export_3mf(request, build_plates(request)))
    lengths = []
    for item in root.findall(f"{namespace}build/{namespace}item"):
        for component in objects[item.attrib["objectid"]].findall(f"{namespace}components/{namespace}component"):
            mesh = objects[component.attrib["objectid"]]
            if mesh.attrib["name"] == "base":
                continue
            vertices = np.array([[float(vertex.attrib[axis]) for axis in ["x", "y", "z"]] for vertex in mesh.findall(f"{namespace}mesh/{namespace}vertices/{namespace}vertex")])
            transform = read_transform(item) @ read_transform(component)
            world = np.c_[vertices, np.ones(len(vertices))] @ transform.T
            bottom = request.parameters.thickness if mode == "fixed" else 0
            assert world[:, 2].min() == pytest.approx(bottom, abs=1e-9)
            length = world[:, 2].max() - world[:, 2].min()
            lengths.append(length)
    insertion = request.socket.insertion_depth if mode == "detachable" else 0
    np.testing.assert_allclose(lengths, np.array(request.heights) + insertion, rtol=0, atol=1e-9)
