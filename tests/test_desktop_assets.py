from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "delibrashift" / "desktop_assets"


def test_desktop_assets_are_local_and_have_no_network_primitives() -> None:
    paths = tuple(ASSETS.iterdir())
    assert {path.name for path in paths} == {"index.html", "lab.css", "lab.js"}

    combined = "\n".join(path.read_text(encoding="utf-8") for path in paths)
    for forbidden in ("http://", "https://", "fetch(", "XMLHttpRequest", "WebSocket("):
        assert forbidden not in combined


def test_desktop_ui_exposes_required_lab_controls() -> None:
    html = (ASSETS / "index.html").read_text(encoding="utf-8")
    javascript = (ASSETS / "lab.js").read_text(encoding="utf-8")

    for control in (
        'id="scenario"',
        'id="agent"',
        'id="run"',
        'id="step"',
        'id="play"',
        'id="reset"',
        'id="timeline"',
        'id="export"',
        'id="arena"',
    ):
        assert control in html
    assert 'addEventListener("pywebviewready"' in javascript
    assert "run_scenario" in javascript
    assert "save_last_run" in javascript
    assert "HIDDEN FROM AGENT" in javascript
