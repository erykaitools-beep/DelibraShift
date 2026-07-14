"""ChronoGym's public schema and deterministic Windrift primitives."""

from .adapters import NIMAdapter
from .bank import PackError, load_pack, load_pack_metadata
from .clock import WindowAdvance, advance_deliberation, latch_action
from .harness import HarnessAgent, parse_choice_reply, parse_reply, render_prompt
from .gates import (
    KillCriterionGate,
    MatchedStateGate,
    ReproducibilityGate,
    decoy_goal,
    kill_criterion_gate,
    matched_state_gate,
    reproducibility_gate,
    score_feedback_use,
)
from .oracle import (
    LeadGreedyAgent,
    OracleAgent,
    StaleReactorAgent,
    oracle_action,
)
from .scoring import (
    PredictionFidelityScore,
    TemporalAnticipationScore,
    score_episode,
    score_outcome,
    score_prediction_fidelity,
    score_temporal_anticipation,
)
from .types import (
    NOOP_ACTION,
    SCHEMA_VERSION,
    Action,
    Adapter,
    AgentReply,
    EpisodeScores,
    GroundTruthState,
    Observation,
    PackScores,
    Prediction,
    ScenarioConfig,
    WindComponent,
)
from .world import advance_ticks, build_observation, initial_state, step

__all__ = [
    "NOOP_ACTION",
    "NIMAdapter",
    "SCHEMA_VERSION",
    "Action",
    "Adapter",
    "AgentReply",
    "EpisodeScores",
    "GroundTruthState",
    "KillCriterionGate",
    "MatchedStateGate",
    "Observation",
    "OracleAgent",
    "LeadGreedyAgent",
    "StaleReactorAgent",
    "PackError",
    "PackScores",
    "Prediction",
    "PredictionFidelityScore",
    "ReproducibilityGate",
    "TemporalAnticipationScore",
    "ScenarioConfig",
    "WindComponent",
    "WindowAdvance",
    "advance_deliberation",
    "advance_ticks",
    "build_observation",
    "decoy_goal",
    "load_pack",
    "load_pack_metadata",
    "initial_state",
    "kill_criterion_gate",
    "latch_action",
    "matched_state_gate",
    "parse_reply",
    "parse_choice_reply",
    "oracle_action",
    "render_prompt",
    "reproducibility_gate",
    "score_prediction_fidelity",
    "score_temporal_anticipation",
    "score_outcome",
    "score_episode",
    "score_feedback_use",
    "step",
    "HarnessAgent",
]
