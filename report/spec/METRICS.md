# DelibraShift M2 metrics — visualization contract

This document defines what the offline M2 report may display and how each
number must be framed. Normative benchmark semantics remain in `SPEC.md`; the
executable sources are `delibrashift/types.py`, `delibrashift/scoring.py`,
`delibrashift/gates.py`, and `delibrashift/experiments.py`.

The empirical source is the completed official run in `results/m2`: 84
canonical logs, `core_v0` 0.1.1, three repetitions, Linux x86_64, and model
`abacusai/dracarys-llama-3.1-70b-instruct`.

## 1. Inclusion and pairing

The 84 logs contain:

- 60 ordinary treatment episodes: 10 non-probe scenarios × 2 arms × 3 reps;
- 18 decoy episodes: 3 masked scenarios × 2 arms × 3 reps;
- 6 shared controls: 2 probe scenarios × 3 reps.

Decoy episodes never enter ordinary arm aggregates. Control probes belong to a
shared `control` row and never to either treatment arm.

Architecture comparisons are matched by `(scenario_id, repetition)`. A paired
delta is always:

```text
wm-scaffold - end2end
```

For fidelity, a cell enters the comparison only when fidelity is measurable in
both arms. This leaves four cells in the official M2 run. Unrestricted arm
means may be reported descriptively with their own support, but may not be used
to rank the arms.

The visible-goal subset S is `{g001, g001_b10, g001_b40, g002, g003, g006,
g010}`. Only this subset is comparable to the published random, greedy and
oracle references. Masked `g007*` scenarios are shown separately or under an
explicit “all non-probe flights” scope.

## 2. Prediction fidelity

For one valid prediction, with absolute predicted and target state fields:

```text
nerr = mean(
  |x_pred  - x_true|  / PRED_POS_TOL_M,
  |y_pred  - y_true|  / PRED_POS_TOL_M,
  |vx_pred - vx_true| / PRED_VEL_TOL_MPS,
  |vy_pred - vy_true| / PRED_VEL_TOL_MPS
)
fidelity = exp(-nerr)
```

The target is the true state at engage time under the previously latched
action. Truncated cycles and invalid predictions do not enter the fidelity
mean, but they do affect coverage.

Episode fidelity is measurable only when:

- prediction coverage is at least `0.8`;
- there are at least 3 valid prediction cycles.

The persistence floor predicts that the observed position and velocity remain
unchanged until engage time. Every fidelity display must include coverage and
the corresponding persistence floor. In a paired arm comparison, both the
fidelity and the floor use the same four common cells.

Official unrestricted means are `0.1164` (`n=10`) for end2end and `0.1290`
(`n=18`) for wm-scaffold. They rest on different scenario mixtures. The valid
matched comparison is `Δ=+0.0183`, `n=4`.

## 3. Temporal anticipation

Temporal anticipation compares the returned action with two pinned MPC
references: the action appropriate for the observed state and the action
appropriate for the engage-time state.

For each scored cycle:

```text
w_k = ||oracle_engage - oracle_observed|| / (2 * max_accel)
margin_k = similarity(action, oracle_engage)
         - similarity(action, oracle_observed)
temporal_raw = sum(w_k * margin_k) / sum(w_k)
temporal = (temporal_raw + 1) / 2
```

`0.5` means no lead. A value below `0.5` is closer to stale-state steering; a
value above `0.5` is closer to engage-time steering. The metric is `None` when
there are no scored cycles or the mean divergence weight is below `0.02`.

Every temporal number must display:

- `K`, the number of scored cycles supporting it;
- mean divergence weight;
- the relevant subset and number of episodes.

Official means are `0.5120` for end2end and `0.4727` for wm-scaffold, with
paired `Δ=-0.0393` over 21 common visible cells.

## 4. Feedback use

Feedback use is measured only on masked-goal scenarios. Each ordinary flight is
paired with a same-seed run where heat is computed against a deterministic
decoy goal.

```text
feedback_raw = mean(outcome_normal - outcome_decoy)
feedback_use = 0.5 + 0.5 * clamp(feedback_raw / reference_band, -1, 1)
```

`0.5` is the no-effect origin, not “partial use”. The report must show raw
delta, reference band and pair count.

Equal outcomes alone do not prove that heat was ignored. The strong channel
claim is permitted only when the logged action sequences are identical. In the
official run all 18/18 normal-decoy pairs have identical commands, while the
heat observations differ. Both arms therefore have `feedback_raw=0` and
`feedback_use=0.5`, with 9 pairs per arm.

## 5. Outcome

```text
outcome = 0.5 * success
        + 0.4 * exp(-closest_approach_m / HEAT_SCALE_M)
        + 0.1 * success * (1 - goal_tick / deadline_tick)
```

Outcome is graded but is not a pure cognition score: parse failures engage a
no-op and therefore alter the trajectory. With goal radius 2 m and heat scale
20 m, failed and successful flights occupy disjoint score bands; the chart must
mark the unreachable gap.

Official means are `0.1692` for end2end and `0.0901` for wm-scaffold, paired
`Δ=-0.0790` across 30 common treatment cells.

## 6. Formatting controls and sensitivity

The UI keeps these outside the four cognition measures:

- action parse rate;
- prediction parse rate;
- prediction coverage;
- retried-cycle rate;
- transport retries;
- wall-clock telemetry.

Wall-clock time and transport retries never affect simulated time or score.

`fidelity_no_retry` and `temporal_no_retry` are sensitivity slices formed by
dropping any cycle where either prompt stage required a parse retry. They use a
different cycle set and must not be described as corrected versions of the
primary metrics. Display their episode support and kept-cycle count.

Official no-retry aggregates:

| metric | end2end | wm-scaffold |
|---|---:|---:|
| fidelity without retried cycles | 0.0836, n=6 | 0.1552, n=21 |
| temporal without retried cycles | 0.5156, n=21 | 0.4738, n=21 |

## 7. Probe controls

`g008` checks whether the model can return visible state values in the required
format. `g009` is a forced-choice temporal control. They use separate frozen
prompts and forced no-op physics.

Official controls:

- format probe: 30/30 parsed, identity fidelity `1.0`, engage fidelity
  `0.07870475`;
- forced choice: 30/30 parsed, accuracy `0.60`, `0.70`, `0.80` by repetition.

These controls constrain interpretation; they are not a third experiment arm.

## 8. Hard UI rules

1. Never draw `null` as zero. Show the scorer's reason.
2. Never rank fidelity using unmatched supports.
3. Never show fidelity without coverage and persistence floor.
4. Never show temporal without `K` and mean divergence weight.
5. Never present `*_no_retry` as the same measurement after a fix.
6. Never imply statistical significance from three near-deterministic reps.
7. Never mix subset S and masked scenarios in an unlabeled mean.
8. Never call `feedback_use=0.5` partial use.
9. Never infer identical commands from an identical outcome.
10. Never use wall-clock latency as simulated deliberation or score.
11. Never attribute probe results to either treatment arm.
12. Never compare different prompt versions as though only architecture changed.

## 9. Required provenance

The footer and embedded bundle metadata must report pack version, schema
version, model, prompt versions, repetitions, host class, run completion and
portable repository-relative source paths. Public artifacts must not contain a
developer home directory, private network address, credential or API key.
