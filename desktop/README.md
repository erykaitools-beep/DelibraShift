# DelibraShift Lab Desktop — coming soon

This branch contains the first installable-app preview. The UI is a native
`pywebview` window backed by the existing deterministic Python engine. It does
not call an API, load a CDN, or require an LLM.

## Run from a checkout

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[desktop]'
delibrashift-lab
```

Use `delibrashift-lab --pack /path/to/pack` to open another compatible local
pack, or `delibrashift-lab --debug` to expose the webview developer tools.

Linux needs a WebKit/GTK or Qt webview renderer supplied by the operating
system. The exact package name differs by distribution. Windows uses its
installed WebView2 runtime and macOS uses the system WebKit view.

## Build a self-contained application folder

PyInstaller builds for the operating system on which it runs; build Windows
artifacts on Windows, macOS artifacts on macOS, and Linux artifacts on Linux.

```bash
python -m pip install -e '.[desktop,bundle]'
python -m PyInstaller --noconfirm --clean desktop/DelibraShiftLab.spec
```

The runnable onedir bundle is written to `dist/DelibraShiftLab/`. It contains
the offline UI, the MIT license, and `core_v0`. Onedir is intentional for the
preview: startup is faster and renderer/library failures are easier to audit
than with an opaque one-file executable.

## Visual smoke test

After installing the report's pinned Playwright development dependency, the
desktop UI can be exercised in real headless Chromium against a real canonical
run:

```bash
node desktop/tests/visual_smoke.js
```

The check rejects JavaScript errors and remote requests, exercises Step,
verifies that the arena canvas is painted, and writes a temporary screenshot.

## Scientific boundary

The desktop layer does not define physics or scoring. It calls
`run_episode`, reconstructs the inclusive trace with `step` and
`latch_action`, and rejects a trace whose final state differs from the
canonical result. Playback speed changes only the visualization.
