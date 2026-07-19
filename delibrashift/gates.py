"""Executable M1 exit gates and paired feedback controls from SPEC sections 4-6."""

from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass
from typing import Callable, Iterable

from .agents import Agent, GreedyAgent, RandomAgent
from .oracle import LeadGreedyAgent, OracleAgent, oracle_action, state_from_observation
from .runner import EpisodeResult, run_episode
from .scoring import score_outcome, score_temporal_anticipation
from .types import (
    FEEDBACK_MIN_BAND,
    GATE_II_MARGIN,
    Action,
    GroundTruthState,
    PackScores,
    ScenarioConfig,
)
from .world import advance_ticks


@dataclass(frozen=True)
class ReproducibilityGate:
    passed: bool
    first_sha256: str
    second_sha256: str


@dataclass(frozen=True)
class MatchedStateGate:
    passed: bool
    budgets: tuple[int, ...]
    scores: tuple[float, ...]
    admissible_states: int


@dataclass(frozen=True)
class KillCriterionGate:
    passed: bool
    pack_valid: bool
    oracle_outcome: float
    random_outcome: float
    greedy_outcome: float
    validity_v1: float
    outcome_distance: float
    oracle_temporal: float
    greedy_temporal: float
    validity_v2: float
    k2_left: float
    k2_right: float


def _mean(values: Iterable[float]) -> float:
    items = tuple(values)
    return sum(items) / len(items)


def decoy_goal(config: ScenarioConfig) -> tuple[float, float]:
    """Draw the one per-scenario physically plausible decoy from SPEC 4.3."""
    rng = random.Random(config.seed * 65_537)
    fake = (0.0, 0.0)
    for _ in range(8):
        fake = (
            rng.uniform(config.bounds_min_x_m + 10.0, config.bounds_max_x_m - 10.0),
            rng.uniform(config.bounds_min_y_m + 10.0, config.bounds_max_y_m - 10.0),
        )
        if math.hypot(fake[0] - config.goal_x_m, fake[1] - config.goal_y_m) >= 25.0:
            break
    return fake


def _paired_outcomes(
    config: ScenarioConfig,
    agent_factory: Callable[[], Agent],
) -> tuple[float, float]:
    normal = run_episode(config, agent_factory())
    ablated = run_episode(config, agent_factory(), heat_goal_m=decoy_goal(config))
    return score_outcome(config, normal), score_outcome(config, ablated)


def score_feedback_use(
    masked_scenarios: Iterable[ScenarioConfig],
    agent_factory: Callable[[], Agent],
) -> PackScores:
    """Score paired heat use and normalize by the registered searcher band."""
    scenarios = tuple(masked_scenarios)
    if not scenarios:
        return PackScores(None, None, None, ())
    raw_terms: list[float] = []
    band_terms: list[float] = []
    for config in scenarios:
        if config.goal_visible:
            raise ValueError("feedback-use scenarios must mask the goal")
        normal, ablated = _paired_outcomes(config, agent_factory)
        raw_terms.append(normal - ablated)
        band_normal, band_ablated = _paired_outcomes(config, GreedyAgent)
        band_terms.append(band_normal - band_ablated)
    feedback_raw = _mean(raw_terms)
    band = _mean(band_terms)
    feedback_use = None
    if band >= FEEDBACK_MIN_BAND:
        feedback_use = 0.5 + 0.5 * max(-1.0, min(1.0, feedback_raw / band))
    return PackScores(
        feedback_use=feedback_use,
        feedback_raw=feedback_raw,
        feedback_band=band,
        feedback_band_terms=tuple(band_terms),
    )


def reproducibility_gate(scenarios: Iterable[ScenarioConfig]) -> ReproducibilityGate:
    """Hash two complete same-seed random-agent pack runs."""
    configs = tuple(scenarios)
    first = b"".join(
        run_episode(config, RandomAgent(config.seed)).log_bytes for config in configs
    )
    second = b"".join(
        run_episode(config, RandomAgent(config.seed)).log_bytes for config in configs
    )
    first_hash = hashlib.sha256(first).hexdigest()
    second_hash = hashlib.sha256(second).hexdigest()
    return ReproducibilityGate(first == second, first_hash, second_hash)


def _state_at_observation(config: ScenarioConfig, result: EpisodeResult, index: int) -> GroundTruthState:
    return state_from_observation(config, result.records[index].observation)


