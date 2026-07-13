"""Pure Windrift physics and observation construction."""

from __future__ import annotations

import math

from .types import (
    OUTCOME_GOAL,
    OUTCOME_OOB,
    OUTCOME_TIMEOUT,
    SCHEMA_VERSION,
    GroundTruthState,
    Observation,
    ScenarioConfig,
    heat_from_distance,
    wind_x_at,
)


def validate_scenario(config: ScenarioConfig) -> None:
    """Reject scenarios that cannot satisfy the v0 contract."""
    if not isinstance(config.scenario_id, str) or not config.scenario_id:
        raise ValueError("scenario_id must not be empty")
    integer_fields = {
        "seed": config.seed,
        "deliberation_ticks": config.deliberation_ticks,
        "deadline_tick": config.deadline_tick,
        "forecast_ticks": config.forecast_ticks,
    }
    for name, value in integer_fields.items():
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f"{name} must be an integer")
    if not isinstance(config.goal_visible, bool):
        raise ValueError("goal_visible must be a boolean")
    if not isinstance(config.axis_tags, tuple) or any(
        not isinstance(tag, str) for tag in config.axis_tags
    ):
        raise ValueError("axis_tags must be a tuple of strings")

    float_fields = {
        "dt_s": config.dt_s,
        "gravity_mps2": config.gravity_mps2,
        "max_accel_mps2": config.max_accel_mps2,
        "start_pos_x_m": config.start_pos_x_m,
        "start_pos_y_m": config.start_pos_y_m,
        "start_vel_x_mps": config.start_vel_x_mps,
        "start_vel_y_mps": config.start_vel_y_mps,
        "goal_x_m": config.goal_x_m,
        "goal_y_m": config.goal_y_m,
        "goal_radius_m": config.goal_radius_m,
        "bounds_min_x_m": config.bounds_min_x_m,
        "bounds_min_y_m": config.bounds_min_y_m,
        "bounds_max_x_m": config.bounds_max_x_m,
        "bounds_max_y_m": config.bounds_max_y_m,
    }
    for name, value in float_fields.items():
        if not isinstance(value, float) or not math.isfinite(value):
            raise ValueError(f"{name} must be a finite float")
    if not math.isfinite(config.dt_s) or config.dt_s <= 0.0:
        raise ValueError("dt_s must be finite and positive")
    if config.deliberation_ticks <= 0:
        raise ValueError("deliberation_ticks must be positive")
    if config.forecast_ticks < config.deliberation_ticks:
        raise ValueError("forecast_ticks must be >= deliberation_ticks")
    if config.deadline_tick <= 0:
        raise ValueError("deadline_tick must be positive")
    if not math.isfinite(config.gravity_mps2) or config.gravity_mps2 < 0.0:
        raise ValueError("gravity_mps2 must be finite and non-negative")
    if not math.isfinite(config.max_accel_mps2) or config.max_accel_mps2 <= 0.0:
        raise ValueError("max_accel_mps2 must be finite and positive")
    if not math.isfinite(config.goal_radius_m) or config.goal_radius_m <= 0.0:
        raise ValueError("goal_radius_m must be finite and positive")
    if not (
        config.bounds_min_x_m < config.bounds_max_x_m
        and config.bounds_min_y_m < config.bounds_max_y_m
    ):
        raise ValueError("scenario bounds must have positive width and height")
    for component in config.wind_components:
        if not all(
            isinstance(value, float) and math.isfinite(value)
            for value in (
                component.amp_mps2,
                component.period_ticks,
                component.phase_rad,
            )
        ):
            raise ValueError("wind component values must be finite floats")
        if component.period_ticks <= 0.0:
            raise ValueError("wind component periods must be finite and positive")


def initial_state(config: ScenarioConfig) -> GroundTruthState:
    """Construct tick-zero state with the mandatory no-op held action."""
    validate_scenario(config)
    distance = math.hypot(
        config.start_pos_x_m - config.goal_x_m,
        config.start_pos_y_m - config.goal_y_m,
    )
    return GroundTruthState(
        tick=0,
        pos_x_m=config.start_pos_x_m,
        pos_y_m=config.start_pos_y_m,
        vel_x_mps=config.start_vel_x_mps,
        vel_y_mps=config.start_vel_y_mps,
        wind_x_mps2=wind_x_at(config.wind_components, 0),
        held_accel_x_mps2=0.0,
        held_accel_y_mps2=0.0,
        distance_to_goal_m=distance,
        heat=heat_from_distance(distance),
    )


