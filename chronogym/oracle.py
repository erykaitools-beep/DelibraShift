"""Pinned deterministic sampling-MPC oracle from SPEC section 4.2.1."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from functools import lru_cache

from .agents import arrival_action, persistence_prediction
from .clock import latch_action
from .types import (
    HEAT_SCALE_M,
    NOOP_ACTION,
    TWO_PI,
    Action,
    AgentReply,
    GroundTruthState,
    Observation,
    Prediction,
    ScenarioConfig,
    clamp_accel,
)
from .world import step


Plan = tuple[Action, ...]


@dataclass(frozen=True)
class _Candidate:
    plan: Plan
    objective: float
    index: int


def _greedy_for_state(config: ScenarioConfig, state: GroundTruthState) -> Action:
    return arrival_action(
        pos_x_m=state.pos_x_m,
        pos_y_m=state.pos_y_m,
        vel_x_mps=state.vel_x_mps,
        vel_y_mps=state.vel_y_mps,
        goal_x_m=config.goal_x_m,
        goal_y_m=config.goal_y_m,
        gravity_mps2=config.gravity_mps2,
    )


def _rollout_objective(
    config: ScenarioConfig,
    start: GroundTruthState,
    plan: Plan,
) -> float:
    state = start
    start_tick = start.tick
    min_distance = start.distance_to_goal_m
    for action in plan:
        state = latch_action(config, state, action)
        for _ in range(config.deliberation_ticks):
            if state.done:
                break
            state = step(config, state)
            min_distance = min(min_distance, state.distance_to_goal_m)
        if state.done:
            break
    success = state.outcome == "goal"
    objective = (
        5.0 * float(success)
        + math.exp(-min_distance / HEAT_SCALE_M)
        + 0.5 * math.exp(-state.distance_to_goal_m / HEAT_SCALE_M)
    )
    if success:
        objective -= 0.02 * (state.tick - start_tick) / config.deliberation_ticks
    return objective


def _rank(candidates: list[_Candidate]) -> list[_Candidate]:
    return sorted(candidates, key=lambda candidate: (-candidate.objective, candidate.index))


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _population_sigma(values: list[float], mean: float) -> float:
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    return max(math.sqrt(variance), 0.5)


@lru_cache(maxsize=4096)
def oracle_action(
    config: ScenarioConfig,
    state: GroundTruthState,
    *,
    cycle: int,
    variant: int,
) -> Action:
    """Return the pinned elite-mean first action for one oracle invocation."""
    if state.done:
        return NOOP_ACTION
    if variant not in (0, 1):
        raise ValueError("oracle variant must be 0 or 1")
    rng = random.Random(config.seed * 1_000_003 + cycle * 8_191)
    engage_tick = state.tick if variant == 0 else state.tick + config.deliberation_ticks
    remaining = config.deadline_tick - engage_tick
    horizon = min(6, max(1, math.ceil(remaining / config.deliberation_ticks)))
    noop_plan = (NOOP_ACTION,) * horizon
    greedy_plan = (_greedy_for_state(config, state),) * horizon
    plans: list[Plan] = [noop_plan, greedy_plan]
    for _ in range(256):
        actions = []
        for _ in range(horizon):
            theta = rng.uniform(0.0, TWO_PI)
            radius = config.max_accel_mps2 * math.sqrt(rng.random())
            actions.append(Action(radius * math.cos(theta), radius * math.sin(theta)))
        plans.append(tuple(actions))
    ranked = _rank(
        [
            _Candidate(plan, _rollout_objective(config, state, plan), index)
            for index, plan in enumerate(plans)
        ]
    )

    for _ in range(3):
        elites = ranked[:16]
        means: list[tuple[float, float]] = []
        sigmas: list[tuple[float, float]] = []
        for window in range(horizon):
            x_values = [elite.plan[window].accel_x_mps2 for elite in elites]
            y_values = [elite.plan[window].accel_y_mps2 for elite in elites]
            mean_x = _mean(x_values)
            mean_y = _mean(y_values)
            means.append((mean_x, mean_y))
            sigmas.append(
                (
                    _population_sigma(x_values, mean_x),
                    _population_sigma(y_values, mean_y),
                )
            )
        candidates = [
            _Candidate(elite.plan, elite.objective, index)
            for index, elite in enumerate(elites)
        ]
        for index in range(16, 272):
            actions = []
            for window in range(horizon):
                mean_x, mean_y = means[window]
                sigma_x, sigma_y = sigmas[window]
                raw_x = rng.gauss(mean_x, sigma_x)
                raw_y = rng.gauss(mean_y, sigma_y)
                accel_x, accel_y = clamp_accel(
                    raw_x,
                    raw_y,
                    config.max_accel_mps2,
                )
                actions.append(Action(accel_x, accel_y))
            plan = tuple(actions)
            candidates.append(
                _Candidate(plan, _rollout_objective(config, state, plan), index)
            )
        ranked = _rank(candidates)

    final_elites = ranked[:16]
    mean_x = _mean([elite.plan[0].accel_x_mps2 for elite in final_elites])
    mean_y = _mean([elite.plan[0].accel_y_mps2 for elite in final_elites])
    accel_x, accel_y = clamp_accel(mean_x, mean_y, config.max_accel_mps2)
    return Action(accel_x, accel_y)


def state_from_observation(
    config: ScenarioConfig,
    observation: Observation,
) -> GroundTruthState:
    distance = math.hypot(
        observation.pos_x_m - config.goal_x_m,
        observation.pos_y_m - config.goal_y_m,
    )
    return GroundTruthState(
        tick=observation.tick,
        pos_x_m=observation.pos_x_m,
        pos_y_m=observation.pos_y_m,
        vel_x_mps=observation.vel_x_mps,
        vel_y_mps=observation.vel_y_mps,
        wind_x_mps2=observation.wind_now_x_mps2,
        held_accel_x_mps2=observation.held_accel_x_mps2,
        held_accel_y_mps2=observation.held_accel_y_mps2,
        distance_to_goal_m=distance,
        heat=observation.heat,
    )


def prediction_from_state(state: GroundTruthState) -> Prediction:
    return Prediction(
        pos_x_m=state.pos_x_m,
        pos_y_m=state.pos_y_m,
        vel_x_mps=state.vel_x_mps,
        vel_y_mps=state.vel_y_mps,
    )


class OracleAgent:
    """Privileged ceiling that plans from the true engage-time state."""

    name = "oracle"

    def __init__(self, config: ScenarioConfig) -> None:
        self.config = config

    def act(self, observation: Observation) -> AgentReply:
        state = state_from_observation(self.config, observation)
        for _ in range(observation.deliberation_ticks):
            if state.done:
                break
            state = step(self.config, state)
        action = oracle_action(
            self.config,
            state,
            cycle=observation.cycle,
            variant=0,
        )
        return AgentReply(action=action, prediction=prediction_from_state(state))


class StaleReactorAgent:
    """Diagnostic that plans at observed time as if its action engaged now."""

    name = "stale-reactor"

    def __init__(self, config: ScenarioConfig) -> None:
        self.config = config

    def act(self, observation: Observation) -> AgentReply:
        state = state_from_observation(self.config, observation)
        action = oracle_action(
            self.config,
            state,
            cycle=observation.cycle,
            variant=1,
        )
        return AgentReply(action=action, prediction=persistence_prediction(observation))


def predict_engage_from_observation(observation: Observation) -> Prediction:
    """Propagate exactly B ticks using only prediction-safe observation fields."""
    pos_x = observation.pos_x_m
    pos_y = observation.pos_y_m
    vel_x = observation.vel_x_mps
    vel_y = observation.vel_y_mps
    for offset in range(observation.deliberation_ticks):
        accel_x = (
            observation.held_accel_x_mps2
            + observation.wind_forecast_x_mps2[offset]
        )
        accel_y = observation.held_accel_y_mps2 - observation.gravity_mps2
        vel_x += accel_x * observation.dt_s
        vel_y += accel_y * observation.dt_s
        pos_x += vel_x * observation.dt_s
        pos_y += vel_y * observation.dt_s
    return Prediction(pos_x, pos_y, vel_x, vel_y)


class LeadGreedyAgent:
    """Diagnostic arrival controller evaluated at the observable engage state."""

    name = "lead-greedy"

    def act(self, observation: Observation) -> AgentReply:
        predicted = predict_engage_from_observation(observation)
        if observation.goal_x_m is None or observation.goal_y_m is None:
            return AgentReply(action=NOOP_ACTION, prediction=predicted)
        action = arrival_action(
            pos_x_m=predicted.pos_x_m,
            pos_y_m=predicted.pos_y_m,
            vel_x_mps=predicted.vel_x_mps,
            vel_y_mps=predicted.vel_y_mps,
            goal_x_m=observation.goal_x_m,
            goal_y_m=observation.goal_y_m,
            gravity_mps2=observation.gravity_mps2,
        )
        return AgentReply(action=action, prediction=predicted)
