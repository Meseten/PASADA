# -*- mode: python ; coding: utf-8 -*-
# Build BOTH the Linux engine and the Windows engine from this one spec file.
#
# On Linux (your Zorin machine) — builds the engine for testing / Linux .deb:
#   pyinstaller --clean --noconfirm pasada-backend.spec
#
# On Windows or in GitHub Actions — builds the engine that goes inside the .msi:
#   pyinstaller --clean --noconfirm pasada-backend.spec
#   (the exe comes out as dist/pasada-backend.exe — the Tauri sidecar is
#    expected at frontend/src-tauri/bin/pasada-backend-x86_64-pc-windows-msvc.exe)
#
# The templates (template.docx, dashboard_template.docx) are bundled inside the
# exe, and every hidden import the engine needs is listed here — so no more
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
    a.binaries,
    a.datas,
    [],
    name='pasada-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
