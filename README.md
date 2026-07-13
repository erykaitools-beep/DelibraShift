# ChronoGym

ChronoGym is an open, deliberation-aware benchmark for diagnosing agent
cognition in deterministic simulated worlds. Its first world couples gravity,
time-varying lateral wind, steering, and a deadline while exposing a graded
hot/cold signal.

The project is in its contract-first scaffold phase. Executable world code is
intentionally gated on the committed `chronogym/types.py` contract and the
architect's specification.

## Development

ChronoGym targets Python 3.10+ and keeps the CPU-only simulation dependency
free. After the contract lands, the intended local workflow is:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
pytest
```

Reproducibility is a hard requirement: a transition is a pure function of its
seed, state, action, and simulated time delta. Wall-clock latency is telemetry,
never a score.

## Status

See [STATUS.md](STATUS.md) for the active implementation gate and progress.

## License

MIT
