# M2 Dracarys matched ablation

Official run completed 2026-07-19 on Linux x86_64 with `core_v0` v0.1.1,
Dracarys `abacusai/dracarys-llama-3.1-70b-instruct`, R=3, temperature 0.0,
and a shared 40-RPM pacer.

- `report.json`: canonical aggregate report (SHA-256
  `5ed6e76793684c9c7ef996ae58168ec57301afbcc615f4967c533e853f2506fa`).
- `provenance.json`: pinned data date, model identity, log count, report hash,
  and aggregate log-set hash. The log-set digest hashes each sorted filename,
  a NUL separator, its raw bytes, and another NUL separator.
- `logs/`: 60 treatment, 18 paired decoy-heat, and 6 probe-control JSONL
  logs. Every file contains its manifest, raw completions, cycle records, and
  terminal summary.

The endpoint timed out after 40 logs on the first attempt. The run continued
with `--resume`; every reused log was strictly validated and the final report
was later reconstructed with zero model calls and matched byte-for-byte.

See the root README and COD-023 in `DECISIONS.md` for the result summary and
interpretation.
