"""Harness-owned prompting, tolerant parsing, and fixed-budget retries."""

from __future__ import annotations

import json
import math
import re
import time
from dataclasses import asdict

from .types import (
    ACTION_FIELDS,
    EXAMPLE_REPLY_JSON,
    NOOP_ACTION,
    PREDICTION_FIELDS,
    REPLY_KEY_ACTION,
    REPLY_KEY_PREDICTION,
    Action,
    Adapter,
    AgentReply,
    Observation,
    Prediction,
    canonical_json,
)

PROMPT_VERSION = "draft-0.1"
MAX_PARSE_RETRIES = 2


def render_prompt(observation: Observation) -> str:
    """Render the draft v0 prompt with all SPEC section 7.2 requirements."""
    engage_tick = observation.tick + observation.deliberation_ticks
    return (
        "You control a craft in a deterministic 2D world. Units are meters, "
        "seconds, m/s, and m/s^2. Gravity acts downward; lateral wind and your "
        "currently held acceleration move the craft.\n\n"
        f"TIMELINE: the world advances {observation.deliberation_ticks} ticks "
        f"while you think. Your returned action engages at tick {engage_tick}, "
        "not at the observed tick. Predict the absolute true state at that "
        "engage tick.\n\n"
        f"Observation JSON:\n{canonical_json(asdict(observation))}\n\n"
        "Return one JSON object and nothing else, using exactly this schema:\n"
        f"{EXAMPLE_REPLY_JSON}\n"
    )


def _first_balanced_object(text: str) -> str | None:
    start = text.find("{")
    while start >= 0:
        depth = 0
        in_string = False
        quote = ""
        escaped = False
        for index in range(start, len(text)):
            character = text[index]
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
                if depth == 0:
                    return text[start : index + 1]
                if depth < 0:
                    break
        start = text.find("{", start + 1)
    return None


def _decode_payload(raw_text: str) -> dict[str, object]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, count=1, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text, count=1)
    block = _first_balanced_object(text)
    if block is None:
        raise ValueError("no balanced JSON object found")
    try:
        payload = json.loads(block)
    except json.JSONDecodeError:
        repaired = re.sub(r",\s*([}\]])", r"\1", block.replace("'", '"'))
        payload = json.loads(repaired)
    if not isinstance(payload, dict):
        raise ValueError("reply root must be an object")
    return payload


def _finite_number(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("field must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("field must be finite")
    return number


def parse_reply(raw_text: str, *, parse_retries: int = 0) -> AgentReply:
    """Tolerantly decode one reply; invalid prediction does not void its action."""
    payload = _decode_payload(raw_text)
    action_payload = payload.get(REPLY_KEY_ACTION)
    if not isinstance(action_payload, dict):
        raise ValueError("action must be an object")
    try:
        action_values = [_finite_number(action_payload[field]) for field in ACTION_FIELDS]
    except KeyError as error:
        raise ValueError(f"missing action field: {error.args[0]}") from error

    prediction = None
    prediction_payload = payload.get(REPLY_KEY_PREDICTION)
    if isinstance(prediction_payload, dict):
        try:
            values = {
                field: _finite_number(prediction_payload[field])
                for field in PREDICTION_FIELDS
            }
            prediction = Prediction(**values)
        except (KeyError, ValueError):
            prediction = None

    return AgentReply(
        action=Action(*action_values),
        prediction=prediction,
        parse_failed=False,
        parse_retries=parse_retries,
    )


class HarnessAgent:
    """Wrap a raw-text transport as a typed agent without advancing sim on retries."""

    prompt_version = PROMPT_VERSION

    def __init__(self, adapter: Adapter, *, seed: int, max_parse_retries: int = 2) -> None:
        if max_parse_retries < 0:
            raise ValueError("max_parse_retries must be non-negative")
        self.adapter = adapter
        self.seed = seed
        self.max_parse_retries = max_parse_retries
        self.name = adapter.name
        self.wall_clock_ms_telemetry_only = 0.0

    def act(self, observation: Observation) -> AgentReply:
        prompt = render_prompt(observation)
        started = time.perf_counter()
        try:
            for retry in range(self.max_parse_retries + 1):
                retry_prompt = prompt
                if retry:
                    retry_prompt += (
                        "\nYour previous reply had an invalid action. Return only the "
                        "required JSON object with both finite action fields.\n"
                    )
                raw = self.adapter.complete(
                    retry_prompt,
                    max_tokens=512,
                    temperature=0.0,
                    seed=self.seed + observation.cycle,
                )
                try:
                    return parse_reply(raw, parse_retries=retry)
                except (ValueError, json.JSONDecodeError):
                    continue
            return AgentReply(
                action=NOOP_ACTION,
                prediction=None,
                parse_failed=True,
                parse_retries=self.max_parse_retries,
            )
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            self.wall_clock_ms_telemetry_only += elapsed_ms
