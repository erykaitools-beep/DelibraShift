# Model contribution record

Version: 2026-07-19
Purpose: evidence-backed disclosure for project review and competition entry.

This ledger distinguishes project authorship from the models evaluated by the
benchmark. It is based on Git history, the append-only decision log, surviving
working files and operator notes. It does not infer token counts or hidden
work. Where an exact runtime model snapshot was not recorded, the role label is
reported instead of inventing an identifier.

## Attribution method

The impact allocation is an editorial estimate, not a legal ownership split
and not a token-usage estimate. It answers “how much did this contribution
matter to the delivered project?” across four dimensions:

| Dimension | Weight | Evidence |
|---|---:|---|
| scientific design and validity | 30% | contract, SPEC, gates, adversarial review |
| implementation and reproducibility | 40% | library, tests, CLI, deterministic logs |
| experiment execution and release hardening | 15% | M1/M2 runs, reports, packaging, CI |
| explanation and visualization | 15% | offline report, arena, copy, accessibility |

The provisional model-level allocation is:

| Builder model / role | Estimated impact | Confidence | Why it mattered |
|---|---:|---|---|
| OpenAI Codex, GPT-5-based; project role `CODEX 5.6-SOL` | 55% | high | Implemented the simulator, harness, scoring integration, baselines, pack tooling, M1/M2 orchestration, official run publication, release hardening, visualization audit and repository integration. |
| `FABLE 5`, Chief Architect & Scientist; exact model snapshot not recorded | 30% | high for work, low for exact model ID | Defined the executable contract, scientific method, scoring semantics, golden fixtures, kill criteria and adversarial review decisions that made the benchmark diagnostically valid. |
| `Opus 4.8`, as identified by the project operator; exact provider snapshot not recorded | 15% | medium | Built the first complete offline PL/EN visualization: report linker, data extractor, flight arena, charts, design system, copy and extensive JavaScript tests. |

The percentages should be updated if the competition requires a different
rubric or if exact model/session metadata is recovered. The underlying evidence
below is authoritative; the percentages are deliberately labeled estimates.

## FABLE 5 — architecture and scientific method

Primary responsibility: contract and methodology.

Verified work:

- authored the initial `types.py` schema contract before implementation;
- wrote and revised `SPEC.md` and `PLAN.md`;
- pinned simulated-deliberation semantics, engage-time prediction target and
  absolute prediction fields;
- defined fidelity, temporal anticipation, outcome and feedback-use semantics;
- designed the matched architecture ablation and isolation probes;
- authored golden fixtures and adversarial scientific reviews;
- recorded 38 `FAB-###` decisions.

Git evidence:

- `70df480` — schema contract v0.1;
- `9f99074` — SPEC, plan, golden fixture and FAB-001..013;
- `819c3cb` — adversarial review and contract 0.2.0;
- `e07a6f6` — core pack and oracle fixture;
- `87f922b` — verification round and contract 0.2.1;
- `bb428e9` — clamp ownership and prompt v1.0 approval.

Project weight: foundational. Without this work the software could still run,
but its scores would not have a defensible causal or diagnostic interpretation.

## OpenAI Codex — implementation, experiments and integration

Primary responsibility: building and shipping the benchmark.

Verified work:

- scaffolded the repository and implemented deterministic world/clock behavior;
- built runner, scoring integration, parser/repair harness and NIM transport;
- implemented random, no-op, greedy, stale-reactor and oracle baselines;
- built external pack loading, archive verification and reproducibility gates;
- implemented M1.5 probes and the M2 matched-pair experiment runner;
- executed and published the official 84-log Dracarys result;
- renamed the public package to DelibraShift and hardened packaging/CI;
- independently audited the Opus visualization, corrected semantic errors,
  added matched-pair, temporal-support and no-retry displays, removed private
  paths, and integrated the report into the canonical repository;
- recorded 27 `COD-###` decisions including the visualization integration.

Git evidence: all commits authored `Codex Chief Builder`, beginning with
`93b18c2`; notable milestones include `b0ad499`, `1379c87`, `af333bf`,
`2a85727`, `5f979dc`, `9eb3dd4`, `a0f320c`, and `1c936c2`.

Project weight: largest delivered-code and release contribution. This work
turns the scientific contract into a reproducible public benchmark and its
official result.

## Opus 4.8 — visualization and communication layer

Primary responsibility: graphical explanation and offline result exploration.

Verified surviving work, originally created in a separate unversioned sibling
working directory and subsequently migrated to `report/`:

- one-file offline HTML build and validation pipeline;
- bilingual PL/EN interface and copy system;
- interactive arena with simulated ticks, held/returned actions, prediction
  ghost, engage-time truth, wind, heat and hidden/decoy goals;
- arm, prediction-error, feedback-pair and probe visualizations;
- dark/light design tokens, print behavior and WCAG contrast audits;
- JavaScript pure-function and DOM render-smoke suites;
- independent Python replay audit.

The initial delivery had no Git metadata, duplicated canonical data and
contained several review findings. Codex corrected those issues during
integration. Attribution remains with Opus for the original visualization
architecture and implementation; the corrective and integration work is
attributed to Codex.

Project weight: high communication value. It does not define the benchmark's
scientific truth, but it makes the mechanism and negative M2 result inspectable
by judges, researchers and non-specialists.

## Human contribution and evaluated models

Maria is the project owner and operator: supplied goals and constraints,
approved the public name, provided execution authority and API environment,
coordinated model hand-offs, and made final product decisions. Human direction
is not included in the model percentages above.

`abacusai/dracarys-llama-3.1-70b-instruct` is the subject evaluated in M2, not a
builder of this repository. Its outputs are experimental data and must not be
listed as project authorship.

## Reproducibility notes

- Commit authors and hashes can be checked with `git log --reverse`.
- Scientific decisions are preserved in append-only `DECISIONS.md`.
- Official model outputs are preserved as 84 canonical logs in `results/m2`.
- Visualization source is in `report/`; generated bundle and HTML are derived
  artifacts and are excluded from Git.
- No API key, hidden chain of thought or private credential is included in this
  attribution record.
