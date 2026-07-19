#!/usr/bin/env python3
"""Run an auditable, exploratory first-decision screen through local Ollama."""

from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from delibrashift.adapters import OllamaAdapter  # noqa: E402
from delibrashift.bank import load_pack, load_pack_metadata  # noqa: E402
from delibrashift.clock import advance_deliberation  # noqa: E402
from delibrashift.harness import HarnessAgent, render_prompt  # noqa: E402
from delibrashift.runner import _is_example_echo  # noqa: E402
from delibrashift.types import (  # noqa: E402
    Prediction,
    SCHEMA_VERSION,
    prediction_fidelity,
)
from delibrashift.world import build_observation, initial_state  # noqa: E402


DRIVER_VERSION = "0.2"
DEFAULT_MODELS = ("qwen2.5:3b", "gemma3:4b")


def _read_api_json(url: str, timeout_s: float) -> dict[str, object]:
    with urllib.request.urlopen(url, timeout=timeout_s) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise RuntimeError(f"Ollama returned a non-object from {url}")
    return payload


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


def _ram_bytes() -> int | None:
    try:
        first = Path("/proc/meminfo").read_text(encoding="utf-8").splitlines()[0]
        return int(first.split()[1]) * 1024
    except (OSError, IndexError, ValueError):
        return None


def _position_error(prediction: Prediction, target: object) -> float:
    return math.hypot(
        prediction.pos_x_m - target.pos_x_m,
        prediction.pos_y_m - target.pos_y_m,
    )


def run_screen(
    *,
    models: list[str],
    repetitions: int,
    pack_path: Path,
    scenario_id: str,
    base_url: str,
    think: bool,
    timeout_s: float,
    dedicated_server: bool,
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
        episode_id=f"exploratory:{scenario_id}:first-decision",
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

    version_payload = _read_api_json(f"{base_url}/api/version", timeout_s)
    tags_payload = _read_api_json(f"{base_url}/api/tags", timeout_s)
    inventory = {
        item["name"]: item
        for item in tags_payload.get("models", [])
        if isinstance(item, dict) and isinstance(item.get("name"), str)
    }
    missing = [model for model in models if model not in inventory]
    if missing:
        raise ValueError(f"models missing from local Ollama: {', '.join(missing)}")

    model_records: list[dict[str, object]] = []
    for model in models:
        model_info = inventory[model]
        runs: list[dict[str, object]] = []
        for seed in range(repetitions):
            adapter = OllamaAdapter(
                model,
                base_url=base_url,
                think=think,
                timeout_s=timeout_s,
            )
            agent = HarnessAgent(
                adapter,
                repetition=seed,
                max_parse_retries=0,
                max_transport_retries=0,
            )
            reply = agent.act(observation)
            raw = agent.last_raw_completion
            prediction = reply.prediction
            runs.append(
                {
                    "seed": seed,
                    "wall_clock_s_telemetry_only": agent.last_wall_clock_ms / 1000.0,
                    "action_parse_ok": not reply.parse_failed,
                    "prediction_parse_ok": not reply.prediction_parse_failed,
                    "example_echo": _is_example_echo(reply),
                    "action": asdict(reply.action),
                    "prediction": None if prediction is None else asdict(prediction),
                    "cycle0_raw_fidelity": (
                        None
                        if prediction is None
                        else prediction_fidelity(prediction, target)
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
                    "ollama_response_metadata": adapter.last_response_metadata,
                }
            )
        model_records.append(
            {
                "model": model,
                "ollama_manifest_digest_sha256": model_info.get("digest"),
                "details": model_info.get("details"),
                "runs": runs,
            }
        )

    driver_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    return {
        "schema_version": "exploratory-first-decision-0.2",
        "data_date_utc": datetime.now(timezone.utc).date().isoformat(),
        "official_snapshot": False,
        "evidence_status": "auditable_exploratory_screen",
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
            "temperature": 0.0,
            "seeds": list(range(repetitions)),
            "max_tokens": 512,
            "max_parse_retries": 0,
            "max_transport_retries": 0,
            "ollama_think": think,
            "timeout_s": timeout_s,
            "ollama_base_url": base_url,
            "dedicated_server_process": dedicated_server,
        },
        "host": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "logical_cpus": os.cpu_count(),
            "ram_bytes": _ram_bytes(),
            "ollama_version": version_payload.get("version"),
            "wall_clock_caveat": (
                "Dedicated Ollama server process on a shared CPU-only host; timings "
                "are telemetry only and are not comparable model scores."
                if dedicated_server
                else "Shared CPU-only host and Ollama service; timings are telemetry "
                "only and are not comparable model scores."
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
        "metric_definitions": {
            "cycle0_raw_fidelity": (
                "exp(-mean normalized L1 error across x, y, vx, vy) for this "
                "single prediction; not the episode-level metric"
            ),
            "position_error_m": "Euclidean distance in the x-y plane at engage tick",
            "example_echo": (
                "True when every predicted state field is within two registered "
                "tolerances of the numeric example embedded in the prompt"
            ),
        },
        "models": model_records,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", action="append", dest="models")
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--scenario", default="g001")
    parser.add_argument("--pack", type=Path, default=ROOT / "packs" / "core_v0")
    parser.add_argument("--base-url", default="http://localhost:11434")
    parser.add_argument("--timeout-s", type=float, default=900.0)
    parser.add_argument("--think", action="store_true")
    parser.add_argument(
        "--dedicated-server",
        action="store_true",
        help="record that the selected Ollama endpoint is dedicated to this run",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="required acknowledgement: this performs local model inference",
    )
    args = parser.parse_args(argv)
    if not args.execute:
        parser.error("refusing model calls without --execute")
    if args.repetitions < 1:
        parser.error("--repetitions must be positive")
    payload = run_screen(
        models=args.models or list(DEFAULT_MODELS),
        repetitions=args.repetitions,
        pack_path=args.pack,
        scenario_id=args.scenario,
        base_url=args.base_url.rstrip("/"),
        think=args.think,
        timeout_s=args.timeout_s,
        dedicated_server=args.dedicated_server,
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
