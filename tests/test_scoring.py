from __future__ import annotations

from dataclasses import replace
import math

from delibrashift.agents import NoOpAgent
from delibrashift.demo import demo_scenario
from delibrashift.runner import run_episode
from delibrashift.scoring import (
    score_prediction_fidelity,
    score_outcome,
    score_episode,
    score_temporal_anticipation,
)
from delibrashift.types import Action, AgentReply, NOOP_ACTION, ScenarioConfig


def test_prediction_score_matches_each_valid_cycle_and_persistence_floor() -> None:
    result = run_episode(demo_scenario(), NoOpAgent())
    score = score_prediction_fidelity(result.records)
    assert score.n_cycles == result.cycles
    assert score.n_valid_prediction_cycles == sum(
        not record.truncated for record in result.records
    )
    assert score.prediction_fidelity == score.persistence_floor_fidelity
    assert score.action_parse_rate == 1.0
    assert score.prediction_parse_rate == 1.0
    assert score.prediction_coverage == 1.0
    assert score.fidelity_invalid_reason is None
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
            prediction_parse_failed=True,
        ),
    )
    truncated = replace(first, prediction_target=None, truncated=True)
    score = score_prediction_fidelity((failed, truncated))
    assert score.prediction_fidelity is None
    assert score.action_parse_rate == 0.5
    assert score.prediction_parse_rate == 0.5
    assert score.prediction_coverage == 0.0
    assert score.fidelity_invalid_reason == "insufficient_coverage"
    assert score.n_valid_prediction_cycles == 0
    assert score.persistence_floor_fidelity is None


def test_valid_prediction_survives_action_parse_failure() -> None:
    first = run_episode(demo_scenario(), NoOpAgent()).records[0]
    action_failed = replace(
        first,
        reply=replace(first.reply, parse_failed=True),
    )
    score = score_prediction_fidelity((action_failed,) * 3)
    assert score.prediction_fidelity is not None
    assert score.prediction_coverage == 1.0
    assert score.action_parse_rate == 0.0
    assert score.n_valid_prediction_cycles == 3


def test_fidelity_requires_three_valid_cycles_even_at_full_coverage() -> None:
    records = run_episode(demo_scenario(), NoOpAgent()).records[:2]
    score = score_prediction_fidelity(records)
    assert score.prediction_coverage == 1.0
    assert score.prediction_fidelity is None
    assert score.fidelity_invalid_reason == "too_few_cycles"


def test_empty_prediction_score_is_explicitly_unmeasurable() -> None:
    score = score_prediction_fidelity(())
    assert score.prediction_fidelity is None
    assert score.persistence_floor_fidelity is None
    assert score.action_parse_rate == 0.0
    assert score.prediction_parse_rate == 0.0
    assert score.fidelity_invalid_reason == "not_requested"


def test_temporal_score_uses_engage_vs_observed_oracle_margin(monkeypatch) -> None:
    config = demo_scenario()
    record = run_episode(config, NoOpAgent()).records[0]
    record = replace(
        record,
        engaged_action=Action(10.0, 0.0),
        action_engaged=True,
    )

    def fake_oracle(config, state, *, cycle, variant):
        return Action(10.0, 0.0) if variant == 0 else Action(0.0, 0.0)

    monkeypatch.setattr("delibrashift.scoring.oracle_action", fake_oracle)
    score = score_temporal_anticipation(config, (record,))
    assert score.temporal_anticipation == 2.0 / 3.0
    assert score.mean_divergence_weight == 1.0 / 3.0
    assert score.n_scored_cycles == 1


def test_temporal_score_excludes_action_parse_failures_and_masked_goals() -> None:
    config = demo_scenario()
    record = run_episode(config, NoOpAgent()).records[0]
    failed = replace(record, reply=replace(record.reply, parse_failed=True))
    assert score_temporal_anticipation(config, (failed,)).temporal_anticipation is None
    masked = replace(config, goal_visible=False)
    assert score_temporal_anticipation(masked, (record,)).temporal_anticipation is None


def test_outcome_score_tracks_tick_level_closest_approach() -> None:
    config = demo_scenario()
    result = run_episode(config, NoOpAgent())
    assert result.closest_approach_m <= result.records[0].observation.distance_to_goal_m
    assert score_outcome(config, result) == 0.4 * math.exp(
        -result.closest_approach_m / 20.0
    )


def test_success_outcome_includes_speed_bonus() -> None:
    config = ScenarioConfig(
        scenario_id="success",
        seed=1,
        dt_s=1.0,
        deliberation_ticks=2,
        deadline_tick=10,
        gravity_mps2=0.0,
        max_accel_mps2=1.0,
        forecast_ticks=2,
        start_pos_x_m=0.0,
        start_pos_y_m=0.0,
        start_vel_x_mps=1.0,
        start_vel_y_mps=0.0,
        goal_x_m=1.0,
        goal_y_m=0.0,
        goal_radius_m=0.1,
        bounds_min_x_m=-10.0,
        bounds_min_y_m=-10.0,
        bounds_max_x_m=10.0,
        bounds_max_y_m=10.0,
    )
    result = run_episode(config, NoOpAgent())
    assert result.final_state.outcome == "goal"
    assert result.closest_approach_m == 0.0
    assert score_outcome(config, result) == 0.99


def test_episode_scores_match_contract_shape_without_forcing_temporal_mpc() -> None:
    config = demo_scenario()
    result = run_episode(config, NoOpAgent())
    scores = score_episode(config, result)
    assert scores.prediction_coverage == 1.0
    assert scores.action_parse_rate == 1.0
    assert scores.prediction_parse_rate == 1.0
    assert scores.n_cycles == result.cycles
    assert scores.temporal_anticipation is None
    assert scores.outcome == score_outcome(config, result)
    assert scores.wall_clock_ms_telemetry_only == 0.0
