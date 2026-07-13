from __future__ import annotations

from dataclasses import replace

import pytest

from chronogym.demo import demo_scenario
from chronogym.harness import HarnessAgent, parse_reply, render_prompt
from chronogym.runner import run_episode
from chronogym.types import NOOP_ACTION
from chronogym.world import build_observation, initial_state


class StubAdapter:
    name = "stub"

    def __init__(self, replies: list[str]) -> None:
        self.replies = replies
        self.calls: list[tuple[str, int | None]] = []

    def complete(
        self,
        prompt: str,
        *,
        max_tokens: int = 512,
        temperature: float = 0.0,
        seed: int | None = None,
    ) -> str:
        self.calls.append((prompt, seed))
        return self.replies[min(len(self.calls) - 1, len(self.replies) - 1)]


VALID = (
    '{"prediction":{"pos_x_m":1,"pos_y_m":2,"vel_x_mps":3,'
    '"vel_y_mps":4},"action":{"accel_x_mps2":5,"accel_y_mps2":6}}'
)


def observation():
    config = demo_scenario()
    return build_observation(
        config,
        initial_state(config),
        episode_id="harness-test",
        cycle=0,
    )


def test_parser_accepts_fences_surrounding_text_and_repairs_trivia() -> None:
    reply = parse_reply(f"```json\nintro {VALID} outro\n```")
    assert reply.action.accel_x_mps2 == 5.0
    assert reply.prediction is not None
    repaired = parse_reply(
        "{'prediction': {'pos_x_m': 1, 'pos_y_m': 2, 'vel_x_mps': 3, "
        "'vel_y_mps': 4,}, 'action': {'accel_x_mps2': 5, "
        "'accel_y_mps2': 6,},}"
    )
    assert repaired == reply


def test_invalid_prediction_keeps_valid_action_but_invalid_action_fails() -> None:
    reply = parse_reply(
        '{"prediction":{"pos_x_m":"oops"},'
        '"action":{"accel_x_mps2":1,"accel_y_mps2":2}}'
    )
    assert reply.prediction is None
    assert not reply.parse_failed
    with pytest.raises(ValueError, match="missing action field"):
        parse_reply('{"action":{"accel_x_mps2":1}}')
    with pytest.raises(ValueError, match="finite"):
        parse_reply('{"action":{"accel_x_mps2":1e999,"accel_y_mps2":0}}')


def test_prompt_makes_deliberation_timeline_and_schema_explicit() -> None:
    obs = observation()
    prompt = render_prompt(obs)
    assert f"advances {obs.deliberation_ticks} ticks" in prompt
    assert f"engages at tick {obs.tick + obs.deliberation_ticks}" in prompt
    assert '"prediction"' in prompt
    assert '"wind_forecast_x_mps2"' in prompt


def test_harness_retries_without_extra_sim_ticks_then_falls_back_to_noop() -> None:
    config = replace(demo_scenario(), deadline_tick=20)
    adapter = StubAdapter(["not json"])
    agent = HarnessAgent(adapter, seed=config.seed)
    result = run_episode(config, agent)

    first = result.records[0]
    assert len(adapter.calls) == 3
    assert [seed for _, seed in adapter.calls[:3]] == [config.seed] * 3
    assert first.reply.parse_failed
    assert first.reply.parse_retries == 2
    assert first.reply.action == NOOP_ACTION
    assert first.ticks_elapsed == config.deliberation_ticks
    assert first.prediction_target is not None


def test_harness_reports_retry_count_on_eventual_success() -> None:
    adapter = StubAdapter(["bad", VALID])
    agent = HarnessAgent(adapter, seed=42)
    reply = agent.act(observation())
    assert not reply.parse_failed
    assert reply.parse_retries == 1
    assert len(adapter.calls) == 2
