from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_model_impact_estimates_are_present_and_sum_to_100() -> None:
    text = (ROOT / "MODEL_CONTRIBUTIONS.md").read_text(encoding="utf-8")
    section = text.split("## Attribution method and estimated impact", 1)[1]
    section = section.split("## FABLE 5", 1)[0]
    percentages = [int(value) for value in re.findall(r"\|\s*(\d+)%\s*\|", section)]

    assert percentages == [55, 30, 15]
    assert sum(percentages) == 100
    assert "not a legal ownership split" in section


def test_report_and_normative_docs_reject_superseded_public_licence_claims() -> None:
    paths = [
        ROOT / "SPEC.md",
        ROOT / "README.md",
        ROOT / "CONTRIBUTING.md",
        ROOT / "CHANGELOG.md",
        ROOT / "report" / "assets" / "strings.js",
        ROOT / "report" / "spec" / "COPY.md",
    ]
    text = "\n".join(path.read_text(encoding="utf-8") for path in paths)

    for stale in (
        "MIT licence",
        "Licencja MIT",
        "Open benchmark",
        "Otwarty benchmark",
        "open, reproducible agent benchmark",
        "Initial public release",
    ):
        assert stale not in text
    assert "private evaluation, all rights reserved" in text
    assert "prywatna ewaluacja, wszelkie prawa zastrzeżone" in text


def test_documented_cod_decision_count_matches_ledger() -> None:
    decisions = (ROOT / "DECISIONS.md").read_text(encoding="utf-8")
    contributions = (ROOT / "MODEL_CONTRIBUTIONS.md").read_text(encoding="utf-8")
    count = len(re.findall(r"^## COD-\d{3}", decisions, flags=re.MULTILINE))

    assert count == 31
    assert f"recorded {count} `COD-###` decisions" in contributions
