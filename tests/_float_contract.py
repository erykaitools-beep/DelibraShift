"""Assertions for the documented cross-runtime binary64 contract."""

from __future__ import annotations

import math
import sys


REFERENCE_PYTHON = (3, 10)
MAX_CROSS_RUNTIME_ULPS = 8


def assert_golden_float(actual: float, expected: float) -> None:
    """Require exact reference bits or a tightly bounded libm-portability delta."""
    if sys.version_info[:2] == REFERENCE_PYTHON:
        assert actual == expected
        return

    tolerance = MAX_CROSS_RUNTIME_ULPS * math.ulp(expected)
    difference = abs(actual - expected)
    assert difference <= tolerance, (
        f"{actual!r} differs from reference {expected!r} by {difference!r}; "
        f"cross-runtime limit is {MAX_CROSS_RUNTIME_ULPS} ULP "
        f"({tolerance!r})"
    )

