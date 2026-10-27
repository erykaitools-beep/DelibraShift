# DelibraShift: evaluating agents under decision delay

[Project overview](../README.md) · [Results](../README.md#official-m2-result)

DelibraShift turns a specific product question into an executable experiment:
does predicting a future state help an agent choose an action that will only
take effect after a delay? The delivered system includes a Python simulator,
model-independent harness, reproducible test packs, canonical experiment logs
and an offline report in English and Polish.

Eryk Wyrębek originated the question, set constraints and priorities,
coordinated AI-assisted development and approved the experiments and release.
Implementation, scientific architecture and visualization were AI-assisted;
the [contribution record](../MODEL_CONTRIBUTIONS.md) distinguishes these roles.

## 1. Make the timing contract explicit

If the simulated world simply waits for the model, the agent never has to
compensate for deliberation delay. If network latency drives the simulation,
provider availability can contaminate the score.

The [clock](../delibrashift/clock.py) therefore advances a fixed simulated
budget under the previous action before engaging the new one. The
[world](../delibrashift/world.py) implements deterministic state transitions.
Host latency remains telemetry. Prediction is scored against the state at
action engagement, not against the state originally observed.

The resulting test concerns a defined delay condition. It does not measure
model response speed or establish suitability for real-time robot control.

## 2. Keep model transport separate from experiment policy

The [harness](../delibrashift/harness.py) owns prompt construction, parsing,
retry accounting and pacing. Adapters supply completions. The
[experiment runner](../delibrashift/experiments.py) shares pacing, alternates
the order of the two arms and uses repetition-derived seeds.

This allows a matched comparison between a single-stage END2END prompt and
a two-stage WM-SCAFFOLD prompt using the same model. Canonical JSONL logs
record the evidence needed for replay and result inspection. Tests cover
[experiment resumption](../tests/test_experiments.py) and
[log validation](../tests/test_runner.py).

External model output may still vary despite a fixed seed and temperature.
The exploratory Codex product adapter also has different controls from an API
transport; it is not part of the frozen M2 comparison.

## 3. Validate inputs and artifacts before accepting results

The [pack loader](../delibrashift/bank.py) rejects duplicate JSON keys,
unknown fields, schema mismatches and unsafe scenario paths. The
[archive tools](../delibrashift/archive.py) produce deterministic packs and
SHA-256 sidecars. The [official snapshot tests](../tests/test_official_snapshot.py)
pin the report, log set and run identity and check the README result table.

These controls make specific classes of inconsistent input or changed evidence
detectable. They do not constitute a general security certification.

## 4. Check the report against a second implementation

The report builder replays the recorded episodes before generating a
self-contained HTML file. Its [independent audit](../report/tests/audit_truth.py)
does not import the production world implementation: it recalculates physics,
outcome, action parse rate and prediction coverage.

The scope matters. Fidelity, temporal anticipation, divergence weights and
the feedback band are not all independently recalculated by that audit;
separate contract tests and golden fixtures cover those parts. The
[report guide](../report/README.md) describes this boundary.

[CI](../.github/workflows/ci.yml) also checks the source distribution,
installed wheel, real Chromium rendering, offline operation and mobile layout.
Passing these checks establishes those tested properties, not universal model
correctness.

## 5. Preserve the result that challenged the design

The official M2 run contains 84 logs: 60 treatment episodes, 18 decoy episodes
and six probe-control episodes. It evaluates one model in one world with
three repetitions.

The scaffold raised action parse rate from 0.616 to 1.000 and prediction
coverage from 0.585 to 0.875. Yet mean outcome fell from 0.169 to 0.090,
and temporal anticipation was lower in all 21 paired visible cells.
Outcome was not uniformly worse: 16 of 30 paired cells improved, 11 worsened
and three tied. The negative mean effect remains published.

The lesson is operational: output validity and task effectiveness require
separate checks. A more structured response is useful evidence, but it cannot
substitute for the task outcome.

Inspect the [full table](../README.md#official-m2-result),
[raw report and logs](../results/m2), and [limitations](../LIMITATIONS.md).
The result applies to these prompts, harness, model, pack and repetitions;
it does not show that every world-model scaffold is harmful.

## Evidence baseline

This case study describes public source at
[`7b0f73b`](https://github.com/erykaitools-beep/DelibraShift/tree/7b0f73b9782e3fafdc2f0b3d44f61fd495859b19).
The documentation update does not alter the simulator, prompts, fixtures or
official experiment data. The report hash is recorded in
[provenance.json](../results/m2/provenance.json).
