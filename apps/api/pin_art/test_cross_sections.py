import math
import json
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError
from shapely import Polygon

from pin_art.schemas import Parameters


def parameters(**updates):
    return Parameters.model_validate({
        "width": 20, "depth": 20, "thickness": 3, "spacing": 5,
        "diameter": 2, "extension": 10, **updates,
    })


def test_optional_shape_aliases_and_canonical_rotation():
    defaults = parameters()
    assert defaults.pin_shape == "round"
    assert defaults.pin_rotation == 0
    polygon = parameters(pinShape="triangle", pinRotation=360)
    assert polygon.pin_shape == "triangle"
    assert polygon.pin_rotation == 0
    assert parameters(pinShape="square", pinRotation=30).model_dump(by_alias=True)["pinRotation"] == 30


@pytest.mark.parametrize("field,value", [
    ("pinShape", "hexagon"), ("pinShape", None), ("pinShape", 3),
    ("pinRotation", -0.01), ("pinRotation", 360.01), ("pinRotation", float("nan")),
    ("pinRotation", float("inf")), ("pinRotation", "30"), ("pinRotation", True),
])
def test_invalid_shape_parameters_are_rejected(field, value):
    with pytest.raises(ValidationError):
        parameters(**{field: value})


ROOT_TWO = math.sqrt(2)
ROOT_THREE = math.sqrt(3)
SQUARE_HALF = 1 / ROOT_TWO
SQUARE_LOW = (ROOT_THREE - 1) / (2 * ROOT_TWO)
SQUARE_HIGH = (ROOT_THREE + 1) / (2 * ROOT_TWO)

PARITY_CASES = [
    ("square", 0, [(-SQUARE_HALF, -SQUARE_HALF), (SQUARE_HALF, -SQUARE_HALF), (SQUARE_HALF, SQUARE_HALF), (-SQUARE_HALF, SQUARE_HALF)], (-SQUARE_HALF, -SQUARE_HALF, SQUARE_HALF, SQUARE_HALF)),
    ("square", 30, [(-SQUARE_LOW, -SQUARE_HIGH), (SQUARE_HIGH, -SQUARE_LOW), (SQUARE_LOW, SQUARE_HIGH), (-SQUARE_HIGH, SQUARE_LOW)], (-SQUARE_HIGH, -SQUARE_HIGH, SQUARE_HIGH, SQUARE_HIGH)),
    ("square", 45, [(0, -1), (1, 0), (0, 1), (-1, 0)], (-1, -1, 1, 1)),
    ("square", 90, [(SQUARE_HALF, -SQUARE_HALF), (SQUARE_HALF, SQUARE_HALF), (-SQUARE_HALF, SQUARE_HALF), (-SQUARE_HALF, -SQUARE_HALF)], (-SQUARE_HALF, -SQUARE_HALF, SQUARE_HALF, SQUARE_HALF)),
    ("triangle", 0, [(0, 1), (-ROOT_THREE / 2, -0.5), (ROOT_THREE / 2, -0.5)], (-ROOT_THREE / 2, -0.5, ROOT_THREE / 2, 1)),
    ("triangle", 30, [(-0.5, ROOT_THREE / 2), (-0.5, -ROOT_THREE / 2), (1, 0)], (-0.5, -ROOT_THREE / 2, 1, ROOT_THREE / 2)),
    ("triangle", 45, [(-1 / ROOT_TWO, 1 / ROOT_TWO), ((1 - ROOT_THREE) / (2 * ROOT_TWO), -(ROOT_THREE + 1) / (2 * ROOT_TWO)), ((ROOT_THREE + 1) / (2 * ROOT_TWO), (ROOT_THREE - 1) / (2 * ROOT_TWO))], (-1 / ROOT_TWO, -(ROOT_THREE + 1) / (2 * ROOT_TWO), (ROOT_THREE + 1) / (2 * ROOT_TWO), 1 / ROOT_TWO)),
    ("triangle", 90, [(-1, 0), (0.5, -ROOT_THREE / 2), (0.5, ROOT_THREE / 2)], (-1, -ROOT_THREE / 2, 0.5, ROOT_THREE / 2)),
]

