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

The no-op baseline is available as `chronogym-demo --agent noop`.

Reproducibility is a hard requirement: physics is a pure function of scenario,
state, held action, and simulated time delta. Same-seed baseline runs produce
byte-identical JSONL logs on the same host. Wall-clock latency is telemetry,
never a score.

## Status

See [STATUS.md](STATUS.md) for the active implementation gate and progress.

## License

MIT
