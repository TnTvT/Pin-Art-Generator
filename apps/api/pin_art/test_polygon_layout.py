import math

import pytest
from pydantic import ValidationError

from pin_art.schemas import ExportRequest
from pin_art.test_schemas import request_payload


def polygon_payload(shape="square", rotation=0, mode="fixed", explicit=True):
    payload = request_payload(mode=mode)
    payload["parameters"].update(pinShape=shape, pinRotation=rotation)
    if explicit:
        payload["parameters"].pop("rows")
        payload["parameters"].pop("columns")
        payload["layout"] = {
            "regions": [{"outer": [[-10, -10], [10, -10], [10, 10], [-10, 10]], "holes": []}],
            "pins": [{"id": f"pin:{index}", "x": horizontal, "y": vertical} for index, (horizontal, vertical) in enumerate([(-2.5, -2.5), (2.5, -2.5), (-2.5, 2.5), (2.5, 2.5)])],
            "edgePadding": 0,
        }
    return payload


def single_polygon_payload(shape="square", rotation=0, mode="fixed"):
    payload = polygon_payload(shape, rotation, mode)
    payload["layout"]["pins"] = [{"id": "tip", "x": 0, "y": 0}]
    payload.update(heights=[10], pinMaterials=[1])
    return payload


@pytest.mark.parametrize("explicit", [False, True])
def test_square_layout_uses_actual_footprints_not_circumcircles(explicit):
    payload = polygon_payload(explicit=explicit)
    payload["parameters"]["spacing"] = 1.6
    if explicit:
        for pin in payload["layout"]["pins"]:
            pin["x"] *= 1.6 / 5
            pin["y"] *= 1.6 / 5
    assert len(ExportRequest.model_validate(payload).heights) == 4
    payload["parameters"]["pinRotation"] = 45
    with pytest.raises(ValidationError, match="overlap"):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("failure", ["enclosed-hole", "crossing-hole", "concave-notch"])
def test_complete_footprint_rejects_holes_and_boundary_crossings_with_all_vertices_inside(failure):
    payload = single_polygon_payload()
    region = payload["layout"]["regions"][0]
    if failure == "concave-notch":
        region["outer"] = [[-10, -10], [10, -10], [10, 10], [0.4, 10], [0.4, 0.2], [0.2, 0.2], [0.2, 10], [-10, 10]]
    else:
        high = 0.4 if failure == "enclosed-hole" else 1
        region["holes"] = [[[0.2, 0.2], [high, 0.2], [high, 0.4], [0.2, 0.4]]]
    with pytest.raises(ValidationError, match="padding"):
        ExportRequest.model_validate(payload)


def test_diagonal_non_grid_neighbours_are_checked():
    payload = polygon_payload()
    payload["layout"]["pins"] = [{"id": "one", "x": 0, "y": 0}, {"id": "diagonal", "x": 1.4, "y": 1.4}]
    payload.update(heights=[5, 10], pinMaterials=[0, 1])
    with pytest.raises(ValidationError, match="overlap"):
        ExportRequest.model_validate(payload)
    payload["layout"]["pins"][1].update(x=1.5, y=1.5)
    ExportRequest.model_validate(payload)


@pytest.mark.parametrize("rotation", [0, 30, 45, 90])
def test_exact_rotated_edge_padding_is_accepted_and_violation_rejected(rotation):
    half_extent = (abs(math.cos(math.radians(rotation))) + abs(math.sin(math.radians(rotation)))) / math.sqrt(2)
    payload = single_polygon_payload(rotation=rotation)
    payload["layout"]["edgePadding"] = 0.3
    payload["layout"]["pins"][0]["x"] = 10 - half_extent - 0.3
    ExportRequest.model_validate(payload)
    payload["layout"]["pins"][0]["x"] += 0.0001
    with pytest.raises(ValidationError, match="padding"):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("format", ["stl", "3mf"])
