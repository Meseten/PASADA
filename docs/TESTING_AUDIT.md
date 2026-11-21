# PASADA — Testing Audit

**Date executed:** November 21, 2026
**Environment:** Linux development machine; backend Python 3.12 in `pasada/backend/venv`,
frontend Node 22.23.4 with vitest 4.1.12; isolated `PASADA_DATA_DIR` under `/tmp` for
every run, never the office database.
**Version under test:** 0.82.14.

This document records what was actually executed, what each layer covers, and what is
still unverified. It exists so a reader does not have to take "all tests pass" on trust:
the commands, timings, and counts below are from the runs of this date.

---

## 1. Commands and results

| Command | Where | Result |
|---|---|---|
| `PASADA_DATA_DIR=/tmp/pasada_docsuite venv/bin/python -m pytest -q` | `pasada/backend` | **205 passed**, 5 warnings, **537.26 s**, exit 0 |
| `npx vitest run` | `pasada/frontend` | **30 passed** in 6 files, **55.34 s**, exit 0 |
| `npx tsc --noEmit` | `pasada/frontend` | no output, exit 0 |
| `npm run build` | `pasada/frontend` | exit 0 |
| `npx playwright test --project=chromium` | `pasada/frontend` | **4 passed**, **51.8 s**, exit 0 (real backend, real SQLite, production `out/` export) |
| `python -m pytest tests/test_backup_restore.py tests/test_upload_validation.py -q` | `pasada/backend` | 7 passed, 22.46 s |
| Snapshot check (scripted) | `pasada/backend` | live database 1 row, WAL-safe snapshot 1 row, standalone `.db` file 0 rows |
| Nightly retry check (scripted) | `pasada/backend` | refused corrupt key: no archive, no track file; repaired key same day: archive + track file |

One caveat, recorded rather than hidden: an earlier frontend run started in parallel
with the backend suite timed out a single 5-second interaction test
(`TodaClient.edit-undo.test.tsx`) at 5.56 s under CPU load. Run alone, the same suite
passed 30/30 in 55 s. The timeout is a test-budget limit, not a product failure, but it
is why the suites are documented as run separately.

### The four browser flows (Playwright, chromium)

Each flow boots the real FastAPI backend on `127.0.0.1:43888` with a scratch database
and serves the production static export on `localhost:3000`, then drives Chromium.

| Flow | What it proves | Time |
|---|---|---|
| 1 — login | Seeded Admin signs in through the form and reaches the dashboard | 9.0 s |
| 2 — search | The seeded operator is returned by global search | 6.7 s |
| 3 — renewal | Edit / Renew saves new dates and the API returns the renewed record | 10.0 s |
| 4 — account switch | Admin deactivates the Clerk from Admin Console → Administrative with a typed reason; the API shows the account off and sign-in is refused; the test then reactivates it | 8.2 s |

Flow 4 was rewritten for this run because the application no longer files a two-key
ticket for user deactivation: the single-key rule (2026-10-14) lets an Admin switch an
account directly after typing a reason for the audit log. The harness also marks the
first-run guided tour as seen before login, because its driver.js overlay intercepted
clicks when it appeared late. Both are test-harness corrections, not product changes.

---

## 2. Backend inventory: 205 tests in 24 files

