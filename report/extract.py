"""Build the DelibraShift visualization bundle from canonical M2 logs.

The bundle is a single JSON object (``data/bundle.json``) that fully describes
the M2 matched-pair experiment: scenario definitions, per-episode replayed
trajectories, per-cycle prediction/latch bookkeeping, and every score that can
be recomputed offline from the logs alone.

Design rules
------------
* Physics is never reimplemented here. The tick-by-tick trajectory is replayed
  by importing ``delibrashift.world.step`` and driving it with the held action
  recorded in each cycle's observation, exactly like ``delibrashift.runner``.
* Every score comes from a real call into ``delibrashift.scoring`` /
  ``delibrashift.types`` on rebuilt ``CycleRecord`` / ``EpisodeResult`` objects.
  A metric that cannot be rebuilt from the logs is emitted as ``null`` and the
  reason is recorded in ``meta.source_note`` -- numbers are never invented.
* A hard correctness gate compares the replayed final state against the
  ``final_state`` written by the runner in each log's summary line.  The gate
  must pass for every episode or the bundle is not written.

The canonical pack and M2 logs are read from the repository; generated bundle
data is written only below ``report/data``.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from delibrashift.agents import GreedyAgent
from delibrashift.gates import score_feedback_use
from delibrashift.oracle import state_from_observation  # noqa: F401  (contract check)
from delibrashift.probes import score_forced_choice_probe, score_format_probe
from delibrashift.runner import CycleRecord, EpisodeResult
from delibrashift.scoring import (
    score_outcome,
    score_prediction_fidelity,
    score_temporal_anticipation,
)
from delibrashift.types import (
    FEEDBACK_MIN_BAND,
    FIDELITY_MIN_COVERAGE,
    FIDELITY_MIN_CYCLES,
    HEAT_SCALE_M,
    PRED_POS_TOL_M,
    PRED_VEL_TOL_MPS,
    Action,
    AgentReply,
    GroundTruthState,
    Observation,
    Prediction,
    ScenarioConfig,
    prediction_fidelity,
    wind_x_at,
)
from delibrashift.world import initial_state, step

# --------------------------------------------------------------------------
# Paths and constants
# --------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
LOGS_DIR = PROJECT_ROOT / "results" / "m2" / "logs"
PACKS_DIR = PROJECT_ROOT / "packs" / "core_v0"
REPORT_PATH = PROJECT_ROOT / "results" / "m2" / "report.json"
PROVENANCE_PATH = PROJECT_ROOT / "results" / "m2" / "provenance.json"
OUT_PATH = ROOT / "data" / "bundle.json"


def source_label(path: Path) -> str:
    """Return portable provenance without embedding a builder's home path."""
    resolved = path.expanduser().resolve()
    try:
        return resolved.relative_to(PROJECT_ROOT.resolve()).as_posix()
    except ValueError:
        return f"external/{resolved.name}"

#: Absolute tolerance of the replay correctness gate (position and velocity).
GATE_TOL = 1e-9

#: Repetitions the M2 run plan schedules per scenario and arm. Stated once here
#: so the footer can report "present of planned" instead of burying it in prose.
REPETITIONS_EXPECTED = 3

#: Deterministic reference points published in README.md; not LLM results.
BASELINES = {
    "random": {"outcome": 0.0885, "temporal": None},
    "greedy": {"outcome": 0.3358, "temporal": 0.4707},
    "oracle": {"outcome": 0.9807, "temporal": 0.6393},
}

ARM_NAMES = ("end2end", "wm-scaffold")

ARM_METRICS = (
    "prediction_fidelity",
    "prediction_coverage",
    "persistence_floor_fidelity",
    "temporal_anticipation",
    "mean_divergence_weight",
    "temporal_n_scored_cycles",
    "fidelity_no_retry",
    "fidelity_no_retry_n_valid_cycles",
    "temporal_no_retry",
    "temporal_no_retry_mean_divergence_weight",
    "temporal_no_retry_n_scored_cycles",
    "outcome",
    "action_parse_rate",
    "prediction_parse_rate",
    "retried_cycle_rate",
    "wall_clock_ms",
)

# ``MatchedPairReport`` uses the telemetry field's full dataclass name while
# the visualization bundle keeps the shorter public key.  Every other report
# metric has the same name in both representations.
REPORT_ARM_METRICS = {
    "prediction_fidelity": "prediction_fidelity",
    "prediction_coverage": "prediction_coverage",
    "temporal_anticipation": "temporal_anticipation",
    "outcome": "outcome",
    "action_parse_rate": "action_parse_rate",
    "prediction_parse_rate": "prediction_parse_rate",
    "retried_cycle_rate": "retried_cycle_rate",
    "mean_divergence_weight": "mean_divergence_weight",
    "fidelity_no_retry": "fidelity_no_retry",
    "temporal_no_retry": "temporal_no_retry",
    "wall_clock_ms_telemetry_only": "wall_clock_ms",
}

#: Size ceiling above which trajectory precision is reduced (bytes).
SIZE_LIMIT_BYTES = 25 * 1024 * 1024


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def rnd(value: Any, places: int = 4) -> Any:
    """Round a float to ``places`` decimals, mapping -0.0 to 0.0.

    ``None`` passes through untouched so that "not measurable" never becomes
    a number.  Non-float values (ints, bools, strings) pass through as well.
    """
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    if isinstance(value, int):
        return value
    result = round(float(value), places)
    return 0.0 if result == 0.0 else result


def rnd_list(values: Iterable[float], places: int = 4) -> list[float]:
    return [rnd(value, places) for value in values]


