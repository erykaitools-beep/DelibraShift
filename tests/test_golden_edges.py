from __future__ import annotations

import json
from pathlib import Path

from chronogym.clock import advance_deliberation, latch_action
from chronogym.types import Action, ScenarioConfig, WindComponent
from chronogym.world import initial_state, step


FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "golden_edges.json").read_text(
        encoding="utf-8"
    )
)


def scenario(edge: dict, scenario_id: str) -> ScenarioConfig:
    shared = FIXTURE["shared"]
    start = edge["start"]
    goal = edge["goal"]
    bounds = shared["bounds"]
    return ScenarioConfig(
        scenario_id=scenario_id,
        seed=101,
        dt_s=shared["dt_s"],
        deliberation_ticks=shared["deliberation_ticks"],
        deadline_tick=edge["deadline_tick"],
        gravity_mps2=shared["gravity_mps2"],
        max_accel_mps2=shared["max_accel_mps2"],
        wind_components=tuple(
            WindComponent(**component) for component in shared["wind_components"]
        ),
        forecast_ticks=40,
        start_pos_x_m=start["pos_x_m"],
        start_pos_y_m=start["pos_y_m"],
        start_vel_x_mps=start["vel_x_mps"],
        start_vel_y_mps=start["vel_y_mps"],
        goal_x_m=goal["x_m"],
        goal_y_m=goal["y_m"],
        goal_radius_m=shared["goal_radius_m"],
        bounds_min_x_m=bounds[0],
        bounds_min_y_m=bounds[1],
        bounds_max_x_m=bounds[2],
        bounds_max_y_m=bounds[3],
    )


def assert_kinematics(state, expected: dict[str, float]) -> None:
    for field, value in expected.items():
        assert getattr(state, field) == value


def test_goal_mid_window_is_exact_and_truncated() -> None:
    edge = FIXTURE["e001_goal_mid_window"]
    config = scenario(edge, "e001")
    window = advance_deliberation(config, initial_state(config))
    assert window.state.tick == edge["event_tick"]
    assert window.state.outcome == edge["outcome"]
    assert window.truncated == edge["cycle0_truncated"]
    assert_kinematics(window.state, edge["final_state"])


def test_above_cap_action_and_second_window_are_exact() -> None:
    edge = FIXTURE["e002_clamped_action"]
    config = scenario(edge, "e002")
    state = advance_deliberation(config, initial_state(config)).state
    raw_x, raw_y = edge["raw_action_window2"]
    state = latch_action(config, state, Action(raw_x, raw_y))
    assert [state.held_accel_x_mps2, state.held_accel_y_mps2] == edge[
        "clamped_action_window2"
    ]
    for tick in range(21, 41):
        state = step(config, state)
        expected = edge["checkpoints"].get(str(tick))
        if expected:
            assert_kinematics(state, expected)


def test_deadline_mid_second_window_is_exact_and_truncated() -> None:
    edge = FIXTURE["e003_deadline_mid_window"]
    config = scenario(edge, "e003")
    first = advance_deliberation(config, initial_state(config))
    assert not first.truncated
    action_x, action_y = edge["engaged_action_window2"]
    state = latch_action(config, first.state, Action(action_x, action_y))
    second = advance_deliberation(config, state)
    assert second.state.tick == edge["event_tick"]
    assert second.state.outcome == edge["outcome"]
    assert second.truncated == edge["cycle1_truncated"]
    assert_kinematics(second.state, edge["final_state"])
