# PASADA UPDATER — GO-LIVE RUNBOOK

For the day this repository goes public. Everything below was verified on the
v0.82.5 release pipeline; the ONLY thing currently stopping updates is that
GitHub returns 404 to anonymous reads when a repo is private, and office
machines read anonymously.

## What should already have happened by v0.82.5 (verified 2026-10-13)

- Every push to `main` bumps the patch version from `.github/version.txt`
  (`0.82.5`), stamps it into `frontend/src-tauri/tauri.conf.json`, `Cargo.toml`,
  and `APP_VERSION` on the settings page, tags `v<version>`, builds the signed
  NSIS installer, and publishes the release — all in
  `.github/workflows/release.yml`. This ran green: tag `v0.82.5`, assets
  `PASADA_0.82.5_x64-setup.exe(.sig)` and the `.msi` pair, plus `latest.json`
  (696 bytes) whose manifest carries a `windows-x86_64` entry with signature
  and download URL.
- The updater manifest endpoint is
  `https://github.com/Meseten/PASADA/releases/latest/download/latest.json`
  (`frontend/src-tauri/tauri.conf.json` → `plugins.updater.endpoints`), the
  minisign public key is embedded beside it, and `createUpdaterArtifacts: true`
  produces the `.sig` sidecars the manifest embeds.
- The app side is complete: `check_for_app_update` (version probe only, never
  downloads), `prepare_app_update` (background download + signature verify,
  cached for install), `install_app_update` (kill sidecar → install → restart)
  in `frontend/src-tauri/src/lib.rs`, driven by the Settings ▸ App Updates card
  (`src/app/settings/UpdateCard.tsx`) with the check-schedule and install-
  preference selectors, idle-install guard, and plain-language error mapping.

## The blocker and the flip

The repo is private today, so anonymous `releases/latest/download/latest.json`
answers 404 and every installed app reports "No update was found to compare
with". That error message is CORRECT behavior, not a bug.

Going public is the entire fix — no code changes, no manifest rewrite, no
re-release needed. The v0.82.5 assets become readable the moment the repo is
public, and the next push to `main` releases exactly as before.

Flip-day, in Settings ▸ General ▸ Danger Zone on github.com: change visibility
to Public. Done.

## 5-minute go-live checklist (do this once)

1. On an office machine (or any Windows box outside your LAN) with an older
   PASADA installed (v0.82.4 or earlier is ideal — anything below the newest
   release tag), open PASADA.
2. Settings ▸ App Updates ▸ **Check for Updates**. Expected within ~10 s:
   the blue "New version found: 0.82.?" badge — NOT the network-blame message.
   Press **Install** and let the machine restart into the new version.
3. After restart, verify Help/Settings shows the new `APP_VERSION`.
4. Press Check once more: expected is the green "Up to date" badge.
5. One negative path worth 30 seconds: unplug the internet, press Check,
   confirm you get the friendly "could not reach the update page" line, then
   reconnect. Nothing should have been downloaded or changed.

## If the check fails after the flip

- "No update was found to compare with" on a machine ALREADY at the newest
  release is correct ("Up to date" is what it means there).
- That message on a machine at an OLD version means GitHub still isn't serving
  the manifest: check `https://github.com/Meseten/PASADA/releases/latest/`
  in a signed-out (private) browser window. If the page 404s, visibility
  didn't take effect; if the page is empty of `latest.json`, the last release
  workflow run failed — check the Actions tab before touching anything in the
  repo.
- A red "could not be proven official" means signature/key mismatch: do NOT
  try to force it. The build key and the embedded pubkey (`tauri.conf.json`
  → `plugins.updater.pubkey`) must come from the same `tauri signer generate`
  pair; the CI secrets (`TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`) hold the
  signing half.
- Offline offices: nothing here requires them to change. LAN copies of the
  `...-setup.exe` installer keep working; the updater only ever talks to
  GitHub when someone presses Check (or the daily/weekly schedule fires).

## Standing notes

- The office's SQLite data lives OUTSIDE the app folder; install/uninstall/
  update never touches it. That is asserted by the data-dir layout
  (`PASADA_DATA_DIR` in `backend/database.py`) and is the reason updates are
  safe on records.
- `latest.json` lists ONLY the Windows package today. The Linux Tauri build is
  desktop-runnable but the updater's platform lookup returns "no package for
  this operating system" and the card says so plainly — expected until a Linux
  artifact is added to the release workflow.
- Repo events to watch once, in the Actions tab: `Release PASADA` on the next
  `main` push after the flip should go green end-to-end (version bump →
  PyInstaller backend → signed Tauri build → release publish). If it fails at
  "Generate latest.json", the previous run's artifacts are intact and no
  published release was corrupted.
