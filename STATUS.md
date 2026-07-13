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
