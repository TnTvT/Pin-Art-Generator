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
from pin_art.writer import export_3mf, precise_package


def test_precise_package_preserves_mesh_bytes_and_non_model_entries():
    mesh = b'<mesh><vertices><vertex x="0.123456789" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>'
    xml = b'<model><resources><object id="1">' + mesh + b'</object><object id="2"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object></resources><build><item objectid="2"/></build></model>'
    source = io.BytesIO()
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("3D/3dmodel.model", xml)
        archive.writestr("Metadata/project_settings.config", b'{"filament_colour":["#FFFFFF"]}')
    component = np.eye(4)
    component[2, 3] = 0.12345678912345678
    build = np.eye(4)
    build[:2, 3] = 128
    result = precise_package(source.getvalue(), {"2": [component]}, {"2": build})
    with zipfile.ZipFile(io.BytesIO(result)) as archive:
        updated = archive.read("3D/3dmodel.model")
        assert mesh in updated
        root = ET.fromstring(updated)
        np.testing.assert_array_equal(read_transform(root.find("resources/object/components/component")), component)
        np.testing.assert_array_equal(read_transform(root.find("build/item")), build)
        assert archive.read("Metadata/project_settings.config") == b'{"filament_colour":["#FFFFFF"]}'
    with pytest.raises(ValueError, match="component transforms"):
        precise_package(source.getvalue(), {"2": [component, component]}, {"2": build})


def small_request(mode="fixed"):
    return ExportRequest.model_validate({
        "format": "3mf", "mode": mode,
        "parameters": {"width": 12, "depth": 12, "thickness": 3, "columns": 2,
                       "rows": 1, "spacing": 5, "diameter": 2, "extension": 10},
        "heights": [5, 10], "materials": ["#FFFFFF", "#FF0000"],
        "baseMaterial": 0, "pinMaterials": [1, 1],
    })


@pytest.mark.parametrize("mode", ["fixed"])
def test_image_palette_snapshot_preserves_row_major_heights_and_filament_slots(mode, tmp_path):
    payload = small_request(mode).model_dump(by_alias=True)
    payload["parameters"]["rows"] = 2
    payload.update(
        heights=[2, 10.13155, 8, 15],
        materials=["#8E9089", "#FFFFFF", "#FFFFFF", "#00B1B7"],
        filamentProfiles=["bambu-pla-basic", "bambu-pla-basic", "bambu-pla-matte", "bambu-pla-basic"],
        pinMaterials=[1, 3, 2, 1],
    )
    request = ExportRequest.model_validate(payload)
    plates = build_plates(request)
    output = tmp_path / "image-palette.3mf"
    output.write_bytes(export_3mf(request, plates))
    model = lib3mf.get_wrapper().CreateModel()
    reader = model.QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(output))
    assert reader.GetWarningCount() == 0
    with zipfile.ZipFile(output) as archive:
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        assert settings["filament_colour"] == ["#8E9089", "#FFFFFF", "#00B1B7", "#FFFFFF"]
        assert settings["filament_ids"] == ["GFA00", "GFA00", "GFA00", "GFA01"]
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        assert [entry.attrib["value"] for entry in config.findall("object/part/metadata[@key='extruder']")] == ["1", "2", "3", "4", "2"]
    namespace, root, objects, _ = read_model(output.read_bytes())
    lengths = []
    for item in root.findall(f"{namespace}build/{namespace}item"):
        for component in objects[item.attrib["objectid"]].findall(f"{namespace}components/{namespace}component"):
            mesh = objects[component.attrib["objectid"]]
            if mesh.attrib["name"] == "base":
                continue
            vertices = np.array([[float(vertex.attrib[axis]) for axis in ["x", "y", "z"]] for vertex in mesh.findall(f"{namespace}mesh/{namespace}vertices/{namespace}vertex")])
            world = np.c_[vertices, np.ones(len(vertices))] @ (read_transform(item) @ read_transform(component)).T
            assert world[:, 2].min() == pytest.approx(3)
            lengths.append(world[:, 2].max() - world[:, 2].min())
    np.testing.assert_allclose(lengths, np.array(payload["heights"]) + (0))


