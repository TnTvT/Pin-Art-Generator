import json
import os
import sys
import time
from pathlib import Path

from pin_art.exporter import generate_export
from pin_art.schemas import ExportRequest
from pydantic import ValidationError


def reject_constant(value):
    raise ValueError("JSON numbers must be finite.")


def error_details(status, code, message):
    return {"status": status, "code": code, "error": message}


def generate(root):
    try:
        payload = json.loads((root / "request.json").read_bytes(), parse_constant=reject_constant)
    except (ValueError, UnicodeDecodeError, RecursionError):
        return error_details(400, "INVALID_JSON", "The export request is not valid finite JSON.")
    try:
        request = ExportRequest.model_validate(payload)
    except ValidationError as exception:
        first = exception.errors(include_input=False)[0]
        location = ".".join(str(part) for part in first["loc"])
        return error_details(422, "INVALID_DESIGN", f"{location + ': ' if location else ''}{first['msg']}")
    try:
        payload, filename, content_type, plates = generate_export(request)
        limit = int(os.environ.get("PIN_ART_MAX_ARTIFACT_BYTES", 256 * 1024 * 1024))
        if len(payload) > limit:
            return error_details(422, "EXPORT_TOO_LARGE", "Generated file exceeds 256 MB. Reduce the design complexity or use 3MF.")
        (root / filename).write_bytes(payload)
        return {"filename": filename, "contentType": content_type, "plates": plates, "format": request.format, "mode": request.mode, "pins": len(request.heights)}
    except ValueError as exception:
        return error_details(422, "INVALID_GEOMETRY", str(exception))


def main():
    root = Path(sys.argv[1])
    started = time.monotonic()
    details = generate(root)
    try:
        import resource

        peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        peak_rss_bytes = peak_rss if sys.platform == "darwin" else peak_rss * 1024
    except ImportError:
        peak_rss_bytes = None
    details["metrics"] = {"seconds": time.monotonic() - started, "peakRssBytes": peak_rss_bytes}
    (root / "result.json").write_text(json.dumps(details), encoding="utf-8")


if __name__ == "__main__":
    main()
