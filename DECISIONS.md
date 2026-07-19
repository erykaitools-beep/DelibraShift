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

## COD-006 — Score typed cycle records and retain JSONL as the audit artifact

Date: 2026-07-13

The runner now returns immutable `CycleRecord` values alongside canonical
JSONL. Prediction-fidelity consumes those typed records, avoiding a lossy or
duplicated deserialize path while leaving the byte-identical JSONL as the
reproducibility artifact. Truncated targets and missing predictions are
excluded exactly as SPEC §4.1 requires; parse rate remains independently
reported.

## COD-007 — Version the pre-review prompt explicitly as a draft

Date: 2026-07-13

The M1 harness prompt is labeled `draft-0.1` until Fable completes the planned
freeze review. It already includes every SPEC §7.2 content requirement, but no
benchmark comparisons or publishable results may use it before the architect's
review. Parser, retry, and loader work can proceed independently meanwhile.

## COD-008 — Keep NIM configuration external and transport-only

Date: 2026-07-13

The NIM adapter implements only the official OpenAI-compatible
`/v1/chat/completions` transport. Model and endpoint are constructor/env
configuration (`NIM_MODEL`, `NIM_BASE_URL`); credentials come only from
`NVIDIA_API_KEY` and are never serialized. The adapter performs no prompting,
repair, retry, or scenario access.

## COD-009 — Defer the MPC oracle until its sampling procedure is fully pinned

Date: 2026-07-13

Oracle and stale-reactor code is deferred pending Fable clarification of the
iteration-0 sampling distribution, exact Gaussian refit formula, action-cap
ordering, and whether injected greedy/no-op candidates enter the elite refit.
These choices materially affect the ceiling and temporal exit gate. Selecting
them in builder code without an architect decision would undermine RULE B and
make the pre-registered kill criterion implementation-dependent.

## COD-010 — Normalize external physics numbers and reject ambiguous types

Date: 2026-07-13

The pack loader converts valid JSON integer/float physics values to Python
`float`, matching the binary64 contract, while seed and tick fields must be
true integers (booleans rejected). Scenario validation also checks every
physics value for type and finiteness. Resolved scenario paths must remain
direct children of the pack's `scenarios` directory, including after symlink
resolution.

## FAB-014 — Abstention-proof prediction-fidelity accounting

Date: 2026-07-13

Review round 1 (two independent blockers): fidelity's denominator was
agent-controlled — a model could omit predictions on hard cycles (no retry
fired on prediction-only failure) or engineer early termination, cherry-
picking its fidelity mean while parse_rate stayed 1.0. Fixes: prediction-parse
failures get the SAME N=2 retry ladder; prediction_coverage = valid/requested
is a mandatory companion metric; fidelity is publishable only as the
(fidelity, coverage) pair and becomes None with an explicit reason below
coverage 0.8 or 3 valid cycles; parse_rate split into action_parse_rate and
prediction_parse_rate; a valid prediction from an action-failed cycle is
kept. Constants in types.py. Persistence floor is now computed per-agent on
the agent's OWN trajectory (a station-keeper has a high floor — raw fidelity
was not cross-agent comparable).

## FAB-015 — Temporal-axis cycle-inclusion rules

Date: 2026-07-13

Blocker: as written, parse-failed cycles entered the temporal sum with the
engaged NOOP scored as the agent's choice — formatting moved a cognition
score (RULE E violation). Now normative: temporal sums run over
non-truncated, action-parsed cycles whose returned action actually engaged;
parse-failed and never-engaged cycles are excluded from numerator AND
denominator; masked-goal scenarios score None (goal-privileged oracles are
unfair references for heat-only agents); the None-gate is on MEAN weight
(>= 0.02), not the length-scaling sum.

## FAB-016 — Novelty sentence re-anchored (supersedes FAB-001)

Date: 2026-07-13

Review found Real-Time Reasoning Gym (arXiv:2511.04898, 2025): token-
denominated, hardware-agnostic deliberation cost in never-pausing worlds —
the v0.1 wedge "nobody scores thinking-costs-time reproducibly" was FALSE.
Nothing found, however, scores ANTICIPATION of one's own deliberation as a
metric. New sentence anchors on the anticipation SCORE (engage-time vs
observed-time counterfactual oracles) + 4-axis decomposition; the clock is
declared standard machinery (delayed-MDP lineage back to RTA* 1990, RTMDP
2019, SC2LE step_mul 2017) in a new SPEC 12 lineage paragraph. Gaia2/ARE
added as closest large-scale competitor (wall-clock or zero thinking cost —
not a fixed simulated budget). R-WoM row corrected (method, not benchmark;
replaced by ByteSized32-SP). Complementarity: RTR-Gym measures verbosity
management under variable cost; ChronoGym measures delay compensation under
fixed cost.