@pytest.mark.parametrize("mode", ["fixed"])
def test_edited_pin_package_keeps_heights_color_profiles_and_part_ownership(mode, tmp_path):
    payload = small_request(mode).model_dump(by_alias=True)
    payload.update(heights=[30, 40], materials=["#FFFFFF", "#FFFFFF", "#FF0000"],
                   filamentProfiles=["bambu-pla-basic", "bambu-pla-matte", "generic-pla"], pinMaterials=[1, 2])
    request = ExportRequest.model_validate(payload)
    plates = build_plates(request)
    output = tmp_path / "edited.3mf"
    output.write_bytes(export_3mf(request, plates))
    model = lib3mf.get_wrapper().CreateModel()
    reader = model.QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(output))
    assert reader.GetWarningCount() == 0
    with zipfile.ZipFile(output) as archive:
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        assert settings["filament_colour"] == ["#FFFFFF", "#FFFFFF", "#FF0000"]
        assert settings["filament_ids"] == ["GFA00", "GFA01", "GFL99"]
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        assert [entry.attrib["value"] for entry in config.findall("object/part/metadata[@key='extruder']")] == ["1", "2", "3"]
        assert len(config.findall("plate")) == (1)
        names = [part.name for plate in plates for part in plate.parts][1:]
        assert f"{30:.3f} mm" in names[0]
        assert f"{40:.3f} mm" in names[1]
    namespace, root, objects, _ = read_model(output.read_bytes())
    lengths = []
    for item in root.findall(f"{namespace}build/{namespace}item"):
        for component in objects[item.attrib["objectid"]].findall(f"{namespace}components/{namespace}component"):
            mesh = objects[component.attrib["objectid"]]
            if mesh.attrib["name"] == "base":
                continue
            vertices = np.array([[float(vertex.attrib[axis]) for axis in ["x", "y", "z"]] for vertex in mesh.findall(f"{namespace}mesh/{namespace}vertices/{namespace}vertex")])
            world = np.c_[vertices, np.ones(len(vertices))] @ (read_transform(item) @ read_transform(component)).T
            assert world[:, 2].min() == pytest.approx(3)
            lengths.append(world[:, 2].max() - world[:, 2].min())
    np.testing.assert_allclose(lengths, np.array([30, 40]) + (0))


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
        assert settings["inherits_group"] == ["0.20mm Standard @BBL X1C", "Generic PLA", "Generic PLA", "Bambu Lab X1 Carbon 0.4 nozzle"]
        assert settings["filament_settings_id"] == ["Generic PLA", "Generic PLA"]
        assert settings["filament_ids"] == ["GFL99", "GFL99"]
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


@pytest.mark.parametrize("mode", ["fixed"])
@pytest.mark.parametrize("colors", [["#FFFFFF", "#FFFFFF"], ["#112233", "#E8AFCF"]])
def test_selected_basic_and_matte_profiles_survive_with_matching_part_indices(mode, colors, tmp_path):
    payload = small_request(mode).model_dump(by_alias=True)
    payload.update(materials=colors, filamentProfiles=["bambu-pla-basic", "bambu-pla-matte"])
    request = ExportRequest.model_validate(payload)
    data = export_3mf(request, build_plates(request))
    output = tmp_path / "filament-profiles.3mf"
    output.write_bytes(data)
    model = lib3mf.get_wrapper().CreateModel()
    reader = model.QueryReader("3mf")
    reader.SetStrictModeActive(True)
    reader.ReadFromFile(str(output))
    assert reader.GetWarningCount() == 0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        names = ["Bambu PLA Basic @BBL X1C", "Bambu PLA Matte @BBL X1C"]
        assert settings["filament_settings_id"] == names
        assert settings["filament_ids"] == ["GFA00", "GFA01"]
        assert settings["filament_type"] == ["PLA", "PLA"]
        assert settings["filament_vendor"] == ["Bambu Lab", "Bambu Lab"]
        assert settings["inherits_group"] == ["0.20mm Standard @BBL X1C", *names, "Bambu Lab X1 Carbon 0.4 nozzle"]
        assert settings["different_settings_to_system"] == ["", "", "", ""]
        assert settings["filament_colour"] == settings["filament_multi_colour"] == colors
        assert "default_filament_colour" not in settings
        assert "nozzle_temperature" not in settings
        assert "filament_ams_mapping" not in settings
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        assert [entry.attrib["value"] for entry in config.findall("object/part/metadata[@key='extruder']")] == ["1", "2", "2"]
        assert len(config.findall("plate")) == (1)


