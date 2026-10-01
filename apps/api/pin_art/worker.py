import json
import sys
from pathlib import Path

from pin_art.exporter import generate_export
from pin_art.schemas import ExportRequest


def main():
    root = Path(sys.argv[1])
    request = ExportRequest.model_validate_json((root / "request.json").read_text(encoding="utf-8"))
    try:
        payload, filename, content_type, plates = generate_export(request)
        (root / filename).write_bytes(payload)
        details = {"filename": filename, "contentType": content_type, "plates": plates}
    except ValueError as exception:
        details = {"error": str(exception)}
    (root / "result.json").write_text(json.dumps(details), encoding="utf-8")


if __name__ == "__main__":
    main()
