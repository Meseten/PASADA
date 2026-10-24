# Testing PASADA on Linux (Zorin OS)

Two programs run at the same time: the **engine** (the hidden backend) and the
**screens** (what you see and click). Open two terminal windows.

## 1. Start the engine (Terminal 1)

```bash
cd pasada/backend
source venv/bin/activate
python main.py
```

Leave this window open. The engine listens on port 43888. If it starts fine,
you will see boot messages and no red errors.

To run a scratch instance that cannot touch the office database:

```bash
XDG_DATA_HOME=/tmp/pasada-dev PASADA_API_HOST=127.0.0.1 python main.py
```

The scratch instance auto-migrates its own database on first boot and its
first account closes signup on that instance only.

## 2. Start the screens (Terminal 2)

Zorin's built-in Node is too old, so point the terminal at Node 20 first:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd pasada/frontend
npm run dev
```

If npm packages are not installed yet on this machine, run `npm install` once
before `npm run dev`.

## 3. Open and log in

Open **http://localhost:3000** in the browser (Firefox is fine).

- Log in with your usual username and password.
- The screen waits up to ~60 seconds the first time while the engine loads the
  records. After that, everything is fast.

## 4. Try the login protection

1. Log out.
2. Type the right username but a WRONG password, 5 times.
   - Tries 1–4: the message says how many tries are left.
   - Try 5: the message says the account is locked for 15 minutes.
3. While locked, try the CORRECT password — it must still be refused.
4. Check the Logs page: a lock entry (`LOGIN_LOCKED`) is recorded.
5. To unlock immediately for testing, run the unlock command below (the
   lock now lives in the `login_lockouts` table so it also survives a
   restart — restarting the backend no longer clears it):

   sqlite3 "$HOME/.local/share/PASADA/pasada_production.db" \
     "DELETE FROM login_lockouts;"

   (Adjust the path to your `XDG_DATA_HOME` when testing with a scratch
   data directory.)

## 5. Quick pass over the rest

- **Dashboard** — cards fill in; the "Route Fullness Check" panel shows plain
  words like "GREEN: Not full yet — can accept new operators".
- **Records page** — add an operator, edit a name only (dates must not move),
  change a motor number (dates stay put — the auto-date toggle is OFF by
  default; only clerks who deliberately turn it ON in Settings get automatic
  dates).
- **Settings** — backups download; "Fix Records Now" runs and finishes.
- **Switch dark/light** from the top bar — colors should stay readable.

## 6. The automated test battery

The full battery is the first check after any change. All three commands
must pass before code is considered done.

```bash
# Backend: 191 tests (endpoints, PIN pairing, sync security, business logic,
# uploads, performance incl. 50k scale, backup restore, protocol version,
# migration, restore flow)
cd pasada/backend
source venv/bin/activate
pytest                        # full suite
pytest --cov                  # with statement coverage report

# Frontend: 27 vitest unit tests (restore UI, pairing panel, API client, ...)
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd ../frontend
npx vitest run

# TypeScript: must produce no output
npx tsc --noEmit
```

What each backend file pins:

| File | Pins |
|------|------|
| `test_api_endpoints.py` | CRUD, renewals, change-motor (incl. auto-date OFF keeps the old date), deletes, exports auth |
| `test_sync_security.py` | HMAC refusals: replayed, stale, unsigned, wrong-secret, tampered-name pulls |
| `test_business_logic.py` | DD-MM-YYYY parsing, dedup, address expansion |
| `test_upload_validation.py` | Excel/CSV without NAME+SBN headers fail loudly with a reason |
| `test_performance.py` | stats speed, write throughput, 50k-record scale ceilings |
| `test_backup_restore.py` | backup ZIP restores, quick_check ok, row counts match; 30-day retention sweep |
| `test_protocol_version.py` | discovery payload version gate (v2 drops unknown/legacy formats) |
| `test_migration.py` | legacy schema auto-upgrade on boot |

## 7. Manual regression checklist (release candidates)

Run this against a scratch instance before tagging a release:

1. Add operator → appears with auto-SBN, uppercase name.
2. Edit name only → plain `EDIT_RECORD`, dates untouched.
3. Genuine SBN edit → `RENEWAL`, date set to today.
4. Motor swap with toggle OFF → `CHANGE_MOTOR`, old date kept.
5. Delete → undo banner → restore works.
6. Export Excel, export ZIP backup, download DB backup → files open.
7. Batch print single record → merged PDF banner, Print Now works.
8. Connections tab shows the peer by name on a two-machine setup.
9. Check for Updates → "Up to date" against the current release.

## 7b. If the Tauri window is black (desktop build only)

**Root cause found (Oct 2026):** on this office machine (Intel HD 2000 /
Sandy Bridge i915, X11, Zorin OS 24.04 base) the desktop window comes up
solid dark and never renders any UI because **WebKitGTK 2.52 never paints
on this hardware** — the web process commits the document but the UI never
receives a single frame, in MiniBrowser just as in the app. It is not a
PASADA bug and none of the old env workarounds work on 2.52
(WEBKIT_DISABLE_COMPOSITING_MODE, WEBKIT_DISABLE_DMABUF_RENDERER,
LIBGL_ALWAYS_SOFTWARE, GALLIUM_DRIVER=llvmpipe, sandbox off, NO_AT_BRIDGE,
JSC_useJIT=0 — all verified ineffective; MESA_LOADER_DRIVER_OVERRIDE=crocus
and Xvfb too).

The fix on the machine: **downgrade to WebKitGTK 2.44.0** (Ubuntu archive
keeps it) and hold the packages so updates cannot re-break them:

```bash
sudo apt install libwebkit2gtk-4.1-0=2.44.0-2 libjavascriptcoregtk-4.1-0=2.44.0-2
sudo apt-mark hold libwebkit2gtk-4.1-0 libjavascriptcoregtk-4.1-0
```

With 2.44.0 the same window renders the login page normally (measured:
~62% of the window paints a test pattern, 3257 distinct colors and visible
text in the real app; see docs/BLACK_WINDOW_FIXED_PROOF.png).
All the old env vars below are **only** other-machine fallbacks, not a
replacement for the pin:

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
```

