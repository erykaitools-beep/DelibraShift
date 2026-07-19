# Contributing to DelibraShift

Thanks for helping improve an open, reproducible agent benchmark.

## Development setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e '.[dev]'
python3 -m pytest
```

## Change rules

- Preserve deterministic physics and canonical-log reproducibility.
- Changes to public fields or semantics in `delibrashift/types.py` require a
  `SCHEMA_VERSION` bump and a decision entry.
- Prompt-byte changes require a new prompt version and updated hash tests.
- Fixture or pack changes require exact regeneration and documented gate
  impact. Never silently rewrite published results.
- Adapters stay transport-only; prompting, parsing, retry, and pacing belong
  to the harness.
- External or paid model calls must be explicitly acknowledged. Unit tests
  must not require credentials or network access.

Keep pull requests focused. Include tests, explain scientific or contract
impact, and run the complete suite before submission.
