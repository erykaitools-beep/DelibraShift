# Decisions

This file is append-only. Fable uses `FAB-###`; Codex uses `COD-###`.

## COD-001 — Enforce the contract-first implementation gate

Date: 2026-07-13

`chronogym/types.py` must exist in Git history before Codex writes `step()`, a
run loop, or any adapter. SPEC scoring must additionally be committed before a
scorer or LLM adapter is written. The initial builder commit therefore contains
only repository/package scaffolding and coordination documents.

## COD-002 — Keep the core simulation dependency-free

Date: 2026-07-13

The v0 simulation will use the Python standard library and explicit immutable
state transitions. Pytest is the sole development dependency in the scaffold.
This keeps CPU-only runs small and makes deterministic behavior easier to audit.

## COD-003 — Use a repository-local builder identity

Date: 2026-07-13

The host has no Git author configured. Builder commits use the repository-local
identity `Codex Chief Builder <codex@local>` so ChronoGym commits remain clearly
attributed without modifying the user's global Git configuration.
