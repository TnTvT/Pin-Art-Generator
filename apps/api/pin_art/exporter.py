import io
import json
import zipfile

from pin_art.geometry import build_plates, plate_stl
from pin_art.schemas import ExportRequest
from pin_art.writer import export_3mf


def generate_export(request: ExportRequest):
    plates = build_plates(request)
    if request.format == "3mf":
        return export_3mf(request, plates), f"pin-art-{request.mode}.3mf", "model/3mf", len(plates)
    if request.mode == "fixed":
        return plate_stl(plates[0]), "pin-art-fixed.stl", "model/stl", 1
    buffer = io.BytesIO()
    manifest = {"units": "mm", "mode": "detachable", "socket": request.socket.model_dump(by_alias=True), "plate": request.plate.model_dump(), "materials": request.materials, "plates": []}
    manifest.update(pinShape=request.parameters.pin_shape, pinRotation=request.parameters.pin_rotation if request.parameters.pin_shape != "round" else 0, diameter=request.parameters.diameter)
    geometries = request.resolved_pin_geometries
    manifest["pinGeometries"] = [geometry.model_dump() for geometry in geometries]
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for index, plate in enumerate(plates, start=1):
            filename = f"plate-{index:02d}.stl"
            archive.writestr(filename, plate_stl(plate))
            parts = []
            for part in plate.parts:
                entry = {"name": part.name, "material": part.material, "transform": part.transform.tolist()}
                if part.pin_index is not None:
                    entry.update(pinIndex=part.pin_index, **geometries[part.pin_index].model_dump())
                parts.append(entry)
            manifest["plates"].append({"file": filename, "parts": parts})
        manifest["heights"] = request.heights
        if request.layout:
            manifest["layout"] = request.layout.model_dump(by_alias=True)
        else:
            manifest["grid"] = {"columns": request.parameters.columns, "rows": request.parameters.rows}
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
    return buffer.getvalue(), "pin-art-detachable-plates.zip", "application/zip", len(plates)