def step(config: ScenarioConfig, state: GroundTruthState) -> GroundTruthState:
    """Advance exactly one tick using SPEC section 2.3's operation order."""
    if state.done:
        return state

    wind = wind_x_at(config.wind_components, state.tick)
    accel_x = state.held_accel_x_mps2 + wind
    accel_y = state.held_accel_y_mps2 - config.gravity_mps2

    vel_x = state.vel_x_mps + accel_x * config.dt_s
    vel_y = state.vel_y_mps + accel_y * config.dt_s
    pos_x = state.pos_x_m + vel_x * config.dt_s
    pos_y = state.pos_y_m + vel_y * config.dt_s
    tick = state.tick + 1

    distance = math.hypot(pos_x - config.goal_x_m, pos_y - config.goal_y_m)
    done = False
    outcome = None
    if distance <= config.goal_radius_m:
        done = True
        outcome = OUTCOME_GOAL
    elif (
        pos_x < config.bounds_min_x_m
        or pos_x > config.bounds_max_x_m
        or pos_y < config.bounds_min_y_m
        or pos_y > config.bounds_max_y_m
    ):
        done = True
        outcome = OUTCOME_OOB
    elif tick >= config.deadline_tick:
        done = True
        outcome = OUTCOME_TIMEOUT

    return GroundTruthState(
        tick=tick,
        pos_x_m=pos_x,
        pos_y_m=pos_y,
        vel_x_mps=vel_x,
        vel_y_mps=vel_y,
        wind_x_mps2=wind_x_at(config.wind_components, tick),
        held_accel_x_mps2=state.held_accel_x_mps2,
        held_accel_y_mps2=state.held_accel_y_mps2,
        distance_to_goal_m=distance,
        heat=heat_from_distance(distance),
        done=done,
        outcome=outcome,
    )


def advance_ticks(
    config: ScenarioConfig,
    state: GroundTruthState,
    ticks: int,
) -> GroundTruthState:
    """Advance up to ``ticks``, stopping immediately at a terminal event."""
    if ticks < 0:
        raise ValueError("ticks must be non-negative")
    result = state
    for _ in range(ticks):
        if result.done:
            break
        result = step(config, result)
    return result


def build_observation(
    config: ScenarioConfig,
    state: GroundTruthState,
    *,
    episode_id: str,
    cycle: int,
    previous_heat: float | None = None,
) -> Observation:
    """Expose the complete, prediction-safe state visible at a cycle start."""
    if cycle < 0:
        raise ValueError("cycle must be non-negative")
    forecast = tuple(
        wind_x_at(config.wind_components, state.tick + offset)
        for offset in range(config.forecast_ticks)
    )
    visible_distance = state.distance_to_goal_m if config.goal_visible else None
    return Observation(
        schema_version=SCHEMA_VERSION,
        scenario_id=config.scenario_id,
        episode_id=episode_id,
        cycle=cycle,
        tick=state.tick,
        dt_s=config.dt_s,
        deliberation_ticks=config.deliberation_ticks,
        deadline_tick=config.deadline_tick,
        ticks_remaining=max(0, config.deadline_tick - state.tick),
        pos_x_m=state.pos_x_m,
        pos_y_m=state.pos_y_m,
        vel_x_mps=state.vel_x_mps,
        vel_y_mps=state.vel_y_mps,
        held_accel_x_mps2=state.held_accel_x_mps2,
        held_accel_y_mps2=state.held_accel_y_mps2,
        gravity_mps2=config.gravity_mps2,
        max_accel_mps2=config.max_accel_mps2,
        wind_now_x_mps2=forecast[0],
        wind_forecast_x_mps2=forecast,
        goal_x_m=config.goal_x_m if config.goal_visible else None,
        goal_y_m=config.goal_y_m if config.goal_visible else None,
        goal_radius_m=config.goal_radius_m,
        heat=state.heat,
        heat_delta=0.0 if previous_heat is None else state.heat - previous_heat,
        distance_to_goal_m=visible_distance,
        bounds_min_x_m=config.bounds_min_x_m,
        bounds_min_y_m=config.bounds_min_y_m,
        bounds_max_x_m=config.bounds_max_x_m,
        bounds_max_y_m=config.bounds_max_y_m,
    )
