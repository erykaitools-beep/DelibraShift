# ChronoGym SPEC v0.1

Owner: Fable (Chief Architect & Scientist). Normative unless marked
*informative*. The executable contract is `chronogym/types.py` (schema
version 0.1.0); where prose and `types.py` disagree, `types.py` wins and the
disagreement is a bug to log in DECISIONS.md.

---

## 1. Novelty

### 1.1 The one sentence (locked, FAB-001)

> **ChronoGym is the first open benchmark that scores whether an agent
> anticipates its own deliberation — the world advances by a seed-fixed
> *simulated* tick budget while the agent thinks — and that decomposes
> performance into prediction-fidelity, temporal anticipation, feedback-use,
> and outcome in a reproducible multi-factor world with a graded hot/cold
> signal, under a matched-pair world-model ablation on the same base model.**

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
controller with gravity feedforward and damping — deliberately strong. It has
no forecast use, no lead, no world model. The world is designed so that
inertia + time-varying wind + a deadline punish acting on stale state
(overshoot, drift past the goal, wasted seconds). This challenge is
*empirically gated*: the kill criterion (§5.4) is pre-registered and evaluated
at M1 before anything is published. **Status: conditional pass — gated at M1;
redesign levers pre-registered (§5.5).**

**(c) Does not lean on wall-clock latency.** Every temporal quantity that is
scored is denominated in sim ticks; the deliberation budget is a fixed,
seed-determined scenario parameter (`deliberation_ticks`), identical on any
hardware. Wall-clock is recorded in `EpisodeScores.wall_clock_ms_telemetry_only`
and never enters a score. Two same-seed runs produce byte-identical logs on
the same host (§10). **Status: pass by construction.**

If any challenge fails at its gate, we pivot and record it in DECISIONS.md
(brief §2).

---

## 2. The v0 world: "Windrift"

### 2.1 Geometry and factors

A 2D plane with bounds `[0,100] × [0,100]` m, +x right, +y up. A single
object (the craft the agent thrusts) starts at a scenario-defined position
and velocity and must enter a goal disc (`goal_radius_m`, default 2 m) before
`deadline_tick`.

Three interacting factors (HARD RULE 2 satisfied — ≥2 required):

1. **Gravity** — constant acceleration `gravity_mps2` along −y.
2. **Time-varying lateral wind** — acceleration along x, a sum of sinusoids
   (`WindComponent`s), a pure function of the integer tick (`wind_x_at`).
3. **Deadline** — episode fails at `deadline_tick`. It couples with 1 and 2
   because trajectory *time* is what the agent spends; slow safe paths lose.

The factors interact through shared velocity integration (inertia): thrust
spent fighting gravity is unavailable against wind, and wind-induced drift
compounds over exactly the time the deadline meters out.

### 2.2 The deliberation-aware clock (METHOD RULE A; FAB-002)

The world **never pauses** and is **never turn-based**, but deliberation cost
is *simulated*, not wall-clock:

- At cycle `k` the agent receives `Observation` of the true state at tick
  `T_k` (`T_0 = 0`).
- While it deliberates, the world advances exactly
  `B = deliberation_ticks` ticks under the **latched action** `h_k`
  (`h_0 = NOOP_ACTION`; `h_{k+1} = clamp_accel(reply_k.action)`).
- The returned action engages at `T_{k+1} = T_k + B` and stays latched for
  the next window.
- Adapter retries after parse failures do **not** advance the sim (the budget
  is already fixed); they cost wall-clock only, which is telemetry.

Consequence: an agent that computes the perfect action *for the state it
observed* is systematically acting in the past. Anticipating your own
deliberation — leading the target by `B` ticks — is the central skill under
test, and it is hardware-fair because `B` is a scenario constant.

Budget variation across scenarios (e.g. B ∈ {10, 20, 40}) is how we probe
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
`ScenarioConfig.seed` via explicitly spec'd `random.Random` constructions
(§4.2, §4.5). Wind components are summed left-to-right in file order.

If an episode ends mid-window, remaining ticks of that window are not
simulated; the cycle in progress is marked `truncated` and excluded from
prediction-fidelity aggregation (its target tick does not exist).

### 2.4 Hot/cold gradient (HARD RULE 3)

Every observation carries `heat = exp(-distance_to_goal / HEAT_SCALE_M)`
(graded, 1.0 at goal center) and `heat_delta` (change since the previous
decision point; 0.0 at cycle 0). Binary outcome exists (`goal`/`timeout`/
`oob`) but never alone: the outcome score (§4.4) is itself graded via
closest-approach distance.

