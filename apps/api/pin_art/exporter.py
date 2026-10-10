from pin_art.geometry import build_plate, plate_stl
from pin_art.schemas import ExportRequest
from pin_art.writer import export_3mf


def generate_export(request: ExportRequest):
    plate = build_plate(request)
    if request.format == "3mf":
        return export_3mf(request, plate), f"pin-art-{request.mode}.3mf", "model/3mf", 1
    return plate_stl(plate), f"pin-art-{request.mode}.stl", "model/stl", 1
