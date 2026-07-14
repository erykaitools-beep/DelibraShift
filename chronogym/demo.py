"""Run the M0 Windrift demo with a deterministic baseline."""

from __future__ import annotations

import argparse
import sys

from .agents import GreedyAgent, NoOpAgent, RandomAgent
from .runner import run_episode
from .scoring import score_outcome, score_prediction_fidelity
from .types import ScenarioConfig, WindComponent, canonical_json


def demo_scenario() -> ScenarioConfig:
    return ScenarioConfig(
        scenario_id="demo_g001",
        seed=42,
        wind_components=(
            WindComponent(amp_mps2=3.0, period_ticks=240.0, phase_rad=0.7),
            WindComponent(amp_mps2=1.5, period_ticks=97.0, phase_rad=2.1),
        ),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--agent",
        choices=("random", "greedy", "noop"),
        default="random",
    )
    parser.add_argument("--log", help="write canonical JSONL to this path")
    args = parser.parse_args(argv)

    config = demo_scenario()
    if args.agent == "random":
        agent = RandomAgent(config.seed)
    elif args.agent == "greedy":
        agent = GreedyAgent()
    else:
        agent = NoOpAgent()
    result = run_episode(config, agent)
    fidelity = score_prediction_fidelity(result.records)
    if args.log:
        with open(args.log, "wb") as stream:
            stream.write(result.log_bytes)

    print(
        canonical_json(
            {
                "agent": agent.name,
                "cycles": result.cycles,
                "final_heat": result.final_state.heat,
                "outcome": result.final_state.outcome,
                "outcome_score": score_outcome(config, result),
                "action_parse_rate": fidelity.action_parse_rate,
                "prediction_parse_rate": fidelity.prediction_parse_rate,
                "prediction_coverage": fidelity.prediction_coverage,
                "fidelity_invalid_reason": fidelity.fidelity_invalid_reason,
                "persistence_floor_fidelity": fidelity.persistence_floor_fidelity,
                "prediction_fidelity": fidelity.prediction_fidelity,
                "tick": result.final_state.tick,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
