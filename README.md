# ChronoGym

ChronoGym is an open, deliberation-aware benchmark for diagnosing agent
cognition in deterministic simulated worlds. Its first world couples gravity,
time-varying lateral wind, steering, and a deadline while exposing a graded
hot/cold signal.

The M0 world stub is runnable. It uses a fixed simulated deliberation budget:
the craft keeps moving under its previously latched action while an agent
chooses the next action. Host latency never advances or scores the world.

## Development

ChronoGym targets Python 3.10+ and keeps the CPU-only simulation dependency
free:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e '.[dev]'
pytest
```

Run the deterministic random baseline and optionally retain its canonical log:

```bash
chronogym-demo --agent random --log episode.jsonl
```

Greedy and no-op baselines are available with `--agent greedy` and
`--agent noop`. Each summary includes prediction fidelity with coverage,
separate action/prediction parse rates, the persistence floor, and graded
outcome.

Run a baseline over an external local test pack in manifest order:

```bash
chronogym-run /path/to/pack --agent random --log-dir logs
```

The strict loader rejects schema mismatches, unknown fields, duplicate JSON
keys, and unsafe scenario paths.

The NIM transport is configured externally with `NIM_MODEL`, `NIM_BASE_URL`,
and optionally `NVIDIA_API_KEY`. It only sends an already-rendered prompt to
the OpenAI-compatible chat-completions endpoint; prompt construction, parsing,
and retries stay in the harness. The reviewed standard-cycle prompt is frozen
as version `1.0`.

The second transport targets Ollama's native `/api/chat` endpoint. It defaults
to `llama3.1:8b` at `http://localhost:11434`; override these with
`OLLAMA_MODEL` and `OLLAMA_BASE_URL`. Both adapters remain transport-only:
`HarnessAgent` owns prompts, parsing, and retry accounting.

Formatting-control and forced-choice probes have separately frozen prompt
versions (`probe-format-1.0` and `probe-choice-1.0`), so those controls cannot
mutate or silently unfreeze the standard `1.0` results prompt. Complete prompt
hashes are pinned in CI.

Evaluate the executable pack gates (the sampling-MPC kill criterion is the
CPU-heavy part):

```bash
chronogym-gates packs/core_v0
```

This reports full-pack byte reproducibility, the matched-state budget probe,
the masked-searcher feedback band, and the registered kill criterion as
canonical JSON. Exact golden fixtures remain the pytest-owned gate (iii).

M1's four exit gates pass on `core_v0` v0.1.1. See
[`DECISIONS.md`](DECISIONS.md) for the exact final table and
[`STATUS.md`](STATUS.md) for current milestone progress.

### Deterministic baseline reference

Core visible non-probe subset S, core_v0 v0.1.1, Linux x86_64. Random outcome
uses the registered 20 repetitions. These are simulator/baseline references,
not LLM results.

| agent | mean outcome | mean temporal anticipation |
|---|---:|---:|
| random (R=20) | 0.0885 | — |
| greedy | 0.3358 | 0.4707 |
| oracle | 0.9807 | 0.6393 |

Build the downloadable pack ZIP and canonical SHA-256 sidecar manifest:

```bash
chronogym-pack packs/core_v0 --output-dir dist
```

The archive preserves the local pack layout, uses fixed ZIP metadata, and
includes per-member hashes in addition to the archive hash.

### M2 matched architecture ablation

The same adapter/model can be run as frozen END2END `1.0` or the 131-line,
two-stage `wm-scaffold-1.0`. The runner shares pacing, alternates arm order,
passes repetition-derived seeds, writes per-episode canonical logs, and reports
a sensitivity slice excluding every cycle retried in either scaffold stage.
Masked scenarios additionally receive paired deterministic decoy-heat runs;
format and forced-choice scenarios are emitted as separate shared-model
control rows with parse rates and trial counts, never as treatment scores.

External calls require an explicit acknowledgement:

```bash
chronogym-ablate packs/core_v0 --execute \
  --repetitions 3 --pace-rpm 40 \
  --log-dir results/m2/logs --report results/m2/report.json
```

If an endpoint timeout interrupts a long run, repeat the command with
`--resume`. Every existing canonical log is strictly checked against the
requested scenario, model arm, prompt/pack versions, host, and scenario list;
only missing episodes make external calls.

Without `--execute`, the command exits before constructing the NIM adapter.

Official Dracarys result: `core_v0` v0.1.1, R=3, Linux x86_64. Ranges are
episode minima/maxima; Δ is the mean same-scenario, same-repetition
WM-SCAFFOLD minus END2END difference. Fidelity support differs because low
coverage invalidates an episode under §4.1.

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
reduced mean outcome. Both arms showed no measurable use of hot/cold feedback.
Controls passed formatting (identity fidelity 1.0, 30/30 parsed); forced-choice
accuracy was 0.60/0.70/0.80 (mean 0.70, 30/30 parsed). The complete canonical
report and 84 logs are in [`results/m2`](results/m2); report SHA-256 is
`5ed6e76793684c9c7ef996ae58168ec57301afbcc615f4967c533e853f2506fa`.

Reproducibility is a hard requirement: physics is a pure function of scenario,
state, held action, and simulated time delta. Same-seed baseline runs produce
byte-identical JSONL logs on the same host. Wall-clock latency is telemetry,
never a score.

## Status

See [STATUS.md](STATUS.md) for the active implementation gate and progress.

## License

MIT
