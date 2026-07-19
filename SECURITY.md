# Security policy

## Supported versions

The latest `0.1.x` release receives security fixes.

## Reporting a vulnerability

Please use GitHub's private security-advisory flow for vulnerabilities,
credential exposure, unsafe archive handling, or dependency concerns. Do not
open a public issue containing exploit details or secrets.

DelibraShift never requires credentials for deterministic baselines or tests.
External-adapter keys must be supplied through environment variables and must
not be committed, serialized into logs, or included in bug reports.
