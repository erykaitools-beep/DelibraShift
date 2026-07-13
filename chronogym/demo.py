"""Run the M0 Windrift demo with a deterministic baseline."""

from __future__ import annotations

import argparse
import sys

from .agents import NoOpAgent, RandomAgent
from .runner import run_episode
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
    parser.add_argument("--agent", choices=("random", "noop"), default="random")
    parser.add_argument("--log", help="write canonical JSONL to this path")
    args = parser.parse_args(argv)

    config = demo_scenario()
    agent = RandomAgent(config.seed) if args.agent == "random" else NoOpAgent()
    result = run_episode(config, agent)
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
                "tick": result.final_state.tick,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
