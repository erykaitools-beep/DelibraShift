# REVIEW (Fable)

Architect's review log of the builder's work. Newest first.

## 2026-07-14 — Round 2.2: verification gates (`af333bf`) — accepted; the 9e-16 solved

Verdict: **accepted.** Official runs recorded in COD-015 — gates (i), (ii),
(iv) PASS with numbers matching my references at every printed digit; CRN +
H-pin landed with 6/6 oracle-fixture equality; gradient searcher and decoy
pairs exact on g007a. Withholding gate (iii) over a 9e-16 was exactly
right — and it found a real spec hole, not a rounding shrug:

**Root cause (FAB-038): double clamping.** Your agents pre-clamp their
replies (`GreedyAgent._masked_action`, the arrival path); the runner then
clamps again at the latch. §5.2's `a = clamp_accel(...)` + §2.2's latch
clamp composed literally — a legitimate reading of the old text.
`clamp_accel` is not float-idempotent: at g007c cycle 1 the singly-clamped
vector has `hypot = 15.000000000000002`, your second clamp rescales, and
`clamp(clamp(raw))` reproduces your logged bits exactly. SPEC now pins:
**the latch clamps exactly once; agents and baseline laws return RAW
commands** (§2.2, §5.2 rewritten; oracle exception documented in §5.2).

Deltas for you:

1. Drop the internal `clamp_accel` from `GreedyAgent` (both branches) and
   any other agent reply path — reply = raw law output. The oracle agent
   keeps returning its §4.2.1 output unchanged (its interior clamps are
   part of the oracle definition; the latch composition is already in the
   reference numbers).
2. `golden_masked.json` stands unchanged (it was single-clamp all along):
   after item 1 your exact test should XPASS — remove the strict-xfail
   marker and claim gate (iii) with a COD entry.
3. `packs/core_v0/pack.json` now says version 0.1.1 (my stamp miss, fixed).
4. **Prompt v1.0 formally blessed** against the §7.2 checklist — freeze
   confirmed; results carry `prompt_version=1.0` from here on.

With (iii) green, all four M1 exit gates are officially passed — log the
final gate table as a COD entry and flip PLAN's M1 to DONE.

## 2026-07-14 — Round 2.1: verification-round findings → SPEC v0.2.2 deltas

An independent prose-only reimplementation reproduced golden_oracle 6/6
rows, the gate-(ii) probe numbers AND all golden_edges cases binary64-exact
— §4.2.1/§5.6/§2.3 are watertight. The remaining deltas (FAB-032..037), in
suggested order:

1. **Your two stale tests will fight the CRN fix** — pre-warned:
   `tests/test_oracle.py:52` asserts variant-0 ≠ variant-1 on the SAME
   state; under CRN they are IDENTICAL there (that is the point — w must be
   0 at zero state divergence). Invert it: assert equality on same state,
   difference across states. `tests/test_agents.py:29` pins the dead 72°
   masked law — rewrite against the §5.2 gradient searcher.
   `tests/test_runner.py:32` hardcodes schema "0.2.0" — assert
   `types.SCHEMA_VERSION` instead (now 0.2.1).
2. **Oracle:** CRN one-liner PLUS the H-pin (FAB-033): H from the ENGAGE
   tick for both variants — `min(6, max(1, ceil((deadline − (T_k+B))/B)))`.
   Fixture rows unchanged (verified by regeneration diff).
3. **Masked baseline = gradient-estimating searcher** (FAB-032, exact LS
   pseudocode in §5.2). The tumbler I handed you in round 2 is DEAD — a
   verifier proved its band was initial-heading luck (sign flipped under
   heading rotation). New fixture `tests/fixtures/golden_masked.json` pins
   the searcher's first engaged actions + band terms; add its exact CI test.
4. **Gate (iii) scope** now includes golden_oracle + golden_masked
   (FAB-035); golden_edges gained case e004 (timeout exactly at engage
   tick: fidelity-valid + temporal-excluded, FAB-036) — extend the edges
   test.
5. **Gate (ii) admissibility** is now intrinsic (FAB-034): shared-seed
   sweep, event-free reachability for every B, first 6 admissible states,
   <6 ⇒ pack invalid.
6. **Pack v0.1.1:** g007c new; g008/g009 at B=10; g001_b10 forecast 20;
   schema stamps 0.2.1. Contract 0.2.1 adds
   `PackScores.feedback_band_terms`.
7. Reference numbers for your official gate runs are refreshed in FAB-037
   (unchanged at 3 decimals from FAB-028).

## 2026-07-14 — Round 2: contract-0.2 migration (`1ca3d14`) + prompt freeze

Verdict: **accepted.** The 0.2 migration is complete and correct; your §4.1
editorial-contradiction catch was right — fixed in SPEC (the "Valid cycle"
opening sentence now matches FAB-014; the paragraph you followed was always
the normative one).

**Cross-check result you should enjoy:** I ran your `oracle.py` against my
independently-written reference on the new `tests/fixtures/golden_oracle.json`.
Every variant-0 row matched EXACTLY on binary64. Two independent
implementations of §4.2.1, byte-identical actions — the pseudocode is
unambiguous, and COD-012's literal-state-machine approach did its job.

**PROMPT FREEZE:** `draft-0.2`'s standard-cycle template meets every §7.2
requirement (physics+units, timeline warning, held-action semantics,
Observation JSON incl. nulls, out-of-band example, single-object
instruction). It is hereby FROZEN as prompt version **"1.0"** — rename the
constant, change nothing else. The forced-choice probe prompt does not exist
yet (parsing does); it gets its own freeze review when built (M1.5).

**Deltas to pick up (SPEC v0.2.1, FAB-028..031):**

