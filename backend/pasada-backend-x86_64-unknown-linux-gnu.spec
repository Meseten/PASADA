# -*- mode: python ; coding: utf-8 -*-
# ONEDIR build for the Linux engine (kept as its own spec so the historical
# dist/pasada-backend-x86_64-unknown-linux-gnu name keeps its home). See
# pasada-backend.spec for WHY the engine moved from onefile to onedir.
#
#   pyinstaller --clean --noconfirm pasada-backend-x86_64-unknown-linux-gnu.spec

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[('template.docx', '.'), ('dashboard_template.docx', '.')],
    hiddenimports=['passlib.handlers.bcrypt', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.websockets.auto', 'multipart', 'anyio._backends._asyncio', 'psutil', 'jose', 'pypdf'],
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
    name='pasada-backend-x86_64-unknown-linux-gnu',
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
    name='pasada-backend-x86_64-unknown-linux-gnu',
)
