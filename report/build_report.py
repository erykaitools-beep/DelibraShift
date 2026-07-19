#!/usr/bin/env python3
"""Assemble the DelibraShift M2 viewer into one self-contained HTML file.

The script is a linker, not a renderer.  It takes the shell (``template.html``),
the view layer (``assets/*.css``, ``assets/*.js``, ``assets/sprites.svg``) and
the data (``data/bundle.json``, produced by ``extract.py``) and welds them into
``delibrashift_report.html``: a single file that must open from a ``file://`` URL
on a machine with no network at all.

Pipeline
--------
1. Resolve the log source. By default the canonical repository results under
   ``results/m2/logs`` are used read-only. External or incomplete log sources
   are copied into a private staging directory before extraction.
2. Run the extraction (``extract.build_bundle`` through ``extract.main``) unless
   ``--skip-extract`` is given and a bundle already exists.  Extraction enforces
   its own replay-correctness gate; a failing gate aborts the build.
3. Substitute every placeholder in the template with the matching payload,
   escaping each payload for the element it lands in.
4. Validate the written file and refuse to call the build a success unless every
   check passes.

Escaping rules, in one place so they can be audited
---------------------------------------------------
* JSON lands in ``<script type="application/json">``.  ``&``, ``<`` and ``>``
  become ``\\u0026`` / ``\\u003c`` / ``\\u003e`` (ampersand first, or the later
  passes mangle the backslashes the earlier one wrote), and U+2028 / U+2029
  become their escapes.  All five are legal JSON string content, so ``JSON.parse``
  restores the original text byte for byte.
* JS lands in ``<script>``.  The sequence ``</`` becomes ``<\\/`` so that no
  ``</script`` can ever appear; the escaped source is then handed to
  ``node --check`` to prove the escape did not change how it parses.
* CSS lands in ``<style>``, which cannot escape anything, so the payload is
  asserted to be free of ``</style`` and of at-import rules.

Writes only under ``report/``. The canonical result logs and scenario pack are
read-only inputs.
"""

from __future__ import annotations

import argparse
import json
import re
import os
import shutil
import subprocess
import sys
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
ASSETS_DIR = ROOT / "assets"
TEMPLATE_PATH = ROOT / "template.html"
BUNDLE_PATH = ROOT / "data" / "bundle.json"
#: Written beside the bundle: exactly which log files went into it.  The staging
#: directory is rewritten by the next build, so it cannot answer that question.
SOURCES_PATH = ROOT / "data" / "bundle_sources.json"
STAGE_DIR = ROOT / "data" / "live_stage"
DEFAULT_LOGS = PROJECT_ROOT / "results" / "m2" / "logs"
DEFAULT_PACK = PROJECT_ROOT / "packs" / "core_v0"
DEFAULT_OUT = ROOT / "delibrashift_report.html"

DEFAULT_REPORT = PROJECT_ROOT / "results" / "m2" / "report.json"

NODE = Path("/usr/bin/node")

#: Built without spelling the token out, so that "no placeholder survived" can
#: be grepped over the produced file without matching this script's own text.
MARKER_OPEN = "<!--" + "INJECT:"
MARKER_RE = re.compile(re.escape(MARKER_OPEN) + r"([A-Z_0-9]+)-->")

#: (placeholder, source file relative to the repo or None, payload kind)
PAYLOADS: tuple[tuple[str, str | None, str], ...] = (
    ("META", None, "meta"),
    ("TOKENS_CSS", "assets/tokens.css", "css"),
    ("APP_CSS", "assets/app.css", "css"),
    ("SPRITES", "assets/sprites.svg", "svg"),
    ("BUNDLE_JSON", "data/bundle.json", "json"),
    ("STRINGS_JS", "assets/strings.js", "js"),
    ("ARENA_JS", "assets/arena.js", "js"),
    ("CHARTS_JS", "assets/charts.js", "js"),
    ("APP_JS", "assets/app.js", "js"),
)

#: Element ids the three tabs are addressed by; all six must survive the build.
TAB_IDS = (
    "cg-tab-what",
    "cg-tab-results",
    "cg-tab-lab",
    "cg-panel-what",
    "cg-panel-results",
    "cg-panel-lab",
)

#: Runtime network APIs.  None of them may appear anywhere in the output.
FORBIDDEN_TOKENS = (
    "fetch(",
    "XMLHttpRequest",
    "import(",
    "@import url(",
    "@import ",
    "new WebSocket",
    "EventSource(",
    "sendBeacon(",
    "<iframe",
    "srcdoc=",
)

#: Absolute URLs that are namespace identifiers, never fetched by any browser.
URL_ALLOWLIST = (
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/2000/xmlns/",
    "http://www.w3.org/1999/xhtml",
)


def public_path(path: Path) -> str:
    """Portable provenance label safe to embed in a public artifact."""
    resolved = path.expanduser().resolve()
    try:
        return resolved.relative_to(PROJECT_ROOT.resolve()).as_posix()
    except ValueError:
        return f"external/{resolved.name}"

