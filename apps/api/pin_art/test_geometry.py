import struct

import manifold3d
import numpy as np
import pytest

from pin_art.geometry import Part, Plate, build_plates, plate_stl
from pin_art.schemas import ExportRequest
from pin_art.test_schemas import request_payload
import pin_art.geometry as geometry


def polygon_area(diameter):
    return 64 * (diameter / 2) ** 2 * np.sin(2 * np.pi / 64) / 2


def read_stl(data):
    triangle_count = struct.unpack_from("<I", data, 80)[0]
    assert len(data) == 84 + 50 * triangle_count
    records = np.frombuffer(data, offset=84, dtype=np.dtype([
        ("normal", "<f4", (3,)), ("vertices", "<f4", (3, 3)), ("attribute", "<u2"),
    ]))
    assert np.all(records["attribute"] == 0)
    assert np.isfinite(records["normal"]).all()
    np.testing.assert_allclose(np.linalg.norm(records["normal"], axis=1), 1, atol=1e-6)
    vertices, inverse = np.unique(records["vertices"].reshape(-1, 3), axis=0, return_inverse=True)
    triangles = inverse.reshape(-1, 3).astype(np.uint64)
    solid = manifold3d.Manifold(manifold3d.Mesh64(vertices.astype(np.float64), triangles))
    assert solid.status() == manifold3d.Error.NoError
    assert solid.volume() > 0
    return solid


def placed_solid(part):
    return part.solid.transform(part.transform[:3])


def test_fixed_parts_are_actual_base_and_shared_native_unit_cylinders():
    request = ExportRequest.model_validate(request_payload())
    plate = build_plates(request)[0]
    assert plate.index == 0
    base, *pins = plate.parts
    assert base.name == "base"
    assert base.material == 0
    np.testing.assert_allclose(base.solid.bounding_box(), [-10, -10, 0, 10, 10, 3])
    np.testing.assert_array_equal(base.transform, np.eye(4))
    assert [part.material for part in pins] == request.pin_materials
    assert all(part.solid is pins[0].solid for part in pins)
    assert len({part.cache_key for part in pins}) == 1
    assert pins[0].solid.num_vert() == 128
    assert pins[0].solid.num_tri() == 252
    np.testing.assert_allclose(pins[0].solid.bounding_box(), [-0.5, -0.5, 0, 0.5, 0.5, 1])
    for index, pin in enumerate(pins):
        row, column = divmod(index, request.parameters.columns)
        assert pin.name == f"Pin R{row + 1:02d} C{column + 1:02d} {request.heights[index]:.3f} mm"
        assert pin.transform.shape == (4, 4)
        np.testing.assert_allclose(np.diag(pin.transform), [2, 2, request.heights[index], 1])
        assert pin.transform[2, 3] == 3


def test_fixed_colored_parts_touch_without_intersecting():
    plate = build_plates(ExportRequest.model_validate(request_payload()))[0]
    base = placed_solid(plate.parts[0])
    for pin in plate.parts[1:]:
        solid = placed_solid(pin)
        assert (base ^ solid).is_empty()
        assert solid.bounding_box()[2] == base.bounding_box()[5]


def test_fixed_stl_is_one_true_union_with_expected_volume():
    request = ExportRequest.model_validate(request_payload(format="stl"))
    plate = build_plates(request)[0]
    solid = read_stl(plate_stl(plate))
    assert len(solid.decompose()) == 1
    assert solid.volume() == pytest.approx(20 * 20 * 3 + polygon_area(2) * sum(request.heights), rel=1e-6)
    np.testing.assert_allclose(solid.bounding_box(), [-10, -10, 0, 10, 10, 10])


@pytest.mark.parametrize("clearance", [0, 0.2])
def test_blind_sockets_have_exact_diametral_clearance_depth_and_floor(clearance):
    payload = request_payload(mode="detachable")
    payload["socket"]["clearance"] = clearance
    request = ExportRequest.model_validate(payload)
    plate = build_plates(request)[0]
    base = plate.parts[0].solid
    hole_area = polygon_area(2 + clearance)
    assert base.volume() == pytest.approx(20 * 20 * 3 - 4 * hole_area * 2)
    assert base.slice(0.5).area() == pytest.approx(400)
    assert base.slice(2).area() == pytest.approx(400 - 4 * hole_area)
    probe = manifold3d.Manifold.cylinder(3, 0.1, circular_segments=64).translate((-2.5, -2.5, 0))
    assert (base ^ probe).volume() == pytest.approx(polygon_area(0.2))


def test_detachable_parts_print_upright_at_zero_with_insertion_added():
    request = ExportRequest.model_validate(request_payload(mode="detachable", plate={"width": 30, "depth": 30}))
    plates = build_plates(request)
    assert len(plates) == 2
    assert [part.name for part in plates[0].parts] == ["base"]
    pins = plates[1].parts
    for index, pin in enumerate(pins):
        bounds = placed_solid(pin).bounding_box()
        assert bounds[2] == 0
        assert bounds[5] == request.heights[index] + request.socket.insertion_depth
        assert pin.transform[2, 3] == 0
        assert pin.transform[0, 0] == 2
        row, column = divmod(index, request.parameters.columns)
        assert pin.name == f"Pin R{row + 1:02d} C{column + 1:02d} {request.heights[index] + 2:.3f} mm"
    for plate in plates:
        solid = read_stl(plate_stl(plate))
        assert len(solid.decompose()) == len(plate.parts)
        bounds = solid.bounding_box()
        assert bounds[0] >= 5
        assert bounds[1] >= 5
        assert bounds[3] <= 25
        assert bounds[4] <= 25
        assert bounds[2] == 0


