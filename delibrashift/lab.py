"""Pure application service for the local DelibraShift desktop lab.

The lab never implements its own simulation loop.  It runs the canonical
episode runner, then reconstructs the inclusive tick trace with the same
``world.step`` and ``clock.latch_action`` primitives for visualization.
"""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from typing import Callable

from .agents import Agent, GreedyAgent, NoOpAgent, RandomAgent
from .bank import load_pack, load_pack_metadata
from .clock import latch_action
from .oracle import LeadGreedyAgent, OracleAgent, StaleReactorAgent
from .runner import EpisodeResult, run_episode
from .scoring import score_episode
from .types import GroundTruthState, ScenarioConfig
from .world import initial_state, step


LAB_SCHEMA_VERSION = "desktop-lab-0.1"


def _agent_factory(
    agent_id: str,
    config: ScenarioConfig,
    repetition: int,
) -> Agent:
    factories: dict[str, Callable[[], Agent]] = {
        "noop": NoOpAgent,
        "random": lambda: RandomAgent(config.seed, repetition=repetition),
        "greedy": GreedyAgent,
        "lead-greedy": LeadGreedyAgent,
        "stale-reactor": lambda: StaleReactorAgent(config),
        "oracle": lambda: OracleAgent(config),
    }
    try:
        return factories[agent_id]()
    except KeyError as error:
        raise ValueError(f"unknown agent: {agent_id}") from error


def reconstruct_trace(
    config: ScenarioConfig,
    result: EpisodeResult,
) -> tuple[GroundTruthState, ...]:
    """Reconstruct the canonical inclusive trace and verify its final state."""
    state = initial_state(config)
    trace = [state]
    for record in result.records:
        if state.tick != record.tick:
            raise RuntimeError(
                f"cycle {record.cycle} begins at tick {record.tick}, not {state.tick}"
            )
        for _ in range(record.ticks_elapsed):
            state = step(config, state)
            trace.append(state)
        if record.action_engaged:
            if record.engaged_action is None:
                raise RuntimeError(f"cycle {record.cycle} engaged without an action")
            state = latch_action(config, state, record.engaged_action)
            trace[-1] = state
    if state != result.final_state:
        raise RuntimeError("visual trace does not reproduce the canonical final state")
    return tuple(trace)


class LabEngine:
    """JSON-safe facade over a local scenario pack and canonical runner."""

    AGENTS = (
        {
            "id": "lead-greedy",
            "label": "Lead Greedy",
            "kind": "deliberation-aware",
            "description": "Predicts the engage-time state before steering.",
        },
        {
            "id": "greedy",
            "label": "Greedy",
            "kind": "reactive baseline",
            "description": "Steers from the observation it received.",
        },
        {
            "id": "stale-reactor",
            "label": "Stale Reactor",
            "kind": "diagnostic baseline",
            "description": "Plans as though its answer engaged immediately.",
        },
        {
            "id": "random",
            "label": "Random",
            "kind": "deterministic floor",
            "description": "Seeded uniform actions; repeatable for each repetition.",
        },
        {
            "id": "noop",
            "label": "No-op",
            "kind": "control",
            "description": "Never applies thrust.",
        },
        {
            "id": "oracle",
            "label": "Oracle",
            "kind": "privileged ceiling",
            "description": "Sampling-MPC ceiling with privileged world knowledge.",
        },
    )

    def __init__(self, pack_path: str | Path) -> None:
        self.pack_path = Path(pack_path).resolve()
        self.metadata = load_pack_metadata(self.pack_path)
        scenarios = load_pack(self.pack_path)
        self.scenarios = {scenario.scenario_id: scenario for scenario in scenarios}
        self.scenario_order = tuple(scenario.scenario_id for scenario in scenarios)
        self.last_result: EpisodeResult | None = None
        self.last_run_name: str | None = None

    def catalog(self) -> dict[str, object]:
        return {
            "schema_version": LAB_SCHEMA_VERSION,
            "product": "DelibraShift Lab",
            "status": "coming-soon",
            "pack": {
                "name": self.metadata["name"],
                "version": self.metadata["version"],
                "schema_version": self.metadata["schema_version"],
                "description": self.metadata["description"],
            },
            "agents": list(self.AGENTS),
            "scenarios": [
                {
                    "id": scenario.scenario_id,
                    "deliberation_ticks": scenario.deliberation_ticks,
                    "deadline_tick": scenario.deadline_tick,
                    "goal_visible": scenario.goal_visible,
                    "axis_tags": list(scenario.axis_tags),
                }
                for scenario in self.scenarios.values()
            ],
        }

    def run(
        self,
        scenario_id: str,
        agent_id: str,
        repetition: int = 0,
    ) -> dict[str, object]:
        if isinstance(repetition, bool) or not isinstance(repetition, int):
            raise ValueError("repetition must be an integer")
        if repetition < 0:
            raise ValueError("repetition must be non-negative")
        try:
            config = self.scenarios[scenario_id]
        except KeyError as error:
            raise ValueError(f"unknown scenario: {scenario_id}") from error

        agent = _agent_factory(agent_id, config, repetition)
        result = run_episode(
            config,
            agent,
            pack_name=str(self.metadata["name"]),
            pack_version=str(self.metadata["version"]),
            scenario_ids=self.scenario_order,
        )
        trace = reconstruct_trace(config, result)
        scores = score_episode(config, result, include_temporal=False)
        self.last_result = result
        self.last_run_name = f"{scenario_id}-{agent_id}-r{repetition}.jsonl"

        decisions = []
        for record in result.records:
            decisions.append(
                {
                    "cycle": record.cycle,
                    "tick": record.tick,
                    "engage_tick": record.engage_tick,
                    "ticks_elapsed": record.ticks_elapsed,
                    "truncated": record.truncated,
                    "action_engaged": record.action_engaged,
                    "observation": asdict(record.observation),
                    "prediction": (
                        None
                        if record.reply.prediction is None
                        else asdict(record.reply.prediction)
                    ),
                    "prediction_target": (
                        None
                        if record.prediction_target is None
                        else asdict(record.prediction_target)
                    ),
                    "returned_action": asdict(record.reply.action),
                    "engaged_action": (
                        None
                        if record.engaged_action is None
                        else asdict(record.engaged_action)
                    ),
                }
            )

        return {
            "schema_version": LAB_SCHEMA_VERSION,
            "episode_id": result.episode_id,
            "scenario": asdict(config),
            "agent": next(agent for agent in self.AGENTS if agent["id"] == agent_id),
            "repetition": repetition,
            "summary": {
                "outcome": result.final_state.outcome,
                "outcome_score": scores.outcome,
                "prediction_fidelity": scores.prediction_fidelity,
                "prediction_coverage": scores.prediction_coverage,
                "cycles": result.cycles,
                "final_tick": result.final_state.tick,
                "closest_approach_m": result.closest_approach_m,
            },
            "trajectory": [asdict(state) for state in trace],
            "decisions": decisions,
        }

    def export_last_run(self, destination: str | Path) -> Path:
        if self.last_result is None:
            raise RuntimeError("run an episode before exporting")
        path = Path(destination).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(self.last_result.log_bytes)
        return path

    def run_json(self, scenario_id: str, agent_id: str, repetition: int = 0) -> str:
        """Convenience hook for smoke tests and non-pywebview embeddings."""
        return json.dumps(
            self.run(scenario_id, agent_id, repetition),
            ensure_ascii=False,
            separators=(",", ":"),
        )
