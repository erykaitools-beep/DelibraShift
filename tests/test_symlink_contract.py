from __future__ import annotations

from pathlib import Path

import pytest

from _symlink_contract import symlink_or_skip


class BrokenLink:
    def symlink_to(self, _target: Path, *, target_is_directory: bool) -> None:
        raise FileExistsError("test setup collision")


def test_symlink_helper_does_not_hide_non_capability_failures() -> None:
    with pytest.raises(FileExistsError, match="collision"):
        symlink_or_skip(BrokenLink(), Path("target"))  # type: ignore[arg-type]
