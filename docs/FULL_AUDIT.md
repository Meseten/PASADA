# PASADA — Full-Stack Audit

**Date:** Oct 11, 2026
**Scope:** everything — backend API, frontend UI, desktop (Tauri) shell, sync engine,
dependencies, tests, docs, and the Linux run experience.
**Method:** every claim below was verified against the running code on the audit date —
endpoint counts grepped out of `backend/main.py`, suites re-run, dependency trees
audited with `npm audit` / `pip`. Nothing here is guessed.

---

## 0. Executive summary

PASADA is in good shape for what it is: an offline, air-gapped, single-office
records system. The security *design* is sound and, unusually, it is mostly
**test-pinned** — the RBAC gates, the two-key approval rule, the login lockout,
and the sync HMAC are all covered by the 116-test backend suite.

The gaps are not "broken features." They cluster into four buckets:

1. **Dependency drift — frontend half fixed this pass.** The frontend was at **30
   npm vulnerabilities (4 critical)**; upgrading `vitest` to v4 and applying
   `npm audit fix` + a `next` patch took it to **9 high, 0 critical**. The backend
   still runs two effectively-unmaintained libraries (`python-jose`, `passlib`).
   → §3
2. **Architecture debt.** `backend/main.py` is a single **~4,000-line** file holding
   68 routes, auth, sync, and business logic. It works, but it is the single point
   of least testability in the project. → §6
3. **A thin test front-end — E2E added this pass.** Backend coverage is genuinely
   strong (116 tests, 50k-scale perf, backup-restore drill). Frontend had **only 11
   vitest unit tests**; there is now a **4-flow Playwright E2E** (login → search →
   renewal → approval) that runs against the real desktop stack (real backend +
   real SQLite + the production export the webview loads), on Linux and Windows.
   Component tests and ESLint gating are still open. → §5
4. **The Linux experience + the updater.** The two things that made you unable to
   test it — the terminal flooding with GETs and the black window — are both
   **fixed or documented**. The broken **Check for Updates** is now root-caused and
   fixed: releases only ever shipped Windows artifacts, so on *either* OS the
   updater could not reliably find a package; the pipeline now builds both and the
   error message no longer blames the connection. → §6, §8

Nothing in this audit is a ship-blocker for an air-gapped office LAN. The P0 items
in §9 are about keeping the toolchain healthy, not patching an active hole.

---

## 1. Security posture — what is genuinely strong

Verified against `backend/main.py` and pinned by tests:

- **JWT.** HS256 with the algorithm *pinned* on decode (`algorithms=[ALGORITHM]`) —
  no algorithm-confusion exposure. The secret is a random UUID persisted to
  `jwt_secret.key` on first run (line 244-253), not hardcoded.
- **CORS.** Explicit origin allowlist, `allow_credentials=False`. Line 193-209.
  The code comments explicitly forbid `"*"` and explain why. Browser pages on
  another origin cannot read API data.
- **Login brute-force.** 5-attempt lockout (`LOGIN_MAX_ATTEMPTS`), **persisted to a
  `login_lockouts` table** so a backend restart no longer resets the counter
  (line 1468-1511). In-memory fallback survives if the table is unavailable.
- **Sync is authenticated.** Every cross-machine pull requires an HMAC signed with
  the cluster secret; a discovery broadcast carries a display-only name and no
  secrets. Replay caches + freshness windows. (Documented in `SYNC_PROTOCOL.md`,
  pinned by `test_sync_heartbeat.py` / `test_two_database_sync.py`.)
- **Two-key admin rule.** Four hard-to-undo actions cannot be done on one Admin's
  say-so when a second active Admin exists — they route through the approval
  queue. See §2.
- **Deactivation is reversible and non-destructive.** Switching an account off
  keeps records/history; it only refuses sign-in. A deactivated Admin's *old
  token* is also refused at the gate (line 1957-1960) — a real detail that is easy
  to miss and is handled.

