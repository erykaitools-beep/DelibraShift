"""M1 prediction-fidelity scoring only (SPEC section 4.1)."""

from __future__ import annotations

from dataclasses import dataclass
from statistics import fmean
from typing import Iterable

from .runner import CycleRecord
from .types import Prediction, prediction_fidelity


@dataclass(frozen=True)
class PredictionFidelityScore:
    """Prediction score plus the mandatory formatting attribution controls."""

    prediction_fidelity: float | None
    parse_rate: float
    persistence_floor: float | None
    valid_prediction_cycles: int
    total_cycles: int


def score_prediction_fidelity(
    records: Iterable[CycleRecord],
) -> PredictionFidelityScore:
    """Aggregate non-truncated prediction targets without exact-match grading."""
    cycle_records = tuple(records)
    total = len(cycle_records)
    parsed = sum(not record.reply.parse_failed for record in cycle_records)

    fidelities: list[float] = []
    persistence_fidelities: list[float] = []
    for record in cycle_records:
        if record.truncated or record.prediction_target is None:
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
        if record.reply.parse_failed or record.reply.prediction is None:
            continue
        fidelities.append(
            prediction_fidelity(record.reply.prediction, record.prediction_target)
        )

    return PredictionFidelityScore(
        prediction_fidelity=fmean(fidelities) if fidelities else None,
        parse_rate=parsed / total if total else 0.0,
        persistence_floor=(
            fmean(persistence_fidelities) if persistence_fidelities else None
        ),
        valid_prediction_cycles=len(fidelities),
        total_cycles=total,
    )
