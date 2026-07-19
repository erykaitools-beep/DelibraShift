# Status

## 2026-07-13 — Codex M0 implementation

- Repository scaffold initialized with Python 3.10+ packaging, MIT license,
  development test configuration, and a clean ignore policy.
- Fable's `types.py`, SPEC v0.1, PLAN, and golden fixture were read after their
  commits removed the contract gate.
- Implemented the pure semi-implicit Euler transition, fixed B-tick
  deliberation clock, latched actions, terminal ordering, truthful wind
  forecast, and visible/masked hot/cold observations.
- Implemented deterministic random and no-op local baseline agents plus an
  end-to-end canonical JSONL demo runner.
- Added exact golden-fixture coverage and whole-file SHA-256 reproducibility
  coverage. No scorer or LLM adapter was added in M0.
- Next: Fable review, then M1 work only under PLAN's exit gates.

## 2026-07-13 — Codex M1 work in progress

- Added typed cycle records and the prediction-fidelity-only scorer, including
  parse rate and the mandatory persistence floor.
- Added the strict local pack loader with schema compatibility, unknown-field,
  duplicate-key, and path-traversal checks.
- Added draft harness prompting, tolerant JSON repair, finite-field validation,
  and two in-budget retries with no-op fallback. The prompt version remains
  explicitly `draft-0.1` pending Fable's freeze review.
- Core-pack gates and publication remain blocked on Fable's scenario files and
  review; no results are being claimed from the draft prompt.
- Added the registered greedy reactive baseline and a transport-only,
  environment-configured OpenAI-compatible NIM adapter.
- Added `chronogym-run` for an end-to-end prediction-scored loop over any valid
  local pack, with optional canonical per-episode logs.
- Oracle/stale-reactor remain pending because SPEC §4.2 does not yet pin the
  initial MPC sampling distribution and exact elite-refit procedure; the
  reproducibility-sensitive clarification is recorded in NOTES.md.

## 2026-07-14 — Codex contract 0.2 migration

- Migrated world fixtures and arrival-steering greedy to SPEC/contract 0.2.0;
  both `golden_g001` and the new exact `golden_edges` suite pass.
- Migrated prediction scoring to mandatory coverage, validity reasons,
  per-agent persistence floor, and split action/prediction parse rates.
- Migrated the parser to last-balanced-block selection, strict JSON numbers,
  prediction retries, partial action/prediction attribution, forced-choice
  parsing, and held-action-explicit prompt text (`draft-0.2`).
- Implemented the pinned sampling-MPC oracle, stale-reactor, lead-greedy,
  temporal scorer, tick-level closest approach, graded outcome, and the full
  contract-shaped `EpisodeScores` builder.
- Expanded canonical logs with normative cycle/manifest fields, retained raw
  completions, engaged clamped actions, telemetry, retry rate, and example-echo
  controls. Probe scenarios force the engaged action to no-op.
- Test status: 54 passed; same-seed byte identity and both physics fixtures
  pass. Core-pack gates, stale budget sweep, kill criterion, and oracle numeric
  publication remain pending Fable's core pack and golden oracle fixture.

## 2026-07-14 — Codex contract 0.2.1 verification pass

- Migrated the oracle to common random numbers and the engage-tick horizon
  pin. All six `golden_oracle` rows reproduce with exact binary64 equality.
- Replaced the masked tumbler with SPEC 5.2's three-window least-squares
  gradient searcher and implemented deterministic decoy-goal paired runs.
  The g007a first six actions, complete true-heat episode, and all three decoy
  goals reproduce exactly.
- Froze the already-reviewed standard prompt as version `1.0` without changing
  its template, and migrated log assertions to schema `0.2.1`.
- Added executable full-pack reproducibility, matched-state, feedback-band,
  and kill-criterion gates plus the `chronogym-gates` command.
- Official builder run: gate (i) passed (SHA-256
  `6a964c34e3168b034f8c8be8b592ab513f9b975aff098439cde743fb1aa289ea`);
  gate (ii) passed at `0.4549931514 -> 0.4331712122 -> 0.3748602486`;
  gate (iv) passed with V1 `0.8921990872`, D_outcome `0.7228411275`, V2
  `0.1387795005`, greedy temporal `0.4732096352`, and oracle temporal
  `0.6387795005`.
- Test status: 60 passed, 1 strict expected failure. Gate (iii) is not claimed:
  the Fable-owned g007c band term is 9e-16 above direct recomputation from the
  normative outcome formula. The other golden checks pass exactly.

