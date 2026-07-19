"""Two-stage WM-SCAFFOLD treatment arm (SPEC section 8; keep under 150 lines)."""

from __future__ import annotations

import json
import time
from dataclasses import asdict, replace
from typing import Callable

from .harness import HarnessAgent, parse_action_reply, parse_prediction_reply
from .types import AgentReply, NOOP_ACTION, Observation, Prediction, canonical_json


SCAFFOLD_PROMPT_VERSION = "wm-scaffold-1.0"


def _world_context(observation: Observation) -> str:
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
    )


def render_prediction_prompt(observation: Observation) -> str:
    return (
        _world_context(observation)
        + "STAGE 1 — WORLD MODEL: Return only your predicted absolute state at "
        "engage time as one JSON object and nothing else, using exactly this "
        "schema:\n"
        '{"prediction":{"pos_x_m":7.5,"pos_y_m":12.25,'
        '"vel_x_mps":-4.5,"vel_y_mps":2.75}}\n'
    )


def render_action_prompt(
    observation: Observation,
    prediction: Prediction | None,
) -> str:
    predicted_payload = None if prediction is None else asdict(prediction)
    return (
        "STAGE 2 — POLICY: Choose the RAW acceleration command that engages at "
        f"tick {observation.tick + observation.deliberation_ticks}. The harness "
        "will clamp it once. Base the action on the state below, which is YOUR "
        "OWN stage-1 prediction at engage time; it is not simulator truth.\n\n"
        f"Your predicted state at engage time:\n{canonical_json(predicted_payload)}\n\n"
        f"Original Observation JSON:\n{canonical_json(asdict(observation))}\n\n"
        "Return one JSON object and nothing else, using exactly this schema:\n"
        '{"action":{"accel_x_mps2":0.75,"accel_y_mps2":-1.25}}\n'
    )


class WMScaffoldAgent(HarnessAgent):
    """Two adapter calls per cycle, with no access to simulator truth."""

    prompt_version = SCAFFOLD_PROMPT_VERSION

    def __init__(self, adapter, **kwargs) -> None:
        super().__init__(
            adapter,
            prediction_requested=True,
            arm_name="wm-scaffold",
            **kwargs,
        )
        self.prompt_version = SCAFFOLD_PROMPT_VERSION

    def _stage(
        self,
        prompt: str,
        parser: Callable[..., AgentReply],
        failure: AgentReply,
    ) -> tuple[AgentReply, list[str]]:
        completions: list[str] = []
        for retry in range(self.max_parse_retries + 1):
            retry_prompt = prompt
            if retry:
                retry_prompt += (
                    "\nThe prior reply was invalid. Replace it with only the "
                    "required JSON object containing all finite fields.\n"
                )
            raw = self._complete(retry_prompt)
            completions.append(raw)
            try:
                reply = parser(raw, parse_retries=retry)
            except (ValueError, json.JSONDecodeError):
                continue
            if not reply.parse_failed and not reply.prediction_parse_failed:
                return reply, completions
            if retry == self.max_parse_retries:
                return reply, completions
        return replace(failure, parse_retries=self.max_parse_retries), completions

    def act(self, observation: Observation) -> AgentReply:
        started = time.perf_counter()
        all_completions: list[str] = []
        try:
            prediction_reply, first = self._stage(
                render_prediction_prompt(observation),
                parse_prediction_reply,
                AgentReply(NOOP_ACTION, None, prediction_parse_failed=True),
            )
            all_completions.extend(first)
            action_reply, second = self._stage(
                render_action_prompt(observation, prediction_reply.prediction),
                parse_action_reply,
                AgentReply(NOOP_ACTION, None, parse_failed=True),
            )
            all_completions.extend(second)
            return AgentReply(
                action=action_reply.action,
                prediction=prediction_reply.prediction,
                parse_failed=action_reply.parse_failed,
                parse_retries=(
                    prediction_reply.parse_retries + action_reply.parse_retries
                ),
                prediction_parse_failed=prediction_reply.prediction_parse_failed,
            )
        finally:
            elapsed = (time.perf_counter() - started) * 1000.0
            self.last_raw_completions = tuple(all_completions)
            self.last_raw_completion = all_completions[-1] if all_completions else None
            self.last_wall_clock_ms = elapsed
            self.wall_clock_ms_telemetry_only += elapsed
