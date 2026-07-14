from __future__ import annotations

import json
from pathlib import Path

from chronogym.agents import GreedyAgent
from chronogym.bank import load_pack
from chronogym.gates import decoy_goal, score_feedback_use
from chronogym.runner import run_episode


FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "golden_masked.json").read_text(
        encoding="utf-8"
    )
)
PACK = {
    config.scenario_id: config
    for config in load_pack(Path(__file__).parents[1] / "packs" / "core_v0")
}


def test_masked_searcher_first_actions_and_true_heat_episode_are_exact() -> None:
    config = PACK["g007a"]
    result = run_episode(config, GreedyAgent())
    for record, expected in zip(
        result.records,
        FIXTURE["searcher_first6_engaged_on_g007a_true_heat"],
    ):
        assert record.cycle == expected["cycle"]
        assert record.tick == expected["tick"]
        assert record.engaged_action is not None
        assert record.engaged_action.accel_x_mps2 == expected["engaged_accel_x_mps2"]
        assert record.engaged_action.accel_y_mps2 == expected["engaged_accel_y_mps2"]
    episode = FIXTURE["g007a_true_heat_episode"]
    assert result.final_state.tick == episode["end_tick"]
    assert result.final_state.outcome == episode["outcome"]
    assert result.closest_approach_m == episode["d_min"]


def test_masked_decoys_are_exact() -> None:
    scenario_ids = ("g007a", "g007b", "g007c")
    scenarios = tuple(PACK[scenario_id] for scenario_id in scenario_ids)
    for config in scenarios:
        expected = FIXTURE["decoy_goals"][config.scenario_id]
        assert decoy_goal(config) == (
            expected["fake_goal_x_m"],
            expected["fake_goal_y_m"],
        )


def test_masked_feedback_band_is_binary64_exact() -> None:
    scenario_ids = ("g007a", "g007b", "g007c")
    scenarios = tuple(PACK[scenario_id] for scenario_id in scenario_ids)
    scores = score_feedback_use(scenarios, GreedyAgent)
    assert scores.feedback_band_terms == tuple(
        FIXTURE["band_terms"][scenario_id] for scenario_id in scenario_ids
    )
    assert scores.feedback_band == FIXTURE["band"]