In **masked-goal scenarios** (`goal_visible=false`) the observation omits
`goal_x_m`, `goal_y_m`, `distance_to_goal_m`; heat and heat_delta remain.
Heat reveals proximity but not bearing — hot/cold search is then the only
route to the goal. These scenarios are the feedback-use probe (§3.3).

### 2.5 Observation completeness (METHOD RULE F)

`Observation` contains everything needed to compute the prediction target
exactly: current kinematic state, the latched (held) action, gravity, `dt_s`,
`B`, and a **truthful wind forecast** `wind_forecast_x_mps2[i] =
wind_x_at(components, tick+i)` with `forecast_ticks >= B` (FAB-003). The
target (state at `T_k + B`) is therefore a pure deterministic function of
observable fields — no hidden or stochastic factor. A noisy-forecast factor
is future work (v1 pack), not v0.

---

## 3. Diagnostic axes and isolating probes (≥3, each with a probe)

| Axis | What breaks if it's weak | Isolating probe |
|---|---|---|
| **World-model / prediction** | Can't propagate physics forward | §4.1 fidelity vs pure-function target; plus `probe:format` identity-prediction control and `probe:forced_choice` variant (§4.5) to separate formatting from cognition |
| **Temporal anticipation** | Acts for the observed (stale) state | §4.2 divergence-weighted lead margin vs engage-time oracle; budget sweep B∈{10,20,40} on same physics |
| **Feedback-use** | Ignores hot/cold evidence | §4.3 masked-goal scenarios + paired heat-channel ablation runs |
| **Outcome** (summary, not a cognitive axis) | — | §4.4 graded composite |

Perception and replanning are *named* future axes (v1): v0 observations are
noiseless and structured, so a perception probe would measure nothing yet;
scenario `g010` (wind regime shift) is tagged for replanning but scored under
the four v0 scores until a dedicated replanning metric is designed.

---

## 4. Scoring (exact metrics)

All per-episode scores live in `[0,1]` or are `None` = "not measurable here".
Constants and formulas `prediction_error`, `fidelity_from_error`,
`action_similarity` are executable in `types.py`.

### 4.1 Prediction-fidelity (METHOD RULE F)

Per non-truncated, successfully parsed cycle `k`:

```
nerr_k     = mean(|Δpos_x|/1.0m, |Δpos_y|/1.0m, |Δvel_x|/1.0m/s, |Δvel_y|/1.0m/s)
fidelity_k = exp(-nerr_k)
```

Episode `prediction_fidelity = mean_k fidelity_k` over valid cycles; `None`
if no valid cycle. Graded state distance — never exact match. Reported
alongside, always:

- `parse_rate` — parsed cycles / total cycles ("formatting, not cognition");
- **persistence floor** — fidelity of predicting the observed state unchanged
  (golden fixture pins it at ≈0.0075 for g001 cycle 0, i.e. the floor is far
  from the ceiling: the measure has headroom);
- format-compliance and forced-choice probe results (§4.5).

### 4.2 Temporal anticipation (the deliberation wedge)

Uses a deterministic sampling-MPC **oracle** (also the ceiling baseline §5.3).
For each cycle `k` with engaged (clamped) agent action `a_k+1`:

- `a*_eng` = oracle's first action planned from the TRUE state at the engage
  tick `T_{k+1}` (correct timeline: the action engages when it actually can).
- `a*_obs` = oracle's first action planned from the observed state at `T_k`
  pretending it engages immediately — the "no-lag illusion", i.e. what a
  perfect *stale reactor* would do.
- `w_k = ||a*_eng - a*_obs|| / (2 * max_accel)` — how much anticipation
  matters at this cycle (0 = not at all).
- `s(u,v) = action_similarity(u,v) = 1 - ||u-v|| / (2*max_accel)`.

```
temporal_raw   = Σ_k w_k * ( s(a_k+1, a*_eng) - s(a_k+1, a*_obs) ) / Σ_k w_k
temporal_score = (temporal_raw + 1) / 2          # in [0,1], 0.5 = no lead
```

If `Σ_k w_k < 0.05` the scenario doesn't discriminate: score `None`.

Properties: a perfect stale reactor scores strictly below 0.5, and lower as
`B` grows (this is exit gate (ii), §6); a perfect anticipator scores above
0.5. Weighting by `w_k` means cycles where both oracles agree contribute
nothing, isolating anticipation from generic competence.