## FAB-017 — Oracle pinned as normative pseudocode (answers COD-009)

Date: 2026-07-13

The v0.1 oracle was not independently recomputable (initial distribution,
rng call order, refit structure, tie-breaking, partial-window handling all
unstated) — two conforming implementations could publish different temporal
scores and even different kill decisions. SPEC 4.2.1 now pins: candidate
ordering (NOOP, greedy, 256 uniform-disc samples; theta-then-r per window,
candidate-outer/window-inner), J with d_min inclusive of the start state,
tie-break by lower index, 3 elite-refit iterations (top-16, per-window
per-axis mean + population std with 0.5 floor, elites carried unchanged,
gauss draws candidate-outer/window-inner x-then-y, clamp per window), final
action = clamped elite MEAN of window 0. A golden oracle fixture is a Fable
deliverable at M1 before baseline results are read.

## FAB-018 — Kill criterion made computable one way (supersedes FAB-007)

Date: 2026-07-13

D_outcome is now defined on PACK MEANS over the goal-visible non-probe
subset; random baseline averaged over R=20 reps with pinned per-rep seeds;
two validity floors added (oracle-random >= 0.2 on outcome;
oracle_temporal - 0.5 >= 0.05) — an invalid pack triggers redesign levers,
never a published number; greedy-temporal kill threshold is now RELATIVE to
measured oracle headroom ((greedy-0.5) >= 0.5*(oracle-0.5)) because the
temporal ceiling is scenario-dependent (an absolute 0.55 was near-vacuous on
calm packs and over-eager on gusty ones).

## FAB-019 — Gate (ii) honesty: margin, not strictness

Date: 2026-07-13

Derivation: stale-reactor temporal = 0.5*(1 - Sum(w^2)/Sum(w)). "< 0.5" is
formula-guaranteed; "strictly decreasing in B" is NOT (weights saturate at
the thrust cap; per-B cycle sets are disjoint) — it is an empirical scenario
property, which is precisely what the gate tests. Gate (ii) therefore
requires a drop of at least GATE_II_MARGIN = 0.01 per budget step; a 1e-12
float decrease proves nothing. Margin failure triggers SPEC 5.5 lever 1
(gustier wind), not a metric redesign.

## FAB-020 — Feedback-use: decoy-goal ablation + heat-only band (supersedes FAB-009)

Date: 2026-07-13

Two review pathologies: (1) constant heat=0.5 ablation is detectable
(physically impossible channel) and out-of-distribution — it measures
"agent notices the ablation", and a consistency-reasoning agent actively
confused by it would inflate the score; (2) the oracle-random band is
goal-privileged, so a perfect heat-only searcher could never reach 1.0.
Now: run B computes heat against a seeded FAKE goal (plausible, varying,
uninformative; draw pinned in SPEC 4.3), and the band is the heat-only
reference (masked greedy with true vs decoy heat). None below band 0.1;
raw delta and band always published. Feedback-use moves to pack-level
PackScores (an episode cannot carry a paired-run quantity) — types.py
schema bump.

## FAB-021 — Oracle multimodality: honest threat + mitigations

Date: 2026-07-13

Review showed w_k weighting AMPLIFIES multimodal cycles (two equally-good
modes => large ||a*_eng - a*_obs||) rather than damping them; the v0.1
threat entry was wrong. Mitigations now real: oracle action = elite MEAN
(damps mode flips deterministically); per-cycle margin distribution
published; a value-regret variant (J-difference under the true simulator)
pre-registered as a SECONDARY metric at M1.5 — if it disagrees with the
action-distance metric beyond cosmetics, the primary is revisited (FAB
entry required). Note: value regret cannot REPLACE the primary outright —
a stale reactor scores a constant 0.5 under pure regret ratio, which would
break exit gate (ii)'s budget sweep.

## FAB-022 — Probe scenarios: excluded from axes; forced-choice pinned

Date: 2026-07-13

Probe-tagged scenarios (probe:*) are excluded from all four axis aggregates
and every kill-criterion quantity; they yield only probe metrics. During
probe episodes the engaged action is NOOP throughout (RULE A logs stay
well-defined). Forced-choice wire schema added to the contract
(REPLY_KEY_CHOICE, CHOICE_VALUES, AgentReply.choice); decoy construction
pinned exactly, perturbing the x-components ONLY — y-components have a
gravity-only closed form from the Observation, so y-perturbed decoys were
solvable with zero wind modeling. probe:format replies are scored against
both the identity and T+B targets (instruction-following drift vs
formatting), with JSON validity as the primary compliance signal.

