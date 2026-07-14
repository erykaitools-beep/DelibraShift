"""Deterministic downloadable pack archives and SHA-256 sidecar manifests."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
import zipfile

from .bank import PackError, load_pack, load_pack_metadata
from .types import canonical_json


_SAFE_LABEL = re.compile(r"^[A-Za-z0-9._-]+$")
_ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


@dataclass(frozen=True)
class PackArchive:
    archive_path: Path
    manifest_path: Path
    sha256: str


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def build_pack_archive(
    pack_path: str | Path,
    output_dir: str | Path,
) -> PackArchive:
    """Build a byte-reproducible ZIP and canonical SHA-256 sidecar manifest."""
    root = Path(pack_path)
    metadata = load_pack_metadata(root)
    scenarios = load_pack(root)
    name = str(metadata["name"])
    version = str(metadata["version"])
    if not _SAFE_LABEL.fullmatch(name) or not _SAFE_LABEL.fullmatch(version):
        raise PackError("pack name and version must be archive-safe labels")
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    archive_path = destination / f"{name}-{version}.zip"
    manifest_path = destination / f"{name}-{version}.manifest.json"

    scenario_files = metadata["scenarios"]
    assert isinstance(scenario_files, list)
    source_files = [("pack.json", root / "pack.json")]
    source_files.extend(
        (f"scenarios/{filename}", root / "scenarios" / filename)
        for filename in scenario_files
    )
    members: list[dict[str, str]] = []
    with zipfile.ZipFile(archive_path, "w") as archive:
        for relative, source in source_files:
            payload = source.read_bytes()
            member_name = f"{name}/{relative}"
            info = zipfile.ZipInfo(member_name, date_time=_ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, payload)
            members.append({"path": member_name, "sha256": _sha256(payload)})

    archive_bytes = archive_path.read_bytes()
    archive_hash = _sha256(archive_bytes)
    manifest_payload = {
        "archive": archive_path.name,
        "archive_sha256": archive_hash,
        "name": name,
        "version": version,
        "schema_version": metadata["schema_version"],
        "scenario_ids": [config.scenario_id for config in scenarios],
        "members": members,
    }
    manifest_path.write_text(
        canonical_json(manifest_payload) + "\n",
        encoding="utf-8",
    )
    return PackArchive(archive_path, manifest_path, archive_hash)


def verify_pack_archive(
    archive_path: str | Path,
    manifest_path: str | Path,
) -> bool:
    """Verify the sidecar, exact member set, and every archived member hash."""
    archive_file = Path(archive_path)
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    if manifest.get("archive") != archive_file.name:
        return False
    if manifest.get("archive_sha256") != _sha256(archive_file.read_bytes()):
        return False
    members = manifest.get("members")
    if not isinstance(members, list):
        return False
    expected = {
        item.get("path"): item.get("sha256")
        for item in members
        if isinstance(item, dict)
    }
    if len(expected) != len(members) or None in expected:
        return False
    try:
        with zipfile.ZipFile(archive_file, "r") as archive:
            names = archive.namelist()
            root_name = manifest.get("name")
            if not isinstance(root_name, str):
                return False
            if len(names) != len(set(names)) or set(names) != set(expected):
                return False
            if any(
                Path(name).is_absolute()
                or ".." in Path(name).parts
                or not name.startswith(f"{root_name}/")
                for name in names
            ):
                return False
            return all(
                _sha256(archive.read(name)) == digest
                for name, digest in expected.items()
            )
    except (OSError, zipfile.BadZipFile, KeyError):
        return False
