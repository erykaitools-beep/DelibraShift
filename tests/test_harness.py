from __future__ import annotations

from dataclasses import replace

import pytest

from delibrashift.demo import demo_scenario
from delibrashift.harness import (
    HarnessAgent,
    parse_choice_reply,
    parse_reply,
    render_prompt,
)
from delibrashift.runner import run_episode
from delibrashift.types import NOOP_ACTION
from delibrashift.world import build_observation, initial_state


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
    assert reply.prediction_parse_failed
    invalid_action = parse_reply('{"action":{"accel_x_mps2":1}}')
    assert invalid_action.parse_failed
    assert invalid_action.action == NOOP_ACTION
    nonfinite = parse_reply(
        '{"prediction":{},"action":{"accel_x_mps2":1e999,"accel_y_mps2":0}}'
    )
    assert nonfinite.parse_failed


def test_parser_uses_last_self_corrected_object_and_ignores_braces_in_strings() -> None:
    first = VALID.replace('"accel_x_mps2":5', '"accel_x_mps2":1')
    last = VALID.replace('"vel_y_mps":4', '"vel_y_mps":8')
    reply = parse_reply(f'{first}\n{{"note":"brace }} inside"}}\n{last}')
    assert reply.action.accel_x_mps2 == 5.0
    assert reply.prediction is not None
    assert reply.prediction.vel_y_mps == 8.0


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
def test_parser_rejects_non_json_constants(constant) -> None:
    raw = VALID.replace('"accel_x_mps2":5', f'"accel_x_mps2":{constant}')
    with pytest.raises(ValueError, match="required keys"):
        parse_reply(raw)


def test_forced_choice_parser_is_strict() -> None:
    assert parse_choice_reply('{"choice":"A"}').choice == "A"
    assert parse_choice_reply('{"choice":"C"}').parse_failed


def test_prompt_makes_deliberation_timeline_and_schema_explicit() -> None:
    obs = observation()
    prompt = render_prompt(obs)
    assert f"advances {obs.deliberation_ticks} ticks" in prompt
    assert f"engages at tick {obs.tick + obs.deliberation_ticks}" in prompt
    assert "PREVIOUSLY LATCHED" in prompt
    assert "HELD action" in prompt
    assert '"prediction"' in prompt
    assert '"wind_forecast_x_mps2"' in prompt


def test_harness_retries_without_extra_sim_ticks_then_falls_back_to_noop() -> None:
    config = replace(demo_scenario(), deadline_tick=20)
    adapter = StubAdapter(["not json"])
    agent = HarnessAgent(adapter, repetition=2)
    result = run_episode(config, agent)

    first = result.records[0]
    assert len(adapter.calls) == 3
    assert [seed for _, seed in adapter.calls[:3]] == [2] * 3
    assert first.reply.parse_failed
    assert first.reply.parse_retries == 2
    assert first.reply.action == NOOP_ACTION
    assert first.ticks_elapsed == config.deliberation_ticks
    assert first.prediction_target is not None
    assert first.raw_completion_text == "not json"
    assert first.raw_completions == ("not json", "not json", "not json")
    assert first.wall_clock_ms_telemetry_only >= 0.0


def test_harness_reports_retry_count_on_eventual_success() -> None:
    adapter = StubAdapter(["bad", VALID])
    agent = HarnessAgent(adapter, repetition=1)
    reply = agent.act(observation())
    assert not reply.parse_failed
    assert reply.parse_retries == 1
    assert len(adapter.calls) == 2


def test_harness_retries_prediction_failure_and_preserves_final_action() -> None:
    action_only = '{"action":{"accel_x_mps2":1,"accel_y_mps2":2}}'
    adapter = StubAdapter([action_only])
    reply = HarnessAgent(adapter, repetition=0).act(observation())
    assert len(adapter.calls) == 3
    assert not reply.parse_failed
    assert reply.prediction_parse_failed
    assert reply.action.accel_x_mps2 == 1.0
    assert reply.parse_retries == 2


def test_masked_prompt_keeps_null_goal_keys() -> None:
    config = replace(demo_scenario(), goal_visible=False)
    obs = build_observation(
        config,
        initial_state(config),
        episode_id="masked",
        cycle=0,
    )
    prompt = render_prompt(obs)
    assert '"goal_x_m":null' in prompt
    assert '"goal_y_m":null' in prompt
