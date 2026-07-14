"""Formatting-control prompts, deterministic candidates, and probe scorers."""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING

from .oracle import predict_engage_from_observation
from .types import (
    PRED_POS_TOL_M,
    PRED_VEL_TOL_MPS,
    Observation,
    Prediction,
    ScenarioConfig,
    canonical_json,
    fidelity_from_error,
)

if TYPE_CHECKING:
    from .runner import CycleRecord


FORMAT_PROBE_PROMPT_VERSION = "probe-format-draft-0.1"
CHOICE_PROBE_PROMPT_VERSION = "probe-choice-draft-0.1"


@dataclass(frozen=True)
class ForcedChoiceCandidates:
    candidate_a: Prediction
    candidate_b: Prediction
    correct_choice: str


@dataclass(frozen=True)
class FormatProbeScore:
    json_parse_rate: float
    identity_fidelity: float | None
    engage_fidelity: float | None
    identity_better: int
    engage_better: int
    ties: int
    n_trials: int
    n_parsed: int


@dataclass(frozen=True)
class ForcedChoiceScore:
    choice_accuracy: float | None
    choice_parse_rate: float
    n_trials: int
    n_parsed: int


def _prediction_error(prediction: Prediction, target: Prediction) -> float:
    return (
        abs(prediction.pos_x_m - target.pos_x_m) / PRED_POS_TOL_M
        + abs(prediction.pos_y_m - target.pos_y_m) / PRED_POS_TOL_M
        + abs(prediction.vel_x_mps - target.vel_x_mps) / PRED_VEL_TOL_MPS
        + abs(prediction.vel_y_mps - target.vel_y_mps) / PRED_VEL_TOL_MPS
    ) / 4.0


def identity_prediction(observation: Observation) -> Prediction:
    return Prediction(
        observation.pos_x_m,
        observation.pos_y_m,
        observation.vel_x_mps,
        observation.vel_y_mps,
    )


def forced_choice_candidates(
    config: ScenarioConfig,
    observation: Observation,
) -> ForcedChoiceCandidates:
    """Construct SPEC 4.5's true/decoy pair in the pinned RNG order."""
    target = predict_engage_from_observation(observation)
    rng = random.Random(config.seed * 104_729 + observation.cycle)
    sign_pos = 1.0 if rng.random() < 0.5 else -1.0
    sign_vel = 1.0 if rng.random() < 0.5 else -1.0
    true_is_a = rng.random() < 0.5
    decoy_pos_x = target.pos_x_m + sign_pos * 3.0 * PRED_POS_TOL_M
    if not observation.bounds_min_x_m <= decoy_pos_x <= observation.bounds_max_x_m:
        sign_pos = -sign_pos
        decoy_pos_x = target.pos_x_m + sign_pos * 3.0 * PRED_POS_TOL_M
    decoy = Prediction(
        pos_x_m=decoy_pos_x,
        pos_y_m=target.pos_y_m,
        vel_x_mps=target.vel_x_mps + sign_vel * 3.0 * PRED_VEL_TOL_MPS,
        vel_y_mps=target.vel_y_mps,
    )
    if true_is_a:
        return ForcedChoiceCandidates(target, decoy, "A")
    return ForcedChoiceCandidates(decoy, target, "B")


def render_format_probe_prompt(observation: Observation) -> str:
    """Render the separate, deliberately unfrozen identity-format control."""
    expected_shape = {
        "prediction": asdict(identity_prediction(observation)),
        "action": {"accel_x_mps2": 0.0, "accel_y_mps2": 0.0},
    }
    return (
        "FORMAT CONTROL: Do not predict a future state. Restate the CURRENT "
        "observed pos_x_m, pos_y_m, vel_x_mps, and vel_y_mps exactly in the "
        "prediction object. Your action is ignored; return zero acceleration.\n\n"
        f"Observation JSON:\n{canonical_json(asdict(observation))}\n\n"
        "Return one JSON object and nothing else. The required reply is:\n"
        f"{canonical_json(expected_shape)}\n"
    )


