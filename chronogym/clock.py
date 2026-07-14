"""Seed-independent simulated deliberation clock."""

from __future__ import annotations

from dataclasses import dataclass, replace

from .types import Action, GroundTruthState, ScenarioConfig, clamp_accel
from .world import step


@dataclass(frozen=True)
class WindowAdvance:
    """Result of one fixed-budget deliberation window."""

    state: GroundTruthState
    ticks_elapsed: int
    truncated: bool
    min_distance_to_goal_m: float


def advance_deliberation(
    config: ScenarioConfig,
    state: GroundTruthState,
) -> WindowAdvance:
    """Advance B ticks under the action already latched in ``state``."""
    target_tick = state.tick + config.deliberation_ticks
    advanced = state
    min_distance = state.distance_to_goal_m
    for _ in range(config.deliberation_ticks):
        if advanced.done:
            break
        advanced = step(config, advanced)
        min_distance = min(min_distance, advanced.distance_to_goal_m)
    elapsed = advanced.tick - state.tick
    return WindowAdvance(
        state=advanced,
        ticks_elapsed=elapsed,
        truncated=advanced.tick != target_tick,
        min_distance_to_goal_m=min_distance,
    )


def latch_action(
    config: ScenarioConfig,
    state: GroundTruthState,
    action: Action,
) -> GroundTruthState:
    """Clamp and engage an action without advancing simulated time."""
    accel_x, accel_y = clamp_accel(
        action.accel_x_mps2,
        action.accel_y_mps2,
        config.max_accel_mps2,
    )
    return replace(
        state,
        held_accel_x_mps2=accel_x,
        held_accel_y_mps2=accel_y,
    )
