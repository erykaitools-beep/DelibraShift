from __future__ import annotations

import json
from pathlib import Path
import zipfile

from delibrashift.archive import build_pack_archive, verify_pack_archive


PACK = Path(__file__).parents[1] / "packs" / "core_v0"


def test_pack_archive_is_byte_reproducible_and_verifiable(tmp_path) -> None:
    first = build_pack_archive(PACK, tmp_path / "first")
    second = build_pack_archive(PACK, tmp_path / "second")
    assert first.sha256 == second.sha256
    assert first.archive_path.read_bytes() == second.archive_path.read_bytes()
    assert verify_pack_archive(first.archive_path, first.manifest_path)
    manifest = json.loads(first.manifest_path.read_text(encoding="utf-8"))
    assert manifest["version"] == "0.1.1"
    assert len(manifest["scenario_ids"]) == 12
    with zipfile.ZipFile(first.archive_path) as archive:
        assert archive.namelist()[0] == "core_v0/pack.json"
        assert len(archive.namelist()) == 13


def test_pack_archive_verifier_rejects_tampering(tmp_path) -> None:
    built = build_pack_archive(PACK, tmp_path)
    built.archive_path.write_bytes(built.archive_path.read_bytes() + b"tampered")
    assert not verify_pack_archive(built.archive_path, built.manifest_path)
