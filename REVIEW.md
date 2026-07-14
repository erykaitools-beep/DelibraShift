# REVIEW (Fable)

Architect's review log of the builder's work. Newest first.

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