LANGS = ("pl", "en")

#: Loads the built file the way a browser would, without a browser: parse the
#: data island with the engine's own JSON parser, then execute every script
#: block in a sandbox that offers only the few DOM entry points the modules
#: touch while defining themselves.  `node --check` proves the payloads still
#: parse; this proves they still run and publish their globals after escaping.
IN_ENGINE_PROBE = r"""
'use strict';
var fs = require('fs');
var vm = require('vm');
var out = { ok: false, errors: [] };
try {
  var html = fs.readFileSync(process.argv[2], 'utf8');
  var island = html.match(/<script[^>]*id="(?:cg-)?bundle"[^>]*>([\s\S]*?)<\/script>/);
  if (!island) { throw new Error('data island not found'); }
  var bundle = JSON.parse(island[1]);
  out.episodes = Array.isArray(bundle.episodes) ? bundle.episodes.length : -1;
  var bodies = [];
  var re = /<script>([\s\S]*?)<\/script>/g;
  var hit;
  while ((hit = re.exec(html)) !== null) { bodies.push(hit[1]); }
  out.blocks = bodies.length;
  var noop = function () {};
  var doc = {
    readyState: 'loading',
    documentElement: {
      getAttribute: function () { return null; },
      setAttribute: noop,
      removeAttribute: noop
    },
    addEventListener: noop,
    getElementById: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function () { return { style: {}, setAttribute: noop, appendChild: noop }; }
  };
  var sandbox = {
    console: { log: noop, warn: noop, error: noop },
    document: doc,
    navigator: { languages: ['pl'] },
    localStorage: null,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    addEventListener: noop,
    removeEventListener: noop
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  bodies.forEach(function (src, i) {
    try { vm.runInContext(src, sandbox, { filename: 'block' + i }); }
    catch (e) { out.errors.push('block ' + i + ': ' + e.message); }
  });
  out.keys_pl = sandbox.STRINGS && sandbox.STRINGS.pl ? Object.keys(sandbox.STRINGS.pl).length : 0;
  out.keys_en = sandbox.STRINGS && sandbox.STRINGS.en ? Object.keys(sandbox.STRINGS.en).length : 0;
  out.globals = ['Arena', 'Charts', 'App'].filter(function (name) {
    return sandbox[name] && typeof sandbox[name] === 'object';
  });

  /* The shell asks for charts by kind. A kind that resolves to nothing makes
     the page print "the drawing module did not load" on a build where the
     module loaded perfectly, so every kind is checked against the module that
     is actually in the file - not merely that a global exists. */
  var appSrc = bodies.join('\n');
  var kinds = {};
  var kre = /drawChart\(\s*'([a-z0-9_]+)'/g;
  var khit;
  while ((khit = kre.exec(appSrc)) !== null) { kinds[khit[1]] = true; }
  out.chart_kinds = Object.keys(kinds);
  out.chart_unwired = out.chart_kinds.filter(function (kind) {
    var C = sandbox.Charts;
    if (!C) { return true; }
    var camel = kind.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); });
    if (typeof C[kind] === 'function' || typeof C[camel] === 'function') { return false; }
    if (typeof C.render !== 'function') { return true; }
    /* render() must know the kind, not merely exist. */
    if (typeof C.kinds === 'function') { return C.kinds().indexOf(kind) === -1; }
    return false;
  });
  if (out.chart_unwired.length) {
    out.errors.push('chart kinds not wired: ' + out.chart_unwired.join(', '));
  }
  if (!out.chart_kinds.length) {
    out.errors.push('no drawChart kinds found in the built page');
  }
  out.pure = sandbox.App && sandbox.App._pure ? Object.keys(sandbox.App._pure).length : 0;
  out.ok = out.errors.length === 0 && out.globals.length === 3 &&
           out.keys_pl > 0 && out.keys_pl === out.keys_en && out.pure > 0;
} catch (e) { out.errors.push(String((e && e.message) || e)); }
process.stdout.write(JSON.stringify(out));
"""


class BuildError(Exception):
    """Any condition that must stop the build with a visible message."""


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def kb(n: int) -> str:
    return f"{n / 1024:.1f} KB"


def mb(n: int) -> str:
    return f"{n / (1024 * 1024):.2f} MB"


def say(line: str = "") -> None:
    print(line, flush=True)


def head(title: str) -> None:
    say()
    say(title)
    say("-" * 78)


def read_text(path: Path, label: str) -> str:
    if not path.is_file():
        raise BuildError(f"{label}: file not found -> {path}")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise BuildError(f"{label}: not valid UTF-8 -> {path} ({exc})") from exc


