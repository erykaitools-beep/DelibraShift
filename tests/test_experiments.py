from __future__ import annotations

import json
from dataclasses import replace

import pytest

from chronogym.demo import demo_scenario
from chronogym.experiment_cli import main as experiment_main
from chronogym.experiments import run_matched_pair, write_matched_pair_report


class AdaptiveAdapter:
    name = "same-base-model"

    def __init__(self) -> None:
        self.calls = []

    def complete(self, prompt, *, max_tokens=512, temperature=0.0, seed=None):
        if "STAGE 1" in prompt:
            stage = "prediction"
            reply = (
                '{"prediction":{"pos_x_m":20,"pos_y_m":65,'
                '"vel_x_mps":2,"vel_y_mps":-5}}'
            )
        elif "STAGE 2" in prompt:
            stage = "action"
            reply = '{"action":{"accel_x_mps2":0,"accel_y_mps2":0}}'
        else:
            stage = "end2end"
            reply = (
                '{"prediction":{"pos_x_m":20,"pos_y_m":65,'
                '"vel_x_mps":2,"vel_y_mps":-5},'
                '"action":{"accel_x_mps2":0,"accel_y_mps2":0}}'
            )
        self.calls.append((seed, stage))
        return reply


def test_matched_pair_uses_same_model_seeds_and_writes_auditable_logs(tmp_path) -> None:
    config = replace(demo_scenario(), deadline_tick=80)
    probe = replace(
        config,
        scenario_id="excluded-probe",
        axis_tags=("probe:format",),
    )
    adapter = AdaptiveAdapter()
    report = run_matched_pair(
        (config, probe),
        adapter,
        repetitions=2,
        pace_rpm=0.0,
        log_dir=tmp_path / "logs",
        pack_name="test-pack",
        pack_version="0.0.1",
        host_class="test-host",
        include_temporal=False,
        allow_underpowered=True,
    )
    assert report.scenario_ids == (config.scenario_id,)
    assert report.adapter_name == adapter.name
    assert report.host_class == "test-host"
    assert report.pack_name == "test-pack"
    assert report.pack_version == "0.0.1"
    assert report.end2end_prompt_version == "1.0"
    assert report.scaffold_prompt_version == "wm-scaffold-1.0"
    assert report.excluded_probe_ids == ("excluded-probe",)
    assert len(report.episodes) == 4
    assert {episode.arm for episode in report.episodes} == {
        "end2end",
        "wm-scaffold",
    }
    assert all(summary.n_episodes == 2 for summary in report.summaries)
    assert all(summary.mean_divergence_weight.n == 0 for summary in report.summaries)
    assert {seed for seed, _ in adapter.calls} == {0, 1}
    seed_zero = [stage for seed, stage in adapter.calls if seed == 0]
    seed_one = [stage for seed, stage in adapter.calls if seed == 1]
    assert seed_zero[0] == "end2end"
    assert seed_one[0] == "prediction"
    assert len(list((tmp_path / "logs").glob("*.jsonl"))) == 4
    end2end = [episode for episode in report.episodes if episode.arm == "end2end"]
    scaffold = [episode for episode in report.episodes if episode.arm == "wm-scaffold"]
    assert [episode.outcome for episode in end2end] == [
        episode.outcome for episode in scaffold
    ]
    assert all(
        episode.fidelity_no_retry == episode.prediction_fidelity
        for episode in report.episodes
    )

    report_path = tmp_path / "report.json"
    write_matched_pair_report(report, report_path)
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    assert payload["repetitions"] == 2
    assert payload["summaries"][0]["arm"] == "end2end"


def test_matched_pair_rejects_underpowered_or_probe_only_runs() -> None:
    config = demo_scenario()
    with pytest.raises(ValueError, match="at least 3"):
        run_matched_pair((config,), AdaptiveAdapter(), repetitions=2, pace_rpm=0.0)
    probe = replace(config, axis_tags=("probe:format",))
    with pytest.raises(ValueError, match="non-probe"):
        run_matched_pair(
            (probe,),
            AdaptiveAdapter(),
            repetitions=3,
            pace_rpm=0.0,
        )


def test_experiment_cli_requires_explicit_external_call_acknowledgement() -> None:
    with pytest.raises(SystemExit) as error:
        experiment_main(["packs/core_v0"])
    assert error.value.code == 2
