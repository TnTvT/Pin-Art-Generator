from typing import TYPE_CHECKING
from math import pi

import numpy as np
from shapely import MultiPolygon, Point, Polygon, STRtree, box, is_valid_reason, prepare
from shapely.affinity import translate

from pin_art.cross_sections import polygon_vertices

if TYPE_CHECKING:
    from pin_art.schemas import ExportRequest


def _base_shape(request: "ExportRequest") -> MultiPolygon:
    layout = request.layout
    vertex_count = sum(len(region.outer) + sum(map(len, region.holes)) for region in layout.regions)
    if vertex_count > 20000:
        raise ValueError("contours must contain at most 20,000 total vertices")
    polygons = [Polygon(region.outer, region.holes) for region in layout.regions]
    shape = MultiPolygon(polygons)
    if not shape.is_valid or shape.is_empty or not np.isfinite(shape.area) or shape.area <= 0:
        raise ValueError(f"base contours must be valid non-overlapping polygons: {is_valid_reason(shape)}")
    parameters = request.parameters
    expected = [-parameters.width / 2, -parameters.depth / 2, parameters.width / 2, parameters.depth / 2]
    if not np.allclose(shape.bounds, expected, rtol=0, atol=1e-6):
        raise ValueError("base contours must be centered and match the configured width and depth")
    if len({pin.id for pin in layout.pins}) != len(layout.pins):
        raise ValueError("pin IDs must be unique")
    return shape


def validate_shape_layout(request: "ExportRequest") -> None:
    shape = _base_shape(request)
    validate_polygon_layout(request, shape)


def validate_polygon_layout(request: "ExportRequest", base: MultiPolygon | Polygon | None = None) -> None:
    parameters = request.parameters
    if base is None:
        base = box(-parameters.width / 2, -parameters.depth / 2, parameters.width / 2, parameters.depth / 2)
    prepare(base)
    boundary = base.boundary
    radius = parameters.diameter / 2
    profiles = {}
    geometries = request.resolved_pin_geometries
    for geometry in geometries:
        key = (geometry.shape, geometry.rotation)
        if key in profiles:
            continue
        pin = Point(0, 0) if geometry.shape == "round" else Polygon(polygon_vertices(geometry.shape, parameters.diameter, geometry.rotation))
        area = pi * radius * radius if geometry.shape == "round" else pin.area
        if not np.isfinite(area) or area <= 0:
            raise ValueError("derived footprints must have finite positive area")
        profiles[key] = pin
    padding = request.layout.edge_padding if request.layout else 0
    if request.layout:
        positions = [(position.id, position.x, position.y) for position in request.layout.pins]
    else:
        positions = [
            (f"R{row + 1} C{column + 1}", (column - (parameters.columns - 1) / 2) * parameters.spacing, (row - (parameters.rows - 1) / 2) * parameters.spacing)
            for row in range(parameters.rows) for column in range(parameters.columns)
        ]
    footprints = []
    bounds = []
    radii = []
    for (name, horizontal, vertical), geometry in zip(positions, geometries, strict=True):
        pin = profiles[(geometry.shape, geometry.rotation)]
        footprint = translate(pin, horizontal, vertical)
        pin_radius = radius if geometry.shape == "round" else 0
        edge_distance = footprint.distance(boundary) - pin_radius
        if not base.covers(footprint) or edge_distance < padding - 1e-6:
            raise ValueError(f"pin {name} violates base/hole padding; increase Edge padding or base size")
        footprints.append(footprint)
        radii.append(pin_radius)
        minimum_x, minimum_y, maximum_x, maximum_y = footprint.bounds
        bounds.append(box(minimum_x - pin_radius, minimum_y - pin_radius, maximum_x + pin_radius, maximum_y + pin_radius))
    separation = 0
    tree = STRtree(bounds)
    for index, footprint in enumerate(footprints):
        for neighbour in tree.query(bounds[index], predicate="dwithin", distance=separation + 1e-6):
            if neighbour <= index:
                continue
            other = footprints[neighbour]
            distance = footprint.distance(other) - radii[index] - radii[neighbour]
            names = f"pins {positions[index][0]} and {positions[neighbour][0]}"
            if (distance < -1e-6 if radii[index] or radii[neighbour] else footprint.relate_pattern(other, "T********")):
                raise ValueError(f"fixed pins must not overlap: {names}; increase spacing or change pin rotation")
            elif request.mode == "fixed" and request.format == "stl" and distance <= 1e-6:
                raise ValueError("fixed STL pins must have positive separation to avoid tangent non-manifold contact")