## FAB-023 — EXAMPLE_REPLY_JSON moved out-of-band (anti-parrot)

Date: 2026-07-13

Review measured the v0.1 in-prompt example scoring 0.919 fidelity on g001
cycle 0 as a pure parrot (its action was byte-identical to the fixture's
window-2 action). Example values are now normatively out-of-band (>= 10
tolerances from every core-pack cycle-0 target, alien quadrant), and
replies within 2 tolerances of the example are flagged example_echo.

## FAB-024 — Retry compute confound: contained and measured

Date: 2026-07-13

Sim-free reprompt retries are unavoidable under RULE A but hand extra
generation compute to models with worse JSON discipline (and are exploitable
as free chain-of-thought by deliberate malforming). Containment: the retry
notice REPLACES the failed attempt (no accumulation of the model's own prior
text); per-cycle parse_retries is logged; the fraction of retried cycles is
reported per agent; the RULE D matched-pair comparison includes a
sensitivity slice excluding retried cycles.

## FAB-025 — RULE-C red-team executed: v0.1 world FALSIFIED, retuned

Date: 2026-07-13

Empirical simulation (architect-run; the review workflow's red-team agent
died on a session limit, so the check ran inline). v0.1 parameters (gravity
9.81, thrust cap 15, PD greedy Kp=2/Kd=2.8): EVERY policy — noop, random,
greedy, and an anticipating lead-greedy — crashed out of bounds on all six
tuning scenarios; greedy scored BELOW random (saturated PD loses its
damping => bang-bang overshoot). That is a broken baseline in an untunable
world, not a discriminating benchmark. Retune: gravity 5.0; greedy replaced
by saturation-aware arrival steering (V_CRUISE=8.0, K_ARR=0.35, K_V=1.2,
gravity feedforward). Resulting gradient over 7 tuning scenarios (pack-mean
outcome): noop 0.07 < random 0.03 (both floor) << greedy 0.36 (closes to
3-15 m, crashes on 6/7, wins the easiest) << lead-greedy 0.92 (goal on
7/7). Lead-greedy differs from greedy ONLY by propagating the observed
state B ticks forward from Observation fields — the gap IS the skill under
test. Kill-criterion proxy with lead-greedy as oracle lower bound:
D_outcome ~ 0.63 >> 0.25. Fixtures regenerated under gravity 5.0;
golden_edges.json added (clamp-above-cap, goal-mid-window truncation,
deadline-mid-window) after review showed the g001 fixture never exercised
those branches.

## FAB-026 — Contract v0.2.0: boundary semantics + strictness sweep

Date: 2026-07-13

Pinned in one pass, each from a review finding: truncation defined as
episode-end STRICTLY below the engage tick (ending exactly at T_k+B is a
valid cycle; golden_edges.json pins both sides); d_min includes tick 0;
tick-0 events are impossible by contract (ScenarioConfig.__post_init__
rejects starts out of bounds/inside the goal disc, deadline < 1, forecast <
B, non-positive dt); masked goals are JSON null with keys KEPT (prompt bytes
stable; SPEC prose previously said "omitted" — prose/contract divergence
resolved in favor of null); canonical_json now rejects non-str dict keys and
normalizes -0.0; ScenarioConfig.from_json_dict pins tuple coercion for
loaders; parser type-strictness pinned (JSON numbers only, no bool/str
coercion, NaN/Infinity rejected, last-balanced-block string-aware
extraction); harness owns transport retries/backoff/pacing (adapters may
raise; ~20-line adapters stay honest); LLM reps use rep-derived seeds (same
seed x3 on a seed-honoring endpoint would fake a zero-width range);
normative per-cycle log record + run manifest field lists added to SPEC 10
(raw completions retained for re-scoring). SCHEMA_VERSION 0.1.0 -> 0.2.0.

## FAB-027 — HARD RULE 5 status: public-ready vs published

Date: 2026-07-13

Review flagged silent deviation: "public from day one" while the repo has no
remote. Resolution on record: the repo is public-READY from day one (MIT,
no secrets, reproducible seeds, clean history); pushing to a public GitHub
requires the repository owner's account and is governed by the operator's
standing no-auto-push policy, which the agents must not override. The
architect treats "public from day one" as a constraint on CONTENT (nothing
in-repo may depend on staying private) and M3 as the publication act.
Results remain gated by SPEC 5.4 regardless.

## COD-011 — Preserve valid predictions independently of action formatting

Date: 2026-07-14

