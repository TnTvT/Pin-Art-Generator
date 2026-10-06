from math import cos, radians, sin, sqrt
from typing import Literal

import numpy as np
from shapely import Point, Polygon


PinShape = Literal["round", "square", "triangle"]
CIRCULAR_SEGMENTS = 64


def polygon_vertices(shape: PinShape, diameter: float, rotation: float = 0) -> np.ndarray:
    radius = diameter / 2
    if shape == "square":
        half_side = radius / sqrt(2)
        vertices = np.array([
            [-half_side, -half_side], [half_side, -half_side],
            [half_side, half_side], [-half_side, half_side],
        ])
    elif shape == "triangle":
        vertices = np.array([[0, radius], [-sqrt(3) * radius / 2, -radius / 2], [sqrt(3) * radius / 2, -radius / 2]])
    else:
        raise ValueError("polygon vertices require square or triangle")
    angle = radians(rotation % 360)
    matrix = np.array([[cos(angle), -sin(angle)], [sin(angle), cos(angle)]])
    return vertices @ matrix.T


def local_bounds(shape: PinShape, diameter: float, rotation: float = 0) -> tuple[float, float, float, float]:
    if shape == "round":
        radius = diameter / 2
        return (-radius, -radius, radius, radius)
    vertices = polygon_vertices(shape, diameter, rotation)
    return (*vertices.min(axis=0), *vertices.max(axis=0))


def socket_footprint(shape: PinShape, diameter: float, rotation: float, clearance: float) -> Polygon:
    if shape == "round":
        return Point(0, 0).buffer((diameter + clearance) / 2, quad_segs=CIRCULAR_SEGMENTS // 4)
    polygon = Polygon(polygon_vertices(shape, diameter, rotation))
    if clearance == 0:
        return polygon
    return polygon.buffer(clearance / 2, quad_segs=CIRCULAR_SEGMENTS // 4, join_style="round")