def matched_state_gate(sweep: Iterable[ScenarioConfig]) -> MatchedStateGate:
    """Run the admissible six-state matched-state probe from SPEC 5.6."""
    configs = tuple(sorted(sweep, key=lambda item: item.deliberation_ticks))
    budgets = tuple(config.deliberation_ticks for config in configs)
    if budgets != (10, 20, 40):
        raise ValueError("matched-state gate requires B=10,20,40")
    if len({config.seed for config in configs}) != 1:
        raise ValueError("matched-state sweep members must share seed")
    reference = next(config for config in configs if config.deliberation_ticks == 20)
    trajectory = run_episode(reference, LeadGreedyAgent())
    admissible: list[tuple[GroundTruthState, int]] = []
    for index, record in enumerate(trajectory.records):
        state = _state_at_observation(reference, trajectory, index)
        if all(
            advance_ticks(config, state, config.deliberation_ticks).tick
            == state.tick + config.deliberation_ticks
            for config in configs
        ):
            admissible.append((state, record.cycle))
        if len(admissible) == 6:
            break
    if len(admissible) < 6:
        return MatchedStateGate(False, budgets, (), len(admissible))

    scores: list[float] = []
    for config in configs:
        weights: list[float] = []
        for observed_state, cycle in admissible:
            engage_state = advance_ticks(
                config,
                observed_state,
                config.deliberation_ticks,
            )
            engage = oracle_action(config, engage_state, cycle=cycle, variant=0)
            observed = oracle_action(config, observed_state, cycle=cycle, variant=1)
            weights.append(
                math.hypot(
                    engage.accel_x_mps2 - observed.accel_x_mps2,
                    engage.accel_y_mps2 - observed.accel_y_mps2,
                )
                / (2.0 * config.max_accel_mps2)
            )
        scores.append(0.5 * (1.0 - sum(weight * weight for weight in weights) / sum(weights)))
    passed = all(
        scores[index] - scores[index + 1] >= GATE_II_MARGIN
        for index in range(len(scores) - 1)
    )
    return MatchedStateGate(passed, budgets, tuple(scores), len(admissible))


def _mean_temporal(configs: tuple[ScenarioConfig, ...], results: list[EpisodeResult]) -> float:
    values = [
        score_temporal_anticipation(config, result.records).temporal_anticipation
        for config, result in zip(configs, results)
    ]
    measured = [value for value in values if value is not None]
    if len(measured) != len(values):
        raise ValueError("kill-criterion temporal score is not measurable")
    return _mean(measured)


def kill_criterion_gate(scenarios: Iterable[ScenarioConfig]) -> KillCriterionGate:
    """Evaluate the registered R=20 validity floors and kill conditions."""
    configs = tuple(
        config
        for config in scenarios
        if config.goal_visible
        and not any(tag.startswith("probe:") for tag in config.axis_tags)
    )
    oracle_results = [run_episode(config, OracleAgent(config)) for config in configs]
    greedy_results = [run_episode(config, GreedyAgent()) for config in configs]
    oracle_outcome = _mean(
        score_outcome(config, result) for config, result in zip(configs, oracle_results)
    )
    greedy_outcome = _mean(
        score_outcome(config, result) for config, result in zip(configs, greedy_results)
    )
    random_outcome = _mean(
        _mean(
            score_outcome(
                config,
                run_episode(config, RandomAgent(config.seed, repetition=repetition)),
            )
            for repetition in range(20)
        )
        for config in configs
    )
    oracle_temporal = _mean_temporal(configs, oracle_results)
    greedy_temporal = _mean_temporal(configs, greedy_results)
    validity_v1 = oracle_outcome - random_outcome
    outcome_distance = (oracle_outcome - greedy_outcome) / validity_v1
    validity_v2 = oracle_temporal - 0.5
    k2_left = greedy_temporal - 0.5
    k2_right = 0.5 * validity_v2
    pack_valid = validity_v1 >= 0.2 and validity_v2 >= 0.05
    passed = pack_valid and outcome_distance >= 0.25 and k2_left < k2_right
    return KillCriterionGate(
        passed=passed,
        pack_valid=pack_valid,
        oracle_outcome=oracle_outcome,
        random_outcome=random_outcome,
        greedy_outcome=greedy_outcome,
        validity_v1=validity_v1,
        outcome_distance=outcome_distance,
        oracle_temporal=oracle_temporal,
        greedy_temporal=greedy_temporal,
        validity_v2=validity_v2,
        k2_left=k2_left,
        k2_right=k2_right,
    )