def test_pin_resource_is_reused_across_requests_and_base_keys_are_geometry_specific():
    first = build_plates(ExportRequest.model_validate(request_payload()))[0]
    payload = request_payload()
    payload["parameters"]["diameter"] = 3
    second = build_plates(ExportRequest.model_validate(payload))[0]
    assert first.parts[1].cache_key == second.parts[1].cache_key
    assert first.parts[1].solid is second.parts[1].solid
    assert first.parts[0].cache_key == second.parts[0].cache_key
    detachable = build_plates(ExportRequest.model_validate(request_payload(mode="detachable")))[0]
    assert first.parts[0].cache_key != detachable.parts[0].cache_key


def test_stl_applies_affine_matrix_exactly_once():
    transform = np.diag([2.0, 3.0, 4.0, 1.0])
    transform[:3, 3] = [5, 7, 0]
    plate = Plate(0, [Part("cube", manifold3d.Manifold.cube(), 0, transform, "cube")])
    solid = read_stl(plate_stl(plate))
    np.testing.assert_allclose(solid.bounding_box(), [5, 7, 0, 7, 10, 4])
    assert solid.volume() == pytest.approx(24)


def test_stl_unions_intersecting_parts_instead_of_concatenating_shells():
    transform = np.eye(4)
    shifted = np.eye(4)
    shifted[0, 3] = 0.5
    cube = manifold3d.Manifold.cube()
    plate = Plate(0, [Part("first", cube, 0, transform, "cube"), Part("second", cube, 0, shifted, "cube")])
    solid = read_stl(plate_stl(plate))
    assert len(solid.decompose()) == 1
    assert solid.volume() == pytest.approx(1.5)


def test_stl_rejects_empty_plate_and_empty_part():
    with pytest.raises(ValueError, match="empty"):
        plate_stl(Plate(0, []))
    with pytest.raises(ValueError, match="watertight"):
        plate_stl(Plate(0, [Part("empty", manifold3d.Manifold(), 0, np.eye(4), "empty")]))


@pytest.mark.parametrize("transform", [np.eye(3), np.full((4, 4), np.nan), np.zeros((4, 4))])
def test_stl_rejects_invalid_affine_transforms(transform):
    with pytest.raises(ValueError, match="transform"):
        plate_stl(Plate(0, [Part("cube", manifold3d.Manifold.cube(), 0, transform, "cube")]))


def test_stl_rejects_geometry_collapsed_by_float32_serialization():
    transform = np.eye(4)
    transform[0, 3] = 1e9
    with pytest.raises(ValueError, match="degenerate"):
        plate_stl(Plate(0, [Part("cube", manifold3d.Manifold.cube(), 0, transform, "cube")]))


def test_printed_length_is_not_rounded_to_part_name_precision():
    payload = request_payload(mode="detachable")
    payload["heights"][0] = 4.1234567
    pin = build_plates(ExportRequest.model_validate(payload))[1].parts[0]
    assert pin.name.endswith("6.123 mm")
    assert pin.transform[2, 2] == 6.1234567


def test_strict_stl_guard_rejects_point_tangent_geometry_when_called_directly():
    cube = manifold3d.Manifold.cube()
    first = np.eye(4)
    second = np.eye(4)
    second[:3, 3] = [1, 1, 0]
    with pytest.raises(ValueError, match="watertight"):
        plate_stl(Plate(0, [Part("first", cube, 0, first, "cube"), Part("second", cube, 0, second, "cube")]))


@pytest.mark.parametrize("invalid_mesh", ["missing_face", "reversed_face", "duplicate_shell"])
def test_mesh_validation_rejects_open_inconsistently_wound_and_duplicate_edges(invalid_mesh):
    mesh = manifold3d.Manifold.cube().to_mesh64()
    vertices = np.asarray(mesh.vert_properties[:, :3], dtype=np.float32)
    triangles = np.asarray(mesh.tri_verts, dtype=np.int64).copy()
    if invalid_mesh == "missing_face":
        triangles = triangles[:-1]
    elif invalid_mesh == "reversed_face":
        triangles[0] = triangles[0, ::-1]
    else:
        triangles = np.tile(triangles, (2, 1))
    with pytest.raises(ValueError, match="watertight"):
        geometry._check_mesh(vertices, triangles)


def test_mesh_validation_welds_split_vertices_before_checking_edges():
    mesh = manifold3d.Manifold.cube().to_mesh64()
    vertices = np.asarray(mesh.vert_properties[:, :3], dtype=np.float32)
    triangles = np.asarray(mesh.tri_verts, dtype=np.int64)
    split_vertices = vertices[triangles].reshape(-1, 3)
    split_triangles = np.arange(len(split_vertices)).reshape(-1, 3)
    normals = geometry._check_mesh(split_vertices, split_triangles)
    assert normals.shape == (len(triangles), 3)
    np.testing.assert_allclose(np.linalg.norm(normals, axis=1), 1)


def test_chunked_mesh_validation_and_serialization_preserve_exact_stl_bytes(monkeypatch):
    plate = build_plates(ExportRequest.model_validate(request_payload()))[0]
    expected = plate_stl(plate)
    monkeypatch.setattr(geometry, "_MESH_CHUNK_SIZE", 2)
    assert plate_stl(plate) == expected
