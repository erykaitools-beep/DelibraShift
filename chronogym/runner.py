"""Minimal deterministic M0 episode runner and canonical JSONL logging."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from io import BytesIO
from typing import BinaryIO

from .agents import Agent
from .clock import advance_deliberation, latch_action
from .types import (
    AgentReply,
    GroundTruthState,
    Observation,
    SCHEMA_VERSION,
    ScenarioConfig,
    canonical_json,
)
from .world import build_observation, initial_state


@dataclass(frozen=True)
class CycleRecord:
    cycle: int
    observation: Observation
    reply: AgentReply
    prediction_target: GroundTruthState | None
    ticks_elapsed: int
    truncated: bool


@dataclass(frozen=True)
class EpisodeResult:
    episode_id: str
    final_state: GroundTruthState
    cycles: int
    log_bytes: bytes
    records: tuple[CycleRecord, ...]


def _write_line(stream: BinaryIO, payload: object) -> None:
    stream.write(canonical_json(payload).encode("utf-8") + b"\n")


def _reply_payload(reply: AgentReply) -> dict[str, object]:
    return asdict(reply)


def run_episode(
    config: ScenarioConfig,
    agent: Agent,
    *,
    stream: BinaryIO | None = None,
) -> EpisodeResult:
    """Run one episode; simulated time advances only by fixed B-tick windows."""
    owned_stream = BytesIO() if stream is None else None
    output = owned_stream if owned_stream is not None else stream
    assert output is not None

    episode_id = f"{config.scenario_id}:{config.seed}:{agent.name}"
    state = initial_state(config)
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
        )
        previous_heat = observation.heat
        reply = agent.act(observation)
        window = advance_deliberation(config, state)
        record = CycleRecord(
            cycle=cycle,
            observation=observation,
            reply=reply,
            prediction_target=None if window.truncated else window.state,
            ticks_elapsed=window.ticks_elapsed,
            truncated=window.truncated,
        )
        records.append(record)

        _write_line(
            output,
            {
                "type": "cycle",
                "cycle": record.cycle,
                "observation": asdict(record.observation),
                "reply": _reply_payload(record.reply),
                "prediction_target": (
                    None
                    if record.prediction_target is None
                    else asdict(record.prediction_target)
                ),
                "ticks_elapsed": record.ticks_elapsed,
                "truncated": record.truncated,
            },
        )
        state = window.state
        cycle += 1
        if state.done:
            break
        state = latch_action(config, state, reply.action)

    _write_line(
        output,
        {
            "type": "summary",
            "episode_id": episode_id,
            "cycles": cycle,
            "final_state": asdict(state),
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
    )
