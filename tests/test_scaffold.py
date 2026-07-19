from __future__ import annotations

import hashlib
import json
from pathlib import Path

from chronogym.bank import load_pack
from chronogym.demo import demo_scenario
from chronogym.harness import HarnessAgent, TransportPacer
from chronogym.runner import run_episode
from chronogym.scaffold import (
    WMScaffoldAgent,
    render_action_prompt,
    render_prediction_prompt,
)
from chronogym.types import Prediction
from chronogym.world import build_observation, initial_state


PREDICTION = (
    '{"prediction":{"pos_x_m":21,"pos_y_m":68,'
    '"vel_x_mps":2,"vel_y_mps":-5}}'
)
ACTION = '{"action":{"accel_x_mps2":8,"accel_y_mps2":3}}'


class StubAdapter:
    name = "stub-model"

    def __init__(self, replies) -> None:
        self.replies = list(replies)
        self.calls = []

    def complete(self, prompt, *, max_tokens=512, temperature=0.0, seed=None):
        self.calls.append((prompt, seed))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def observation():
    config = demo_scenario()
    return build_observation(
        config,
        initial_state(config),
        episode_id="scaffold-test",
        cycle=0,
    )


def test_scaffold_uses_two_calls_and_feeds_own_prediction_to_policy() -> None:
    adapter = StubAdapter([PREDICTION, ACTION])
    agent = WMScaffoldAgent(adapter, repetition=2)
    reply = agent.act(observation())
    assert reply.prediction == Prediction(21.0, 68.0, 2.0, -5.0)
    assert reply.action.accel_x_mps2 == 8.0
    assert [seed for _, seed in adapter.calls] == [2, 2]
    assert "YOUR OWN stage-1 prediction" in adapter.calls[1][0]
    assert '"pos_x_m":21.0' in adapter.calls[1][0]
    assert agent.last_raw_completions == (PREDICTION, ACTION)
    assert agent.name == "stub-model:wm-scaffold"


def test_scaffold_prediction_failure_still_runs_policy_with_null() -> None:
    adapter = StubAdapter(["bad", "bad", "bad", ACTION])
    reply = WMScaffoldAgent(adapter).act(observation())
    assert reply.prediction is None
    assert reply.prediction_parse_failed
    assert not reply.parse_failed
    assert reply.parse_retries == 2
    assert "engage time:\nnull" in adapter.calls[-1][0]


def test_scaffold_action_failure_preserves_valid_prediction() -> None:
    adapter = StubAdapter([PREDICTION, "bad", "bad", "bad"])
    reply = WMScaffoldAgent(adapter).act(observation())
    assert reply.prediction is not None
    assert not reply.prediction_parse_failed
    assert reply.parse_failed
    assert reply.parse_retries == 2


def test_action_prompt_contains_only_observation_and_agents_prediction() -> None:
    prompt = render_action_prompt(observation(), Prediction(1.0, 2.0, 3.0, 4.0))
    assert "simulator truth" in prompt
    assert "prediction_target" not in prompt
    assert json.dumps(1.0) in prompt


def test_shared_pacer_and_transport_retry_are_harness_owned(monkeypatch) -> None:
    sleeps = []
    times = iter((0.0, 0.25, 1.5))
    monkeypatch.setattr("chronogym.harness.time.monotonic", lambda: next(times))
    monkeypatch.setattr("chronogym.harness.time.sleep", sleeps.append)
    pacer = TransportPacer(min_interval_s=1.5)
    adapter = StubAdapter([ACTION, ACTION])
    agent = HarnessAgent(adapter, prediction_requested=False, transport_pacer=pacer)
    agent._complete("first")
    agent._complete("second")
    assert sleeps == [1.25]

    retry_sleeps = []
    monkeypatch.setattr("chronogym.harness.time.monotonic", lambda: 2.0)
    monkeypatch.setattr("chronogym.harness.time.sleep", retry_sleeps.append)
    retry_adapter = StubAdapter([RuntimeError("temporary"), ACTION])
    retry_agent = HarnessAgent(
        retry_adapter,
        prediction_requested=False,
        transport_backoff_s=0.5,
    )
    assert retry_agent._complete("retry") == ACTION
    assert retry_agent.transport_retries == 1
    assert retry_sleeps == [0.5]


def test_scaffold_episode_consumes_one_sim_window_per_two_model_calls() -> None:
    config = demo_scenario()
    adapter = StubAdapter([PREDICTION, ACTION] * 40)
    result = run_episode(config, WMScaffoldAgent(adapter))
    assert len(adapter.calls) == 2 * result.cycles
    assert all(record.ticks_elapsed <= config.deliberation_ticks for record in result.records)


def test_scaffold_stays_small_and_frozen_prompt_hashes_are_exact() -> None:
    source = Path(__file__).parents[1] / "chronogym" / "scaffold.py"
    assert len(source.read_text(encoding="utf-8").splitlines()) < 150
    config = next(
        config
        for config in load_pack(Path(__file__).parents[1] / "packs" / "core_v0")
        if config.scenario_id == "g001"
    )
    frozen_observation = build_observation(
        config,
        initial_state(config),
        episode_id="prompt-freeze",
        cycle=0,
    )
    prediction_hash = hashlib.sha256(
        render_prediction_prompt(frozen_observation).encode("utf-8")
    ).hexdigest()
    action_hash = hashlib.sha256(
        render_action_prompt(
            frozen_observation,
            Prediction(1.0, 2.0, 3.0, 4.0),
        ).encode("utf-8")
    ).hexdigest()
    assert prediction_hash == "6730b9775c9ae77d55f1caa488556928442d95817d76976e2cc7da9bae1d774c"
    assert action_hash == "110c51845ea9a07d054ce87e5247ac657a4bf6ef7c80a31bd88ab165d2284935"