def mean_or_none(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def metric_range(values: Iterable[float | None]) -> dict[str, Any]:
    """Mean/min/max over measured values only (mirrors experiments._range)."""
    measured = [value for value in values if value is not None]
    return {
        "mean": mean_or_none(measured),
        "min": min(measured) if measured else None,
        "max": max(measured) if measured else None,
        "n": len(measured),
    }


# --------------------------------------------------------------------------
# Loading: pack, logs
# --------------------------------------------------------------------------


def load_scenarios() -> tuple[dict[str, ScenarioConfig], dict[str, dict], dict]:
    """Load pack metadata and every scenario config in pack order."""
    pack = json.loads((PACKS_DIR / "pack.json").read_text(encoding="utf-8"))
    configs: dict[str, ScenarioConfig] = {}
    raw: dict[str, dict] = {}
    for filename in pack["scenarios"]:
        payload = json.loads(
            (PACKS_DIR / "scenarios" / filename).read_text(encoding="utf-8")
        )
        config = ScenarioConfig.from_json_dict(payload)
        configs[config.scenario_id] = config
        raw[config.scenario_id] = payload
    return configs, raw, pack


def parse_log_name(path: Path) -> tuple[str, int, str, str, str]:
    """Split ``<scenario>.r<rep>.<arm>[.decoy|.control].jsonl`` into parts.

    Returns ``(scenario_id, repetition, arm, variant, key)``.
    """
    parts = path.name[: -len(".jsonl")].split(".")
    if len(parts) not in (3, 4):
        raise ValueError(f"unexpected log filename: {path.name}")
    scenario_id, rep_token, arm = parts[0], parts[1], parts[2]
    if not rep_token.startswith("r"):
        raise ValueError(f"unexpected repetition token in {path.name}")
    repetition = int(rep_token[1:])
    suffix = parts[3] if len(parts) == 4 else None
    if suffix is None:
        variant = "control" if arm == "control" else "normal"
    elif suffix in ("decoy", "control"):
        variant = suffix
    else:
        raise ValueError(f"unexpected variant suffix in {path.name}")
    return scenario_id, repetition, arm, variant, path.name[: -len(".jsonl")]


def read_log(path: Path) -> tuple[dict, list[dict], dict]:
    """Return ``(manifest, cycle_lines, summary)`` for one episode log."""
    manifest: dict | None = None
    summary: dict | None = None
    cycles: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        kind = record.get("type")
        if kind == "manifest":
            manifest = record
        elif kind == "cycle":
            cycles.append(record)
        elif kind == "summary":
            summary = record
        else:
            raise ValueError(f"{path.name}: unknown line type {kind!r}")
    if manifest is None:
        raise ValueError(f"{path.name}: missing manifest line")
    if summary is None:
        raise ValueError(f"{path.name}: truncated log (no summary line)")
    return manifest, cycles, summary


def validate_log_provenance(
    log_paths: list[Path], configs: dict[str, ScenarioConfig], pack: dict
) -> dict | None:
    """Fail closed when the snapshot mixes incompatible run identities."""
    sample: dict | None = None
    common: dict[str, set[Any]] = {
        "host_class": set(),
        "pack_name": set(),
        "pack_version": set(),
        "schema_version": set(),
        "agent_base": set(),
    }
    probe_ids = [
        scenario_id
        for scenario_id, config in configs.items()
        if any(tag.startswith("probe:") for tag in config.axis_tags)
    ]
    treatment_ids = [scenario_id for scenario_id in configs if scenario_id not in probe_ids]
    prompt_by_arm = {"end2end": "1.0", "wm-scaffold": "wm-scaffold-1.0"}

    for path in log_paths:
        manifest, _cycles, _summary = read_log(path)
        scenario_id, _rep, arm, _variant, _key = parse_log_name(path)
        if sample is None:
            sample = manifest
        expected_prompt = prompt_by_arm.get(arm)
        if arm == "control":
            expected_prompt = {
                "g008": "probe-format-1.0",
                "g009": "probe-choice-1.0",
            }.get(scenario_id)
        expected = {
            "scenario_id": scenario_id,
            "seed": configs[scenario_id].seed,
            "pack_name": pack.get("name"),
            "pack_version": pack.get("version"),
            "schema_version": pack.get("schema_version"),
            "prompt_version": expected_prompt,
            "scenario_ids": probe_ids if arm == "control" else treatment_ids,
        }
        for field, value in expected.items():
            if manifest.get(field) != value:
                raise ValueError(
                    f"{path.name}: manifest {field} {manifest.get(field)!r} "
                    f"!= expected {value!r}"
                )
        agent = manifest.get("agent", "")
        if not agent.endswith(f":{arm}"):
            raise ValueError(f"{path.name}: agent identity does not match arm {arm!r}")
        for field in ("host_class", "pack_name", "pack_version", "schema_version"):
            common[field].add(manifest.get(field))
        common["agent_base"].add(agent.rsplit(":", 1)[0])

    for field, values in common.items():
        if len(values) > 1:
            raise ValueError(f"mixed {field} values in snapshot: {sorted(values)!r}")
    return sample


def log_set_sha256(log_paths: list[Path]) -> str:
    """Hash names and bytes of an ordered log set without path dependence."""
    digest = hashlib.sha256()
    for path in sorted(log_paths, key=lambda item: item.name):
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def validate_snapshot_provenance(log_paths: list[Path], manifest: dict | None) -> None:
    """Verify the tracked official snapshot identity when metadata is present."""
    if not PROVENANCE_PATH.exists():
        return
    payload = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))
    required = {"log_count", "logs_sha256", "model", "agent_base", "report_sha256"}
    missing = sorted(required - payload.keys())
    if missing:
        raise ValueError(f"snapshot provenance missing fields: {missing}")
    if payload["log_count"] != len(log_paths):
        raise ValueError("snapshot provenance log_count mismatch")
    if payload["logs_sha256"] != log_set_sha256(log_paths):
        raise ValueError("snapshot provenance logs_sha256 mismatch")
    agent = manifest.get("agent", "") if manifest else ""
    agent_base = agent.rsplit(":", 1)[0] if agent else ""
    model = agent_base.split(":", 1)[1] if ":" in agent_base else ""
    if payload["agent_base"] != agent_base or payload["model"] != model:
        raise ValueError("snapshot provenance model identity mismatch")
    if REPORT_PATH.exists():
        report_digest = hashlib.sha256(REPORT_PATH.read_bytes()).hexdigest()
        if payload["report_sha256"] != report_digest:
            raise ValueError("snapshot provenance report_sha256 mismatch")


