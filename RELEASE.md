# Releasing PASADA

Installers are produced **on the Windows build machine** — the document
pipeline needs Microsoft Word, so they cannot be built on the Linux dev
machine (see README → "Packaging and deployment readiness"). There are two
ways to get a release out:

1. **CI (Windows-only):** push to `main`. `release.yml` bumps the patch
   version, stamps it, builds the signed Windows installer, and publishes the
   GitHub Release with `latest.json`. This is the routine path.
2. **By hand:** when CI is unavailable or you need a specific build, the steps
   below are exactly what CI runs, in the same order, on the Windows machine.

Either way the in-app updater reads the same endpoint, so the manual path must
produce byte-identical artifacts to CI's.

That endpoint is
`https://github.com/Meseten/PASADA/releases/latest/download/latest.json`, so a
release is not finished until that file is attached to a GitHub Release. If it
is missing or its `version` is not greater than the installed app's, every
office machine's *Check for Updates* silently reports "up to date".

## 1. Bump the version

(Skip this on the CI path — it stamps the version for you.) Four places must
agree. Pick the next version by hand (PATCH for fixes, MINOR for features,
MAJOR for breaking changes):

| File | Field |
|------|-------|
| `frontend/src-tauri/tauri.conf.json` | `"version"` |
| `frontend/src-tauri/Cargo.toml` | `version = "..."` |
| `frontend/src/app/settings/page.tsx` | `const APP_VERSION = "..."` |
| `.github/version.txt` | whole line (record of the current release) |

The installer filename, the About page, and the update manifest all read these
values; a mismatch makes the updater consider the new build "already
installed".

## 2. Build the Python sidecar

```bash
cd backend
pip install -r requirements.txt
pyinstaller --onefile \
  --hidden-import passlib.handlers.bcrypt --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops --hidden-import uvicorn.loops.auto \
  --hidden-import uvicorn.protocols.http.auto --hidden-import uvicorn.protocols.websockets.auto \
  --hidden-import python_multipart --hidden-import multipart \
  --hidden-import anyio._backends._asyncio --hidden-import psutil \
  --hidden-import jose --hidden-import pypdf \
  --hidden-import win32com --hidden-import pythoncom \
  --add-data "template.docx;." --add-data "dashboard_template.docx;." \
  --name pasada-backend-x86_64-pc-windows-msvc main.py
mkdir -p ../frontend/src-tauri/bin
cp dist/pasada-backend-x86_64-pc-windows-msvc.exe ../frontend/src-tauri/bin/
```

The binary name encodes the target triple — `tauri.conf.json` declares it as
`bundle.externalBin`, and the app will not start without it. `win32com` /
`pythoncom` exist only on Windows; they are what make Word-rendered PDFs work
in the packaged app.

## 3. Build and sign the Tauri app

```bash
cd frontend
npm install
set TAURI_SIGNING_PRIVATE_KEY=<key file contents>
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<passphrase>
npm run tauri build
```

(`export` instead of `set` under Git Bash.) The updater refuses unsigned
bundles, so the signing env vars are mandatory — without them the build
succeeds but produces no `.sig` files and step 4 fails.

Output lands in `frontend/src-tauri/target/release/bundle/`:

- `nsis/PASADA_<ver>_x64-setup.exe` (+ `.sig`) — new installs **and** the
  updater bundle (Tauri v2 `createUpdaterArtifacts: true` re-uses the
  installer; there is no `.zip`).
- `msi/PASADA_<ver>_x64_en-US.msi` (+ `.sig`) — alternative installer.

## 4. Generate `latest.json`

Collect the signed assets and build the manifest (run from the repo root):

```bash
mkdir -p release-assets
cp frontend/src-tauri/target/release/bundle/nsis/*.exe* release-assets/
cp frontend/src-tauri/target/release/bundle/msi/*.msi*   release-assets/

VERSION=<the version you stamped in step 1> python - <<'PY'
import json, os, glob, datetime

version = os.environ["VERSION"]
assets = {}
for pattern in ("release-assets/*x64-setup.exe", "release-assets/*.msi"):
    for path in glob.glob(pattern):
        name = os.path.basename(path)
        if os.path.exists(path + ".sig"):
            assets[name] = {
                "signature": open(path + ".sig").read().strip(),
                "url": f"https://github.com/Meseten/PASADA/releases/download/v{version}/{name}",
            }

if not assets:
    raise SystemExit("No signed updater artifacts: need x64-setup.exe + .sig (or .msi + .sig).")

setup = next((a for n, a in sorted(assets.items()) if n.endswith("x64-setup.exe")), None) \
        or list(assets.values())[0]

json.dump({
    "version": version,
    "notes": f"PASADA v{version}",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {"windows-x86_64": setup},
}, open("release-assets/latest.json", "w"), indent=2)
print(open("release-assets/latest.json").read())
PY
```

The download URLs must match the release tag **exactly** (`v<version>`), or
the updater 404s on every office machine.

## 5. Publish the GitHub Release

Upload the installers, their `.sig` files, **and** `latest.json` to a release
tagged `v<version>`. With the GitHub CLI:

```bash
gh release create "v$VERSION" --title "PASADA v$VERSION" release-assets/*
```

or by hand: GitHub → releases → Draft a new release → attach the files.

**Upload each file exactly once.** Re-uploading `latest.json` over an existing
asset fails with `update-a-release-asset ... Not Found` (hit in v0.82.3); if
that happens, delete the release and recreate it.

## 6. Verify before telling the office

1. The release page shows the installers, signatures, and `latest.json`.
2. On a machine with the **previous** version installed: Settings → General →
   App Updates → *Check for Updates* finds, downloads, verifies, and restarts
   into the new version.
3. Data survives: the SQLite database lives in the platform data dir, outside
   the install directory, so the update never touches records.

## Version numbering

| Bump | When |
|------|------|
| PATCH `0.82.5` | fixes |
| MINOR `0.83.0` | feature set |
| MAJOR `1.0.0` | breaking changes |

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Build succeeds but step 4 says "No signed updater artifacts" | Signing env vars were unset — no `.sig` files exist. Rebuild step 3 with them set; never hand-craft `.sig` files. |
| `A public key has been found, but no private key` | `TAURI_SIGNING_PRIVATE_KEY` missing or empty at build time. Paste the private key file contents (starts with `untrusted comment: minisign encrypted secret key`), not the `.pub` file. |
| App starts but the backend never answers | The sidecar binary name doesn't match `bundle.externalBin` / the target triple. Rebuild step 2 with the exact `--name`. |
| `checksum error` during update | Installer and `.sig` on the release page are from different builds. Rebuild and re-upload the pair; never hand-swap files. |
| *Check for Updates* says up to date though a newer release exists | Installed version ≥ manifest version — the stamped versions in step 1 disagreed. Fix the stamp and re-release. |
| Office machine never sees any release | `latest.json` missing from the release, or not the "latest" release. The endpoint is `releases/latest/download/latest.json`. |
