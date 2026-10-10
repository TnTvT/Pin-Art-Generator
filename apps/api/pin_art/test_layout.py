from pin_art.layout import plan_layout
from pin_art.schemas import ExportRequest
from pin_art.test_schemas import request_payload


def test_fixed_layout_is_centered_and_row_major():
    parts = plan_layout(ExportRequest.model_validate(request_payload()))
    assert [(part.pin_index, part.x, part.y) for part in parts] == [
        (None, 0, 0), (0, -2.5, -2.5), (1, 2.5, -2.5),
        (2, -2.5, 2.5), (3, 2.5, 2.5),
    ]
