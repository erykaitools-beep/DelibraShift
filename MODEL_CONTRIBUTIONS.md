# Model contribution record

Version: 2026-07-19
Purpose: evidence-backed disclosure for project review and competition entry.

DelibraShift is owned and directed by **Eryk Wyrębek**, the human project
operator and competition entrant. AI systems assisted with architecture,
implementation, experiments, visualization, review, and integration. Model
roles below describe work performed; they are not legal ownership claims.

This ledger distinguishes builder models from the model evaluated by the
benchmark. It is based on Git history, the append-only decision log, surviving
working files, and operator notes. It does not infer token counts or hidden work.
Where an exact runtime snapshot was not recorded, the project role is reported
instead of inventing an identifier.

## Human origin, direction, and approval

Eryk Wyrębek:

- originated the core requirement that the world must keep evolving while an
  agent deliberates;
- set project goals, constraints, competition scope, and release priorities;
- selected and approved the public name DelibraShift;
- supplied execution authority and the API environment;
- coordinated hand-offs between models;
- approved or rejected final product and publication decisions;
- remains the project owner, human operator, and competition entrant.

## Attribution method and estimated impact

The impact allocation is an editorial estimate, not a legal ownership split
and not a token-usage estimate. It measures how much each model-assisted
contribution mattered to the delivered project across scientific validity,
implementation and reproducibility, experiment/release work, and explanation.

| Builder model / role | Estimated impact | Confidence | Why it mattered |
|---|---:|---|---|
| OpenAI Codex; operator-provided label GPT-5.6, project role `CODEX 5.6-SOL` | 55% | high for work, operator-supplied model label | Implemented the simulator, harness, scoring integration, baselines, pack tooling, M1/M2 orchestration, official run publication, release hardening, visualization audit, and repository integration. |
| `FABLE 5`, Chief Architect & Scientist; exact model snapshot not recorded | 30% | high for work, low for exact model ID | Defined the executable contract, scientific method, scoring semantics, golden fixtures, kill criteria, and adversarial reviews. |
| `Opus 4.8`, as identified by the project operator; exact provider snapshot not recorded | 15% | medium | Built the first complete offline PL/EN visualization: report linker, extractor, flight arena, charts, design system, copy, and JavaScript tests. |

The percentages are deliberately labeled estimates. Git history and the
evidence below remain authoritative if a competition rubric requires a
different presentation.

## FABLE 5 — architecture and scientific method

Primary responsibility: contract and methodology.

Verified work:

- authored the initial `types.py` schema contract before implementation;
- wrote and revised `SPEC.md` and `PLAN.md`;
- pinned simulated-deliberation semantics, engage-time prediction target, and
  absolute prediction fields;
- defined fidelity, temporal anticipation, outcome, and feedback-use semantics;
- designed the matched architecture ablation and isolation probes;
- authored golden fixtures and adversarial scientific reviews;
- recorded 38 `FAB-###` decisions.

Git evidence:

- `70df480` — schema contract v0.1;
- `9f99074` — SPEC, plan, golden fixture, and FAB-001..013;
- `819c3cb` — adversarial review and contract 0.2.0;
- `e07a6f6` — core pack and oracle fixture;
- `87f922b` — verification round and contract 0.2.1;
- `bb428e9` — clamp ownership and prompt v1.0 approval.

## OpenAI Codex — implementation, experiments, and integration

Operator-provided model label: GPT-5.6. Project role: `CODEX 5.6-SOL`; exact
backend snapshot should be confirmed from the competition `/feedback` record.

Verified work:

- scaffolded the repository and implemented deterministic world/clock behavior;
- built the runner, scoring integration, parser/repair harness, and NIM
  transport;
- implemented random, no-op, greedy, stale-reactor, and oracle baselines;
- built external pack loading, archive verification, and reproducibility gates;
- implemented M1.5 probes and the M2 matched-pair experiment runner;
- executed and published the official 84-log Dracarys result;
- renamed the public package to DelibraShift and hardened packaging/CI;
- independently audited the Opus visualization, corrected semantic errors,
  added matched-pair, temporal-support, and no-retry displays, removed private
  paths, and integrated the report into the canonical repository;
- built the auditable local-Ollama multi-model screen, added transport-condition
  identity for thinking mode, retained model/prompt/driver hashes and raw
  responses, and added replay tests without changing the official M2 result;
- authored the project-first competition narrative and implemented the
  reproducible Chromium capture, synthetic narration, subtitle, evidence-card,
  video assembly, and media-quality audit pipeline;
- audited the complete Git/GitHub publication surface for secrets, reconciled
  the approved MIT release across package and report metadata, and added
  least-privilege CI permissions;
- implemented the isolated, fresh-session Codex product adapter and auditable
  no-API-billing smoke-test path, with credential stripping, ChatGPT-auth
  enforcement, session IDs, usage, and tool-event telemetry;
- recorded 35 `COD-###` decisions including visualization integration, the
  cross-platform judge-path audit, competition video, and public-release
  licensing.

Git evidence: commits authored `Codex Chief Builder`, beginning with `93b18c2`;
notable milestones include `b0ad499`, `1379c87`, `af333bf`, `2a85727`,
`5f979dc`, `9eb3dd4`, `a0f320c`, and `1c936c2`.

## Opus 4.8 — visualization and communication layer

Primary responsibility: graphical explanation and offline result exploration.

Verified surviving work, originally created in a separate unversioned sibling
working directory and subsequently migrated to `report/`:

- one-file offline HTML build and validation pipeline;
- bilingual PL/EN interface and copy system;
- interactive arena with simulated ticks, held/returned actions, prediction
  ghost, engage-time truth, wind, heat, and hidden/decoy goals;
- arm, prediction-error, feedback-pair, and probe visualizations;
- dark/light design tokens, print behavior, and WCAG contrast audits;
- JavaScript pure-function and DOM render-smoke suites;
- independent Python replay audit.

The initial delivery had no Git metadata, duplicated canonical data, and
contained several review findings. Codex corrected those issues during
integration. Attribution remains with Opus for the original visualization
architecture and implementation; corrective and integration work is attributed
to Codex.

## Evaluated model

`abacusai/dracarys-llama-3.1-70b-instruct` is the subject evaluated in M2, not a
builder of this repository. Its outputs are experimental data and are not listed
as project authorship.

## Reproducibility notes

- Commit authors and hashes can be checked with `git log --reverse`.
- Scientific decisions are preserved in append-only `DECISIONS.md`.
- Official model outputs are preserved as 84 canonical logs in `results/m2`.
- Visualization source is in `report/`; generated bundle and HTML are derived
  artifacts and are excluded from Git.
- No API key, hidden chain of thought, or private credential is included in this
  attribution record.
