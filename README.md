# DelibraShift

**The world moves while agents think.**

DelibraShift is a reproducible, deliberation-aware benchmark for diagnosing
agent cognition in deterministic simulated worlds. Its first world combines
gravity, time-varying lateral wind, steering, a deadline, and a graded hot/cold
signal.

Unlike benchmarks that pause between decisions, DelibraShift advances the world
by a fixed simulated deliberation budget while the agent thinks. The previous
action remains latched until the newly returned action engages. Host latency is
recorded as infrastructure telemetry but never advances or scores the world.

**Human project owner and competition entrant:** Eryk Wyrębek. AI-assisted
architecture, implementation, experiments, visualization, and audit are
disclosed in [`MODEL_CONTRIBUTIONS.md`](MODEL_CONTRIBUTIONS.md).

## Judge and Build Week paths

- [`JUDGES.md`](JUDGES.md): a 60-second review and full verification path.
- [`BUILD_WEEK.md`](BUILD_WEEK.md): event-period origin and first-commit evidence.
- [`LIMITATIONS.md`](LIMITATIONS.md): boundaries of the published result.

## Quickstart

DelibraShift targets Python 3.10+ and keeps the CPU-only simulation dependency
free:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e '.[dev]'
pytest
```

Run the deterministic random baseline and optionally retain its canonical log:

```bash
delibrashift-demo --agent random --log episode.jsonl
```

Greedy and no-op baselines are available with `--agent greedy` and
`--agent noop`. Each summary includes prediction fidelity with coverage,
separate action/prediction parse rates, the persistence floor, and graded
outcome.

Run a baseline over an external local test pack:

```bash
delibrashift-run /path/to/pack --agent random --log-dir logs
```

The strict loader rejects schema mismatches, unknown fields, duplicate JSON
keys, and unsafe scenario paths.

## Offline interactive report

Build the bilingual, self-contained report in English for judging:

```bash
python report/build_report.py --lang en
```

Then open `report/delibrashift_report.html` locally. The output requires no
server, CDN, or network connection. Node.js 22 is required only to build and
validate the report.

## Model adapters

The NIM transport is configured externally with `NIM_MODEL`, `NIM_BASE_URL`,
and optionally `NVIDIA_API_KEY`. The Ollama transport defaults to
`llama3.1:8b` at `http://localhost:11434`. Adapters remain transport-only:
prompt construction, parsing, retry accounting, and pacing stay in the harness.
Ollama thinking is disabled by default so a separate reasoning stream cannot
consume the strict-JSON response budget; exploratory callers may opt in with
`OllamaAdapter(..., think=True)` and must record that as a different transport
condition.

External model calls require explicit acknowledgement and are not needed to
verify the published result.

## Deterministic baseline reference

Core visible non-probe subset S, `core_v0` v0.1.1, Linux x86_64. Random outcome
uses 20 repetitions. These are simulator/baseline references, not LLM results.

| agent | mean outcome | mean temporal anticipation |
|---|---:|---:|
| random (R=20) | 0.0885 | — |
| greedy | 0.3358 | 0.4707 |
| oracle | 0.9807 | 0.6393 |

Evaluate the executable pack gates:

```bash
delibrashift-gates packs/core_v0
```

Build the deterministic pack archive and SHA-256 sidecar:

```bash
delibrashift-pack packs/core_v0 --output-dir dist
```

## M2 matched architecture ablation

The same adapter/model runs as frozen END2END `1.0` or as the 131-line,
two-stage `wm-scaffold-1.0`. The runner shares pacing, alternates arm order,
passes repetition-derived seeds, writes canonical logs, and reports a separate
sensitivity slice excluding cycles retried in either scaffold stage.

To launch a new external run intentionally:

```bash
delibrashift-ablate packs/core_v0 --execute \
  --repetitions 3 --pace-rpm 40 \
  --log-dir results/m2/logs --report results/m2/report.json
```

Without `--execute`, the command exits before constructing the external adapter.

### Official Dracarys result

`core_v0` v0.1.1, R=3, Linux x86_64. Ranges are episode minima/maxima; Δ is the
mean same-scenario, same-repetition WM-SCAFFOLD minus END2END difference.

| metric | END2END mean [range] | WM-SCAFFOLD mean [range] | paired Δ |
|---|---:|---:|---:|
| prediction fidelity | 0.116 [0.058, 0.187], n=10 | 0.129 [0.052, 0.253], n=18 | +0.018, n=4 |
| prediction coverage | 0.585 [0.200, 1.000], n=30 | 0.875 [0.250, 1.000], n=30 | +0.290 |
| temporal anticipation | 0.512 [0.485, 0.566], n=21 | 0.473 [0.429, 0.494], n=21 | **−0.039** |
| outcome | 0.169 [0.005, 0.951], n=30 | 0.090 [0.005, 0.312], n=30 | **−0.079** |
| action parse rate | 0.616 [0.200, 0.857], n=30 | 1.000 [1.000, 1.000], n=30 | +0.384 |
| retried-cycle rate | 0.636 [0.357, 0.833], n=30 | 0.190 [0.000, 0.800], n=30 | −0.446 |
| feedback-use | 0.500, n=9 pairs | 0.500, n=9 pairs | 0.000 |

The scaffold improved structured-output reliability and prediction coverage,
but reduced temporal anticipation on every one of 21 paired visible cells and
reduced mean outcome. Across the 18 matched heat pairs, both arms produced
identical harness-resolved effective actions (accepted parses or no-op
fallbacks) and zero mean outcome effect under the signal swap. Predictions
differed in every pair and parse/retry paths differed in 7 pairs, so the
finding is limited to control and outcome; it is not a claim about the whole
reply or internal model processing. Outcome effects were mixed across cells:
WM-SCAFFOLD was higher in 16/30, lower in 11/30, and tied in 3/30; the reported
`−0.079` is a mean effect, not a universal loss. The negative mean architecture
result is published unchanged.

The complete canonical report and 84 logs are in [`results/m2`](results/m2).
Report SHA-256:
`5ed6e76793684c9c7ef996ae58168ec57301afbcc615f4967c533e853f2506fa`.

## Reproducibility boundary

Physics is a pure function of scenario, state, held action, and simulated time
delta. Same-seed local baseline runs produce byte-identical logs on the same
host. CPython 3.10 on Linux x86_64 is the exact golden-fixture reference;
supported runtimes additionally enforce the narrow cross-runtime bound in
[`SPEC.md`](SPEC.md). External model responses may vary even with temperature
zero and a seed; see [`LIMITATIONS.md`](LIMITATIONS.md).

## Project documentation

- [`SPEC.md`](SPEC.md): normative benchmark and scoring specification.
- [`DECISIONS.md`](DECISIONS.md): append-only scientific and engineering record.
- [`STATUS.md`](STATUS.md): milestone and verification history.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): development and change-control rules.
- [`report/README.md`](report/README.md): build and audit the interactive report.
- [`MODEL_CONTRIBUTIONS.md`](MODEL_CONTRIBUTIONS.md): human direction and AI assistance.
- [`CITATION.cff`](CITATION.cff): citation metadata.
- [`SECURITY.md`](SECURITY.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

Copyright © 2026 Eryk Wyrębek. DelibraShift is open-source software released
under the [MIT License](LICENSE).