def test_fixed_polygon_contact_policy(format):
    payload = polygon_payload(explicit=False)
    payload.update(format=format)
    payload["parameters"]["spacing"] = math.sqrt(2)
    if format == "stl":
        with pytest.raises(ValidationError, match="tangent"):
            ExportRequest.model_validate(payload)
    else:
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("explicit", [False, True])
def test_polygon_sockets_accept_exact_walls_and_reject_less(explicit):
    payload = polygon_payload(mode="detachable", explicit=explicit)
    spacing = math.sqrt(2) + 0.2 + 0.8
    payload["parameters"]["spacing"] = spacing
    if explicit:
        for pin in payload["layout"]["pins"]:
            pin["x"] *= spacing / 5
            pin["y"] *= spacing / 5
    ExportRequest.model_validate(payload)
    if explicit:
        payload["layout"]["pins"][1]["x"] -= 0.0001
    else:
        payload["parameters"]["spacing"] -= 0.0001
    with pytest.raises(ValidationError, match="wall"):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("boundary", ["outer", "hole"])
def test_polygon_socket_edge_walls_use_offset_footprints(boundary):
    payload = single_polygon_payload(mode="detachable")
    pin = payload["layout"]["pins"][0]
    offset = 1 / math.sqrt(2) + 0.1
    if boundary == "outer":
        pin["x"] = 10 - offset - 0.8
    else:
        payload["layout"]["regions"][0]["holes"] = [[[2, -2], [3, -2], [3, 2], [2, 2]]]
        pin["x"] = 2 - offset - 0.8
    ExportRequest.model_validate(payload)
    pin["x"] += 0.0001
    with pytest.raises(ValidationError, match="wall"):
        ExportRequest.model_validate(payload)


def test_single_triangle_legacy_fit_respects_centroid_not_bbox_center():
    payload = polygon_payload(shape="triangle", explicit=False)
    payload.update(heights=[5], pinMaterials=[1])
    payload["parameters"].update(rows=1, columns=1, width=math.sqrt(3), depth=2, spacing=0.1)
    ExportRequest.model_validate(payload)
    payload["parameters"]["depth"] = 1.6
    with pytest.raises(ValidationError, match="fit|padding"):
        ExportRequest.model_validate(payload)


def test_socket_corner_clearance_uses_exact_round_offset_not_tessellation_chords():
    payload = polygon_payload(rotation=30, mode="detachable")
    direction = math.radians(77)
    vertex = (math.cos(math.radians(75)), math.sin(math.radians(75)))
    payload["layout"]["pins"] = [
        {"id": "one", "x": 0, "y": 0},
        {"id": "two", "x": 2 * vertex[0] + math.cos(direction), "y": 2 * vertex[1] + math.sin(direction)},
    ]
    payload.update(heights=[5, 10], pinMaterials=[0, 1])
    ExportRequest.model_validate(payload)
    payload["layout"]["pins"][1]["x"] -= 0.00001 * math.cos(direction)
    payload["layout"]["pins"][1]["y"] -= 0.00001 * math.sin(direction)
    with pytest.raises(ValidationError, match="wall"):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("explicit", [False, True])
@pytest.mark.parametrize("shape", ["square", "triangle"])
def test_ten_thousand_polygon_pins_validate_with_spatial_index(shape, explicit):
    payload = polygon_payload(shape=shape, rotation=30, explicit=explicit)
    payload.update(format="stl", heights=[1] * 10000, pinMaterials=[0] * 10000)
    payload["parameters"].update(width=500, depth=500)
    if explicit:
        payload["layout"]["regions"][0]["outer"] = [[-250, -250], [250, -250], [250, 250], [-250, 250]]
        payload["layout"]["pins"] = [{"id": f"pin:{row}:{column}", "x": (column - 49.5) * 5, "y": (row - 49.5) * 5} for row in range(100) for column in range(100)]
    else:
        payload["parameters"].update(rows=100, columns=100)
    assert len(ExportRequest.model_validate(payload).heights) == 10000