def validate_completed_run_matrix(
    log_paths: list[Path],
    configs: dict[str, ScenarioConfig],
    report: dict | None,
    manifest: dict | None,
    pack: dict,
) -> None:
    """A closing report is valid only for the complete planned log matrix."""
    if report is None:
        return
    probe_ids = {
        scenario_id
        for scenario_id, config in configs.items()
        if any(tag.startswith("probe:") for tag in config.axis_tags)
    }
    expected: set[str] = set()
    for scenario_id, config in configs.items():
        for repetition in range(REPETITIONS_EXPECTED):
            if scenario_id in probe_ids:
                expected.add(f"{scenario_id}.r{repetition}.control.jsonl")
                continue
            for arm in ARM_NAMES:
                expected.add(f"{scenario_id}.r{repetition}.{arm}.jsonl")
                if not config.goal_visible:
                    expected.add(f"{scenario_id}.r{repetition}.{arm}.decoy.jsonl")
    actual = {path.name for path in log_paths}
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise ValueError(
            "completed report requires the full planned log matrix; "
            f"missing={missing}, extra={extra}"
        )
    agent = manifest.get("agent", "") if manifest else ""
    agent_base = agent.rsplit(":", 1)[0] if agent else ""
    expected_report = {
        "adapter_name": agent_base,
        "pack_name": pack.get("name"),
        "pack_version": pack.get("version"),
        "repetitions": REPETITIONS_EXPECTED,
    }
    for field, value in expected_report.items():
        if report.get(field) != value:
            raise ValueError(
                f"completed report {field} {report.get(field)!r} != logs {value!r}"
            )


# --------------------------------------------------------------------------
# Rebuilding typed contract objects from log dicts
# --------------------------------------------------------------------------


def rebuild_observation(payload: dict) -> Observation:
    data = dict(payload)
    data["wind_forecast_x_mps2"] = tuple(data["wind_forecast_x_mps2"])
    return Observation(**data)


def rebuild_reply(payload: dict) -> AgentReply:
    prediction = payload.get("prediction")
    return AgentReply(
        action=Action(**payload["action"]),
        prediction=None if prediction is None else Prediction(**prediction),
        parse_failed=bool(payload.get("parse_failed", False)),
        parse_retries=int(payload.get("parse_retries", 0)),
        prediction_parse_failed=bool(payload.get("prediction_parse_failed", False)),
        choice=payload.get("choice"),
    )


def rebuild_state(payload: dict | None) -> GroundTruthState | None:
    return None if payload is None else GroundTruthState(**payload)


def rebuild_cycle_record(payload: dict) -> CycleRecord:
    engaged = payload.get("engaged_action")
    return CycleRecord(
        episode_id=payload["episode_id"],
        cycle=payload["cycle"],
        tick=payload["tick"],
        engage_tick=payload["engage_tick"],
        observation=rebuild_observation(payload["observation"]),
        reply=rebuild_reply(payload["reply"]),
        prediction_target=rebuild_state(payload.get("prediction_target")),
        ticks_elapsed=payload["ticks_elapsed"],
        truncated=payload["truncated"],
        prediction_requested=payload["prediction_requested"],
        action_engaged=payload["action_engaged"],
        engaged_action=None if engaged is None else Action(**engaged),
        example_echo=payload.get("example_echo", False),
        probe_match=payload.get("probe_match"),
        raw_completion_text=payload.get("raw_completion_text"),
        raw_completions=tuple(payload.get("raw_completions") or ()),
        wall_clock_ms_telemetry_only=payload.get("wall_clock_ms_telemetry_only", 0.0),
    )


# --------------------------------------------------------------------------
# Trajectory replay (the correctness-critical part)
# --------------------------------------------------------------------------


class ReplayMismatch(Exception):
    """Raised when the replayed trajectory diverges from the logged run."""


def replay_episode(
    config: ScenarioConfig,
    records: list[CycleRecord],
) -> tuple[dict[str, list[float]], GroundTruthState]:
    """Replay the episode tick by tick and return (trajectory, final state).

    Mirrors ``delibrashift.runner.run_episode``: for each decision cycle the world
    advances ``ticks_elapsed`` ticks under the action already latched in the
    state (the one reported as ``held_accel_*`` in that cycle's observation),
    and only then -- if the window did not end the episode -- the returned
    action is latched as the new held action.  The latch value is taken
    verbatim from the log's ``engaged_action``, which the runner recorded after
    clamping, so the replay is bit-exact rather than merely close.
    """
    state = initial_state(config)
    traj_t = [state.tick]
    traj_x = [state.pos_x_m]
    traj_y = [state.pos_y_m]
    traj_vx = [state.vel_x_mps]
    traj_vy = [state.vel_y_mps]
    traj_wind = [state.wind_x_mps2]
    traj_heat = [state.heat]
    traj_dist = [state.distance_to_goal_m]

    for record in records:
        observation = record.observation
        if state.tick != record.tick:
            raise ReplayMismatch(
                f"cycle {record.cycle}: replay tick {state.tick} != logged {record.tick}"
            )
        for name, replayed, logged in (
            ("pos_x_m", state.pos_x_m, observation.pos_x_m),
            ("pos_y_m", state.pos_y_m, observation.pos_y_m),
            ("vel_x_mps", state.vel_x_mps, observation.vel_x_mps),
            ("vel_y_mps", state.vel_y_mps, observation.vel_y_mps),
            ("held_accel_x_mps2", state.held_accel_x_mps2, observation.held_accel_x_mps2),
            ("held_accel_y_mps2", state.held_accel_y_mps2, observation.held_accel_y_mps2),
        ):
            if abs(replayed - logged) > GATE_TOL:
                raise ReplayMismatch(
                    f"cycle {record.cycle}: {name} replay {replayed!r} != observed {logged!r}"
                )

        for _ in range(record.ticks_elapsed):
            if state.done:
                break
            state = step(config, state)
            traj_t.append(state.tick)
            traj_x.append(state.pos_x_m)
            traj_y.append(state.pos_y_m)
            traj_vx.append(state.vel_x_mps)
            traj_vy.append(state.vel_y_mps)
            traj_wind.append(state.wind_x_mps2)
            traj_heat.append(state.heat)
            traj_dist.append(state.distance_to_goal_m)

        if record.prediction_target is not None:
            target = record.prediction_target
            for name, replayed, logged in (
                ("tick", float(state.tick), float(target.tick)),
                ("pos_x_m", state.pos_x_m, target.pos_x_m),
                ("pos_y_m", state.pos_y_m, target.pos_y_m),
                ("vel_x_mps", state.vel_x_mps, target.vel_x_mps),
                ("vel_y_mps", state.vel_y_mps, target.vel_y_mps),
            ):
                if abs(replayed - logged) > GATE_TOL:
                    raise ReplayMismatch(
                        f"cycle {record.cycle}: engage-state {name} "
                        f"replay {replayed!r} != prediction_target {logged!r}"
                    )

        if record.action_engaged:
            if record.engaged_action is None:
                raise ReplayMismatch(f"cycle {record.cycle}: engaged action missing")
            state = replace(
                state,
                held_accel_x_mps2=record.engaged_action.accel_x_mps2,
                held_accel_y_mps2=record.engaged_action.accel_y_mps2,
            )

    trajectory = {
        "t": traj_t,
        "x": traj_x,
        "y": traj_y,
        "vx": traj_vx,
        "vy": traj_vy,
        "wind": traj_wind,
        "heat": traj_heat,
        "dist": traj_dist,
    }
    return trajectory, state


