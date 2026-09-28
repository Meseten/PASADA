# Releasing PASADA

## How releases work (fully automatic)

One workflow, one command. Every push to `main` is a release — no version
editing, no tag commands, ever.

| Workflow | Trigger | Job |
|----------|---------|-----|
| `release.yml` | every push to `main`, `v*` tags, or manual run | bumps the version, stamps it into the app, tags the commit, builds the signed installer, publishes the GitHub Release |

There is no `build.yml` anymore; `release.yml` replaces it.

## What you do

```bash
git add -A && git commit -m "what you changed" && git push origin main
```

That is the whole ritual. The workflow then:

1. Reads `.github/version.txt` (the version source of truth, currently
   `0.82.1`) and bumps the PATCH number: `0.82.1` → `0.82.2`.
2. Stamps that version into `tauri.conf.json`, `Cargo.toml`, and `APP_VERSION`
   in the settings page, so the installer, updater manifest, and About page
   always agree.
3. Commits `.github/version.txt` back to `main` as
   `chore: release v0.82.2 [skip ci]` (the `[skip ci]` marker stops the bump
   commit from re-triggering the workflow) and tags the commit `v0.82.2`.
4. Builds the Python backend and the signed Tauri frontend.
5. Publishes a GitHub Release with the installer, signatures, and
   `latest.json`. Office machines pick it up through Settings > General >
   App Updates > Check for Updates.

Pushing a `v*` tag by hand also works and releases exactly that version
without bumping — useful for re-running a broken release.

## Version numbering

Versions increase automatically: one commit on `main` = one PATCH bump
(`0.82.1` → `0.82.2` → `0.82.3` ...). There is no manual bumping to forget.

When *you* want a MINOR or MAJOR jump — a feature release or a breaking
change — edit `.github/version.txt` once in a normal commit, for example to
`0.83.0`. The next push to main releases `0.83.1` from that base.

| Bump | When |
|------|------|
| PATCH `0.82.2` | automatic: every push to main |
| MINOR `0.83.0` | you edit `.github/version.txt` when a feature set ships |
| MAJOR `1.0.0` | you edit `.github/version.txt` for breaking changes |

## Where the version lives now

1. `.github/version.txt` — the single source of truth. The workflow owns it;
   you only touch it for MINOR/MAJOR jumps.
2. `tauri.conf.json`, `Cargo.toml`, `APP_VERSION` — written automatically by
   the workflow at build time. Do not edit them by hand anymore; the next
   release overwrites whatever is there.

## One-time setup: signing key

The updater refuses unsigned bundles, so generate a key pair once on any
machine with the repo checked out:

```bash
cd frontend
npx tauri signer generate -w ~/.tauri/pasada.key
```

- Copy the **public key** (printed to the terminal) into
  `frontend/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
- Keep the private key file and its passphrase safe; the private key must
  never be committed. Lose it and every already-installed copy can never
  auto-update again.
- In the GitHub repo: Settings > Secrets and variables > Actions, add
  `TAURI_SIGNING_PRIVATE_KEY` (the key file contents) and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the passphrase).

## What the release pipeline produces

`release.yml` runs on `windows-latest` and publishes to the release page:

| File | What it is |
|------|------------|
| `PASADA_<ver>_x64-setup.exe` | NSIS installer for new installs; also the updater bundle |
| `PASADA_<ver>_x64-setup.exe.sig` | minisign signature of the installer |
| `PASADA_<ver>_x64_en-US.msi` (+ `.sig`) | MSI alternative |
| `latest.json` | updater manifest: version, download URL, signature |

Tauri v2 with `createUpdaterArtifacts: true` produces **no `.zip` updater
bundle on Windows**; the updater downloads and verifies the installer itself.
The `latest.json` generator uses the v2 layout (`.exe`/`.msi` + `.sig`).

## What end users experience

- **New installs:** download `PASADA_..._x64-setup.exe` from the release page
  and run it. That is the only time an installer file is needed.
- **Existing installs:** PASADA checks GitHub Releases when someone opens
  Settings > General, finds the App Updates card, and clicks *Check for
  Updates*. The app downloads the signed update, verifies the signature
  against the embedded public key, and restarts into the new version.
- **Data safety:** the SQLite database lives outside the install directory
  (`platformdirs` user data dir), so updates never touch the records.

## Release troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `No signed updater artifacts found` | The asset-copy step found no `.exe`/`.msi` + `.sig` pairs. Open the "Prepare release assets" step log: it lists `release-assets/`. If empty, the Tauri build failed upstream or signing secrets are wrong. |
| `A public key has been found, but no private key` | `TAURI_SIGNING_PRIVATE_KEY` missing/empty at build time. The workflow fails fast on this before the compile. Paste the **private** key contents (starts with `untrusted comment: minisign encrypted secret key`), not the `.pub` file. |
| `checksum error` on install | The installer and the `.sig` on the release page are from different builds. Re-run the release; never hand-swap files. |
| Updater says up to date but a newer release exists | The installed app's version is not lower than the manifest's. Next push to main bumps the patch again and clears it. |
| Workflow skips the release step on a bump commit | Expected: commits containing `[skip ci]` never re-trigger workflows. |
| Version jumped unexpectedly | Every push to main bumps the patch, including doc fixes. Harmless; no action needed. |
