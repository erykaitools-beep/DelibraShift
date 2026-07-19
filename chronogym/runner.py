"""Minimal deterministic M0 episode runner and canonical JSONL logging."""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from io import BytesIO
import json
from pathlib import Path
import platform
from typing import BinaryIO

from .agents import Agent
from .clock import advance_deliberation, latch_action
from .types import (
    Action,
    AgentReply,
    GroundTruthState,
    NOOP_ACTION,
    Observation,
    Prediction,
    PRED_POS_TOL_M,
    PRED_VEL_TOL_MPS,
    SCHEMA_VERSION,
    ScenarioConfig,
    canonical_json,
)
from .world import build_observation, initial_state


@dataclass(frozen=True)
class CycleRecord:
    episode_id: str
    cycle: int
    tick: int
    engage_tick: int
    observation: Observation
    reply: AgentReply
    prediction_target: GroundTruthState | None
    ticks_elapsed: int
    truncated: bool
    prediction_requested: bool
    action_engaged: bool
    engaged_action: Action | None
    example_echo: bool
    probe_match: str | None
    raw_completion_text: str | None
    raw_completions: tuple[str, ...]
    wall_clock_ms_telemetry_only: float


@dataclass(frozen=True)
class EpisodeResult:
    episode_id: str
    final_state: GroundTruthState
    cycles: int
    log_bytes: bytes
    records: tuple[CycleRecord, ...]
    closest_approach_m: float
    wall_clock_ms_telemetry_only: float
    transport_retries: int


def load_episode_result(
    path: str | Path,
    *,
    scenario_id: str,
    agent_name: str,
    prompt_version: str,
    pack_name: str | None,
    pack_version: str | None,
    host_class: str,
    scenario_ids: tuple[str, ...],
) -> EpisodeResult:
    """Load and strictly validate one completed canonical log for resume."""
    log_bytes = Path(path).read_bytes()
    raw_lines = log_bytes.decode("utf-8").splitlines()
    if len(raw_lines) < 2:
        raise ValueError(f"incomplete episode log: {path}")
    payloads = [json.loads(line) for line in raw_lines]
    if any(canonical_json(payload) != line for payload, line in zip(payloads, raw_lines)):
        raise ValueError(f"non-canonical episode log: {path}")
    manifest, *cycle_payloads, summary = payloads
    expected_manifest = {
        "type": "manifest",
        "scenario_id": scenario_id,
        "agent": agent_name,
        "prompt_version": prompt_version,
        "pack_name": pack_name,
        "pack_version": pack_version,
        "host_class": host_class,
        "scenario_ids": list(scenario_ids),
        "schema_version": SCHEMA_VERSION,
    }
    for key, expected in expected_manifest.items():
        if manifest.get(key) != expected:
            raise ValueError(f"resume manifest mismatch for {key}: {path}")
    if summary.get("type") != "summary" or summary.get("cycles") != len(cycle_payloads):
        raise ValueError(f"incomplete episode summary: {path}")

    records: list[CycleRecord] = []
    episode_id = manifest.get("episode_id")
    for index, payload in enumerate(cycle_payloads):
        if payload.get("type") != "cycle" or payload.get("cycle") != index:
            raise ValueError(f"invalid cycle ordering: {path}")
        observation_payload = dict(payload["observation"])
        observation_payload["wind_forecast_x_mps2"] = tuple(
            observation_payload["wind_forecast_x_mps2"]
        )
        reply_payload = dict(payload["reply"])
        reply_payload["action"] = Action(**reply_payload["action"])
        if reply_payload["prediction"] is not None:
            reply_payload["prediction"] = Prediction(**reply_payload["prediction"])
        target = payload["prediction_target"]
        engaged_action = payload["engaged_action"]
        records.append(
            CycleRecord(
                episode_id=payload["episode_id"],
                cycle=payload["cycle"],
                tick=payload["tick"],
                engage_tick=payload["engage_tick"],
                observation=Observation(**observation_payload),
                reply=AgentReply(**reply_payload),
                prediction_target=(
                    None if target is None else GroundTruthState(**target)
                ),
                ticks_elapsed=payload["ticks_elapsed"],
                truncated=payload["truncated"],
                prediction_requested=payload["prediction_requested"],
                action_engaged=payload["action_engaged"],
                engaged_action=(
                    None if engaged_action is None else Action(**engaged_action)
                ),
                example_echo=payload["example_echo"],
                probe_match=payload["probe_match"],
                raw_completion_text=payload["raw_completion_text"],
                raw_completions=tuple(payload["raw_completions"]),
                wall_clock_ms_telemetry_only=payload[
                    "wall_clock_ms_telemetry_only"
                ],
            )
        )
    if any(record.episode_id != episode_id for record in records):
        raise ValueError(f"episode id mismatch: {path}")
    final_state = GroundTruthState(**summary["final_state"])
    if summary.get("episode_id") != episode_id or not final_state.done:
        raise ValueError(f"invalid terminal summary: {path}")
    return EpisodeResult(
        episode_id=episode_id,
        final_state=final_state,
        cycles=len(records),
        log_bytes=log_bytes,
        records=tuple(records),
        closest_approach_m=summary["closest_approach_m"],
        wall_clock_ms_telemetry_only=summary["wall_clock_ms_telemetry_only"],
        transport_retries=summary["transport_retries"],
    )