def check_gate(
    replayed: GroundTruthState,
    summary: dict,
    trajectory: dict[str, list[float]],
) -> tuple[bool, str]:
    """Compare the replayed end state with the runner's logged final state."""
    logged = summary["final_state"]
    if replayed.tick != logged["tick"]:
        return False, f"tick {replayed.tick} != {logged['tick']}"
    worst = 0.0
    worst_field = ""
    for field, value in (
        ("pos_x_m", replayed.pos_x_m),
        ("pos_y_m", replayed.pos_y_m),
        ("vel_x_mps", replayed.vel_x_mps),
        ("vel_y_mps", replayed.vel_y_mps),
    ):
        delta = abs(value - logged[field])
        if delta > worst:
            worst, worst_field = delta, field
    if worst > GATE_TOL:
        return False, f"{worst_field} delta {worst:.3e}"
    closest_replayed = min(trajectory["dist"])
    closest_logged = summary["closest_approach_m"]
    if abs(closest_replayed - closest_logged) > GATE_TOL:
        return False, f"closest_approach delta {abs(closest_replayed - closest_logged):.3e}"
    detail = f"max|delta|={worst:.1e}" if worst else "exact"
    return True, detail


# --------------------------------------------------------------------------
# Per-episode assembly
# --------------------------------------------------------------------------


def cycle_payload(record: CycleRecord) -> dict[str, Any]:
    """Serialize one decision cycle, including its own prediction verdict."""
    observation = record.observation
    prediction = record.reply.prediction
    target = record.prediction_target

    predicted = (
        None
        if prediction is None
        else {
            "x": rnd(prediction.pos_x_m),
            "y": rnd(prediction.pos_y_m),
            "vx": rnd(prediction.vel_x_mps),
            "vy": rnd(prediction.vel_y_mps),
        }
    )
    truth = (
        None
        if target is None
        else {
            "x": rnd(target.pos_x_m),
            "y": rnd(target.pos_y_m),
            "vx": rnd(target.vel_x_mps),
            "vy": rnd(target.vel_y_mps),
            "heat": rnd(target.heat),
            "dist": rnd(target.distance_to_goal_m),
        }
    )

    pos_error = None
    fidelity = None
    persistence = None
    scored = (
        prediction is not None
        and target is not None
        and not record.truncated
        and record.prediction_requested
        and not record.reply.prediction_parse_failed
    )
    if scored:
        pos_error = math.hypot(
            prediction.pos_x_m - target.pos_x_m,
            prediction.pos_y_m - target.pos_y_m,
        )
        fidelity = prediction_fidelity(prediction, target)
        persistence = prediction_fidelity(
            Prediction(
                pos_x_m=observation.pos_x_m,
                pos_y_m=observation.pos_y_m,
                vel_x_mps=observation.vel_x_mps,
                vel_y_mps=observation.vel_y_mps,
            ),
            target,
        )

    return {
        "cycle": record.cycle,
        "tick": record.tick,
        "engage_tick": record.engage_tick,
        "ticks_elapsed": record.ticks_elapsed,
        "truncated": bool(record.truncated),
        "action_engaged": bool(record.action_engaged),
        "held": {
            "ax": rnd(observation.held_accel_x_mps2),
            "ay": rnd(observation.held_accel_y_mps2),
        },
        "engaged": (
            None
            if record.engaged_action is None
            else {
                "ax": rnd(record.engaged_action.accel_x_mps2),
                "ay": rnd(record.engaged_action.accel_y_mps2),
            }
        ),
        "returned": {
            "ax": rnd(record.reply.action.accel_x_mps2),
            "ay": rnd(record.reply.action.accel_y_mps2),
        },
        "predicted": predicted,
        "truth_at_engage": truth,
        "pred_pos_error_m": rnd(pos_error),
        "fidelity": fidelity,
        "persistence_fidelity": persistence,
        "parse_failed": bool(record.reply.parse_failed),
        "prediction_parse_failed": bool(record.reply.prediction_parse_failed),
        "parse_retries": int(record.reply.parse_retries),
        "raw_completions": list(record.raw_completions),
        "obs_heat": rnd(observation.heat),
        "obs_heat_delta": rnd(observation.heat_delta),
        "obs_ticks_remaining": observation.ticks_remaining,
        "wind_forecast": rnd_list(observation.wind_forecast_x_mps2),
    }


