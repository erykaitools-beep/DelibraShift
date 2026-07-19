"""Matched END2END vs WM-SCAFFOLD experiment orchestration."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import platform
from typing import Iterable

from .agents import GreedyAgent
from .gates import decoy_goal, score_feedback_use
from .harness import PROMPT_VERSION, HarnessAgent, TransportPacer
from .probes import (
    CHOICE_PROBE_PROMPT_VERSION,
    FORMAT_PROBE_PROMPT_VERSION,
    score_forced_choice_probe,
    score_format_probe,
)
from .runner import EpisodeResult, load_episode_result, run_episode
from .scaffold import SCAFFOLD_PROMPT_VERSION, WMScaffoldAgent
from .scoring import score_episode, score_prediction_fidelity, score_temporal_anticipation
from .types import FEEDBACK_MIN_BAND, Adapter, ScenarioConfig, canonical_json


@dataclass(frozen=True)
class MetricRange:
    mean: float | None
    minimum: float | None
    maximum: float | None
    n: int


@dataclass(frozen=True)
class AblationEpisode:
    arm: str
    repetition: int
    scenario_id: str
    prediction_fidelity: float | None
    prediction_coverage: float
    temporal_anticipation: float | None
    outcome: float
    action_parse_rate: float
    prediction_parse_rate: float
    retried_cycle_rate: float
    mean_divergence_weight: float | None
    fidelity_no_retry: float | None
    temporal_no_retry: float | None
    wall_clock_ms_telemetry_only: float
    transport_retries: int
    log_path: str | None


@dataclass(frozen=True)
class ArmSummary:
    arm: str
    n_episodes: int
    prediction_fidelity: MetricRange
    prediction_coverage: MetricRange
    temporal_anticipation: MetricRange
    outcome: MetricRange
    action_parse_rate: MetricRange
    prediction_parse_rate: MetricRange
    retried_cycle_rate: MetricRange
    mean_divergence_weight: MetricRange
    fidelity_no_retry: MetricRange
    temporal_no_retry: MetricRange
    wall_clock_ms_telemetry_only: MetricRange
    transport_retries: int


@dataclass(frozen=True)
class FeedbackEpisode:
    arm: str
    repetition: int
    scenario_id: str
    normal_outcome: float
    decoy_outcome: float
    outcome_delta: float
    wall_clock_ms_telemetry_only: float
    transport_retries: int
    decoy_log_path: str | None


@dataclass(frozen=True)
class FeedbackSummary:
    arm: str
    feedback_use: float | None
    feedback_raw: float | None
    feedback_band: float | None
    feedback_band_terms: tuple[float, ...]
    n_pairs: int


@dataclass(frozen=True)
class ProbeEpisode:
    probe_kind: str
    repetition: int
    scenario_id: str
    json_parse_rate: float | None
    identity_fidelity: float | None
    engage_fidelity: float | None
    identity_better: int | None
    engage_better: int | None
    ties: int | None
    choice_accuracy: float | None
    choice_parse_rate: float | None
    n_trials: int
    n_parsed: int
    wall_clock_ms_telemetry_only: float
    transport_retries: int
    log_path: str | None


@dataclass(frozen=True)
class MatchedPairReport:
    adapter_name: str
    host_class: str
    pack_name: str | None
    pack_version: str | None
    end2end_prompt_version: str
    scaffold_prompt_version: str
    format_probe_prompt_version: str
    choice_probe_prompt_version: str
    feedback_reference_agent: str
    repetitions: int
    scenario_ids: tuple[str, ...]
    excluded_probe_ids: tuple[str, ...]
    episodes: tuple[AblationEpisode, ...]
    summaries: tuple[ArmSummary, ...]
    feedback_episodes: tuple[FeedbackEpisode, ...]
    feedback_summaries: tuple[FeedbackSummary, ...]
    probe_episodes: tuple[ProbeEpisode, ...]


def _range(values: Iterable[float | None]) -> MetricRange:
    measured = [value for value in values if value is not None]
    return MetricRange(
        mean=sum(measured) / len(measured) if measured else None,
        minimum=min(measured) if measured else None,
        maximum=max(measured) if measured else None,
        n=len(measured),
    )


def _summarize(arm: str, episodes: list[AblationEpisode]) -> ArmSummary:
    selected = [episode for episode in episodes if episode.arm == arm]
    metric_names = (
        "prediction_fidelity",
        "prediction_coverage",
        "temporal_anticipation",
        "outcome",
        "action_parse_rate",
        "prediction_parse_rate",
        "retried_cycle_rate",
        "mean_divergence_weight",
        "fidelity_no_retry",
        "temporal_no_retry",
        "wall_clock_ms_telemetry_only",
    )
    metrics = {
        name: _range(getattr(episode, name) for episode in selected)
        for name in metric_names
    }
    return ArmSummary(
        arm=arm,
        n_episodes=len(selected),
        transport_retries=sum(episode.transport_retries for episode in selected),
        **metrics,
    )


def _agent_for_arm(
    arm: str,
    adapter: Adapter,
    repetition: int,
    pacer: TransportPacer,
) -> HarnessAgent:
    if arm == "end2end":
        return HarnessAgent(
            adapter,
            repetition=repetition,
            transport_pacer=pacer,
            arm_name=arm,
        )
    if arm == "wm-scaffold":
        return WMScaffoldAgent(
            adapter,
            repetition=repetition,
            transport_pacer=pacer,
        )
    raise ValueError(f"unknown experiment arm: {arm}")


def _summarize_feedback(
    arm: str,
    episodes: list[FeedbackEpisode],
    band: float | None,
    band_terms: tuple[float, ...],
) -> FeedbackSummary:
    selected = [episode for episode in episodes if episode.arm == arm]
    raw = (
        sum(episode.outcome_delta for episode in selected) / len(selected)
        if selected
        else None
    )
    feedback_use = None
    if raw is not None and band is not None and band >= FEEDBACK_MIN_BAND:
        feedback_use = 0.5 + 0.5 * max(-1.0, min(1.0, raw / band))
    return FeedbackSummary(
        arm=arm,
        feedback_use=feedback_use,
        feedback_raw=raw,
        feedback_band=band,
        feedback_band_terms=band_terms,
        n_pairs=len(selected),
    )


def _run_logged_episode(
    config: ScenarioConfig,
    agent: HarnessAgent,
    path: Path | None,
    *,
    resume: bool,
    pack_name: str | None,
    pack_version: str | None,
    host_class: str,
    scenario_ids: tuple[str, ...],
    heat_goal_m: tuple[float, float] | None = None,
) -> tuple[EpisodeResult, str | None]:
    if resume and path is not None and path.is_file():
        return (
            load_episode_result(
                path,
                scenario_id=config.scenario_id,
                agent_name=agent.name,
                prompt_version=agent.prompt_version,
                pack_name=pack_name,
                pack_version=pack_version,
                host_class=host_class,
                scenario_ids=scenario_ids,
            ),
            str(path),
        )
    result = run_episode(
        config,
        agent,
        pack_name=pack_name,
        pack_version=pack_version,
        host_class=host_class,
        scenario_ids=scenario_ids,
        heat_goal_m=heat_goal_m,
    )
    if path is not None:
        path.write_bytes(result.log_bytes)
    return result, str(path) if path is not None else None


def run_matched_pair(
    scenarios: Iterable[ScenarioConfig],
    adapter: Adapter,
    *,
    repetitions: int = 3,
    pace_rpm: float = 40.0,
    log_dir: str | Path | None = None,
    pack_name: str | None = None,
    pack_version: str | None = None,
    host_class: str | None = None,
    include_temporal: bool = True,
    allow_underpowered: bool = False,
    resume: bool = False,
) -> MatchedPairReport:
    """Run both arms on matched configs/seeds; wall time never changes sim time."""
    if repetitions < 1 or (repetitions < 3 and not allow_underpowered):
        raise ValueError("LLM matched pairs require at least 3 repetitions")
    if pace_rpm < 0.0:
        raise ValueError("pace_rpm must be non-negative")
    all_configs = tuple(scenarios)
    probe_configs = tuple(
        config
        for config in all_configs
        if any(tag.startswith("probe:") for tag in config.axis_tags)
    )
    excluded = tuple(config.scenario_id for config in probe_configs)
    configs = tuple(
        config
        for config in all_configs
        if not any(tag.startswith("probe:") for tag in config.axis_tags)
    )
    if not configs:
        raise ValueError("matched pair requires at least one non-probe scenario")
    destination = Path(log_dir) if log_dir is not None else None
    if destination is not None:
        destination.mkdir(parents=True, exist_ok=True)
    pacer = TransportPacer(60.0 / pace_rpm if pace_rpm else 0.0)
    resolved_host = host_class or platform.machine() or "unknown"
    scenario_ids = tuple(config.scenario_id for config in configs)
    masked_configs = tuple(config for config in configs if not config.goal_visible)
    reference = score_feedback_use(masked_configs, GreedyAgent)
    feedback_band_terms = tuple(reference.feedback_band_terms or ())
    episodes: list[AblationEpisode] = []
    feedback_episodes: list[FeedbackEpisode] = []
    probe_episodes: list[ProbeEpisode] = []

    for repetition in range(repetitions):
        for config_index, config in enumerate(configs):
            arms = ("end2end", "wm-scaffold")
            if (repetition + config_index) % 2:
                arms = tuple(reversed(arms))
            for arm in arms:
                agent = _agent_for_arm(arm, adapter, repetition, pacer)
                path = (
                    destination / f"{config.scenario_id}.r{repetition}.{arm}.jsonl"
                    if destination is not None
                    else None
                )
                result, log_path = _run_logged_episode(
                    config,
                    agent,
                    path,
                    resume=resume,
                    pack_name=pack_name,
                    pack_version=pack_version,
                    host_class=resolved_host,
                    scenario_ids=scenario_ids,
                )
                scores = score_episode(
                    config,
                    result,
                    include_temporal=include_temporal and config.goal_visible,
                )
                measure_temporal = include_temporal and config.goal_visible
                temporal = (
                    score_temporal_anticipation(config, result.records)
                    if measure_temporal
                    else None
                )
                clean_records = tuple(
                    record for record in result.records if record.reply.parse_retries == 0
                )
                clean_fidelity = score_prediction_fidelity(clean_records)
                clean_temporal = (
                    score_temporal_anticipation(config, clean_records)
                    if measure_temporal
                    else None
                )
                episodes.append(
                    AblationEpisode(
                        arm=arm,
                        repetition=repetition,
                        scenario_id=config.scenario_id,
                        prediction_fidelity=scores.prediction_fidelity,
                        prediction_coverage=scores.prediction_coverage,
                        temporal_anticipation=scores.temporal_anticipation,
                        outcome=scores.outcome,
                        action_parse_rate=scores.action_parse_rate,
                        prediction_parse_rate=scores.prediction_parse_rate,
                        retried_cycle_rate=(
                            sum(record.reply.parse_retries > 0 for record in result.records)
                            / result.cycles
                        ),
                        mean_divergence_weight=(
                            temporal.mean_divergence_weight if temporal is not None else None
                        ),
                        fidelity_no_retry=clean_fidelity.prediction_fidelity,
                        temporal_no_retry=(
                            clean_temporal.temporal_anticipation
                            if clean_temporal is not None
                            else None
                        ),
                        wall_clock_ms_telemetry_only=result.wall_clock_ms_telemetry_only,
                        transport_retries=result.transport_retries,
                        log_path=log_path,
                    )
                )
                if not config.goal_visible:
                    decoy_agent = _agent_for_arm(arm, adapter, repetition, pacer)
                    decoy_path = (
                        destination
                        / f"{config.scenario_id}.r{repetition}.{arm}.decoy.jsonl"
                        if destination is not None
                        else None
                    )
                    decoy_result, decoy_log_path = _run_logged_episode(
                        config,
                        decoy_agent,
                        decoy_path,
                        resume=resume,
                        pack_name=pack_name,
                        pack_version=pack_version,
                        host_class=resolved_host,
                        scenario_ids=scenario_ids,
                        heat_goal_m=decoy_goal(config),
                    )
                    decoy_outcome = score_episode(
                        config,
                        decoy_result,
                        include_temporal=False,
                    ).outcome
                    feedback_episodes.append(
                        FeedbackEpisode(
                            arm=arm,
                            repetition=repetition,
                            scenario_id=config.scenario_id,
                            normal_outcome=scores.outcome,
                            decoy_outcome=decoy_outcome,
                            outcome_delta=scores.outcome - decoy_outcome,
                            wall_clock_ms_telemetry_only=(
                                decoy_result.wall_clock_ms_telemetry_only
                            ),
                            transport_retries=decoy_result.transport_retries,
                            decoy_log_path=decoy_log_path,
                        )
                    )

    for repetition in range(repetitions):
        for config in probe_configs:
            tags = set(config.axis_tags)
            probe_kind = "format" if "probe:format" in tags else "forced_choice"
            agent = HarnessAgent(
                adapter,
                repetition=repetition,
                probe_config=config,
                transport_pacer=pacer,
                arm_name="control",
            )
            path = (
                destination / f"{config.scenario_id}.r{repetition}.control.jsonl"
                if destination is not None
                else None
            )
            result, log_path = _run_logged_episode(
                config,
                agent,
                path,
                resume=resume,
                pack_name=pack_name,
                pack_version=pack_version,
                host_class=resolved_host,
                scenario_ids=excluded,
            )
            if probe_kind == "format":
                score = score_format_probe(result.records)
                probe_episodes.append(
                    ProbeEpisode(
                        probe_kind=probe_kind,
                        repetition=repetition,
                        scenario_id=config.scenario_id,
                        json_parse_rate=score.json_parse_rate,
                        identity_fidelity=score.identity_fidelity,
                        engage_fidelity=score.engage_fidelity,
                        identity_better=score.identity_better,
                        engage_better=score.engage_better,
                        ties=score.ties,
                        choice_accuracy=None,
                        choice_parse_rate=None,
                        n_trials=score.n_trials,
                        n_parsed=score.n_parsed,
                        wall_clock_ms_telemetry_only=(
                            result.wall_clock_ms_telemetry_only
                        ),
                        transport_retries=result.transport_retries,
                        log_path=log_path,
                    )
                )
            else:
                score = score_forced_choice_probe(config, result.records)
                probe_episodes.append(
                    ProbeEpisode(
                        probe_kind=probe_kind,
                        repetition=repetition,
                        scenario_id=config.scenario_id,
                        json_parse_rate=None,
                        identity_fidelity=None,
                        engage_fidelity=None,
                        identity_better=None,
                        engage_better=None,
                        ties=None,
                        choice_accuracy=score.choice_accuracy,
                        choice_parse_rate=score.choice_parse_rate,
                        n_trials=score.n_trials,
                        n_parsed=score.n_parsed,
                        wall_clock_ms_telemetry_only=(
                            result.wall_clock_ms_telemetry_only
                        ),
                        transport_retries=result.transport_retries,
                        log_path=log_path,
                    )
                )
    return MatchedPairReport(
        adapter_name=adapter.name,
        host_class=resolved_host,
        pack_name=pack_name,
        pack_version=pack_version,
        end2end_prompt_version=PROMPT_VERSION,
        scaffold_prompt_version=SCAFFOLD_PROMPT_VERSION,
        format_probe_prompt_version=FORMAT_PROBE_PROMPT_VERSION,
        choice_probe_prompt_version=CHOICE_PROBE_PROMPT_VERSION,
        feedback_reference_agent="greedy",
        repetitions=repetitions,
        scenario_ids=scenario_ids,
        excluded_probe_ids=excluded,
        episodes=tuple(episodes),
        summaries=tuple(
            _summarize(arm, episodes) for arm in ("end2end", "wm-scaffold")
        ),
        feedback_episodes=tuple(feedback_episodes),
        feedback_summaries=tuple(
            _summarize_feedback(
                arm,
                feedback_episodes,
                reference.feedback_band,
                feedback_band_terms,
            )
            for arm in ("end2end", "wm-scaffold")
        ),
        probe_episodes=tuple(probe_episodes),
    )


def write_matched_pair_report(report: MatchedPairReport, path: str | Path) -> None:
    Path(path).write_text(canonical_json(asdict(report)) + "\n", encoding="utf-8")