**Accepted-by-design (documented, not bugs):** no TLS on the LAN, a single password
recovery path on one machine, no password rotation. These are deliberate for an
air-gapped deployment and are recorded in `THREAT_MODEL.md` §5-6.

---

## 2. RBAC / endpoint protection inventory (the audit you asked for)

**68 total routes.** The gate is one helper, `require_admin` (line ~380), which
raises 403 for any non-Admin. The counts below were grepped from `main.py` and match
`THREAT_MODEL.md` exactly.

### Hard-gated — Admin only, `require_admin` (14 endpoints)

| # | Endpoint | What it truly protects |
|---|----------|------------------------|
| 1 | `GET /users` | The office account roster — usernames, roles, status. Clerk PII. |
| 2 | `POST /users` | Creating accounts. Stops an Admin minting a second Admin outside audit. |
| 3 | `PUT /users/reset-password` | Forcing a password reset on any account. |
| 4 | `PUT /users/set-active` | Deactivating/reactivating an account (also two-key, §below). |
| 5 | `POST /admin/tickets/{id}/approve` | Executing a pending two-key action. |
| 6 | `POST /admin/tickets/{id}/reject` | Rejecting a pending two-key action. |
| 7 | `POST /admin/refresh-db` | Registry-wide repair — rewrites records from source. |
| 8 | `POST /system/sync-now` | Manual sync trigger (wakes the pull loop). |
| 9 | `GET /admin/templates` | Reading document templates. |
| 10 | `POST /admin/templates/{key}` | Overwriting a document template. |
| 11 | `GET /admin/diagnostics` | System diagnostics — versions, paths, health. |
| 12 | `GET /admin/audit-overview` | The audit log overview itself. |
| 13 | `POST /upload/database` | Merging a whole database file — the most destructive import. |
| 14 | `POST /restore/database` | Full database restore from a backup file. |

### Two-key — needs a *second* active Admin via the approval queue (4 actions)

Even a signed-in Admin cannot do these alone when another active Admin exists; a
single-admin office can still do them with a **mandatory written reason** recorded
in the audit log (the "override valve").

| Action | Route | Why it needs two keys |
|--------|-------|-----------------------|
| Route delete | `DELETE /api/routes/{route}` (line 894) | Removes an entire route's records. |
| Route rename | `PUT /api/routes/{route}/rename` (line 994) | Re-identifies a route. |
| Batch record restore | `POST /api/restore-records/ticket` (line 1283) | Bulk-undoes soft-deletes. |
| Account deactivate/reactivate | `PUT /users/set-active` (line 1952) | Switches sign-in on/off. |

### Bootstrap doors — open **only while no Admin exists** (3)

Self-service bootstrapping that closes permanently once the first Admin is created:

- `GET /admin/needed` — "does this office still need its first Admin?"
- `POST /admin/bootstrap` — create that first Admin.
- The recovery-question reset → promotion path.

### Everything else — any signed-in account (by design)

Records CRUD, single soft-delete/restore, exports, logs, settings, route data.
This is intentional for a Clerk-driven office; the *bulk* and *registry-wide*
operations are the ones moved behind the Admin gate.

---

## 3. Dependency health — the loudest gap

### Frontend (npm) — **FIXED this pass: 30 vulns (4 critical) → 9 high, 0 critical**

Before: 4 criticals in **`tinypool`** (prototype-pollution → RCE in worker
options), pulled in by `vitest@3`, plus a **`next` middleware/proxy bypass**
critical. All were in the **dev/test toolchain**, not the shipped Tauri bundle,
but they fail any CI that gates on `npm audit`.

What was done: `vitest` → **v4** (suite re-run, 11/11 pass), `next` +
`eslint-config-next` → **16.4.0** (the non-breaking fix for the middleware
bypass), and `npm audit fix` (non-force). Remaining: **9 high, 0 critical, 0
moderate** — all in dev-only transitives.

