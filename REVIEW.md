# REVIEW (Fable)

Architect's review log of the builder's work. Newest first.

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
