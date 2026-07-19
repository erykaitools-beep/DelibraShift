from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from report import extract


ROOT = Path(__file__).resolve().parents[1]
M2 = ROOT / "results" / "m2"


def test_official_snapshot_matches_pinned_provenance() -> None:
    provenance = json.loads((M2 / "provenance.json").read_text(encoding="utf-8"))
    logs = sorted((M2 / "logs").glob("*.jsonl"))
    report_bytes = (M2 / "report.json").read_bytes()

    assert len(logs) == provenance["log_count"] == 84
    assert extract.log_set_sha256(logs) == provenance["logs_sha256"]
    assert provenance["model"] == "abacusai/dracarys-llama-3.1-70b-instruct"
    assert hashlib.sha256(report_bytes).hexdigest() == provenance["report_sha256"]
    assert provenance["data_date"] == "2026-07-19"


def test_readme_official_summary_matches_canonical_report() -> None:
    report = json.loads((M2 / "report.json").read_text(encoding="utf-8"))
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    by_arm = {summary["arm"]: summary for summary in report["summaries"]}
    labels = {
        "prediction_fidelity": "prediction fidelity",
        "prediction_coverage": "prediction coverage",
        "temporal_anticipation": "temporal anticipation",
        "outcome": "outcome",
        "action_parse_rate": "action parse rate",
        "retried_cycle_rate": "retried-cycle rate",
    }

    for metric, label in labels.items():
        line = next(line for line in readme.splitlines() if line.startswith(f"| {label} |"))
        for arm in ("end2end", "wm-scaffold"):
            values = by_arm[arm][metric]
            rendered = (
                f"{values['mean']:.3f} [{values['minimum']:.3f}, "
                f"{values['maximum']:.3f}], n={values['n']}"
            )
            assert rendered in line

    for summary in report["feedback_summaries"]:
        assert f"{summary['feedback_use']:.3f}, n={summary['n_pairs']} pairs" in readme


def test_all_official_log_manifests_share_one_run_identity() -> None:
    configs, _raw, pack = extract.load_scenarios()
    logs = sorted((M2 / "logs").glob("*.jsonl"))

    manifest = extract.validate_log_provenance(logs, configs, pack)

    assert manifest is not None
    assert manifest["host_class"] == "x86_64"
    assert manifest["pack_name"] == "core_v0"


def test_heat_swap_changed_reply_paths_but_not_harness_effective_actions() -> None:
    normal_paths = sorted(
        path
        for path in (M2 / "logs").glob("g007*.jsonl")
        if ".decoy." not in path.name
    )
    command_matches = 0
    prediction_matches = 0
    parse_path_matches = 0
    fallback_cycles = 0

    for normal_path in normal_paths:
        decoy_path = normal_path.with_name(normal_path.name.replace(".jsonl", ".decoy.jsonl"))
        normal_records = [
            json.loads(line)
            for line in normal_path.read_text(encoding="utf-8").splitlines()
            if '"type":"cycle"' in line
        ]
        decoy_records = [
            json.loads(line)
            for line in decoy_path.read_text(encoding="utf-8").splitlines()
            if '"type":"cycle"' in line
        ]
        normal_commands = [record["reply"]["action"] for record in normal_records]
        decoy_commands = [record["reply"]["action"] for record in decoy_records]
        normal_predictions = [record["reply"].get("prediction") for record in normal_records]
        decoy_predictions = [record["reply"].get("prediction") for record in decoy_records]
        normal_parse_path = [
            (
                record["reply"]["parse_failed"],
                record["reply"]["prediction_parse_failed"],
                record["reply"]["parse_retries"],
            )
            for record in normal_records
        ]
        decoy_parse_path = [
            (
                record["reply"]["parse_failed"],
                record["reply"]["prediction_parse_failed"],
                record["reply"]["parse_retries"],
            )
            for record in decoy_records
        ]
        command_matches += normal_commands == decoy_commands
        prediction_matches += normal_predictions == decoy_predictions
        parse_path_matches += normal_parse_path == decoy_parse_path
        fallback_cycles += sum(record["reply"]["parse_failed"] for record in normal_records)
        fallback_cycles += sum(record["reply"]["parse_failed"] for record in decoy_records)

    assert len(normal_paths) == 18
    assert command_matches == 18
    assert prediction_matches == 0
    assert parse_path_matches == 11
    assert fallback_cycles == 29


def test_mixed_host_snapshot_fails_closed(tmp_path: Path) -> None:
    configs, _raw, pack = extract.load_scenarios()
    original = M2 / "logs" / "g001.r0.end2end.jsonl"
    records = original.read_text(encoding="utf-8").splitlines()
    manifest = json.loads(records[0])
    manifest["host_class"] = "arm64"
    altered = tmp_path / original.name
    altered.write_text(
        json.dumps(manifest, separators=(",", ":")) + "\n" + records[-1] + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="mixed host_class"):
        extract.validate_log_provenance([original, altered], configs, pack)


def test_completed_report_rejects_incomplete_log_matrix() -> None:
    configs, _raw, pack = extract.load_scenarios()
    report = json.loads((M2 / "report.json").read_text(encoding="utf-8"))
    one_log = M2 / "logs" / "g001.r0.end2end.jsonl"
    manifest, _cycles, _summary = extract.read_log(one_log)

    with pytest.raises(ValueError, match="full planned log matrix"):
        extract.validate_completed_run_matrix([one_log], configs, report, manifest, pack)


def test_bundle_rejects_tampered_feedback_band(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    report = json.loads((M2 / "report.json").read_text(encoding="utf-8"))
    report["feedback_summaries"][0]["feedback_band"] = 999.0
    altered_report = tmp_path / "report.json"
    altered_report.write_text(json.dumps(report), encoding="utf-8")
    monkeypatch.setattr(extract, "REPORT_PATH", altered_report)
    monkeypatch.setattr(extract, "PROVENANCE_PATH", tmp_path / "no-provenance.json")

    with pytest.raises(ValueError, match="feedback_band does not match logs/scoring"):
        extract.build_bundle()


def test_report_date_comes_from_provenance_not_file_mtime(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = tmp_path / "episode.jsonl"
    log.write_text("{}\n", encoding="utf-8")
    provenance = tmp_path / "provenance.json"
    provenance.write_text('{"data_date":"2026-07-19"}\n', encoding="utf-8")
    monkeypatch.setattr(extract, "PROVENANCE_PATH", provenance)

    assert extract.newest_source_date([log]) == "2026-07-19"


def test_invalid_pinned_report_date_fails_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    provenance = tmp_path / "provenance.json"
    provenance.write_text('{"data_date":"19-07-2026"}\n', encoding="utf-8")
    monkeypatch.setattr(extract, "PROVENANCE_PATH", provenance)

    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        extract.newest_source_date([])
