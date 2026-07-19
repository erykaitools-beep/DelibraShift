from __future__ import annotations

import json
from dataclasses import asdict

import pytest

from delibrashift.bank import PackError, load_pack, load_pack_metadata
from delibrashift.demo import demo_scenario
from delibrashift.types import SCHEMA_VERSION
from _symlink_contract import symlink_or_skip


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
    symlink_or_skip(root / "scenarios" / "demo.json", outside)
    with pytest.raises(PackError, match="escapes pack directory"):
        load_pack(root)


@pytest.mark.parametrize("loader", (load_pack, load_pack_metadata))
def test_rejects_missing_pack_directory(tmp_path, loader) -> None:
    with pytest.raises(PackError, match="not a directory"):
        loader(tmp_path / "missing")


@pytest.mark.parametrize(
    ("contents", "message"),
    (
        ("{", "cannot read JSON"),
        ("[]", "JSON root must be an object"),
        ('{"name":"first","name":"second"}', "duplicate JSON key"),
    ),
)
def test_rejects_malformed_nonobject_or_duplicate_json(tmp_path, contents, message) -> None:
    root = make_pack(tmp_path)
    (root / "pack.json").write_text(contents, encoding="utf-8")
    with pytest.raises(PackError, match=message):
        load_pack(root)


@pytest.mark.parametrize(
    ("mutation", "message"),
    (
        (lambda payload: payload.pop("description"), "missing manifest fields"),
        (lambda payload: payload.update({"schema_version": 1}), "must be a string"),
        (lambda payload: payload.update({"schema_version": "0.2"}), "invalid schema"),
        (lambda payload: payload.update({"name": 1}), "manifest name"),
        (lambda payload: payload.update({"version": None}), "manifest version"),
        (lambda payload: payload.update({"description": []}), "manifest description"),
        (lambda payload: payload.update({"scenarios": "demo.json"}), "list of filenames"),
        (lambda payload: payload.update({"scenarios": [1]}), "list of filenames"),
    ),
)
def test_rejects_missing_or_wrongly_typed_manifest_fields(
    tmp_path,
    mutation,
    message,
) -> None:
    root = make_pack(tmp_path)
    path = root / "pack.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    mutation(manifest)
    write_json(path, manifest)
    with pytest.raises(PackError, match=message):
        load_pack(root)


@pytest.mark.parametrize(
    ("mutation", "message"),
    (
        (lambda payload: payload.update({"wind_components": {}}), "must be a list"),
        (lambda payload: payload.update({"wind_components": [None]}), "must be an object"),
        (
            lambda payload: payload["wind_components"][0].pop("amp_mps2"),
            "invalid wind component",
        ),
        (
            lambda payload: payload["wind_components"][0].update({"amp_mps2": True}),
            "must be numeric",
        ),
        (lambda payload: payload.update({"axis_tags": [1]}), "list of strings"),
        (lambda payload: payload.update({"gravity_mps2": True}), "must be numeric"),
        (lambda payload: payload.update({"deliberation_ticks": True}), "must be an integer"),
        (lambda payload: payload.update({"goal_radius_m": 0}), "invalid scenario"),
    ),
)
def test_rejects_wrongly_typed_or_invalid_scenario_fields(
    tmp_path,
    mutation,
    message,
) -> None:
    root = make_pack(tmp_path)
    path = root / "scenarios" / "demo.json"
    scenario = json.loads(path.read_text(encoding="utf-8"))
    mutation(scenario)
    write_json(path, scenario)
    with pytest.raises(PackError, match=message):
        load_pack(root)


@pytest.mark.parametrize("constant", ("NaN", "Infinity", "-Infinity", "1e999"))
def test_rejects_nonfinite_scenario_numbers(tmp_path, constant) -> None:
    root = make_pack(tmp_path)
    path = root / "scenarios" / "demo.json"
    contents = path.read_text(encoding="utf-8").replace(
        '"gravity_mps2": 5.0',
        f'"gravity_mps2": {constant}',
    )
    path.write_text(contents, encoding="utf-8")
    with pytest.raises(PackError, match="numeric constant|must be finite"):
        load_pack(root)


def test_rejects_missing_scenario_file_and_duplicate_scenario_id(tmp_path) -> None:
    root = make_pack(tmp_path)
    manifest_path = root / "pack.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["scenarios"] = ["missing.json"]
    write_json(manifest_path, manifest)
    with pytest.raises(PackError, match="cannot read JSON"):
        load_pack(root)

    root = make_pack(tmp_path / "duplicate")
    source = root / "scenarios" / "demo.json"
    (root / "scenarios" / "copy.json").write_bytes(source.read_bytes())
    manifest_path = root / "pack.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["scenarios"] = ["demo.json", "copy.json"]
    write_json(manifest_path, manifest)
    with pytest.raises(PackError, match="duplicate scenario_id"):
        load_pack(root)
