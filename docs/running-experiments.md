# Running baselines and model experiments

[Project overview](../README.md) · [Published M2 result](../README.md#official-m2-result)

Run commands from the repository root after the README setup.
The published experiment remains frozen under `results/m2`.
Use a separate output directory for new runs so their provenance stays distinct.

## Deterministic baseline reference

Run a baseline over a local test pack:

```bash
delibrashift-run /path/to/pack --agent random --log-dir logs
```

The strict loader rejects schema mismatches, unknown fields, duplicate JSON
keys and unsafe scenario paths.

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

## Model adapters

The NIM transport is configured externally with `NIM_MODEL`, `NIM_BASE_URL`,
and optionally `NVIDIA_API_KEY`. The Ollama transport defaults to
`llama3.1:8b` at `http://localhost:11434`. Adapters remain transport-only:
prompt construction, parsing, retry accounting, and pacing stay in the harness.
Ollama thinking is disabled by default so a separate reasoning stream cannot
consume the strict-JSON response budget; exploratory callers may opt in with
`OllamaAdapter(..., think=True)` and must record that as a different transport
condition.

`CodexExecAdapter` is an exploratory product-level condition, not a Platform
API adapter and not part of the frozen M2 result. Every completion launches a
fresh `codex exec --ephemeral` session in an empty temporary directory, using
the saved ChatGPT login. It strips `OPENAI_API_KEY`, `CODEX_API_KEY`, and
`CODEX_ACCESS_TOKEN` from the child environment and refuses to run unless
`codex login status` reports ChatGPT authentication. This avoids separate API
billing but consumes the existing Codex plan allowance. The CLI does not honor
the harness seed, temperature, or 512-token cap, so those limitations and any
tool events are recorded and the condition must not be presented as a direct
transport-equivalent model ranking.

External model calls require explicit acknowledgement and are not needed to
verify the published result.

## A new matched architecture experiment

The same adapter/model runs as frozen END2END `1.0` or as the 131-line,
two-stage `wm-scaffold-1.0`. The runner shares pacing, alternates arm order,
passes repetition-derived seeds, writes canonical logs, and reports a separate
sensitivity slice excluding cycles retried in either scaffold stage.

To launch a new external run intentionally:

```bash
delibrashift-ablate packs/core_v0 --execute \
  --repetitions 3 --pace-rpm 40 \
  --log-dir results/new-run/logs --report results/new-run/report.json
```

Without `--execute`, the command exits before constructing the external adapter.
