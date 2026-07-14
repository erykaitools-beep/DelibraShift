from __future__ import annotations

import math
from dataclasses import replace

from chronogym.agents import GreedyAgent, RandomAgent, arrival_action
from chronogym.clock import latch_action
from chronogym.demo import demo_scenario
from chronogym.runner import run_episode
from chronogym.world import build_observation, initial_state


def test_arrival_law_returns_raw_command_and_latch_clamps_exactly_once() -> None:
    config = demo_scenario()
    raw = arrival_action(
        pos_x_m=20.0,
        pos_y_m=70.0,
        vel_x_mps=-20.0,
        vel_y_mps=20.0,
        goal_x_m=80.0,
        goal_y_m=30.0,
        gravity_mps2=config.gravity_mps2,
    )
    assert math.hypot(raw.accel_x_mps2, raw.accel_y_mps2) > config.max_accel_mps2
    engaged = latch_action(config, initial_state(config), raw)
    assert math.hypot(
        engaged.held_accel_x_mps2,
        engaged.held_accel_y_mps2,
    ) <= config.max_accel_mps2 + 1e-12


def test_visible_greedy_is_arrival_steering_with_gravity_feedforward() -> None:
    config = demo_scenario()
    observation = build_observation(
        config,
        initial_state(config),
        episode_id="visible",
        cycle=0,
    )
    reply = GreedyAgent().act(observation)
    norm = math.hypot(reply.action.accel_x_mps2, reply.action.accel_y_mps2)
    assert norm < config.max_accel_mps2
    assert reply.action.accel_x_mps2 > 0.0
    assert reply.action.accel_y_mps2 < 0.0
    assert reply.prediction is not None
    assert reply.prediction.pos_x_m == observation.pos_x_m


def test_masked_greedy_bootstraps_two_orthogonal_probes() -> None:
    config = replace(demo_scenario(), goal_visible=False)
    observation = build_observation(
        config,
        initial_state(config),
        episode_id="masked",
        cycle=0,
    )
    agent = GreedyAgent()
    first = agent.act(observation).action
    second = agent.act(
        replace(
            observation,
            cycle=1,
            pos_x_m=observation.pos_x_m + 1.0,
            vel_x_mps=1.0,
            heat_delta=0.01,
        )
    ).action
    assert first.accel_x_mps2 == 7.199999999999999
    assert first.accel_y_mps2 == config.gravity_mps2
    assert second.accel_x_mps2 < 0.0
    assert second.accel_y_mps2 > first.accel_y_mps2


def test_greedy_baseline_is_byte_reproducible() -> None:
    config = demo_scenario()
    first = run_episode(config, GreedyAgent()).log_bytes
    second = run_episode(config, GreedyAgent()).log_bytes
    assert first == second


def test_random_repetition_changes_seed_stream_reproducibly() -> None:
    config = demo_scenario()
    rep_zero = run_episode(config, RandomAgent(config.seed, repetition=0)).log_bytes
    rep_one = run_episode(config, RandomAgent(config.seed, repetition=1)).log_bytes
    assert rep_zero != rep_one
    assert rep_one == run_episode(
        config,
        RandomAgent(config.seed, repetition=1),
    ).log_bytes
