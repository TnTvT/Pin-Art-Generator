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
    if request.parameters.pin_shape != "round":
        validate_polygon_layout(request, shape)
        return
    layout = request.layout
    parameters = request.parameters
    points = [Point(pin.x, pin.y) for pin in layout.pins]
    radius = parameters.diameter / 2
    edge_distance = radius + layout.edge_padding
    if request.mode == "detachable":
        edge_distance = max(edge_distance, (parameters.diameter + request.socket.clearance) / 2 + 0.8)
    boundary = shape.boundary
    for pin, point in zip(layout.pins, points, strict=True):
        if not shape.covers(point) or point.distance(boundary) < edge_distance - 1e-6:
            raise ValueError(f"pin {pin.id} violates base/hole padding or socket edge wall; increase Edge padding")
    separation = parameters.diameter
    if request.mode == "detachable":
        separation += request.socket.clearance + 0.8
    tree = STRtree(points)
    for index, point in enumerate(points):
        neighbours = tree.query(point, predicate="dwithin", distance=separation + 1e-6)
        for neighbour in neighbours:
            if neighbour <= index:
                continue
            distance = point.distance(points[neighbour])
            if distance < separation - 1e-6:
                raise ValueError("pins overlap or socket walls are below 0.8 mm; increase spacing")
            if request.mode == "fixed" and request.format == "stl" and distance <= separation + 1e-6:
                raise ValueError("fixed STL pins must have positive separation to avoid tangent non-manifold contact")


def validate_polygon_layout(request: "ExportRequest", base: MultiPolygon | Polygon | None = None) -> None:
    parameters = request.parameters
    if base is None:
        base = box(-parameters.width / 2, -parameters.depth / 2, parameters.width / 2, parameters.depth / 2)
    prepare(base)
    boundary = base.boundary
    pin = Polygon(polygon_vertices(parameters.pin_shape, parameters.diameter, parameters.pin_rotation))
    offset = request.socket.clearance / 2 if request.mode == "detachable" else 0
    socket_area = pin.area + pin.length * offset + pi * offset * offset
    if not np.isfinite(pin.area) or not np.isfinite(socket_area) or pin.area <= 0:
        raise ValueError("derived footprints must have finite positive area")
    padding = request.layout.edge_padding if request.layout else 0
    if request.layout:
        positions = [(position.id, position.x, position.y) for position in request.layout.pins]
    else:
        positions = [
            (f"R{row + 1} C{column + 1}", (column - (parameters.columns - 1) / 2) * parameters.spacing, (row - (parameters.rows - 1) / 2) * parameters.spacing)
            for row in range(parameters.rows) for column in range(parameters.columns)
        ]
    footprints = []
    for name, horizontal, vertical in positions:
        footprint = translate(pin, horizontal, vertical)
        if not base.covers(footprint) or footprint.distance(boundary) < padding - 1e-6:
            raise ValueError(f"pin {name} violates base/hole padding; increase Edge padding or base size")
        if request.mode == "detachable":
            if footprint.distance(boundary) - offset < 0.8 - 1e-6:
                raise ValueError(f"pin {name} socket edge wall must be at least 0.8 mm; increase Edge padding or base size")
        footprints.append(footprint)
    separation = request.socket.clearance + 0.8 if request.mode == "detachable" else 0
    tree = STRtree(footprints)
    for index, footprint in enumerate(footprints):
        for neighbour in tree.query(footprint, predicate="dwithin", distance=separation + 1e-6):
            if neighbour <= index:
                continue
            other = footprints[neighbour]
            distance = footprint.distance(other)
            if request.mode == "detachable":
                if distance < separation - 1e-6:
                    raise ValueError("wall between sockets must be at least 0.8 mm; increase spacing")
            elif footprint.relate_pattern(other, "T********"):
                raise ValueError("fixed pins must not overlap; increase spacing or change pin rotation")
            elif request.format == "stl" and distance <= 1e-6:
                raise ValueError("fixed STL pins must have positive separation to avoid tangent non-manifold contact")
