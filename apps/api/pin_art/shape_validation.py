from typing import TYPE_CHECKING

import numpy as np
from shapely import MultiPolygon, Point, Polygon, STRtree, is_valid_reason

if TYPE_CHECKING:
    from pin_art.schemas import ExportRequest


def validate_shape_layout(request: "ExportRequest") -> None:
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
