"""Harness-owned prompting, tolerant parsing, and fixed-budget retries."""

from __future__ import annotations

import json
import math
import re
import time
from dataclasses import asdict, dataclass

from .types import (
    ACTION_FIELDS,
    CHOICE_VALUES,
    EXAMPLE_REPLY_JSON,
    NOOP_ACTION,
    PREDICTION_FIELDS,
    REPLY_KEY_ACTION,
    REPLY_KEY_CHOICE,
    REPLY_KEY_PREDICTION,
    Action,
    Adapter,
    AgentReply,
    Observation,
    Prediction,
    ScenarioConfig,
    canonical_json,
)
from .probes import (
    CHOICE_PROBE_PROMPT_VERSION,
    FORMAT_PROBE_PROMPT_VERSION,
    render_forced_choice_prompt,
    render_format_probe_prompt,
)

PROMPT_VERSION = "1.0"
MAX_PARSE_RETRIES = 2


@dataclass
class TransportPacer:
    """Shared start-to-start call pacing; wall time remains telemetry only."""

    min_interval_s: float = 0.0
    _last_call_started: float | None = None

    def wait(self) -> None:
        now = time.monotonic()
        if self._last_call_started is not None:
            remaining = self.min_interval_s - (now - self._last_call_started)
            if remaining > 0.0:
                time.sleep(remaining)
                now = time.monotonic()
        self._last_call_started = now


def render_prompt(observation: Observation) -> str:
    """Render frozen standard prompt version 1.0 per SPEC section 7.2."""
    engage_tick = observation.tick + observation.deliberation_ticks
    return (
        "You control a craft in a deterministic 2D world. Units are meters, "
        "seconds, m/s, and m/s^2. Gravity acts downward; lateral wind and your "
        "currently held acceleration move the craft.\n\n"
        f"TIMELINE: the world advances {observation.deliberation_ticks} ticks "
        f"while you think. Your returned action engages at tick {engage_tick}, "
        "not at the observed tick. During those ticks the PREVIOUSLY LATCHED "
        "action in held_accel_x_mps2 and held_accel_y_mps2 keeps applying. "
        "Predict the absolute true state at engage time under that HELD action, "
        "not under the new action you return.\n\n"
        f"Observation JSON:\n{canonical_json(asdict(observation))}\n\n"
        "Return one JSON object and nothing else, using exactly this schema:\n"
        f"{EXAMPLE_REPLY_JSON}\n"
    )


def _balanced_objects(text: str) -> list[str]:
    objects: list[str] = []
    start = None
    depth = 0
    in_string = False
    quote = ""
    escaped = False
    for index, character in enumerate(text):
        if depth == 0:
            if character == "{":
                start = index
                depth = 1
            continue
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                in_string = False
            continue
        if character in {'"', "'"}:
            in_string = True
            quote = character
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0 and start is not None:
                objects.append(text[start : index + 1])
                start = None
    return objects


def _reject_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")


def _parse_object(block: str) -> dict[str, object]:
    try:
        payload = json.loads(block, parse_constant=_reject_constant)
    except (json.JSONDecodeError, ValueError):
        repaired = re.sub(r",\s*([}\]])", r"\1", block.replace("'", '"'))
        payload = json.loads(repaired, parse_constant=_reject_constant)
    if not isinstance(payload, dict):
        raise ValueError("reply root must be an object")
    return payload


def _decode_payload(
    raw_text: str,
    *,
    required_keys: set[str],
) -> dict[str, object]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, count=1, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text, count=1)
    blocks = _balanced_objects(text)
    if not blocks:
        raise ValueError("no balanced JSON object found")
    partial = None
    for block in reversed(blocks):
        try:
            payload = _parse_object(block)
        except (json.JSONDecodeError, ValueError):
            continue
        if required_keys <= payload.keys():
            return payload
        if partial is None and required_keys & payload.keys():
            partial = payload
    if partial is not None:
        return partial
    raise ValueError("no balanced JSON object with required keys found")


