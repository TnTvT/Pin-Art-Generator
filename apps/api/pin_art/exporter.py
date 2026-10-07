from pin_art.geometry import build_plates, plate_stl
from pin_art.schemas import ExportRequest
from pin_art.writer import export_3mf


def generate_export(request: ExportRequest):
    plates = build_plates(request)
    if request.format == "3mf":
        return export_3mf(request, plates), f"pin-art-{request.mode}.3mf", "model/3mf", 1
    return plate_stl(plates[0]), f"pin-art-{request.mode}.stl", "model/stl", 1
