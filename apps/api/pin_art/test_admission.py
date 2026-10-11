import pytest

from pin_art.admission import ExportRateLimit


def test_rate_window_recovers_and_keeps_bounded_history():
    current = [100.0]
    limiter = ExportRateLimit(limit=2, window=60, clock=lambda: current[0])
    assert limiter.admit() == 0
    current[0] += 5
    assert limiter.admit() == 0
    assert limiter.admit() == 55
    assert len(limiter.attempts) == 2
    current[0] = 160
    assert limiter.admit() == 0
    assert limiter.admit() == 5
    current[0] = 165
    assert limiter.admit() == 0
    assert len(limiter.attempts) == 2


@pytest.mark.parametrize("limit,window", [(0, 60), (1, 0), (1, float("inf"))])
def test_invalid_rate_configuration_is_rejected(limit, window):
    with pytest.raises(ValueError):
        ExportRateLimit(limit, window)
