# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path


root = Path(SPECPATH).parent
analysis = Analysis(
    [str(root / "tools" / "run_desktop.py")],
    pathex=[str(root)],
    binaries=[],
    datas=[
        (str(root / "delibrashift" / "desktop_assets"), "delibrashift/desktop_assets"),
        (str(root / "packs" / "core_v0"), "packs/core_v0"),
        (str(root / "LICENSE"), "."),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(analysis.pure)
exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="DelibraShiftLab",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
)
app = COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="DelibraShiftLab",
)
