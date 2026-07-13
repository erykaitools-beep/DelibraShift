"""ChronoGym schema contract, v0.1 (Project Brief section 3).

This module is THE CONTRACT: the single source of truth for every data shape
that crosses a boundary between the world, the harness, the scorers, the
adapters, and the external test bank.  Nothing that imports more than the
standard library belongs here.

Conventions (normative)
-----------------------
* Units are SI throughout: meters (m), seconds (s), m/s, m/s^2.
* World frame: +x points right, +y points up.  Gravity acts along -y.
* Simulated time is measured in integer ``tick``s.  One tick advances the
  world by ``dt_s`` seconds.  ``sim_time_s = tick * dt_s``.  All temporal
  quantities that are ever scored are expressed in ticks (METHOD RULE A);
  wall-clock time is caveated infra telemetry, never a score.
* All ``Prediction`` fields are ABSOLUTE state values at the target tick,
  never deltas.  Rationale: absolute values are unambiguous and immune to
  the abs-vs-delta formatting confound (METHOD RULE F); recorded as FAB-004.
* Decision-cycle timeline (normative, FAB-002): at cycle ``k`` the agent
  observes the true state at tick ``T_k``.  While it deliberates the world
  advances by exactly ``deliberation_ticks`` (= ``B``) ticks under the
  currently latched action ``h_k`` (``h_0`` is the no-op; ``h_{k+1}`` is the
  action returned at cycle ``k``, clamped).  The returned action engages at
  ``T_{k+1} = T_k + B``.  The prediction returned at cycle ``k`` targets the
  full kinematic state at ``T_{k+1}`` — which is a pure function of fields
  present in ``Observation`` (RULE F: no hidden factor in the target).
* Floating point: every physics quantity is a Python float (IEEE-754
  binary64).  Physics must be a pure function of
  ``(seed, state, action, dt)`` (METHOD RULE B).  Summations that the
  contract defines (e.g. wind components) are evaluated left-to-right in
  the order given, so results are bit-stable for a given input.

Version history
---------------
* 0.1.0 — initial contract (Observation / Prediction / Action /
  GroundTruthState / ScenarioConfig / AgentReply / EpisodeScores, wire
  schema, fidelity tolerances, canonical pure helpers).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Optional, Protocol, Sequence, Tuple

SCHEMA_VERSION = "0.1.0"

# ---------------------------------------------------------------------------
# Scoring constants (normative, FAB-004)
# ---------------------------------------------------------------------------

#: Position tolerance used to normalize prediction error (meters).  An error
#: of exactly one tolerance in one field contributes 1.0 to that field's
#: normalized error term.
PRED_POS_TOL_M: float = 1.0

#: Velocity tolerance used to normalize prediction error (m/s).
PRED_VEL_TOL_MPS: float = 1.0

#: Length scale of the graded hot/cold signal (meters).
#: heat = exp(-distance_to_goal / HEAT_SCALE_M)  ->  1.0 at the goal center.
HEAT_SCALE_M: float = 20.0

TWO_PI: float = 2.0 * math.pi

# Episode outcome literals (GroundTruthState.outcome / episode logs).
OUTCOME_GOAL = "goal"        # object entered the goal disc before the deadline
OUTCOME_TIMEOUT = "timeout"  # deadline tick reached without success
OUTCOME_OOB = "oob"          # object left the world bounds

# ---------------------------------------------------------------------------
# Wire schema for agent replies (METHOD RULE E)
# ---------------------------------------------------------------------------
# The harness owns prompting and parsing; adapters are transport only.  An
# agent must reply with a single strict-JSON object of this exact shape:
#
#   {
#     "prediction": {"pos_x_m": <float>, "pos_y_m": <float>,
#                    "vel_x_mps": <float>, "vel_y_mps": <float>},
#     "action":     {"accel_x_mps2": <float>, "accel_y_mps2": <float>}
#   }
#
# Parse failure after the allowed in-budget retries yields the no-op action
# and prediction = null, attributed to "formatting, not cognition" in logs.

REPLY_KEY_PREDICTION = "prediction"
REPLY_KEY_ACTION = "action"
PREDICTION_FIELDS: Tuple[str, ...] = ("pos_x_m", "pos_y_m", "vel_x_mps", "vel_y_mps")
ACTION_FIELDS: Tuple[str, ...] = ("accel_x_mps2", "accel_y_mps2")

EXAMPLE_REPLY_JSON = (
    '{"prediction": {"pos_x_m": 21.7, "pos_y_m": 64.8, '
    '"vel_x_mps": 3.2, "vel_y_mps": -9.8}, '
    '"action": {"accel_x_mps2": 3.0, "accel_y_mps2": 12.0}}'
)

# ---------------------------------------------------------------------------
# Scenario configuration (external test-bank contract)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WindComponent:
    """One sinusoidal component of the lateral wind field.

    wind contribution at integer tick n:
        amp_mps2 * sin(TWO_PI * n / period_ticks + phase_rad)
    """

    amp_mps2: float
    period_ticks: float
    phase_rad: float


@dataclass(frozen=True)
class ScenarioConfig:
    """Complete, self-contained description of one deterministic scenario.

    This is the schema of a scenario file in an external test bank; a pack
    is a directory of these (see SPEC.md section 9).  Every field below is
    part of the public contract.
    """

    scenario_id: str
    seed: int                          # master seed for anything seeded (oracle, decoys)
    dt_s: float = 0.05                 # sim seconds per tick
    deliberation_ticks: int = 20       # B: ticks the world advances per decision cycle
    deadline_tick: int = 600           # episode ends at this tick if goal not reached
    gravity_mps2: float = 9.81         # magnitude; acts along -y
    max_accel_mps2: float = 15.0       # L2 cap on commanded thrust
    wind_components: Tuple[WindComponent, ...] = ()
    forecast_ticks: int = 40           # length of the wind forecast in Observation;
                                       # MUST be >= deliberation_ticks (RULE F)
    start_pos_x_m: float = 20.0
    start_pos_y_m: float = 70.0
    start_vel_x_mps: float = 0.0
    start_vel_y_mps: float = 0.0
    goal_x_m: float = 80.0
    goal_y_m: float = 30.0
    goal_radius_m: float = 2.0
    goal_visible: bool = True          # False => masked goal: hot/cold-only probe
    bounds_min_x_m: float = 0.0
    bounds_min_y_m: float = 0.0
    bounds_max_x_m: float = 100.0
    bounds_max_y_m: float = 100.0
    axis_tags: Tuple[str, ...] = ()    # probe annotations, e.g. ("probe:format",)


# ---------------------------------------------------------------------------
# Core message types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Observation:
    """Everything the agent sees at the start of decision cycle ``cycle``.

    RULE F guarantee: the prediction target (true state at
    ``tick + deliberation_ticks``) is a pure deterministic function of the
    fields of this Observation alone: (pos, vel, held accel, gravity,
    wind_forecast_x_mps2[0:deliberation_ticks], dt_s).
    """

    schema_version: str
    scenario_id: str
    episode_id: str
    cycle: int                         # decision cycle index k, from 0
    tick: int                          # current sim tick T_k
    dt_s: float
    deliberation_ticks: int            # B: ticks that elapse before the returned action engages
    deadline_tick: int
    ticks_remaining: int               # max(0, deadline_tick - tick)
    pos_x_m: float
    pos_y_m: float
    vel_x_mps: float
    vel_y_mps: float
    held_accel_x_mps2: float           # latched action applying DURING this deliberation window
    held_accel_y_mps2: float
    gravity_mps2: float
    max_accel_mps2: float
    wind_now_x_mps2: float             # == wind_forecast_x_mps2[0]
    wind_forecast_x_mps2: Tuple[float, ...]  # element i = true wind at tick + i (truthful in v0)
    goal_x_m: Optional[float]          # None when the goal is masked (feedback-use probe)
    goal_y_m: Optional[float]
    goal_radius_m: float
    heat: float                        # exp(-distance_to_goal / HEAT_SCALE_M), always present (HARD RULE 3)
    heat_delta: float                  # heat(T_k) - heat(T_{k-1}); 0.0 at cycle 0
    distance_to_goal_m: Optional[float]  # None when the goal is masked
    bounds_min_x_m: float
    bounds_min_y_m: float
    bounds_max_x_m: float
    bounds_max_y_m: float


@dataclass(frozen=True)
class Action:
    """Commanded thrust acceleration (absolute command, not a delta).

    The harness clamps the L2 norm to ``max_accel_mps2`` at engage time via
    :func:`clamp_accel`.  The no-op action is ``Action(0.0, 0.0)``.
    """

    accel_x_mps2: float
    accel_y_mps2: float


#: Canonical no-op action (also the engaged action after final parse failure).
NOOP_ACTION = Action(0.0, 0.0)


@dataclass(frozen=True)
class Prediction:
    """Agent's prediction of the TRUE state at the engage tick.

    Target tick: ``observation.tick + observation.deliberation_ticks``
    (the moment the returned action engages).  All fields are ABSOLUTE
    values in world frame, never deltas (FAB-004).
    """

    pos_x_m: float
    pos_y_m: float
    vel_x_mps: float
    vel_y_mps: float


@dataclass(frozen=True)
class AgentReply:
    """Parsed result of one agent decision, as recorded by the harness.

    ``prediction is None`` means the prediction was unparseable (or the probe
    did not request one); with ``parse_failed=True`` the harness engaged the
    no-op action and the cycle is attributed to formatting, not cognition
    (METHOD RULE E).
    """

    action: Action
    prediction: Optional[Prediction]
    parse_failed: bool = False
    parse_retries: int = 0


@dataclass(frozen=True)
class GroundTruthState:
    """Full simulator state at one tick (harness/scorer side only)."""

    tick: int
    pos_x_m: float
    pos_y_m: float
    vel_x_mps: float
    vel_y_mps: float
    wind_x_mps2: float                 # true wind at this tick
    held_accel_x_mps2: float           # action latched during [tick, tick+1)
    held_accel_y_mps2: float
    distance_to_goal_m: float
    heat: float
    done: bool = False
    outcome: Optional[str] = None      # OUTCOME_GOAL | OUTCOME_TIMEOUT | OUTCOME_OOB | None


@dataclass(frozen=True)
class EpisodeScores:
    """The four diagnostic scores for one episode, plus attribution metrics.

    Every score lives in [0, 1].  ``None`` means "not measurable on this
    scenario" (e.g. temporal anticipation on a scenario where the oracle's
    engage-time and observed-time actions never diverge).  Exact formulas
    are normative in SPEC.md section 4; tolerance constants live here.
    """

    prediction_fidelity: Optional[float]
    temporal_anticipation: Optional[float]
    feedback_use: Optional[float]
    outcome: float
    parse_rate: float                  # parsed cycles / total cycles (formatting, not cognition)
    #: Wall-clock milliseconds spent by the adapter.  TELEMETRY ONLY —
    #: never enters any score (METHOD RULE A).
    wall_clock_ms_telemetry_only: float = 0.0


# ---------------------------------------------------------------------------
# Adapter contract (METHOD RULE E: transport only, ~20 lines)
# ---------------------------------------------------------------------------


class Adapter(Protocol):
    """A model adapter is TRANSPORT ONLY.

    It receives a fully rendered prompt string and returns the model's raw
    text completion.  It must not build prompts, parse JSON, retry on parse
    failures, or read scenario state.  The harness owns all of that.
    """

    name: str

    def complete(
        self,
        prompt: str,
        *,
        max_tokens: int = 512,
        temperature: float = 0.0,
        seed: Optional[int] = None,
    ) -> str:
        """Return the raw completion text for ``prompt``."""
        ...


# ---------------------------------------------------------------------------
# Canonical pure helpers (normative formulas; FAB-011)
# ---------------------------------------------------------------------------
# These functions define contract semantics (what Observation fields MEAN and
# how fidelity is computed).  The world's step() composition, the run loop,
# and all parsing remain the builder's to implement per SPEC.md.


def wind_x_at(components: Sequence[WindComponent], tick: int) -> float:
    """True lateral wind acceleration at integer ``tick`` (zero-order hold).

    Evaluated left-to-right in component order (bit-stable).
    """
    total = 0.0
    for c in components:
        total += c.amp_mps2 * math.sin(TWO_PI * tick / c.period_ticks + c.phase_rad)
    return total


def heat_from_distance(distance_m: float) -> float:
    """Graded hot/cold signal: 1.0 at the goal center, ->0 far away."""
    return math.exp(-distance_m / HEAT_SCALE_M)


def clamp_accel(ax: float, ay: float, max_accel_mps2: float) -> Tuple[float, float]:
    """Scale a commanded acceleration down to the L2 cap (direction kept)."""
    norm = math.hypot(ax, ay)
    if norm <= max_accel_mps2 or norm == 0.0:
        return (ax, ay)
    scale = max_accel_mps2 / norm
    return (ax * scale, ay * scale)


def prediction_error(pred: Prediction, truth: GroundTruthState) -> float:
    """Normalized mean L1 state distance (METHOD RULE F: graded, never exact-match).

    Each field's absolute error is divided by its tolerance; the four terms
    are averaged.  0.0 = perfect; 1.0 = one tolerance off on average.
    """
    terms = (
        abs(pred.pos_x_m - truth.pos_x_m) / PRED_POS_TOL_M,
        abs(pred.pos_y_m - truth.pos_y_m) / PRED_POS_TOL_M,
        abs(pred.vel_x_mps - truth.vel_x_mps) / PRED_VEL_TOL_MPS,
        abs(pred.vel_y_mps - truth.vel_y_mps) / PRED_VEL_TOL_MPS,
    )
    return sum(terms) / len(terms)


def fidelity_from_error(normalized_error: float) -> float:
    """Map normalized error to a graded fidelity score in (0, 1]."""
    return math.exp(-normalized_error)


def prediction_fidelity(pred: Prediction, truth: GroundTruthState) -> float:
    """Convenience: fidelity_from_error(prediction_error(pred, truth))."""
    return fidelity_from_error(prediction_error(pred, truth))


def action_similarity(a: Action, b: Action, max_accel_mps2: float) -> float:
    """Magnitude-aware similarity of two (clamped) actions, in [0, 1].

    1 - ||a - b|| / (2 * max_accel).  Used by the temporal-anticipation
    scorer (SPEC.md section 4.2); no angular edge cases at zero thrust.
    """
    dist = math.hypot(a.accel_x_mps2 - b.accel_x_mps2, a.accel_y_mps2 - b.accel_y_mps2)
    return 1.0 - dist / (2.0 * max_accel_mps2)


def canonical_json(payload: object) -> str:
    """Canonical JSON serialization for logs and fixtures (METHOD RULE B).

    Sorted keys, no whitespace, NaN/Inf forbidden, floats via Python's
    shortest round-trip repr.  Two same-seed runs must produce byte-identical
    log lines through this function.
    """
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
