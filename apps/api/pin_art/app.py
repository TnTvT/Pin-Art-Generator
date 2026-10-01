import asyncio
import json
import logging
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError

from pin_art.schemas import ExportRequest


MAX_BODY_BYTES = 2 * 1024 * 1024
EXPORT_TIMEOUT = 120
WORKER_MODULE = "pin_art.worker"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
logger = logging.getLogger("pin_art.export")


@asynccontextmanager
async def lifespan(application):
    application.state.export_lock = asyncio.Lock()
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
    def __init__(self, path, directory, **kwargs):
        super().__init__(path, **kwargs)
        self.directory = directory

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.directory.cleanup()


def error(status: int, code: str, message: str):
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def reject_constant(value):
    raise ValueError("JSON numbers must be finite.")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/exports")
async def download_export(request: Request):
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        return error(415, "JSON_REQUIRED", "Send an application/json design snapshot.")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY_BYTES:
            return error(413, "REQUEST_TOO_LARGE", "Export requests must be no larger than 2 MB.")
        body.extend(chunk)
    try:
        payload = json.loads(body, parse_constant=reject_constant)
    except (ValueError, UnicodeDecodeError):
        return error(400, "INVALID_JSON", "The export request is not valid finite JSON.")
    try:
        design = ExportRequest.model_validate(payload)
    except ValidationError as exception:
        first = exception.errors(include_input=False)[0]
        location = ".".join(str(part) for part in first["loc"])
        return error(422, "INVALID_DESIGN", f"{location + ': ' if location else ''}{first['msg']}")
    lock = app.state.export_lock
    if lock.locked():
        return error(503, "EXPORT_BUSY", "Another export is running. Please retry when it finishes.")
    await lock.acquire()
    directory = tempfile.TemporaryDirectory(prefix="pin-art-export-")
    root = Path(directory.name)
    process = None
    complete = False
    started = time.monotonic()
    try:
        (root / "request.json").write_text(design.model_dump_json(by_alias=True), encoding="utf-8")
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", WORKER_MODULE, str(root), cwd=BACKEND_ROOT,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        try:
            await asyncio.wait_for(process.communicate(), timeout=EXPORT_TIMEOUT)
        except TimeoutError:
            return error(504, "EXPORT_TIMEOUT", "Export exceeded 120 seconds. Reduce the pin count and retry.")
        if process.returncode != 0:
            logger.error("Export worker failed: exit=%s", process.returncode)
            return error(500, "EXPORT_FAILED", "The model could not be generated. Check the dimensions and retry.")
        details = json.loads((root / "result.json").read_text(encoding="utf-8"))
        if "error" in details:
            return error(422, "INVALID_GEOMETRY", details["error"])
        filename = details["filename"]
        if Path(filename).name != filename or not (root / filename).is_file():
            raise ValueError("Invalid worker artifact")
        logger.info("Export complete: format=%s mode=%s pins=%s plates=%s seconds=%.3f bytes=%s", design.format, design.mode, len(design.heights), details["plates"], time.monotonic() - started, (root / filename).stat().st_size)
        response = ExportFileResponse(root / filename, directory=directory, filename=filename, media_type=details["contentType"], headers={"X-Plate-Count": str(details["plates"]), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
        complete = True
        return response
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Export orchestration failed")
        return error(500, "EXPORT_FAILED", "The export service encountered an error. Please retry.")
    finally:
        if process is not None and process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 3)
            except TimeoutError:
                process.kill()
                await process.wait()
        if not complete:
            directory.cleanup()
        lock.release()
