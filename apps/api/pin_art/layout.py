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
    row, column = divmod(pin_index, request.parameters.columns)
    length = request.heights[pin_index]
    if request.mode == "detachable":
        length += request.socket.insertion_depth
    return f"Pin R{row + 1:02d} C{column + 1:02d} {length:.3f} mm"


def plan_layout(request: ExportRequest) -> list[LayoutPlate]:
    parameters = request.parameters
    count = parameters.columns * parameters.rows
    if request.mode == "fixed":
        parts = [LayoutPart("base", None, 0.0, 0.0)]
        for pin_index in range(count):
            row, column = divmod(pin_index, parameters.columns)
            parts.append(LayoutPart(
                _pin_name(request, pin_index), pin_index,
                (column - (parameters.columns - 1) / 2) * parameters.spacing,
                (row - (parameters.rows - 1) / 2) * parameters.spacing,
            ))
        return [LayoutPlate(0, parts)]
    usable_width = request.plate.width - 2 * MARGIN
    usable_depth = request.plate.depth - 2 * MARGIN
    if parameters.width > usable_width or parameters.depth > usable_depth:
        raise ValueError("base must fit the plate with 5 mm margins")
    if parameters.diameter > usable_width or parameters.diameter > usable_depth:
        raise ValueError("pin must fit the plate with 5 mm margins")
    plates = [LayoutPlate(0, [])]
    cursor_x = MARGIN
    cursor_y = MARGIN
    row_depth = 0.0
    for pin_index in [None, *range(count)]:
        width = parameters.width if pin_index is None else parameters.diameter
        depth = parameters.depth if pin_index is None else parameters.diameter
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
        name = "base" if pin_index is None else _pin_name(request, pin_index)
        plates[-1].parts.append(LayoutPart(name, pin_index, cursor_x + width / 2, cursor_y + depth / 2))
        cursor_x += width + PART_GAP
        row_depth = max(row_depth, depth)
    return plates
