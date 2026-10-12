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
# Backend: 63 tests (endpoints, sync security, business logic, uploads,
# performance incl. 50k scale, backup restore, protocol version, migration)
cd pasada/backend
source venv/bin/activate
pytest                        # full suite
pytest --cov                  # with statement coverage report

# Frontend: 11 vitest unit tests
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

`npm run tauri dev` opens a real desktop window. On some Linux graphics
stacks (notably Wayland sessions and NVIDIA + WebKitGTK 4.1) that window
comes up **solid black** even though the app is running fine behind it. The
black screen is a WebKit compositing problem, not a PASADA bug: the backend
is serving, the frontend is loaded, the webview just is not painting.

Two fixes, in this order:

1. Disable WebKit compositing for that run:
   ```bash
   WEBKIT_DISABLE_COMPOSITING_MODE=1 npm run tauri dev
   ```
2. If it is still black, also force the software renderer:
   ```bash
   WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
   ```

The supported way to exercise PASADA on Linux is the **browser flow in
section 1**, not the Tauri window. Use the Tauri window only when you are
specifically testing the desktop shell (updater, sidecar lifecycle,
right-click menu); for records, sync, and business logic the browser flow is
equivalent and avoids the WebKit rendering issue entirely.

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
