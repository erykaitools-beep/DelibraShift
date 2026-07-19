from __future__ import annotations

import json
from dataclasses import replace

import pytest

from delibrashift.bank import load_pack
from delibrashift.demo import demo_scenario
from delibrashift.experiment_cli import main as experiment_main
from delibrashift.experiments import run_matched_pair, write_matched_pair_report
from delibrashift.types import canonical_json


class AdaptiveAdapter:
    name = "same-base-model"

    def __init__(self) -> None:
        self.calls = []

    def complete(self, prompt, *, max_tokens=512, temperature=0.0, seed=None):
        if "FORMAT CONTROL" in prompt:
            stage = "format-control"
            reply = prompt.strip().splitlines()[-1]
        elif "WORLD-MODEL CONTROL" in prompt:
            stage = "forced-choice-control"
            reply = '{"choice":"A"}'
        elif "STAGE 1" in prompt:
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
    assert report.format_probe_prompt_version == "probe-format-1.0"
    assert report.choice_probe_prompt_version == "probe-choice-1.0"
    assert report.feedback_reference_agent == "greedy"
    assert report.excluded_probe_ids == ("excluded-probe",)
    assert len(report.episodes) == 4
    assert len(report.probe_episodes) == 2
    assert all(probe.probe_kind == "format" for probe in report.probe_episodes)
    assert all(probe.n_trials > 0 for probe in report.probe_episodes)
    assert all(probe.n_trials == probe.n_parsed for probe in report.probe_episodes)
    assert all(summary.n_pairs == 0 for summary in report.feedback_summaries)
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
    assert len(list((tmp_path / "logs").glob("*.jsonl"))) == 6
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
    assert payload["probe_episodes"][0]["n_trials"] > 0


def test_masked_pairs_publish_feedback_rows_and_reference_band(tmp_path) -> None:
    config = next(
        item for item in load_pack("packs/core_v0") if item.scenario_id == "g007a"
    )
    report = run_matched_pair(
        (config,),
        AdaptiveAdapter(),
        repetitions=1,
        pace_rpm=0.0,
        log_dir=tmp_path,
        include_temporal=False,
        allow_underpowered=True,
    )
    assert len(report.episodes) == 2
    assert len(report.feedback_episodes) == 2
    assert all(row.normal_outcome == row.decoy_outcome for row in report.feedback_episodes)
    assert all(row.outcome_delta == 0.0 for row in report.feedback_episodes)
    assert all(row.decoy_log_path is not None for row in report.feedback_episodes)
    assert all(summary.n_pairs == 1 for summary in report.feedback_summaries)
    assert all(summary.feedback_raw == 0.0 for summary in report.feedback_summaries)
    assert all(summary.feedback_use == 0.5 for summary in report.feedback_summaries)
    assert all(
        summary.feedback_band == 0.6787945559352755
        for summary in report.feedback_summaries
    )
    assert all(
        summary.feedback_band_terms == (0.6787945559352755,)
        for summary in report.feedback_summaries
    )


def test_forced_choice_probe_is_a_separate_control_with_trial_counts() -> None:
    pack = load_pack("packs/core_v0")
    config = next(item for item in pack if item.scenario_id == "g001")
    probe = next(item for item in pack if item.scenario_id == "g009")
    report = run_matched_pair(
        (config, probe),
        AdaptiveAdapter(),
        repetitions=1,
        pace_rpm=0.0,
        include_temporal=False,
        allow_underpowered=True,
    )
    assert len(report.episodes) == 2
    assert len(report.probe_episodes) == 1
    control = report.probe_episodes[0]
    assert control.probe_kind == "forced_choice"
    assert control.choice_parse_rate == 1.0
    assert control.choice_accuracy is not None
    assert control.n_trials == control.n_parsed
    assert control.n_trials > 0
    assert control.json_parse_rate is None


def test_resume_reuses_verified_logs_without_model_calls(tmp_path) -> None:
    config = replace(demo_scenario(), deadline_tick=80)
    adapter = AdaptiveAdapter()
    first = run_matched_pair(
        (config,),
        adapter,
        repetitions=1,
        pace_rpm=0.0,
        log_dir=tmp_path,
        include_temporal=False,
        allow_underpowered=True,
    )
    calls_after_first = len(adapter.calls)
    resumed = run_matched_pair(
        (config,),
        adapter,
        repetitions=1,
        pace_rpm=0.0,
        log_dir=tmp_path,
        include_temporal=False,
        allow_underpowered=True,
        resume=True,
    )
    assert len(adapter.calls) == calls_after_first
    assert resumed == first


@pytest.mark.parametrize(
    ("mutation", "message"),
    (
        ("truncated", "incomplete episode summary"),
        ("noncanonical", "non-canonical episode log"),
        ("scenario_id", "resume manifest mismatch for scenario_id"),
        ("agent", "resume manifest mismatch for agent"),
        ("prompt_version", "resume manifest mismatch for prompt_version"),
        ("pack_name", "resume manifest mismatch for pack_name"),
        ("pack_version", "resume manifest mismatch for pack_version"),
        ("host_class", "resume manifest mismatch for host_class"),
        ("scenario_ids", "resume manifest mismatch for scenario_ids"),
        ("terminal", "invalid terminal summary"),
    ),
)
def test_resume_rejects_corrupt_or_mismatched_logs_before_model_calls(
    tmp_path,
    mutation,
    message,
) -> None:
    config = replace(demo_scenario(), deadline_tick=80)
    run_matched_pair(
        (config,),
        AdaptiveAdapter(),
        repetitions=1,
        pace_rpm=0.0,
        log_dir=tmp_path,
        pack_name="test-pack",
        pack_version="1.2.3",
        host_class="test-host",
        include_temporal=False,
        allow_underpowered=True,
    )
    path = tmp_path / f"{config.scenario_id}.r0.end2end.jsonl"
    raw_lines = path.read_text(encoding="utf-8").splitlines()
    payloads = [json.loads(line) for line in raw_lines]

    if mutation == "truncated":
        payloads.pop()
    elif mutation == "noncanonical":
        path.write_text(
            json.dumps(payloads[0]) + "\n" + "\n".join(raw_lines[1:]) + "\n",
            encoding="utf-8",
        )
    elif mutation == "terminal":
        payloads[-1]["final_state"]["done"] = False
    else:
        replacements = {
            "scenario_id": "other-scenario",
            "agent": "end2end:other-model",
            "prompt_version": "other-prompt",
            "pack_name": "other-pack",
            "pack_version": "9.9.9",
            "host_class": "other-host",
            "scenario_ids": ["other-scenario"],
        }
        payloads[0][mutation] = replacements[mutation]
    if mutation != "noncanonical":
        path.write_text(
            "\n".join(canonical_json(payload) for payload in payloads) + "\n",
            encoding="utf-8",
        )

    adapter = AdaptiveAdapter()
    with pytest.raises(ValueError, match=message):
        run_matched_pair(
            (config,),
            adapter,
            repetitions=1,
            pace_rpm=0.0,
            log_dir=tmp_path,
            pack_name="test-pack",
            pack_version="1.2.3",
            host_class="test-host",
            include_temporal=False,
            allow_underpowered=True,
            resume=True,
        )
    assert adapter.calls == []


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
