from __future__ import annotations

from dataclasses import replace

from chronogym.agents import NoOpAgent
from chronogym.demo import demo_scenario
from chronogym.runner import run_episode
from chronogym.scoring import score_prediction_fidelity
from chronogym.types import AgentReply, NOOP_ACTION


def test_prediction_score_matches_each_valid_cycle_and_persistence_floor() -> None:
    result = run_episode(demo_scenario(), NoOpAgent())
    score = score_prediction_fidelity(result.records)
    assert score.total_cycles == result.cycles
    assert score.valid_prediction_cycles == sum(
        not record.truncated for record in result.records
    )
    assert score.prediction_fidelity == score.persistence_floor
    assert score.parse_rate == 1.0
    assert score.prediction_fidelity is not None
    assert 0.0 < score.prediction_fidelity < 1.0


def test_prediction_score_excludes_missing_and_truncated_targets() -> None:
    result = run_episode(demo_scenario(), NoOpAgent())
    first = result.records[0]
    failed = replace(
        first,
        reply=AgentReply(
            action=NOOP_ACTION,
            prediction=None,
            parse_failed=True,
            parse_retries=2,
        ),
    )
    truncated = replace(first, prediction_target=None, truncated=True)
    score = score_prediction_fidelity((failed, truncated))
    assert score.prediction_fidelity is None
    assert score.parse_rate == 0.5
    assert score.valid_prediction_cycles == 0
    assert score.persistence_floor is not None


def test_empty_prediction_score_is_explicitly_unmeasurable() -> None:
    score = score_prediction_fidelity(())
    assert score.prediction_fidelity is None
    assert score.persistence_floor is None
    assert score.parse_rate == 0.0