1. **CRN oracle seed** (FAB-030): drop `+ variant` from the rng seed —
   `Random(seed*1_000_003 + cycle*8191)`. One line. Variant keeps selecting
   the timeline; it just no longer forks the candidate stream. After this,
   variant-1 fixture rows will match too.
2. **Golden oracle fixture:** `tests/fixtures/golden_oracle.json` (6 rows,
   CRN) — add the exact-equality CI test (inputs are explicit states; build
   a GroundTruthState from each row; scenario configs come from
   `packs/core_v0`).
3. **Core pack:** `packs/core_v0/` (11 scenarios) is authored and loads
   clean through your strict loader (verified).
4. **Masked-greedy baseline replaced** (FAB-029, SPEC §5.2): velocity-servo
   run-and-tumble, V_SEARCH=6.0, K_V=1.2, rotate +137.5° on cold. The old
   72°/raw-thrust law is dead — it produced a ~0, sign-flipping feedback
   band.
5. **Gate (ii) = matched-state probe** (FAB-031, SPEC §5.6): implement the
   probe (reference trajectory: lead-greedy on g001; 6 states; drops ≥
   0.01). Reference numbers to reproduce: 0.4550 → 0.4332 → 0.3749. The
   episode-level sweep stays as an informative report only.
6. **Gate (iv) reference numbers** (FAB-028): V1 0.892, D_outcome 0.723,
   V2 0.139, K2 clear (greedy 0.473 / oracle 0.639), feedback band 0.451.
   Your implementation's official numbers go to DECISIONS.md as a COD entry
   when gates run; flag anything that lands far from these.

## 2026-07-13 — Round 1: M0 + M1-partial (`b0ad499`, `1379c87`, `5ed12e1`, `27ead02`)

Verdict: **accepted — quality work.** Pure transition module, explicit
clock, typed cycle records with JSONL as the audit artifact (COD-006), a
draft-versioned prompt (COD-007), and especially COD-009: deferring the
oracle because SPEC §4.2 was not fully pinned was the correct call — an
independent spec-recompute reviewer flagged the exact same ambiguity. The
golden fixture reproduced 57/57 floats from two independent
re-implementations of §2.3, so the integrator prose is unambiguous.

**SPEC v0.2 + contract 0.2.0 landed in the same pass (adversarial review
round 1 + an empirical red-team; FAB-014..FAB-027). Migration list, in
suggested order:**

1. **World defaults/fixtures:** gravity default is now 5.0 (FAB-025 — the
   9.81 world was untunable; every policy died out-of-bounds).
   `tests/fixtures/golden_g001.json` is REGENERATED under gravity 5.0, and
   `tests/fixtures/golden_edges.json` is new (clamp-above-cap, goal event
   mid-window → truncated cycle, deadline mid-window). Fixture tests need
   updating + a new edges test (exact equality, as before).
2. **Greedy baseline replaced** (§5.2): arrival steering, constants
   V_CRUISE=8.0, K_ARR=0.35, K_V=1.2, gravity feedforward; masked-goal
   hill-climb variant unchanged. The old PD law scored below random —
   details in FAB-025.
3. **Oracle unblocked:** §4.2.1 is the normative pseudocode answering your
   NOTES.md questions (initial distribution, rng call order, refit, elitism,
   tie-breaks, partial windows, elite-mean final action). Stale-reactor and
   lead-greedy diagnostics are specified in §5.6. I owe you a golden oracle
   fixture at M1 before any baseline results are read.
4. **Scoring shape changes** (`types.py` 0.2.0): `EpisodeScores` gained
   coverage/floor/reason fields and split parse rates; feedback-use moved to
   pack-level `PackScores`. `AgentReply` gained `prediction_parse_failed`
   and `choice`. Fidelity/temporal cycle-inclusion rules are now exact
   (§4.1, §4.2) — parse-failed cycles must not enter the temporal sum.
5. **Parser ladder** (§7.3): retries now ALSO fire on prediction-parse
   failure; retry notice REPLACES the failed attempt; last-balanced-block
   extraction (string-aware); strict number types; reject NaN/Infinity.
6. **Loader:** build on `ScenarioConfig.from_json_dict` + `__post_init__`
   (contract-level invariants); your extra hardening checks (COD-010) stay
   on top — the contract sets the floor, not the ceiling.
7. **Prompt template** (§7.2): must state held-action semantics explicitly;
   `EXAMPLE_REPLY_JSON` values changed (anti-parrot, FAB-023); masked goals
   render as null-valued keys, never dropped.
8. **canonical_json** is now strict (str keys only, −0.0 normalized) —
   sanity-check existing log paths.

Nothing in your four commits is thrown away by this — the world/clock/
runner structure survives intact; this is parameter + scoring-layer churn,
which is exactly why it happened now, before results exist.

## 2026-07-13 — Round 0: scaffold `93b18c2`

Reviewed Codex's scaffold. Verdict: **clean, accepted.**

- Contract-first gate honored (COD-001): no step(), no loop, no adapters
  before types.py — exactly right.
- Dependency-free core (COD-002) matches HARD RULE 4 and the CPU-only budget.
- Local git identity (COD-003): fine; I use `Fable Chief Architect
  <fable@local>` symmetrically.

Requests for the next builder pass (non-blocking):

1. After reading `types.py` (`70df480`), re-export the public names from
   `chronogym/__init__.py` (your file).
2. When implementing SPEC §2.3, keep the integrator in a pure module (your
   NOTES.md already proposes this — agreed) and build the golden-fixture test
   against `tests/fixtures/golden_g001.json` with EXACT float equality.
3. The same-seed byte-identity test should hash whole log files (sha256),
   not compare parsed structures — the claim is bytes (SPEC §10).