If the window goes black again after an update/ reinstall, check
`apt policy libwebkit2gtk-4.1-0` first — a version above 2.44.0 is the
prime suspect. If a newer WebKitGTK ever ships a proper fix, unhold with
`sudo apt-mark unhold` and test `WebView` rendering on this exact machine
before upgrading.

The supported way to exercise PASADA on Linux is the **browser flow in
section 1**, not the Tauri window. Use the Tauri window only when you are
specifically testing the desktop shell (updater, sidecar lifecycle,
right-click menu).

The backend no longer prints a line per HTTP request (access logging is off
by default), so a quiet terminal while you use the app is normal. To bring
the per-request log back for wire-level debugging, run with:

```bash
PASADA_HTTP_ACCESS_LOG=1 XDG_DATA_HOME=/tmp/pasada-dev python main.py
```

## 8. Stop everything

Ctrl+C in each terminal.

## Troubleshooting

- "Cannot connect to PASADA" on the login screen → the engine is not running.
  Check Terminal 1 for errors, make sure nothing else holds port 43888
  (`sudo ss -ltnp | grep 43888`).
- Port already in use → another PASADA engine is still open; close it or
  restart the computer.
- If the browser shows an old screen, hard-refresh (Ctrl+Shift+R).
- pytest fails on `test_global_stats_at_50k_scale` timing → the machine was
  under load; re-run alone (`pytest tests/test_performance.py -k 50k`). The
  15s threshold tolerates a busy laptop but not a regression.
- Test computers now reports `Cannot receive on <port>` or names a firewall →
  allow the sync ports on BOTH machines: Linux `sudo ufw allow 43888/tcp`
  and `sudo ufw allow 54321/udp`; Windows `netsh advfirewall firewall add
  rule name="PASADA sync" dir=in action=allow protocol=TCP localport=43888`
  plus the same rule for UDP 54321. The check first proves this machine can
  bind and receive on its own ports before probing any peer, so a refused
  local bind means the port is blocked or already taken — not that the peer
  is away.
- A machine's LAN address changed (new DHCP lease) → nothing to do; the
  broadcast loop re-reads the address every 10 s cycle and the next
  announcement carries the new IP.

## 9. Rebuilding the Linux sidecar from source

The packaged app runs the compiled engine in
`frontend/src-tauri/target/release/backend/` (a PyInstaller ONEDIR folder:
the `pasada-backend` launcher plus `_internal/`). Two gotchas cost a full
debug session once, so they are written down:

- The module behind `pip install pyinstaller` is **`PyInstaller`** (capital
  P). On Linux, `python -m pyinstaller` fails with "No module named
  pyinstaller" even when pip lists the package as installed — use the
  console script (`pyinstaller ...`) or `python -m PyInstaller`.
- `backend/venv/bin/activate` carries an absolute `VIRTUAL_ENV` from the
  machine the venv was first created on. If the project moved, activating
  still points pip/python at the OLD location's site-packages while the
  build compiles the source in the current directory. Verify with
  `pip -V` after activating, or rebuild the venv with `python -m venv venv
  --clear` when packages look stale.

Build and place (both directions documented):

```bash
cd pasada/backend
source venv/bin/activate
pyinstaller --clean --noconfirm pasada-backend.spec        # ONEDIR, the app's layout
cp -r dist/pasada-backend/. ../frontend/src-tauri/backend/ # bundle resources
# The release app runs from target/release/backend/: copy the same folder
# contents there too when testing the packaged app without a fresh build.
# Then: cd ../frontend && npm run tauri build
```

After replacing the binary, restart the app and check
`PASADA_CRASH_LOG.txt` beside the app for
`All libraries loaded successfully!` — that line is the crypto wheel
loading; without it signing and pairing refuse to work and the Connections
card will show "pairing security missing".