Contract 0.2 scoring follows FAB-014's explicit attribution rule: a
non-truncated, parsed prediction remains eligible for fidelity even when the
same reply's action failed and no-op engaged. Action failure still excludes
the cycle from temporal scoring per FAB-015. Coverage, support floor, validity
reason, and both parse rates are always emitted together.

## COD-012 — Implement the oracle as a literal pinned state machine

Date: 2026-07-14

The sampling MPC mirrors SPEC 4.2.1 loop and RNG order directly: indexed seed
plans, candidate-outer/window-inner sampling, stable score/index ranking,
unchanged elite carry with reused objectives, x-then-y Gaussian draws,
per-window clamp, and final top-16 window-zero arithmetic mean. Computed oracle
numbers are not accepted as benchmark results until Fable's independent golden
oracle fixture lands.

## COD-013 — Make JSONL sufficient for replay and parser re-scoring

Date: 2026-07-14

Each cycle log now carries the normative episode/tick/engage fields,
observation, attributed reply, every raw retry completion, final raw text,
engaged clamped action, truncation, example-echo flag, and per-cycle wall-clock
telemetry. Manifests carry schema, pack metadata, scenario ids, prompt version,
agent, and host class. Typed baselines use null raw text and deterministic zero
telemetry, preserving byte-identical logs.

## FAB-028 — Core pack v0 authored; kill criterion pre-verified

Date: 2026-07-14

packs/core_v0 committed: 11 scenarios per SPEC 9.2 (baseline, budget sweep
B=10/40, high wind, tight deadline, adverse phase, 2x masked-goal, format +
forced-choice probes, beat-wind regime shift g010 — two close periods
150/130 give an amplitude envelope that shifts within the episode without
any schema change). Gate quantities pre-verified with the architect's
reference implementation (design-risk retirement; OFFICIAL gate (iv) numbers
must come from the builder's implementation): V1 = 0.892 (>= 0.2), K1
D_outcome = 0.723 (>= 0.25), V2 = 0.139 (>= 0.05), K2 not triggered (greedy
temporal 0.473 vs oracle 0.639; threshold 0.5+0.5*headroom = 0.569).
Temporal metric orders agents correctly: greedy 0.47 < lead-greedy 0.55 <
oracle 0.64. Feedback band on the masked pack = 0.451 (>= 0.1). Random
floor outcome 0.089, oracle ceiling 0.981.

## FAB-029 — Masked-greedy baseline redesigned: velocity-servo run-and-tumble

Date: 2026-07-14

The v0.2 masked law (raw thrust 0.6*amax along heading, rotate 72 deg on
cold) produced feedback band ~0 and SIGN-FLIPPING paired deltas: the
searcher died of unbounded drift so fast that decoy-heat runs sometimes
scored higher than true-heat runs by trajectory luck (one decoy run even
crossed the true goal). Replaced with a velocity-servo run-and-tumble
(V_SEARCH=6, K_V=1.2, gravity feedforward, rotate +137.5 deg golden angle on
cold - 72 deg visited only 5 headings). g007a/b geometries re-centered
(start (35,55)->goal (65,45); start (50,70)->goal (45,35)). Resulting band
terms: +0.748 / +0.154, band 0.451.

## FAB-030 — Common random numbers in the oracle seed (amends FAB-017)

Date: 2026-07-14

`variant` is removed from the oracle rng seed: rng = Random(seed*1_000_003 +
cycle*8191); variant selects timeline semantics only. Reason: with
per-variant seeds the two CEM runs draw independent candidate streams, giving
w = ||a_eng - a_obs|| a sampling-noise floor of ~0.1 that drowned the true
B=10/20 divergence (~0.03) and broke the budget-sweep gate. CRN is the
standard variance-reduction technique for difference estimators. Empirical
cross-check: on all variant-0 fixture rows (where old seed == new seed) the
builder's independent implementation of SPEC 4.2.1 matched the architect's
reference EXACTLY on binary64 - the pseudocode is unambiguous; the builder's
one-line CRN update then aligns variant-1 rows. tests/fixtures/
golden_oracle.json committed (6 rows, CRN).

## FAB-031 — Gate (ii) operationalized as a matched-state probe

Date: 2026-07-14

The on-policy episode sweep (run the stale reactor at B=10/20/40, compare
episode temporal scores) is NOT a sound gate: the reactor survives only 2-4
scored cycles at large B, single desperate end-of-life cycles dominate the
weighted mean, and the measured direction FLIPPED (b40 > b20 under v0.2.0
seeds; b10 < b20 < b40 under CRN) - pure small-sample noise. Gate (ii) is
now a matched-state probe (SPEC 5.6): 6 pinned decision states from the
lead-greedy reference trajectory on the B=20 member; for each B, propagate
each state B ticks under its latched action, compute w per 4.2, score =
analytic stale formula 0.5*(1 - sum(w^2)/sum(w)); require drops >= 0.01 per
step. Same states across budgets = the budget effect in isolation.
Reference numbers on g001 physics: 0.4550 -> 0.4332 -> 0.3749. The on-policy
sweep remains reported as informative only. Degenerate probe states (engage
tick past episode end) are excluded by the tick + 40 < end rule - one such
state saturated w to 1.0 and inverted the ordering in testing.

## FAB-032 — Feedback axis: heading-luck artifact killed; gradient-estimating searcher (supersedes FAB-029)

Date: 2026-07-14

Round-2 verification falsified the tumbler band: rotating its arbitrary
init-+x heading flipped band terms' SIGN (g007a: +0.748 with +x, -0.755 with
-y — the decoy run reached the TRUE goal); the heading-averaged band was
NEGATIVE on both masked scenarios. Root cause: reactive tumblers react to
heat_delta that reflects the window driven by the action from TWO cycles ago
(latch lag), so rotation decisions are mis-attributed; a compass-probe
variant then failed differently (inertia contaminates per-window probes;
its fixed probe loop dominated d_min, zeroing paired contrast). Fix exploits
that masked observations still contain self pos/vel: the searcher estimates
the heat gradient by least squares over its last 3 (ACTUAL displacement,
heat_delta) pairs — self-correcting for inertia and lag. Bearing-robust:
positive paired contrast with the goal E/N/W/S of start (+0.067/+0.090/
+0.566/+0.796), no initial-heading luck. Masked pack widened to THREE
bearings (g007c added: left-up); band terms +0.679/+0.094/+0.266, band
0.346, pinned in tests/fixtures/golden_masked.json. Exact LS pseudocode
normative in SPEC 5.2.

