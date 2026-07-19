from __future__ import annotations

from pathlib import Path

from delibrashift.bank import load_pack
from delibrashift.gates import matched_state_gate, reproducibility_gate


PACK = load_pack(Path(__file__).parents[1] / "packs" / "core_v0")


def test_gate_i_full_pack_random_run_is_byte_reproducible() -> None:
    gate = reproducibility_gate(PACK)
    assert gate.passed
    assert gate.first_sha256 == gate.second_sha256


def test_gate_ii_matched_state_probe_has_six_states_and_required_drops() -> None:
    sweep_ids = {"g001_b10", "g001", "g001_b40"}
    gate = matched_state_gate(
        config for config in PACK if config.scenario_id in sweep_ids
    )
    assert gate.passed
    assert gate.admissible_states == 6
    assert gate.budgets == (10, 20, 40)
    assert gate.scores == (
        0.45499315138148017,
        0.4331712122380791,
        0.37486024858353895,
    )
