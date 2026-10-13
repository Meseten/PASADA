# -*- mode: python ; coding: utf-8 -*-
# Auto-generated spec from `pyinstaller main.py`, switched to ONEDIR like the
# other engine specs (see pasada-backend.spec for the reason). Prefer
# pasada-backend.spec for real builds — it carries the templates and the full
# hidden-import list; this one exists only so a bare `pyinstaller main.py`
# re-run cannot quietly reproduce the slow onefile bundle.

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='main',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='main',
)