## FAB-033 — Oracle horizon pinned at the engage tick (amends FAB-030)

Date: 2026-07-14

CRN desynchronized whenever the variants' horizons differed: H computed from
each variant's own t0 gives H_obs = H_eng + 1 for every cycle within 6B of
the deadline (exactly the late 'desperate' cycles), the shared stream
diverges from candidate #3, and w regains a noise floor there (measured
+0.006..+0.039 shift at t0=480..540; zero shift at same-H states). Now H =
min(6, max(1, ceil((deadline - (T_k + B)) / B))) for BOTH variants, so draw
counts always match. No golden_oracle.json row changes (all rows H=6 both
ways; verified by regeneration diff = empty). variant is now explicitly
computation-inert (timeline documentation only).

## FAB-034 — Gate (ii) probe admissibility made intrinsic (amends FAB-031)

Date: 2026-07-14

The tick+40 exclusion hardcoded v0's B_max and did not actually guarantee
event-free propagation (the probe leaves the reference trajectory for up to
B_max ticks under a latched action). Now: sweep members MUST share seed;
a reference state is admissible iff propagation under (state, held) reaches
tick+B without a terminal event for EVERY B in the sweep; probe = first 6
admissible states; fewer than 6 => pack INVALID for gate (ii) -> SPEC 5.5
levers. Degenerate saturation (w = 1.0 from a past-the-end state observed in
testing) is thereby impossible by construction. Reference numbers unchanged:
0.4550 -> 0.4332 -> 0.3749.

## FAB-035 — Gate (iii) covers ALL golden fixtures

Date: 2026-07-14

Round-2 audit demonstrated a live hole: the tree's oracle diverged from 4/6
fixture rows while the whole test suite stayed green, because no gate
required golden_oracle.json. Gate (iii) now names golden_g001 + golden_edges
+ golden_oracle + golden_masked, all binary64-exact. M1 cannot exit around a
non-conformant oracle or masked searcher.

## FAB-036 — Engage tick == episode end: fidelity-valid, temporal-excluded

Date: 2026-07-14

Every core-pack deadline is a multiple of B, so EVERY timeout episode ends
exactly at an engage tick — and 'engaged' was undecidable there (verifier
had to guess). Pinned: an action whose engage tick equals the episode-end
tick never engaged (no window left to drive) => temporal-excluded; the SAME
cycle's prediction target exists => fidelity-VALID. golden_edges.json case
e004 (deadline 40, B=20) pins both flags plus the final state.

## FAB-037 — v0.2.2 sweep: pack v0.1.1 + contract 0.2.1 + conventions

Date: 2026-07-14

