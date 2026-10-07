import math

import pytest
from pydantic import ValidationError

from pin_art.schemas import ExportRequest
from pin_art.test_polygon_layout import polygon_payload


def mixed_payload(mode="fixed", explicit=True, format="3mf"):
    payload = polygon_payload(mode=mode, explicit=explicit)
    payload.update(format=format, pinGeometries=[
        {"shape": "round", "rotation": 37},
        {"shape": "square", "rotation": 30},
        {"shape": "triangle", "rotation": 90},
        {"shape": "triangle", "rotation": 360},
    ])
    return payload


@pytest.mark.parametrize("explicit", [False, True])
def test_ordered_resolution_and_legacy_fallback(explicit):
    request = ExportRequest.model_validate(mixed_payload(explicit=explicit))
    assert [(geometry.shape, geometry.rotation) for geometry in request.resolved_pin_geometries] == [
        ("round", 0), ("square", 30), ("triangle", 90), ("triangle", 0),
    ]
    dumped = request.model_dump(by_alias=True)
    assert dumped["pinGeometries"][0] == {"shape": "round", "rotation": 0}
    payload = polygon_payload("triangle", 30, explicit=explicit)
    legacy = ExportRequest.model_validate(payload)
    assert "pinGeometries" not in legacy.model_dump(by_alias=True)
    assert all(geometry.shape == "triangle" and geometry.rotation == 30 for geometry in legacy.resolved_pin_geometries)


@pytest.mark.parametrize("value", [
    None, [], [{"shape": "round", "rotation": 0}],
    [{"shape": "hexagon", "rotation": 0}] * 4,
    [{"shape": "round"}] * 4, [{"rotation": 0}] * 4,
    [{"shape": "round", "rotation": 0, "size": 2}] * 4,
    [{"shape": "square", "rotation": angle} for angle in [-1, 361, 0, 0]],
    *[[{"shape": "round", "rotation": value}] * 4 for value in [float("nan"), float("inf"), "30", True]],
    [None] * 4, ["round"] * 4,
])
def test_present_array_and_entries_are_strict(value):
    payload = mixed_payload()
    payload["pinGeometries"] = value
    with pytest.raises(ValidationError, match="pinGeometries"):
        ExportRequest.model_validate(payload)


def pair_payload(mode="fixed", format="3mf", distance=2):
    payload = mixed_payload(mode=mode, format=format)
    payload["layout"]["pins"] = [{"id": "circle", "x": 0, "y": 0}, {"id": "square", "x": distance, "y": 0}]
    payload.update(heights=[5, 10], pinMaterials=[0, 1], pinGeometries=[
        {"shape": "round", "rotation": 0}, {"shape": "square", "rotation": 0},
    ])
    return payload


@pytest.mark.parametrize("format", ["stl", "3mf"])
def test_mixed_contact_is_exact_and_independent_of_global_defaults(format):
    tangent = 1 + 1 / math.sqrt(2)
    payload = pair_payload(format=format, distance=tangent)
    if format == "stl":
        with pytest.raises(ValidationError, match="tangent"):
            ExportRequest.model_validate(payload)
    else:
        ExportRequest.model_validate(payload)
    payload["layout"]["pins"][1]["x"] -= 0.0001
    with pytest.raises(ValidationError, match="overlap.*circle.*square"):
        ExportRequest.model_validate(payload)
    payload["layout"]["pins"][1]["x"] = tangent + 0.001
    payload["parameters"].update(pinShape="round", pinRotation=45)
    ExportRequest.model_validate(payload)


@pytest.mark.parametrize("shape,rotation", [("round", 45), ("square", 30), ("triangle", 90)])
@pytest.mark.parametrize("mode", ["fixed"])
@pytest.mark.parametrize("boundary", ["outer", "hole"])
def test_resolved_rotated_boundary_padding(shape, rotation, mode, boundary):
    from pin_art.cross_sections import local_bounds

    payload = mixed_payload(mode=mode)
    payload.update(heights=[5], pinMaterials=[0], pinGeometries=[{"shape": shape, "rotation": rotation}])
    payload["layout"]["pins"] = [{"id": "edge", "x": 0, "y": 0}]
    payload["layout"]["edgePadding"] = 0.3
    extent = local_bounds(shape, 2, rotation)[2]
    clearance = 0.3
    edge = 10
    if boundary == "hole":
        payload["layout"]["regions"][0]["holes"] = [[[2, -2], [3, -2], [3, 2], [2, 2]]]
        edge = 2
    payload["layout"]["pins"][0]["x"] = edge - extent - clearance
    ExportRequest.model_validate(payload)
    payload["layout"]["pins"][0]["x"] += 0.0001
    with pytest.raises(ValidationError, match="padding|wall"):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("failure", ["enclosed-hole", "concave-notch"])
def test_resolved_polygon_requires_complete_footprint_not_only_vertices(failure):
    payload = mixed_payload()
    payload.update(heights=[5], pinMaterials=[0], pinGeometries=[{"shape": "square", "rotation": 30}])
    payload["layout"]["pins"] = [{"id": "crossing", "x": 0, "y": 0}]
    region = payload["layout"]["regions"][0]
    if failure == "enclosed-hole":
        region["holes"] = [[[0.2, 0.2], [0.3, 0.2], [0.3, 0.3], [0.2, 0.3]]]
    else:
        region["outer"] = [[-10, -10], [10, -10], [10, 10], [0.3, 10], [0.3, 0.2], [0.2, 0.2], [0.2, 10], [-10, 10]]
    with pytest.raises(ValidationError, match="crossing.*padding"):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("shapes", [("round", "triangle"), ("square", "triangle"), ("triangle", "triangle"), ("round", "round")])
def test_all_mixed_pair_types_and_contained_origins_are_checked(shapes):
    payload = pair_payload(distance=0.1)
    payload["pinGeometries"] = [{"shape": shape, "rotation": 30} for shape in shapes]
    with pytest.raises(ValidationError, match="overlap"):
        ExportRequest.model_validate(payload)
    payload["layout"]["pins"][1]["x"] = 2.1
    ExportRequest.model_validate(payload)


def test_resolved_legacy_grid_fit_does_not_use_unused_global_footprint():
    payload = mixed_payload(explicit=False)
    payload.update(heights=[5], pinMaterials=[0], pinGeometries=[{"shape": "square", "rotation": 0}])
    payload["parameters"].update(rows=1, columns=1, width=1.5, depth=1.5, pinShape="round")
    ExportRequest.model_validate(payload)
    payload["pinGeometries"][0]["shape"] = "round"
    with pytest.raises(ValidationError, match="padding"):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("explicit", [False, True])
def test_five_thousand_mixed_pins_validate_with_spatial_index(explicit):
    payload = mixed_payload(explicit=explicit, format="stl")
    payload.update(heights=[1] * 5000, pinMaterials=[0] * 5000,
                   pinGeometries=[payload["pinGeometries"][index % 4] for index in range(5000)])
    payload["parameters"].update(width=500, depth=500)
    if explicit:
        payload["layout"]["regions"][0]["outer"] = [[-250, -250], [250, -250], [250, 250], [-250, 250]]
        payload["layout"]["pins"] = [{"id": f"pin:{row}:{column}", "x": (column - 49.5) * 5, "y": (row - 24.5) * 5} for row in range(50) for column in range(100)]
    else:
        payload["parameters"].update(rows=50, columns=100)
    assert len(ExportRequest.model_validate(payload).resolved_pin_geometries) == 5000