def build_episode(
    path: Path,
    configs: dict[str, ScenarioConfig],
    traj_places: int,
) -> tuple[dict[str, Any], tuple[str, str, str]]:
    """Replay, score, and serialize one episode log."""
    scenario_id, repetition, arm, variant, key = parse_log_name(path)
    if scenario_id not in configs:
        raise ValueError(f"{path.name}: scenario {scenario_id} missing from pack")
    config = configs[scenario_id]
    manifest, cycle_lines, summary = read_log(path)
    records = [rebuild_cycle_record(line) for line in cycle_lines]

    trajectory, final_state = replay_episode(config, records)
    passed, detail = check_gate(final_state, summary, trajectory)
    gate_row = (key, "PASS" if passed else "FAIL", detail)
    if not passed:
        return {}, gate_row

    logged_final = rebuild_state(summary["final_state"])
    result = EpisodeResult(
        episode_id=summary["episode_id"],
        final_state=logged_final,
        cycles=summary["cycles"],
        log_bytes=b"",
        records=tuple(records),
        closest_approach_m=summary["closest_approach_m"],
        wall_clock_ms_telemetry_only=summary.get("wall_clock_ms_telemetry_only", 0.0),
        transport_retries=summary.get("transport_retries", 0),
    )

    fidelity_score = score_prediction_fidelity(records)
    temporal = score_temporal_anticipation(config, records) if config.goal_visible else None
    clean_records = tuple(record for record in records if record.reply.parse_retries == 0)
    clean_fidelity = score_prediction_fidelity(clean_records)
    clean_temporal = (
        score_temporal_anticipation(config, clean_records) if config.goal_visible else None
    )
    outcome_score = score_outcome(config, result)

    episode = {
        "key": key,
        "scenario_id": scenario_id,
        "arm": arm,
        "repetition": repetition,
        "variant": variant,
        "episode_id": manifest["episode_id"],
        "seed": manifest["seed"],
        "agent": manifest["agent"],
        "prompt_version": manifest.get("prompt_version"),
        "outcome": logged_final.outcome,
        "final_tick": logged_final.tick,
        "closest_approach_m": rnd(summary["closest_approach_m"]),
        "n_cycles": summary["cycles"],
        "retried_cycle_rate": summary.get("retried_cycle_rate"),
        "transport_retries": summary.get("transport_retries", 0),
        "wall_clock_ms": rnd(summary.get("wall_clock_ms_telemetry_only", 0.0), 1),
        "_wall_clock_ms_exact": summary.get("wall_clock_ms_telemetry_only", 0.0),
        "scores": {
            "prediction_fidelity": fidelity_score.prediction_fidelity,
            "prediction_coverage": fidelity_score.prediction_coverage,
            "fidelity_invalid_reason": fidelity_score.fidelity_invalid_reason,
            "persistence_floor_fidelity": fidelity_score.persistence_floor_fidelity,
            "temporal_anticipation": (
                temporal.temporal_anticipation if temporal is not None else None
            ),
            "mean_divergence_weight": (
                temporal.mean_divergence_weight if temporal is not None else None
            ),
            "temporal_n_scored_cycles": (
                temporal.n_scored_cycles if temporal is not None else None
            ),
            "fidelity_no_retry": clean_fidelity.prediction_fidelity,
            "fidelity_no_retry_n_valid_cycles": clean_fidelity.n_valid_prediction_cycles,
            "temporal_no_retry": (
                clean_temporal.temporal_anticipation if clean_temporal is not None else None
            ),
            "temporal_no_retry_mean_divergence_weight": (
                clean_temporal.mean_divergence_weight if clean_temporal is not None else None
            ),
            "temporal_no_retry_n_scored_cycles": (
                clean_temporal.n_scored_cycles if clean_temporal is not None else None
            ),
            "outcome": outcome_score,
            "action_parse_rate": fidelity_score.action_parse_rate,
            "prediction_parse_rate": fidelity_score.prediction_parse_rate,
        },
        "trajectory": {
            "t": trajectory["t"],
            "x": rnd_list(trajectory["x"], traj_places),
            "y": rnd_list(trajectory["y"], traj_places),
            "vx": rnd_list(trajectory["vx"], traj_places),
            "vy": rnd_list(trajectory["vy"], traj_places),
            "wind": rnd_list(trajectory["wind"], traj_places),
            "heat": rnd_list(trajectory["heat"], traj_places),
            "dist": rnd_list(trajectory["dist"], traj_places),
        },
        "cycles": [cycle_payload(record) for record in records],
        "_effective_actions_exact": [
            (record.reply.action.accel_x_mps2, record.reply.action.accel_y_mps2)
            for record in records
        ],
        "_predictions_exact": [
            None
            if record.reply.prediction is None
            else (
                record.reply.prediction.pos_x_m,
                record.reply.prediction.pos_y_m,
                record.reply.prediction.vel_x_mps,
                record.reply.prediction.vel_y_mps,
            )
            for record in records
        ],
        "_parse_paths_exact": [
            (
                record.reply.parse_failed,
                record.reply.prediction_parse_failed,
                record.reply.parse_retries,
            )
            for record in records
        ],
    }
    return episode, gate_row


def build_probe(path: Path, configs: dict[str, ScenarioConfig]) -> dict[str, Any]:
    """Score one formatting/forced-choice control episode."""
    scenario_id, repetition, _arm, _variant, key = parse_log_name(path)
    config = configs[scenario_id]
    _manifest, cycle_lines, _summary = read_log(path)
    records = tuple(rebuild_cycle_record(line) for line in cycle_lines)
    tags = set(config.axis_tags)
    if "probe:format" in tags:
        score = score_format_probe(records)
        return {
            "probe_kind": "format",
            "repetition": repetition,
            "scenario_id": scenario_id,
            "json_parse_rate": score.json_parse_rate,
            "identity_fidelity": score.identity_fidelity,
            "engage_fidelity": score.engage_fidelity,
            "choice_accuracy": None,
            "choice_parse_rate": None,
            "n_trials": score.n_trials,
            "n_parsed": score.n_parsed,
            "key": key,
        }
    score = score_forced_choice_probe(config, records)
    return {
        "probe_kind": "forced_choice",
        "repetition": repetition,
        "scenario_id": scenario_id,
        "json_parse_rate": None,
        "identity_fidelity": None,
        "engage_fidelity": None,
        "choice_accuracy": score.choice_accuracy,
        "choice_parse_rate": score.choice_parse_rate,
        "n_trials": score.n_trials,
        "n_parsed": score.n_parsed,
        "key": key,
    }


