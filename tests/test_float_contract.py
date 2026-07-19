from __future__ import annotations

import pytest

from _float_contract import is_reference_runtime


@pytest.mark.parametrize(
    (
        "implementation",
        "version_info",
        "sys_platform",
        "machine",
        "expected",
    ),
    (
        ("CPython", (3, 10), "linux", "x86_64", True),
        ("PyPy", (3, 10), "linux", "x86_64", False),
        ("CPython", (3, 11), "linux", "x86_64", False),
        ("CPython", (3, 10), "win32", "AMD64", False),
        ("CPython", (3, 10), "darwin", "x86_64", False),
        ("CPython", (3, 10), "linux", "aarch64", False),
    ),
)
def test_reference_runtime_requires_complete_cod_028_host(
    implementation: str,
    version_info: tuple[int, int],
    sys_platform: str,
    machine: str,
    expected: bool,
) -> None:
    assert (
        is_reference_runtime(
            implementation=implementation,
            version_info=version_info,
            sys_platform=sys_platform,
            machine=machine,
        )
        is expected
    )
