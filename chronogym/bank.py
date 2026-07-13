"""Strict local-directory loader for external ChronoGym test packs."""

from __future__ import annotations

import json
from dataclasses import fields
from pathlib import Path
from typing import Any

from .types import SCHEMA_VERSION, ScenarioConfig, WindComponent
from .world import validate_scenario


class PackError(ValueError):
    """A pack violates the public directory or schema contract."""


_MANIFEST_FIELDS = {"name", "version", "schema_version", "description", "scenarios"}
_SCENARIO_FIELDS = {field.name for field in fields(ScenarioConfig)}
_WIND_FIELDS = {field.name for field in fields(WindComponent)}
_FLOAT_FIELDS = {
    "dt_s",
    "gravity_mps2",
    "max_accel_mps2",
    "start_pos_x_m",
    "start_pos_y_m",
    "start_vel_x_mps",
    "start_vel_y_mps",
    "goal_x_m",
    "goal_y_m",
    "goal_radius_m",
    "bounds_min_x_m",
    "bounds_min_y_m",
    "bounds_max_x_m",
    "bounds_max_y_m",
}
_INTEGER_FIELDS = {"seed", "deliberation_ticks", "deadline_tick", "forecast_ticks"}


def _no_duplicate_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise PackError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=_no_duplicate_object,
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise PackError(f"cannot read JSON {path}: {error}") from error
    if not isinstance(payload, dict):
        raise PackError(f"JSON root must be an object: {path}")
    return payload


def _major_minor(version: object) -> tuple[int, int]:
    if not isinstance(version, str):
        raise PackError("schema_version must be a string")
    parts = version.split(".")
    if len(parts) != 3 or any(not part.isdigit() for part in parts):
        raise PackError(f"invalid schema_version: {version!r}")
    return int(parts[0]), int(parts[1])


def _require_exact_fields(payload: dict[str, Any], expected: set[str], label: str) -> None:
    unknown = sorted(payload.keys() - expected)
    if unknown:
        raise PackError(f"unknown {label} fields: {', '.join(unknown)}")


def _as_float(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PackError(f"{label} must be numeric")
    return float(value)


def _load_scenario(path: Path) -> ScenarioConfig:
    payload = _read_json(path)
    _require_exact_fields(payload, _SCENARIO_FIELDS, "scenario")
    wind_payload = payload.get("wind_components", [])
    if not isinstance(wind_payload, list):
        raise PackError(f"wind_components must be a list: {path}")
    components = []
    for index, component in enumerate(wind_payload):
        if not isinstance(component, dict):
            raise PackError(f"wind component {index} must be an object: {path}")
        _require_exact_fields(component, _WIND_FIELDS, "wind component")
        try:
            components.append(
                WindComponent(
                    **{
                        name: _as_float(component[name], f"wind component {name}")
                        for name in _WIND_FIELDS
                    }
                )
            )
        except (KeyError, TypeError) as error:
            raise PackError(f"invalid wind component {index}: {error}") from error

    axis_tags = payload.get("axis_tags", [])
    if not isinstance(axis_tags, list) or any(not isinstance(tag, str) for tag in axis_tags):
        raise PackError(f"axis_tags must be a list of strings: {path}")
    payload["wind_components"] = tuple(components)
    payload["axis_tags"] = tuple(axis_tags)
    for name in _FLOAT_FIELDS & payload.keys():
        payload[name] = _as_float(payload[name], name)
    for name in _INTEGER_FIELDS & payload.keys():
        value = payload[name]
        if isinstance(value, bool) or not isinstance(value, int):
            raise PackError(f"{name} must be an integer")
    try:
        scenario = ScenarioConfig(**payload)
        validate_scenario(scenario)
    except (TypeError, ValueError) as error:
        raise PackError(f"invalid scenario {path}: {error}") from error
    return scenario


def load_pack(path: str | Path) -> list[ScenarioConfig]:
    """Load one strict v0 pack directory in manifest order."""
    root = Path(path)
    if not root.is_dir():
        raise PackError(f"pack path is not a directory: {root}")
    manifest = _read_json(root / "pack.json")
    _require_exact_fields(manifest, _MANIFEST_FIELDS, "manifest")
    missing = sorted(_MANIFEST_FIELDS - manifest.keys())
    if missing:
        raise PackError(f"missing manifest fields: {', '.join(missing)}")
    if _major_minor(manifest["schema_version"]) != _major_minor(SCHEMA_VERSION):
        raise PackError(
            f"incompatible schema_version {manifest['schema_version']!r}; "
            f"expected {SCHEMA_VERSION!r} major.minor"
        )
    for name in ("name", "version", "description"):
        if not isinstance(manifest[name], str):
            raise PackError(f"manifest {name} must be a string")
    scenario_files = manifest["scenarios"]
    if not isinstance(scenario_files, list) or any(
        not isinstance(name, str) for name in scenario_files
    ):
        raise PackError("manifest scenarios must be a list of filenames")

    scenarios: list[ScenarioConfig] = []
    seen_ids: set[str] = set()
    scenario_root = (root / "scenarios").resolve()
    for filename in scenario_files:
        relative = Path(filename)
        if relative.is_absolute() or len(relative.parts) != 1 or relative.suffix != ".json":
            raise PackError(f"invalid scenario filename: {filename!r}")
        scenario_path = (scenario_root / relative).resolve()
        if scenario_path.parent != scenario_root:
            raise PackError(f"scenario escapes pack directory: {filename!r}")
        scenario = _load_scenario(scenario_path)
        if scenario.scenario_id in seen_ids:
            raise PackError(f"duplicate scenario_id: {scenario.scenario_id}")
        seen_ids.add(scenario.scenario_id)
        scenarios.append(scenario)
    return scenarios
