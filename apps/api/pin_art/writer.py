from __future__ import annotations

import io
import json
import re
import zipfile
from xml.etree import ElementTree as ET

import lib3mf
import numpy as np

from pin_art.geometry import Part, Plate
from pin_art.printer_profiles import PRINTER_PROFILES, project_profile
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
    vertices = source.vert_properties[:, :3].astype(np.float64)
    center = (vertices.min(axis=0) + vertices.max(axis=0)) / 2
    positions = []
    triangles = []
    for coordinates in vertices - center:
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
    recenter = np.eye(4)
    recenter[:3, 3] = center
    return mesh, recenter


def precise_package(data: bytes, components: dict, builds: dict) -> bytes:
    object_pattern = re.compile(rb'(<(?:\w+:)?object\b[^>]*\bid="(\d+)"[^>]*>)(.*?)(</(?:\w+:)?object>)', re.DOTALL)
    component_pattern = re.compile(rb'<(?:\w+:)?component\b[^>]*>')
    item_pattern = re.compile(rb'<(?:\w+:)?item\b[^>]*\bobjectid="(\d+)"[^>]*>')
    transform_pattern = re.compile(rb'\btransform="[^"]*"')

    def with_transform(element, matrix):
        attribute = b'transform="' + " ".join(format(float(value), ".17g") for value in matrix[:3, :].T.flatten()).encode() + b'"'
        if transform_pattern.search(element):
            return transform_pattern.sub(lambda _: attribute, element, count=1)
        return element[:-2] + b' ' + attribute + b'/>' if element.endswith(b'/>') else element[:-1] + b' ' + attribute + b'>'

    def transform_object(match):
        matrices = components.get(match[2].decode())
        if matrices is None:
            return match[0]
        iterator = iter(matrices)
        content, count = component_pattern.subn(lambda element: with_transform(element[0], next(iterator)), match[3])
        if count != len(matrices):
            raise ValueError("Assembly component transforms must match generated resources")
        return match[1] + content + match[4]

    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
        for entry in source.infolist():
            content = source.read(entry)
            if entry.filename == "3D/3dmodel.model":
                content = object_pattern.sub(transform_object, content)
                content, count = item_pattern.subn(lambda item: with_transform(item[0], builds[item[1].decode()]), content)
                if count != len(builds):
                    raise ValueError("Build transforms must match generated resources")
            target.writestr(entry, content)
    return output.getvalue()


def export_3mf(request: ExportRequest, plate: Plate) -> bytes:
    wrapper = lib3mf.get_wrapper()
    model = wrapper.CreateModel()
    model.SetUnit(lib3mf.ModelUnit.MilliMeter)
    printer = PRINTER_PROFILES[request.printer]
    group = model.GetMetaDataGroup()
    group.AddMetaData("", "Application", printer.application, "xs:string", False)
    group.AddMetaData("", "Title", "Pin Art Studio", "xs:string", False)
    profiles = request.filament_profiles or ["generic-pla"] * len(request.materials)
    materials = [(color.upper(), profile) for color, profile in zip(request.materials, profiles, strict=True)]
    palette = list(dict.fromkeys(materials[part.material] for part in plate.parts))
    palette_colors = [material[0] for material in palette]
    color_group = model.AddColorGroup()
    color_indices = {}
    for color in dict.fromkeys(palette_colors):
        channels = [int(color[offset:offset + 2], 16) for offset in (1, 3, 5)]
        color_indices[color] = color_group.AddColor(wrapper.RGBAToColor(*channels, 255))
    settings = ET.Element("config")
    mesh_cache = {}
    component_transforms = {}
    build_transforms = {}

    def resource(part: Part):
        material = materials[part.material]
        color = material[0]
        key = (part.cache_key, material)
        if key not in mesh_cache:
            mesh_cache[key] = add_mesh(model, wrapper, part, color_group, color_indices[color])
        mesh, recenter = mesh_cache[key]
        return mesh, part.transform @ recenter, palette.index(material) + 1

    def assembly(parts: list[Part], name: str, build_matrix: np.ndarray):
        root = model.AddComponentsObject()
        root.SetName(name)
        matrices = component_transforms[str(root.GetResourceID())] = []
        object_config = ET.SubElement(settings, "object", {"id": str(root.GetResourceID())})
        metadata(object_config, "name", name)
        for part in parts:
            mesh, component_matrix, filament = resource(part)
            root.AddComponent(mesh, native_transform(wrapper, component_matrix))
            matrices.append(component_matrix)
            part_config = ET.SubElement(object_config, "part", {"id": str(mesh.GetResourceID()), "subtype": "normal_part"})
            metadata(part_config, "name", part.name)
            metadata(part_config, "extruder", filament)
            metadata(part_config, "matrix", " ".join(format(float(value), ".17g") for value in component_matrix.flatten()))
        model.AddBuildItem(root, native_transform(wrapper, build_matrix))
        build_transforms[str(root.GetResourceID())] = build_matrix.copy()
        return root.GetResourceID()

    plate_config = ET.SubElement(settings, "plate")
    metadata(plate_config, "plater_id", 1)
    metadata(plate_config, "plater_name", "Pin Art · Plate 1")
    metadata(plate_config, "locked", "false")
    build_matrix = np.eye(4)
    build_matrix[:2, 3] = printer.center
    name = "Fixed pin sculpture" if request.mode == "fixed" else "Print-in-place pin art"
    object_id = assembly(plate.parts, name, build_matrix)
    instance = ET.SubElement(plate_config, "model_instance")
    metadata(instance, "object_id", object_id)
    metadata(instance, "instance_id", 0)
    metadata(instance, "identify_id", object_id)

    project_settings = {
        **project_profile(request.printer, [material[1] for material in palette]),
        "filament_colour": palette_colors,
        "filament_multi_colour": palette_colors,
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
    writer.SetDecimalPrecision(9)
    return precise_package(bytes(writer.WriteToBuffer()), component_transforms, build_transforms)