# --------------------------------------------------------------------------
# Cross-episode aggregation
# --------------------------------------------------------------------------


def build_arms(episodes: list[dict]) -> dict[str, Any]:
    """Aggregate primary (non-decoy) episodes per arm, as experiments._summarize."""
    arms: dict[str, Any] = {}
    for arm in ARM_NAMES:
        selected = [
            episode
            for episode in episodes
            if episode["arm"] == arm and episode["variant"] == "normal"
        ]
        summary: dict[str, Any] = {"n_episodes": len(selected)}
        for metric in ARM_METRICS:
            if metric == "wall_clock_ms":
                values = [
                    episode.get("_wall_clock_ms_exact", episode.get(metric))
                    for episode in selected
                ]
            elif metric == "retried_cycle_rate":
                values = [episode.get(metric) for episode in selected]
            else:
                values = [episode["scores"].get(metric) for episode in selected]
            summary[metric] = metric_range(values)
        summary["transport_retries"] = sum(
            episode.get("transport_retries", 0) for episode in selected
        )
        arms[arm] = summary
    return arms


def returned_actions(episode: dict) -> list[tuple[float, float]]:
    """Harness-resolved actions: accepted parses or no-op fallbacks."""
    return episode.get("_effective_actions_exact", [])


def returned_predictions(episode: dict) -> list[tuple[float, float, float, float] | None]:
    return episode.get("_predictions_exact", [])


def parse_paths(episode: dict) -> list[tuple[bool, bool, int]]:
    return episode.get("_parse_paths_exact", [])


def build_feedback(episodes: list[dict]) -> list[dict]:
    """Pair each masked-goal run with its decoy twin (true heat vs fake heat)."""
    by_key = {
        (episode["arm"], episode["repetition"], episode["scenario_id"], episode["variant"]): episode
        for episode in episodes
    }
    pairs: list[dict] = []
    for (arm, repetition, scenario_id, variant), episode in sorted(by_key.items()):
        if variant != "normal":
            continue
        decoy = by_key.get((arm, repetition, scenario_id, "decoy"))
        if decoy is None:
            continue
        normal_outcome = episode["scores"]["outcome"]
        decoy_outcome = decoy["scores"]["outcome"]
        pairs.append(
            {
                "arm": arm,
                "repetition": repetition,
                "scenario_id": scenario_id,
                "normal_outcome": normal_outcome,
                "decoy_outcome": decoy_outcome,
                "outcome_delta": normal_outcome - decoy_outcome,
                # Outcome equality alone is inconclusive. Compare the commands
                # the harness resolved from accepted parses or no-op fallbacks;
                # this supports a claim about effective control only.
                "actions_identical": returned_actions(episode) == returned_actions(decoy),
                "predictions_identical": (
                    returned_predictions(episode) == returned_predictions(decoy)
                ),
                "parse_paths_identical": parse_paths(episode) == parse_paths(decoy),
                "normal_key": episode["key"],
                "decoy_key": decoy["key"],
            }
        )
    return pairs


def build_feedback_summary(pairs: list[dict], band: float | None) -> list[dict]:
    """Mirror ``experiments._summarize_feedback`` from independently checked data."""
    summaries = []
    for arm in ARM_NAMES:
        selected = [pair for pair in pairs if pair["arm"] == arm]
        raw = mean_or_none([pair["outcome_delta"] for pair in selected])
        feedback_use = None
        if raw is not None and band is not None and band >= FEEDBACK_MIN_BAND:
            feedback_use = 0.5 + 0.5 * max(-1.0, min(1.0, raw / band))
        summaries.append(
            {
                "arm": arm,
                "feedback_use": feedback_use,
                "feedback_raw": raw,
                "feedback_band": band,
                "n_pairs": len(selected),
            }
        )
    return summaries


def _report_values_match(actual: Any, expected: Any) -> bool:
    """Compare derived report values while tolerating harmless sum-order noise."""
    if actual is None or expected is None:
        return actual is expected
    if (
        isinstance(actual, (int, float))
        and not isinstance(actual, bool)
        and isinstance(expected, (int, float))
        and not isinstance(expected, bool)
    ):
        return math.isclose(float(actual), float(expected), rel_tol=1e-12, abs_tol=1e-15)
    return actual == expected


