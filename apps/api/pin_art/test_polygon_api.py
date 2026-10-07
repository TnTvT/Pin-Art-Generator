import io
import zipfile

import lib3mf
import pytest
from fastapi.testclient import TestClient

from pin_art.app import app
from pin_art.test_geometry import read_stl
from pin_art.test_polygon_layout import polygon_payload
from pin_art.test_writer import read_model


@pytest.mark.parametrize("shape", ["square", "triangle"])
@pytest.mark.parametrize("mode", ["fixed"])
@pytest.mark.parametrize("format", ["stl", "3mf"])
@pytest.mark.parametrize("explicit", [False, True])
def test_api_worker_accepts_shape_aliases_in_explicit_and_legacy_exports(shape, mode, format, explicit, tmp_path):
    payload = polygon_payload(shape, 30, mode, explicit)
    payload["format"] = format
    with TestClient(app) as client:
        response = client.post("/api/exports", json=payload)
    assert response.status_code == 200, response.text[:200]
    assert response.headers["X-Plate-Count"] == ("1")
    if format == "3mf":
        assert response.headers["Content-Type"] == "model/3mf"
        path = tmp_path / "worker.3mf"
        path.write_bytes(response.content)
        model = lib3mf.get_wrapper().CreateModel()
        reader = model.QueryReader("3mf")
        reader.SetStrictModeActive(True)
        reader.ReadFromFile(str(path))
        assert reader.GetWarningCount() == 0
        namespace, _, objects, config = read_model(response.content)
        pin_meshes = [mesh for mesh in objects.values() if mesh.find(f"{namespace}mesh") is not None and mesh.attrib["name"] != "base"]
        assert len(pin_meshes) == 2
        assert all(len(mesh.findall(f"{namespace}mesh/{namespace}vertices/{namespace}vertex")) == (8 if shape == "square" else 6) for mesh in pin_meshes)
        assert all(shape in entry.attrib["value"] and "30deg" in entry.attrib["value"] for entry in config.findall("object/part/metadata[@key='name']") if entry.attrib["value"] != "base")
    else:
        assert response.headers["Content-Type"] == "model/stl"
        assert len(read_stl(response.content).decompose()) == 1


@pytest.mark.parametrize("field,value", [("pinShape", "hexagon"), ("pinShape", None), ("pinRotation", -1), ("pinRotation", 361), ("pinRotation", "30")])
def test_api_shape_parameter_errors_remain_structured(field, value):
    payload = polygon_payload(explicit=False)
    payload["parameters"][field] = value
    with TestClient(app) as client:
        response = client.post("/api/exports", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_DESIGN"
    assert field in response.json()["error"]["message"]


@pytest.mark.parametrize("mode,failure", [("fixed", "overlap"), ("fixed", "padding"), ("fixed", "bed"), ("print-in-place", "guide-wall"), ("print-in-place", "short-extension")])
def test_api_geometry_errors_are_actionable_and_do_not_start_export(mode, failure):
    payload = polygon_payload(mode=mode)
    if failure == "overlap":
        payload["layout"]["pins"][1].update(x=-2.4)
    elif failure == "padding":
        payload["layout"]["pins"][0].update(x=-9.9)
    elif failure == "guide-wall":
        payload["layout"]["pins"][1].update(x=-0.9)
    elif failure == "short-extension":
        payload["heights"][0] = 0.5
    else:
        payload = polygon_payload(explicit=False)
        payload["parameters"]["width"] = 257
    with TestClient(app) as client:
        response = client.post("/api/exports", json=payload)
        assert not app.state.export_lock.locked()
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_DESIGN"
    assert response.json()["error"]["message"]


def test_openapi_shape_fields_have_legacy_defaults_and_angle_limits():
    with TestClient(app) as client:
        parameters = client.get("/openapi.json").json()["components"]["schemas"]["Parameters"]
    properties = parameters["properties"]
    assert properties["pinShape"]["enum"] == ["round", "square", "triangle"]
    assert properties["pinShape"]["default"] == "round"
    assert properties["pinRotation"]["default"] == 0
    assert properties["pinRotation"]["minimum"] == 0
    assert properties["pinRotation"]["maximum"] == 360
    assert "pinShape" not in parameters["required"]
    assert "pinRotation" not in parameters["required"]
