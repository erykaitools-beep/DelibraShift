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
`--agent noop`. Each summary includes prediction fidelity, parse rate, and the
persistence floor.

Run a baseline over an external local test pack in manifest order:

```bash
chronogym-run /path/to/pack --agent random --log-dir logs
```

The strict loader rejects schema mismatches, unknown fields, duplicate JSON
keys, and unsafe scenario paths.

The NIM transport is configured externally with `NIM_MODEL`, `NIM_BASE_URL`,
and optionally `NVIDIA_API_KEY`. It only sends an already-rendered prompt to
the OpenAI-compatible chat-completions endpoint; prompt construction, parsing,
and retries stay in the harness. The current prompt is explicitly a draft
pending architect review and must not be used for publishable comparisons.

Reproducibility is a hard requirement: physics is a pure function of scenario,
state, held action, and simulated time delta. Same-seed baseline runs produce
byte-identical JSONL logs on the same host. Wall-clock latency is telemetry,
never a score.

## Status

See [STATUS.md](STATUS.md) for the active implementation gate and progress.

## License

MIT
