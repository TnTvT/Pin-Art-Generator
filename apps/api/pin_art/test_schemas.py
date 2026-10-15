import copy
from math import cos, pi, sqrt

import pytest
from pydantic import ValidationError

from pin_art.schemas import ExportRequest

LEGACY_LOWER_HEAD_GAP = 0.2 / sqrt(1 / cos(pi / 63) ** 2 + 1)

def request_payload(**overrides):
    payload = {
        "format": "3mf",
        "mode": "fixed",
        "parameters": {
            "width": 20,
            "depth": 20,
            "thickness": 3,
            "columns": 2,
            "rows": 2,
            "spacing": 5,
            "diameter": 2,
            "extension": 10,
        },
        "heights": [4, 5, 6, 7],
        "materials": ["#112233", "#AABBCC"],
        "baseMaterial": 0,
        "pinMaterials": [1, 0, 1, 0],
        "sliding": {"clearance": 0.4, "headFlare": 0.4, "lowerHeadGap": LEGACY_LOWER_HEAD_GAP, "lowerHeadAngle": 45},
    }
    payload.update(overrides)
    return copy.deepcopy(payload)


def test_aliases_round_trip_frontend_payload():
    payload = request_payload()
    request = ExportRequest.model_validate(payload)
    assert request.base_material == 0
    assert request.pin_materials == [1, 0, 1, 0]
    assert request.sliding.head_flare == 0.4
    assert request.model_dump(by_alias=True, exclude_none=True) == payload


def test_filament_profiles_are_optional_and_round_trip_when_supplied():
    assert ExportRequest.model_validate(request_payload()).filament_profiles is None
    payload = request_payload(filamentProfiles=["bambu-pla-basic", "bambu-pla-matte"])
    request = ExportRequest.model_validate(payload)
    assert request.filament_profiles == payload["filamentProfiles"]
    assert request.model_dump(by_alias=True) == payload


def test_default_sliding_settings_use_requested_shaft_clearance_and_lower_gap():
    payload = request_payload(mode="print-in-place")
    payload.pop("sliding")
    request = ExportRequest.model_validate(payload)
    assert request.sliding.clearance == 0.6
    assert request.sliding.head_flare == 0.7
    assert request.sliding.lower_head_gap == 0.3
    assert request.sliding.lower_head_angle == 45


def test_manual_heights_can_exceed_generator_extension():
    request = ExportRequest.model_validate(request_payload(heights=[25, 30, 40, 50]))
    assert request.heights == [25, 30, 40, 50]


@pytest.mark.parametrize("profiles", [[], ["generic-pla"], ["generic-pla"] * 3, ["bambu-pla-basic", "unknown"], ["generic-pla", 1]])
def test_filament_profiles_must_be_allowlisted_and_match_palette(profiles):
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(request_payload(filamentProfiles=profiles))


@pytest.mark.parametrize("field", ["width", "depth", "thickness", "spacing", "diameter", "extension"])
@pytest.mark.parametrize("value", [0, -1, float("inf"), float("nan"), True, "3"])
def test_parameters_require_finite_positive_numbers(field, value):
    payload = request_payload()
    payload["parameters"][field] = value
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("field", ["columns", "rows"])
@pytest.mark.parametrize("value", [0, 101, 2.0, True, "2"])
def test_counts_are_strict_integers_between_one_and_one_hundred(field, value):
    payload = request_payload()
    payload["parameters"][field] = value
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("field", ["heights", "pinMaterials"])
@pytest.mark.parametrize("length", [0, 3, 5])
def test_pin_arrays_match_grid_count(field, length):
    payload = request_payload()
    payload[field] = [1] * length
    with pytest.raises(ValidationError, match="count"):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("value", [0, -1, float("nan"), float("inf"), True, "1"])
def test_heights_are_finite_and_positive(value):
    payload = request_payload()
    payload["heights"][0] = value
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("materials", [[], ["#123456"] * 17, ["red"], ["#1234"], ["#12345678"], ["#GG0000"]])
def test_palette_requires_one_to_sixteen_hex_rgb_colors(materials):
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(request_payload(materials=materials))


