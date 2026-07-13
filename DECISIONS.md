# Decisions

This file is append-only. Fable uses `FAB-###`; Codex uses `COD-###`.

## COD-001 — Enforce the contract-first implementation gate

Date: 2026-07-13

`chronogym/types.py` must exist in Git history before Codex writes `step()`, a
run loop, or any adapter. SPEC scoring must additionally be committed before a
scorer or LLM adapter is written. The initial builder commit therefore contains
only repository/package scaffolding and coordination documents.

## COD-002 — Keep the core simulation dependency-free

Date: 2026-07-13

The v0 simulation will use the Python standard library and explicit immutable
state transitions. Pytest is the sole development dependency in the scaffold.
This keeps CPU-only runs small and makes deterministic behavior easier to audit.

## COD-003 — Use a repository-local builder identity

Date: 2026-07-13

The host has no Git author configured. Builder commits use the repository-local
identity `Codex Chief Builder <codex@local>` so ChronoGym commits remain clearly
attributed without modifying the user's global Git configuration.

## FAB-001 — Novelty sentence locked + three-challenge assessment

Date: 2026-07-13

Sentence in SPEC §1.1. Challenge (a) pass by construction (diagnosis vector,
probe-isolated axes, hot/cold is an observation not a reward); (b) empirically
gated at M1 via the pre-registered kill criterion (SPEC §5.4) with redesign
levers (§5.5); (c) pass by construction (all scored time in sim-ticks,
wall-clock is telemetry-only field `wall_clock_ms_telemetry_only`).

## FAB-002 — Timeline semantics: latched action, engage-tick prediction target

Date: 2026-07-13

While the agent deliberates, the world advances B=deliberation_ticks under the
LATCHED previous action (h_0 = no-op); the returned action engages at T_k+B.
The prediction returned at cycle k targets the true state at T_k+B, which is a
pure function of Observation fields (RULE F). Cycles truncated by episode end
are excluded from fidelity aggregation.

## FAB-003 — Truthful wind forecast inside Observation

Date: 2026-07-13

To keep wind time-varying AND the prediction target fully observation-
determined (RULE F), Observation carries wind_forecast_x_mps2 with
forecast_ticks >= B (truthful in v0). Forecast noise is a future factor pack,
delivered inside the observation to preserve RULE F.

## FAB-004 — Predictions are ABSOLUTE; tolerances and fidelity formula

Date: 2026-07-13

Prediction fields are absolute state values (never deltas) to kill the
abs-vs-delta formatting confound. Tolerances: PRED_POS_TOL_M=1.0,
PRED_VEL_TOL_MPS=1.0. nerr = mean of per-field |err|/tol; fidelity =
exp(-nerr). Executable in types.py.

## FAB-005 — Deliberation budget constant per scenario

Date: 2026-07-13

B is a scenario constant, visible in Observation. Budget sensitivity is
probed across scenarios (B in {10,20,40}), not within an episode. Keeps the
temporal-invariant gate clean.

## FAB-006 — Temporal metric: divergence-weighted lead margin vs MPC oracle

Date: 2026-07-13

temporal = normalized sum of w_k*(s(a,a*_eng) - s(a,a*_obs)) with
w_k = ||a*_eng - a*_obs||/(2*max_accel) and magnitude-aware similarity s
(types.action_similarity; no cosine zero-vector edge cases). Guarantees:
stale reactor < 0.5 and strictly decreasing in B (exit gate ii); cycles where
anticipation doesn't matter get zero weight. None if sum(w) < 0.05.

## FAB-007 — Kill criterion thresholds

Date: 2026-07-13

D_axis = (oracle - greedy)/(oracle - random). Fail if D_outcome < 0.25 OR
greedy temporal_score >= 0.55 on the core pack. Evaluated at M1 gate (iv),
re-evaluated on any core-pack change. Redesign levers pre-registered in SPEC
§5.5, applied in order.

## FAB-008 — Adapter protocol and parse-failure policy

Date: 2026-07-13

Adapter = single method complete(prompt, *, max_tokens, temperature, seed) ->
str; transport only (RULE E). Parse failure: N=2 in-budget reprompt retries,
then NOOP action + prediction=null + parse_failed=true, attributed
"formatting, not cognition". Retries never advance sim time.

## FAB-009 — Feedback-use = masked-goal pack + paired heat ablation

Date: 2026-07-13

Feedback-use is measured only where heat is the sole goal evidence
(goal_visible=false), as outcome delta between normal and heat-ablated paired
runs, normalized by the oracle-random band (SPEC §4.3). 0.5 = no use.

## FAB-010 — Matched-pair scaffold design (RULE D)

Date: 2026-07-13

Treatment pair = same dracarys/NIM model: (a) single-call END2END vs (b)
two-stage predict-then-act scaffold (<150 lines, in-repo) where stage 2 sees
the agent's own stage-1 prediction. Scaffold gets NO simulator access (no
oracle leakage). Full MARIA = separate row, labeled CONFOUNDED, never the
treatment arm.

## FAB-011 — Canonical pure helpers live in types.py

Date: 2026-07-13

wind_x_at, heat_from_distance, clamp_accel, prediction_error/fidelity,
action_similarity, canonical_json are part of the executable contract (they
define field semantics and scoring math). step() composition, run loop,
parsing, scorers remain builder-owned per SPEC.

## FAB-012 — Outcome score composite

Date: 2026-07-13

outcome = 0.5*success + 0.4*exp(-d_min/HEAT_SCALE_M) +
0.1*success*(1 - t_goal/deadline). Graded alongside binary per HARD RULE 3.

## FAB-013 — Golden fixture pins integrator + fidelity numerically

Date: 2026-07-13

tests/fixtures/golden_g001.json (Fable-owned) hand-computes scenario g001:
wind spot checks, two full decision windows (noop-held, then engaged (3,12)),
the cycle-0 prediction target, a worked fidelity example (nerr=0.2625), and
the persistence floor (~0.0075). CI must match EXACTLY (binary64 ==), not
approximately. Divergence = spec ambiguity = bug, resolved in DECISIONS.md.

## COD-004 — Separate pure tick physics from the deliberation clock

Date: 2026-07-13

`world.step(config, state)` implements exactly one normative semi-implicit
Euler tick using the action already held in `GroundTruthState`. `clock.py`
composes exactly `deliberation_ticks` such steps, stops on terminal events,
and latches the returned action without advancing time. This makes the RULE-A
timeline explicit while keeping physics independently testable as a pure
function.

## COD-005 — Keep local baselines distinct from transport adapters

Date: 2026-07-13

M0 random and no-op implementations are typed local agents, not implementations
of the model `Adapter` protocol. An Adapter is transport-only and returns raw
text; calling a deterministic baseline an adapter would blur RULE E and force
prompt parsing into a component that does not need it. The runner consumes the
small internal `Agent.act(Observation) -> AgentReply` protocol.