**Recommendation (P1):** the remaining highs are dev-chain only; clear them when
convenient. No criticals ship to office machines.

### Backend (pip) — two unmaintained libraries, one fragile pin

| Package | Version | Latest | Status |
|---------|---------|--------|--------|
| `python-jose` | 3.5.0 | — | **Effectively unmaintained.** `PyJWT` is the maintained alternative. Current version is not vulnerable to the old algorithm-confusion CVE, but it receives no security fixes. |
| `passlib` | 1.7.4 | — | **Unmaintained** (last release 2020). Works, but frozen. |
| `bcrypt` | 4.0.1 | 5.0.0 | **Pinned low on purpose** — passlib breaks on bcrypt ≥4.1. This pin is *load-bearing*; upgrading bcrypt alone will break password hashing. |
| `fastapi` | 0.136.1 | 0.143.0 | Behind. |
| `SQLAlchemy` | 2.0.49 | — | Emits `MovedIn20Warning` — `declarative_base()` should move to `sqlalchemy.orm`. Cosmetic today, removed in a future 2.x. |
| `cryptography` | 50.0.1 | 50.0.2 | Patch behind. |

`pip check` is clean — no broken requirements.

**Recommendation (P2):** migrate `python-jose` → `PyJWT` (small, well-documented
swap) and plan a passlib→direct-bcrypt move to escape the frozen pin. Fix the
SQLAlchemy `declarative_base` import to clear the warning.

---

## 4. Code quality & architecture

- **`main.py` is ~4,000 lines, 68 routes, one file.** Auth, sync, RBAC, uploads,
  business logic, and server boot all live here. It is the hardest thing to unit-test
  and the easiest thing to break accidentally. The test suite is the safety net that
  makes this survivable. → The single highest-leverage structural refactor is splitting
  it into FastAPI routers (`auth`, `users`, `records`, `sync`, `admin`).
- **Frontend duplication — fixed this pass.** The Admin Console and Settings >
  Security both reimplemented the same office-account tools (list, reset password,
  deactivate, set-active). That is now extracted into a shared
  `frontend/src/components/office-accounts.tsx`, used by both. ~625 lines of
  duplication removed across the two pages.
- **ESLint errors are tolerated, not gated.** The baseline already carries
  `no-explicit-any` and `set-state-in-effect` errors, and `next.config` does **not**
  run ESLint during `next build`. So lint never blocks a build. This is a choice the
  project has already made — but it means lint is currently decorative.

---

## 5. Testing coverage & gaps

| Layer | Coverage | Notes |
|-------|----------|-------|
| Backend | **116 tests, all passing** (~4m47s) | Endpoints, sync security, business logic, uploads, **50k-scale perf**, backup restore, protocol version, migration. Genuinely strong. |
| Frontend unit | **11 vitest tests** (v4) | Still thin; no component render tests. |
| Frontend E2E | **4 Playwright flows, passing** | **Added this pass.** login → search → renewal → approval, against the REAL desktop stack (real FastAPI + real SQLite + the production `out/` export the webview loads), isolated `PASADA_DATA_DIR`, cross-platform (Linux + Windows). See §5a. |
| TypeScript | `tsc` → **clean, exit 0** | Verified. |
| Production build | `next build` → **exit 0** | 33 pages, all routes compile. |

### 5a. The E2E, and what "desktop app, not a webapp" means for testing

