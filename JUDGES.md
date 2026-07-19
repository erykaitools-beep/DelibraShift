# Judge quick path

DelibraShift is a deliberation-aware benchmark for agents operating in a world
that does not pause while they think.

## 60-second review

1. Read the first 15 lines of `README.md` for the mechanism.
2. Inspect the official M2 table in `README.md`.
3. Build the offline report:

   ```bash
   python -m pip install -e '.[dev]'
   python report/build_report.py --lang en
   ```

4. Open `report/delibrashift_report.html` locally in a browser.
5. In the Lab tab, compare the prediction ghost with engage-time truth and
   inspect the latched action while the simulated clock advances.

The report is self-contained and makes no network requests after it is built.

## Full verification

Requirements:

- Linux or macOS shell for the commands below;
- Python 3.10 for exact reference-fixture verification (3.12 is also tested
  under the documented cross-runtime ULP bound);
- Node.js 22 for report validation;
- no API key for deterministic tests, baselines, report generation, or replay.

Run:

```bash
python -m pip install -e '.[dev]'
python -m coverage run -m pytest
python -m coverage report
python report/build_report.py --lang en
npm --prefix report test
python report/tests/audit_truth.py
```

External model calls are never required for judging the published result. The
84 canonical M2/control logs and aggregate report are already stored under
`results/m2`.

## Main finding

On the published Dracarys run, WM-SCAFFOLD improved structured-output
reliability and prediction coverage but reduced temporal anticipation and mean
outcome. The negative result is published unchanged.

## Evidence and provenance

- `BUILD_WEEK.md`: event-period origin and first-commit evidence;
- `MODEL_CONTRIBUTIONS.md`: human direction and model-assisted work;
- `SPEC.md`: normative metrics and world semantics;
- `DECISIONS.md`: append-only design history;
- `LIMITATIONS.md`: claims the result does and does not support.