## 2026-07-14 — M1 exit gates complete

- Applied FAB-038 clamp ownership: baseline laws return raw commands and the
  latch performs the only clamp. Oracle interior clamps remain fixture-pinned.
- Removed the strict expected failure after `golden_masked` reproduced every
  decoy, action, episode field, and band term exactly. All four golden fixture
  families now pass binary64 equality.
- Final test status: 62 passed, no skips or expected failures.
- Final M1 gate table: (i) PASS with identical SHA-256
  `6a964c34e3168b034f8c8be8b592ab513f9b975aff098439cde743fb1aa289ea`;
  (ii) PASS at `0.45499315138148017 -> 0.4331712122380791 ->
  0.37486024858353895`; (iii) PASS, all golden fixtures exact; (iv) PASS
  with V1 `0.8922064045952949`, D_outcome `0.7228434005660153`, V2
  `0.13933996544791305`, greedy temporal `0.47066702870069027`, and oracle
  temporal `0.639339965447913`.
- M1 is complete. The next planned milestone is M1.5 breadth; PLAN ownership
  remains with Fable.

## 2026-07-14 — M1.5 builder pass

- Added the transport-only native Ollama adapter (`/api/chat`, default
  `llama3.1:8b`) alongside NIM.
- Added separate draft format-control and forced-choice prompts, exact pinned
  decoy generation, retry integration, per-cycle identity-vs-engage logging,
  choice accuracy/parse rate, format parse/fidelity scores, and mandatory trial
  counts. Probe actions remain forced to no-op.
- Added deterministic downloadable pack ZIPs with a canonical SHA-256 sidecar,
  per-member hashes, verifier, and `chronogym-pack` CLI.
- Added the first deterministic baseline table to README. It is explicitly not
  an LLM result table.
- Builder implementation is complete; the two probe draft prompts and archive
  manifest convention await Fable's M1.5 review/freeze.
- Verification: 70 tests pass. The generated core_v0 v0.1.1 archive verifies
  successfully with SHA-256
  `06916079638966d3803ce3cda500b3542c1d703604b99453f3365fec5f93a1c8`.

## 2026-07-19 — Solo ownership and M1.5 closure

- Codex is now the sole architect/builder; historical Fable attribution is
  preserved, while all repository artifacts are actively maintained by Codex.
- Completed an explicit non-independent self-review of M1.5. Added strict
  probe config/tag/scenario guards and froze both probe prompts at version 1.0
  with full SHA-256 CI pins.
- Accepted the deterministic archive sidecar as the normative SPEC 9.1 format.
- Verification: 72 tests pass with no skips or expected failures.
- M1.5 is complete. The next milestone is M2's END2END vs WM-SCAFFOLD matched
  pair; no LLM experiment has been launched by this administrative transition.

## 2026-07-19 — M2 phase 1 implementation

- Added the 131-line WM-SCAFFOLD treatment arm: prediction-only call followed
  by an action-only call containing only the model's own predicted engage-time
  state. The scaffold never receives a simulator target or oracle value.
- Added shared 40-RPM pacing, harness-owned transport retry/backoff, rep-derived
  seeds, alternating arm order, canonical per-episode logs, report metadata,
  mean/range summaries, divergence support, and the retry-free sensitivity
  slice required by SPEC §8.
- Frozen scaffold prompt set as `wm-scaffold-1.0` with full stage hashes and CI
  enforcement of the `<150` line rule.
- Added `chronogym-ablate`; it refuses paid/external calls without `--execute`.
- Verification: 82 tests pass with no skips or expected failures.
- Real dracarys execution has not started because NIM configuration is unset.
  M2 remains in progress pending feedback/probe report rows and the real run.

## 2026-07-19 — M2 phase 2 diagnostic report

- Added per-arm, per-repetition normal/decoy heat pairs on all masked-goal
  scenarios, separate decoy logs, raw deltas, deterministic greedy reference
  band terms, and normalized feedback-use summaries.
- Added shared-model format and forced-choice control runs outside both
  treatment arms. Every control row includes parse rate, parsed/total trial
  counts, probe-specific metrics, telemetry, retry count, prompt version, and
  canonical log path.
- The frozen END2END, WM-SCAFFOLD, format, and forced-choice prompt bytes are
  unchanged. No schema, fixture, or core-pack change was required.
- Verification: 84 tests pass with no skips or expected failures.
- Real dracarys execution remains pending NIM configuration and explicit
  `--execute`; no external call or LLM result has been produced.
