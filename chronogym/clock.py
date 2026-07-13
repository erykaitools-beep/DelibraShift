"""Seed-independent simulated deliberation clock."""

from __future__ import annotations

from dataclasses import dataclass, replace

from .types import Action, GroundTruthState, ScenarioConfig, clamp_accel
from .world import advance_ticks


@dataclass(frozen=True)
class WindowAdvance:
    """Result of one fixed-budget deliberation window."""

    state: GroundTruthState
    ticks_elapsed: int
    truncated: bool


def advance_deliberation(
    config: ScenarioConfig,
    state: GroundTruthState,
) -> WindowAdvance:
    """Advance B ticks under the action already latched in ``state``."""
    target_tick = state.tick + config.deliberation_ticks
    advanced = advance_ticks(config, state, config.deliberation_ticks)
    elapsed = advanced.tick - state.tick
    return WindowAdvance(
        state=advanced,
        ticks_elapsed=elapsed,
        truncated=advanced.tick != target_tick,
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