Oracle determinism: `rng = random.Random(seed*1_000_003 + cycle*8191 + variant)`
with `variant` 0 for `a*_eng`, 1 for `a*_obs`. Sampling MPC: plans
piecewise-constant acceleration per window, horizon `H = min(6,
ceil(ticks_remaining / B))` windows; 256 sampled candidates per iteration
plus the greedy action and NOOP; 3 elite-refit iterations (top 16, Gaussian
refit, σ floor 0.5 m/s²); objective `J = 5·success + exp(-d_min/HEAT_SCALE_M)
+ 0.5·exp(-d_T/HEAT_SCALE_M) - 0.02·(t_goal/B)` where `d_min` = closest
approach in rollout, `d_T` = terminal distance, `t_goal` = ticks to goal (0
if not reached). First action of the best plan is the oracle action. All
rollouts use the true simulator and true wind (privileged — that is the
point of a ceiling).

### 4.3 Feedback-use

Measured on the **masked-goal pack only** (heat is redundant when the goal is
visible). Paired runs, same scenario and seed:

- Run A: normal observations.
- Run B: heat channel ablated — `heat := 0.5`, `heat_delta := 0.0` every cycle
  (constant, uninformative).

```
fb_raw       = mean over masked scenarios ( outcome_A - outcome_B )
band         = mean ( outcome_oracle - outcome_random ) on the same scenarios
feedback_use = clip( 0.5 + 0.5 * fb_raw / max(band, 0.05), 0, 1 )
```

0.5 = no measurable use of feedback; >0.5 = performance depends on hot/cold
evidence. For stochastic (LLM) agents, A and B use the same number of
repetitions and results are reported with ranges (§11).

### 4.4 Outcome (graded + binary, HARD RULE 3)

```
outcome = 0.5·success
        + 0.4·exp( -d_min / HEAT_SCALE_M )
        + 0.1·success·(1 - t_goal / deadline_tick)
```

`success` ∈ {0,1}; `d_min` = minimum distance-to-goal over all simulated
ticks; `t_goal` = tick of success. Failed episodes still earn up to 0.4
(graded closeness); faster successes earn up to 0.1 extra.

### 4.5 Formatting controls (METHOD RULE F, second half)

- **`probe:format` (identity prediction):** the harness asks the agent to
  restate the *current observed* pos/vel in the standard reply JSON. Fidelity
  on this probe measures pure format compliance; an agent with low fidelity
  here has a formatting problem, and its §4.1 score is annotated accordingly.
- **`probe:forced_choice`:** the harness shows two candidate next-states —
  the true target and a decoy = target perturbed by `3·PRED_POS_TOL_M` in a
  seeded random direction and `3·PRED_VEL_TOL_MPS` on velocity
  (`rng = random.Random(seed*104_729 + cycle)`; A/B side assignment from the
  same rng). Reply schema is `{"choice": "A"}` — no numeric formatting at
  all. Accuracy isolates the world model from number emission.
- **Tolerant repair parser** (§7.3) so fidelity is never lost to trivia.

---

## 5. Baselines and the kill criterion (METHOD RULE C)

All baselines run on every axis, every pack, every release.

### 5.1 Random (floor)
Per cycle: acceleration uniform on the disc of radius `max_accel`
(`rng = random.Random(seed*7919 + cycle)`; draw angle then radius
`max_accel*sqrt(u)` — exactly this construction). Prediction: persistence
(observed state unchanged) — doubles as the fidelity floor.

### 5.2 Greedy-gradient (reactive, no world model — the one to beat)
Goal visible:

```
a = clamp_accel( Kp·(goal - pos) - Kd·vel + (0, gravity_mps2) ),  Kp=2.0 s⁻², Kd=2.8 s⁻¹
```

PD control with gravity feedforward on the *observed* (stale) state; no
forecast, no lead, no wind term. Masked goal: deterministic hot/cold
hill-climb — keep a unit heading `h` (init +x); each cycle, if
`heat_delta < 0` rotate `h` by +72°; `a = clamp_accel(0.6·max_accel·h + (0,
gravity))`. Prediction: persistence.

Greedy is deliberately strong (damping + feedforward): beating a strawman
proves nothing.

### 5.3 Oracle (ceiling)
The §4.2 sampling MPC planned from the true engage-time state. Its
prediction is the true target (fidelity 1.0 by construction).

### 5.4 Kill criterion (pre-registered; FAB-007)

On the core pack, with `D_axis = (oracle − greedy) / (oracle − random)`:

> **If `D_outcome < 0.25`, or greedy's mean `temporal_score ≥ 0.55`, the
> world does not discriminate world-model cognition from reactive control.
> Do not publish; redesign v0 and log the redesign in DECISIONS.md.**

Evaluated at M1 exit (gate iv) and re-evaluated whenever the core pack
changes.

