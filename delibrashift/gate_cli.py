"""Evaluate DelibraShift's executable M1 pack gates."""

from __future__ import annotations

import argparse
from dataclasses import asdict
import sys

from .agents import GreedyAgent
from .bank import load_pack
from .gates import (
    kill_criterion_gate,
    matched_state_gate,
    reproducibility_gate,
    score_feedback_use,
)
from .types import canonical_json


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", help="local pack directory containing pack.json")
    args = parser.parse_args(argv)

    scenarios = load_pack(args.pack)
    sweep_ids = {"g001_b10", "g001", "g001_b40"}
    masked = tuple(config for config in scenarios if not config.goal_visible)
    payload = {
        "gate_i": asdict(reproducibility_gate(scenarios)),
        "gate_ii": asdict(
            matched_state_gate(
                config for config in scenarios if config.scenario_id in sweep_ids
            )
        ),
        "gate_iv": asdict(kill_criterion_gate(scenarios)),
        "masked_searcher": asdict(score_feedback_use(masked, GreedyAgent)),
    }
    print(canonical_json(payload))
    return 0 if all(payload[key]["passed"] for key in ("gate_i", "gate_ii", "gate_iv")) else 1


if __name__ == "__main__":
    sys.exit(main())
