from __future__ import annotations

import hashlib
import json

from chronogym.agents import NoOpAgent, RandomAgent
from chronogym.demo import demo_scenario
from chronogym.runner import run_episode


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
    assert records[-1]["type"] == "summary"
    assert len(records) == result.cycles + 2
    assert all(line == json.dumps(json.loads(line), sort_keys=True, separators=(",", ":")) for line in lines)
    assert 0.0 <= result.final_state.heat <= 1.0
    assert result.final_state.done
