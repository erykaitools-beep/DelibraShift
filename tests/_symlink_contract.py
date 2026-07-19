"""Capability-based helpers for tests whose assertion requires a symlink."""

from __future__ import annotations

import os
import errno
from pathlib import Path

import pytest


def symlink_or_skip(
    link: Path,
    target: Path,
    *,
    target_is_directory: bool = False,
) -> None:
    """Create the test symlink, skipping only when the host refuses it."""
    try:
        link.symlink_to(target, target_is_directory=target_is_directory)
    except NotImplementedError as exc:
        pytest.skip(
            f"host cannot create the symlink required by this test: {exc}"
        )
    except OSError as exc:
        capability_errors = {
            errno.EACCES,
            errno.EPERM,
            errno.ENOSYS,
            getattr(errno, "ENOTSUP", errno.EPERM),
            getattr(errno, "EOPNOTSUPP", errno.EPERM),
        }
        if exc.errno not in capability_errors and getattr(exc, "winerror", None) != 1314:
            raise
        pytest.skip(
            "host cannot create the symlink required by this test: "
            f"{os.strerror(exc.errno) if exc.errno else exc}"
        )
