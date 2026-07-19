from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from delibrashift.clock import advance_deliberation, latch_action
from delibrashift.types import (
    Action,
    OUTCOME_GOAL,
    OUTCOME_OOB,
    OUTCOME_TIMEOUT,
    Prediction,
    SCHEMA_VERSION,
    ScenarioConfig,
    WindComponent,
    prediction_error,
    prediction_fidelity,
    wind_x_at,
)
from delibrashift.world import build_observation, initial_state, step


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "golden_g001.json"


def load_golden() -> tuple[dict[str, object], ScenarioConfig]:
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    raw = dict(fixture["scenario"])
    raw["wind_components"] = tuple(
        WindComponent(**component) for component in raw["wind_components"]
    )
    raw["axis_tags"] = tuple(raw["axis_tags"])
    return fixture, ScenarioConfig(**raw)


def assert_kinematics(state: object, expected: dict[str, float]) -> None:
    for field, value in expected.items():
        assert getattr(state, field) == value


def test_golden_wind_and_initial_observation_are_exact() -> None:
    fixture, config = load_golden()
    assert fixture["schema_version"] == SCHEMA_VERSION
    for tick, expected in fixture["wind_spot_checks"].items():
        assert wind_x_at(config.wind_components, int(tick)) == expected

    state = initial_state(config)
    observation = build_observation(
        config,
        state,
        episode_id="golden",
        cycle=0,
    )
    for field, expected in fixture["observation_tick0"].items():
        assert getattr(observation, field) == expected


def test_golden_integrator_windows_are_exact() -> None:
    fixture, config = load_golden()
    state = initial_state(config)
    first_checkpoints = fixture["window1_noop_held"]["checkpoints"]
    for tick in range(1, 21):
        state = step(config, state)
        if str(tick) in first_checkpoints:
            assert_kinematics(state, first_checkpoints[str(tick)])

    target = fixture["prediction_target_cycle0"]
    assert state.tick == target["target_tick"]
    assert state.pos_x_m == target["pos_x_m"]
    assert state.pos_y_m == target["pos_y_m"]
    assert state.vel_x_mps == target["vel_x_mps"]
    assert state.vel_y_mps == target["vel_y_mps"]
    assert state.distance_to_goal_m == target["distance_to_goal_m"]
    assert state.heat == target["heat"]

    state = latch_action(config, state, Action(3.0, 12.0))
    second_checkpoints = fixture["window2_engaged_action"]["checkpoints"]
    for tick in range(21, 41):
        state = step(config, state)
        if str(tick) in second_checkpoints:
            assert_kinematics(state, second_checkpoints[str(tick)])


def test_golden_prediction_metrics_are_exact() -> None:
    fixture, config = load_golden()
    target = advance_deliberation(config, initial_state(config)).state
    prediction = Prediction(**fixture["fidelity_example"]["prediction"])
    assert prediction_error(prediction, target) == fixture["fidelity_example"][
        "expected_normalized_error"
    ]
    assert prediction_fidelity(prediction, target) == fixture["fidelity_example"][
        "expected_fidelity"
    ]

    persistence = Prediction(
        pos_x_m=config.start_pos_x_m,
        pos_y_m=config.start_pos_y_m,
        vel_x_mps=config.start_vel_x_mps,
        vel_y_mps=config.start_vel_y_mps,
    )
    assert prediction_error(persistence, target) == fixture["persistence_baseline"][
        "expected_normalized_error"
    ]
    assert prediction_fidelity(persistence, target) == fixture["persistence_baseline"][
        "expected_fidelity"
    ]


def test_deliberation_clock_latches_only_after_fixed_window() -> None:
    fixture, config = load_golden()
    state = initial_state(config)
    window = advance_deliberation(config, state)
    assert window.ticks_elapsed == config.deliberation_ticks
    assert not window.truncated
    assert window.state.held_accel_x_mps2 == 0.0
    assert window.state.held_accel_y_mps2 == 0.0

    engaged = latch_action(config, window.state, Action(30.0, 0.0))
    assert engaged.tick == window.state.tick
    assert engaged.held_accel_x_mps2 == config.max_accel_mps2
    assert engaged.held_accel_y_mps2 == 0.0


def test_masked_goal_keeps_hot_cold_signal() -> None:
    _, config = load_golden()
    config = replace(config, goal_visible=False)
    state = initial_state(config)
    observation = build_observation(config, state, episode_id="masked", cycle=0)
    assert observation.goal_x_m is None
    assert observation.goal_y_m is None
    assert observation.distance_to_goal_m is None
    assert 0.0 < observation.heat < 1.0
    assert observation.heat_delta == 0.0


def test_terminal_event_order_is_goal_then_oob_then_timeout() -> None:
    _, base = load_golden()
    goal_and_oob = replace(
        base,
        dt_s=1.0,
        deadline_tick=1,
        bounds_max_x_m=1.0,
        start_pos_x_m=0.9,
        start_pos_y_m=0.5,
        start_vel_x_mps=0.2,
        start_vel_y_mps=0.0,
        goal_x_m=1.1,
        goal_y_m=-9.31,
        goal_radius_m=0.01,
        gravity_mps2=9.81,
        wind_components=(),
    )
    assert step(goal_and_oob, initial_state(goal_and_oob)).outcome == OUTCOME_GOAL

    oob_and_timeout = replace(goal_and_oob, goal_x_m=50.0, goal_y_m=50.0)
    assert step(oob_and_timeout, initial_state(oob_and_timeout)).outcome == OUTCOME_OOB

    timeout = replace(
        oob_and_timeout,
        bounds_max_x_m=100.0,
        bounds_min_y_m=-100.0,
        bounds_max_y_m=100.0,
    )
    assert step(timeout, initial_state(timeout)).outcome == OUTCOME_TIMEOUT


def test_terminal_mid_window_marks_deliberation_target_truncated() -> None:
    _, config = load_golden()
    config = replace(config, deadline_tick=7)
    window = advance_deliberation(config, initial_state(config))
    assert window.state.tick == 7
    assert window.state.outcome == OUTCOME_TIMEOUT
    assert window.ticks_elapsed == 7
    assert window.truncated