SHARED_CASES = json.loads((Path(__file__).resolve().parents[3] / "fixtures" / "pin-cross-sections.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("fixture", SHARED_CASES, ids=lambda fixture: f"{fixture['shape']}-{fixture['rotation']}")
def test_shared_frontend_backend_vertices_and_bounds(fixture):
    from pin_art.cross_sections import local_bounds, polygon_vertices

    np.testing.assert_allclose(polygon_vertices(fixture["shape"], fixture["size"], fixture["rotation"]), fixture["vertices"], rtol=0, atol=1e-12)
    expected_bounds = [fixture["bounds"][key] for key in ["minX", "minY", "maxX", "maxY"]]
    np.testing.assert_allclose(local_bounds(fixture["shape"], fixture["size"], fixture["rotation"]), expected_bounds, rtol=0, atol=1e-12)


@pytest.mark.parametrize("shape,angle,expected_vertices,expected_bounds", PARITY_CASES)
def test_analytic_parity_vertices_bounds_centroid_winding_and_size(shape, angle, expected_vertices, expected_bounds):
    from pin_art.cross_sections import local_bounds, polygon_vertices

    vertices = polygon_vertices(shape, 2, angle)
    np.testing.assert_allclose(vertices, expected_vertices, atol=1e-12)
    np.testing.assert_allclose(local_bounds(shape, 2, angle), expected_bounds, atol=1e-12)
    np.testing.assert_allclose(np.mean(vertices, axis=0), [0, 0], atol=1e-12)
    np.testing.assert_allclose(np.linalg.norm(vertices, axis=1), 1)
    polygon = Polygon(vertices)
    assert polygon.exterior.is_ccw
    assert polygon.area == pytest.approx(2 if shape == "square" else 3 * ROOT_THREE / 4)
    side = ROOT_TWO if shape == "square" else ROOT_THREE
    np.testing.assert_allclose(np.linalg.norm(vertices - np.roll(vertices, 1, axis=0), axis=1), side)


@pytest.mark.parametrize("shape,symmetry", [("square", 90), ("triangle", 120)])
def test_polygon_symmetry_and_full_turn(shape, symmetry):
    from pin_art.cross_sections import polygon_vertices

    polygon = Polygon(polygon_vertices(shape, 2, 0))
    assert polygon.symmetric_difference(Polygon(polygon_vertices(shape, 2, symmetry))).area < 1e-12
    np.testing.assert_allclose(polygon_vertices(shape, 2, 360), polygon_vertices(shape, 2, 0), atol=1e-12)


@pytest.mark.parametrize("angle", [0, 30, 45, 90, 360])
def test_round_bounds_ignore_rotation(angle):
    from pin_art.cross_sections import local_bounds

    assert local_bounds("round", 2, angle) == (-1, -1, 1, 1)


@pytest.mark.parametrize("shape", ["square", "triangle"])
@pytest.mark.parametrize("angle", [0, 30, 45, 90])
@pytest.mark.parametrize("offset", [0, 0.2, 0.4, 0.6])
def test_sliding_profiles_are_uniform_rounded_outward_offsets(shape, angle, offset):
    from pin_art.cross_sections import polygon_vertices
    from pin_art.sliding import profile_points
    from shapely.affinity import rotate

    pin = Polygon(polygon_vertices(shape, 2, angle))
    profile = rotate(Polygon(profile_points(shape, 2, offset)), angle, origin=(0, 0))
    if offset == 0:
        assert profile.symmetric_difference(pin).area < 1e-12
        return
    assert profile.covers(pin)
    for first, second in zip(pin.exterior.coords[:-1], pin.exterior.coords[1:], strict=True):
        from shapely import Point

        midpoint = Point((first[0] + second[0]) / 2, (first[1] + second[1]) / 2)
        assert midpoint.distance(profile.boundary) == pytest.approx(offset)
    expected_area = pin.area + pin.length * offset + math.pi * offset ** 2
    assert profile.area == pytest.approx(expected_area, abs=0.0019)
    assert len(profile.exterior.coords) > len(pin.exterior.coords)