def render_forced_choice_prompt(
    config: ScenarioConfig,
    observation: Observation,
) -> str:
    """Render SPEC 4.5's number-emission-free world-model control."""
    candidates = forced_choice_candidates(config, observation)
    return (
        "WORLD-MODEL CONTROL: The world advances while the previously latched "
        "held_accel action keeps applying. Choose the candidate state at tick "
        f"{observation.tick + observation.deliberation_ticks}.\n\n"
        f"Observation JSON:\n{canonical_json(asdict(observation))}\n\n"
        f"Candidate A:\n{canonical_json(asdict(candidates.candidate_a))}\n"
        f"Candidate B:\n{canonical_json(asdict(candidates.candidate_b))}\n\n"
        'Return one JSON object and nothing else: {"choice": "A"} or '
        '{"choice": "B"}.\n'
    )


def format_probe_match(record: CycleRecord) -> str | None:
    if record.truncated or record.prediction_target is None:
        return None
    prediction = record.reply.prediction
    if prediction is None or record.reply.prediction_parse_failed:
        return None
    identity_error = _prediction_error(prediction, identity_prediction(record.observation))
    engage_target = Prediction(
        record.prediction_target.pos_x_m,
        record.prediction_target.pos_y_m,
        record.prediction_target.vel_x_mps,
        record.prediction_target.vel_y_mps,
    )
    engage_error = _prediction_error(prediction, engage_target)
    if identity_error < engage_error:
        return "identity"
    if engage_error < identity_error:
        return "engage"
    return "tie"


def score_format_probe(records: tuple[CycleRecord, ...]) -> FormatProbeScore:
    trials = tuple(record for record in records if not record.truncated)
    parsed = tuple(
        record
        for record in trials
        if not record.reply.parse_failed
        and not record.reply.prediction_parse_failed
        and record.reply.prediction is not None
        and record.prediction_target is not None
    )
    identity_values: list[float] = []
    engage_values: list[float] = []
    matches = {"identity": 0, "engage": 0, "tie": 0}
    for record in parsed:
        prediction = record.reply.prediction
        assert prediction is not None
        identity_values.append(
            fidelity_from_error(
                _prediction_error(prediction, identity_prediction(record.observation))
            )
        )
        target = record.prediction_target
        assert target is not None
        engage_values.append(
            fidelity_from_error(
                _prediction_error(
                    prediction,
                    Prediction(
                        target.pos_x_m,
                        target.pos_y_m,
                        target.vel_x_mps,
                        target.vel_y_mps,
                    ),
                )
            )
        )
        match = format_probe_match(record)
        assert match is not None
        matches[match] += 1
    return FormatProbeScore(
        json_parse_rate=len(parsed) / len(trials) if trials else 0.0,
        identity_fidelity=(sum(identity_values) / len(identity_values) if parsed else None),
        engage_fidelity=(sum(engage_values) / len(engage_values) if parsed else None),
        identity_better=matches["identity"],
        engage_better=matches["engage"],
        ties=matches["tie"],
        n_trials=len(trials),
        n_parsed=len(parsed),
    )


def score_forced_choice_probe(
    config: ScenarioConfig,
    records: tuple[CycleRecord, ...],
) -> ForcedChoiceScore:
    trials = tuple(record for record in records if not record.truncated)
    parsed = tuple(
        record
        for record in trials
        if not record.reply.parse_failed and record.reply.choice in ("A", "B")
    )
    correct = sum(
        record.reply.choice
        == forced_choice_candidates(config, record.observation).correct_choice
        for record in parsed
    )
    return ForcedChoiceScore(
        choice_accuracy=correct / len(parsed) if parsed else None,
        choice_parse_rate=len(parsed) / len(trials) if trials else 0.0,
        n_trials=len(trials),
        n_parsed=len(parsed),
    )