Batch of round-2 audit fixes: (1) pack: g007c added (masked, third bearing),
g008/g009 moved to B=10 (NOOP-forced probe episodes yield ~11 trials instead
of ~5; accuracies always published with trial counts), g001_b10 forecast 20
(constant 2xB ratio across the budget sweep - forecast informativeness no
longer confounds the budget curve). (2) Float-operation convention extended
to ALL SPEC formulas (naive left-to-right; numpy pairwise reductions are
off-contract). (3) FAB-023 example rule metric pinned: mean normalized error
via prediction_error >= 10 vs every core cycle-0 target (per-field reading
was falsified by g006). (4) Decoy draw: 'once per SCENARIO' wording, masked
scenarios require bounds extent >= 50 m per axis. (5) PackScores.
feedback_band_terms added (contract 0.2.1) - per-geometry band visibility.
(6) Scenario-count references normalized to 12. Kill-criterion numbers
refreshed under H-pinned oracle: V1 0.892, D_outcome 0.723, V2 0.139,
K2 clear (greedy 0.4732 / oracle 0.6388) - all unchanged at 3 decimals.

## COD-014 — Make M1 pack gates executable and auditable

Date: 2026-07-14

The matched-state probe, paired decoy-heat control, full-pack byte replay, and
kill criterion now live in `chronogym/gates.py`, with a canonical reporting
entry point in `chronogym-gates`. The implementation preserves scenario order,
uses the SPEC's naive left-to-right means, enforces six intrinsically
admissible matched states, and publishes every feedback band term through
`PackScores.feedback_band_terms`. This keeps gate evaluation on the same
world/runner/scorer path as ordinary episodes instead of a separate analysis
script.

## COD-015 — Record the official contract-0.2.1 builder gate run

Date: 2026-07-14

On `packs/core_v0` at Fable commit `87f922b`, gate (i) passed with identical
pack SHA-256
`6a964c34e3168b034f8c8be8b592ab513f9b975aff098439cde743fb1aa289ea`.
Gate (ii) passed with six admissible states and scores `0.45499315138148017`,
`0.4331712122380791`, `0.37486024858353895`. Gate (iv) passed: oracle outcome
`0.9807164271476155`, random outcome `0.08851733989998208`, greedy outcome
`0.33579823299083605`, V1 `0.8921990872476334`, D_outcome
`0.722841127473357`, oracle temporal `0.63877950053421`, greedy temporal
`0.4732096352382639`, and V2 `0.13877950053420995`. These reproduce FAB-037's
rounded references.

Gate (iii) is intentionally not marked complete. Direct normative
recomputation gives g007c's feedback band term as `0.2657880968210232`, while
the Fable-owned fixture contains `0.2657880968210241` (difference 9e-16).
All other masked pins and all oracle/physics/edge fixtures are exact. The
discrepancy is a strict expected-failure test pending architect reconciliation;
no epsilon or fixture-specific correction was introduced into benchmark code.

## FAB-038 — Clamp ownership pinned: the latch clamps exactly once

Date: 2026-07-14

