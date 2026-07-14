from __future__ import annotations

from pathlib import Path

from chronogym.bank import load_pack
from chronogym.harness import HarnessAgent
from chronogym.probes import (
    CHOICE_PROBE_PROMPT_VERSION,
    FORMAT_PROBE_PROMPT_VERSION,
    forced_choice_candidates,
    identity_prediction,
    score_forced_choice_probe,
    score_format_probe,
)
from chronogym.runner import run_episode
from chronogym.types import Action, AgentReply


PACK = {
    config.scenario_id: config
    for config in load_pack(Path(__file__).parents[1] / "packs" / "core_v0")
}


class StubAdapter:
    name = "probe-stub"

    def __init__(self, replies: list[str]) -> None:
        self.replies = replies
        self.prompts: list[str] = []

    def complete(self, prompt, *, max_tokens=512, temperature=0.0, seed=None):
        self.prompts.append(prompt)
        return self.replies[min(len(self.prompts) - 1, len(self.replies) - 1)]


class IdentityAgent:
    name = "identity"

    def act(self, observation):
        return AgentReply(Action(100.0, 100.0), identity_prediction(observation))


class CorrectChoiceAgent:
    name = "correct-choice"

    def __init__(self, config) -> None:
        self.config = config

    def act(self, observation):
        choice = forced_choice_candidates(self.config, observation).correct_choice
        return AgentReply(Action(100.0, 100.0), None, choice=choice)


def test_forced_choice_candidates_change_only_pinned_x_fields() -> None:
    config = PACK["g009"]
    record = run_episode(config, CorrectChoiceAgent(config)).records[0]
    candidates = forced_choice_candidates(config, record.observation)
    true_target = record.prediction_target
    assert true_target is not None
    chosen = candidates.candidate_a if candidates.correct_choice == "A" else candidates.candidate_b
    decoy = candidates.candidate_b if candidates.correct_choice == "A" else candidates.candidate_a
    assert chosen.pos_x_m == true_target.pos_x_m
    assert chosen.pos_y_m == true_target.pos_y_m
    assert chosen.vel_x_mps == true_target.vel_x_mps
    assert chosen.vel_y_mps == true_target.vel_y_mps
    assert abs(decoy.pos_x_m - chosen.pos_x_m) == 3.0
    assert decoy.pos_y_m == chosen.pos_y_m
    assert abs(decoy.vel_x_mps - chosen.vel_x_mps) == 3.0
    assert decoy.vel_y_mps == chosen.vel_y_mps


def test_forced_choice_harness_uses_separate_prompt_and_retry_parser() -> None:
    config = PACK["g009"]
    adapter = StubAdapter(["invalid", '{"choice":"A"}'])
    agent = HarnessAgent(adapter, probe_config=config)
    observation = run_episode(config, CorrectChoiceAgent(config)).records[0].observation
    reply = agent.act(observation)
    assert agent.prompt_version == CHOICE_PROBE_PROMPT_VERSION
    assert reply.choice == "A"
    assert reply.parse_retries == 1
    assert "Candidate A" in adapter.prompts[0]
    assert "Candidate B" in adapter.prompts[0]
    assert "prior reply was invalid" in adapter.prompts[1]


def test_probe_scorers_publish_parse_rates_accuracy_and_trial_counts() -> None:
    format_config = PACK["g008"]
    format_result = run_episode(format_config, IdentityAgent())
    format_score = score_format_probe(format_result.records)
    assert format_score.json_parse_rate == 1.0
    assert format_score.identity_fidelity == 1.0
    assert format_score.identity_better == format_score.n_trials
    assert all(
        record.probe_match == "identity"
        for record in format_result.records
        if not record.truncated
    )
    assert all(record.engaged_action == Action(0.0, 0.0) for record in format_result.records if record.action_engaged)

    choice_config = PACK["g009"]
    choice_result = run_episode(choice_config, CorrectChoiceAgent(choice_config))
    choice_score = score_forced_choice_probe(choice_config, choice_result.records)
    assert choice_score.choice_accuracy == 1.0
    assert choice_score.choice_parse_rate == 1.0
    assert choice_score.n_trials == choice_score.n_parsed


def test_format_harness_prompt_is_separate_from_frozen_standard_prompt() -> None:
    config = PACK["g008"]
    first = run_episode(config, IdentityAgent()).records[0]
    prediction = identity_prediction(first.observation)
    raw = (
        '{"prediction":{"pos_x_m":%r,"pos_y_m":%r,"vel_x_mps":%r,'
        '"vel_y_mps":%r},"action":{"accel_x_mps2":0,"accel_y_mps2":0}}'
        % (
            prediction.pos_x_m,
            prediction.pos_y_m,
            prediction.vel_x_mps,
            prediction.vel_y_mps,
        )
    )
    adapter = StubAdapter([raw])
    agent = HarnessAgent(adapter, probe_config=config)
    reply = agent.act(first.observation)
    assert agent.prompt_version == FORMAT_PROBE_PROMPT_VERSION
    assert reply.prediction == prediction
    assert "FORMAT CONTROL" in adapter.prompts[0]