### 5.5 Pre-registered redesign levers (in escalation order)
1. Gustier wind: shorter periods (≈60–160 ticks), higher amplitude.
2. Tighter deadline (≈40% less slack over oracle time-to-goal).
3. Moving goal (goal position a slow pure function of tick).
4. Deceptive heat: an off-goal heat lobe making pure gradient ascent
   non-monotonic (pack-level change; heat formula gains a documented second
   term — schema bump).

### 5.6 Diagnostic synthetic agents (not baselines, used by gates)
- **Stale-reactor:** always outputs `a*_obs` (§4.2). Used by exit gate (ii):
  on the same physics with B ∈ {10, 20, 40}, its `temporal_score` must be
  strictly decreasing in B — proving the world punishes unanticipated
  deliberation and is not secretly turn-based.
- **Persistence-predictor:** §5.1's prediction rule, reported as the fidelity
  floor.

---

## 6. M1 exit gates (all must pass; brief §6)

i. **Reproducibility (RULE B):** two full same-seed runs of the random agent
   over the core pack produce byte-identical canonical log files (sha256
   compare). Ships as a test.
ii. **Temporal invariant:** stale-reactor B-sweep (§5.6) strictly decreasing
   on the g001 physics variants (g001_b10 / g001 / g001_b40).
iii. **Golden fixture CI green** (§9): exact float equality, not approx.
iv. **Kill criterion** (§5.4) evaluated and passed; numbers logged in
   DECISIONS.md.

---

## 7. Harness, adapter contract, and wire schema (METHOD RULE E)

### 7.1 Adapter = transport only (~20 lines)

An adapter implements `types.Adapter`: `complete(prompt, *, max_tokens=512,
temperature=0.0, seed=None) -> str`. It may hold a base URL, model name, API
key from env. It must NOT build prompts, parse, retry-on-parse-failure, or
see scenario state. Reference adapters: NIM (OpenAI-compatible HTTP,
dracarys) and Ollama (local llama3.1:8b) — each ≈20 lines. API keys via env
only (never committed).

### 7.2 Prompting (harness-owned)

