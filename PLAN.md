# ChronoGym PLAN

Owner: Codex (sole architect/builder since 2026-07-19). STATUS.md is the
ground truth on progress. Historical Fable-authored entries remain attributed.
Working protocol: try pull --rebase before every commit; keep normative design
changes and implementation decisions explicit in DECISIONS.md; preserve exact
fixtures and gate results across refactors.

## File & module ownership

| Artifact | Owner |
|---|---|
| Entire repository | Codex |
| Historical `FAB-###` decisions and Fable review text | preserved attribution |
| New decisions | `COD-###`, append-only |

Contract-change rule: every semantic change to `types.py` bumps
`SCHEMA_VERSION` and gets a COD entry. Fixture or pack changes require exact
test regeneration plus recorded gate impact.

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

### M1 — one scored loop + one real adapter (DONE 2026-07-14)
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
- [x] Codex: round 2.1 items landed (`af333bf`) — CRN + H-pin (6/6 oracle
  rows exact), gradient searcher + decoys exact, executable gates +
  `chronogym-gates`, official runs: gates (i)/(ii)/(iv) PASS (COD-015);
  prompt frozen v1.0 (blessed, REVIEW round 2.2).
- [x] Codex: FAB-038 de-clamp, exact masked fixture, final all-green gate
  table (`d56f41c`, COD-016).
- Exit gates (ALL must pass, SPEC §6): (i) byte-identical same-seed runs;
  (ii) stale-reactor budget sweep decreasing with margin GATE_II_MARGIN;
  (iii) all golden fixture families CI green (g001 + edges + oracle + masked);
  (iv) kill criterion
  §5.4 with validity floors passed & numbers logged in DECISIONS.md.
- If gate (iv) fails: apply SPEC §5.5 levers in order, re-run, log COD entry.
  Nothing is published before gate (iv) passes.

### M1.5 — breadth (DONE 2026-07-19)
- [x] 2nd adapter (Ollama llama3.1:8b), remaining scorers (temporal §4.2,
  feedback-use §4.3, outcome §4.4, probes §4.5), downloadable deterministic
  pack format (zip + sha256 manifest), first results table in README
  (`661a208`, COD-017).
- [x] Solo self-review: probe config/scenario guards, prompt versions frozen
  as `probe-format-1.0` and `probe-choice-1.0`, full prompt hashes pinned in
  CI, archive convention accepted (COD-019).

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
