# Releasing PASADA

## Version numbering

PASADA follows semantic versioning: `MAJOR.MINOR.PATCH`

| Bump | When |
|------|------|
| **PATCH** (0.2.1) | Bug fixes only: wrong counts, print glitches, sync hiccups |
| **MINOR** (0.3.0) | New features: new reports, new settings, import improvements |
| **MAJOR** (1.0.0) | Breaking changes: database schema requiring manual migration, changed SBN formats, UI overhaul |

While the product is pre-1.0, the leading `0.` signals that breaking changes
may still arrive in MINOR releases.

## Where the version lives

The version is declared in three places that must always match:

1. `frontend/src-tauri/tauri.conf.json` (`"version"`), the source of truth
2. `frontend/src-tauri/Cargo.toml` (`[package] version`)
3. `frontend/src/app/settings/page.tsx` (`APP_VERSION`)

The release workflow reads `tauri.conf.json` and names the release and the
updater manifest after it. Bump all three to the same number.

## One-time setup: signing key

The updater refuses unsigned bundles, so generate a key pair once on any
machine with the repo checked out:

```bash
cd frontend
npx tauri signer generate -w ~/.tauri/pasada.key
```

- Copy the **public key** (printed to the terminal) into
  `frontend/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`,
  replacing `REPLACE_WITH_TAURI_SIGNING_PUBLIC_KEY`.
- Keep the private key file and its passphrase safe; the private key must
  never be committed.
- In the GitHub repo: Settings > Secrets and variables > Actions, add
  `TAURI_SIGNING_PRIVATE_KEY` (the key file contents) and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the passphrase).

## Releasing a new version

```bash
# 1. bump the version in the three files above, then commit
git add -A && git commit -m "chore: bump version to 0.2.0"
# 2. tag and push
git tag v0.2.0
git push origin main v0.2.0
```

GitHub Actions builds the backend sidecar and the signed Tauri bundle, then
publishes a GitHub Release containing the NSIS installer, the MSI, the signed
`.zip` updater bundles, and `latest.json`.

## What end users experience

- **New installs:** download `PASADA_..._x64-setup.exe` from the release page
  and run it. That is the only time an installer file is needed.
- **Existing installs:** PASADA checks GitHub Releases when someone opens Settings > General,
  finds the App Updates card, and clicks *Check for Updates*. The app downloads
  the signed update, verifies the signature, and restarts itself. No zip
  files, no support visits.
- **Data safety:** the SQLite database lives outside the install directory
  (`platformdirs` user data dir), so updates never touch the records.
