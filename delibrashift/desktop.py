"""Native pywebview entry point for the DelibraShift Lab preview."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

from .lab import LabEngine


def resolve_pack_path(explicit: str | Path | None = None) -> Path:
    """Find the built-in core pack in a checkout or a PyInstaller bundle."""
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(Path(explicit))
    if os.environ.get("DELIBRASHIFT_PACK"):
        candidates.append(Path(os.environ["DELIBRASHIFT_PACK"]))
    candidates.append(Path(__file__).resolve().parents[1] / "packs" / "core_v0")
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        candidates.append(Path(bundle_root) / "packs" / "core_v0")
    for candidate in candidates:
        if (candidate / "pack.json").is_file():
            return candidate.resolve()
    searched = ", ".join(str(path) for path in candidates)
    raise FileNotFoundError(f"cannot find core_v0 pack; searched: {searched}")


class DesktopAPI:
    """Small JS bridge; all scientific work remains in :class:`LabEngine`."""

    def __init__(self, engine: LabEngine) -> None:
        self.engine = engine

    def catalog(self) -> dict[str, object]:
        return self.engine.catalog()

    def run_scenario(
        self,
        scenario_id: str,
        agent_id: str,
        repetition: int = 0,
    ) -> dict[str, object]:
        return self.engine.run(scenario_id, agent_id, repetition)

    def save_last_run(self) -> dict[str, object]:
        if self.engine.last_result is None:
            return {"ok": False, "error": "Run an episode before exporting."}
        import webview

        destination = webview.windows[0].create_file_dialog(
            webview.FileDialog.SAVE,
            save_filename=self.engine.last_run_name or "delibrashift-run.jsonl",
        )
        if not destination:
            return {"ok": False, "cancelled": True}
        if isinstance(destination, (tuple, list)):
            destination = destination[0]
        path = self.engine.export_last_run(destination)
        return {"ok": True, "path": str(path)}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Launch the local DelibraShift Lab desktop preview."
    )
    parser.add_argument("--pack", type=Path, help="scenario pack directory")
    parser.add_argument("--debug", action="store_true", help="enable webview debug tools")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        import webview
    except ImportError as error:
        raise SystemExit(
            "DelibraShift Lab needs the desktop extra: "
            "python -m pip install -e '.[desktop]'"
        ) from error

    engine = LabEngine(resolve_pack_path(args.pack))
    api = DesktopAPI(engine)
    index = Path(__file__).with_name("desktop_assets") / "index.html"
    webview.create_window(
        "DelibraShift Lab — Coming Soon",
        url=str(index),
        js_api=api,
        width=1440,
        height=900,
        min_size=(980, 680),
        background_color="#07111f",
        text_select=True,
    )
    webview.start(debug=args.debug)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
