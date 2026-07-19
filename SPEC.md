# ChronoGym SPEC v0.2.2

Owner: Codex (sole architect/builder since 2026-07-19). Normative unless
marked *informative*. Historical Fable contributions retain attribution. The
executable contract is `chronogym/types.py` (schema version 0.2.1); where prose
and `types.py` disagree, `types.py` wins and the disagreement is a bug to log
in DECISIONS.md.

v0.2 integrates adversarial review round 1 (five independent reviewers +
an empirical greedy red-team; FAB-014..FAB-027). Major changes vs v0.1:
novelty sentence re-anchored on the anticipation METRIC (FAB-016), gravity
retuned 9.81→5.0 with a redesigned greedy baseline after the red-team
falsified v0.1's parameters (FAB-025), oracle pinned as normative
pseudocode (FAB-017, answers COD-009), abstention-proof fidelity
accounting (FAB-014), exact kill-criterion computation (FAB-018), and a
decoy-goal feedback ablation (FAB-020).

---

## 1. Novelty

### 1.1 The one sentence (locked, FAB-016; supersedes FAB-001)

> **ChronoGym is the first open benchmark that scores temporal anticipation
> as an explicit diagnostic axis — comparing each engaged action against
> engage-time versus observed-time oracles under a seed-fixed *simulated*
> deliberation budget in a never-pausing world — and that decomposes agent
> performance into prediction-fidelity, temporal anticipation, feedback-use,
> and outcome with graded hot/cold signals, under a matched-pair world-model
> ablation on the same base model.**

The deliberation-aware *clock* is deliberately standard machinery — a
constant-delay MDP with latched actions, a lineage from real-time heuristic
search through RTMDP and SC2LE's `step_mul` (§12). What no prior benchmark
does is *measure whether the agent compensates for that delay* as an
isolated, probe-controlled score. The mechanism is inherited; the
measurement is new.

### 1.2 The three challenges

**(a) Not reducible to shaped-reward control.** The deliverable is a
*diagnosis vector*, not a scalar. Prediction-fidelity is scored against a
target that is a pure function of the observation (§4.1), independent of
reward; temporal anticipation is scored against counterfactual oracle actions
(§4.2), not against return; feedback-use is scored by a paired ablation of an
*observation channel* (§4.3). Two agents with identical outcome scores can and
should receive different diagnosis vectors. Hot/cold is an observation field,
never a reward. **Status: pass by construction.**

**(b) Survives the greedy baseline.** Greedy (§5.2) is a competent reactive
controller (arrival steering with gravity feedforward). It has no forecast
use, no lead, no world model. Empirical red-team (FAB-025): on the seven
tuning scenarios greedy closes to 3–15 m of the goal but crashes on 6/7
(pack-mean outcome 0.36), while an anticipating variant of the *same
controller* — identical control law, state propagated `B` ticks forward
using only Observation fields — succeeds on 7/7 (0.92). The gap between
those two IS the skill under test, and it is large. The kill criterion
(§5.4) remains pre-registered and is re-evaluated on the real oracle at M1.
**Status: provisionally pass (proxy numbers above); confirmed at gate iv.**

**(c) Does not lean on wall-clock latency.** Every temporal quantity that is
scored is denominated in sim ticks; the deliberation budget is a fixed,
seed-determined scenario parameter (`deliberation_ticks`), identical on any
hardware. Wall-clock is recorded in `wall_clock_ms_telemetry_only`
and never enters a score. Two same-seed runs produce byte-identical logs on
the same host (§10). **Status: pass by construction.**

If any challenge fails at its gate, we pivot and record it in DECISIONS.md
(brief §2).

---

## 2. The v0 world: "Windrift"

### 2.1 Geometry and factors

A 2D plane with bounds `[0,100] × [0,100]` m, +x right, +y up. A single
craft starts at a scenario-defined position and velocity and must enter a
goal disc (`goal_radius_m`, default 2 m) before `deadline_tick`.

Three interacting factors (HARD RULE 2 satisfied — ≥2 required):

1. **Gravity** — constant acceleration `gravity_mps2` (default **5.0**,
   FAB-025) along −y.
2. **Time-varying lateral wind** — acceleration along x, a sum of sinusoids
   (`WindComponent`s), a pure function of the integer tick (`wind_x_at`).
3. **Deadline** — episode fails at `deadline_tick`. It couples with 1 and 2
   because trajectory *time* is what the agent spends; slow safe paths lose.

The factors interact through shared velocity integration (inertia): thrust
spent fighting gravity is unavailable against wind, and wind-induced drift
compounds over exactly the time the deadline meters out.

*Informative:* v0.1 used gravity 9.81 with thrust cap 15; the empirical
red-team showed that leaves too little control authority — every policy
including anticipating ones crashed out of bounds, compressing all baselines
toward zero and invalidating the kill criterion's denominators. 5.0 restores
a usable gradient (FAB-025).

### 2.2 The deliberation-aware clock (METHOD RULE A; FAB-002)

The world **never pauses** and is **never turn-based**, but deliberation cost
is *simulated*, not wall-clock:

- At cycle `k` the agent receives `Observation` of the true state at tick
  `T_k` (`T_0 = 0`).
- While it deliberates, the world advances exactly
  `B = deliberation_ticks` ticks under the **latched action** `h_k`
  (`h_0 = NOOP_ACTION`; `h_{k+1} = clamp_accel(reply_k.action)` — applied
  **exactly once, by the harness**. Agents and baseline laws return the RAW
  unclamped command: `clamp_accel` is not float-idempotent (the scaled
  vector's `hypot` can exceed the cap by 1 ulp, so a second clamp changes
  bits), and a pre-clamped reply would silently double-clamp; FAB-038).
- The returned action engages at `T_{k+1} = T_k + B` and stays latched for
  the next window.
- Adapter retries after parse failures do **not** advance the sim (the budget
  is already fixed); they cost wall-clock only, which is telemetry. The retry
  notice REPLACES the failed attempt in the model's context — retries never
  accumulate the model's own prior text (FAB-024).

Consequence: an agent that computes the perfect action *for the state it
observed* is systematically acting in the past. Anticipating your own
deliberation — leading the target by `B` ticks — is the central skill under
test, and it is hardware-fair because `B` is a scenario constant.

Budget variation across scenarios (B ∈ {10, 20, 40}) is how we probe
sensitivity to thinking cost; within a scenario B is constant (FAB-005).

### 2.3 Normative integrator (METHOD RULE B)

State: `(pos_x_m, pos_y_m, vel_x_mps, vel_y_mps)`, IEEE-754 binary64.
For each tick `n → n+1` (semi-implicit Euler, exactly this order):

```
1. w  = wind_x_at(wind_components, n)          # zero-order hold at tick start
2. ax = held_accel_x + w
   ay = held_accel_y - gravity_mps2
3. vx += ax * dt_s ;  vy += ay * dt_s          # velocity first
4. px += vx * dt_s ;  py += vy * dt_s          # position uses NEW velocity
5. tick = n + 1
6. events, in this order:
   a. goal:     hypot(px-goal_x, py-goal_y) <= goal_radius  -> done, outcome="goal"
   b. oob:      px < min_x or px > max_x or py < min_y or py > max_y
                                               -> done, outcome="oob"
   c. deadline: tick >= deadline_tick          -> done, outcome="timeout"
```

