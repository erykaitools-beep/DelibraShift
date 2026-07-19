# Limitations

DelibraShift v0.1 is a diagnostic benchmark and an initial controlled
experiment. Its published result should be interpreted within the following
limits.

- **One evaluated model.** The M2 result concerns
  `abacusai/dracarys-llama-3.1-70b-instruct`; it is not a model leaderboard.
- **Small repetition count.** The matched architecture experiment uses three
  repetitions. Ranges and paired support are reported, but broad statistical
  generalization would require more runs and more models.
- **One simple world.** Windrift is deterministic, two-dimensional, and designed
  to isolate anticipation. Success here does not establish readiness for open
  physical environments or robot control.
- **Simulated deliberation budget.** Scored delay is fixed in simulation ticks.
  Host wall-clock latency is telemetry only, so the benchmark does not rank
  models by response speed.
- **External inference may vary.** The simulator, scorers, fixtures, and local
  baselines are reproducible under their documented conditions. Temperature
  zero and a seed do not guarantee byte-identical responses from every external
  model service.
- **Ablation-specific conclusion.** The negative WM-SCAFFOLD result applies to
  the registered prompts, harness, model, pack, and repetition count. It does
  not prove that every world-model scaffold will reduce performance.
- **Outcome is intentionally separated from diagnosis.** Prediction fidelity,
  temporal anticipation, feedback use, and outcome answer different questions;
  no single aggregate score is claimed to represent general intelligence.
- **Novelty language is provisional.** Claims of priority are stated as
  "to our knowledge" and should be revisited as related work is expanded.

The project publishes null and negative findings unchanged because diagnostic
value depends on preserving failures, invalid measurements, and support counts.
