"""Build a deterministic downloadable ChronoGym pack."""

from __future__ import annotations

import argparse
import sys

from .archive import build_pack_archive
from .types import canonical_json


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", help="source pack directory")
    parser.add_argument("--output-dir", default="dist", help="archive destination")
    args = parser.parse_args(argv)
    built = build_pack_archive(args.pack, args.output_dir)
    print(
        canonical_json(
            {
                "archive": str(built.archive_path),
                "manifest": str(built.manifest_path),
                "sha256": built.sha256,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