| File | What it pins |
|---|---|
| `test_api_endpoints.py` | CRUD, renewal semantics, suffix-drift edits, change-motor auto-date, deletes, export auth |
| `test_user_management.py` | Accounts, roles, deactivation, recovery origins, last-admin protection |
| `test_admin_console.py` | Promotion, approvals, two-key tickets, admin diagnostics |
| `test_two_key_admin.py` | Request/approve/reject flow, self-approval refusal |
| `test_business_logic.py` | Date parsing, deduplication, address expansion, status computation |
| `test_edit_undo.py` | Edit snapshots, undo endpoint, refused undo when the old SBN is taken |
| `test_upload_validation.py` | Excel/CSV layout validation, loud per-file errors, `.psdb` upload path |
| `test_backup_restore.py` | Backup ZIP and encrypted `.psdb` restore, key history, wrong password, corrupt-key refusal, retention sweep |
| `test_migration.py` | Legacy schema additions on boot |
| `test_ml_engine.py` | Density computation, tier boundaries, graceful degradation under sparse data |
| `test_performance.py` | Stats latency, write throughput, 50,000-record scale ceilings |
| `test_protocol_version.py` | Discovery payload version gate |
| `test_sync_security.py` | HMAC refusals: unsigned, replayed, stale, wrong secret, tampered name |
| `test_sync_connectivity_fixes.py` | Bind/reachability diagnostics, address refresh |
| `test_sync_failure_paths.py` | Same-SBN fuse, partial failure recovery |
| `test_sync_heartbeat.py` | Heartbeat freshness and peer health |
| `test_two_database_sync.py` | Two real databases exchanging records |
| `test_auto_pairing.py` | Challenge/signature pairing |
| `test_pin_pairing.py`, `test_pin_pairing_api.py` | PIN arming, envelope, lockout, junk-host refusal |
| `test_restore_flow_live.py` | Restore against a live server process |
| `live_pairing_test.py`, `live_pin_pairing_test.py` | Two-process pairing drills |
| `conftest.py` | Shared fixtures and isolated database setup |

Frontend (30 tests, 6 files): API client authorization and error handling, the restore
UI, the pairing panel, Change-Motor auto-date defaults, and edit-undo behaviour in the
records client.

---

## 3. Coverage by risk

| Risk | Coverage | Where |
|---|---|---|
| Record corruption or silent loss | Strong: CRUD, duplicate fusion, migration, restore, WAL snapshot check | Backend suite + this audit's snapshot check |
| Unauthorized access | Strong: RBAC, two-key rule, lockout, HMAC sync refusals | `test_admin_console`, `test_two_key_admin`, `test_sync_security`, `test_user_management` |
| Backup unusable when needed | Strong: restore round trip, verify, key history, wrong-password refusal, retention | `test_backup_restore`, browser click-through |
| Import of malformed data | Strong for column presence; per-row parsing errors reported | `test_upload_validation`, `test_business_logic` |
| Sync between computers | Strong in unit/integration form; live two-machine drills exist | `test_sync_*`, `live_*_test.py` |
| ML advice | Good: formula, boundaries, degradation | `test_ml_engine` + the 16-algorithm evaluation |
| Desktop shell and installer | **Not covered by automated tests** | manual Tauri run; see §4 |
| Visual layout and accessibility | Manual only (tooltips, focus, contrast) | not automated |

---

## 4. What is not verified here

- **The Windows packaged build.** The suite runs against the Python sidecar and the
  Next.js build on Linux. Installer behaviour, Word-based PDF conversion, and WebView2
  rendering are checked manually before a release.
- **The office database.** Every run uses a scratch `PASADA_DATA_DIR`. The 6,137-record
  figures come from the September validation run, not from a live query.
- **WebKit and Windows browser runs.** The four chromium flows passed on November 21
  (51.8 s). A WebKit project is configured but was not executed here because its browser
  binary is not installed, and the Windows packaged build was not run. Backup restore and
  encryption were exercised by a manual browser click-through instead (recorded in
  `AUDIT.md`, section 13).
- **Long-duration soak testing.** Sync and backups are exercised in seconds and minutes,
  not across a full working day.
- **Multiple concurrent clerks on many machines.** Two-machine sync is tested; a
  five-machine office is not.

---

## 5. Reproducing

```bash
cd pasada/backend
source venv/bin/activate
PASADA_DATA_DIR=/tmp/pasada_test pytest -q            # 205 tests, ~9 minutes

cd ../frontend
export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"
npx vitest run                                        # 30 tests, ~1 minute
npx tsc --noEmit
npm run build
npx playwright test --project=chromium                # 4 flows, ~1 minute
```

Never point a test or development backend at the office data directory. The backend
resolves its data folder from the OS convention and honours `PASADA_DATA_DIR`.
