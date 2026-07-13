from __future__ import annotations

import json
from dataclasses import asdict

import pytest

from chronogym.bank import PackError, load_pack
from chronogym.demo import demo_scenario
from chronogym.types import SCHEMA_VERSION


def write_json(path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def make_pack(tmp_path):
    root = tmp_path / "pack"
    scenario = asdict(demo_scenario())
    write_json(root / "scenarios" / "demo.json", scenario)
    write_json(
        root / "pack.json",
        {
            "name": "test",
            "version": "0.1.0",
            "schema_version": SCHEMA_VERSION,
            "description": "test pack",
            "scenarios": ["demo.json"],
        },
    )
    return root


def test_load_pack_preserves_manifest_order_and_nested_types(tmp_path) -> None:
    root = make_pack(tmp_path)
    scenarios = load_pack(root)
    assert [scenario.scenario_id for scenario in scenarios] == ["demo_g001"]
    assert scenarios[0].wind_components == demo_scenario().wind_components


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda manifest: manifest.update({"surprise": True}), "unknown manifest"),
        (lambda manifest: manifest.update({"schema_version": "1.0.0"}), "incompatible"),
        (lambda manifest: manifest.update({"scenarios": ["../demo.json"]}), "filename"),
    ],
)
def test_rejects_invalid_manifests(tmp_path, mutation, message) -> None:
    root = make_pack(tmp_path)
    path = root / "pack.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    mutation(manifest)
    write_json(path, manifest)
    with pytest.raises(PackError, match=message):
        load_pack(root)


def test_rejects_unknown_scenario_and_wind_fields(tmp_path) -> None:
    root = make_pack(tmp_path)
    path = root / "scenarios" / "demo.json"
    scenario = json.loads(path.read_text(encoding="utf-8"))
    scenario["unknown"] = 1
    write_json(path, scenario)
    with pytest.raises(PackError, match="unknown scenario"):
        load_pack(root)

    scenario.pop("unknown")
    scenario["wind_components"][0]["unknown"] = 1
    write_json(path, scenario)
    with pytest.raises(PackError, match="unknown wind component"):
        load_pack(root)


def test_normalizes_numeric_physics_to_float_and_rejects_bad_seed(tmp_path) -> None:
    root = make_pack(tmp_path)
    path = root / "scenarios" / "demo.json"
    scenario = json.loads(path.read_text(encoding="utf-8"))
    scenario["gravity_mps2"] = 9
    write_json(path, scenario)
    assert load_pack(root)[0].gravity_mps2 == 9.0
    assert isinstance(load_pack(root)[0].gravity_mps2, float)

    scenario["seed"] = "42"
    write_json(path, scenario)
    with pytest.raises(PackError, match="seed must be an integer"):
        load_pack(root)


def test_rejects_scenario_symlink_escape(tmp_path) -> None:
    root = make_pack(tmp_path)
    outside = tmp_path / "outside.json"
    outside.write_text(
        (root / "scenarios" / "demo.json").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    (root / "scenarios" / "demo.json").unlink()
    (root / "scenarios" / "demo.json").symlink_to(outside)
    with pytest.raises(PackError, match="escapes pack directory"):
        load_pack(root)
