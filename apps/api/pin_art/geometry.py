from dataclasses import dataclass
from functools import lru_cache
import hashlib
from math import cos, radians, sin
import struct

import manifold3d
import numpy as np

from .layout import plan_layout
from .cross_sections import CIRCULAR_SEGMENTS, PinShape, polygon_vertices
from .schemas import ExportRequest
from .sliding import guide_base, sliding_pin


PIN_CACHE_KEY = "pin-cylinder-64"
_MESH_CHUNK_SIZE = 65536


@dataclass
class Part:
    name: str
    solid: manifold3d.Manifold
    material: int
    transform: np.ndarray
    cache_key: str
    pin_index: int | None = None


@dataclass
class Plate:
    index: int
    parts: list[Part]
    separate: bool = False


@lru_cache(maxsize=1)
def _unit_cylinder() -> manifold3d.Manifold:
    return manifold3d.Manifold.cylinder(1, 0.5, circular_segments=CIRCULAR_SEGMENTS)


@lru_cache(maxsize=3)
def _unit_pin(shape: PinShape) -> manifold3d.Manifold:
    if shape == "round":
        return _unit_cylinder()
    return manifold3d.CrossSection([polygon_vertices(shape, 1)]).extrude(1)


def _transform(x: float, y: float, bottom: float, diameter: float = 1, length: float = 1, rotation: float = 0) -> np.ndarray:
    transform = np.diag([diameter, diameter, length, 1.0])
    if rotation:
        angle = radians(rotation)
        transform[:2, :2] = diameter * np.array([[cos(angle), -sin(angle)], [sin(angle), cos(angle)]])
    transform[:3, 3] = (x, y, bottom)
    return transform


def _check_solid(solid: manifold3d.Manifold) -> None:
    if solid.status() != manifold3d.Error.NoError or solid.is_empty():
        raise ValueError("geometry must be a nonempty watertight manifold")
    volume = solid.volume()
    if not np.isfinite(volume) or volume <= 0:
        raise ValueError("geometry must have finite positive volume")


def build_plates(request: ExportRequest) -> list[Plate]:
    layouts = plan_layout(request)
    parameters = request.parameters
    geometries = request.resolved_pin_geometries
    if request.layout:
        contours = [ring for region in request.layout.regions for ring in [region.outer, *region.holes]]
        base = manifold3d.CrossSection(contours, manifold3d.FillRule.EvenOdd).extrude(parameters.thickness)
    else:
        base = manifold3d.Manifold.cube((parameters.width, parameters.depth, parameters.thickness)).translate(
            (-parameters.width / 2, -parameters.depth / 2, 0)
        )
    base_key = f"base:{parameters.width!r}:{parameters.depth!r}:{parameters.thickness!r}"
    if request.layout:
        base_key += hashlib.sha256(request.layout.model_dump_json().encode()).hexdigest()
    if request.mode == "print-in-place":
        base = guide_base(request, layouts[0].parts[1:])
        base_key += f":sliding:{request.sliding.model_dump_json()}:" + hashlib.sha256(repr((parameters.diameter, geometries, layouts[0].parts)).encode()).hexdigest()
    _check_solid(base)
    pins = {geometry.shape: _unit_pin(geometry.shape) for geometry in geometries}
    for pin in pins.values():
        _check_solid(pin)
    plates = []
    for layout in layouts:
        parts = []
        for placement in layout.parts:
            if placement.pin_index is None:
                parts.append(Part("base", base, request.base_material, _transform(placement.x, placement.y, 0), base_key))
            else:
                pin_index = placement.pin_index
                geometry = geometries[pin_index]
                pin = pins[geometry.shape]
                pin_key = PIN_CACHE_KEY if geometry.shape == "round" else f"pin-{geometry.shape}"
                length = request.heights[pin_index]
                bottom = parameters.thickness
                diameter = parameters.diameter
                if request.mode == "print-in-place":
                    pin = sliding_pin(geometry.shape, diameter, parameters.thickness, length, request.sliding.clearance, request.sliding.head_flare)
                    pin_key = f"sliding:{geometry.shape}:{diameter!r}:{parameters.thickness!r}:{length!r}:{request.sliding.clearance!r}:{request.sliding.head_flare!r}"
                    diameter, length, bottom = 1, 1, 0
                parts.append(Part(
                    placement.name, pin, request.pin_materials[pin_index],
                    _transform(placement.x, placement.y, bottom, diameter, length, geometry.rotation), pin_key, pin_index,
                ))
        plates.append(Plate(layout.index, parts, request.mode == "print-in-place"))
    return plates


