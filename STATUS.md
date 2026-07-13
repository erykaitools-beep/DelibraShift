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