def _write_line(stream: BinaryIO, payload: object) -> None:
    stream.write(canonical_json(payload).encode("utf-8") + b"\n")


def _reply_payload(reply: AgentReply) -> dict[str, object]:
    return asdict(reply)


def _is_example_echo(reply: AgentReply) -> bool:
    prediction = reply.prediction
    if prediction is None:
        return False
    return all(
        error <= 2.0
        for error in (
            abs(prediction.pos_x_m - 7.5) / PRED_POS_TOL_M,
            abs(prediction.pos_y_m - 12.25) / PRED_POS_TOL_M,
            abs(prediction.vel_x_mps + 4.5) / PRED_VEL_TOL_MPS,
            abs(prediction.vel_y_mps - 2.75) / PRED_VEL_TOL_MPS,
        )
    )


def run_episode(
    config: ScenarioConfig,
    agent: Agent,
    *,
    stream: BinaryIO | None = None,
    pack_name: str | None = None,
    pack_version: str | None = None,
    host_class: str | None = None,
    scenario_ids: tuple[str, ...] | None = None,
    heat_goal_m: tuple[float, float] | None = None,
) -> EpisodeResult:
    """Run one episode; simulated time advances only by fixed B-tick windows."""
    owned_stream = BytesIO() if stream is None else None
    output = owned_stream if owned_stream is not None else stream
    assert output is not None

    episode_id = f"{config.scenario_id}:{config.seed}:{agent.name}"
    state = initial_state(config)
    closest_approach = state.distance_to_goal_m
    _write_line(
        output,
        {
            "type": "manifest",
            "schema_version": SCHEMA_VERSION,
            "scenario_id": config.scenario_id,
            "seed": config.seed,
            "agent": agent.name,
            "episode_id": episode_id,
            "prompt_version": getattr(agent, "prompt_version", "typed-local-v1"),
            "pack_name": pack_name,
            "pack_version": pack_version,
            "scenario_ids": list(scenario_ids or (config.scenario_id,)),
            "host_class": host_class or platform.machine() or "unknown",
        },
    )

    cycle = 0
    records: list[CycleRecord] = []
    previous_heat = None
    while not state.done:
        observation = build_observation(
            config,
            state,
            episode_id=episode_id,
            cycle=cycle,
            previous_heat=previous_heat,
            heat_goal_m=heat_goal_m,
        )
        previous_heat = observation.heat
        reply = agent.act(observation)
        window = advance_deliberation(config, state)
        closest_approach = min(
            closest_approach,
            window.min_distance_to_goal_m,
        )
        action_engaged = not window.state.done
        commanded_action = (
            NOOP_ACTION
            if any(tag.startswith("probe:") for tag in config.axis_tags)
            else reply.action
        )
        engaged_state = (
            latch_action(config, window.state, commanded_action)
            if action_engaged
            else window.state
        )
        engaged_action = (
            Action(
                engaged_state.held_accel_x_mps2,
                engaged_state.held_accel_y_mps2,
            )
            if action_engaged
            else None
        )
        record = CycleRecord(
            episode_id=episode_id,
            cycle=cycle,
            tick=observation.tick,
            engage_tick=observation.tick + observation.deliberation_ticks,
            observation=observation,
            reply=reply,
            prediction_target=None if window.truncated else window.state,
            ticks_elapsed=window.ticks_elapsed,
            truncated=window.truncated,
            prediction_requested="probe:forced_choice" not in config.axis_tags,
            action_engaged=action_engaged,
            engaged_action=engaged_action,
            example_echo=_is_example_echo(reply),
            probe_match=None,
            raw_completion_text=getattr(agent, "last_raw_completion", None),
            raw_completions=getattr(agent, "last_raw_completions", ()),
            wall_clock_ms_telemetry_only=getattr(
                agent,
                "last_wall_clock_ms",
                0.0,
            ),
        )
        if "probe:format" in config.axis_tags:
            from .probes import format_probe_match

            record = replace(record, probe_match=format_probe_match(record))
        records.append(record)

        _write_line(
            output,
            {
                "type": "cycle",
                "cycle": record.cycle,
                "episode_id": record.episode_id,
                "tick": record.tick,
                "engage_tick": record.engage_tick,
                "observation": asdict(record.observation),
                "reply": _reply_payload(record.reply),
                "prediction_target": (
                    None
                    if record.prediction_target is None
                    else asdict(record.prediction_target)
                ),
                "ticks_elapsed": record.ticks_elapsed,
                "truncated": record.truncated,
                "prediction_requested": record.prediction_requested,
                "action_engaged": record.action_engaged,
                "engaged_action": (
                    None
                    if record.engaged_action is None
                    else asdict(record.engaged_action)
                ),
                "example_echo": record.example_echo,
                "probe_match": record.probe_match,
                "raw_completion_text": record.raw_completion_text,
                "raw_completions": record.raw_completions,
                "wall_clock_ms_telemetry_only": (
                    record.wall_clock_ms_telemetry_only
                ),
            },
        )
        state = engaged_state
        cycle += 1
        if state.done:
            break

    _write_line(
        output,
        {
            "type": "summary",
            "episode_id": episode_id,
            "cycles": cycle,
            "final_state": asdict(state),
            "closest_approach_m": closest_approach,
            "wall_clock_ms_telemetry_only": getattr(
                agent,
                "wall_clock_ms_telemetry_only",
                0.0,
            ),
            "transport_retries": getattr(agent, "transport_retries", 0),
            "retried_cycle_rate": (
                sum(record.reply.parse_retries > 0 for record in records) / cycle
                if cycle
                else 0.0
            ),
            "example_echo_count": sum(record.example_echo for record in records),
        },
    )

    if owned_stream is not None:
        log_bytes = owned_stream.getvalue()
    elif isinstance(stream, BytesIO):
        log_bytes = stream.getvalue()
    else:
        log_bytes = b""
    return EpisodeResult(
        episode_id=episode_id,
        final_state=state,
        cycles=cycle,
        log_bytes=log_bytes,
        records=tuple(records),
        closest_approach_m=closest_approach,
        wall_clock_ms_telemetry_only=getattr(
            agent,
            "wall_clock_ms_telemetry_only",
            0.0,
        ),
        transport_retries=getattr(agent, "transport_retries", 0),
    )
