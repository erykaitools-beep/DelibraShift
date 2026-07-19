"""Assertions for the documented cross-runtime binary64 contract."""

from __future__ import annotations

import math
import platform
import sys
from collections.abc import Sequence


REFERENCE_PYTHON = (3, 10)
REFERENCE_IMPLEMENTATION = "CPython"
REFERENCE_PLATFORM = "linux"
REFERENCE_MACHINE = "x86_64"
MAX_CROSS_RUNTIME_ULPS = 8


def is_reference_runtime(
    *,
    implementation: str | None = None,
    version_info: Sequence[int] | None = None,
    sys_platform: str | None = None,
    machine: str | None = None,
) -> bool:
    """Return whether the runtime is the complete COD-028 reference host."""
    resolved_version = sys.version_info if version_info is None else version_info
    return (
        (platform.python_implementation() if implementation is None else implementation)
        == REFERENCE_IMPLEMENTATION
        and tuple(resolved_version[:2]) == REFERENCE_PYTHON
        and (sys.platform if sys_platform is None else sys_platform)
        == REFERENCE_PLATFORM
        and (platform.machine() if machine is None else machine).lower()
        == REFERENCE_MACHINE
    )


def assert_golden_float(actual: float, expected: float) -> None:
    """Require exact reference bits or a tightly bounded libm-portability delta."""
    if is_reference_runtime():
        assert actual == expected
        return

    tolerance = MAX_CROSS_RUNTIME_ULPS * math.ulp(expected)
    difference = abs(actual - expected)
    assert difference <= tolerance, (
        f"{actual!r} differs from reference {expected!r} by {difference!r}; "
        f"cross-runtime limit is {MAX_CROSS_RUNTIME_ULPS} ULP "
        f"({tolerance!r})"
    )
