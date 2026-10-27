# Interactive experiment report

[Project overview](../README.md) · [Official results](../results/m2) ·
[Engineering case study](../docs/engineering-case-study.md)

This directory builds a self-contained HTML report of the M2 experiment.
The interface supports English and Polish. Readers can inspect the mechanism,
compare the two experiment arms and replay flights tick by tick.

- `end2end`: one prompt returns a prediction and an action.
- `wm-scaffold`: a first stage predicts the state at action engagement;
  a second stage chooses an action using that prediction.

The generated file works locally without a server, CDN or network connection.
The screenshot in the [main README](../README.md) previews this report.

## Build

From the repository root, with Python 3.10+ and Node.js 22 installed:

```bash
python -m pip install -e '.[dev]'
python report/build_report.py --lang en
```

Open `report/delibrashift_report.html` in a browser. Package installation
requires downloads; building and viewing the published experiment requires
no API key or new model call.

Canonical inputs are read directly from the repository:

- [results/m2/logs](../results/m2/logs): 84 experiment and control logs.
- [results/m2/report.json](../results/m2/report.json): official aggregates.
- [packs/core_v0](../packs/core_v0): scenario pack.

There is no second maintained copy of those inputs in `report/`.
`report/data/` is an ignored working directory for the generated bundle
and its provenance sidecar.

| Option | Purpose |
|---|---|
| `--logs-dir DIRECTORY` | Alternative log directory |
| `--packs-dir DIRECTORY` | Alternative scenario pack |
| `--report FILE` | Alternative aggregate report |
| `--out FILE` | Output path inside `report/` |
| `--lang pl` or `--lang en` | Initial display language |
| `--skip-extract` | Reuse the local bundle and source sidecar |

The builder replays every episode through the DelibraShift library.
Inconsistent final states, closest approaches or episode counts cause
validation to fail.

## Verification

After building the bundle:

```bash
npm --prefix report ci
npm --prefix report test
npm --prefix report exec playwright -- install --with-deps chromium
npm --prefix report run test:browser
python report/tests/audit_truth.py
```

Browser dependency installation may require system package permissions.
Use an existing compatible Chromium installation where appropriate.

The checks cover pure functions, DOM rendering, the arena, PL/EN translations,
contrast, script syntax and real Chromium. Browser tests block network access
and check tabs, language switching, theme switching, a painted canvas and
mobile layout.

The independent Python audit does not import `delibrashift.world`. It
recalculates physics, outcome, action parse rate and prediction coverage.
It does **not** independently recalculate fidelity, temporal anticipation,
divergence weights or the feedback band. Those have separate contract tests
and golden fixtures.

## Interpretation rules

- Compare fidelity only on scenario × repetition cells where both arms have
  a valid measurement: official paired Δ = `+0.0183`, `n=4`.
- Show temporal anticipation with the scored cycle count `K` and mean
  divergence weight.
- Treat `*_no_retry` as a separate sensitivity slice, not a replacement for
  the main result.
- Equal outcome alone does not establish absence of a hot/cold response.
  The control finding uses identical effective action sequences in matched
  normal/decoy pairs; it does not establish internal model processing.
- Wall-clock time is telemetry and never changes the simulation or score.

## Source layout

| Path | Role |
|---|---|
| [build_report.py](build_report.py) | Build and complete-HTML validation |
| [extract.py](extract.py) | Log replay and bundle extraction |
| [template.html](template.html) | Semantic report structure |
| [assets](assets) | Styles, scripts, icons and PL/EN copy |
| [tests](tests) | JavaScript checks and independent physics audit |
| [spec](spec) | Visualization and metric rules |

Generated HTML is a derived artifact. The canonical logs and aggregate
report remain the source of the published results.