def validate_report_aggregates(
    report: dict,
    episodes: list[dict],
    pairs: list[dict],
    configs: dict[str, ScenarioConfig],
) -> float | None:
    """Reject a closing report whose aggregates do not follow from its logs.

    The report is an input, not an authority.  Arm metrics are rebuilt from the
    replayed episodes, and the registered feedback-searcher band is recomputed
    from the scenario pack using the production scoring function.
    """
    expected_arms = build_arms(episodes)
    report_summaries = report.get("summaries")
    if not isinstance(report_summaries, list):
        raise ValueError("completed report summaries must be a list")
    summaries_by_arm = {
        summary.get("arm"): summary
        for summary in report_summaries
        if isinstance(summary, dict)
    }
    if set(summaries_by_arm) != set(ARM_NAMES) or len(report_summaries) != len(
        ARM_NAMES
    ):
        raise ValueError("completed report summaries must contain each arm exactly once")

    range_fields = {"mean": "mean", "minimum": "min", "maximum": "max", "n": "n"}
    for arm in ARM_NAMES:
        actual_summary = summaries_by_arm[arm]
        expected_summary = expected_arms[arm]
        for field in ("n_episodes", "transport_retries"):
            if not _report_values_match(actual_summary.get(field), expected_summary[field]):
                raise ValueError(f"completed report {arm}.{field} does not match logs")
        for report_metric, bundle_metric in REPORT_ARM_METRICS.items():
            actual_range = actual_summary.get(report_metric)
            if not isinstance(actual_range, dict):
                raise ValueError(f"completed report {arm}.{report_metric} is missing")
            expected_range = expected_summary[bundle_metric]
            for report_field, bundle_field in range_fields.items():
                if not _report_values_match(
                    actual_range.get(report_field), expected_range[bundle_field]
                ):
                    raise ValueError(
                        f"completed report {arm}.{report_metric}.{report_field} "
                        "does not match logs"
                    )

    if report.get("feedback_reference_agent") != "greedy":
        raise ValueError("completed report feedback_reference_agent must be 'greedy'")
    masked_configs = tuple(
        config
        for config in configs.values()
        if not config.goal_visible
        and not any(tag.startswith("probe:") for tag in config.axis_tags)
    )
    reference = score_feedback_use(masked_configs, GreedyAgent)
    band = reference.feedback_band
    band_terms = list(reference.feedback_band_terms or ())
    expected_feedback = {
        summary["arm"]: summary for summary in build_feedback_summary(pairs, band)
    }
    report_feedback = report.get("feedback_summaries")
    if not isinstance(report_feedback, list):
        raise ValueError("completed report feedback_summaries must be a list")
    feedback_by_arm = {
        summary.get("arm"): summary
        for summary in report_feedback
        if isinstance(summary, dict)
    }
    if set(feedback_by_arm) != set(ARM_NAMES) or len(report_feedback) != len(
        ARM_NAMES
    ):
        raise ValueError(
            "completed report feedback_summaries must contain each arm exactly once"
        )
    for arm in ARM_NAMES:
        actual = feedback_by_arm[arm]
        expected = expected_feedback[arm]
        for field in ("feedback_raw", "feedback_use", "feedback_band", "n_pairs"):
            if not _report_values_match(actual.get(field), expected[field]):
                raise ValueError(
                    f"completed report {arm}.{field} does not match logs/scoring"
                )
        actual_terms = actual.get("feedback_band_terms")
        if not isinstance(actual_terms, list) or len(actual_terms) != len(band_terms):
            raise ValueError(
                f"completed report {arm}.feedback_band_terms do not match scoring"
            )
        if not all(
            _report_values_match(actual_term, expected_term)
            for actual_term, expected_term in zip(actual_terms, band_terms)
        ):
            raise ValueError(
                f"completed report {arm}.feedback_band_terms do not match scoring"
            )
    return band


def read_report() -> dict | None:
    """Load the run report if the (still running) experiment has written it."""
    if not REPORT_PATH.exists():
        return None
    try:
        report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return report


# --------------------------------------------------------------------------
# Bundle assembly
# --------------------------------------------------------------------------


def build_scenarios_block(
    configs: dict[str, ScenarioConfig],
    raw: dict[str, dict],
) -> dict[str, Any]:
    block: dict[str, Any] = {}
    for scenario_id, config in configs.items():
        payload = raw[scenario_id]
        is_probe = any(tag.startswith("probe:") for tag in config.axis_tags)
        block[scenario_id] = {
            "scenario_id": config.scenario_id,
            "seed": config.seed,
            "dt_s": config.dt_s,
            "deliberation_ticks": config.deliberation_ticks,
            "deadline_tick": config.deadline_tick,
            "forecast_ticks": config.forecast_ticks,
            "gravity_mps2": config.gravity_mps2,
            "max_accel_mps2": config.max_accel_mps2,
            "goal_visible": config.goal_visible,
            "goal_x_m": config.goal_x_m,
            "goal_y_m": config.goal_y_m,
            "goal_radius_m": config.goal_radius_m,
            "start_pos_x_m": config.start_pos_x_m,
            "start_pos_y_m": config.start_pos_y_m,
            "start_vel_x_mps": config.start_vel_x_mps,
            "start_vel_y_mps": config.start_vel_y_mps,
            "bounds_min_x_m": config.bounds_min_x_m,
            "bounds_min_y_m": config.bounds_min_y_m,
            "bounds_max_x_m": config.bounds_max_x_m,
            "bounds_max_y_m": config.bounds_max_y_m,
            "wind_components": [
                {
                    "amp_mps2": component.amp_mps2,
                    "period_ticks": component.period_ticks,
                    "phase_rad": component.phase_rad,
                }
                for component in config.wind_components
            ],
            "axis_tags": list(payload.get("axis_tags", [])),
            "is_probe": is_probe,
            "wind_curve": [
                rnd(wind_x_at(config.wind_components, tick), 3)
                for tick in range(config.deadline_tick + 1)
            ],
        }
    return block


def newest_source_date(log_paths: list[Path]) -> str | None:
    """Date of the newest input actually read, as plain ``YYYY-MM-DD``.

    The official snapshot pins its production date in tracked provenance so a
    clone, ZIP extraction, or copy to another filesystem cannot rewrite
    history through file modification times.  Ad-hoc snapshots without that
    metadata retain a best-effort mtime fallback.
    """
    if PROVENANCE_PATH.exists():
        payload = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))
        value = payload.get("data_date")
        try:
            return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
        except (TypeError, ValueError) as exc:
            raise ValueError("provenance data_date must be YYYY-MM-DD") from exc

    stamps = []
    for path in list(log_paths) + ([REPORT_PATH] if REPORT_PATH.exists() else []):
        try:
            stamps.append(path.stat().st_mtime)
        except OSError:
            continue
    if not stamps:
        return None
    return datetime.fromtimestamp(max(stamps)).strftime("%Y-%m-%d")