Physics is a pure function of `(state, held_action, tick, scenario)` — no
RNG anywhere in the transition. All scenario randomness lives in the scenario
file itself; all *scorer* randomness (oracle sampling, decoys) is derived from
`ScenarioConfig.seed` via the exact `random.Random` constructions pinned in
§4.2, §4.3, §4.5 and §5.1. Wind components are summed left-to-right in file
order.

**Float-operation convention (normative, FAB-037):** every formula in this
SPEC is evaluated exactly as written — naive left-to-right summation in the
stated order, expressions parenthesized as printed. Library reductions with
different rounding (numpy pairwise sums, `statistics.pstdev`, fused
multiply-add) are off-contract even when mathematically equal: fixtures pin
binary64 bits, and a last-bit difference inside the oracle's elite refit
cascades through `rng.gauss` into a visibly different action.

**Truncation (normative, FAB-026):** a cycle is truncated **iff** the episode
ends at a tick **strictly below** its engage tick `T_k + B`; ending exactly
at `T_k + B` is a valid cycle. Truncated cycles are excluded from BOTH
prediction-fidelity and temporal-anticipation aggregation (their target/
engage state does not exist); the remaining ticks of a truncated window are
not simulated. Boundary cases are pinned in `tests/fixtures/golden_edges.json`.

Events are checked only after a transition (tick ≥ 1); scenario files whose
start state would trigger an event at tick 0 are ILLEGAL — the contract
(`ScenarioConfig.__post_init__`) rejects starts out of bounds or inside the
goal disc, and requires `deadline_tick ≥ 1`.

### 2.4 Hot/cold gradient (HARD RULE 3)

Every observation carries `heat = exp(-distance_to_goal / HEAT_SCALE_M)`
(graded, 1.0 at goal center) and `heat_delta` (change since the previous
decision point; 0.0 at cycle 0). Binary outcome exists (`goal`/`timeout`/
`oob`) but never alone: the outcome score (§4.4) is itself graded via
closest-approach distance.

In **masked-goal scenarios** (`goal_visible=false`) the fields `goal_x_m`,
`goal_y_m`, `distance_to_goal_m` are present with **null values — keys are
never dropped** (FAB-026; rendered prompts include the null-valued keys, so
prompt bytes are stable across masking). Heat and heat_delta remain. Heat
reveals proximity but not bearing — hot/cold search is then the only route
to the goal. These scenarios are the feedback-use probe (§3.3).

### 2.5 Observation completeness (METHOD RULE F)

`Observation` contains everything needed to compute the prediction target
exactly: current kinematic state, the latched (held) action, gravity, `dt_s`,
`B`, and a **truthful wind forecast** `wind_forecast_x_mps2[i] =
wind_x_at(components, tick+i)` with `forecast_ticks >= B` (FAB-003; the
inequality is enforced by the contract, FAB-026). The target (state at
`T_k + B`) is therefore a pure deterministic function of observable fields —
no hidden or stochastic factor. A noisy-forecast factor is future work (v1
pack), not v0.

---

## 3. Diagnostic axes and isolating probes (≥3, each with a probe)

| Axis | What breaks if it's weak | Isolating probe |
|---|---|---|
| **World-model / prediction** | Can't propagate physics forward | §4.1 fidelity vs pure-function target; plus `probe:format` control and `probe:forced_choice` variant (§4.5) to separate formatting from cognition |
| **Temporal anticipation** | Acts for the observed (stale) state | §4.2 divergence-weighted lead margin vs engage-time oracle; budget sweep B∈{10,20,40} on same physics |
| **Feedback-use** | Ignores hot/cold evidence | §4.3 masked-goal scenarios + paired decoy-goal heat ablation |
| **Outcome** (summary, not a cognitive axis) | — | §4.4 graded composite |

**Probe-exclusion rule (normative, FAB-022):** scenarios tagged `probe:*`
are excluded from ALL four axis aggregates and from every §5.4 kill-criterion
quantity; they produce only their own probe metrics. Masked-goal scenarios
(`goal_visible=false`) contribute to feedback-use and outcome but NOT to
temporal anticipation (§4.2 last rule).

Perception and replanning are *named* future axes (v1): v0 observations are
noiseless and structured, so a perception probe would measure nothing yet;
scenario `g010` (wind regime shift) is tagged for replanning but scored under
the four v0 scores until a dedicated replanning metric is designed.

---

## 4. Scoring (exact metrics)

All scores live in `[0,1]` or are `None` (= not measurable / not valid, with
the reason recorded). Constants and formulas `prediction_error`,
`fidelity_from_error`, `action_similarity` and the validity bounds
(`FIDELITY_MIN_COVERAGE`, `FIDELITY_MIN_CYCLES`, `TEMPORAL_MIN_MEAN_W`,
`FEEDBACK_MIN_BAND`, `GATE_II_MARGIN`) are executable in `types.py`.

### 4.1 Prediction-fidelity (METHOD RULE F; FAB-014)

**Valid prediction cycle** := non-truncated AND prediction-parsed. (Action
parse status is irrelevant here — a valid prediction from an action-failed
cycle is kept and scored, per FAB-014; action parsing gates the TEMPORAL
axis, §4.2. This sentence was corrected in round 2 after the builder flagged
it contradicting the paragraph below — the paragraph was always right.)
Per valid cycle `k`:

```
nerr_k     = mean(|Δpos_x|/1.0m, |Δpos_y|/1.0m, |Δvel_x|/1.0m/s, |Δvel_y|/1.0m/s)
fidelity_k = exp(-nerr_k)
```

Episode `prediction_fidelity = mean_k fidelity_k` over valid cycles.

**Abstention accounting (normative):** a reply whose action parses but whose
requested prediction does not gets the SAME in-budget retry ladder as an
action failure (§7.3). If the prediction still fails, the cycle is marked
`prediction_parse_failed` and counts against coverage:

```
prediction_coverage = valid-prediction cycles / prediction-requested non-truncated cycles
```

Fidelity is **publishable only as the pair (fidelity, coverage)**. If
`coverage < FIDELITY_MIN_COVERAGE (0.8)` or valid cycles `<
FIDELITY_MIN_CYCLES (3)`, fidelity is `None` with
`fidelity_invalid_reason ∈ {"insufficient_coverage", "too_few_cycles"}` —
visibly invalid, never "not measurable". A valid prediction from a cycle
whose ACTION failed to parse is kept and scored (the cycle is still excluded
from temporal, §4.2). Selective abstention and engineered early termination
are thereby visible: `n_cycles` and `n_valid_prediction_cycles` are always
published next to fidelity.

Reported alongside, always:

