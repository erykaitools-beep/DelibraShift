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


def test_report_and_normative_docs_publish_the_approved_mit_terms() -> None:
    paths = [
        ROOT / "LICENSE",
        ROOT / "pyproject.toml",
        ROOT / "CITATION.cff",
        ROOT / "SPEC.md",
        ROOT / "README.md",
        ROOT / "CONTRIBUTING.md",
        ROOT / "CHANGELOG.md",
        ROOT / "report" / "assets" / "strings.js",
        ROOT / "report" / "spec" / "COPY.md",
    ]
    text = "\n".join(path.read_text(encoding="utf-8") for path in paths)
    lowered = text.lower()

    for superseded in (
        "private evaluation",
        "prywatna ewaluacja",
        "all rights reserved",
        "wszelkie prawa zastrzeżone",
        "licenseref-proprietary",
        "currently private",
    ):
        assert superseded not in lowered

    assert (ROOT / "LICENSE").read_text(encoding="utf-8").startswith("MIT License\n")
    assert 'license = "MIT"' in (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert "license: MIT" in (ROOT / "CITATION.cff").read_text(encoding="utf-8")
    assert "licencja MIT" in text
    assert "MIT License" in text


def test_documented_cod_decision_count_matches_ledger() -> None:
    decisions = (ROOT / "DECISIONS.md").read_text(encoding="utf-8")
    contributions = (ROOT / "MODEL_CONTRIBUTIONS.md").read_text(encoding="utf-8")
    count = len(re.findall(r"^## COD-\d{3}", decisions, flags=re.MULTILINE))

    assert count == 34
    assert f"recorded {count} `COD-###` decisions" in contributions
