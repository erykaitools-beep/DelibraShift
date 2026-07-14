# Builder Notes

Implementation notes after Fable's contract and specification landed:

- Keep world dynamics in a small pure transition module. Any seeded variation
  should be derived from immutable episode parameters, never mutable global RNG
  state.
- Represent deliberation as an explicit simulated-tick budget consumed before
  applying each action, so the continuously advancing world is reproducible and
  independent of host latency.
- Keep baseline agents separate from model transports. The requested random and
  no-op implementations should depend only on the public contract.
- Serialize logs with stable field ordering and numeric formatting so the
  byte-identical replay gate is testable.

M0 applies these proposals in `world.py`, `clock.py`, and `runner.py`. Baseline
agents return typed `AgentReply` objects directly; they are deliberately kept
separate from the transport-only `Adapter` protocol used by future model APIs.

M1 note: `runner.CycleRecord` is the in-memory scorer boundary. Canonical JSONL
remains the audit artifact, while scoring avoids reparsing its own freshly
serialized logs. `harness.PROMPT_VERSION` stays a draft until Fable freezes the
template; benchmark comparisons must not use this draft version.

Oracle implementation is intentionally pending architect clarification. SPEC
§4.2 fixes the seed, candidate count, elite count, iterations, sigma floor,
horizon, and objective, but does not yet fix the iteration-0 sampling
distribution or the exact Gaussian refit/cap procedure. Those choices can
change the ceiling and temporal gate, so implementing one silently would break
the reproducibility contract. Suggested resolution: specify initial means and
sigmas per action dimension, sampling/clamping order, elite mean/std formula,
and whether greedy/no-op candidates participate in refit.

Resolved by FAB-017 / SPEC 4.2.1: the oracle is now implemented with the pinned
candidate order, RNG call order, stable lower-index tie break, elite carry,
population refit, per-window clamp, and final elite mean. No oracle baseline
numbers are accepted for gates until Fable's promised golden oracle fixture is
committed.

SPEC 4.1 has one editorial contradiction to clean up: its opening “Valid
cycle” sentence requires an action-parsed cycle, while FAB-014 and the later
normative paragraph explicitly keep and score a valid prediction from an
action-failed cycle. The implementation follows FAB-014 and the later explicit
rule; temporal scoring still excludes action-parse failures per FAB-015.

Resolved by Fable's 2026-07-14 pack and fixture commits: the core pack,
golden oracle, matched-state probe, feedback control, and kill criterion are
implemented and evaluated. The builder numbers reproduce FAB-037's references.

Resolved by FAB-038: the 9e-16 g007c mismatch exposed a genuine double-clamp
ambiguity. Baseline laws now return raw commands and the latch applies the
single clamp; all four golden suites pass with binary64 equality. Fable also
corrected the pack stamp to 0.1.1. No architect-owned reconciliation remains
for M1.
