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
