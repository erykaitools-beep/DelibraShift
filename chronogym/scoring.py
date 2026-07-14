"""Episode scoring for prediction, temporal anticipation, and outcome."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

from .oracle import oracle_action, state_from_observation
from .runner import CycleRecord, EpisodeResult
from .types import (
    FIDELITY_MIN_COVERAGE,
    FIDELITY_MIN_CYCLES,
    HEAT_SCALE_M,
    TEMPORAL_MIN_MEAN_W,
    Action,
    EpisodeScores,
    Prediction,
    ScenarioConfig,
    action_similarity,
    prediction_fidelity,
)


@dataclass(frozen=True)
class PredictionFidelityScore:
    """Prediction score plus the mandatory formatting attribution controls."""

    prediction_fidelity: float | None
    prediction_coverage: float
    fidelity_invalid_reason: str | None
    persistence_floor_fidelity: float | None
    action_parse_rate: float
    prediction_parse_rate: float
    n_cycles: int
    n_valid_prediction_cycles: int


@dataclass(frozen=True)
class TemporalAnticipationScore:
    temporal_anticipation: float | None
    mean_divergence_weight: float
    n_scored_cycles: int


def _mean(values: list[float]) -> float:
    """SPEC-wide naive left-to-right arithmetic mean."""
    return sum(values) / len(values)


def score_outcome(config: ScenarioConfig, result: EpisodeResult) -> float:
    """Compute SPEC 4.4's graded outcome over the inclusive tick trace."""
    success = result.final_state.outcome == "goal"
    score = 0.5 * float(success)
    score += 0.4 * math.exp(-result.closest_approach_m / HEAT_SCALE_M)
    if success:
        score += 0.1 * (1.0 - result.final_state.tick / config.deadline_tick)
    return score


def score_prediction_fidelity(
    records: Iterable[CycleRecord],
) -> PredictionFidelityScore:
    """Aggregate non-truncated prediction targets without exact-match grading."""
    cycle_records = tuple(records)
    total = len(cycle_records)
    action_parsed = sum(not record.reply.parse_failed for record in cycle_records)
    requested = [record for record in cycle_records if record.prediction_requested]
    prediction_parsed = sum(
        record.reply.prediction is not None
        and not record.reply.prediction_parse_failed
        for record in requested
    )
    requested_non_truncated = [record for record in requested if not record.truncated]

    fidelities: list[float] = []
    persistence_fidelities: list[float] = []
    for record in cycle_records:
        if (
            record.truncated
            or record.prediction_target is None
            or not record.prediction_requested
            or record.reply.prediction is None
            or record.reply.prediction_parse_failed
        ):
            continue
        persistence_fidelities.append(
            prediction_fidelity(
                Prediction(
                    pos_x_m=record.observation.pos_x_m,
                    pos_y_m=record.observation.pos_y_m,
                    vel_x_mps=record.observation.vel_x_mps,
                    vel_y_mps=record.observation.vel_y_mps,
                ),
                record.prediction_target,
            )
        )
        fidelities.append(
            prediction_fidelity(record.reply.prediction, record.prediction_target)
        )

    coverage = (
        len(fidelities) / len(requested_non_truncated)
        if requested_non_truncated
        else 0.0
    )
    invalid_reason = None
    fidelity = _mean(fidelities) if fidelities else None
    if not requested:
        invalid_reason = "not_requested"
        fidelity = None
    elif coverage < FIDELITY_MIN_COVERAGE:
        invalid_reason = "insufficient_coverage"
        fidelity = None
    elif len(fidelities) < FIDELITY_MIN_CYCLES:
        invalid_reason = "too_few_cycles"
        fidelity = None

    return PredictionFidelityScore(
        prediction_fidelity=fidelity,
        prediction_coverage=coverage,
        fidelity_invalid_reason=invalid_reason,
        persistence_floor_fidelity=(
            _mean(persistence_fidelities) if persistence_fidelities else None
        ),
        action_parse_rate=action_parsed / total if total else 0.0,
        prediction_parse_rate=(
            prediction_parsed / len(requested) if requested else 0.0
        ),
        n_cycles=total,
        n_valid_prediction_cycles=len(fidelities),
    )


def score_temporal_anticipation(
    config: ScenarioConfig,
    records: Iterable[CycleRecord],
) -> TemporalAnticipationScore:
    """Score action lead against engage-time and observed-time pinned oracles."""
    if not config.goal_visible:
        return TemporalAnticipationScore(None, 0.0, 0)
    weighted_margin = 0.0
    weight_sum = 0.0
    scored_cycles = 0
    for record in records:
        if (
            record.truncated
            or record.reply.parse_failed
            or not record.action_engaged
            or record.engaged_action is None
            or record.prediction_target is None
        ):
            continue
        engage_oracle = oracle_action(
            config,
            record.prediction_target,
            cycle=record.cycle,
            variant=0,
        )
        observed_oracle = oracle_action(
            config,
            state_from_observation(config, record.observation),
            cycle=record.cycle,
            variant=1,
        )
        weight = math.hypot(
            engage_oracle.accel_x_mps2 - observed_oracle.accel_x_mps2,
            engage_oracle.accel_y_mps2 - observed_oracle.accel_y_mps2,
        ) / (2.0 * config.max_accel_mps2)
        engaged = Action(
            record.engaged_action.accel_x_mps2,
            record.engaged_action.accel_y_mps2,
        )
        weighted_margin += weight * (
            action_similarity(engaged, engage_oracle, config.max_accel_mps2)
            - action_similarity(engaged, observed_oracle, config.max_accel_mps2)
        )
        weight_sum += weight
        scored_cycles += 1
    mean_weight = weight_sum / scored_cycles if scored_cycles else 0.0
    if scored_cycles == 0 or mean_weight < TEMPORAL_MIN_MEAN_W:
        return TemporalAnticipationScore(None, mean_weight, scored_cycles)
    temporal_raw = weighted_margin / weight_sum
    return TemporalAnticipationScore(
        temporal_anticipation=(temporal_raw + 1.0) / 2.0,
        mean_divergence_weight=mean_weight,
        n_scored_cycles=scored_cycles,
    )


def score_episode(
    config: ScenarioConfig,
    result: EpisodeResult,
    *,
    include_temporal: bool = False,
) -> EpisodeScores:
    fidelity = score_prediction_fidelity(result.records)
    temporal = (
        score_temporal_anticipation(config, result.records).temporal_anticipation
        if include_temporal
        else None
    )
    return EpisodeScores(
        prediction_fidelity=fidelity.prediction_fidelity,
        prediction_coverage=fidelity.prediction_coverage,
        fidelity_invalid_reason=fidelity.fidelity_invalid_reason,
        persistence_floor_fidelity=fidelity.persistence_floor_fidelity,
        temporal_anticipation=temporal,
        outcome=score_outcome(config, result),
        action_parse_rate=fidelity.action_parse_rate,
        prediction_parse_rate=fidelity.prediction_parse_rate,
        n_cycles=fidelity.n_cycles,
        n_valid_prediction_cycles=fidelity.n_valid_prediction_cycles,
        wall_clock_ms_telemetry_only=result.wall_clock_ms_telemetry_only,
    )