def _finite_number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("field must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("field must be finite")
    return number


def parse_reply(
    raw_text: str,
    *,
    parse_retries: int = 0,
    prediction_requested: bool = True,
) -> AgentReply:
    """Decode action and prediction independently for attribution accounting."""
    required = {REPLY_KEY_ACTION}
    if prediction_requested:
        required.add(REPLY_KEY_PREDICTION)
    payload = _decode_payload(raw_text, required_keys=required)
    action_payload = payload.get(REPLY_KEY_ACTION)
    try:
        if not isinstance(action_payload, dict):
            raise ValueError("action must be an object")
        action_values = [_finite_number(action_payload[field]) for field in ACTION_FIELDS]
        action = Action(*action_values)
        action_failed = False
    except (KeyError, ValueError):
        action = NOOP_ACTION
        action_failed = True

    prediction = None
    prediction_failed = prediction_requested
    prediction_payload = payload.get(REPLY_KEY_PREDICTION)
    if prediction_requested and isinstance(prediction_payload, dict):
        try:
            values = {
                field: _finite_number(prediction_payload[field])
                for field in PREDICTION_FIELDS
            }
            prediction = Prediction(**values)
            prediction_failed = False
        except (KeyError, ValueError):
            prediction = None

    return AgentReply(
        action=action,
        prediction=prediction,
        parse_failed=action_failed,
        parse_retries=parse_retries,
        prediction_parse_failed=prediction_failed,
    )


def parse_prediction_reply(raw_text: str, *, parse_retries: int = 0) -> AgentReply:
    """Parse the WM-SCAFFOLD prediction-only stage."""
    payload = _decode_payload(raw_text, required_keys={REPLY_KEY_PREDICTION})
    prediction_payload = payload.get(REPLY_KEY_PREDICTION)
    try:
        if not isinstance(prediction_payload, dict):
            raise ValueError("prediction must be an object")
        values = {
            field: _finite_number(prediction_payload[field])
            for field in PREDICTION_FIELDS
        }
        prediction = Prediction(**values)
        failed = False
    except (KeyError, ValueError):
        prediction = None
        failed = True
    return AgentReply(
        action=NOOP_ACTION,
        prediction=prediction,
        parse_retries=parse_retries,
        prediction_parse_failed=failed,
    )


def parse_action_reply(raw_text: str, *, parse_retries: int = 0) -> AgentReply:
    """Parse the WM-SCAFFOLD action-only stage."""
    return parse_reply(
        raw_text,
        parse_retries=parse_retries,
        prediction_requested=False,
    )


def parse_choice_reply(raw_text: str, *, parse_retries: int = 0) -> AgentReply:
    payload = _decode_payload(raw_text, required_keys={REPLY_KEY_CHOICE})
    choice = payload.get(REPLY_KEY_CHOICE)
    valid = isinstance(choice, str) and choice in CHOICE_VALUES
    return AgentReply(
        action=NOOP_ACTION,
        prediction=None,
        parse_failed=not valid,
        parse_retries=parse_retries,
        choice=choice if valid else None,
    )


class HarnessAgent:
    """Wrap a raw-text transport as a typed agent without advancing sim on retries."""

    prompt_version = PROMPT_VERSION

    def __init__(
        self,
        adapter: Adapter,
        *,
        repetition: int = 0,
        max_parse_retries: int = 2,
        prediction_requested: bool = True,
        probe_config: ScenarioConfig | None = None,
        transport_pacer: TransportPacer | None = None,
        max_transport_retries: int = 2,
        transport_backoff_s: float = 1.0,
        arm_name: str | None = None,
    ) -> None:
        if max_parse_retries < 0:
            raise ValueError("max_parse_retries must be non-negative")
        if repetition < 0:
            raise ValueError("repetition must be non-negative")
        if max_transport_retries < 0 or transport_backoff_s < 0.0:
            raise ValueError("transport retry settings must be non-negative")
        self.adapter = adapter
        self.repetition = repetition
        self.max_parse_retries = max_parse_retries
        self.probe_config = probe_config
        tags = set(probe_config.axis_tags) if probe_config is not None else set()
        probe_tags = tags & {"probe:forced_choice", "probe:format"}
        if probe_config is not None and len(probe_tags) != 1:
            raise ValueError("probe_config must contain exactly one supported probe tag")
        self.probe_kind = None
        if "probe:forced_choice" in tags:
            self.probe_kind = "forced_choice"
        elif "probe:format" in tags:
            self.probe_kind = "format"
        self.prediction_requested = (
            False if self.probe_kind == "forced_choice" else prediction_requested
        )
        self.prompt_version = {
            "forced_choice": CHOICE_PROBE_PROMPT_VERSION,
            "format": FORMAT_PROBE_PROMPT_VERSION,
        }.get(self.probe_kind, PROMPT_VERSION)
        self.name = f"{adapter.name}:{arm_name}" if arm_name else adapter.name
        self.transport_pacer = transport_pacer or TransportPacer()
        self.max_transport_retries = max_transport_retries
        self.transport_backoff_s = transport_backoff_s
        self.wall_clock_ms_telemetry_only = 0.0
        self.transport_retries = 0
        self.last_raw_completion: str | None = None
        self.last_raw_completions: tuple[str, ...] = ()
        self.last_wall_clock_ms = 0.0

    def _complete(self, prompt: str) -> str:
        for retry in range(self.max_transport_retries + 1):
            self.transport_pacer.wait()
            try:
                return self.adapter.complete(
                    prompt,
                    max_tokens=512,
                    temperature=0.0,
                    seed=self.repetition,
                )
            except Exception:
                if retry == self.max_transport_retries:
                    raise
                self.transport_retries += 1
                time.sleep(self.transport_backoff_s * (2**retry))
        raise AssertionError("unreachable transport retry state")

    def act(self, observation: Observation) -> AgentReply:
        if (
            self.probe_config is not None
            and observation.scenario_id != self.probe_config.scenario_id
        ):
            raise ValueError("probe config and observation scenario_id must match")
        if self.probe_kind == "forced_choice":
            assert self.probe_config is not None
            prompt = render_forced_choice_prompt(self.probe_config, observation)
        elif self.probe_kind == "format":
            prompt = render_format_probe_prompt(observation)
        else:
            prompt = render_prompt(observation)
        started = time.perf_counter()
        raw_completions: list[str] = []
        try:
            for retry in range(self.max_parse_retries + 1):
                retry_prompt = prompt
                if retry:
                    if self.probe_kind == "forced_choice":
                        retry_prompt += (
                            '\nThe prior reply was invalid. Replace it with only '
                            '{"choice": "A"} or {"choice": "B"}.\n'
                        )
                    else:
                        retry_prompt += (
                            "\nThe prior reply had an invalid action or prediction. "
                            "Replace it with only the required JSON object containing "
                            "all finite numeric fields.\n"
                        )
                raw = self._complete(retry_prompt)
                raw_completions.append(raw)
                self.last_raw_completion = raw
                try:
                    if self.probe_kind == "forced_choice":
                        reply = parse_choice_reply(raw, parse_retries=retry)
                    else:
                        reply = parse_reply(
                            raw,
                            parse_retries=retry,
                            prediction_requested=self.prediction_requested,
                        )
                except (ValueError, json.JSONDecodeError):
                    continue
                if not reply.parse_failed and not reply.prediction_parse_failed:
                    return reply
                if retry == self.max_parse_retries:
                    return reply
            return AgentReply(
                action=NOOP_ACTION,
                prediction=None,
                parse_failed=True,
                parse_retries=self.max_parse_retries,
                prediction_parse_failed=self.prediction_requested,
            )
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            self.last_raw_completions = tuple(raw_completions)
            self.last_wall_clock_ms = elapsed_ms
            self.wall_clock_ms_telemetry_only += elapsed_ms
