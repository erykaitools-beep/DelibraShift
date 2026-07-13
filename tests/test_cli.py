from __future__ import annotations

import json
from dataclasses import asdict

from chronogym.cli import main
from chronogym.demo import demo_scenario
from chronogym.types import SCHEMA_VERSION


def test_pack_cli_runs_scored_loop_and_writes_canonical_log(tmp_path, capsys) -> None:
    pack = tmp_path / "pack"
    scenarios = pack / "scenarios"
    scenarios.mkdir(parents=True)
    (scenarios / "demo.json").write_text(
        json.dumps(asdict(demo_scenario())),
        encoding="utf-8",
    )
    (pack / "pack.json").write_text(
        json.dumps(
            {
                "name": "test",
                "version": "0.1.0",
                "schema_version": SCHEMA_VERSION,
                "description": "CLI test",
                "scenarios": ["demo.json"],
            }
        ),
        encoding="utf-8",
    )
    logs = tmp_path / "logs"

    assert main([str(pack), "--agent", "greedy", "--log-dir", str(logs)]) == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["agent"] == "greedy"
    assert summary["scenario_id"] == "demo_g001"
    assert summary["prediction_fidelity"] is not None
    assert summary["parse_rate"] == 1.0
    log = logs / "demo_g001.greedy.jsonl"
    assert log.is_file()
    assert log.read_bytes().endswith(b"\n")