One frozen template per results-version, committed in-repo. Content
requirements: physics summary with units; explicit timeline warning ("the
world advances `B` ticks while you think; your action engages at tick
`T+B`"); the full Observation as JSON; the reply schema with
`EXAMPLE_REPLY_JSON`; instruction to output a single JSON object and nothing
else. Prompt changes bump the results version — scores are never compared
across prompt versions.

### 7.3 Reply parsing and repair (tolerant, never exact-match)

1. Strip markdown code fences.
2. Extract the first balanced `{...}` block.
3. `json.loads`; on failure apply repairs (single→double quotes, strip
   trailing commas) and retry parse once.
4. Validate: both `ACTION_FIELDS` present and finite → action OK, clamp at
   engage; all four `PREDICTION_FIELDS` present and finite → prediction OK,
   else prediction = null (action can succeed alone).
5. On action-parse failure: up to **N=2** reprompt retries (with a short
   error notice appended). Still failing → engage `NOOP_ACTION`,
   prediction=null, `parse_failed=true` — attributed "formatting, not
   cognition"; excluded from fidelity, included in `parse_rate`.
6. Retries never advance sim time (RULE A); wall-clock is telemetry.

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

**Full-system MARIA** runs as a separate, clearly labeled **CONFOUNDED**
datapoint (different prompts, memory, planning stack) — never the treatment
arm. Maria's repo/services are read-only subjects (brief §7).

Pre-registered hypothesis: the scaffold moves prediction-fidelity and
temporal-anticipation more than outcome. A null/negative result is publishable
as-is.

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
  "schema_version": "0.1.0",
  "description": "...",
  "scenarios": ["g001.json", "g002.json"]
}
```

Scenario file = `ScenarioConfig` fields verbatim (JSON object;
`wind_components` = list of `{amp_mps2, period_ticks, phase_rad}`;
`axis_tags` = list of strings). **Strict loader:** unknown fields are errors;
`schema_version` major.minor must match `types.SCHEMA_VERSION`.
Loader API (builder-owned): `chronogym.bank.load_pack(path) -> list[ScenarioConfig]`.
Downloadable packs (M1.5): zip of the same layout + sha256 in a manifest.

### 9.2 Core pack v0 (authored by Fable at M1; intent table)

| id | intent |
|---|---|
| g001 | baseline (the golden-fixture scenario) |
| g001_b10 / g001_b40 | same physics, B=10 / B=40 (budget sweep, gate ii) |
| g002 | high wind (amp 5+2.5, periods 160/61) |
| g003 | tight deadline (380 ticks) |
| g006 | far goal, adverse wind phase |
| g007a / g007b | masked goal (feedback-use probe), two geometries |
| g008 | `probe:format` (identity prediction) |
| g009 | `probe:forced_choice` |
| g010 | wind regime shift (replanning-tagged) |

---

## 10. Reproducibility gate (METHOD RULE B)

- Physics: pure function — §2.3. No global RNG; every `random.Random` is
  constructed with a spec'd seed expression at point of use.
- Logs: one JSON object per line through `types.canonical_json` (sorted keys,
  no whitespace, `allow_nan=False`, shortest-round-trip floats). A run
  manifest records schema version, pack name+version, scenario ids, seeds,
  agent name, prompt version.
- Test: same-seed double run → byte-identical logs (gate i). Cross-*platform*
  bit-identity is NOT claimed (libm variance); the claim is per-host
  determinism, documented in README. Results tables always state host class.
- LLM agents are not deterministic even at temperature 0; determinism is
  claimed for the *world, scoring, and baselines*. LLM rows report
  mean ± range over ≥3 repetitions (§11).

---

## 11. Experiment plan and paper outline (M2/M3)

### 11.1 Experiments

Agents: random, greedy, oracle (+ stale-reactor & persistence diagnostics),
dracarys END2END, dracarys WM-SCAFFOLD, llama3.1:8b (2nd adapter, M1.5),
MARIA (CONFOUNDED label). Pack: core_v0. Reps: 1 for deterministic agents,
3 for LLM agents (report mean ± range; NIM 40 RPM budget: ≈30 calls/episode ×
12 scenarios × 3 reps × 2 arms ≈ 2.2k calls ≈ a weekend of polite pacing).

Deliverables: per-axis table (the diagnosis vector per agent), radar plot,
budget-sweep curve (temporal vs B per agent), kill-criterion numbers,
fidelity-vs-outcome scatter (do good predictors win?).

### 11.2 Paper outline

1. The deliberation gap: agents are scored as if the world waits.
2. Related work (§12 table).
3. ChronoGym: contract, clock (RULE A), axes & probes, scoring.
4. Reproducibility design (RULE B).
5. Baselines + kill criterion results (RULE C).
6. Matched-pair ablation (RULE D) + confounded full-system datapoint.
7. Diagnosis case studies (per-axis failure narratives).
8. Limitations & threats (§13).
9. Open release: packs, seeds, logs. Funding angle: open eval infra
   (NLnet/NGI, NVIDIA Inception).

---

## 12. Related work and wedges (informative; citations to be verified R4)

| Benchmark | What it scores | What it lacks that ChronoGym adds |
|---|---|---|
| BALROG (Paglieri et al., 2024) | agentic gameplay outcomes (NetHack et al.) | turn-based; no deliberation cost; outcome-centric |
| AutumnBench (2025) | world-model learning in grid worlds (masked-frame, planning) | world pauses while the agent thinks; no temporal-anticipation axis |
| WorldPrediction (2025) | video/procedural world modeling & planning | passive prediction; no closed loop, no deliberation budget |
| R-WoM (2025) | LLM world-model rollouts | no embodied clock; no matched ablation |
| EnvSimBench | LLM-as-simulator fidelity | no acting agent; no time pressure |
| APB / agentic planning suites | plan quality | wall-clock or turn-based; no sim-tick budget |
| SIMMER | ? (verify) | ? (verify) |

Wedge summary: (1) seed-fixed *simulated* deliberation budget with the world
in motion (nobody scores "do you know that thinking costs time?"
reproducibly); (2) always-multi-factor + graded hot/cold; (3) matched-pair
predict-then-act ablation on the same base model, with the full agent system
as an explicitly confounded extra datapoint.

---

## 13. Threats to validity (informative)

- **LLM nondeterminism** → ≥3 reps, temp 0, ranges reported; world/scoring
  deterministic.
- **Prompt sensitivity** → frozen versioned prompts; scores never compared
  across prompt versions.
- **Oracle suboptimality** → ceiling is a lower bound; report oracle margin
  over greedy; oracle params fixed in spec.
- **Oracle multimodality** (two equally good actions) → `w_k` weighting
  dampens it; distribution of per-cycle margins reported, not just the mean;
  future: top-K oracle action set.
- **Truthful forecast is generous** → v1 factor pack adds forecast noise
  (seed-determined), keeping RULE F by putting noisy values in the
  observation itself.
- **Float portability** → per-host determinism only (§10).
- **Single world** → the contract (`types.py`, pack schema) is world-agnostic
  by design; a second world family is post-M3.
