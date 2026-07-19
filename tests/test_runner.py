from __future__ import annotations

import hashlib
import json
import platform
from dataclasses import replace

from delibrashift.agents import GreedyAgent, NoOpAgent, RandomAgent
from delibrashift.demo import demo_scenario
from delibrashift.runner import load_episode_result, run_episode
from delibrashift.types import NOOP_ACTION, SCHEMA_VERSION


def test_same_seed_random_runs_have_byte_identical_whole_logs(tmp_path) -> None:
    config = demo_scenario()
    paths = (tmp_path / "first.jsonl", tmp_path / "second.jsonl")
    for path in paths:
        with path.open("wb") as stream:
            run_episode(config, RandomAgent(config.seed), stream=stream)

    first = paths[0].read_bytes()
    second = paths[1].read_bytes()
    assert hashlib.sha256(first).digest() == hashlib.sha256(second).digest()
    assert first == second


def test_episode_log_is_canonical_jsonl_with_graded_final_state() -> None:
    result = run_episode(demo_scenario(), NoOpAgent())
    lines = result.log_bytes.decode("utf-8").splitlines()
    records = [json.loads(line) for line in lines]

    assert records[0]["type"] == "manifest"
    assert records[0]["schema_version"] == SCHEMA_VERSION
    assert records[0]["scenario_ids"] == ["demo_g001"]
    assert records[0]["host_class"]
    assert records[-1]["type"] == "summary"
    assert len(records) == result.cycles + 2
    assert all(line == json.dumps(json.loads(line), sort_keys=True, separators=(",", ":")) for line in lines)
    assert 0.0 <= result.final_state.heat <= 1.0
    assert result.final_state.done
    cycle = records[1]
    assert cycle["episode_id"] == result.episode_id
    assert cycle["tick"] == cycle["observation"]["tick"]
    assert cycle["engage_tick"] == (
        cycle["tick"] + cycle["observation"]["deliberation_ticks"]
    )
    assert cycle["raw_completion_text"] is None
    assert cycle["raw_completions"] == []
    assert cycle["wall_clock_ms_telemetry_only"] == 0.0
    assert cycle["engaged_action"] is not None


def test_probe_records_reply_but_forces_engaged_noop() -> None:
    config = replace(
        demo_scenario(),
        axis_tags=("probe:format",),
        deadline_tick=21,
    )
    result = run_episode(config, GreedyAgent())
    first = result.records[0]
    assert first.reply.action != NOOP_ACTION
    assert first.engaged_action == NOOP_ACTION


def test_completed_canonical_log_round_trips_for_resume(tmp_path) -> None:
    config = demo_scenario()
    agent = NoOpAgent()
    result = run_episode(config, agent)
    path = tmp_path / "episode.jsonl"
    path.write_bytes(result.log_bytes)

    loaded = load_episode_result(
        path,
        scenario_id=config.scenario_id,
        agent_name=agent.name,
        prompt_version="typed-local-v1",
        pack_name=None,
        pack_version=None,
        host_class=platform.machine() or "unknown",
        scenario_ids=(config.scenario_id,),
    )
    assert loaded == result
