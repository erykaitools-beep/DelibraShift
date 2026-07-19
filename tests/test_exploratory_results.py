from __future__ import annotations

import json
import hashlib
import math
from pathlib import Path

from delibrashift.bank import load_pack
from delibrashift.harness import parse_reply, render_prompt
from delibrashift.types import Prediction, prediction_fidelity
from delibrashift.world import build_observation, initial_state


ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / "results" / "exploratory" / "first_decision_smoke.json"
REPEATED = ROOT / "results" / "exploratory" / "first_decision_repeated.json"
GOLDEN = ROOT / "tests" / "fixtures" / "golden_g001.json"
DRIVER = ROOT / "tools" / "run_first_decision_smoke.py"


class _Target:
    def __init__(self, payload: dict[str, object]) -> None:
        self.pos_x_m = payload["pos_x_m"]
        self.pos_y_m = payload["pos_y_m"]
        self.vel_x_mps = payload["vel_x_mps"]
        self.vel_y_mps = payload["vel_y_mps"]


def test_exploratory_pilot_is_separate_and_internally_consistent() -> None:
    payload = json.loads(PILOT.read_text(encoding="utf-8"))
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    target = golden["prediction_target_cycle0"]
    target_object = _Target(target)

    assert payload["official_snapshot"] is False
    assert payload["evidence_status"] == "partial_pilot"
    assert payload["method"]["pack_name"] == "core_v0"
    assert payload["method"]["pack_version"] == "0.1.1"
    assert payload["target_at_engage"] == {
        "tick": target["target_tick"],
        "pos_x_m": target["pos_x_m"],
        "pos_y_m": target["pos_y_m"],
        "vel_x_mps": target["vel_x_mps"],
        "vel_y_mps": target["vel_y_mps"],
    }

    persistence = Prediction(20.0, 70.0, 0.0, 0.0)
    expected_floor = prediction_fidelity(persistence, target_object)
    assert payload["persistence_floor"]["cycle0_raw_fidelity"] == expected_floor

    digests = set()
    for record in payload["models"]:
        digests.add(record["digest"])
        assert len(record["digest"]) == 64
        assert record["raw_content"] is not None
        prediction = Prediction(**record["prediction"])
        assert record["cycle0_raw_fidelity"] == prediction_fidelity(
            prediction,
            target_object,
        )
        assert record["position_error_m"] == math.hypot(
            prediction.pos_x_m - target["pos_x_m"],
            prediction.pos_y_m - target["pos_y_m"],
        )
    assert len(digests) == len(payload["models"])

    for observation in payload["unverifiable_observations"]:
        assert observation["raw_content"] is None
        assert observation["reason_unverifiable"]


def test_repeated_screen_is_replayable_from_retained_raw_responses() -> None:
    payload = json.loads(REPEATED.read_text(encoding="utf-8"))
    target = _Target(payload["target_at_engage"])

    assert payload["official_snapshot"] is False
    assert payload["evidence_status"] == "auditable_exploratory_screen"
    assert payload["method"]["seeds"] == [0, 1, 2]
    assert payload["method"]["dedicated_server_process"] is True
    assert payload["driver"]["sha256"] == hashlib.sha256(
        DRIVER.read_bytes()
    ).hexdigest()

    config = next(
        item
        for item in load_pack(ROOT / "packs" / "core_v0")
        if item.scenario_id == "g001"
    )
    observation = build_observation(
        config,
        initial_state(config),
        episode_id="exploratory:g001:first-decision",
        cycle=0,
    )
    assert payload["method"]["prompt_sha256"] == hashlib.sha256(
        render_prompt(observation).encode("utf-8")
    ).hexdigest()

    assert [record["model"] for record in payload["models"]] == [
        "qwen2.5:3b",
        "gemma3:4b",
    ]
    for model in payload["models"]:
        assert len(model["ollama_manifest_digest_sha256"]) == 64
        assert [run["seed"] for run in model["runs"]] == [0, 1, 2]
        raw_hashes = set()
        for run in model["runs"]:
            raw = run["raw_content"]
            raw_digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
            raw_hashes.add(raw_digest)
            assert raw_digest == run["raw_content_sha256"]
            reply = parse_reply(raw)
            assert not reply.parse_failed
            assert not reply.prediction_parse_failed
            assert reply.prediction is not None
            assert run["action_parse_ok"] is True
            assert run["prediction_parse_ok"] is True
            assert run["example_echo"] is False
            assert run["cycle0_raw_fidelity"] == prediction_fidelity(
                reply.prediction,
                target,
            )
            assert run["position_error_m"] == math.hypot(
                reply.prediction.pos_x_m - target.pos_x_m,
                reply.prediction.pos_y_m - target.pos_y_m,
            )
            assert run["ollama_response_metadata"]["done"] is True
            assert run["ollama_response_metadata"]["done_reason"] == "stop"
        assert len(raw_hashes) == 1


def test_exploratory_readme_table_matches_repeated_artifact() -> None:
    readme = (REPEATED.parent / "README.md").read_text(encoding="utf-8")

    assert "| qwen2.5:3b | 3/3 | yes | 0.000022280 | 18.62 m |" in readme
    assert "| gemma3:4b | 3/3 | yes | 0.000743449 | 10.76 m |" in readme
    assert "one scenario decision still cannot rank models" in readme
