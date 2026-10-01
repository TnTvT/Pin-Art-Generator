from dataclasses import asdict

import pytest

from pin_art.layout import plan_layout
from pin_art.schemas import ExportRequest
from pin_art.test_schemas import request_payload


def test_fixed_layout_is_centered_and_row_major():
    plates = plan_layout(ExportRequest.model_validate(request_payload()))
    assert len(plates) == 1
    assert plates[0].index == 0
    assert [(part.pin_index, part.x, part.y) for part in plates[0].parts] == [
        (None, 0, 0), (0, -2.5, -2.5), (1, 2.5, -2.5),
        (2, -2.5, 2.5), (3, 2.5, 2.5),
    ]


def test_detachable_reserves_centered_base_plate_and_centers_pin_plate():
    request = ExportRequest.model_validate(request_payload(mode="detachable", plate={"width": 42, "depth": 42}))
    plates = plan_layout(request)
    assert len(plates) == 2
    assert [(part.pin_index, part.x, part.y) for part in plates[0].parts] == [
        (None, 21, 21),
    ]
    assert [(part.pin_index, part.x, part.y) for part in plates[1].parts] == [
        (0, 12, 21), (1, 18, 21), (2, 24, 21), (3, 30, 21),
    ]
    assert [asdict(plate) for plate in plates] == [asdict(plate) for plate in plan_layout(request)]


def test_detachable_base_only_first_plate_and_remaining_pins_next():
    request = ExportRequest.model_validate(request_payload(mode="detachable", plate={"width": 30, "depth": 30}))
    plates = plan_layout(request)
    assert [plate.index for plate in plates] == [0, 1]
    assert [part.pin_index for part in plates[0].parts] == [None]
    assert [(part.pin_index, part.x, part.y) for part in plates[1].parts] == [
        (0, 6, 15), (1, 12, 15), (2, 18, 15), (3, 24, 15),
    ]


def test_every_detachable_footprint_has_margins_and_part_gaps():
    payload = request_payload(mode="detachable", heights=[1] * 100, pinMaterials=[0] * 100, plate={"width": 70, "depth": 65})
    payload["parameters"].update(columns=10, rows=10, width=50, depth=50)
    request = ExportRequest.model_validate(payload)
    plates = plan_layout(request)
    assert [part.pin_index for plate in plates for part in plate.parts if part.pin_index is not None] == list(range(100))
    for plate in plates:
        boxes = []
        for part in plate.parts:
            width = request.parameters.width if part.pin_index is None else request.parameters.diameter
            depth = request.parameters.depth if part.pin_index is None else request.parameters.diameter
            boxes.append((part.x - width / 2, part.y - depth / 2, part.x + width / 2, part.y + depth / 2))
        for minimum_x, minimum_y, maximum_x, maximum_y in boxes:
            assert minimum_x >= 5
            assert minimum_y >= 5
            assert maximum_x <= request.plate.width - 5
            assert maximum_y <= request.plate.depth - 5
        for index, first in enumerate(boxes):
            for second in boxes[index + 1:]:
                assert first[2] + 4 <= second[0] or second[2] + 4 <= first[0] or first[3] + 4 <= second[1] or second[3] + 4 <= first[1]


def test_layout_caps_at_thirty_six_plates():
    payload = request_payload(mode="detachable", heights=[1] * 100, pinMaterials=[0] * 100, plate={"width": 57, "depth": 57})
    payload["parameters"].update(columns=10, rows=10, width=47, depth=47, spacing=5, diameter=0.2)
    request = ExportRequest.model_validate(payload)
    request.plate.width = 12
    request.plate.depth = 12
    request.parameters.width = 0.2
    request.parameters.depth = 0.2
    with pytest.raises(ValueError, match="36"):
        plan_layout(request)


@pytest.mark.parametrize("part", ["base", "pin"])
def test_layout_defensively_rejects_oversized_parts(part):
    request = ExportRequest.model_validate(request_payload(mode="detachable"))
    if part == "base":
        request.parameters.width = 247
    else:
        request.parameters.diameter = 247
    with pytest.raises(ValueError, match=part):
        plan_layout(request)


def test_part_name_rounds_only_label_and_includes_row_column_and_printed_length():
    payload = request_payload(mode="detachable")
    payload["heights"][0] = 4.1234567
    request = ExportRequest.model_validate(payload)
    parts = [part for plate in plan_layout(request)[1:] for part in plate.parts]
    assert parts[0].name == "Pin R01 C01 6.123 mm"
    assert parts[2].name == "Pin R02 C01 8.000 mm"
    assert request.heights[0] == 4.1234567


def test_layout_accepts_exactly_thirty_six_plates():
    payload = request_payload(mode="detachable", heights=[1] * 35, pinMaterials=[0] * 35)
    payload["parameters"].update(columns=7, rows=5, width=35, depth=35)
    request = ExportRequest.model_validate(payload)
    request.plate.width = 12
    request.plate.depth = 12
    request.parameters.width = 2
    request.parameters.depth = 2
    plates = plan_layout(request)
    assert len(plates) == 36
    assert [plate.index for plate in plates] == list(range(36))
