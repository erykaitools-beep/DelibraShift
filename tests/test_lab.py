from __future__ import annotations

import json
from pathlib import Path

import pytest

from delibrashift.desktop import DesktopAPI, resolve_pack_path
from delibrashift.lab import LAB_SCHEMA_VERSION, LabEngine


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "packs" / "core_v0"


@pytest.fixture()
def engine() -> LabEngine:
    return LabEngine(PACK)


def test_catalog_is_ordered_and_discloses_privileged_agent(engine: LabEngine) -> None:
    catalog = engine.catalog()

    assert catalog["schema_version"] == LAB_SCHEMA_VERSION
    assert catalog["status"] == "coming-soon"
    assert catalog["pack"]["name"] == "core_v0"
    assert catalog["scenarios"][0]["id"] == "g001"
    assert catalog["scenarios"][-1]["id"] == "g010"
    oracle = next(agent for agent in catalog["agents"] if agent["id"] == "oracle")
    assert oracle["kind"] == "privileged ceiling"


def test_run_is_repeatable_and_trace_reaches_canonical_final_state(
    engine: LabEngine,
) -> None:
    first = engine.run("g001", "lead-greedy", 0)
    first_log = engine.last_result.log_bytes
    second = engine.run("g001", "lead-greedy", 0)

    assert first == second
    assert first_log == engine.last_result.log_bytes
    assert first["summary"]["outcome"] == "goal"
    assert first["trajectory"][0]["tick"] == 0
    assert first["trajectory"][-1]["tick"] == first["summary"]["final_tick"]
    assert len(first["trajectory"]) == first["summary"]["final_tick"] + 1
    assert first["decisions"][0]["tick"] == 0
    assert first["decisions"][0]["engage_tick"] == 20


def test_masked_goal_stays_masked_in_agent_observation(engine: LabEngine) -> None:
    masked_id = next(
        item["id"] for item in engine.catalog()["scenarios"] if not item["goal_visible"]
    )
    run = engine.run(masked_id, "greedy")

    assert run["scenario"]["goal_visible"] is False
    assert run["decisions"][0]["observation"]["goal_x_m"] is None
    assert run["decisions"][0]["observation"]["goal_y_m"] is None
    assert run["decisions"][0]["observation"]["heat"] > 0.0


def test_random_repetition_is_deterministic_but_distinct(engine: LabEngine) -> None:
    zero = engine.run("g001", "random", 0)
    one = engine.run("g001", "random", 1)
    zero_again = engine.run("g001", "random", 0)

    assert zero == zero_again
    assert zero["decisions"][0]["returned_action"] != one["decisions"][0]["returned_action"]


@pytest.mark.parametrize(
    ("scenario", "agent", "repetition", "message"),
    [
        ("missing", "noop", 0, "unknown scenario"),
        ("g001", "missing", 0, "unknown agent"),
        ("g001", "noop", -1, "non-negative"),
        ("g001", "noop", True, "integer"),
    ],
)
def test_invalid_run_selection_is_rejected(
    engine: LabEngine,
    scenario: str,
    agent: str,
    repetition: int,
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        engine.run(scenario, agent, repetition)


def test_export_preserves_runner_bytes(engine: LabEngine, tmp_path: Path) -> None:
    engine.run("g001", "noop")
    expected = engine.last_result.log_bytes

    output = engine.export_last_run(tmp_path / "nested" / "episode.jsonl")

    assert output.read_bytes() == expected
    assert output.read_bytes().endswith(b"\n")
    assert json.loads(output.read_text(encoding="utf-8").splitlines()[0])["type"] == "manifest"


def test_desktop_api_is_a_thin_json_safe_bridge(engine: LabEngine) -> None:
    api = DesktopAPI(engine)

    assert api.catalog()["pack"]["name"] == "core_v0"
    assert api.save_last_run()["error"] == "Run an episode before exporting."
    payload = api.run_scenario("g001", "noop")
    json.dumps(payload, allow_nan=False)
    assert payload["agent"]["id"] == "noop"


def test_pack_resolution_finds_checkout_and_honors_explicit_path() -> None:
    assert resolve_pack_path() == PACK.resolve()
    assert resolve_pack_path(PACK) == PACK.resolve()


def test_run_json_is_compact_and_round_trips(engine: LabEngine) -> None:
    encoded = engine.run_json("g001", "noop")
    assert "\n" not in encoded
    assert json.loads(encoded)["episode_id"] == "g001:42:noop"
