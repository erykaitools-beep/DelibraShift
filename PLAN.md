# ChronoGym PLAN

Owner: Fable. Builder-facing; STATUS.md is Codex's ground truth on progress.
Working protocol: brief §0 — pull --rebase before every commit, never edit
the other's lines, disagreements resolved in DECISIONS.md (architect decides
design, builder decides implementation).

## File & module ownership

| Artifact | Owner |
|---|---|
| SPEC.md, PLAN.md, REVIEW.md | Fable |
| `chronogym/types.py` (the contract) | Fable |
| `tests/fixtures/golden_g001.json` (+ future fixtures) | Fable |
| `packs/` scenario JSONs (design values) | Fable |
| STATUS.md, NOTES.md | Codex |
| `chronogym/*.py` implementation (world, harness, scorers, adapters, bank), `tests/*.py`, README, CI, packaging | Codex |
| DECISIONS.md | both, append-only (FAB-### / COD-###) |
| `chronogym/__init__.py` re-exports | Codex (his file) |

Contract-change rule: only Fable edits `types.py`; every change bumps
`SCHEMA_VERSION` and gets a FAB entry. Codex flags needed changes in NOTES.md.

## Milestones

### M0 — contract + stub (NOW)
- [x] Repo scaffold (Codex, `93b18c2`)
- [x] `chronogym/types.py` v0.1 committed (Fable, `70df480`)
- [x] SPEC.md v0.1 + PLAN.md + golden fixture `tests/fixtures/golden_g001.json` (Fable)
- [ ] Codex: pure world transition per SPEC §2.3 + RULE-A window loop
      (latched action, B ticks per cycle) + Observation builder (§2.5)
- [ ] Codex: random + no-op agents; end-to-end demo run producing canonical
      JSONL logs (§10)
- [ ] Codex: golden-fixture test (exact float equality) + same-seed
      byte-identity test
- M0 exit: `pytest` green including fixture + identity tests; demo run
  script prints an episode summary.

### M1 — one scored loop + one real adapter (EXIT-GATED)
- Fable: author core pack v0 scenario JSONs (SPEC §9.2); freeze prompt
  template content requirements review (REVIEW.md).
- Codex: prediction-fidelity scorer (§4.1) ONLY; thin local pack loader
  (§9.1, strict); NIM dracarys adapter (~20 lines, transport only, key via
  env); harness prompt+parser (§7.2–7.3); baselines random/greedy/oracle
  (§5.1–5.3) + stale-reactor & persistence diagnostics (§5.6).
- Exit gates (ALL must pass, SPEC §6): (i) byte-identical same-seed runs;
  (ii) stale-reactor budget sweep strictly decreasing; (iii) golden fixture
  CI green; (iv) kill criterion passed & numbers logged in DECISIONS.md.
- If gate (iv) fails: apply SPEC §5.5 levers in order, re-run, log FAB entry.
  Nothing is published before gate (iv) passes.

### M1.5 — breadth
- 2nd adapter (Ollama llama3.1:8b), remaining scorers (temporal §4.2,
  feedback-use §4.3, outcome §4.4, probes §4.5), downloadable pack format
  (zip + sha256 manifest), first results table in README.

### M2 — the ablation
- Matched pair END2END vs WM-SCAFFOLD (SPEC §8) on dracarys; MARIA as
  labeled CONFOUNDED datapoint (read-only integration — do NOT touch the
  Maria repo/services); README quickstart (install → run → table in <10 min).

### M3 — writeup + release
- Paper skeleton per SPEC §11.2; funding one-pager (NLnet/NGI, NVIDIA
  Inception); public GitHub release with seeds, packs, logs.

## Risk register

| Risk | Mitigation |
|---|---|
| Greedy wins (kill criterion) | Pre-registered levers SPEC §5.5; gate before publishing |
| NIM nondeterminism muddies results | ≥3 reps, ranges; determinism claimed only for world/scoring/baselines |
| Oracle too weak (ceiling collapses) | Fixed spec params; report oracle−greedy margin; raise samples if margin < 0.15 |
| Float divergence across hosts | Per-host determinism claim only; host class in results |
| NIM 40 RPM budget | ≈2.2k calls for full M2 grid — pace politely, cache raw completions in logs |
| Scope creep | v0 = ONE world, FOUR scores, TEN scenarios. New ideas → NOTES.md, not code |
