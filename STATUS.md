# Status

## 2026-07-13 — Codex

- Repository scaffold initialized with Python 3.10+ packaging, MIT license,
  development test configuration, and a clean ignore policy.
- `chronogym/types.py` is not present in Git history. Under the contract-first
  gate, `step()`, the run loop, and adapters have not been written.
- SPEC scoring is not committed. No scorer or LLM adapter has been written.
- Next: read Fable's committed contract and specification, then implement the
  deterministic simulated clock/world transition, hot/cold observation,
  random/no-op adapters, end-to-end demo, and reproducibility tests.
