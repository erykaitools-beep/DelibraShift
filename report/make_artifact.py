"""Convert the standalone report into the body-only form an Artifact host wraps.

The published page is served inside a host-provided ``<!doctype html><head>...
</head><body>`` skeleton, so this strips our own skeleton and keeps only the
head payload (styles and scripts) plus the body content.

It also bridges theme ownership.  The standalone file force-sets
``data-theme="dark"`` on the root element, which is correct for a file:// page
but wrong inside a host whose own toggle stamps that attribute.  The bridge
below seeds our stored preference from whatever the host has already decided
(falling back to the OS preference) so the host's choice wins on first paint,
while a later click on our own toggle still works normally.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "delibrashift_report.html"
TARGET = ROOT / "delibrashift_report.artifact.html"

THEME_BRIDGE = """<script>
/* Artifact host theme bridge: adopt the host's theme before the app boots. */
(function () {
  try {
    var root = document.documentElement;
    var hostTheme = root.getAttribute('data-theme');
    if (!hostTheme && window.matchMedia) {
      hostTheme = window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
    }
    var stored = null;
    try { stored = window.localStorage.getItem('cg.theme'); } catch (e) { stored = null; }
    if (!stored && hostTheme) {
      try { window.localStorage.setItem('cg.theme', hostTheme); } catch (e) {}
      root.setAttribute('data-theme', hostTheme);
    }
  } catch (e) {}
}());
</script>
"""


def slice_between(html: str, open_tag: str, close_tag: str) -> str:
    start = html.index(open_tag)
    start = html.index(">", start) + 1
    end = html.index(close_tag, start)
    return html[start:end]


def main() -> int:
    html = SOURCE.read_text(encoding="utf-8")

    head = slice_between(html, "<head", "</head>")
    body = slice_between(html, "<body", "</body>")

    # The host owns <meta> and <title>; the artifact title is passed as a
    # publish parameter instead.  Everything else in head is our own payload.
    head = re.sub(r"<meta\b[^>]*>\s*", "", head)
    head = re.sub(r"<title\b[^>]*>.*?</title>\s*", "", head, flags=re.S)

    out = THEME_BRIDGE + head.strip() + "\n" + body.strip() + "\n"
    TARGET.write_text(out, encoding="utf-8")

    # ---- validation -------------------------------------------------------
    checks: list[tuple[str, bool, str]] = []
    # Match real tags only.  A bare substring search reports <header> as <head>
    # and finds <body> inside prose comments; both are false alarms.
    without_comments = re.sub(r"<!--.*?-->", "", out, flags=re.S)
    for tag in ("html", "head", "body"):
        pattern = rf"</?{tag}(?=[\s/>])"
        hits = re.findall(pattern, without_comments, flags=re.I)
        checks.append((f"no <{tag}>", not hits, f"{len(hits)} real tag(s)"))
    checks.append(("no doctype", "<!doctype" not in out.lower(), "host supplies it"))
    checks.append(("styles kept", out.count("<style") == html.count("<style"), f"{out.count('<style')} of {html.count('<style')}"))
    checks.append((
        "scripts kept",
        out.count("<script") == html.count("<script") + 1,
        f"{out.count('<script')} (source {html.count('<script')} + 1 bridge)",
    ))
    checks.append(("bundle json", 'id="bundle"' in out, "embedded data present"))
    for needle in ("cg-tab-what", "cg-tab-results", "cg-tab-lab"):
        checks.append((f"tab {needle}", needle in out, "tab identifier present"))
    checks.append(("no external src", not re.search(r'(?:src|href)\s*=\s*"https?://', out), "no remote asset"))
    checks.append(("theme bridge", "cg.theme" in out, "bridge installed"))

    width = max(len(name) for name, _, _ in checks)
    failed = 0
    print(f"{TARGET}  {TARGET.stat().st_size / 1_048_576:.2f} MB")
    print("-" * 78)
    for name, ok, detail in checks:
        print(f"  {name:<{width}}  {'PASS' if ok else 'FAIL'}  {detail}")
        if not ok:
            failed += 1
    print("-" * 78)
    if failed:
        print(f"{failed} check(s) FAILED")
        return 1
    print("artifact variant OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
