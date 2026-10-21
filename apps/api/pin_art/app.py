import asyncio
import json
import logging
import os
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, JSONResponse
from starlette.requests import ClientDisconnect
from pin_art.admission import ExportAvailability, ExportRateLimit
from pin_art.jobs import run_worker
from pin_art.schemas import ExportRequest


MAX_BODY_BYTES = 2 * 1024 * 1024
EXPORT_TIMEOUT = 120
BODY_TIMEOUT = 10
DOWNLOAD_TIMEOUT = 30
MAX_ARTIFACT_BYTES = 256 * 1024 * 1024
MAX_WORKER_RSS_BYTES = int(os.environ.get("PIN_ART_WORKER_RSS_MIB", "6144")) * 1024 ** 2
if not 0 < MAX_WORKER_RSS_BYTES <= 6 * 1024 ** 3:
    raise ValueError("PIN_ART_WORKER_RSS_MIB must be between 1 and 6144")
WORKER_MODULE = "pin_art.worker"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
logger = logging.getLogger("pin_art.export")


@asynccontextmanager
async def lifespan(application):
    application.state.export_lock = asyncio.Lock()
    application.state.export_rate_limit = ExportRateLimit()
    application.state.export_availability = ExportAvailability()
    yield


app = FastAPI(title="Pin Art export service", lifespan=lifespan)


def export_openapi():
    if app.openapi_schema is None:
        schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
        request_schema = ExportRequest.model_json_schema(ref_template="#/components/schemas/{model}")
        schemas = schema.setdefault("components", {}).setdefault("schemas", {})
        schemas.update(request_schema.pop("$defs", {}))
        schemas["ExportRequest"] = request_schema
        schema["paths"]["/api/exports"]["post"]["requestBody"] = {
            "required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ExportRequest"}}},
        }
        app.openapi_schema = schema
    return app.openapi_schema


app.openapi = export_openapi


class ExportFileResponse(FileResponse):
    def __init__(self, path, directory, lock=None, availability=None, **kwargs):
        super().__init__(path, **kwargs)
        self.directory = directory
        self.lock = lock
        self.availability = availability

    async def __call__(self, scope, receive, send):
        try:
            async with asyncio.timeout(DOWNLOAD_TIMEOUT):
                await super().__call__(scope, receive, send)
        finally:
            try:
                self.directory.cleanup()
            except OSError:
                logger.exception("Export artifact cleanup failed")
            finally:
                if self.availability is not None:
                    self.availability.clear()
                if self.lock is not None:
                    self.lock.release()


def error(status: int, code: str, message: str, headers=None):
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/exports/status")
async def export_status():
    return JSONResponse(app.state.export_availability.snapshot(app.state.export_lock.locked()), headers={"Cache-Control": "no-store"})


@app.post("/api/exports")
async def download_export(request: Request):
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        return error(415, "JSON_REQUIRED", "Send an application/json design snapshot.")
    lock = app.state.export_lock
    availability = app.state.export_availability
    if lock.locked():
        status = availability.snapshot(True)
        return JSONResponse({"error": {"code": "EXPORT_BUSY", "message": "Another export is running. Your request has not been queued.",
                                       "estimatedWaitSeconds": status["estimatedWaitSeconds"], "estimateKind": status["estimateKind"]}},
                            status_code=503, headers={"Retry-After": "5", "Cache-Control": "no-store"})
    retry_after = app.state.export_rate_limit.admit()
    if retry_after:
        return error(429, "EXPORT_RATE_LIMITED", "Too many export attempts. Wait before retrying.", {"Retry-After": str(retry_after)})
    await lock.acquire()
    availability.update(BODY_TIMEOUT + EXPORT_TIMEOUT + DOWNLOAD_TIMEOUT + 3)
    directory = None
    complete = False
    started = time.monotonic()
    try:
        body = bytearray()
        try:
            async with asyncio.timeout(BODY_TIMEOUT):
                async for chunk in request.stream():
                    if len(body) + len(chunk) > MAX_BODY_BYTES:
                        return error(413, "REQUEST_TOO_LARGE", "Export requests must be no larger than 2 MB.")
                    body.extend(chunk)
        except TimeoutError:
            return error(408, "REQUEST_TIMEOUT", "Upload the design snapshot within 10 seconds and retry.")
        directory = tempfile.TemporaryDirectory(prefix="pin-art-export-")
        root = Path(directory.name)
        (root / "request.json").write_bytes(body)
        del body
        environment = {**os.environ, "PIN_ART_MAX_ARTIFACT_BYTES": str(MAX_ARTIFACT_BYTES), "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "2"}
        availability.update(EXPORT_TIMEOUT + DOWNLOAD_TIMEOUT + 3)
        try:
            async with asyncio.timeout(EXPORT_TIMEOUT):
                worker = await run_worker([sys.executable, "-m", WORKER_MODULE, str(root)], BACKEND_ROOT, request=request, env=environment, max_rss_bytes=MAX_WORKER_RSS_BYTES)
        except TimeoutError:
            return error(504, "EXPORT_TIMEOUT", "Export exceeded 120 seconds. Reduce the pin count and retry.")
        if worker.disconnected:
            logger.info("Export cancelled after client disconnected")
            return error(499, "CLIENT_DISCONNECTED", "The download connection was closed.")
        if worker.memory_limited:
            logger.warning("Export stopped at worker memory limit: bytes=%s", MAX_WORKER_RSS_BYTES)
            return error(422, "EXPORT_MEMORY_LIMIT", "This design needs too much export memory. Reduce the pin count or contour complexity and retry.")
        if worker.returncode != 0:
            logger.error("Export worker failed: exit=%s diagnostics=%s", worker.returncode, worker.diagnostics)
            return error(500, "EXPORT_FAILED", "The model could not be generated. Check the dimensions and retry.")
        details = json.loads((root / "result.json").read_text(encoding="utf-8"))
        if "error" in details:
            return error(details.get("status", 422), details.get("code", "INVALID_GEOMETRY"), details["error"])
        filename = details["filename"]
        target = root / filename
        if Path(filename).name != filename or target.is_symlink() or not target.is_file():
            raise ValueError("Invalid worker artifact")
        if target.stat().st_size > MAX_ARTIFACT_BYTES:
            return error(422, "EXPORT_TOO_LARGE", "Generated file exceeds 256 MB. Reduce the design complexity or use 3MF.")
        metrics = details.get("metrics", {})
        logger.info("Export complete: format=%s mode=%s pins=%s seconds=%.3f bytes=%s worker_peak_rss_bytes=%s", details.get("format"), details.get("mode"), details.get("pins"), time.monotonic() - started, target.stat().st_size, metrics.get("peakRssBytes"))
        availability.update(DOWNLOAD_TIMEOUT)
        response = ExportFileResponse(target, directory=directory, lock=lock, availability=availability, filename=filename, media_type=details["contentType"], headers={"X-Plate-Count": str(details["plates"]), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
        complete = True
        return response
    except asyncio.CancelledError:
        raise
    except ClientDisconnect:
        logger.info("Export cancelled during upload")
        return error(499, "CLIENT_DISCONNECTED", "The download connection was closed.")
    except Exception:
        logger.exception("Export orchestration failed")
        return error(500, "EXPORT_FAILED", "The export service encountered an error. Please retry.")
    finally:
        if not complete:
            try:
                if directory is not None:
                    directory.cleanup()
            except OSError:
                logger.exception("Export artifact cleanup failed")
            finally:
                availability.clear()
                lock.release()
