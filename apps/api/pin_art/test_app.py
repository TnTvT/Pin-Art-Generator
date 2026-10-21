import asyncio
import io
import json
import os
import subprocess
import sys
import tempfile
import zipfile
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
        assert client.get("/api/exports/status").json()["busy"] is False
        assert app.state.export_availability.deadline is None


def test_health_and_availability_remain_responsive_during_one_export(monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    import pin_art.app as api
    from pin_art.jobs import WorkerResult

    started = threading.Event()
    finish = threading.Event()

    async def delayed_worker(command, cwd, **kwargs):
        root = Path(command[-1])
        started.set()
        while not finish.is_set():
            await asyncio.sleep(0.01)
        (root / "sample.stl").write_bytes(b"model")
        (root / "result.json").write_text(json.dumps({"filename": "sample.stl", "contentType": "model/stl", "plates": 1}))
        return WorkerResult(0, "")

    monkeypatch.setattr(api, "run_worker", delayed_worker)
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(client.post, "/api/exports", json=request_payload())
        try:
            assert started.wait(5)
            assert client.get("/api/health").status_code == 200
            status = client.get("/api/exports/status")
            assert status.status_code == 200
            assert status.headers["Cache-Control"] == "no-store"
            assert status.json()["busy"] is True
            assert 0 < status.json()["estimatedWaitSeconds"] <= 153
            busy = client.post("/api/exports", json=request_payload())
            assert busy.status_code == 503
            assert busy.json()["error"]["estimateKind"] == "upper-bound"
            assert busy.json()["error"]["estimatedWaitSeconds"] > 0
            assert "not been queued" in busy.json()["error"]["message"]
            assert busy.headers["Cache-Control"] == "no-store"
            assert busy.headers["Retry-After"] == "5"
            assert len(app.state.export_rate_limit.attempts) == 1
        finally:
            finish.set()
        assert pending.result(timeout=5).status_code == 200
        assert client.get("/api/exports/status").json()["busy"] is False
        assert app.state.export_availability.deadline is None


@pytest.mark.parametrize("extra", [{"mode": "detachable"}, {"socket": {"insertionDepth": 2}}, {"plate": {"width": 256}}])
def test_removed_contract_fields_return_structured_422(extra):
    with TestClient(app) as client:
        response = client.post("/api/exports", json=request_payload(**extra))
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_DESIGN"
        assert not app.state.export_lock.locked()


def test_openapi_describes_the_design_snapshot():
    with TestClient(app) as client:
        schema = client.get("/openapi.json").json()
        assert "ExportRequest" in schema["components"]["schemas"]
        assert schema["paths"]["/api/exports"]["post"]["requestBody"]["required"]
        schemas = schema["components"]["schemas"]
        for field in ["heights", "pinMaterials", "pinGeometries"]:
            specification = schemas["ExportRequest"]["properties"][field]
            branches = specification.get("anyOf", [specification])
            assert next(branch for branch in branches if branch["type"] == "array")["maxItems"] == 5000
        assert schemas["ShapeLayout"]["properties"]["pins"]["maxItems"] == 5000


@pytest.mark.parametrize("field", ["heights", "pinMaterials", "pinGeometries", "layout"])
def test_api_rejects_five_thousand_and_one_pins(field):
    payload = request_payload()
    if field == "layout":
        payload[field] = {"regions": [{"outer": [[-10, -10], [10, -10], [10, 10], [-10, 10]], "holes": []}],
                          "pins": [{"id": f"pin:{index}", "x": 0, "y": 0} for index in range(5001)], "edgePadding": 0}
    else:
        value = 1 if field == "heights" else 0 if field == "pinMaterials" else {"shape": "round", "rotation": 0}
        payload[field] = [value] * 5001
    with TestClient(app) as client:
        response = client.post("/api/exports", json=payload)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_DESIGN"
        assert "5000" in response.json()["error"]["message"]


def test_api_rejects_non_json_and_oversized_bodies():
    with TestClient(app) as client:
        assert client.post("/api/exports", content="oops").status_code == 415
        response = client.post("/api/exports", content="x" * (MAX_BODY_BYTES + 1), headers={"Content-Type": "application/json"})
        assert response.status_code == 413
        assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"
        response = client.post("/api/exports", content="{", headers={"Content-Type": "application/json"})
        assert response.status_code == 400


def test_api_downloads_fixed_and_print_in_place_models():
    with TestClient(app) as client:
        for mode, file_format, content_type in [("fixed", "3mf", "model/3mf"), ("fixed", "stl", "model/stl"), ("print-in-place", "stl", "model/stl")]:
            response = client.post("/api/exports", json=request_payload(mode=mode, format=file_format))
            assert response.status_code == 200, response.text[:200]
            assert response.headers["Content-Type"] == content_type
            assert response.headers["X-Plate-Count"] == "1"
            assert "attachment" in response.headers["Content-Disposition"]
            assert len(response.content) > 84


@pytest.mark.parametrize("mode", ["fixed", "print-in-place"])
def test_api_worker_keeps_selected_u1_printer(mode):
    with TestClient(app) as client:
        response = client.post("/api/exports", json=request_payload(printer="snapmaker-u1", mode=mode))
        assert response.status_code == 200, response.text[:200]
        assert response.headers["Content-Type"] == "model/3mf"
        assert response.headers["X-Plate-Count"] == "1"
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            settings = json.loads(archive.read("Metadata/project_settings.config"))
            assert settings["printer_model"] == "Snapmaker U1"
            assert settings["filament_colour"] == ["#112233", "#AABBCC"]


def test_api_rejects_u1_material_budget_and_unknown_printers_before_worker():
    with TestClient(app) as client:
        payload = request_payload(printer="snapmaker-u1", materials=["#000000", "#111111", "#222222", "#333333", "#444444"], pinMaterials=[1, 2, 3, 4])
        for invalid in (payload, request_payload(printer="unknown")):
            response = client.post("/api/exports", json=invalid)
            assert response.status_code == 422
            assert response.json()["error"]["code"] == "INVALID_DESIGN"
            assert not app.state.export_lock.locked()


@pytest.mark.parametrize("mode", ["fixed"])
def test_api_worker_preserves_selected_filament_profiles(mode):
    payload = request_payload(mode=mode, materials=["#FFFFFF", "#FFFFFF"], filamentProfiles=["bambu-pla-basic", "bambu-pla-matte"])
    with TestClient(app) as client:
        response = client.post("/api/exports", json=payload)
        assert response.status_code == 200, response.text[:200]
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            settings = json.loads(archive.read("Metadata/project_settings.config"))
            assert settings["filament_settings_id"] == ["Bambu PLA Basic @BBL X1C", "Bambu PLA Matte @BBL X1C"]
            assert settings["filament_colour"] == ["#FFFFFF", "#FFFFFF"]
            assert settings["filament_extruder_variant"] == ["Direct Drive Standard", "Direct Drive Standard"]
            assert settings["filament_self_index"] == ["1", "2"]
            assert settings["different_settings_to_system"] == ["", "", "", ""]
            assert "default_filament_colour" not in settings


def test_api_rejects_unknown_filament_profiles_with_readable_error():
    with TestClient(app) as client:
        response = client.post("/api/exports", json=request_payload(filamentProfiles=["generic-pla", "injected-preset"]))
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_DESIGN"
        assert "filamentProfiles" in response.json()["error"]["message"]


def test_busy_requests_do_not_spawn_more_workers():
    with TestClient(app) as client:
        client.portal.call(app.state.export_lock.acquire)
        try:
            response = client.post("/api/exports", json=request_payload())
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "EXPORT_BUSY"
        finally:
            client.portal.call(app.state.export_lock.release)


def test_busy_is_rejected_before_expensive_validation(monkeypatch):
    import pin_art.app as api

    def unexpected_validation(*args, **kwargs):
        raise AssertionError("Busy requests must not validate geometry")

    monkeypatch.setattr(api.ExportRequest, "model_validate", unexpected_validation)
    with TestClient(app) as client:
        client.portal.call(app.state.export_lock.acquire)
        try:
            response = client.post("/api/exports", json=request_payload())
            assert response.status_code == 503
            assert int(response.headers["Retry-After"]) > 0
        finally:
            client.portal.call(app.state.export_lock.release)


def test_temporary_directory_failure_returns_safe_error_and_unlocks(monkeypatch):
    import pin_art.app as api

    def unavailable_directory(*args, **kwargs):
        raise OSError("private filesystem details")

    monkeypatch.setattr(api.tempfile, "TemporaryDirectory", unavailable_directory)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post("/api/exports", json=request_payload())
        assert response.status_code == 500
        assert response.json()["error"]["code"] == "EXPORT_FAILED"
        assert "private filesystem" not in response.text
        assert not app.state.export_lock.locked()


def test_export_attempts_are_rate_limited_without_blocking_health():
    with TestClient(app) as client:
        for _ in range(6):
            assert client.post("/api/exports", json={}).status_code == 422
        response = client.post("/api/exports", json={})
        assert response.status_code == 429
        assert response.json()["error"]["code"] == "EXPORT_RATE_LIMITED"
        assert 1 <= int(response.headers["Retry-After"]) <= 60
        assert client.get("/api/health").status_code == 200


def test_geometry_validation_is_isolated_from_the_api_event_loop(monkeypatch):
    import pin_art.app as api

    def unexpected_validation(*args, **kwargs):
        raise AssertionError("Geometry validation belongs in the timed worker")

    monkeypatch.setattr(api.ExportRequest, "model_validate", unexpected_validation)
    with TestClient(app) as client:
        response = client.post("/api/exports", json=request_payload())
        assert response.status_code == 200
        assert not app.state.export_lock.locked()


def test_worker_failure_keeps_bounded_diagnostics_in_logs_only(monkeypatch, caplog):
    import pin_art.app as api

    monkeypatch.setattr(api, "WORKER_MODULE", "pin_art.missing_worker")
    with TestClient(app) as client:
        response = client.post("/api/exports", json=request_payload())
        assert response.status_code == 500
        assert "missing_worker" in caplog.text
        assert "missing_worker" not in response.text


def test_generated_artifact_size_is_bounded_and_next_attempt_works(monkeypatch):
    import pin_art.app as api

    monkeypatch.setattr(api, "MAX_ARTIFACT_BYTES", 1, raising=False)
    with TestClient(app) as client:
        response = client.post("/api/exports", json=request_payload())
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "EXPORT_TOO_LARGE"
        assert not app.state.export_lock.locked()
        monkeypatch.setattr(api, "MAX_ARTIFACT_BYTES", 256 * 1024 * 1024)
        assert client.post("/api/exports", json=request_payload()).status_code == 200


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
    lock = asyncio.Lock()
    response = ExportFileResponse(target, directory=directory, lock=lock)

    async def disconnect_receive():
        return {"type": "http.disconnect"}

    async def disconnected_send(message):
        if message["type"] == message_type:
            raise failure_type("disconnected")

    scope = {"type": "http", "method": "GET", "headers": [], "asgi": {"spec_version": "2.4"}}

    async def send_file():
        await lock.acquire()
        await response(scope, disconnect_receive, disconnected_send)

    with pytest.raises(failure_type):
        asyncio.run(send_file())
    assert not target.parent.exists()
    assert not lock.locked()


def test_download_holds_admission_until_the_file_is_sent(tmp_path):
    async def exercise():
        directory = tempfile.TemporaryDirectory(dir=tmp_path)
        target = Path(directory.name) / "model.stl"
        target.write_bytes(b"model")
        lock = asyncio.Lock()
        await lock.acquire()
        response = ExportFileResponse(target, directory=directory, lock=lock)

        async def receive():
            return {"type": "http.disconnect"}

        async def send(message):
            assert lock.locked()

        await response({"type": "http", "method": "GET", "headers": []}, receive, send)
        assert not lock.locked()
        assert not target.parent.exists()

    asyncio.run(exercise())


def test_slow_download_times_out_and_releases_artifacts(tmp_path, monkeypatch):
    import pin_art.app as api

    monkeypatch.setattr(api, "DOWNLOAD_TIMEOUT", 0.01)

    async def exercise():
        directory = tempfile.TemporaryDirectory(dir=tmp_path)
        target = Path(directory.name) / "model.stl"
        target.write_bytes(b"model")
        lock = asyncio.Lock()
        await lock.acquire()
        response = ExportFileResponse(target, directory=directory, lock=lock)

        async def receive():
            return {"type": "http.disconnect"}

        async def send(message):
            await asyncio.sleep(60)

        with pytest.raises(TimeoutError):
            await response({"type": "http", "method": "GET", "headers": []}, receive, send)
        assert not lock.locked()
        assert not target.parent.exists()

    asyncio.run(exercise())


def test_upload_disconnect_is_not_an_internal_server_error():
    from starlette.requests import Request
    from pin_art.app import download_export, lifespan

    async def exercise():
        async def receive():
            return {"type": "http.disconnect"}

        async with lifespan(app):
            request = Request({"type": "http", "headers": [(b"content-type", b"application/json")]}, receive)
            response = await download_export(request)
            assert response.status_code == 499
            assert not app.state.export_lock.locked()

    asyncio.run(exercise())


def test_slow_upload_times_out_and_unlocks(monkeypatch):
    import pin_art.app as api
    from starlette.requests import Request

    monkeypatch.setattr(api, "BODY_TIMEOUT", 0.01)

    async def exercise():
        async def receive():
            await asyncio.sleep(60)

        async with api.lifespan(app):
            request = Request({"type": "http", "headers": [(b"content-type", b"application/json")]}, receive)
            response = await api.download_export(request)
            assert response.status_code == 408
            assert not app.state.export_lock.locked()

    asyncio.run(exercise())


def test_worker_memory_limit_is_actionable_and_unlocks(monkeypatch):
    import pin_art.jobs as jobs
    import pin_art.app as api

    monkeypatch.setattr(jobs, "resident_bytes", lambda pid: 1000, raising=False)
    monkeypatch.setattr(api, "MAX_WORKER_RSS_BYTES", 100, raising=False)
    with TestClient(app) as client:
        response = client.post("/api/exports", json=request_payload())
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "EXPORT_MEMORY_LIMIT"
        assert not app.state.export_lock.locked()


@pytest.mark.parametrize("body", ["[" * 2000 + "]" * 2000, '{"value": NaN}', b"\xff"], ids=["deep", "nonfinite", "invalid-encoding"])
def test_invalid_deep_or_nonfinite_json_is_safe(body):
    with TestClient(app) as client:
        response = client.post("/api/exports", content=body, headers={"Content-Type": "application/json"})
        assert response.status_code in (400, 422)
        assert not app.state.export_lock.locked()


@pytest.mark.parametrize("limit", ["0", "6145", "invalid"])
def test_invalid_worker_memory_configuration_fails_at_startup(limit):
    result = subprocess.run([sys.executable, "-c", "import pin_art.app"],
                            env={**os.environ, "PIN_ART_WORKER_RSS_MIB": limit}, capture_output=True, text=True)
    assert result.returncode != 0
    assert "ValueError" in result.stderr


def test_worker_memory_budget_can_be_lowered():
    result = subprocess.run([sys.executable, "-c", "from pin_art.app import MAX_WORKER_RSS_BYTES; print(MAX_WORKER_RSS_BYTES)"],
                            env={**os.environ, "PIN_ART_WORKER_RSS_MIB": "1024"}, capture_output=True, text=True, check=True)
    assert int(result.stdout.strip()) == 1024 ** 3
