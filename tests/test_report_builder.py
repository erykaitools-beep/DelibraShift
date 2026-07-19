from pathlib import Path

from report import build_report


def test_write_utf8_lf_is_binary_and_normalizes_all_newlines(tmp_path, monkeypatch):
    output = tmp_path / "report.html"

    def reject_platform_text_write(*_args, **_kwargs):
        raise AssertionError("report output must bypass platform newline translation")

    monkeypatch.setattr(Path, "write_text", reject_platform_text_write)

    size = build_report.write_utf8_lf(output, "first\r\nŚwiat\rthird\nfourth")

    expected = "first\nŚwiat\nthird\nfourth".encode("utf-8")
    assert output.read_bytes() == expected
    assert size == len(expected)
    assert b"\r" not in output.read_bytes()


def test_custom_logs_default_to_their_sibling_report(tmp_path: Path) -> None:
    logs = tmp_path / "run" / "logs"
    logs.mkdir(parents=True)

    assert build_report.resolve_report_path(None, logs) == tmp_path / "run" / "report.json"
    assert build_report.resolve_report_path(None, tmp_path / "run") == tmp_path / "run" / "report.json"


def test_explicit_report_always_wins(tmp_path: Path) -> None:
    explicit = tmp_path / "chosen.json"

    assert build_report.resolve_report_path(explicit, tmp_path / "logs") == explicit