def _check_mesh(vertices: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    if not np.isfinite(vertices).all() or len(triangles) == 0:
        raise ValueError("STL vertices must be finite and the mesh nonempty")
    if len(triangles) % 2:
        raise ValueError("STL mesh must be strictly watertight with consistent winding")
    unique_vertices, vertex_indices = np.unique(vertices, axis=0, return_inverse=True)
    welded_triangles = vertex_indices[triangles]
    normals = np.empty((len(triangles), 3), dtype=np.float32)
    for start in range(0, len(triangles), _MESH_CHUNK_SIZE):
        stop = min(start + _MESH_CHUNK_SIZE, len(triangles))
        coordinates = unique_vertices[welded_triangles[start:stop]].astype(np.float64)
        chunk_normals = np.cross(coordinates[:, 1] - coordinates[:, 0], coordinates[:, 2] - coordinates[:, 0])
        normal_lengths = np.linalg.norm(chunk_normals, axis=1)
        if not np.isfinite(normal_lengths).all() or np.any(normal_lengths == 0):
            raise ValueError("STL precision produces degenerate triangles")
        normals[start:stop] = chunk_normals / normal_lengths[:, None]
    edge_keys = np.empty(len(triangles) * 3, dtype=np.uint64)
    for edge_index, (first_column, second_column) in enumerate([(0, 1), (1, 2), (2, 0)]):
        offset = edge_index * len(triangles)
        for start in range(0, len(triangles), _MESH_CHUNK_SIZE):
            stop = min(start + _MESH_CHUNK_SIZE, len(triangles))
            first_vertices = welded_triangles[start:stop, first_column]
            second_vertices = welded_triangles[start:stop, second_column]
            chunk_keys = edge_keys[offset + start:offset + stop]
            np.minimum(first_vertices, second_vertices, out=chunk_keys, casting="unsafe")
            chunk_keys *= 2 * len(unique_vertices)
            chunk_keys += 2 * np.maximum(first_vertices, second_vertices).astype(np.uint64)
            chunk_keys += first_vertices < second_vertices
    edge_keys.sort()
    for start in range(0, len(edge_keys), 2 * _MESH_CHUNK_SIZE):
        stop = min(start + 2 * _MESH_CHUNK_SIZE, len(edge_keys))
        first_keys = edge_keys[start:stop:2]
        second_keys = edge_keys[start + 1:stop:2]
        if np.any(first_keys & 1) or np.any(second_keys != first_keys + 1):
            raise ValueError("STL mesh must be strictly watertight with consistent winding")
    return normals


def plate_stl(plate: Plate) -> bytes:
    if not plate.parts:
        raise ValueError("cannot export an empty plate")
    transformed_solids = []
    for part in plate.parts:
        transform = np.asarray(part.transform, dtype=np.float64)
        if transform.shape != (4, 4) or not np.isfinite(transform).all() or not np.array_equal(transform[3], [0, 0, 0, 1]):
            raise ValueError("part transform must be a finite 4x4 affine matrix")
        transformed = part.solid.transform(transform[:3])
        _check_solid(transformed)
        transformed_solids.append(transformed)
    union = manifold3d.Manifold.compose(transformed_solids) if plate.separate else manifold3d.Manifold.batch_boolean(transformed_solids, manifold3d.OpType.Add)
    _check_solid(union)
    mesh = union.to_mesh64()
    with np.errstate(over="ignore", invalid="ignore"):
        vertices = np.asarray(mesh.vert_properties[:, :3], dtype=np.float32)
    triangles = np.asarray(mesh.tri_verts, dtype=np.int64)
    del mesh, union, transformed_solids
    normals = _check_mesh(vertices, triangles)
    header = b"Pin Art watertight union".ljust(80, b"\0")
    output = bytearray(84 + 50 * len(triangles))
    output[:80] = header
    struct.pack_into("<I", output, 80, len(triangles))
    records = np.ndarray(len(triangles), buffer=output, offset=84, dtype=np.dtype([
        ("normal", "<f4", (3,)), ("vertices", "<f4", (3, 3)), ("attribute", "<u2"),
    ]))
    records["normal"] = normals
    for start in range(0, len(triangles), _MESH_CHUNK_SIZE):
        stop = min(start + _MESH_CHUNK_SIZE, len(triangles))
        records["vertices"][start:stop] = vertices[triangles[start:stop]]
    records["attribute"] = 0
    return bytes(output)
