"""Run the dracarys END2END vs WM-SCAFFOLD matched pair."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .adapters import NIMAdapter
from .bank import load_pack, load_pack_metadata
from .experiments import run_matched_pair, write_matched_pair_report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", help="pack directory")
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--pace-rpm", type=float, default=40.0)
    parser.add_argument("--log-dir", default="results/m2/logs")
    parser.add_argument("--report", default="results/m2/report.json")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="required acknowledgement: this performs paid/external model calls",
    )
    args = parser.parse_args(argv)
    if not args.execute:
        parser.error("refusing external calls without --execute")
    metadata = load_pack_metadata(args.pack)
    report = run_matched_pair(
        load_pack(args.pack),
        NIMAdapter(),
        repetitions=args.repetitions,
        pace_rpm=args.pace_rpm,
        log_dir=args.log_dir,
        pack_name=str(metadata["name"]),
        pack_version=str(metadata["version"]),
    )
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    write_matched_pair_report(report, report_path)
    print(report_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