def node_check(source: str, label: str) -> tuple[bool, str]:
    """Parse ``source`` with ``node --check`` (fed through stdin)."""
    if not NODE.is_file():
        raise BuildError(f"node not found at {NODE}; cannot verify JavaScript")
    proc = subprocess.run(
        [str(NODE), "--check"],
        input=source.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    detail = proc.stdout.decode("utf-8", "replace").strip().splitlines()
    first = next((line for line in detail if "Error" in line), "")
    return proc.returncode == 0, f"{label}: {first}" if first else label


def run_in_engine_probe(out_path: Path) -> dict[str, Any]:
    """Execute the built page's script blocks in node and report what loaded."""
    proc = subprocess.run(
        [str(NODE), "-", str(out_path)],
        input=IN_ENGINE_PROBE.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    raw = proc.stdout.decode("utf-8", "replace").strip()
    if proc.returncode != 0 or not raw:
        stderr = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        return {"ok": False, "errors": [stderr[-1] if stderr else f"node exited {proc.returncode}"]}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"ok": False, "errors": [f"probe returned non-JSON: {raw[:120]}"]}


# --------------------------------------------------------------------------
# Payload escaping
# --------------------------------------------------------------------------


def escape_json_payload(text: str) -> str:
    """Make JSON safe inside a script element without changing what it decodes to."""
    escaped = (
        text.replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )
    if json.loads(escaped) != json.loads(text):
        raise BuildError("BUNDLE_JSON: escaping changed the decoded value")
    return escaped


def escape_js_payload(text: str, label: str) -> tuple[str, str]:
    """Escape ``</`` inside a JS payload and prove the escape is syntax-neutral.

    Returns ``(escaped_source, mode)``.  ``mode`` is ``"escaped"`` when the
    ``</`` -> ``<\\/`` rewrite parsed cleanly, and ``"verbatim"`` when the file
    provably contains no closing-tag sequence at all, so nothing had to change.
    """
    lowered = text.lower()
    for bad in ("</script", "<!--", "-->"):
        if bad in lowered:
            raise BuildError(
                f"{label}: contains the literal {bad!r}, which cannot be injected "
                "into a script element safely; fix the source file"
            )
    if "</" not in text:
        return text, "verbatim"
    escaped = text.replace("</", "<\\/")
    ok, detail = node_check(escaped, label)
    if ok:
        return escaped, "escaped"
    raise BuildError(
        f"{label}: the </ -> <\\/ escape broke the syntax ({detail}); "
        "the source uses '</' outside a string, a regex or a comment"
    )


def check_css_payload(text: str, label: str) -> str:
    lowered = text.lower()
    if "</style" in lowered:
        raise BuildError(f"{label}: contains '</style', which would end the style element")
    if "@import" in lowered:
        raise BuildError(f"{label}: contains an at-import rule; the page must be one file")
    return text


def check_svg_payload(text: str, label: str) -> str:
    stripped = text.strip()
    lowered = stripped.lower()
    if lowered.startswith("<?xml") or lowered.startswith("<!doctype"):
        raise BuildError(f"{label}: must be a bare svg element (no XML prolog, no doctype)")
    if not lowered.startswith("<svg") or not lowered.endswith("</svg>"):
        raise BuildError(f"{label}: must be exactly one svg element")
    return stripped


# --------------------------------------------------------------------------
# Log staging: never let a half-written episode reach the extractor
# --------------------------------------------------------------------------


def log_is_complete(text: str) -> tuple[bool, str]:
    """A log is usable once every line parses and a summary line exists."""
    has_manifest = False
    has_summary = False
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            return False, f"line {number} is half-written (episode still running)"
        kind = record.get("type")
        if kind == "manifest":
            has_manifest = True
        elif kind == "summary":
            has_summary = True
    if not has_manifest:
        return False, "no manifest line"
    if not has_summary:
        return False, "no summary line (episode in flight)"
    return True, ""


def scan_logs(source: Path) -> tuple[dict[str, str], list[tuple[str, str]]]:
    """Read every log in ``source`` once and split it into usable and in-flight.

    Reading once matters: the live directory is being appended to while this
    runs, so a file must be judged and copied from the same snapshot of bytes.
    """
    usable: dict[str, str] = {}
    skipped: list[tuple[str, str]] = []
    for path in sorted(source.glob("*.jsonl")):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            skipped.append((path.name, "half-written multi-byte character (episode still running)"))
            continue
        except OSError as exc:
            skipped.append((path.name, f"unreadable: {exc.strerror or exc}"))
            continue
        ok, reason = log_is_complete(text)
        if ok:
            usable[path.name] = text
        else:
            skipped.append((path.name, reason))
    return usable, skipped


def stage_logs(texts: dict[str, str], source: Path | None = None) -> Path:
    """Write the validated log bytes into a private staging directory.

    Modification times are carried over from the source logs.  Without that the
    staged copies all date from the build, and anything downstream that asks
    "when was this data produced" would answer "just now" for a run that may be
    weeks old.
    """
    if STAGE_DIR.exists():
        shutil.rmtree(STAGE_DIR)
    STAGE_DIR.mkdir(parents=True, exist_ok=True)
    for name, text in texts.items():
        target = STAGE_DIR / name
        target.write_text(text, encoding="utf-8")
        if source is not None:
            origin = source / name
            try:
                stamp = origin.stat()
            except OSError:
                continue
            os.utime(target, (stamp.st_atime, stamp.st_mtime))
    return STAGE_DIR


def split_episode_logs(names: Iterable[str], parse_log_name) -> tuple[list[str], list[str]]:
    """Split log names into scored episodes and formatting/choice control probes."""
    episodes: list[str] = []
    probes: list[str] = []
    for name in sorted(names):
        try:
            _scenario, _rep, arm, variant, _key = parse_log_name(Path(name))
        except ValueError as exc:
            raise BuildError(
                f"{name}: not a DelibraShift episode log ({exc}); move it out of the log directory"
            ) from exc
        if arm == "control" or variant == "control":
            probes.append(name)
        else:
            episodes.append(name)
    return episodes, probes


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


def import_extract():
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    try:
        import extract  # noqa: PLC0415  (deliberate late import)
    except ModuleNotFoundError as exc:
        raise BuildError(
            f"cannot import extract.py ({exc}). Install the project first with "
            "python -m pip install -e '.[dev]'"
        ) from exc
    return extract


def run_extraction(extract, logs_dir: Path, packs_dir: Path, report_path: Path) -> None:
    """Point extract.py at the chosen inputs and let it rebuild the bundle."""
    extract.LOGS_DIR = logs_dir
    extract.PACKS_DIR = packs_dir
    extract.REPORT_PATH = report_path
    extract.OUT_PATH = BUNDLE_PATH
    code = extract.main()
    if code != 0:
        raise BuildError("extraction aborted (replay-correctness gate failed); bundle not rebuilt")


# --------------------------------------------------------------------------
# Assembly
# --------------------------------------------------------------------------


def build_meta_block(lang: str, logs_source: Path, staged: bool, built_at: str) -> str:
    """Head payload: build provenance plus the build-time language default.

    No user-visible copy lives here.  The language shim only forwards to
    ``App.setLang``, whose text still comes from ``assets/strings.js``.
    """
    lines = [
        '<meta name="generator" content="DelibraShift report/build_report.py">',
        f'<meta name="build-date" content="{built_at}">',
        f'<meta name="build-lang" content="{lang}">',
        f'<meta name="build-logs-source" content="{public_path(logs_source)}">',
        f'<meta name="build-logs-staged" content="{"yes" if staged else "no"}">',
    ]
    lines.append("<script>")
    lines.append("/* Build-time default language. A choice the viewer already made in this")
    lines.append("   browser always wins; this only replaces the built-in default on a first")
    lines.append("   visit. It runs on load, i.e. after App.init() has read storage. */")
    lines.append("(function () {")
    lines.append(f"  var WANTED = {json.dumps(lang)};")
    lines.append("  var stored = null;")
    lines.append("  try {")
    lines.append("    stored = window.localStorage && window.localStorage.getItem('cg.lang');")
    lines.append("  } catch (e) { stored = null; }")
    lines.append("  if (stored) { return; }")
    lines.append("  window.addEventListener('load', function () {")
    lines.append("    var root = document.documentElement;")
    lines.append("    if (root.getAttribute('lang') === WANTED) { return; }")
    lines.append("    if (window.App && window.App.setLang) { window.App.setLang(WANTED); }")
    lines.append("  });")
    lines.append("})();")
    lines.append("</script>")
    return "\n".join(lines)


def collect_payloads(lang: str, logs_source: Path, staged: bool, built_at: str) -> dict[str, dict[str, Any]]:
    """Load, check and escape every payload the template asks for."""
    out: dict[str, dict[str, Any]] = {}
    for name, relative, kind in PAYLOADS:
        if kind == "meta":
            text = build_meta_block(lang, logs_source, staged, built_at)
            out[name] = {"text": text, "kind": kind, "source": "generated", "raw_bytes": len(text.encode()), "note": f"lang={lang}"}
            continue

        path = ROOT / relative
        label = f"{name} ({relative})"
        raw = read_text(path, label)
        raw_bytes = len(raw.encode("utf-8"))
        note = ""
        if kind == "css":
            text = check_css_payload(raw, label)
            note = "no at-import, no closing style tag"
        elif kind == "svg":
            text = check_svg_payload(raw, label)
            note = "single svg element"
        elif kind == "js":
            text, mode = escape_js_payload(raw, label)
            note = f"{mode}, node --check ok" if mode == "escaped" else "verbatim (no '</' in source)"
        elif kind == "json":
            text = escape_json_payload(raw)
            note = "& < > U+2028 U+2029 escaped, round-trip verified"
        else:  # pragma: no cover - defensive
            raise BuildError(f"{label}: unknown payload kind {kind!r}")
        out[name] = {
            "text": text,
            "kind": kind,
            "source": relative,
            "raw_bytes": raw_bytes,
            "note": note,
        }
    return out


def set_document_language(document: str, lang: str) -> tuple[str, str]:
    """Label the root element with the build language before any script runs.

    Returns ``(document, note)``.  The runtime is still free to switch: app.js
    rewrites the attribute from the viewer's stored choice on init.
    """
    match = re.search(r'(<html\b[^>]*\blang=")([A-Za-z-]+)(")', document)
    if not match:
        return document, "no lang attribute on the html element (left untouched)"
    if match.group(2) == lang:
        return document, f'html lang="{lang}"'
    document = document[: match.start()] + match.group(1) + lang + match.group(3) + document[match.end() :]
    return document, f'html lang="{lang}" (template said "{match.group(2)}")'


def assemble(template: str, payloads: dict[str, dict[str, Any]]) -> str:
    """Replace every placeholder, refusing to guess about the ones it cannot."""
    found = MARKER_RE.findall(template)
    if not found:
        raise BuildError("template.html contains no placeholders; wrong file?")
    wanted = [name for name, _relative, _kind in PAYLOADS]
    unknown = sorted(set(found) - set(wanted))
    if unknown:
        raise BuildError(f"template.html asks for placeholders this build cannot fill: {unknown}")
    missing = sorted(set(wanted) - set(found))
    if missing:
        raise BuildError(f"payloads with no placeholder in template.html: {missing}")

    out = template
    for name in wanted:
        marker = f"{MARKER_OPEN}{name}-->"
        count = out.count(marker)
        if count != 1:
            raise BuildError(f"placeholder {name} appears {count} times, expected exactly 1")
        out = out.replace(marker, payloads[name]["text"], 1)
    return out


# --------------------------------------------------------------------------
# Validation of the written file
# --------------------------------------------------------------------------


class ExternalRefScanner(HTMLParser):
    """Collect every attribute that would make the browser reach for a second file.

    Only URL-bearing attributes are inspected; ``xmlns`` and friends name an XML
    namespace and are never fetched, so they are deliberately not in the set.
    Script and style bodies are handled by HTMLParser as character data, so a
    tag written inside a JS comment cannot produce a false positive.
    """

    URL_ATTRS = frozenset(
        {
            "src", "href", "xlink:href", "srcset", "imagesrcset", "poster", "data",
            "action", "formaction", "background", "manifest", "ping", "cite",
            "longdesc", "profile", "codebase", "archive", "usemap",
        }
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.offenders: list[tuple[str, str, str, str]] = []
        self.checked = 0
        self.tags = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags += 1
        table = {key.lower(): (value or "") for key, value in attrs}
        if tag == "base" and "href" in table:
            self.offenders.append((tag, "href", table["href"], "base tag rewrites relative URLs"))
        if tag == "meta" and "refresh" in table.get("http-equiv", "").lower():
            self._check(tag, "content", table.get("content", ""))
        for key, value in table.items():
            if key in self.URL_ATTRS:
                self._check(tag, key, value)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def _check(self, tag: str, attr: str, value: str) -> None:
        candidate = value.strip()
        if not candidate:
            return
        self.checked += 1
        lowered = candidate.lower()
        if lowered.startswith("#"):
            return
        if lowered.startswith("data:"):
            return
        if lowered.startswith("//"):
            self.offenders.append((tag, attr, candidate, "protocol-relative URL"))
            return
        scheme = re.match(r"[a-z][a-z0-9+.\-]*:", lowered)
        if scheme:
            self.offenders.append((tag, attr, candidate, f"remote scheme {scheme.group(0)}"))
            return
        self.offenders.append((tag, attr, candidate, "relative path (needs a second file)"))


def find_bundle_island(text: str) -> tuple[int, int, str]:
    """Return ``(start, end, json_text)`` of the embedded data island."""
    opener = re.search(r"<script[^>]*id=\"(?:cg-)?bundle\"[^>]*>", text)
    if not opener:
        raise BuildError("embedded JSON: data island not found in the output")
    start = opener.end()
    end = text.find("</script>", start)
    if end == -1:
        raise BuildError("embedded JSON: data island is not closed")
    return start, end, text[start:end]


class Validator:
    """Runs every gate, records PASS/FAIL rows, and never stops at the first failure."""

    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def add(self, ok: bool, name: str, detail: str) -> bool:
        self.rows.append((name, "PASS" if ok else "FAIL", detail))
        return ok

    def info(self, name: str, detail: str) -> None:
        self.rows.append((name, "INFO", detail))

    @property
    def failed(self) -> list[tuple[str, str, str]]:
        return [row for row in self.rows if row[1] == "FAIL"]

    def report(self) -> None:
        width = max(len(name) for name, _verdict, _detail in self.rows)
        for name, verdict, detail in self.rows:
            say(f"  {name:<{width}}  {verdict:<4}  {detail}")


def validate(
    out_path: Path,
    payloads: dict[str, dict[str, Any]],
    expected_episodes: int,
    log_counts: dict[str, int],
) -> tuple[Validator, dict[str, Any]]:
    validator = Validator()

    if not out_path.is_file():
        raise BuildError(f"output file was not written: {out_path}")
    data = out_path.read_bytes()
    size = len(data)
    validator.add(size > 0, "file written", f"{out_path} - {mb(size)} ({size} bytes)")

    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise BuildError(f"output is not valid UTF-8: {exc}") from exc
    validator.add(True, "encoding", "valid UTF-8, charset meta first in head")
    validator.add(
        text.lstrip().lower().startswith("<!doctype html>"), "doctype", "document starts with the HTML doctype"
    )
    validator.add("Świat" in text, "diacritics", "Polish diacritics survived the write (sample: 'Świat')")

    # 1. every payload is present, verbatim, and no placeholder survived
    survivors = MARKER_RE.findall(text)
    validator.add(not survivors, "placeholders", f"no placeholder left unfilled ({len(PAYLOADS)} filled)" if not survivors else f"still present: {survivors}")
    missing = [name for name, payload in payloads.items() if payload["text"] not in text]
    validator.add(not missing, "payload bytes", "every payload embedded verbatim" if not missing else f"missing: {missing}")

    # 2. no external references
    scanner = ExternalRefScanner()
    scanner.feed(text)
    scanner.close()
    validator.add(
        not scanner.offenders,
        "src/href attrs",
        f"{scanner.checked} URL attributes on {scanner.tags} tags, all local"
        if not scanner.offenders
        else "; ".join(f"<{tag} {attr}={value[:60]!r}> {why}" for tag, attr, value, why in scanner.offenders),
    )

    lowered = text.lower()
    hits = [token for token in FORBIDDEN_TOKENS if token.lower() in lowered]
    validator.add(
        not hits,
        "network APIs",
        "none of " + ", ".join(repr(token) for token in FORBIDDEN_TOKENS) if not hits else f"found: {hits}",
    )

    start, end, island = find_bundle_island(text)
    urls = [(match.start(), match.group(0)) for match in re.finditer(r"https?://[^\s\"'<>)\\]*", text)]
    outside = [url for offset, url in urls if not (start <= offset < end)]
    bad_urls = sorted({url for url in outside if not url.startswith(URL_ALLOWLIST)})
    validator.add(
        not bad_urls,
        "absolute URLs",
        f"{len(outside)} occurrences, all XML namespace identifiers" if not bad_urls else f"unexpected: {bad_urls}",
    )
    inside = len(urls) - len(outside)
    if inside:
        validator.info("URLs in data", f"{inside} URL-shaped strings inside the JSON island (data, never fetched)")

    # A protocol-relative reference carries no scheme, so the https?:// scan
    # above cannot see it - and the tag scanner deliberately treats <style> and
    # <script> bodies as character data, so it cannot see one there either.
    # url(//cdn.example/x.css) inside a stylesheet would fetch on a laptop with
    # a network and silently pass every other gate here.
    protocol_relative = sorted(
        {
            match.group(0)
            for match in re.finditer(r"""(?:url\(|["'\s])(//[A-Za-z0-9][^\s"'<>)\\]*)""", text)
            if not (start <= match.start() < end)
        }
    )
    validator.add(
        not protocol_relative,
        "protocol-relative",
        "no scheme-less remote reference"
        if not protocol_relative
        else f"unexpected: {protocol_relative[:5]}",
    )

    # 3. the embedded JSON parses
    try:
        bundle = json.loads(island)
    except json.JSONDecodeError as exc:
        validator.add(False, "embedded JSON", f"json.loads failed: {exc}")
        bundle = {}
    else:
        validator.add(
            isinstance(bundle, dict) and "episodes" in bundle and "meta" in bundle,
            "embedded JSON",
            f"parsed, {kb(len(island.encode()))} escaped, keys: {', '.join(sorted(bundle)[:6])}",
        )

    # 4. node --check on every JavaScript source
    js_rows = []
    all_ok = True
    for path in sorted(ASSETS_DIR.glob("*.js")):
        ok, detail = node_check(path.read_text(encoding="utf-8"), path.name)
        all_ok = all_ok and ok
        js_rows.append(f"{path.name}{'' if ok else ' FAILED: ' + detail}")
    validator.add(all_ok, "node --check", ", ".join(js_rows))

    probe = run_in_engine_probe(out_path)
    validator.add(
        bool(probe.get("ok")),
        "in-engine load",
        f"{probe.get('blocks')} script blocks executed, JSON.parse ok ({probe.get('episodes')} episodes), "
        f"STRINGS pl/en {probe.get('keys_pl')}/{probe.get('keys_en')}, "
        f"{'+'.join(probe.get('globals', []))} defined, App._pure {probe.get('pure')} fns"
        if probe.get("ok")
        else "; ".join(probe.get("errors", ["unknown failure"])),
    )

    kinds = probe.get("chart_kinds") or []
    unwired = probe.get("chart_unwired") or []
    validator.add(
        bool(kinds) and not unwired,
        "chart wiring",
        f"{len(kinds)} chart kind(s) requested by the shell, all resolved: {', '.join(sorted(kinds))}"
        if kinds and not unwired
        else (f"unwired: {unwired}" if kinds else "no drawChart kinds found"),
    )

    # 5. episode count against the number of log files
    n_episodes = len(bundle.get("episodes", []))
    declared = bundle.get("meta", {}).get("n_episodes")
    detail = (
        f"{n_episodes} episodes = {log_counts['episode_logs']} episode logs "
        f"({log_counts['files']} files, {log_counts['probes']} control probes, "
        f"{log_counts['skipped']} still being written)"
    )
    validator.add(n_episodes == expected_episodes, "episode count", detail if n_episodes == expected_episodes else f"MISMATCH: {n_episodes} in JSON vs {expected_episodes} expected ({detail})")
    validator.add(declared == n_episodes, "meta.n_episodes", f"meta says {declared}, array holds {n_episodes}")

    # 6. the three tabs
    absent = [tab_id for tab_id in TAB_IDS if f'id="{tab_id}"' not in text]
    validator.add(not absent, "tab identifiers", ", ".join(TAB_IDS) if not absent else f"missing: {absent}")

    facts = {"size": size, "bundle": bundle}
    return validator, facts


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="build_report.py",
        description="Weld template, assets and data into one offline HTML report.",
    )
    parser.add_argument(
        "--logs-dir",
        type=Path,
        default=None,
        help=f"directory with episode .jsonl logs (default: {DEFAULT_LOGS})",
    )
    parser.add_argument(
        "--packs-dir",
        type=Path,
        default=DEFAULT_PACK,
        help=f"scenario pack directory (default: {DEFAULT_PACK})",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT,
        help=f"run report written at the end of the experiment (default: {DEFAULT_REPORT})",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output file (default: {DEFAULT_OUT})")
    parser.add_argument("--lang", choices=LANGS, default="pl", help="build-time default UI language (default: pl)")
    parser.add_argument(
        "--skip-extract",
        action="store_true",
        help="reuse data/bundle.json instead of re-reading the logs (extraction still "
        "runs when the bundle is missing)",
    )
    return parser.parse_args(argv)


def resolve_logs_dir(requested: Path | None) -> tuple[Path, str]:
    if requested is not None:
        path = requested.expanduser().resolve()
        if not path.is_dir():
            raise BuildError(f"--logs-dir does not exist: {path}")
        if not any(path.glob("*.jsonl")) and (path / "logs").is_dir():
            path = path / "logs"
        if not any(path.glob("*.jsonl")):
            raise BuildError(f"--logs-dir holds no .jsonl logs: {path}")
        return path, "chosen with --logs-dir"
    if DEFAULT_LOGS.is_dir() and any(DEFAULT_LOGS.glob("*.jsonl")):
        return DEFAULT_LOGS, "canonical repository results (read-only)"
    raise BuildError(f"no logs found in {DEFAULT_LOGS}")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    built_at = datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")

    out_path = args.out.expanduser().resolve()
    if ROOT not in out_path.parents:
        raise BuildError(f"--out must stay inside {ROOT} (this build writes nowhere else): {out_path}")

    extract = import_extract()

    # ---- 1. sources ------------------------------------------------------
    head("[1/5] SOURCES")
    packs_dir = args.packs_dir.expanduser().resolve()
    if not (packs_dir / "pack.json").is_file():
        raise BuildError(f"--packs-dir has no pack.json: {packs_dir}")
    report_path = args.report.expanduser().resolve()
    report_present = report_path.is_file()

    # Reusing a bundle means the logs it was built from are the ones the count
    # gate has to be measured against, so the live directory is not even read.
    reuse_bundle = args.skip_extract and BUNDLE_PATH.is_file()
    if reuse_bundle:
        if not SOURCES_PATH.is_file():
            raise BuildError(
                f"--skip-extract: {SOURCES_PATH.name} is missing, so the bundle cannot be checked "
                "against the logs it was built from; rerun without the flag"
            )
        sidecar = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
        logs_dir = Path(sidecar["logs_dir"])
        read_dir = Path(sidecar["read_dir"])
        staged = bool(sidecar["staged"])
        episode_logs = list(sidecar["episode_logs"])
        probe_logs = list(sidecar["probe_logs"])
        skipped = [tuple(row) for row in sidecar["skipped"]]
        why = f"recorded in {SOURCES_PATH.name} (--skip-extract)"
        if args.logs_dir is not None:
            say("  note      --logs-dir is ignored together with --skip-extract")
    else:
        logs_dir, why = resolve_logs_dir(args.logs_dir)
        usable, skipped = scan_logs(logs_dir)
        if not usable:
            raise BuildError(f"no complete episode log in {logs_dir}")
        # A directory outside this repository is the live run and keeps growing,
        # so it is always copied first.  A directory inside the repository is a
        # frozen snapshot and is read in place - unless it turns out to hold a
        # half-written log, in which case it is copied too so that the extractor
        # never sees the stump.
        staged = PROJECT_ROOT not in logs_dir.parents or bool(skipped)
        read_dir = stage_logs(usable, logs_dir) if staged else logs_dir
        episode_logs, probe_logs = split_episode_logs(usable, extract.parse_log_name)

    log_counts = {
        "files": len(episode_logs) + len(probe_logs) + len(skipped),
        "episode_logs": len(episode_logs),
        "probes": len(probe_logs),
        "skipped": len(skipped),
    }

    say(f"  logs      {logs_dir}  ({why})")
    say(f"            {log_counts['files']} files: {log_counts['episode_logs']} episodes, "
        f"{log_counts['probes']} control probes, {log_counts['skipped']} incomplete")
    for name, reason in skipped:
        say(f"            SKIPPED {name}: {reason}")
    if staged and not reuse_bundle:
        say(f"  staged    {read_dir}  (byte-identical copy; the source directory is never written)")
    say(f"  packs     {packs_dir}")
    say(f"  report    {report_path}  ({'present -> run finished' if report_present else 'missing -> run still in flight'})")
    say(f"  out       {out_path}")
    say(f"  language  {args.lang} (default of the built file; the viewer can switch)")

    # ---- 2. extraction ---------------------------------------------------
    head("[2/5] EXTRACTION")
    if reuse_bundle:
        say(f"  --skip-extract: reusing {BUNDLE_PATH} ({kb(BUNDLE_PATH.stat().st_size)})")
        say(f"  it was extracted from {logs_dir} at {sidecar.get('built_at', 'unknown time')}")
        say("  rerun without the flag to pick up episodes finished since then")
    else:
        if args.skip_extract:
            say("  --skip-extract given but data/bundle.json is missing -> extracting anyway")
        run_extraction(extract, read_dir, packs_dir, report_path)
        SOURCES_PATH.write_text(
            json.dumps(
                {
                    "built_at": built_at,
                    "logs_dir": str(logs_dir),
                    "read_dir": str(read_dir),
                    "staged": staged,
                    "packs_dir": str(packs_dir),
                    "report_path": str(report_path) if report_present else None,
                    "episode_logs": episode_logs,
                    "probe_logs": probe_logs,
                    "skipped": [list(row) for row in skipped],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        say(f"  sources recorded in {SOURCES_PATH}")

    # ---- 3. assembly -----------------------------------------------------
    head("[3/5] ASSEMBLY")
    template = read_text(TEMPLATE_PATH, "template.html")
    payloads = collect_payloads(args.lang, logs_dir, staged, built_at)
    document = assemble(template, payloads)
    document, lang_note = set_document_language(document, args.lang)
    for name, _relative, _kind in PAYLOADS:
        payload = payloads[name]
        say(f"  {name:<12} {payload['source']:<20} {kb(payload['raw_bytes']):>10}  {payload['note']}")
    say(f"  {'TEMPLATE':<12} {'template.html':<20} {kb(len(template.encode())):>10}  {len(PAYLOADS)} placeholders filled")
    say(f"  {'DOCUMENT':<12} {'root element':<20} {'':>10}  {lang_note}")

    # ---- 4. write --------------------------------------------------------
    head("[4/5] WRITE")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(document, encoding="utf-8")
    say(f"  {out_path}  {mb(len(document.encode()))}")

    # ---- 5. validation ---------------------------------------------------
    head("[5/5] VALIDATION")
    validator, facts = validate(out_path, payloads, len(episode_logs), log_counts)
    validator.report()
    if validator.failed:
        say()
        say(f"BUILD FAILED: {len(validator.failed)} validation gate(s) did not pass.")
        return 1

    bundle = facts["bundle"]
    meta = bundle.get("meta", {})
    n_cycles = sum(len(episode.get("cycles", [])) for episode in bundle.get("episodes", []))
    status = "bieg zakonczony" if meta.get("run_complete") else "bieg w toku"
    reason = "report.json present" if meta.get("report_present") else "report.json not written yet"

    head("SUMMARY")
    say(f"  file        {out_path}")
    say(f"  size        {mb(facts['size'])} ({facts['size']} bytes)")
    say(f"  episodes    {len(bundle.get('episodes', []))}")
    say(f"  scenarios   {len(bundle.get('scenarios', {}))}")
    say(f"  cycles      {n_cycles}")
    say(f"  probes      {len(bundle.get('probes', []))}")
    say(f"  pairs       {len(bundle.get('feedback', []))} matched normal/decoy pairs")
    say(f"  model       {meta.get('model') or 'unknown'}")
    say(f"  status      {status} ({reason})")
    say(f"  language    {args.lang}")
    say()
    say("  open the generated file directly in a browser; no server is needed")
    say()
    say("BUILD OK - open the file directly, no server needed.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BuildError as error:
        print(f"\nBUILD FAILED: {error}", file=sys.stderr)
        sys.exit(1)
