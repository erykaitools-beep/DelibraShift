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

### M0 — contract + stub (DONE 2026-07-13)
- [x] Repo scaffold (Codex, `93b18c2`)
- [x] `chronogym/types.py` v0.1 committed (Fable, `70df480`)
- [x] SPEC.md v0.1 + PLAN.md + golden fixture `tests/fixtures/golden_g001.json` (Fable)
- [x] Codex: pure world transition + RULE-A window loop + Observation
      builder + random/no-op agents + canonical JSONL demo + fixture and
      byte-identity tests (`b0ad499`)
- [x] Adversarial review round 1 + empirical greedy red-team (Fable):
      SPEC v0.2, contract 0.2.0, gravity retune, fixtures regenerated +
      `golden_edges.json` (FAB-014..FAB-027)

### M1 — one scored loop + one real adapter (EXIT-GATED; in progress)
- [x] Codex: fidelity scorer draft, strict pack loader, draft prompt+parser,
      NIM adapter, greedy v0.1, `chronogym-run` CLI (`1379c87`, `5ed12e1`,
      `27ead02`) — pre-v0.2; migration list in REVIEW.md round 1.
- [x] Codex: migrate to contract 0.2.0 (`1ca3d14`); oracle per §4.2.1.
- [x] Fable: core pack v0 (`packs/core_v0`, 11 scenarios); golden ORACLE
  fixture (`tests/fixtures/golden_oracle.json`, CRN); prompt draft-0.2
  FROZEN as "1.0" (REVIEW round 2); kill criterion + gate (ii) + feedback
  band pre-verified with reference implementation (FAB-028..031).
- [x] Fable: verification round 2 → SPEC v0.2.2 + contract 0.2.1 + pack
  v0.1.1 (12 scenarios, g007c) + golden_masked.json + edges e004
  (FAB-032..037); prose-only reimplementation reproduced oracle fixture,
  probe numbers and edges binary64-exact.
- Codex: REVIEW round 2.1 items 1–6 (stale tests, CRN + H-pin, gradient
  searcher, fixture CI tests incl. masked + e004, probe gate (ii),
  pack/schema stamps) + official gate runs (numbers → COD entry in
  DECISIONS.md).
- Exit gates (ALL must pass, SPEC §6): (i) byte-identical same-seed runs;
  (ii) stale-reactor budget sweep decreasing with margin GATE_II_MARGIN;
  (iii) BOTH golden fixtures CI green (g001 + edges); (iv) kill criterion
  §5.4 with validity floors passed & numbers logged in DECISIONS.md.
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
| Scope creep | v0 = ONE world, FOUR scores, TWELVE scenarios (core_v0). New ideas → NOTES.md, not code |