@pytest.mark.parametrize("field", ["baseMaterial", "pinMaterials"])
@pytest.mark.parametrize("value", [-1, 2, True, 1.0, "1"])
def test_material_indices_are_strict_and_in_palette(field, value):
    payload = request_payload()
    payload[field] = value if field == "baseMaterial" else [value, 0, 0, 0]
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(payload)


def test_fixed_grid_fit_and_overlap_are_rejected():
    for parameter, value in [("width", 6), ("depth", 6), ("spacing", 1.9)]:
        payload = request_payload()
        payload["parameters"][parameter] = value
        with pytest.raises(ValidationError):
            ExportRequest.model_validate(payload)


def test_single_pin_does_not_need_spacing_between_neighbors():
    payload = request_payload(heights=[4], pinMaterials=[0])
    payload["parameters"].update(columns=1, rows=1, spacing=0.1)
    assert ExportRequest.model_validate(payload).parameters.columns == 1


def test_fixed_accepts_exact_grid_fit_and_tangent_pins():
    payload = request_payload()
    payload["parameters"].update(width=4, depth=4, spacing=2)
    ExportRequest.model_validate(payload)


def test_unknown_fields_and_enum_values_are_rejected():
    for updates in [{"format": "obj"}, {"mode": "assembled"}, {"other": 1}]:
        with pytest.raises(ValidationError):
            ExportRequest.model_validate(request_payload(**updates))


def test_finite_inputs_with_overflowing_derived_dimensions_are_rejected():
    payload = request_payload()
    payload["parameters"]["thickness"] = 1e308
    payload["heights"][0] = 1e308
    with pytest.raises(ValidationError):
        ExportRequest.model_validate(payload)


def test_stl_bed_setting_does_not_restrict_large_five_thousand_pin_design():
    payload = request_payload(format="stl", heights=[1] * 5000, pinMaterials=[0] * 5000)
    payload["parameters"].update(columns=100, rows=50, width=500, depth=500)
    assert len(ExportRequest.model_validate(payload).heights) == 5000


@pytest.mark.parametrize("mode", ["fixed", "print-in-place"])
def test_legacy_grid_cannot_bypass_five_thousand_pin_limit(mode):
    payload = request_payload(mode=mode)
    payload["parameters"].update(rows=51, columns=100, width=500, depth=500)
    with pytest.raises(ValidationError, match="5,000"):
        ExportRequest.model_validate(payload)


@pytest.mark.parametrize("mode", ["fixed"])
def test_bambu_profile_blocks_oversized_base_and_print_height_only_for_3mf(mode):
    payload = request_payload(mode=mode)
    payload["parameters"]["width"] = 300
    with pytest.raises(ValidationError, match="X1C"):
        ExportRequest.model_validate(payload)
    payload["format"] = "stl"
    assert ExportRequest.model_validate(payload).parameters.width == 300
    payload = request_payload(mode=mode)
    payload["parameters"]["extension"] = 250
    payload["heights"] = [250] * 4
    with pytest.raises(ValidationError, match="250 mm"):
        ExportRequest.model_validate(payload)
    payload["format"] = "stl"
    assert ExportRequest.model_validate(payload).heights == [250] * 4


def test_manual_height_preserves_supplied_value():
    payload = request_payload()
    payload["heights"][0] = 10.000009
    request = ExportRequest.model_validate(payload)
    assert request.heights[0] == 10.000009
    payload["heights"][0] = 10.00002
    assert ExportRequest.model_validate(payload).heights[0] == 10.00002


def test_fixed_stl_rejects_tangent_pins_before_boolean_export():
    payload = request_payload(format="stl")
    payload["parameters"]["spacing"] = 2
    with pytest.raises(ValidationError, match="tangent"):
        ExportRequest.model_validate(payload)