- `action_parse_rate` and `prediction_parse_rate` — separate ("formatting,
  not cognition" has two channels, FAB-014);
- **persistence floor** — fidelity of predicting the observed state
  unchanged, computed on the agent's OWN trajectory over the same valid-cycle
  set (`EpisodeScores.persistence_floor_fidelity`). This floor is per-agent:
  a station-keeping policy has a high floor, so raw fidelity is never
  compared across agents without it. *Informative:* on g001 cycle 0 the
  floor is ≈0.047 — far from the ceiling, so the measure has headroom;
- format-compliance and forced-choice probe results (§4.5);
- `example_echo` count — replies within 2 tolerances of the prompt's example
  values (anti-parroting control, FAB-023).

### 4.2 Temporal anticipation (the deliberation wedge; FAB-015/017/021)

Uses the deterministic sampling-MPC **oracle** of §4.2.1. For each **scored
cycle** `k` — non-truncated, action-parsed, `goal_visible=true`, and whose
returned action actually engaged — with engaged (clamped) agent action
`a_k+1`:

- `a*_eng` = oracle action planned from the TRUE state at the engage tick
  `T_{k+1}` (variant 0): the correct timeline.
- `a*_obs` = oracle action planned from the observed state at `T_k`
  pretending it engages immediately (variant 1): the "no-lag illusion" —
  what a perfect *stale reactor* would do.
- `w_k = ||a*_eng - a*_obs|| / (2 * max_accel)` — how much anticipation
  matters at this cycle.
- `s(u,v) = action_similarity(u,v) = 1 - ||u-v|| / (2*max_accel)`.

```
temporal_raw   = Σ_k w_k * ( s(a_k+1, a*_eng) - s(a_k+1, a*_obs) ) / Σ_k w_k
temporal_score = (temporal_raw + 1) / 2          # in [0,1], 0.5 = no lead
```

**Cycle-inclusion rules (normative, FAB-015; boundary pinned by FAB-036):**
cycles with `parse_failed=true` are excluded from numerator AND denominator
(formatting, not cognition — the engaged NOOP is not the agent's choice);
truncated cycles and the final cycle whose returned action never engaged are
excluded. **An action whose engage tick EQUALS the episode-end tick never
engaged** — there is no window left for it to drive — so its cycle is
temporal-excluded even though the same cycle is fidelity-VALID (its target
tick exists, §2.3). This boundary is live on every timeout episode of the
core pack (deadlines are multiples of B) and is pinned by
`golden_edges.json` case e004. Masked-goal scenarios score `temporal = None`
(the goal-privileged oracles are not a fair reference for a heat-only
agent). If the MEAN weight over
scored cycles `(Σw_k / K) < TEMPORAL_MIN_MEAN_W (0.02)`, or `K = 0`, the
scenario doesn't discriminate: score `None`.

Properties (corrected, FAB-019): a perfect stale reactor scores
`0.5·(1 − Σw²/Σw) < 0.5` — that bound IS formula-guaranteed. Its score
*decreasing* in `B` is an empirical property of the scenario (weights can
saturate at the thrust cap), which is exactly what exit gate (ii) tests,
with margin `GATE_II_MARGIN`. A perfect anticipator scores
`0.5 + Σw²/(2Σw) > 0.5`; this ceiling is scenario-dependent, which is why
the kill criterion normalizes by the measured oracle ceiling (§5.4), not by
an absolute threshold.

#### 4.2.1 The oracle, pinned (normative pseudocode; FAB-017, answers COD-009)

`ORACLE(state s at tick t0, scenario, cycle, variant) -> Action`, with
`rng = random.Random(seed*1_000_003 + cycle*8191)` — **`variant` selects the
timeline semantics (0 = engage-time, 1 = observed-time) and is deliberately
NOT in the seed** (common random numbers, FAB-030): both variants draw the
same candidate stream, so `w_k = ||a*_eng − a*_obs||` measures state
divergence, not CEM sampling noise. With per-variant seeds the noise floor
was ≈0.1 — drowning the true B=10/20 divergence (≈0.03) and breaking the
budget-sweep gate.

```
B = deliberation_ticks
engage_tick = t0 for variant 0;  t0 + B for variant 1     # both = T_k + B
H = min(6, max(1, ceil((deadline_tick - engage_tick) / B)))
A plan is a length-H tuple of per-window actions (ax, ay).

Iteration 0 candidates, in index order:
  index 0:      all-windows NOOP plan
  index 1:      all-windows greedy plan (the §5.2 arrival law evaluated at s)
  index 2..257: sampled plans — for each candidate (outer loop), for each
                window w = 0..H-1 (inner loop):
                    theta = rng.uniform(0.0, TWO_PI)
                    r     = max_accel * math.sqrt(rng.random())
                    a[w]  = (r*math.cos(theta), r*math.sin(theta))

Evaluate J(plan) by rolling out the TRUE simulator from s at t0, engaging
plan[w] for ticks [t0+wB, t0+(w+1)B), stopping at events or after H windows:
    J = 5*success + exp(-d_min/HEAT_SCALE_M) + 0.5*exp(-d_T/HEAT_SCALE_M)
        - (0.02 * t_goal_rel / B if success else 0.0)
    d_min over all rollout ticks INCLUDING the start state at t0;
    d_T = distance at rollout end (or at the goal-hit tick);
    t_goal_rel = ticks from t0 to goal.
Rank candidates by J descending; ties broken by LOWER candidate index.

Iterations 1..3 (elite refit):
  elites = top 16 candidates of the previous ranking (stable order).
  Per window w, per axis (x then y): mean = arithmetic mean of the 16 elite
  actions; sigma = max(population std (ddof=0), 0.5).
  New candidate set: indices 0..15 = the elites carried over UNCHANGED
  (their J values are reused, not re-evaluated); indices 16..271 = fresh
  samples — candidate outer loop, window inner loop, x then y:
      ax = rng.gauss(mean_x[w], sigma_x[w]);  ay = rng.gauss(mean_y[w], sigma_y[w])
  then clamp_accel per window. The NOOP/greedy seeds are NOT re-injected
  after iteration 0 (they survive only via elitism). Re-rank.

Final: oracle action = clamp_accel(arithmetic mean of the final top-16
elites' window-0 actions)          # elite-mean smoothing, FAB-021
```

**H is computed from the cycle's ENGAGE tick `T_k + B` for BOTH variants**
(FAB-033): the two variants of a cycle then consume identical rng draw
counts, so the CRN stream never desynchronizes — with per-variant H, every
cycle within `6B` of the deadline had `H_obs = H_eng + 1`, the streams
diverged from candidate #3 on, and late "desperate" cycles regained exactly
the noise-inflated weights FAB-030/031 were built to remove. `variant` has
NO effect on the computation beyond this engage-tick formula; it documents
which timeline the caller's `(state, t0)` represents and is recorded in
logs and fixtures (FAB-037).

All rollouts use the true simulator and true wind (privileged — that is the
point of a ceiling). The golden ORACLE fixture
(`tests/fixtures/golden_oracle.json`: explicit state + t0 + cycle + variant
→ action, binary64 ==) is committed and is part of exit gate (iii)
(FAB-035).

### 4.3 Feedback-use (FAB-020; supersedes FAB-009's constant ablation)

Measured on the **masked-goal pack only** (heat is redundant when the goal is
visible). Paired runs, same scenario and seed:

- **Run A:** normal observations.
- **Run B — decoy-goal ablation:** heat and heat_delta are computed against a
  FAKE goal position, drawn **once per scenario (shared across repetitions
  and agents, by design — one decoy per pairing keeps A/B comparable;
  FAB-037)**: `rng = random.Random(seed*65_537)`; draws in order:
  `fx = rng.uniform(bounds_min_x+10, bounds_max_x-10)`,
  `fy = rng.uniform(bounds_min_y+10, bounds_max_y-10)`; redraw both (max 8
  times) while `hypot(f-true_goal) < 25.0`; after 8 failures keep the last
  draw. Authoring rule: `goal_visible=false` scenarios REQUIRE a bounds
  extent ≥ 50 m on each axis, or the ≥ 25 m constraint can be unsatisfiable
  and the margins can invert (FAB-037). The signal stays physically
  plausible and varying — the agent cannot detect the ablation from channel
  statistics — but is uninformative about the true goal. (A constant
  ablation is detectable and out-of-distribution; an agent confused by an
  impossible channel would inflate the score.)

```
fb_raw       = mean over masked scenarios ( outcome_A - outcome_B )
band         = mean over the same scenarios (
                 outcome(masked searcher §5.2, true heat)
               - outcome(masked searcher §5.2, decoy heat) )  # heat-only reference
feedback_use = None                       if band < FEEDBACK_MIN_BAND (0.1)
             = 0.5 + 0.5 * clip(fb_raw / band, -1, 1)   otherwise
```

The per-scenario band terms are always published next to the pack-level
band (`PackScores.feedback_band_terms`) so a band dominated by one geometry
is visible (FAB-037). Core-pack reference values (gradient searcher,
FAB-032): g007a +0.679, g007b +0.094, g007c +0.266 → band 0.346, pinned in
`tests/fixtures/golden_masked.json`.

0.5 = no measurable use of feedback; >0.5 = performance depends on hot/cold
evidence. The unnormalized `fb_raw` and `band` are always published next to
the score (`PackScores`), so saturation is visible. Feedback-use is a
PACK-level quantity (it needs paired runs and a shared band) — it lives in
`PackScores`, not `EpisodeScores`. For stochastic (LLM) agents, A and B use
the same number of repetitions and results are reported with ranges (§11).

### 4.4 Outcome (graded + binary, HARD RULE 3)

```
outcome = 0.5·success
        + 0.4·exp( -d_min / HEAT_SCALE_M )
        + 0.1·success·(1 - t_goal / deadline_tick)
```

`success` ∈ {0,1}; `d_min` = minimum distance-to-goal over ticks
**0..episode-end inclusive** (the initial state counts; FAB-026); `t_goal` =
tick of success. Failed episodes still earn up to 0.4·exp(−2/20) ≈ 0.36
(graded closeness); success is always ≥ 0.5 + 0.4·exp(−2/20)·… — verified:
no "camping" pathology, failure cap 0.362 < success floor 0.862.

### 4.5 Formatting controls (METHOD RULE F, second half; FAB-022)

Probe scenarios are excluded from all axis aggregates (§3). During ALL probe
cycles the engaged action is `NOOP_ACTION` throughout the episode, so logs
remain well-defined under RULE A.

- **`probe:format` (identity prediction):** the harness asks the agent to
  restate the *current observed* pos/vel in the standard reply JSON. The
  reply is scored against BOTH the identity target and the true T+B target,
  and the log records which matched better — a T+B match is
  instruction-following drift by a genuinely predictive model, not a
  formatting failure. JSON parse validity (not identity fidelity) is the
  primary compliance signal. Interpretation limits: restating in-prompt
  numbers is easier than emitting computed ones, so probe success is an
  upper bound on real-task format reliability.
- **`probe:forced_choice`:** the harness shows two candidate next-states —
  the true target and a decoy. Decoy construction, pinned (FAB-022):
  `rng = random.Random(seed*104_729 + cycle)`; draws in order:
  `s1 = +1 if rng.random() < 0.5 else -1`, `s2 = +1 if rng.random() < 0.5
  else -1`, `true_is_A = rng.random() < 0.5`. Decoy = true target with
  `pos_x += s1 * 3*PRED_POS_TOL_M` and `vel_x += s2 * 3*PRED_VEL_TOL_MPS`
  (**x-components only** — the y-components have a gravity-only closed form
  computable from the Observation, so a y-perturbed decoy would be spottable
  with zero wind modeling); if the decoy pos_x leaves bounds, flip `s1`.
  Reply schema: `{"choice": "A"}` with values in `CHOICE_VALUES` — no
  numeric formatting at all. Same N=2 retry policy; a still-unparseable
  choice is attributed to formatting and excluded from the accuracy
  denominator (counted in a `choice_parse_rate`). Accuracy isolates the
  world model from number emission. Probe accuracies are ALWAYS published
  with their trial counts (a NOOP-forced probe episode has finitely many
  cycles — n≈11 at B=10 — and LLM repetitions are aggregated before
  reporting; FAB-037).
- **Tolerant repair parser** (§7.3) so fidelity is never lost to trivia.

---

## 5. Baselines and the kill criterion (METHOD RULE C)

All baselines run on every axis, every pack, every release.

### 5.1 Random (floor)

Per cycle: acceleration uniform on the disc of radius `max_accel` —
`rng = random.Random(seed*7919 + rep*1_000_003 + cycle)` where `rep` is the
repetition index (0-based); draws in order: `theta = rng.uniform(0.0,
TWO_PI)`, then `r = max_accel * math.sqrt(rng.random())`; action =
`(r*cos(theta), r*sin(theta))` — exactly this construction. Kill-criterion
evaluation uses **R = 20 repetitions** (FAB-018); ordinary tables use rep 0.
Prediction: persistence (observed state unchanged) — doubles as the fidelity
floor.

### 5.2 Greedy-gradient (reactive, no world model — the one to beat; FAB-025)

Arrival steering on the *observed* (stale) state; no forecast, no lead, no
wind term. Constants: `V_CRUISE = 8.0 m/s`, `K_ARR = 0.35 s⁻¹`,
`K_V = 1.2 s⁻¹`. Goal visible:

```
d = hypot(goal_x - px, goal_y - py)
v_des = min(V_CRUISE, K_ARR*d) * (goal - pos)/d      (zero vector if d < 1e-9)
a_raw = ( K_V*(v_des_x - vx),  K_V*(v_des_y - vy) + gravity_mps2 )
```

The law yields the RAW command; the engaged action is produced by the
harness's single latch clamp (§2.2) — baseline implementations MUST NOT
pre-clamp their replies (FAB-038).

Masked goal (v0.2.2, FAB-032 — supersedes both the 72° law and the v0.2.1
tumbler): the **gradient-estimating searcher**. Masked observations still
contain self pos/vel, so the searcher estimates the heat gradient by least
squares over its own last `GRAD_HIST = 3` windows of
`(displacement, heat_delta)` — using ACTUAL displacements self-corrects
both inertia contamination and the two-cycle latch lag that made reactive
tumblers measure initial-heading luck instead of heat use (a tumbler's
heading-averaged band was NEGATIVE; rotating its arbitrary init heading
flipped the band's sign). Normative pseudocode, evaluated as written:

```
memory: prev_pos (None), hist (list of (dx, dy, delta), max length 3)
at cycle k with observation (pos, vel, heat_delta):
  if prev_pos is not None: hist.append((pos - prev_pos, heat_delta)); trim to 3
  prev_pos = pos
  if len(hist) < 2:
      h = (1,0) if k == 0 else (0,1)                     # bootstrap probes
  else:
      n11 = Σ dx·dx ; n12 = Σ dx·dy ; n22 = Σ dy·dy      # left-to-right sums
      b1  = Σ dx·δ  ; b2  = Σ dy·δ
      det = n11·n22 − n12·n12 ; scale = (n11 + n22) / 2
      if det > 1e-6·scale·scale:
          g = ((n22·b1 − n12·b2)/det, (n11·b2 − n12·b1)/det)
          h = g/‖g‖ if ‖g‖ > 1e-12 else fallback below
      if h unset:                                         # collinear history
          d = hist[-1] displacement; h = (−d_y, d_x)/‖d‖  # perpendicular probe
          (h = (1,0) if ‖d‖ ≤ 1e-12)
  a_raw = (K_V·(V_SEARCH·h_x − vx), K_V·(V_SEARCH·h_y − vy) + gravity)
```

As with the goal-visible law: RAW command out; the harness latch clamp is
the only clamp (FAB-038). The oracle is the one exception in spirit — its
§4.2.1 output is DEFINED with interior clamps and pinned by fixture; as an
acting agent its reply then passes the same latch clamp as everyone (this
composition is included in the FAB-028/037 reference gate numbers).

`V_SEARCH = 6.0 m/s`, `K_V = 1.2 s⁻¹`. Deterministic; heat-plus-own-
kinematics only (no goal access). Bearing-robust by construction: verified
positive paired-ablation contrast with the goal placed E/N/W/S of the start
(+0.067/+0.090/+0.566/+0.796) — no initial-heading luck. First engaged
actions and band terms pinned in `tests/fixtures/golden_masked.json`.
Prediction: persistence.

*Informative:* v0.1's PD law (`Kp=2.0, Kd=2.8`) saturated the thrust cap at
long range, destroying its own damping — it scored BELOW random and was
replaced (FAB-025). Saturation-aware arrival steering is the strongest
defensible reactive controller: it closes to 3–15 m on all tuning scenarios
and wins outright on the easiest.

### 5.3 Oracle (ceiling)

The §4.2.1 sampling MPC planned from the true engage-time state (variant 0
timeline). Its prediction is the true target (fidelity 1.0 by construction).

### 5.4 Kill criterion (pre-registered; FAB-018, supersedes FAB-007)

Let **S** = the goal-visible, non-probe core scenarios
(= {g001, g001_b10, g001_b40, g002, g003, g006, g010} in the v0 pack).
All quantities are **pack means over S** of episode outcome scores; random
uses the mean over its R=20 reps; temporal means are taken over the
scenarios in S where the score is not None.

```
Validity floors (must hold or the PACK is invalid -> apply §5.5 levers,
                 re-evaluate; nothing is published from an invalid pack):
  V1: mean(outcome_oracle) - mean(outcome_random) >= 0.2
  V2: temporal_oracle - 0.5 >= 0.05

Kill conditions (either one -> do not publish; redesign and log FAB entry):
  K1: D_outcome = (mean(outcome_oracle) - mean(outcome_greedy))
                / (mean(outcome_oracle) - mean(outcome_random))  < 0.25
  K2: (temporal_greedy - 0.5) >= 0.5 * (temporal_oracle - 0.5)
```

K2 is relative to the measured oracle headroom because the temporal ceiling
is scenario-dependent (§4.2). Evaluated at M1 exit (gate iv) and re-evaluated
whenever the core pack changes. *Informative proxy (FAB-025):* with
lead-greedy as an oracle lower bound, D_outcome ≈ 0.63 on the tuning pack —
comfortable headroom above 0.25.

### 5.5 Pre-registered redesign levers (in escalation order)

1. Gustier wind: shorter periods (≈60–160 ticks), higher amplitude.
2. Tighter deadline (≈40% less slack over oracle time-to-goal).
3. Moving goal (goal position a slow pure function of tick).
4. Deceptive heat: an off-goal heat lobe making pure gradient ascent
   non-monotonic (pack-level change; heat formula gains a documented second
   term — schema bump).

### 5.6 Diagnostic synthetic agents (not baselines, used by gates)

- **Stale-reactor:** always outputs `a*_obs` (§4.2, variant 1). Used by exit
  gate (ii) via the **matched-state probe** (FAB-031, normative): the
  reference trajectory is lead-greedy (below) on the B=20 member of the
  sweep triplet; probe states are its first 6 decision states whose action
  engaged and whose `tick + 40 < reference episode end`, taken as
  `(state_k, held_k, tick_k, k)` with `held_k` = the action latched during
  that window. For each B ∈ {10, 20, 40}: `engage_state = propagate(state_k,
  held_k, tick_k, B)`; `w_k` per §4.2 with the B-variant scenario config;
  probe score = `0.5·(1 − Σw² / Σw)` (the analytic stale-reactor temporal
  score on those states). Gate: the score must DROP by at least
  `GATE_II_MARGIN (0.01)` at each step B=10→20→40 — proving the world
  punishes unanticipated deliberation and is not secretly turn-based.
  *Why matched states:* the on-policy episode sweep is small-sample noise —
  the reactor dies out-of-bounds after 2–4 scored cycles at large B, and
  its measured direction flipped between v0.2.0 and v0.2.1 oracle seeds;
  matched states isolate the budget effect exactly. The on-policy episode
  sweep is still REPORTED as informative (its outcome ladder — B=10 lives
  longest — is evidence in itself), but the gate is the probe.
  Pre-verified with the architect's reference implementation on g001
  physics: 0.4550 (B=10) → 0.4332 (B=20) → 0.3749 (B=40).
  **Admissibility (normative, FAB-034 — replaces the tick+40 rule):** let
  `B_max` = the largest budget in the sweep; sweep members MUST share
  `seed`. A reference decision state is ADMISSIBLE iff for EVERY B in the
  sweep, propagating `(state_k, held_k)` forward B ticks with the true
  simulator reaches `tick_k + B` without a terminal event (so probe
  propagation never meets an event, and w cannot saturate on a
  past-the-end state). Probe states = the first 6 admissible states in
  trajectory order; oracle calls use `cycle = k`. Fewer than 6 admissible
  states ⇒ the pack is INVALID for gate (ii) — apply §5.5 levers and
  re-author.
- **Lead-greedy (diagnostic):** §5.2's law evaluated on the observed state
  propagated `B` ticks forward using only Observation fields. Not a
  baseline; it is the cheap existence proof that anticipation pays
  (FAB-025), and a useful sanity row in every results table.
- **Persistence-predictor:** §5.1's prediction rule, reported as the
  fidelity floor.

---

## 6. M1 exit gates (all must pass; brief §6)

i. **Reproducibility (RULE B):** two full same-seed runs of the random agent
   over the core pack produce byte-identical canonical log files (sha256
   compare). Ships as a test.
ii. **Temporal invariant:** the matched-state probe (§5.6) decreasing with
   margin `GATE_II_MARGIN` across the g001 physics variants
   (g001_b10 / g001 / g001_b40). Reference numbers (architect's
   implementation): 0.4550 → 0.4332 → 0.3749.
iii. **Golden fixtures CI green** (§9): `golden_g001.json` AND
   `golden_edges.json` AND `golden_oracle.json` AND `golden_masked.json`,
   exact float equality, not approx. (Oracle and masked fixtures added by
   FAB-035 — every temporal/feedback number flows through them, so M1 must
   not exit around a non-conformant oracle or searcher.)
iv. **Kill criterion** (§5.4) evaluated with its validity floors and passed;
   numbers logged in DECISIONS.md.

---

## 7. Harness, adapter contract, and wire schema (METHOD RULE E)

### 7.1 Adapter = transport only (~20 lines)

An adapter implements `types.Adapter`: `complete(prompt, *, max_tokens=512,
temperature=0.0, seed=None) -> str`. It may hold a base URL, model name, API
key from env. It must NOT build prompts, parse, retry-on-parse-failure, or
see scenario state. It MAY raise on transport errors: the **harness owns
pacing (NIM 40 RPM), transport retries with backoff, and timeouts**;
transport retries are recorded as telemetry (`transport_retries`) and never
advance sim time (FAB-026). Reference adapters: NIM (OpenAI-compatible HTTP,
dracarys) and Ollama (local llama3.1:8b) — each ≈20 lines. API keys via env
only (never committed).

### 7.2 Prompting (harness-owned)

One frozen template per results-version, committed in-repo. Content
requirements: physics summary with units; explicit timeline warning ("the
world advances `B` ticks while you think; your action engages at tick
`T+B`"); **an explicit sentence that during those `B` ticks the previously
latched action — `held_accel_*` in the observation — keeps applying, and the
prediction targets the state at engage time under that HELD action, not the
action being returned** (FAB-026: a model predicting "after my new action"
would be penalized by a prompt-wording confound, invisibly); the full
Observation as JSON **including null-valued keys**; the reply schema with
`EXAMPLE_REPLY_JSON` (whose values are normatively out-of-band, FAB-023);
instruction to output a single JSON object and nothing else. Prompt changes
bump the results version — scores are never compared across prompt versions.

Frozen prompt identifiers: ordinary cycles use `1.0`; format-control cycles
use `probe-format-1.0`; forced-choice cycles use `probe-choice-1.0`. The two
probe templates are isolated from the ordinary template. On core_v0 cycle 0
with the canonical `episode_id="prompt-freeze"`, their prompt-byte SHA-256
pins are respectively
`297feeef1b9b5335e57eccc08975d2b4464c573df132a84f8b8fb758524e9104`
(g008) and
`6719631b32b5b3bb05daf24f46fd8f0bfa90d077b129b1cbc5dda8e0d034a78c`
(g009). Any template byte change requires a prompt-version bump and updated
hash test; runtime episode IDs are expected to make actual prompt hashes vary.

### 7.3 Reply parsing and repair (tolerant, never exact-match; FAB-014/024/026)

1. Strip markdown code fences.
2. Extract the **last** balanced `{...}` block that contains the required
   top-level key(s) for the cycle type, using string-aware brace scanning
   (braces inside JSON strings don't count). Rationale: models may emit
   prose or a self-corrected second object; the last complete candidate is
   the model's final answer.
3. `json.loads` with `parse_constant` set to reject bare `NaN`/`Infinity`
   (strict JSON); on failure apply repairs (single→double quotes, strip
   trailing commas) and retry parse once.
4. Validate: values must be JSON **numbers** — booleans and quoted strings
   are invalid (no `float()` coercion of strings; `True` is not a number
   here). Any finite float is accepted; extreme-but-finite values (1e308)
   saturate naturally in the error formulas — no ad-hoc range checks. Both
   `ACTION_FIELDS` present and valid → action OK, clamp at engage; all four
   `PREDICTION_FIELDS` present and valid → prediction OK.
5. Retry ladder: on ACTION-parse failure OR (prediction requested AND
   prediction-parse failure): up to **N=2** reprompt retries. The retry
   prompt REPLACES the failed attempt (no accumulation of the model's own
   prior text — retries must not become free chain-of-thought; FAB-024).
6. After retries: action still failing → engage `NOOP_ACTION`,
   `parse_failed=true` (cycle excluded from all cognition axes); prediction
   still failing → `prediction_parse_failed=true` (counts against coverage,
   §4.1). Retries never advance sim time (RULE A); wall-clock is telemetry.
7. Per-cycle `parse_retries` is logged; every results table reports the
   fraction of retried cycles per agent, and the RULE D comparison (§8)
   includes a sensitivity slice excluding retried cycles (FAB-024).

---

## 8. Matched-pair architecture ablation (METHOD RULE D)

Same base model (**dracarys via NIM**), same adapter, same temperature (0.0),
same scenarios, same budget B (sim budget is fixed per scenario, so the
two-call scaffold costs no extra sim time by construction; wall-clock
telemetry will show the difference and is reported as telemetry):

- **(a) END2END:** single prompt asks for prediction + action in one reply.
- **(b) WM-SCAFFOLD:** small in-repo scaffold (<150 lines), two stages:
  1. prediction-only prompt → parsed `Prediction`;
  2. action-only prompt that includes the agent's *own* stage-1 prediction
     labeled as "your predicted state at engage time".
  The scaffold never touches the true simulator (no oracle leakage).

The treatment prompt set is frozen as `wm-scaffold-1.0`. On the canonical
g001 cycle-0 Observation with `episode_id="prompt-freeze"`, the stage-1
prompt SHA-256 is
`6730b9775c9ae77d55f1caa488556928442d95817d76976e2cc7da9bae1d774c`.
For the same Observation and canonical own prediction `(1,2,3,4)`, stage 2 is
`110c51845ea9a07d054ce87e5247ac657a4bf6ef7c80a31bd88ab165d2284935`.
The implementation is 131 lines and CI enforces the `<150` constraint.

Each stage independently uses the §7.3 parse-retry ladder. If stage 1 remains
invalid, stage 2 still runs with `Your predicted state ...: null`; this keeps
action-format attribution observable rather than silently forcing a no-op. If
stage 2 remains invalid, the ordinary no-op action fallback applies. The cycle
`parse_retries` is the sum across stages, so the sensitivity slice excludes a
cycle retried in either stage. Raw completions are logged in stage order
(prediction attempts, then action attempts).

The official runner shares one adapter and one start-to-start pacer across
arms, passes `seed=rep_index` to every call, and alternates which arm runs first
by repetition+scenario parity to reduce service-drift order bias. At 40 RPM the
minimum call-start interval is 1.5 s. Transport failures receive up to two
harness retries with 1 s then 2 s backoff; neither pacing nor retry advances
simulated time.

For every masked-goal scenario, each arm also runs a fresh same-seed episode
with the deterministic §4.3 decoy goal immediately after its normal episode.
The report publishes each normal/decoy outcome and delta, the deterministic
greedy reference band and its per-scenario terms, the number of pairs, and the
normalized feedback-use value (or `None` below `FEEDBACK_MIN_BAND`). Decoy
episodes have separate canonical logs and never enter the ordinary axis
summaries.

Probe-tagged scenarios are excluded from both treatment arms and all matched
axis aggregates. Instead, each probe is run once per repetition through one
shared-model `control` agent after the matched grid. Format and forced-choice
rows retain their independently frozen prompt versions and always publish
`n_trials`, `n_parsed`, parse rate, wall-time telemetry, transport retries,
and their probe-specific metrics. They are controls on interpretation, not a
third treatment arm.

Long external runs may be resumed only from complete canonical episode logs.
Before reuse, the runner validates canonical encoding and terminal summary,
plus scenario, adapter/arm, frozen prompt version, schema, pack, host class,
and ordered scenario IDs against the requested run. A mismatch is fatal;
validated episodes are re-scored locally and only missing paths may call the
adapter. This changes neither seeds nor arm ordering.

**Full-system MARIA** runs as a separate, clearly labeled **CONFOUNDED**
datapoint (different prompts, memory, planning stack) — never the treatment
arm. Maria's repo/services are read-only subjects (brief §7).

Pre-registered hypothesis: the scaffold moves prediction-fidelity and
temporal-anticipation more than outcome. A null/negative result is publishable
as-is. Repetition seeding for LLM rows: `seed = rep_index` is passed to the
adapter (a seed-honoring endpoint still yields distinct reps; a seed-ignoring
one yields natural nondeterminism) — never the same seed for all reps
(FAB-026).

---

## 9. External test bank

### 9.1 Layout (v0: local directory; later: downloadable packs)

```
packs/<pack_name>/pack.json
packs/<pack_name>/scenarios/<scenario_id>.json
```

`pack.json`:

```json
{
  "name": "core_v0",
  "version": "0.1.0",
  "schema_version": "0.2.0",
  "description": "...",
  "scenarios": ["g001.json", "g002.json"]
}
```

Scenario file = `ScenarioConfig` fields verbatim (JSON object;
`wind_components` = list of `{amp_mps2, period_ticks, phase_rad}`;
`axis_tags` = list of strings). **Strict loader:** built on
`ScenarioConfig.from_json_dict` (tuple coercion; unknown fields are errors);
`schema_version` major.minor must match `types.SCHEMA_VERSION`; contract
invariants (`__post_init__`: forecast ≥ B, start in bounds and outside the
goal disc, positive dt, deadline ≥ 1) are enforced at load time — the loader
may add checks but never fewer (FAB-026).
Loader API (builder-owned): `chronogym.bank.load_pack(path) -> list[ScenarioConfig]`.
Downloadable packs (M1.5): deterministic stored ZIP of the same layout plus a
canonical JSON sidecar manifest. ZIP members are in manifest order, rooted at
the pack name, stored uncompressed, timestamped `1980-01-01 00:00:00`, and
carry mode 0644. The sidecar records pack/schema versions, ordered scenario
IDs, archive filename + SHA-256, and every member path + SHA-256. Verification
requires the exact member set, safe rooted paths, archive hash, and all member
hashes (COD-017/019).

### 9.2 Core pack v0 (authored by Fable at M1; intent table)

| id | intent |
|---|---|
| g001 | baseline (the golden-fixture scenario; gravity 5.0) |
| g001_b10 / g001_b40 | same physics, B=10 / B=40 (budget sweep, gate ii); forecast held at 2×B across the sweep (FAB-037: constant ratio, not constant length, so forecast informativeness doesn't confound the budget curve) |
| g002 | high wind (amp 5+2.5, periods 160/61) |
| g003 | tight deadline (380 ticks) |
| g006 | far goal, adverse wind phase |
| g007a / g007b / g007c | masked goal (feedback-use probe), three bearings: right-down, down, left-up (FAB-037: three geometries so the band is not one-geometry luck) |
| g008 | `probe:format` (identity prediction; excluded from axes; B=10 so the NOOP-forced episode yields ~11 trials instead of ~5, FAB-037) |
| g009 | `probe:forced_choice` (excluded from axes; B=10, same reason — probe accuracy is published WITH its trial count, §4.5) |
| g010 | wind regime shift via beat wind, periods 150/130 (replanning-tagged) |

---

## 10. Reproducibility gate (METHOD RULE B)

- Physics: pure function — §2.3. No global RNG; every `random.Random` is
  constructed with a spec'd seed expression at point of use (§4.2.1, §4.3,
  §4.5, §5.1).
- Logs: one JSON object per line through `types.canonical_json` (sorted
  str-only keys, no whitespace, `allow_nan=False`, −0.0 normalized,
  shortest-round-trip floats).
- **Normative log records (FAB-026):** the per-cycle record carries at least
  `(episode_id, cycle, tick, engage_tick, observation, reply incl.
  parse_retries and prediction_parse_failed, raw completion text, engaged
  clamped action, truncated flag, wall_clock_ms)`; the run manifest carries
  `(schema_version, pack name+version, scenario ids, agent name, prompt
  version, host class)`. Raw completions are retained so parser fixes can
  re-score old runs. The builder owns the concrete record types
  (`runner.CycleRecord` satisfies this list); this field list is the
  contract.
- Test: same-seed double run → byte-identical logs (gate i). Cross-*platform*
  bit-identity is NOT claimed (libm variance); the claim is per-host
  determinism, documented in README. Results tables always state host class.
- LLM agents are not deterministic even at temperature 0; determinism is
  claimed for the *world, scoring, and baselines*. LLM rows report
  mean ± range over ≥3 repetitions (§11).

---

## 11. Experiment plan and paper outline (M2/M3)

### 11.1 Experiments

Agents: random, greedy, oracle (+ stale-reactor, lead-greedy & persistence
diagnostics), dracarys END2END, dracarys WM-SCAFFOLD, llama3.1:8b (2nd
adapter, M1.5), MARIA (CONFOUNDED label). Pack: core_v0. Reps: 1 for
deterministic agents (random: 20 for the kill criterion, §5.1), 3 for LLM
agents with rep-derived seeds (§8), reported mean ± range. NIM 40 RPM
budget: ≈30 calls/episode × 12 pack scenarios × 3 reps × 2 arms ≈ 2.2k calls ≈ a
weekend of polite pacing (harness-owned, §7.1).

Deliverables: per-axis table (the diagnosis vector per agent — with
coverage, parse rates and Σw/weight distributions per row, §13), radar plot,
budget-sweep curve (temporal vs B per agent), kill-criterion numbers with
validity floors, fidelity-vs-outcome scatter (do good predictors win?).

### 11.2 Paper outline

1. The deliberation gap: agents are scored as if the world waits.
2. Related work (§12 table + clock lineage).
3. ChronoGym: contract, clock (RULE A), axes & probes, scoring.
4. Reproducibility design (RULE B).
5. Baselines + kill criterion results (RULE C), incl. the v0.1→v0.2
   red-team retune as a worked example of the gate doing its job.
6. Matched-pair ablation (RULE D) + confounded full-system datapoint.
7. Diagnosis case studies (per-axis failure narratives).
8. Limitations & threats (§13).
9. Open release: packs, seeds, logs. Funding angle: open eval infra
   (NLnet/NGI, NVIDIA Inception).

---

## 12. Related work and wedges (informative; verified round 1, FAB-016)

| Benchmark | What it scores | Wedge (what ChronoGym adds) |
|---|---|---|
| Real-Time Reasoning Gym (Wen et al., Stanford SALT-NLP, 2025; arXiv:2511.04898) | LLM agents in never-pausing Freeway/Snake/Overcooked; environment steps every N generated tokens (hardware-agnostic token clock) | scores OUTCOME only under thinking cost — no anticipation metric, no prediction axis, no probes, no hot/cold, no matched-pair ablation; cost scales with verbosity, conflating token count with cognition, whereas ChronoGym's fixed B isolates delay *compensation* |
| Gaia2 / ARE (Meta Superintelligence Labs, ICLR 2026; arXiv:2602.11964; platform arXiv:2509.17158) | 1,120 scenarios, asynchronous event-driven world with seeded simulated time flowing while the agent reasons; time-sensitive tasks | thinking cost is wall-clock ("generation time" mode; hardware-unfair) or zero ("instant" mode); no fixed simulated budget; no anticipation/prediction axes |
| BALROG (Paglieri et al., ICLR 2025; arXiv:2411.13543) | agentic LLM/VLM gameplay outcomes (BabyAI, Crafter, TextWorld, Baba Is AI, MiniHack, NetHack) | agent-paced (world waits per step); no deliberation cost; outcome-centric |
| AutumnBench / WorldTest (Warrier et al., Basis & MIT, 2025; arXiv:2510.19788) | world-model learning in 43 grid worlds, 129 tasks: masked-frame prediction, planning, change detection | agent-paced interaction (world pauses); no temporal-anticipation axis; 19/43 environments stochastic vs ChronoGym's byte-identical determinism |
| WorldPrediction (Chen et al., Meta FAIR & HKUST, 2025; arXiv:2506.04363) | video-based world modeling + procedural planning via discriminative choice | passive/discriminative; no closed loop; no deliberation budget |
| ByteSized32-SP ("Can LMs Serve as Text-Based World Simulators?", Wang et al., ACL 2024; arXiv:2406.06485) | LLM next-state simulation accuracy over text-game transitions | no acting agent, no clock; ChronoGym's fidelity axis is the closed-loop, deliberation-coupled version (R-WoM, arXiv:2510.11892, is a *method* in this space, cited in prose, not a benchmark) |
| EnvSimBench (2026; arXiv:2605.07247) | LLM-as-environment-simulator fidelity (167 tool environments, LLM-free grading) | no acting agent; no time pressure |
| APB (2026; arXiv:2606.04874) | 4,209 cases, 22 domains: holistic + feedback-conditioned step-wise planning + robustness | static plan grading; no execution clock at all; diagnostic axes are planning-internal, none temporal |
| SIMMER (2026; arXiv:2606.14574) | latent failures in executable plans via symbolic kitchen world model | turn-based symbolic execution; no continuous dynamics; no deliberation cost |

**Clock lineage (deliberately standard machinery):** the fixed-delay
latched-action clock is a constant action-delay MDP with action repeat —
real-time heuristic search (Korf, AIJ 1990), metareasoning (Russell &
Wefald 1991), delayed-feedback MDPs (Walsh et al., JAAMAS 2009), action-delay
RL (Firoiu et al., arXiv:1810.07286), Real-Time RL / RTMDP (Ramstedt & Pal,
NeurIPS 2019), concurrent control (Xiao et al., ICLR 2020; arXiv:2004.06089),
and SC2LE's `step_mul` (Vinyals et al. 2017; arXiv:1708.04782) — the latter
literally a seed-reproducible sim-tick budget in a moving world, scored on
outcome only. VideoGameBench (arXiv:2505.18134) runs wall-clock real-time and
its Lite variant pauses during inference, explicitly acknowledging the latency
confound ChronoGym's simulated budget removes. ChronoGym's contribution is
not this clock; it is SCORING anticipation of the delay as an isolated,
probe-controlled diagnostic axis with counterfactual oracles.

Wedge summary: (1) an explicit temporal-anticipation SCORE (engage-time vs
observed-time counterfactual oracles) under a reproducible simulated budget —
prior real-time evals either charge wall-clock (Gaia2 generation-time;
VideoGameBench) or charge reproducible cost but score only outcome (RTR-Gym,
SC2LE); (2) always-multi-factor + graded hot/cold; (3) matched-pair
predict-then-act ablation on the same base model, with the full agent system
as an explicitly confounded extra datapoint. Complementarity note: RTR-Gym
charges *variable* thinking length (measuring "manage your verbosity");
ChronoGym fixes B (measuring "compensate for known delay") — the two
questions are orthogonal and both needed.

---

## 13. Threats to validity (informative)

- **LLM nondeterminism** → ≥3 reps with rep-derived seeds, temp 0, ranges
  reported; world/scoring deterministic.
- **Prompt sensitivity** → frozen versioned prompts; scores never compared
  across prompt versions; held-action semantics stated explicitly (§7.2).
- **Oracle suboptimality** → ceiling is a lower bound; report oracle margin
  over greedy; oracle params pinned in §4.2.1.
- **Oracle multimodality** — HONEST framing (FAB-021): `w_k` weighting does
  NOT mitigate it; two equally-good modes can inflate `w_k` and score a
  mode-mismatched agent as anti-anticipating. Mitigations actually in place:
  elite-MEAN smoothing (§4.2.1) damps mode flips; the per-cycle margin
  distribution (not just the mean) is reported. Pre-registered: a
  value-regret variant (score by J-difference of the agent action under the
  true simulator) ships as a SECONDARY reported metric at M1.5; if it
  disagrees with the action-distance metric beyond cosmetics, the architect
  revisits the primary (logged as a FAB entry).
- **On-policy weighting** — `w_k` is computed along each agent's own
  trajectory, so per-agent temporal scores carry different difficulty
  weightings; Σw and the weight distribution are published per row, and
  cross-agent comparison is caveated accordingly.
- **Feedback-band composition** — the band is a mean over only three masked
  geometries and its terms differ ~7× (g007a 0.679 vs g007b 0.094); the
  per-scenario terms are always published (`feedback_band_terms`) and the
  searcher's residual bootstrap asymmetry (first two probe windows head +x
  then +y) is documented rather than hidden.
- **Selective abstention / engineered termination** → coverage + validity
  rules (§4.1); n_cycles always published.
- **Example anchoring** → out-of-band example values + example_echo flag
  (FAB-023).
- **Truthful forecast is generous** → v1 factor pack adds forecast noise
  (seed-determined), keeping RULE F by putting noisy values in the
  observation itself.
- **Float portability** → per-host determinism only (§10).
- **Single world** → the contract (`types.py`, pack schema) is world-agnostic
  by design; a second world family is post-M3.