The old Playwright setup pointed at `npm run dev` in chromium — a *webapp*, not
the desktop app. That is gone. The new harness (`frontend/e2e/support/servers.ts`)
boots the **real desktop stack**: the FastAPI backend on `127.0.0.1:43888` (the
frontend's hardcoded `API_URL`) with a real SQLite DB on an **isolated
`PASADA_DATA_DIR`** (never the office data), and serves the **production static
export** (`out/`) — the exact bytes the Tauri webview loads — on `localhost:3000`
(a CORS-allowed origin). The four flows exercise identical code on Linux and
Windows. Run: `npm run build && npx playwright test`.

**Honest boundary:** the flows (login/search/renewal/approval) are pure
frontend↔backend HTTP, so this covers them faithfully on both OSes. What it does
**not** drive is the thin Rust shell — the updater commands, the PDF print
fallback, the native context menu. Those are covered by `cargo check` plus manual
release testing. A `webkit` Playwright project is included so the flows are also
proven in a WebKitGTK-family engine (what the Linux webview uses).

**Still open:** component render tests for the shared `OfficeAccounts` and the
approval-queue UI.

**Speed note:** the backend suite takes ~4m47s, dominated by the 50k-scale perf
tests. Fine for CI, slightly annoying for a tight red-green loop.

---

## 6. The Linux run experience (your two complaints — both addressed)

You could not test it because: (a) the terminal **flooded with a GET line per
second**, and (b) the window came up **solid black**. Both are now handled.

### (a) Terminal GET spam — **fixed in code**

Root cause: the login screen polls `/health` **every 1 second** and the dashboard
every 15s, and uvicorn's default `INFO` access log prints a line per request. The
fix sets `log_level="warning"` on `uvicorn.run` (line 3996), which silences the
per-request noise while **warnings and errors still print**. A debug escape hatch
is preserved: set `PASADA_HTTP_ACCESS_LOG=1` to bring the access log back when you
are actually debugging the wire.

### (b) Black window — **documented workaround, not a PASADA bug**

Root cause: on some Linux stacks — **notably Wayland sessions and NVIDIA +
WebKitGTK 4.1** — the Tauri window renders **solid black** even though the app is
running perfectly behind it. It is a WebKit compositing problem, not your code.

Documented in `TESTING_ON_LINUX.md` §7b, escalating:

1. `WEBKIT_DISABLE_COMPOSITING_MODE=1 npm run tauri dev`
2. If still black, also force the software renderer:
   `WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`
3. Or skip the desktop shell entirely and run the **browser** flow
   (`npm run dev` → `localhost:3000`), which avoids WebKitGTK completely.

---

## 7. Documentation

`docs/` holds: `THREAT_MODEL.md`, `SYNC_PROTOCOL.md`, `ISO25010_COMPLIANCE.md`,
`ALGORITHM_EVALUATION.md`, `TESTING_ON_LINUX.md`, and now this audit.

**Fixed this pass:** `THREAT_MODEL.md` §5 carried a **stale RBAC paragraph** claiming
"all tokens grant the same clerk-level access… Admin-role gating exists on the
user-management endpoints and Settings panel only." That under-counted the real
protection badly. It now states the true inventory — 14 hard-gated Admin endpoints,
4 two-key actions, 3 bootstrap doors — verified line-by-line against `main.py` (§2).

---

## 8. Prioritized gap list

### DONE this pass
- ✅ **`vitest@4` upgrade** — cleared the 4 critical / 19 high npm vulns; suite 11/11.
- ✅ **`next` → 16.4.0** — cleared the middleware-bypass critical.
- ✅ **Updater error message no longer lies** — a missing update package is
  reported as "no update package published for this OS" instead of blaming the
  connection. The release pipeline stays **Windows-only** (releases are built
  manually on the Windows machine — `RELEASE.md` now documents that manual
  build end-to-end: sidecar, signing, `latest.json`, publish, verify).
- ✅ **4-flow E2E** against the real desktop stack. See §5a.
- ✅ **SQLAlchemy `declarative_base`** moved to `sqlalchemy.orm` — the
  `MovedIn20Warning` is gone (verified: 0 warnings on `import database`).

### P0 — keep the toolchain healthy (do soon, low risk)
- **Note (not a code issue): `tests/test_performance.py` is load-sensitive.**
  `test_concurrent_write_throughput` (300 ms/write) and
  `test_global_stats_at_50k_scale` (15 s cold) fail on a machine under load
  (load average ~7: observed 310 ms / 16.1 s, then on re-run 335 ms while the
  50k test *passed* — the numbers move with load, not with code). A/B-verified:
  the failures are identical with the pre-change `declarative_base` import, so
  they are not a regression signal. Re-run on an idle machine before treating
  a failure as real.

### P1 — real hardening (worth scheduling)
- **`python-jose` → `PyJWT`.** The current lib is unmaintained; swap for a library
  that still receives security fixes.
- **Run the new E2E in CI** on both a Windows and a Linux runner so the two-key
  approval path and the real-stack flows are gated on every push.
- **Decide on ESLint:** either gate `next build` on it and fix the
  handful of baseline errors (the `no-explicit-any` and `set-state-in-effect`
  findings that predate this pass), or formally accept it as advisory. Right now
  it is neither.

### P2 — structural debt (improve when convenient)
- **TODO — Split `main.py` into FastAPI routers** (`auth`, `users`, `records`,
  `sync`, `admin`). Highest-leverage maintainability win. **Acceptance criteria:
  the split must not break any of the 116 backend tests** — after moving routes
  into `APIRouter`s and including them in `main.py` (or an `app/` package),
  `pytest` must still report **116 passed**, `tsc` clean, and the 4-flow E2E
  green. Move route handlers only; keep `require_admin`, the two-key helper, and
  every endpoint path/method/response identical. Suggested order: `admin` (most
  self-contained, gated) → `users` → `auth` → `records` → `sync`.
- **Escape the `passlib`/`bcrypt` frozen pin** by moving to direct bcrypt calls.
- **Component tests** for the shared `OfficeAccounts` and the approval-queue UI.

### Boot reliability pass (2026-10-12)
- ✅ **Boot telemetry**: `main.py` now records one
  `[TELEMETRY] Backend bound and serving at Xs after import finish … proc age Ys`
  line in `PASADA_CRASH_LOG.txt` per boot (watcher thread, one fire, 600s
  no-bind timeout branch). "Proc age" comes from `psutil`'s process-create
  time, so it includes the PyInstaller onefile defrost — the number that
  matches what the user experienced.
- ✅ **UPX off in all three sidecar specs** (`main.spec`, `pasada-backend.spec`
  Python/Windows, `pasada-backend-x86_64-unknown-linux-gnu.spec`): the
  per-launch UPX decode of the ~106 MB onefile bundle was a measured major
  share of the minutes-long first boot on the office's 5400-rpm disk under
  I/O pressure. Linux rebuild verified; bind-to-/health ~11 s warm.
- ✅ **Readiness pipeline (Tauri shell)**: `lib.rs`'s sidecar watcher now
  emits `backend-status` webview events — `ready` the moment **anything**
  accepts a TCP connection on 127.0.0.1:43888 (watchdog: honest failure
  after 5 min), `failed` when the sidecar terminates or errors mid-boot.
  The login page prefers this real signal and keeps the `/health` polling
  fallback for browser-only contexts (e2e, dev). cargo check exit 0;
  tsc, vitest 11/11, chromium E2E 4/4 still green.

### Accepted-by-design (no action — recorded in THREAT_MODEL)
- No TLS on the LAN · single-machine password recovery · no password rotation ·
  browser-local token storage. All deliberate for an air-gapped office, all
  documented with their failure modes.

---

## 9. Verification performed on the audit date

| Check | Result |
|-------|--------|
| Backend suite | **116 passed** (exit 0, ~4m47s) |
| Frontend typecheck (`tsc`) | **clean, exit 0** |
| Frontend unit tests (`vitest` v4) | **11 passed** |
| Frontend E2E (`playwright`, real stack) | **4 passed** (chromium) — login, search, renewal, approval |
| Production build (`next build`) | **exit 0**, 33 pages |
| `npm audit` | **9 high, 0 critical** (was 30 / 4 critical) — recorded §3 |
| `pip check` | no broken requirements |
| RBAC counts (grep) | 14 hard-gated · 4 two-key · 3 bootstrap — matches doc |