Root cause of the builder's gate-(iii) 9e-16 band mismatch, isolated to the
bit: SPEC 5.2 wrote the baseline laws as `a = clamp_accel(...)` while SPEC
2.2 clamps `reply.action` at the latch — a conforming builder composed BOTH
(agent pre-clamps, latch re-clamps). clamp_accel is not float-idempotent:
at g007c cycle 1 the singly-clamped vector's hypot is 15.000000000000002,
so the second clamp rescales and shifts the last two bits; the trajectory
divergence compounds to ~3e-14 in d_min and 9e-16 in the band term.
Verified: clamp(clamp(raw)) reproduces the builder's logged bits exactly;
clamp(raw) reproduces the fixture's. Resolution: the harness latch clamp is
THE clamp, applied exactly once; agents and baseline laws return RAW
unclamped commands (5.2 laws now written as `a_raw = ...`). Exception: the
oracle's 4.2.1 output is defined WITH its interior clamps (fixture-pinned);
as an acting agent it passes the latch clamp like everyone — that
composition is already inside the FAB-028/037 reference numbers.
golden_masked.json is UNCHANGED (it was single-clamp all along). Also:
pack.json version stamp corrected to 0.1.1 (FAB-037 said so, the file
didn't), and the builder's frozen prompt v1.0 is formally blessed against
the 7.2 checklist (physics+units, engage-tick timeline, HELD-action
semantics, null-keyed observation JSON, out-of-band example, single-object
instruction — all present).

## COD-016 — Close all four M1 exit gates after the single-clamp fix

Date: 2026-07-14

FAB-038 was implemented by returning raw commands from both §5.2 baseline
laws and retaining `clock.latch_action` as the only clamp. Oracle interior
clamps remain unchanged. The strict xfail was removed: `golden_g001`,
`golden_edges`, `golden_oracle`, and `golden_masked` all pass exact binary64
checks, including g007c's band term `0.2657880968210241` and pack band
`0.3462846150280281`.

Final M1 table on core_v0 v0.1.1:

- Gate (i) PASS: both full-pack random logs SHA-256 to
  `6a964c34e3168b034f8c8be8b592ab513f9b975aff098439cde743fb1aa289ea`.
- Gate (ii) PASS: six admissible states; B=10/20/40 scores
  `0.45499315138148017`, `0.4331712122380791`, `0.37486024858353895`.
- Gate (iii) PASS: all four golden fixture families exact.
- Gate (iv) PASS: oracle/random/greedy outcomes `0.980723744495277`,
  `0.08851733989998208`, `0.335798232990836`; V1
  `0.8922064045952949`; D_outcome `0.7228434005660153`; oracle/greedy
  temporal `0.639339965447913` / `0.47066702870069027`; V2
  `0.13933996544791305`. K2 remains clear (`-0.02933297129930973 <
  0.06966998272395653`).

All registered validity floors and kill conditions pass. M1 is complete;
no benchmark result is being attributed to an LLM in this gate table.

## COD-017 — Isolate M1.5 controls and make pack downloads reproducible

Date: 2026-07-14

The frozen standard prompt remains byte-unchanged at version 1.0. Format and
forced-choice controls use independent draft versions and a `probe_config`
path in `HarnessAgent`; this prevents probe iteration from changing ordinary
result prompts. Forced-choice candidates are reconstructed from the complete
Observation with FAB-022's exact RNG and x-only decoy, while scorers always
publish parse rates and trial counts. Format cycles additionally log whether
the reply was closer to the requested identity or the engage-time target.

Downloadable packs use a deterministic stored ZIP with fixed timestamp,
permissions, root name, and manifest order. A canonical sidecar records the
archive SHA-256, every member SHA-256, schema/pack versions, and ordered
scenario IDs. A verifier checks the archive hash, exact member set, and member
hashes. This is the narrowest auditable interpretation of SPEC 9.1's “zip of
the same layout + sha256 in a manifest”; the concrete sidecar shape remains a
builder choice pending Fable review.

## COD-018 — Move to single-agent repository ownership

Date: 2026-07-19

At the project owner's direction, Fable is retired from the active workflow
for cost efficiency and Codex becomes sole architect and builder. Historical
FAB decisions, commits, and review text keep their attribution. New design and
implementation decisions use COD identifiers. Contract changes still require
schema bumps; fixture and pack changes still require exact regeneration and
gate-impact logging. Self-review is labeled honestly and never described as
independent verification.

## COD-019 — Accept M1.5 after solo self-review and freeze probe prompts

Date: 2026-07-19

The M1.5 pass at `661a208` is accepted after adding two safeguards: a probe
config must contain exactly one supported probe tag, and config/Observation
scenario IDs must match both in the harness and candidate generator. This
prevents silent wrong-seed choice labels.

The probe templates are frozen as `probe-format-1.0` and
`probe-choice-1.0`. Their complete core cycle-0 prompt hashes are
`297feeef1b9b5335e57eccc08975d2b4464c573df132a84f8b8fb758524e9104` and
`6719631b32b5b3bb05daf24f46fd8f0bfa90d077b129b1cbc5dda8e0d034a78c`,
evaluated on cycle 0 with `episode_id="prompt-freeze"` because runtime episode
IDs legitimately vary prompt bytes. Any template-byte change requires a
version bump. COD-017's deterministic stored ZIP and canonical sidecar format
is accepted into SPEC 9.1. This closes M1.5; the next implementation milestone
is M2's matched architecture ablation.

## COD-020 — Freeze the M2 treatment and make external execution explicit

Date: 2026-07-19

WM-SCAFFOLD is implemented in 131 lines and frozen as `wm-scaffold-1.0`.
Stage-1 and canonical stage-2 prompt hashes are
`6730b9775c9ae77d55f1caa488556928442d95817d76976e2cc7da9bae1d774c`
and `110c51845ea9a07d054ce87e5247ac657a4bf6ef7c80a31bd88ab165d2284935`.
Stage 2 receives the Observation plus the model's own parsed stage-1 state,
never the prediction target or simulator. A terminal stage-1 parse failure is
represented as null and stage 2 still runs; action failure retains the normal
no-op fallback. Retry counts sum across stages so any retried stage excludes
the cycle from the pre-registered sensitivity slice.

Both arms share the exact adapter instance and pacer. Call seeds equal the
repetition index, arm-first order alternates by repetition+scenario parity,
and 40 RPM means a 1.5 s minimum start interval. Transport retry is
harness-owned (two retries, 1 s then 2 s backoff) and telemetry-only. Reports
carry adapter, host, pack, prompt versions, coverage/parse/support fields,
mean+range, and log paths. The CLI requires `--execute` before constructing a
NIM adapter, preventing accidental paid runs. NIM is currently unconfigured,
so this decision records implementation readiness, not an LLM result.

## COD-021 — Keep feedback pairs and probe controls outside matched axes

Date: 2026-07-19

The official M2 runner now completes the diagnostic report without changing
the frozen treatment prompts. Every arm/repetition/masked-scenario cell runs
the normal episode followed immediately by a fresh same-seed decoy-heat
episode. The decoy uses SPEC §4.3's deterministic goal, has its own canonical
log, and contributes only to a published paired outcome delta. Normalized
feedback-use reuses the registered deterministic greedy band, including all
per-scenario band terms; a sub-threshold band still yields `None` rather than
an invented score.

`probe:*` scenarios remain excluded from both treatment arms and their axis
summaries. They now run once per repetition afterward as shared-model
`control` rows using the frozen probe prompts. Each row publishes parsed and
total trial counts, parse rate, probe-specific metrics, wall telemetry,
transport retries, and its log path. This preserves the probe-exclusion rule
while preventing an experiment report from silently omitting the controls.
No contract, fixture, pack, or prompt bytes changed.

## COD-022 — Resume external runs only from strictly verified episode logs

Date: 2026-07-19

The first official M2 attempt reached 40 of 84 canonical logs before one NIM
request exhausted all three 120-second transport attempts. Completed episodes
must not be discarded or silently regenerated: doing so wastes external calls
and changes the sampled service-time order.

`chronogym-ablate --resume` therefore reconstructs `EpisodeResult` from each
complete existing JSONL and locally re-scores it. Reuse requires canonical
encoding, ordered cycles, a terminal summary, and exact manifest matches for
schema, scenario, adapter/arm, prompt, pack, host, and scenario list. Any
mismatch aborts rather than mixing runs. Missing episodes retain the original
loop order, repetition seed, shared pacer, and filenames. Secrets remain
memory-only and no Maria file is modified.

## COD-023 — Publish the negative Dracarys scaffold result unchanged

Date: 2026-07-19

The official `core_v0` v0.1.1 Dracarys run completed all 84 canonical logs:
60 treatment episodes, 18 decoy episodes, and 6 controls over R=3 on Linux
x86_64. A zero-call resume reconstruction validated every log and reproduced
the stored report byte-for-byte. Report SHA-256 is
`5ed6e76793684c9c7ef996ae58168ec57301afbcc615f4967c533e853f2506fa`.

WM-SCAFFOLD minus END2END paired means were +0.29013 prediction coverage,
+0.38390 action parse rate, -0.44586 retried-cycle rate, -0.03929 temporal
anticipation (negative in all 21 visible cells), and -0.07904 outcome over 30
cells. Prediction fidelity was measurable in only 4 common cells; its paired
delta was +0.01825 and is reported with that support rather than generalized.
The retry-free temporal slice remained negative at -0.04181 over 21 cells.

Both arms had feedback-use 0.5 with raw normal-minus-decoy outcome 0.0 over
9 pairs: neither used the hot/cold signal measurably. Format controls parsed
30/30 with identity fidelity 1.0. Forced-choice parsed 30/30 and scored
0.60/0.70/0.80 by repetition (mean 0.70). The treatment therefore improved
format compliance and coverage but harmed anticipation and outcome. Per the
pre-registration, this negative architecture result is published unchanged.

## COD-024 — Adopt DelibraShift as the public project and package name

Date: 2026-07-19

The project owner selected **DelibraShift** after an exact-name web, GitHub,
and PyPI availability check. The tagline is “The world moves while agents
think.” The name directly describes the benchmark mechanism: world state
shifts during agent deliberation.

The distribution and import package become `delibrashift`; console scripts use
the `delibrashift-*` prefix. This is the first public package version, 0.1.0,
so no compatibility alias is carried for the unpublished old import path.
`SCHEMA_VERSION` remains 0.2.1 because names and import paths do not alter any
contract field or semantics.

Append-only FAB/COD history and the frozen core_v0 pack description retain the
former working name as provenance. Official M2 logs and `report.json` are not
rewritten; their published report SHA-256 remains
`5ed6e76793684c9c7ef996ae58168ec57301afbcc615f4967c533e853f2506fa`.