def build_bundle(traj_places: int = 4) -> tuple[dict[str, Any], list[tuple[str, str, str]]]:
    configs, raw_scenarios, pack = load_scenarios()
    report = read_report()

    log_paths = sorted(LOGS_DIR.glob("*.jsonl"))
    manifest_sample = validate_log_provenance(log_paths, configs, pack)
    validate_snapshot_provenance(log_paths, manifest_sample)
    validate_completed_run_matrix(log_paths, configs, report, manifest_sample, pack)
    episodes: list[dict] = []
    probes: list[dict] = []
    gate_rows: list[tuple[str, str, str]] = []

    for path in log_paths:
        _scenario_id, _repetition, arm, variant, _key = parse_log_name(path)
        if arm == "control" or variant == "control":
            probes.append(build_probe(path, configs))
            continue
        episode, gate_row = build_episode(path, configs, traj_places)
        gate_rows.append(gate_row)
        if episode:
            episodes.append(episode)

    episodes.sort(key=lambda episode: episode["key"])
    pairs = build_feedback(episodes)
    arms = build_arms(episodes)
    band = (
        validate_report_aggregates(report, episodes, pairs, configs)
        if report is not None
        else None
    )
    for episode in episodes:
        episode.pop("_effective_actions_exact", None)
        episode.pop("_predictions_exact", None)
        episode.pop("_parse_paths_exact", None)
        episode.pop("_wall_clock_ms_exact", None)

    agent_name = manifest_sample["agent"] if manifest_sample else ""
    # agent name is "<adapter>:<model>:<arm>" -> strip transport and arm suffix.
    adapter_name = agent_name.split(":", 1)[0] if agent_name else ""
    model = agent_name.split(":", 1)[1].rsplit(":", 1)[0] if ":" in agent_name else ""

    # Caveats are emitted as machine-readable codes, never as prose: every
    # user-visible sentence lives in assets/strings.js and has to switch with
    # the language like the rest of the page.
    reps = sorted({episode["repetition"] for episode in episodes})
    notes: list[dict[str, Any]] = []
    if report is None:
        # No aggregate report yet means the run has not been closed out, so the
        # snapshot may be a slice of a run still in progress. Once report.json
        # exists neither caveat is true any more and neither is printed.
        notes.append({"code": "partial_run", "params": {}})
        notes.append({"code": "no_report", "params": {}})
    if not probes:
        notes.append({"code": "no_probes", "params": {}})
    if report is None or reps != list(range(REPETITIONS_EXPECTED)):
        notes.append(
            {
                "code": "reps_present",
                "params": {
                    "reps": ", ".join(f"r{rep}" for rep in reps),
                    "total": REPETITIONS_EXPECTED,
                },
            }
        )
    notes.append({"code": "temporal_masked_null", "params": {}})

    bundle = {
        "meta": {
            "pack_name": pack.get("name"),
            "pack_version": pack.get("version"),
            "schema_version": pack.get("schema_version"),
            "host_class": manifest_sample.get("host_class") if manifest_sample else None,
            "model": model,
            "adapter_name": adapter_name,
            "prompt_versions": {
                "end2end": "1.0",
                "wm_scaffold": "wm-scaffold-1.0",
                "format_probe": "probe-format-1.0",
                "choice_probe": "probe-choice-1.0",
            },
            "n_episodes": len(episodes),
            "repetitions_present": [f"r{rep}" for rep in reps],
            "repetitions_expected": REPETITIONS_EXPECTED,
            "run_complete": report is not None,
            "report_present": report is not None,
            "data_date": newest_source_date(log_paths),
            "generated_from": {
                "logs_dir": source_label(LOGS_DIR),
                "packs_dir": source_label(PACKS_DIR),
                "report_path": source_label(REPORT_PATH) if report is not None else None,
            },
            "source_notes": notes,
        },
        "constants": {
            "HEAT_SCALE_M": HEAT_SCALE_M,
            "PRED_POS_TOL_M": PRED_POS_TOL_M,
            "PRED_VEL_TOL_MPS": PRED_VEL_TOL_MPS,
            "FIDELITY_MIN_COVERAGE": FIDELITY_MIN_COVERAGE,
            "FIDELITY_MIN_CYCLES": FIDELITY_MIN_CYCLES,
            "FEEDBACK_MIN_BAND": FEEDBACK_MIN_BAND,
        },
        "baselines": BASELINES,
        "scenarios": build_scenarios_block(configs, raw_scenarios),
        "episodes": episodes,
        "arms": arms,
        "feedback": pairs,
        "feedback_summary": build_feedback_summary(pairs, band),
        "probes": probes,
    }
    return bundle, gate_rows


def write_bundle(bundle: dict[str, Any]) -> int:
    payload = json.dumps(bundle, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(payload, encoding="utf-8")
    return len(payload.encode("utf-8"))


def main() -> int:
    bundle, gate_rows = build_bundle(traj_places=4)

    print("REPLAY CORRECTNESS GATE (replayed final state vs summary.final_state)")
    print(f"{'episode':42s} {'gate':6s} detail")
    print("-" * 78)
    for key, verdict, detail in gate_rows:
        print(f"{key:42s} {verdict:6s} {detail}")
    passed = sum(1 for _key, verdict, _detail in gate_rows if verdict == "PASS")
    total = len(gate_rows)
    print("-" * 78)
    print(f"GATE: {passed}/{total} episodes reproduced exactly (tol {GATE_TOL:g} abs)")
    if passed != total:
        print("ABORT: bundle not written because the replay gate failed.")
        return 1

    size = write_bundle(bundle)
    if size > SIZE_LIMIT_BYTES:
        print(f"bundle {size / 1024:.1f} KB exceeds 25 MB -> reducing trajectory precision")
        bundle, _rows = build_bundle(traj_places=2)
        size = write_bundle(bundle)

    n_cycles = sum(len(episode["cycles"]) for episode in bundle["episodes"])
    n_traj = sum(len(episode["trajectory"]["t"]) for episode in bundle["episodes"])
    print()
    print(f"bundle:      {OUT_PATH}")
    print(f"size:        {size / 1024:.1f} KB ({size} bytes)")
    print(f"episodes:    {len(bundle['episodes'])}")
    print(f"scenarios:   {len(bundle['scenarios'])}")
    print(f"cycles:      {n_cycles}")
    print(f"traj points: {n_traj}")
    print(f"probes:      {len(bundle['probes'])}")
    print(f"feedback:    {len(bundle['feedback'])} pairs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