@pytest.mark.parametrize("mode", ["fixed"])
@pytest.mark.parametrize("material_count", [1, 2, 16])
def test_final_package_has_aligned_bambu_27_filament_routing(mode, material_count):
    payload = small_request(mode).model_dump(by_alias=True)
    payload.update(
        materials=[f"#{index:06X}" for index in range(material_count)],
        filamentProfiles=["bambu-pla-basic"] * material_count,
        baseMaterial=0,
        pinMaterials=[min(1, material_count - 1)] * 2,
    )
    request = ExportRequest.model_validate(payload)
    parts = [
        Part(f"Material {index}", manifold3d.Manifold.cube((1, 1, 1)), index, np.eye(4), "cube")
        for index in range(material_count)
    ]
    with zipfile.ZipFile(io.BytesIO(export_3mf(request, [Plate(0, parts)]))) as archive:
        settings = json.loads(archive.read("Metadata/project_settings.config"))
    variants = settings.get("filament_extruder_variant", ["Direct Drive Standard"])
    indices = settings.get("filament_self_index", ["1"])
    assert len(variants) == len(indices) == len(settings["filament_colour"])
    assert variants == ["Direct Drive Standard"] * material_count
    assert indices == [str(index + 1) for index in range(material_count)]
    assert settings["extruder_variant_list"] == ["Direct Drive Standard"]
    assert settings["nozzle_diameter"] == ["0.4"]
    assert settings["different_settings_to_system"] == [""] * (material_count + 2)
    assert "default_filament_colour" not in settings


def test_material_compaction_uses_color_and_profile_and_drops_unused_materials():
    payload = small_request().model_dump(by_alias=True)
    payload.update(materials=["#FFFFFF", "#ffffff", "#000000"], filamentProfiles=["bambu-pla-basic", "bambu-pla-basic", "bambu-pla-matte"])
    request = ExportRequest.model_validate(payload)
    with zipfile.ZipFile(io.BytesIO(export_3mf(request, build_plates(request)))) as archive:
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        assert settings["filament_settings_id"] == ["Bambu PLA Basic @BBL X1C"]
        assert settings["filament_self_index"] == ["1"]
        assert settings["filament_extruder_variant"] == ["Direct Drive Standard"]
        assert settings["filament_colour"] == ["#FFFFFF"]
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        assert {entry.attrib["value"] for entry in config.findall("object/part/metadata[@key='extruder']")} == {"1"}


def test_profiles_follow_used_palette_order_including_generic_color_fallback():
    payload = small_request("fixed").model_dump(by_alias=True)
    payload.update(materials=["#FFFFFF", "#ffffff"], filamentProfiles=["bambu-pla-basic", "generic-pla"], baseMaterial=1, pinMaterials=[0, 0])
    request = ExportRequest.model_validate(payload)
    with zipfile.ZipFile(io.BytesIO(export_3mf(request, build_plates(request)))) as archive:
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        assert settings["filament_settings_id"] == ["Generic PLA", "Bambu PLA Basic @BBL X1C"]
        assert settings["filament_ids"] == ["GFL99", "GFA00"]
        assert settings["filament_colour"] == ["#FFFFFF", "#FFFFFF"]
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        assert [entry.attrib["value"] for entry in config.findall("object/part/metadata[@key='extruder']")] == ["1", "2", "2"]


def test_actual_parts_preserve_names_geometry_properties_and_plate_membership():
    request = small_request()
    request.pin_materials = [1, 0]
    plates = build_plates(request)
    assert len(plates) == 1
    with zipfile.ZipFile(io.BytesIO(export_3mf(request, plates))) as archive:
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        names = [entry.attrib["value"] for entry in config.findall("object/part/metadata[@key='name']")]
        assert names == ["base", "Pin R01 C01 5.000 mm", "Pin R01 C02 10.000 mm"]
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


def test_physical_x1c_plate_origin_centers_complete_assembly():
    request = small_request()
    namespace, root, objects, config = read_model(export_3mf(request, build_plates(request)))
    items = {item.attrib["objectid"]: item for item in root.findall(f"{namespace}build/{namespace}item")}
    assert len(config.findall("plate")) == 1
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


@pytest.mark.parametrize("mode", ["fixed"])
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
            bottom = request.parameters.thickness
            assert world[:, 2].min() == pytest.approx(bottom, abs=1e-9)
            length = world[:, 2].max() - world[:, 2].min()
            lengths.append(length)
    insertion = 0
    np.testing.assert_allclose(lengths, np.array(request.heights) + insertion, rtol=0, atol=1e-9)
