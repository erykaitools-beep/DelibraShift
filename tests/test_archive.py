from __future__ import annotations

import hashlib
import json
from pathlib import Path
import warnings
import zipfile

import pytest

from delibrashift.archive import build_pack_archive, verify_pack_archive
from delibrashift.bank import PackError
from delibrashift.types import canonical_json
from _symlink_contract import symlink_or_skip


PACK = Path(__file__).parents[1] / "packs" / "core_v0"


def write_manifest(path, payload) -> None:
    path.write_text(canonical_json(payload) + "\n", encoding="utf-8")


def replace_archive(built, entries) -> dict:
    names = [name for name, _ in entries]
    with warnings.catch_warnings():
        if len(names) != len(set(names)):
            warnings.filterwarnings(
                "ignore",
                message="Duplicate name:",
                category=UserWarning,
            )
        with zipfile.ZipFile(built.archive_path, "w") as archive:
            for name, payload in entries:
                archive.writestr(name, payload)
    manifest = json.loads(built.manifest_path.read_text(encoding="utf-8"))
    manifest["archive_sha256"] = hashlib.sha256(
        built.archive_path.read_bytes()
    ).hexdigest()
    unique_entries = dict(entries)
    manifest["members"] = [
        {"path": name, "sha256": hashlib.sha256(payload).hexdigest()}
        for name, payload in unique_entries.items()
    ]
    write_manifest(built.manifest_path, manifest)
    return manifest


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


@pytest.mark.parametrize("field", ("name", "version"))
@pytest.mark.parametrize("label", (".", "..", "unsafe/name", "unsafe\\name"))
def test_pack_archive_rejects_unsafe_name_or_version(tmp_path, field, label) -> None:
    pack = tmp_path / "pack"
    pack.mkdir()
    manifest = json.loads((PACK / "pack.json").read_text(encoding="utf-8"))
    manifest[field] = label
    (pack / "pack.json").write_text(json.dumps(manifest), encoding="utf-8")
    symlink_or_skip(
        pack / "scenarios",
        PACK / "scenarios",
        target_is_directory=True,
    )
    with pytest.raises(PackError, match="archive-safe"):
        build_pack_archive(pack, tmp_path / "dist")


@pytest.mark.parametrize(
    "mutation",
    (
        lambda payload: payload.update({"archive": "other.zip"}),
        lambda payload: payload.update({"members": {}}),
        lambda payload: payload.update({"members": ["not-an-object"]}),
        lambda payload: payload.update({"members": [{"path": "x"}]}),
        lambda payload: payload.update(
            {"members": [payload["members"][0], payload["members"][0]]}
        ),
        lambda payload: payload.update({"name": None}),
        lambda payload: payload.update({"version": None}),
        lambda payload: payload.update({"schema_version": None}),
        lambda payload: payload.update({"scenario_ids": [1]}),
        lambda payload: payload.update({"unknown": True}),
        lambda payload: payload["members"][0].update({"unknown": True}),
    ),
)
def test_pack_archive_verifier_rejects_malformed_sidecar_fields(
    tmp_path,
    mutation,
) -> None:
    built = build_pack_archive(PACK, tmp_path)
    manifest = json.loads(built.manifest_path.read_text(encoding="utf-8"))
    mutation(manifest)
    write_manifest(built.manifest_path, manifest)
    assert not verify_pack_archive(built.archive_path, built.manifest_path)


def test_pack_archive_verifier_requires_canonical_sidecar_without_duplicates(
    tmp_path,
) -> None:
    built = build_pack_archive(PACK, tmp_path / "whitespace")
    manifest = json.loads(built.manifest_path.read_text(encoding="utf-8"))
    built.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    assert not verify_pack_archive(built.archive_path, built.manifest_path)

    built = build_pack_archive(PACK, tmp_path / "duplicate")
    contents = built.manifest_path.read_text(encoding="utf-8")
    duplicate = contents.replace(
        '{"archive":',
        '{"archive":"ignored.zip","archive":',
        1,
    )
    built.manifest_path.write_text(duplicate, encoding="utf-8")
    assert not verify_pack_archive(built.archive_path, built.manifest_path)


@pytest.mark.parametrize("payload", ("{", "[]", "\udcff"))
def test_pack_archive_verifier_rejects_unreadable_or_nonobject_sidecar(
    tmp_path,
    payload,
) -> None:
    built = build_pack_archive(PACK, tmp_path)
    if payload == "\udcff":
        built.manifest_path.write_bytes(b"\xff")
    else:
        built.manifest_path.write_text(payload, encoding="utf-8")
    assert not verify_pack_archive(built.archive_path, built.manifest_path)


def test_pack_archive_verifier_rejects_missing_files(tmp_path) -> None:
    built = build_pack_archive(PACK, tmp_path)
    assert not verify_pack_archive(tmp_path / "missing.zip", built.manifest_path)
    assert not verify_pack_archive(built.archive_path, tmp_path / "missing.json")


@pytest.mark.parametrize(
    "entries",
    (
        (("core_v0/pack.json", b"{}"), ("core_v0/pack.json", b"{}")),
        (("core_v0/pack.json", b"{}"), ("core_v0/../escape.json", b"x")),
        (("core_v0/pack.json", b"{}"), ("core_v0\\escape.json", b"x")),
        (("core_v0/pack.json", b"{}"), ("/absolute.json", b"x")),
        (("other/pack.json", b"{}"),),
        (("core_v0/scenarios/only.json", b"{}"),),
    ),
)
def test_pack_archive_verifier_rejects_unsafe_or_incomplete_member_sets(
    tmp_path,
    entries,
) -> None:
    built = build_pack_archive(PACK, tmp_path)
    replace_archive(built, entries)
    assert not verify_pack_archive(built.archive_path, built.manifest_path)


def test_pack_archive_verifier_rejects_bad_zip_or_member_digest(tmp_path) -> None:
    built = build_pack_archive(PACK, tmp_path / "bad-zip")
    manifest = json.loads(built.manifest_path.read_text(encoding="utf-8"))
    built.archive_path.write_bytes(b"not a zip")
    manifest["archive_sha256"] = hashlib.sha256(b"not a zip").hexdigest()
    write_manifest(built.manifest_path, manifest)
    assert not verify_pack_archive(built.archive_path, built.manifest_path)

    built = build_pack_archive(PACK, tmp_path / "bad-digest")
    manifest = json.loads(built.manifest_path.read_text(encoding="utf-8"))
    manifest["members"][0]["sha256"] = "0" * 64
    write_manifest(built.manifest_path, manifest)
    assert not verify_pack_archive(built.archive_path, built.manifest_path)
