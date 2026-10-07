from dataclasses import dataclass

from .schemas import ExportRequest, PinGeometry


@dataclass
class LayoutPart:
    name: str
    pin_index: int | None
    x: float
    y: float


@dataclass
class LayoutPlate:
    index: int
    parts: list[LayoutPart]


def _pin_name(request: ExportRequest, pin_index: int, geometry: PinGeometry) -> str:
    suffix = "" if geometry.shape == "round" and request.pin_geometries is None else f" {geometry.shape} {geometry.rotation:g}deg"
    length = request.heights[pin_index]
    if request.layout:
        pin = request.layout.pins[pin_index]
        return f"Pin {pin.id} X{pin.x:.3f} Y{pin.y:.3f} {length:.3f} mm{suffix}"
    row, column = divmod(pin_index, request.parameters.columns)
    return f"Pin R{row + 1:02d} C{column + 1:02d} {length:.3f} mm{suffix}"


def plan_layout(request: ExportRequest) -> list[LayoutPlate]:
    parameters = request.parameters
    geometries = request.resolved_pin_geometries
    parts = [LayoutPart("base", None, 0.0, 0.0)]
    for pin_index, geometry in enumerate(geometries):
        if request.layout:
            horizontal, vertical = request.layout.pins[pin_index].x, request.layout.pins[pin_index].y
        else:
            row, column = divmod(pin_index, parameters.columns)
            horizontal = (column - (parameters.columns - 1) / 2) * parameters.spacing
            vertical = (row - (parameters.rows - 1) / 2) * parameters.spacing
        parts.append(LayoutPart(_pin_name(request, pin_index, geometry), pin_index, horizontal, vertical))
    return [LayoutPlate(0, parts)]
