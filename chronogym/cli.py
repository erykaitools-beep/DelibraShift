"""Run deterministic baselines over an external local pack."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .agents import GreedyAgent, NoOpAgent, RandomAgent
from .bank import load_pack
from .runner import run_episode
from .scoring import score_prediction_fidelity
from .types import canonical_json


def _agent(name: str, seed: int):
    if name == "random":
        return RandomAgent(seed)
    if name == "greedy":
        return GreedyAgent()
    return NoOpAgent()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", help="local pack directory containing pack.json")
    parser.add_argument("--agent", choices=("random", "greedy", "noop"), default="random")
    parser.add_argument("--log-dir", help="optional directory for canonical episode JSONL")
    args = parser.parse_args(argv)

    scenarios = load_pack(args.pack)
    log_dir = Path(args.log_dir) if args.log_dir else None
    if log_dir:
        log_dir.mkdir(parents=True, exist_ok=True)
    for config in scenarios:
        agent = _agent(args.agent, config.seed)
        result = run_episode(config, agent)
        score = score_prediction_fidelity(result.records)
        if log_dir:
            (log_dir / f"{config.scenario_id}.{agent.name}.jsonl").write_bytes(
                result.log_bytes
            )
        print(
            canonical_json(
                {
                    "agent": agent.name,
                    "cycles": result.cycles,
                    "outcome_binary": result.final_state.outcome,
                    "parse_rate": score.parse_rate,
                    "persistence_floor": score.persistence_floor,
                    "prediction_fidelity": score.prediction_fidelity,
                    "scenario_id": config.scenario_id,
                    "tick": result.final_state.tick,
                }
            )
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
