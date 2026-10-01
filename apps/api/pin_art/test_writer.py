import io
import json
import zipfile
from xml.etree import ElementTree as ET

import lib3mf
import manifold3d
import numpy as np

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
        assert "printer_settings_id" not in settings
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
