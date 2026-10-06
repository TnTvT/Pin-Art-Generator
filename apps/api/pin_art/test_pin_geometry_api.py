import io
import json
import zipfile
from xml.etree import ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from pin_art.app import MAX_BODY_BYTES, app
from pin_art.test_geometry import read_stl
from pin_art.test_pin_geometries import mixed_payload, pair_payload


@pytest.mark.parametrize("explicit", [False, True])
@pytest.mark.parametrize("mode", ["fixed", "detachable"])
@pytest.mark.parametrize("format", ["stl", "3mf"])
def test_api_worker_exports_complete_mixed_geometry_snapshot(explicit, mode, format):
    payload = mixed_payload(mode=mode, explicit=explicit, format=format)
    with TestClient(app) as client:
        response = client.post("/api/exports", json=payload)
    assert response.status_code == 200, response.text[:200]
    assert response.headers["X-Plate-Count"] == ("1" if mode == "fixed" else "2")
    if format == "stl" and mode == "fixed":
        solid = read_stl(response.content)
        assert len(solid.decompose()) == 1
        assert solid.bounding_box()[2] == 0
        return
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        if format == "stl":
            manifest = json.loads(archive.read("manifest.json"))
            geometries = manifest["pinGeometries"]
            names = [part["name"] for part in manifest["plates"][1]["parts"]]
            assert [geometry["shape"] for geometry in geometries] == ["round", "square", "triangle", "triangle"]
            assert [geometry["rotation"] for geometry in geometries] == [0, 30, 90, 0]
        else:
            config = ET.fromstring(archive.read("Metadata/model_settings.config"))
            names = [entry.attrib["value"] for entry in config.findall("object/part/metadata[@key='name']")][1:]
        for name, shape, angle in zip(names, ["round", "square", "triangle", "triangle"], [0, 30, 90, 0], strict=True):
            assert f"{shape} {angle}deg" in name


@pytest.mark.parametrize("value", [None, [], [{"shape": "round"}] * 4, [{"shape": "square", "rotation": 361}] * 4, [{"shape": "hexagon", "rotation": 0}] * 4])
def test_api_malformed_geometry_has_existing_structured_errors(value):
    payload = mixed_payload()
    payload["pinGeometries"] = value
    with TestClient(app) as client:
        response = client.post("/api/exports", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_DESIGN"
    assert "pinGeometries" in response.json()["error"]["message"]


def test_api_does_not_trust_frontend_clearance():
    with TestClient(app) as client:
        response = client.post("/api/exports", json=pair_payload(distance=0.1))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_DESIGN"
    assert "circle" in response.json()["error"]["message"]
    assert "square" in response.json()["error"]["message"]


def test_extra_geometry_array_counts_toward_request_size_limit():
    payload = mixed_payload(explicit=False, format="stl")
    payload["parameters"].update(rows=100, columns=100, width=500, depth=500)
    payload.update(heights=[1] * 10000, pinMaterials=[0] * 10000,
                   pinGeometries=[payload["pinGeometries"][index % 4] for index in range(10000)])
    body = json.dumps(payload).replace('"shape"', ' ' * 220 + '"shape"')
    assert len(body) > MAX_BODY_BYTES
    with TestClient(app) as client:
        response = client.post("/api/exports", content=body, headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"


def test_openapi_geometry_pair_requires_both_fields():
    with TestClient(app) as client:
        schemas = client.get("/openapi.json").json()["components"]["schemas"]
    assert "pinGeometries" in schemas["ExportRequest"]["properties"]
    assert set(schemas["PinGeometry"]["required"]) == {"shape", "rotation"}
