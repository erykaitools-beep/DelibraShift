"""Matched END2END vs WM-SCAFFOLD experiment orchestration."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import platform
from typing import Iterable

from .harness import PROMPT_VERSION, HarnessAgent, TransportPacer
from .runner import run_episode
from .scaffold import SCAFFOLD_PROMPT_VERSION, WMScaffoldAgent
from .scoring import score_episode, score_prediction_fidelity, score_temporal_anticipation
from .types import Adapter, ScenarioConfig, canonical_json


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
class MatchedPairReport:
    adapter_name: str
    host_class: str
    pack_name: str | None
    pack_version: str | None
    end2end_prompt_version: str
    scaffold_prompt_version: str
    repetitions: int
    scenario_ids: tuple[str, ...]
    excluded_probe_ids: tuple[str, ...]
    episodes: tuple[AblationEpisode, ...]
    summaries: tuple[ArmSummary, ...]


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
) -> MatchedPairReport:
    """Run both arms on matched configs/seeds; wall time never changes sim time."""
    if repetitions < 1 or (repetitions < 3 and not allow_underpowered):
        raise ValueError("LLM matched pairs require at least 3 repetitions")
    if pace_rpm < 0.0:
        raise ValueError("pace_rpm must be non-negative")
    all_configs = tuple(scenarios)
    excluded = tuple(
        config.scenario_id
        for config in all_configs
        if any(tag.startswith("probe:") for tag in config.axis_tags)
    )
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
    episodes: list[AblationEpisode] = []

    for repetition in range(repetitions):
        for config_index, config in enumerate(configs):
            arms = ("end2end", "wm-scaffold")
            if (repetition + config_index) % 2:
                arms = tuple(reversed(arms))
            for arm in arms:
                if arm == "end2end":
                    agent = HarnessAgent(
                        adapter,
                        repetition=repetition,
                        transport_pacer=pacer,
                        arm_name=arm,
                    )
                else:
                    agent = WMScaffoldAgent(
                        adapter,
                        repetition=repetition,
                        transport_pacer=pacer,
                    )
                result = run_episode(
                    config,
                    agent,
                    pack_name=pack_name,
                    pack_version=pack_version,
                    host_class=resolved_host,
                    scenario_ids=scenario_ids,
                )
                log_path = None
                if destination is not None:
                    path = destination / f"{config.scenario_id}.r{repetition}.{arm}.jsonl"
                    path.write_bytes(result.log_bytes)
                    log_path = str(path)
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
    return MatchedPairReport(
        adapter_name=adapter.name,
        host_class=resolved_host,
        pack_name=pack_name,
        pack_version=pack_version,
        end2end_prompt_version=PROMPT_VERSION,
        scaffold_prompt_version=SCAFFOLD_PROMPT_VERSION,
        repetitions=repetitions,
        scenario_ids=scenario_ids,
        excluded_probe_ids=excluded,
        episodes=tuple(episodes),
        summaries=tuple(
            _summarize(arm, episodes) for arm in ("end2end", "wm-scaffold")
        ),
    )


def write_matched_pair_report(report: MatchedPairReport, path: str | Path) -> None:
    Path(path).write_text(canonical_json(asdict(report)) + "\n", encoding="utf-8")
