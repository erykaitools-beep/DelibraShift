from __future__ import annotations

import json
import math
from dataclasses import replace
from pathlib import Path

from chronogym.demo import demo_scenario
from chronogym.oracle import LeadGreedyAgent, oracle_action
from chronogym.types import GroundTruthState, ScenarioConfig, WindComponent
from chronogym.world import build_observation, initial_state


def golden_scenario() -> tuple[dict, ScenarioConfig]:
    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "golden_g001.json").read_text(
            encoding="utf-8"
        )
    )
    payload = fixture["scenario"]
    payload["wind_components"] = tuple(
        WindComponent(**component) for component in payload["wind_components"]
    )
    payload["axis_tags"] = tuple(payload["axis_tags"])
    return fixture, ScenarioConfig(**payload)


def test_lead_greedy_prediction_reproduces_observable_golden_target_exactly() -> None:
    fixture, config = golden_scenario()
    observation = build_observation(
        config,
        initial_state(config),
        episode_id="lead",
        cycle=0,
    )
    prediction = LeadGreedyAgent().act(observation).prediction
    target = fixture["prediction_target_cycle0"]
    assert prediction is not None
    assert prediction.pos_x_m == target["pos_x_m"]
    assert prediction.pos_y_m == target["pos_y_m"]
    assert prediction.vel_x_mps == target["vel_x_mps"]
    assert prediction.vel_y_mps == target["vel_y_mps"]


def test_pinned_oracle_is_deterministic_and_clamped() -> None:
    config = demo_scenario()
    state = initial_state(config)
    first = oracle_action(config, state, cycle=0, variant=0)
    second = oracle_action(config, state, cycle=0, variant=0)
    counterfactual = oracle_action(config, state, cycle=0, variant=1)
    assert first == second
    assert first == counterfactual
    moved = replace(state, pos_x_m=state.pos_x_m + 1.0)
    assert oracle_action(config, moved, cycle=0, variant=1) != first
    assert math.hypot(first.accel_x_mps2, first.accel_y_mps2) <= (
        config.max_accel_mps2 + 1e-12
    )


def test_golden_oracle_rows_are_binary64_exact() -> None:
    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "golden_oracle.json").read_text(
            encoding="utf-8"
        )
    )
    pack_root = Path(__file__).parents[1] / "packs" / "core_v0"
    from chronogym.bank import load_pack

    scenarios = {config.scenario_id: config for config in load_pack(pack_root)}
    for row in fixture["rows"]:
        config = scenarios[row["scenario_id"]]
        values = row["state"]
        distance = math.hypot(
            values["pos_x_m"] - config.goal_x_m,
            values["pos_y_m"] - config.goal_y_m,
        )
        state = GroundTruthState(
            tick=row["t0_tick"],
            pos_x_m=values["pos_x_m"],
            pos_y_m=values["pos_y_m"],
            vel_x_mps=values["vel_x_mps"],
            vel_y_mps=values["vel_y_mps"],
            wind_x_mps2=0.0,
            held_accel_x_mps2=0.0,
            held_accel_y_mps2=0.0,
            distance_to_goal_m=distance,
            heat=math.exp(-distance / 20.0),
        )
        action = oracle_action(
            config,
            state,
            cycle=row["cycle"],
            variant=row["variant"],
        )
        assert action.accel_x_mps2 == row["expected_action"]["accel_x_mps2"]
        assert action.accel_y_mps2 == row["expected_action"]["accel_y_mps2"]
