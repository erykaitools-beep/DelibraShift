#!/usr/bin/env python3
"""Run one auditable first-decision screen through fresh Codex sessions."""

from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from delibrashift.adapters import CodexExecAdapter  # noqa: E402
from delibrashift.bank import load_pack, load_pack_metadata  # noqa: E402
from delibrashift.clock import advance_deliberation  # noqa: E402
from delibrashift.harness import HarnessAgent, render_prompt  # noqa: E402
from delibrashift.runner import _is_example_echo  # noqa: E402
from delibrashift.types import Prediction, SCHEMA_VERSION, prediction_fidelity  # noqa: E402
from delibrashift.world import build_observation, initial_state  # noqa: E402


DRIVER_VERSION = "0.1"


def _git_provenance() -> dict[str, object]:
    def run(*args: str) -> str:
        return subprocess.check_output(
            args,
            cwd=ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()

    try:
        revision = run("git", "rev-parse", "HEAD")
        dirty = bool(run("git", "status", "--porcelain"))
    except (OSError, subprocess.CalledProcessError):
        revision = "unknown"
        dirty = True
    return {"git_revision": revision, "source_tree_dirty": dirty}


def _position_error(prediction: Prediction, target: object) -> float:
    return math.hypot(
        prediction.pos_x_m - target.pos_x_m,
        prediction.pos_y_m - target.pos_y_m,
    )


def run_screen(
    *,
    model: str,
    reasoning_effort: str,
    repetitions: int,
    pack_path: Path,
    scenario_id: str,
    timeout_s: float,
) -> dict[str, object]:
    metadata = load_pack_metadata(pack_path)
    try:
        config = next(
            item for item in load_pack(pack_path) if item.scenario_id == scenario_id
        )
    except StopIteration as error:
        raise ValueError(f"scenario not found in pack: {scenario_id}") from error

    state = initial_state(config)
    observation = build_observation(
        config,
        state,
        episode_id=f"exploratory:codex:{scenario_id}:first-decision",
        cycle=0,
    )
    prompt = render_prompt(observation)
    window = advance_deliberation(config, state)
    if window.truncated:
        raise ValueError(f"scenario truncates before its first engage tick: {scenario_id}")
    target = window.state
    persistence = Prediction(
        state.pos_x_m,
        state.pos_y_m,
        state.vel_x_mps,
        state.vel_y_mps,
    )

    runs: list[dict[str, object]] = []
    for repetition in range(repetitions):
        adapter = CodexExecAdapter(
            model,
            reasoning_effort=reasoning_effort,
            timeout_s=timeout_s,
        )
        agent = HarnessAgent(
            adapter,
            repetition=repetition,
            max_parse_retries=0,
            max_transport_retries=0,
        )
        reply = agent.act(observation)
        raw = agent.last_raw_completion
        prediction = reply.prediction
        runs.append(
            {
                "repetition": repetition,
                "wall_clock_s_telemetry_only": agent.last_wall_clock_ms / 1000.0,
                "action_parse_ok": not reply.parse_failed,
                "prediction_parse_ok": not reply.prediction_parse_failed,
                "example_echo": _is_example_echo(reply),
                "action": asdict(reply.action),
                "prediction": None if prediction is None else asdict(prediction),
                "cycle0_raw_fidelity": (
                    None if prediction is None else prediction_fidelity(prediction, target)
                ),
                "position_error_m": (
                    None if prediction is None else _position_error(prediction, target)
                ),
                "raw_content": raw,
                "raw_content_sha256": (
                    None
                    if raw is None
                    else hashlib.sha256(raw.encode("utf-8")).hexdigest()
                ),
                "codex_response_metadata": adapter.last_response_metadata,
            }
        )

    thread_ids = [
        run["codex_response_metadata"].get("thread_id")
        for run in runs
        if isinstance(run["codex_response_metadata"], dict)
    ]
    driver_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    return {
        "schema_version": "exploratory-codex-first-decision-0.1",
        "data_date_utc": datetime.now(timezone.utc).date().isoformat(),
        "official_snapshot": False,
        "evidence_status": "exploratory_codex_product_condition",
        "driver": {
            "version": DRIVER_VERSION,
            "sha256": driver_sha256,
            **_git_provenance(),
        },
        "method": {
            "pack_name": metadata["name"],
            "pack_version": metadata["version"],
            "log_schema_version": SCHEMA_VERSION,
            "scenario_id": scenario_id,
            "cycle": 0,
            "arm": "end2end",
            "prompt_version": "1.0",
            "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "requested_temperature": 0.0,
            "requested_seeds": list(range(repetitions)),
            "requested_max_tokens": 512,
            "unsupported_cli_controls": ["temperature", "seed", "max_tokens"],
            "max_parse_retries": 0,
            "max_transport_retries": 0,
            "fresh_ephemeral_session_per_completion": True,
            "saved_chatgpt_login_required": True,
            "platform_api_credentials_removed": True,
            "model": model,
            "reasoning_effort": reasoning_effort,
            "timeout_s": timeout_s,
        },
        "session_audit": {
            "thread_ids": thread_ids,
            "all_thread_ids_present": all(thread_ids),
            "thread_ids_unique": len(set(thread_ids)) == len(thread_ids),
        },
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "wall_clock_caveat": (
                "Wall time is telemetry only. Calls consume the existing ChatGPT/Codex "
                "plan allowance but use no Platform API key."
            ),
        },
        "target_at_engage": {
            "tick": target.tick,
            "pos_x_m": target.pos_x_m,
            "pos_y_m": target.pos_y_m,
            "vel_x_mps": target.vel_x_mps,
            "vel_y_mps": target.vel_y_mps,
        },
        "persistence_floor": {
            "cycle0_raw_fidelity": prediction_fidelity(persistence, target),
            "position_error_m": _position_error(persistence, target),
        },
        "runs": runs,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="gpt-5.6-sol")
    parser.add_argument("--reasoning-effort", default="medium")
    parser.add_argument("--repetitions", type=int, default=1)
    parser.add_argument("--scenario", default="g001")
    parser.add_argument("--pack", type=Path, default=ROOT / "packs" / "core_v0")
    parser.add_argument("--timeout-s", type=float, default=300.0)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "results" / "exploratory" / "codex_first_decision.json",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="required acknowledgement: this consumes ChatGPT/Codex plan usage",
    )
    args = parser.parse_args(argv)
    if not args.execute:
        parser.error("refusing Codex calls without --execute")
    if args.repetitions < 1:
        parser.error("--repetitions must be positive")
    payload = run_screen(
        model=args.model,
        reasoning_effort=args.reasoning_effort,
        repetitions=args.repetitions,
        pack_path=args.pack,
        scenario_id=args.scenario,
        timeout_s=args.timeout_s,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
