from dataclasses import dataclass

from .schemas import ExportRequest


MARGIN = 5.0
PART_GAP = 4.0
MAX_PLATES = 36


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


def _pin_name(request: ExportRequest, pin_index: int) -> str:
    if request.layout:
        pin = request.layout.pins[pin_index]
        length = request.heights[pin_index] + (request.socket.insertion_depth if request.mode == "detachable" else 0)
        return f"Pin {pin.id} X{pin.x:.3f} Y{pin.y:.3f} {length:.3f} mm"
    row, column = divmod(pin_index, request.parameters.columns)
    length = request.heights[pin_index]
    if request.mode == "detachable":
        length += request.socket.insertion_depth
    return f"Pin R{row + 1:02d} C{column + 1:02d} {length:.3f} mm"


def plan_layout(request: ExportRequest) -> list[LayoutPlate]:
    parameters = request.parameters
    count = len(request.layout.pins) if request.layout else parameters.columns * parameters.rows
    if request.mode == "fixed":
        parts = [LayoutPart("base", None, 0.0, 0.0)]
        for pin_index in range(count):
            if request.layout:
                horizontal, vertical = request.layout.pins[pin_index].x, request.layout.pins[pin_index].y
            else:
                row, column = divmod(pin_index, parameters.columns)
                horizontal = (column - (parameters.columns - 1) / 2) * parameters.spacing
                vertical = (row - (parameters.rows - 1) / 2) * parameters.spacing
            parts.append(LayoutPart(
                _pin_name(request, pin_index), pin_index,
                horizontal, vertical,
            ))
        return [LayoutPlate(0, parts)]
    usable_width = request.plate.width - 2 * MARGIN
    usable_depth = request.plate.depth - 2 * MARGIN
    if parameters.width > usable_width or parameters.depth > usable_depth:
        raise ValueError("base must fit the plate with 5 mm margins")
    if parameters.diameter > usable_width or parameters.diameter > usable_depth:
        raise ValueError("pin must fit the plate with 5 mm margins")
    plates = [
        LayoutPlate(0, [LayoutPart("base", None, request.plate.width / 2, request.plate.depth / 2)]),
        LayoutPlate(1, []),
    ]
    cursor_x = MARGIN
    cursor_y = MARGIN
    row_depth = 0.0
    for pin_index in range(count):
        width = parameters.diameter
        depth = parameters.diameter
        if cursor_x + width > request.plate.width - MARGIN:
            cursor_x = MARGIN
            cursor_y += row_depth + PART_GAP
            row_depth = 0.0
        if cursor_y + depth > request.plate.depth - MARGIN:
            if len(plates) >= MAX_PLATES:
                raise ValueError("detachable layout exceeds the maximum of 36 plates")
            plates.append(LayoutPlate(len(plates), []))
            cursor_x = MARGIN
            cursor_y = MARGIN
            row_depth = 0.0
        name = _pin_name(request, pin_index)
        plates[-1].parts.append(LayoutPart(name, pin_index, cursor_x + width / 2, cursor_y + depth / 2))
        cursor_x += width + PART_GAP
        row_depth = max(row_depth, depth)
    for plate in plates[1:]:
        center_x = (min(part.x for part in plate.parts) + max(part.x for part in plate.parts)) / 2
        center_y = (min(part.y for part in plate.parts) + max(part.y for part in plate.parts)) / 2
        for part in plate.parts:
            part.x += request.plate.width / 2 - center_x
            part.y += request.plate.depth / 2 - center_y
    return plates
