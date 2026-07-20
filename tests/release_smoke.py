"""Black-box release smoke test for an installed DelibraShift wheel."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile


CORE_ARCHIVE_SHA256 = (
    "06916079638966d3803ce3cda500b3542c1d703604b99453f3365fec5f93a1c8"
)
EXPECTED_COMMANDS = {
    "delibrashift-ablate",
    "delibrashift-demo",
    "delibrashift-gates",
    "delibrashift-lab",
    "delibrashift-pack",
    "delibrashift-run",
}
EXPECTED_GATE_IV = {
    "greedy_outcome": 0.335798232990836,
    "greedy_temporal": 0.47066702870069027,
    "k2_left": -0.02933297129930973,
    "k2_right": 0.06966998272395653,
    "oracle_outcome": 0.980723744495277,
    "oracle_temporal": 0.639339965447913,
    "outcome_distance": 0.7228434005660153,
    "pack_valid": True,
    "passed": True,
    "random_outcome": 0.08851733989998208,
    "validity_v1": 0.8922064045952949,
    "validity_v2": 0.13933996544791305,
}


def _run(
    command: list[str],
    *,
    cwd: Path,
    expected_code: int = 0,
    timeout_s: float = 60.0,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    for name in (
        "NIM_BASE_URL",
        "NIM_MODEL",
        "NVIDIA_API_KEY",
        "OLLAMA_BASE_URL",
        "OLLAMA_MODEL",
        "PYTHONPATH",
    ):
        environment.pop(name, None)
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=environment,
        text=True,
        capture_output=True,
        timeout=timeout_s,
        check=False,
    )
    if completed.returncode != expected_code:
        raise AssertionError(
            f"command returned {completed.returncode}, expected {expected_code}: "
            f"{command!r}\nstdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
        )
    return completed


def _assert_wheel_contents(wheel: Path) -> None:
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
    assert any(name == "delibrashift/__init__.py" for name in names)
    assert any(name == "delibrashift/desktop_assets/index.html" for name in names)
    assert not any(
        name.startswith(("chronogym/", "packs/", "results/", "tests/"))
        for name in names
    )
    top_levels = {name.split("/", 1)[0] for name in names}
    assert len(top_levels) == 2
    assert "delibrashift" in top_levels
    assert any(name.startswith("delibrashift-0.1.0.dist-info") for name in top_levels)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--venv", type=Path, required=True)
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()

    venv = args.venv.resolve()
    wheel = args.wheel.resolve()
    workspace = args.workspace.resolve()
    bin_dir = venv / "bin"
    python = bin_dir / "python"
    pack = workspace / "packs" / "core_v0"
    _assert_wheel_contents(wheel)

    with tempfile.TemporaryDirectory(prefix="delibrashift-release-") as raw_temp:
        temp = Path(raw_temp)
        installed = _run(
            [
                str(python),
                "-c",
                (
                    "import importlib.metadata as m, json, pathlib, delibrashift; "
                    "d=m.distribution('delibrashift'); "
                    "print(json.dumps({'file':str(pathlib.Path(delibrashift.__file__).resolve()),"
                    "'scripts':sorted(e.name for e in d.entry_points if e.group=='console_scripts')}))"
                ),
            ],
            cwd=temp,
        )
        metadata = json.loads(installed.stdout)
        assert str(venv) in metadata["file"]
        assert set(metadata["scripts"]) == EXPECTED_COMMANDS

        demo_log = temp / "demo.jsonl"
        demo = _run(
            [str(bin_dir / "delibrashift-demo"), "--agent", "noop", "--log", str(demo_log)],
            cwd=temp,
        )
        assert json.loads(demo.stdout)["agent"] == "noop"
        assert demo_log.read_bytes().endswith(b"\n")

        run_logs = temp / "run-logs"
        baseline = _run(
            [
                str(bin_dir / "delibrashift-run"),
                str(pack),
                "--agent",
                "noop",
                "--log-dir",
                str(run_logs),
            ],
            cwd=temp,
        )
        summaries = [json.loads(line) for line in baseline.stdout.splitlines()]
        manifest = json.loads((pack / "pack.json").read_text(encoding="utf-8"))
        assert len(summaries) == len(manifest["scenarios"])
        assert all(summary["agent"] == "noop" for summary in summaries)
        assert len(tuple(run_logs.glob("*.jsonl"))) == len(summaries)

        pack_output = _run(
            [
                str(bin_dir / "delibrashift-pack"),
                str(pack),
                "--output-dir",
                str(temp / "dist"),
            ],
            cwd=temp,
        )
        archive = json.loads(pack_output.stdout)
        assert archive["sha256"] == CORE_ARCHIVE_SHA256
        assert Path(archive["archive"]).is_file()
        assert Path(archive["manifest"]).is_file()

        gates = _run(
            [str(bin_dir / "delibrashift-gates"), str(pack)],
            cwd=temp,
            timeout_s=300.0,
        )
        gate_payload = json.loads(gates.stdout)
        assert gate_payload["gate_iv"] == EXPECTED_GATE_IV

        refused = _run(
            [str(bin_dir / "delibrashift-ablate"), str(pack)],
            cwd=temp,
            expected_code=2,
        )
        assert "refusing external calls without --execute" in refused.stderr

    print("installed-wheel release smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
