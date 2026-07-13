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
