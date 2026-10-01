import asyncio
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pin_art.app import ExportFileResponse, MAX_BODY_BYTES, app
from pin_art.test_schemas import request_payload


def test_api_rejects_invalid_design_with_structured_error():
    with TestClient(app) as client:
        response = client.post("/api/exports", json=request_payload(heights=[0]))
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_DESIGN"
        assert response.json()["error"]["message"]


def test_openapi_describes_the_design_snapshot():
    with TestClient(app) as client:
        schema = client.get("/openapi.json").json()
        assert "ExportRequest" in schema["components"]["schemas"]
        assert schema["paths"]["/api/exports"]["post"]["requestBody"]["required"]


def test_api_rejects_non_json_and_oversized_bodies():
    with TestClient(app) as client:
        assert client.post("/api/exports", content="oops").status_code == 415
        response = client.post("/api/exports", content="x" * (MAX_BODY_BYTES + 1), headers={"Content-Type": "application/json"})
        assert response.status_code == 413
        assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"
        response = client.post("/api/exports", content="{", headers={"Content-Type": "application/json"})
        assert response.status_code == 400


def test_api_downloads_fixed_and_detachable_models():
    with TestClient(app) as client:
        for mode, file_format, content_type in [("fixed", "3mf", "model/3mf"), ("fixed", "stl", "model/stl"), ("detachable", "stl", "application/zip")]:
            response = client.post("/api/exports", json=request_payload(mode=mode, format=file_format))
            assert response.status_code == 200, response.text[:200]
            assert response.headers["Content-Type"] == content_type
            assert response.headers["X-Plate-Count"] == ("2" if mode == "detachable" else "1")
            assert "attachment" in response.headers["Content-Disposition"]
            assert len(response.content) > 84


def test_busy_requests_do_not_spawn_more_workers():
    with TestClient(app) as client:
        client.portal.call(app.state.export_lock.acquire)
        try:
            response = client.post("/api/exports", json=request_payload())
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "EXPORT_BUSY"
        finally:
            client.portal.call(app.state.export_lock.release)


def test_worker_timeout_cleans_up_and_unlocks(monkeypatch):
    import pin_art.app as api

    monkeypatch.setattr(api, "EXPORT_TIMEOUT", 0.001)
    with TestClient(app) as client:
        response = client.post("/api/exports", json=request_payload())
        assert response.status_code == 504
        assert response.json()["error"]["code"] == "EXPORT_TIMEOUT"
        assert not app.state.export_lock.locked()


def test_worker_failure_is_safe_and_unlocks(monkeypatch):
    import pin_art.app as api

    monkeypatch.setattr(api, "WORKER_MODULE", "pin_art.missing_worker")
    with TestClient(app) as client:
        response = client.post("/api/exports", json=request_payload())
        assert response.status_code == 500
        assert response.json()["error"]["code"] == "EXPORT_FAILED"
        assert "Traceback" not in response.text
        assert not app.state.export_lock.locked()


@pytest.mark.parametrize("message_type", ["http.response.start", "http.response.body"])
@pytest.mark.parametrize("failure_type", [OSError, asyncio.CancelledError])
def test_download_disconnect_removes_temporary_artifacts(tmp_path, message_type, failure_type):
    directory = tempfile.TemporaryDirectory(dir=tmp_path)
    target = Path(directory.name) / "model.stl"
    target.write_bytes(b"test model")
    response = ExportFileResponse(target, directory=directory)

    async def disconnect_receive():
        return {"type": "http.disconnect"}

    async def disconnected_send(message):
        if message["type"] == message_type:
            raise failure_type("disconnected")

    scope = {"type": "http", "method": "GET", "headers": [], "asgi": {"spec_version": "2.4"}}
    with pytest.raises(failure_type):
        asyncio.run(response(scope, disconnect_receive, disconnected_send))
    assert not target.parent.exists()
