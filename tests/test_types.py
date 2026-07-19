from __future__ import annotations

import pytest

from delibrashift.types import canonical_json


def test_canonical_json_normalizes_negative_zero_recursively() -> None:
    assert canonical_json({"x": -0.0, "nested": [-0.0, {"y": -0.0}]}) == (
        '{"nested":[0.0,{"y":0.0}],"x":0.0}'
    )


def test_canonical_json_rejects_non_string_keys() -> None:
    with pytest.raises(TypeError, match="dict keys must be str"):
        canonical_json({1: "ambiguous"})
