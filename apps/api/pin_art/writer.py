from __future__ import annotations

import json
import math
from xml.etree import ElementTree as ET

import lib3mf
import numpy as np

from pin_art.geometry import Part, Plate
from pin_art.schemas import ExportRequest


def metadata(parent: ET.Element, key: str, value: object) -> None:
    ET.SubElement(parent, "metadata", {"key": key, "value": str(value)})


def native_transform(wrapper, matrix: np.ndarray):
    transform = wrapper.GetIdentityTransform()
    for column in range(4):
        for row in range(3):
            transform.Fields[column][row] = float(matrix[row, column])
    return transform


def add_mesh(model, wrapper, part: Part, colors, color_index: int):
    source = part.solid.to_mesh()
    positions = []
    triangles = []
    for coordinates in source.vert_properties[:, :3]:
        position = lib3mf.Position()
        position.Coordinates[:] = [float(value) for value in coordinates]
        positions.append(position)
    for indices in source.tri_verts:
        triangle = lib3mf.Triangle()
        triangle.Indices[:] = [int(value) for value in indices]
        triangles.append(triangle)
    mesh = model.AddMeshObject()
    mesh.SetName(part.name)
    mesh.SetGeometry(positions, triangles)
    mesh.SetObjectLevelProperty(colors.GetResourceID(), color_index)
    if not mesh.IsManifoldAndOriented():
        raise ValueError("Generated geometry is not a closed, oriented solid.")
    return mesh


def plate_origin(index: int, count: int, width: float, depth: float) -> np.ndarray:
    columns = math.ceil(math.sqrt(count))
    return np.array([(index % columns) * width * 1.2, -(index // columns) * depth * 1.2, 0.0])


def export_3mf(request: ExportRequest, plates: list[Plate]) -> bytes:
    wrapper = lib3mf.get_wrapper()
    model = wrapper.CreateModel()
    model.SetUnit(lib3mf.ModelUnit.MilliMeter)
    group = model.GetMetaDataGroup()
    group.AddMetaData("", "Application", "BambuStudio-02.04.00.70", "xs:string", False)
    group.AddMetaData("", "Title", "Pin Art Studio", "xs:string", False)
    palette = list(dict.fromkeys(request.materials[part.material].upper() for plate in plates for part in plate.parts))
    color_group = model.AddColorGroup()
    color_indices = {}
    for color in palette:
        channels = [int(color[offset:offset + 2], 16) for offset in (1, 3, 5)]
        color_indices[color] = color_group.AddColor(wrapper.RGBAToColor(*channels, 255))
    settings = ET.Element("config")
    mesh_cache = {}

    def resource(part: Part):
        color = request.materials[part.material].upper()
        key = (part.cache_key, color)
        if key not in mesh_cache:
            mesh_cache[key] = add_mesh(model, wrapper, part, color_group, color_indices[color])
        return mesh_cache[key], palette.index(color) + 1

    def assembly(parts: list[Part], name: str, build_matrix: np.ndarray):
        root = model.AddComponentsObject()
        root.SetName(name)
        object_config = ET.SubElement(settings, "object", {"id": str(root.GetResourceID())})
        metadata(object_config, "name", name)
        seen = set()
        for part in parts:
            mesh, filament = resource(part)
            root.AddComponent(mesh, native_transform(wrapper, part.transform))
            if mesh.GetResourceID() not in seen:
                part_config = ET.SubElement(object_config, "part", {"id": str(mesh.GetResourceID()), "subtype": "normal_part"})
                metadata(part_config, "name", part.name)
                metadata(part_config, "extruder", filament)
                seen.add(mesh.GetResourceID())
        model.AddBuildItem(root, native_transform(wrapper, build_matrix))
        return root.GetResourceID()

    for plate_number, plate in enumerate(plates):
        plate_config = ET.SubElement(settings, "plate")
        metadata(plate_config, "plater_id", plate_number + 1)
        metadata(plate_config, "plater_name", f"Pin Art · Plate {plate_number + 1}")
        metadata(plate_config, "locked", "false")
        origin = plate_origin(plate_number, len(plates), request.plate.width, request.plate.depth)
        build_matrix = np.eye(4)
        build_matrix[:3, 3] = origin
        object_ids = []
        if request.mode == "fixed":
            build_matrix[:2, 3] += [request.plate.width / 2, request.plate.depth / 2]
            object_ids.append(assembly(plate.parts, "Fixed pin sculpture", build_matrix))
        else:
            for part in plate.parts:
                object_ids.append(assembly([part], part.name, build_matrix))
        for object_id in object_ids:
            instance = ET.SubElement(plate_config, "model_instance")
            metadata(instance, "object_id", object_id)
            metadata(instance, "instance_id", 0)
            metadata(instance, "identify_id", object_id)

    project_settings = {
        "filament_colour": palette,
        "filament_multi_colour": palette,
        "default_filament_colour": palette,
        "filament_settings_id": [""] * len(palette),
    }
    model.AddCustomContentType("config", "application/octet-stream")
    documents = {
        "model_settings": ET.tostring(settings, encoding="utf-8", xml_declaration=True),
        "project_settings": json.dumps(project_settings).encode("utf-8"),
    }
    for name, content in documents.items():
        attachment = model.AddAttachment(f"/Metadata/{name}.config", f"urn:pin-art:3mf:{name}")
        attachment.ReadFromBuffer(content)
    writer = model.QueryWriter("3mf")
    writer.SetStrictModeActive(True)
    return bytes(writer.WriteToBuffer())
