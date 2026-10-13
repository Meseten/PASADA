# -*- mode: python ; coding: utf-8 -*-
# Build BOTH the Linux engine and the Windows engine from this one spec file,
# in ONEDIR mode (a folder holding the exe plus its libraries).
#
#   pyinstaller --clean --noconfirm pasada-backend.spec
#     -> dist/pasada-backend/pasada-backend(.exe)   + dist/pasada-backend/_internal/
#
# WHY ONEDIR, NOT ONEFILE: the onefile bundle self-extracted ~106 MB into a
# temp directory on EVERY launch — measured as ~8-10s of the office's first
# boot before uvicorn even started, no matter how fast the app itself was.
# Onedir pays the unpack once at install time; cold launch skips straight to
# interpreter import (~x2 faster bind, verified on Linux). The Tauri shell
# carries the WHOLE dist folder as a bundle resource; see
# frontend/src-tauri/tauri.conf.json (bundle.resources) and the spawn logic in
# frontend/src-tauri/src/lib.rs.
#
# The templates (template.docx, dashboard_template.docx) are bundled inside the
# folder, and every hidden import the engine needs is listed here — so no more
# long --hidden-import lines on the command line.

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('template.docx', '.'),
        ('dashboard_template.docx', '.'),
    ],
    hiddenimports=[
        # uvicorn's optional parts are imported dynamically at runtime
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.protocols.websockets.wsproto_impl',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.asyncio',
        # cryptography backend for python-jose (JWT)
        'jose',
        'jose.jwt',
        'jose.backends',
        'jose.backends.cryptography_backend',
        # passlib's bcrypt backend is imported by string name
        'passlib.handlers.bcrypt',
        # imported by string name / older alias
        'python_multipart',
        'multipart',
        'anyio._backends._asyncio',
        # used inside functions (lazy imports PyInstaller cannot see)
        'pypdf',
        'psutil',
    ],
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
    name='pasada-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    # UPX OFF everywhere (belt for the --noupx CLI builds too).
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
    name='pasada-backend',
)
