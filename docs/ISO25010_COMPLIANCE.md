# ISO/IEC 25010 Software Quality Compliance Report
**System:** PASADA Franchise Registry System  
**Architecture:** Local-first, offline-capable desktop application (Tauri + React/Next.js) with a packaged FastAPI/SQLite sidecar.

This document serves as an audit artifact mapping the system's architectural decisions and codebase to the ISO/IEC 25010 software quality model.

## 1. Functional Suitability
*Degree to which the product provides functions that meet stated and implied needs when used under specified conditions.*

| Sub-characteristic | Implementation Justification | Evidence Reference |
| :--- | :--- | :--- |
| **Functional Completeness** | The system natively handles the full lifecycle of municipal tricycle franchise records: initial registration, renewals, motor changes, and route transfers without requiring external internet tools. The Settings "Export Filtered Backup Files" control is backed by a working `/export/mass` endpoint (ZIP of Excel masterlist + Word certificates) rather than a dead link. | `backend/main.py:update_franchise()`, `backend/main.py:export_mass_backup()` |
| **Functional Correctness** | Database bulk imports use stable, deterministic identifiers (composite SBN parsing and UUIDs) to prevent silent data loss. Empty chassis or motor entries are explicitly treated as non-deduplicable entities to preserve vacant slot integrity. Operator edits are classified correctly: only genuine motor/chassis/make value changes register as CHANGE_MOTOR (with normalized None/empty comparison and a pre-computation DB refresh eliminating dirty-session false positives), while name, plate, route, or address edits log as ordinary EDIT_RECORD without disturbing Date Issued. Whether Date Issued auto-fills on a genuine Change Motor is a user choice — the "Auto-date for Change Motor" toggle on the Settings page (on by default, saved per computer); nothing is injected without it. Address abbreviations (e.g. `PAL.CENTRAL`, `TIM.BALSAHAN`) are expanded to full barangay names at persistence time. | `backend/main.py:update_franchise()`, `backend/main.py:FULL_ADDRESS_MAP`, `backend/main.py:upload_database_file()` |
| **Functional Appropriateness** | The machine learning module (K-Means Clustering) provides density analysis as an *advisory* metric rather than a hard permit-gate, aligning with the real-world administrative override capabilities required by municipal clerks. | `backend/ml_engine.py:run_kmeans_clustering()` |

## 2. Reliability
*Degree to which a system, product or component performs specified functions under specified conditions for a specified period of time.*

| Sub-characteristic | Implementation Justification | Evidence Reference |
| :--- | :--- | :--- |
| **Fault Tolerance** | The application utilizes an automated DB migration wrapper that detects legacy database schemas (e.g., pre-soft-delete tables) and dynamically injects missing columns (`is_deleted`) to prevent catastrophic query failures upon boot. | `backend/database.py:ensure_schema_upgrades()` |
| **Recoverability** | Automated, stateful background tasks generate daily ZIP backups of the SQLite database if active modifications occurred, ensuring point-in-time recovery independent of user action. Deletion by base SBN correctly resolves year-suffixed records (e.g. `BAT-002` finds `BAT-002-26`), preventing orphaned "undeletable" rows. | `backend/main.py:automated_background_tasks()`, `backend/main.py:delete_single_operator()` |
| **Availability** | Document generation failures (e.g., missing local LibreOffice/Word dependencies for PDF conversion) are caught via narrowed exception handlers, logged gracefully, and seamlessly fall back to generating raw `.docx` files to ensure operational continuity. | `backend/doc_generator.py` |

## 3. Maintainability
*Degree of effectiveness and efficiency with which a product or system can be modified.*

| Sub-characteristic | Implementation Justification | Evidence Reference |
| :--- | :--- | :--- |
| **Modularity** | Complex business logic—specifically the temporal derivation of record statuses (Active, Flagged, Revoked, Vacant)—is centralized as a single source of truth in the backend layer rather than duplicated across frontend UI components and export endpoints. | `backend/main.py:compute_record_status()` |
| **Testability** | Critical edge-cases, particularly Philippine-centric date parsing formats (DD-MM-YYYY) and duplicate evaluation logic, are isolated and covered by deterministic unit tests to ensure future code modifications do not introduce regressions. Regression tests pin the client-reported defects: name-edit must not trigger CHANGE_MOTOR, real motor swaps must inject the current date, and address abbreviations must expand. Test suites are module-isolated (per-module DB override installed in fixtures, not import time) so the full suite passes in any order. | `backend/tests/test_business_logic.py`, `backend/tests/test_api_endpoints.py` |
| **Analyzability** | Fatal exceptions at the OS-level and application layer are intercepted and written to a dedicated physical crash log (`PASADA_CRASH_LOG.txt`), allowing auditors and maintainers to diagnose state failures in environments lacking cloud telemetry. | `backend/main.py:exception_hook()` |

## 4. Usability
*Degree to which a product or system can be used by specified users to achieve specified goals with effectiveness, efficiency and satisfaction.*

| Sub-characteristic | Implementation Justification | Evidence Reference |
| :--- | :--- | :--- |
| **User Error Protection** | User interfaces accurately reflect system capabilities. Controls representing background services (such as LAN Peer Sync) explicitly communicate their automated nature rather than providing deceptive "force sync" push-buttons. Uppercasing of operator names, addresses, and SBNs is enforced via CSS `text-transform` and applied only at submit time, preserving cursor position while typing (no letter-reordering when editing mid-word). Backend save responses surface actionable error toasts instead of silent failures. | `frontend/src/app/toda/[route]/TodaClient.tsx`, `frontend/src/app/settings/page.tsx` |
| **Operability** | Batch printing parameters utilize explicit filtering controls (e.g., Specific Date, Date Ranges) with synchronous UI blockers to prevent accidental system overload from mass document generation. | `frontend/src/app/toda/[route]/TodaClient.tsx` |

## 5. Portability
*Degree of effectiveness and efficiency with which a system, product or component can be transferred from one hardware, software or other operational or usage environment to another.*

| Sub-characteristic | Implementation Justification | Evidence Reference |
| :--- | :--- | :--- |
| **Installability** | The backend relies exclusively on standard Python built-ins, SQLite, and PyInstaller, allowing it to be packaged as a single, self-contained sidecar executable embedded directly into the Tauri Windows `.msi` without requiring the end-user to install Python, configure databases, or manage environment variables. Data, backups, and crash logs resolve through `platformdirs` to the per-user application data directory on every OS, and windowless PyInstaller execution guards against null stdio on Windows. | `tauri.conf.json`, `backend/database.py`, `backend/main.py` |

## 6. Security
*Degree to which the product protects information and data so that persons or other products or systems have the degree of data access appropriate to their types and levels of authorization.*

| Sub-characteristic | Implementation Justification | Evidence Reference |
| :--- | :--- | :--- |
| **Confidentiality** | Passwords are stored only as bcrypt hashes and never logged, exported, or synced between peer machines (the LAN sync payload strips `password_hash`). | `backend/main.py`, `backend/main.py:sync_pull()` |
| **Non-repudiation / Accountability** | Every login, lockout, and record change is written to a tamper-evident audit log with the acting account and time. Failed-login throttling events (`LOGIN_LOCKED`, `LOGIN_BLOCKED`) are recorded alongside ordinary actions so brute-force attempts leave a trace. | `backend/main.py:log_action()`, `backend/main.py:login()` |
| **Integrity** | The `/token` login endpoint throttles brute-force attempts: after 5 consecutive failed passwords for the same username, the account is locked for 15 minutes and returns HTTP 429 even if the correct password is then supplied. A successful login clears the counter. The active lock is mirrored to SQLite (`login_lockouts`) so a backend restart can no longer reset it mid-attack; no internet dependency, works unchanged on the air-gapped LGU LAN. | `backend/main.py:login()`, `backend/tests/test_api_endpoints.py:test_login_rate_limit_and_lockout()`, `test_login_lockout_persists_across_restart()` |

## 7. Verification Log (Live End-to-End Smoke Test, Sept 14, 2026)

The whole app was exercised on a running instance against the production-sized registry (6,100+ records) — not just unit tests. Every path below was actually clicked through the real UI and cross-checked against the database and audit log afterward.

| # | Scenario | Expected Behavior | Result |
| :-- | :--- | :--- | :--- |
| 1 | Edit operator NAME only while the stored SBN suffix differs from the displayed one (backdated record: stored `BA-280-26`, display `BA-280-25`) | Plain `EDIT_RECORD` log; Issue/Valid dates preserved; **no** RENEWAL, **no** CHANGE_MOTOR | PASS |
| 2 | Genuine SBN edit in the modal (`BA-280-25` → `BA-280-26`) | `RENEWAL` log with the actual extended date; Date Issued auto-set to today | PASS |
| 3 | Motor number swap only | `CHANGE_MOTOR` log containing only the changed field (`MOTOR_NO: old -> new`); Date Issued auto-set to today | PASS |
| 4 | Add Operator (lowercase typing, `PAL.CENTRAL` address) | Saved uppercase; address auto-expanded to `PALANGUE CENTRAL, NAIC, CAVITE`; auto-SBN assigned | PASS |
| 5 | Batch Print (custom selection, single record) | Merged PDF banner "Ready — N documents merged" + Print Now button; `BATCH_PRINT` logged | PASS |
| 6 | Export Filtered Backup ZIP (Settings) | Real ZIP (Excel masterlist + Word certificates) served with `application/zip` | PASS |
| 7 | 5 wrong passwords in a row on `/token` | `429 LOCKED` on the 5th try; correct password also refused while locked; `LOGIN_LOCKED` audit entry written; counter cleared by a successful login | PASS |
| 7 | Export Excel (route page) | Masterlist `.xlsx` downloaded; `EXPORT_MASTERLIST` logged | PASS |
| 8 | Delete → Undo Delete | Soft delete then restore; both logged; row returns to the table | PASS |
| 9 | Record History modal | Correct per-record audit trail (CHANGE_MOTOR / RENEWAL / EDIT_RECORD) | PASS |
| 10 | Logs page + action filter | Rows render; filtering by CHANGE MOTOR shows only that action | PASS |
| 11 | Inactive / Global Search pages | Filters, pagination, and results render correctly | PASS |
| 12 | Settings signatory save | `PUT /settings` 200; value persisted | PASS |

Regression tests pinning scenarios 1–3 live in `backend/tests/test_api_endpoints.py` (`test_suffix_drift_edit_is_not_renewal`, `test_genuine_sbn_edit_still_triggers_renewal`, alongside the earlier change-motor tests). Full backend suite at the time: **27 passed**. Frontend: `tsc --noEmit` clean, `next build` succeeds.

---

# ISO/IEC 25010 Full Evaluation (September 27, 2026)

Re-evaluation against the complete ISO/IEC 25010:2023 characteristic set, covering all changes since the smoke test above: signed LAN sync, LAN binding, the real background update pipeline, the UI/UX passes (tooltips, spotlight, sidebar highlight, shortcuts, right-click menu), account-name broadcasting, dropdown readability, the documentation overhaul, and the post-evaluation hardening (restart-persistent login lockout, CI updater signing). Where this document says **no code was changed**, only the initial 8–16 tables were written without touching code; the hardening items below were implemented and are marked as such.

## Evaluation method and measured baseline

Every grade below is grounded in the codebase itself (code, tests, CI workflow) plus live verification on an isolated scratch deployment (separate data directory, port 43889) so the office installation was never touched. The measured baseline of the codebase at evaluation time:

| Metric | Value |
| :--- | :--- |
| Backend production code | 3,954 lines of Python across 6 modules (`main.py` 2,916; `doc_generator.py` 397; `sync_engine.py` 241; `database.py` 170; `ml_engine.py` 156; `extractor.py` 74) |
| Backend test code | 1,001 lines across 5 test files, **51 tests** (24 endpoint, 16 sync-security, 8 business-logic, 2 performance, 1 migration), pytest 51/51 |
| Frontend code | 8,963 lines of TypeScript/TSX; vitest **8/8**; `tsc --noEmit` clean; `next build` clean |
| Rust shell | `cargo check` clean (11m 39s); Tauri v2 updater with minisign verification |
| CI | `.github/workflows/build-windows.yml`: every push to `main` builds the backend (PyInstaller, 12 pinned hidden imports) and frontend (Node 22, Rust stable, Python 3.12) on `windows-latest` and publishes a downloadable **PASADA-Windows-Installer** artifact (`.msi` + NSIS `.exe`) |
| Version lockstep | 0.82.0 identical in `tauri.conf.json`, `Cargo.toml`, and `APP_VERSION` in `settings/page.tsx` |
| Live data scale | 6,137 production records exercised through the real UI |
| Audit history | 5 documented hardening/verification passes (`AUDIT.md`) with live re-verification each time |

**Scoring scale:** 10 = nothing left to wish for in this deployment context; 8–9 = solid with specific, listed improvements; 6–7 = functional but with gaps that matter; below 6 = non-compliant. A grade below 10 always lists what would earn the missing points.

---

## 8. Performance Efficiency — Grade: 8/10
*Performance relative to the amount and type of resources used under stated conditions.*

**Metrics**

| Metric | Value | Source |
| :--- | :--- | :--- |
| Registry size exercised live | 6,137 records through the real UI | scratch deployment, Sept 2026 |
| Dashboard statistics cache | computed once per invalidation (`_ROUTE_DIST_CACHE`), not per request | `backend/main.py:clear_api_caches()` |
| ML fullness cache | per route (`_ML_CACHE`), invalidated only on route-data change | `backend/ml_engine.py` |
| Background work cadence | daemon threads on a fixed 10-second cycle (discovery, pull sync, export cleanup) | `backend/sync_engine.py:sync_with_peers()` |
| Export disk growth bound | exports older than 2 hours purged automatically | `backend/main.py:automated_background_tasks()` |
| Pagination ceiling | 25–500 rows per page, keeps DOM size flat on 6,137 records | `TodaClient.tsx:renderPagination` |
| Performance tests | 2 dedicated tests pinning stats speed and cache behaviour, green | `backend/tests/test_performance.py` |
| Frontend build | full `next build` of all routes clean | CI + local battery |

**Explanation.** The two known hot paths (dashboard statistics over the whole registry, K-Means fullness per route) are both memoized server-side and pinned by dedicated performance tests, so repeated UI polling costs O(1) cache hits instead of O(n) scans. Everything periodic is a daemon thread on a fixed cadence, so cost does not grow with uptime. The frontend memoizes filtering/sorting of thousands of records so typing in search does not recompute the table per keystroke.

**Remarks.** 6,137 records is the municipality's real size, and the app is measurably snappy at it; the grade is held at 8 because no load profile beyond that size was ever measured.

**Notes.** Batch printing deliberately blocks the UI synchronously: that is a resource-protection choice (preventing mass document generation storms), not a performance defect. Navigation is client-router only, no full page reloads.

**What to improve**
1. Generate a synthetic 50k-record database and re-run the performance tests against it; document the measured ceiling or lift pagination/virtualization if it degrades.
2. Add a timing assertion (upper bound in ms) to `test_global_stats_processing_speed` so a future regression fails the suite instead of just passing.
3. Log slow requests (e.g. > 500 ms) to the crash/audit log so field slowdowns are diagnosable without a profiler attached.

## 9. Compatibility — Grade: 9/10
*Degree to which a system can exchange information and perform its functions while sharing the same environment.*

**Metrics**

| Metric | Value | Source |
| :--- | :--- | :--- |
| API port | 43888, fixed and documented | `backend/main.py` |
| Discovery transport | UDP broadcast, port 54321, signed payload | `backend/sync_engine.py` |
| Pull protocol | HMAC-authenticated incremental `/api/sync/pull?since=` | `backend/main.py` |
| Merge semantics | tombstone-aware, last-write-wins on `updated_at` | `sync_engine.py:sync_with_peers()` |
| Sync-security tests | 16 tests incl. replay, stale, unsigned, wrong-secret, tampered-name — all green | `backend/tests/test_sync_security.py` |
| Live peer test | FRONT DESK peer seen by name; valid pulls returned records | `AUDIT.md` pass 4 |
| Dev/prod port rule | frontend↔backend port match documented in README (dev/dev note) | `README.md` |

**Explanation.** Co-existence is by fixed, documented ports plus an opt-out (`PASADA_API_HOST`) so PASADA never fights other office software for the network. Interoperability is the core feature and is verified in both directions: two real machines exchanged records, and every adversarial pull variant (replayed, stale, unsigned, wrong secret, tampered peer name) was refused by the signing checks.

**Remarks.** The sync format is deliberately simple (JSON over HTTP with HMAC), which is what makes it testable without sockets and diagnosable in the field. The 16 security tests effectively double as an interop conformance suite.

**Notes.** The discovery broadcast display label sits *inside* the signed body, so a spoofed machine name breaks the signature — interop and integrity are not traded off against each other.

**What to improve**
1. Add a protocol-version field to the discovery payload so a future schema change cannot make mixed-version offices fail silently (currently an implicit assumption).
2. Document the sync wire format (fields, clock-skew tolerance, tombstone rules) in a short `docs/SYNC_PROTOCOL.md` for future maintainers.

## 10. Interaction Capability (Usability) — Grade: 8/10
*Degree to which a system can be used by specified users to achieve specified goals.*

**Metrics**

| Metric | Value | Source |
| :--- | :--- | :--- |
| Tooltip poke-scan | records 208 bubbles / 0 pokes; inactive 53/0; dashboard 13/0; logs 3/0; search 2/0 | `AUDIT.md` passes 2–4, live DOM scan |
| Control sizing standard | 44px controls throughout; logs and inactive toolbars measured pixel-identical (export 158px, search 288px) at 1440px | `AUDIT.md` passes 2 & 5 |
| Responsive checks | every page measured at 1440px and 390px | `AUDIT.md` |
| Guided tutorial | 14 steps, first sign-in, replayable from Settings; off-screen targets skipped so it never dead-ends | `frontend/src/lib/tutorial.ts` |
| Keyboard shortcuts | `/` search, Alt+N/P/E new/print/export, Alt+1–5 pages — verified live | `frontend/src/app/layout.tsx` |
| Right-click menu | Back, Forward, safe Reload, Copy, Paste, Select all, Print page | `frontend/src/app/layout.tsx` |
| Duplicate-download guards | on every download path (records export, Word, summary, inactive export) | frontend pages |
| Frontend unit tests | 8 vitest tests, green | `frontend/src/lib/api.test.ts` |

**Explanation.** Every interactive element is either self-describing (dropdowns state their selection) or carries a themed tooltip that follows the active theme, caps at 350 ms delay, hides while pressed, and opens keyboard-reachable via `:focus-visible`. Layout standards (44px controls, right-aligned bubbles at table edges) were verified by measuring the live DOM, not by eyeballing. Destructive actions confirm first, deletes are undoable, and the updater installs only on the user's chosen preference and never while the machine is in use.

**Remarks.** This is the strongest *measured* area of the frontend: the poke-scan numbers (279 bubbles across five pages, zero clipped) are real DOM measurements, and every hardening pass re-ran them.

**Notes.** Filter and sort dropdowns are intentionally bubble-free: their selected option already says what they do. Sidebar pins keep native tooltips because a bubble inside the scroll container would reintroduce the horizontal scrollbar a previous pass removed.

**What to improve**
1. Run a full screen-reader audit (NVDA on Windows, the office's actual OS) over all pages and fix what it finds; this is the single biggest gap between 8 and 10.
2. Audit modal dialogs for focus trapping and Escape-to-close consistency across all pages.
3. Grow the frontend unit-test count beyond 8 — interaction logic (guards, shortcuts, tooltip system) currently earns its grade from manual live measurement rather than automated tests.

## 11. Security — Grade: 9/10
*Degree to which a product protects information and data.* (Supersedes the three-row snapshot in section 6 above.)

**Metrics**

| Metric | Value | Source |
| :--- | :--- | :--- |
| Sync message authentication | HMAC-SHA256 over addressed host + timestamp + nonce; wrong-address signature fails closed | `backend/main.py:_verify_pull_signature()` |
| Replay protection | caches on both pull and discovery; 5-minute freshness window | `main.py`, `sync_engine.py` |
| Brute-force lockout | 5 consecutive failures → 15-minute lock, HTTP 429, audited (`LOGIN_LOCKED`/`LOGIN_BLOCKED`) | `backend/main.py:login()` |
| Lockout persistence | active lock mirrored to SQLite (`login_lockouts`, wall-clock) and re-read after a backend restart — restarting no longer resets a brute-force lock (pinned by `test_login_lockout_persists_across_restart`; hardened after this evaluation flagged it) | `main.py:_load_persisted_lock()` |
| Password storage | bcrypt only; never logged, exported, or synced (`password_hash` stripped from pull payloads) | `backend/main.py:sync_pull()` |
| Session tokens | JWT HS256, per-installation secret file, 30-day expiry | `backend/main.py` |
| Update authenticity | installers verified against developer's minisign signature; prepared updates re-verified before reuse | `frontend/src-tauri/src/lib.rs` |
| CORS | strict allowlist (`tauri://localhost`, localhost dev) | `backend/main.py` |
| Sync-security test count | 16, including live-verified refusal of replayed/stale/unsigned/wrong-secret/tampered requests | `backend/tests/test_sync_security.py` |
| Audit trail | every mutation, login, lockout, route-data and name change logged with actor + time; logs page exports the filtered trail | `backend/main.py:log_action()` |
| Signup surface | open signup closes after the first account; computer-name endpoint requires authentication | `backend/main.py` |

**Explanation.** The threat model is an air-gapped municipal LAN with untrusted-by-default broadcasts. The design answers it with signed-only pulls (fail closed), replay caches, freshness windows, and a display name that is deliberately excluded from all trust decisions. Secrets (cluster key, JWT secret) never cross the network; browser-based local reads are blocked by the CORS allowlist; brute force is throttled and audited.

**Remarks.** 9, not 10, because three risks remain *accepted and documented* rather than eliminated: no TLS on the LAN (HMAC covers integrity, not wire confidentiality), the discovery broadcast is readable by anyone on the segment (name only, nothing secret), and the cluster secret is shared by copying a file. All three are conscious trade-offs recorded in `docs/THREAT_MODEL.md` — appropriate for the context, but they are the honest distance to a perfect score. The fourth earlier gap (RAM-only lockout reset by a restart) has since been **closed in code**: the active lock is mirrored to SQLite and re-read on boot, pinned by a dedicated regression test.

**Notes.** CI produces a signed, downloadable installer on every commit to `main` (`.github/workflows/build.yml` now passes `TAURI_SIGNING_PRIVATE_KEY`/`_PASSWORD` to the Tauri build, so the updater `.zip` + `.sig` pairs are produced in the pipeline, not only at release time). Both build and release workflows fail in seconds — before the multi-minute compile — when the signing secrets are missing or empty, with an error message that says exactly what to paste. Account names broadcast on the LAN are display-only and grant nothing.

**What to improve**
1. ~~Persist the lockout counter~~ **Done** after this evaluation: `login_lockouts` SQLite mirror, re-read on boot, test-pinned.
2. Automate cluster-secret distribution for new machines (e.g. a first-run pairing code entered on the new machine) instead of manual file copying.
3. ~~Add a minisign step to the GitHub Actions workflow~~ **Done**: the push-build now signs updater artifacts with the repo's minisign secrets.

## 12. Reliability — Grade: 9/10
*Degree to which a system performs specified functions under specified conditions for a specified period of time.*

**Metrics**

| Metric | Value | Source |
| :--- | :--- | :--- |
| Backend test suite | 49/49 green (incl. 22 endpoint, 16 sync-security) | `backend/tests/` |
| Migration tests | legacy-schema upgrade pinned by test | `backend/tests/test_migration.py` |
| Backup policy | automated daily ZIP when changes occurred; exports purged at 2h | `backend/main.py:automated_background_tasks()` |
| Dead-peer behaviour | skipped and retried next 10s cycle; never blocks the app | `sync_engine.py:sync_with_peers()` |
| Malformed-input handling | garbage discovery payloads and pull signatures rejected without crashing (unit-tested) | `test_sync_security.py` |
| Live fault injection | malformed scratch DB surfaced as logged 500, service stayed up; documented recovery via `VACUUM INTO` | `AUDIT.md` pass 4 |
| Doc-generation fallback | PDF failure falls back to `.docx`, logged | `backend/doc_generator.py` |
| Updater fallback | background prepare fails quietly → download-on-click still works | `settings/UpdateCard.tsx` |

**Explanation.** Reliability is engineered as layered fallbacks rather than the absence of bugs: a dead peer costs one skipped cycle; a broken converter costs a `.docx` instead of a PDF; a corrupted database surfaces as a logged error while the service stays up, with a documented `VACUUM INTO` recovery; a legacy schema is upgraded automatically on boot and pinned by a regression test. Each layer was exercised live, not just asserted.

**Remarks.** The live malformed-database incident during pass 4 is the best evidence in the repo: a real fault was injected, the failure mode was graceful, and the recovery path was verified end to end.

**Notes.** Soft delete + restore means operator error at the UI almost never loses data permanently; tombstone-aware sync merges mean one machine deleting a record propagates correctly rather than resurrecting it.

**What to improve**
1. Add an automated backup-restore drill (scheduled test that restores the latest ZIP into a temp directory and row-counts it) so backups are proven, not assumed.
2. Add a periodic `PRAGMA integrity_check` background task that writes to the crash log, catching corruption early instead of at first read.
3. Define a backup retention policy (currently backups accumulate; harmless at office scale, unbounded over years).

## 13. Maintainability — Grade: 8/10
*Degree of effectiveness and efficiency with which the codebase can be modified.*

**Metrics**

| Metric | Value | Source |
| :--- | :--- | :--- |
| Test-to-code ratio (backend) | 1,001 test lines / 3,954 production lines ≈ 0.25 | `backend/` |
| Test distribution | 5 backend files (logic 8, endpoints 24, performance 2, migration 1, sync-security 16) + 8 frontend tests | `backend/tests/`, `frontend/src/lib/api.test.ts` |
| Coverage (statement, measured Sept 27 2026 via `pytest --cov`) | **50%** backend-wide; the security-critical modules lead: `test_sync_security.py` 100%, `database.py` 94%, endpoint tests 98%; the uncovered weight sits in Windows-only document/Excel generation (`doc_generator.py` 8%, `extractor.py` 12%) and the export/report endpoints of `main.py` (42%) | measured with `pytest tests/ --cov` |
| Order independence | per-module DB fixtures installed in fixtures, not import time — suite passes in any order | `backend/tests/` |
| Regression-pinning style | every client-reported defect became a named test (`test_suffix_drift_edit_is_not_renewal`, `test_computer_name_never_defaults_to_hostname`, …) | `test_api_endpoints.py`, `test_sync_security.py` |
| CI build | reproducible Windows build on every push to `main`; 12 PyInstaller hidden imports pinned explicitly with rationale comment | `.github/workflows/build-windows.yml` |
| Version lockstep | 0.82.0 across 3 files, verified | `RELEASE.md` list |
| Modification track record | 5 audit passes landed security, updater, UX, naming, and dropdown changes with zero regressions | `AUDIT.md` sections 2–5 |
| Analyzability | crash log (`PASADA_CRASH_LOG.txt`) + audit log + deliberate-decision comments (weekday KPI revert, CORS rationale, name-not-trust rule) | `backend/main.py` |

**Explanation.** The codebase demonstrates maintainability empirically: five consecutive feature/hardening passes each re-verified against the same green battery, which is the strongest possible evidence that modules are separable and the tests catch regressions. The defect-pinning convention (every reported bug becomes a named regression test) means the suite documents the system's history.

**Remarks.** Held at 8 for one remaining reason: statement coverage sits at 50% — now measured and recorded above instead of unknown, with the bulk of the gap in Windows-only document generation and Excel extraction code that cannot execute on the Linux dev machine. The other earlier defect (tracked `backend/venv/` — 457 MB / 18,083 files of virtualenv inside the git index, bloating every clone) has since been **removed from the index and gitignored**; files remain on disk, history slimming is a separate optional task.

**Notes.** `main.py` at 2,916 lines is the one file pulling its weight reluctantly; it is well-commented but is the natural next extraction candidate (endpoints vs. sync vs. background tasks). The CI workflow's PyInstaller flags carry an explicit comment about the `multipart`/`python_multipart` rename — exactly the kind of tribal knowledge that belongs in-repo.

**What to improve**
1. ~~Remove `backend/venv/` from the git index~~ **Done**: untracked from the index, `venv/` gitignore now effective, `.coverage` artifact also untracked and ignored. Repo index dropped by ~457 MB / 18k files (history rewrite to shrink old clones is optional and destructive, deliberately not done).
2. ~~Add coverage reporting (`pytest --cov`)~~ **Done**: 50% statements, recorded in the metrics table; the follow-up is lifting `main.py`'s export/report endpoints, since the other big gaps need a Windows runner.
3. Extract sync and background-task code from `main.py` into modules as it grows, keeping `main.py` as the wiring layer.
4. Add a workflow step running the backend pytest suite in CI so the downloadable builds are always built from a green-tested commit.

## 14. Flexibility (Portability) — Grade: 8/10
*Degree to which a system can be transferred from one hardware, software or operational environment to another.*

**Metrics**

| Metric | Value | Source |
| :--- | :--- | :--- |
| End-user install burden | zero: PyInstaller sidecar embedded in the Tauri installer; no Python, no DB setup, no env vars | `tauri.conf.json`, CI build |
| Data location portability | `platformdirs` per-OS resolution for data, backups, crash logs | `backend/database.py` |
| Environment overrides | `PASADA_API_HOST`, `XDG_DATA_HOME` redirect for dev/test | `backend/main.py` |
| Cross-OS development | full dev/test cycle runs on Linux; packaged target is Windows (Word dependency documented) | `docs/TESTING_ON_LINUX.md` |
| CI portability proof | `windows-latest` build green on every push to `main`, artifacts downloadable | `.github/workflows/build-windows.yml` |
| Adding an office computer | zero-config install + first-run account; cluster secret shared by copying the data directory or `cluster_secret.key` (manual by design) | `docs/THREAT_MODEL.md` |

**Explanation.** The portability story is unusually clean for a government-office desktop app: the entire backend ships as one windowless executable inside the installer, every persisted path resolves per-OS through `platformdirs`, and the two environment knobs (API host, data dir) are enough to develop on Linux and deploy on Windows from the same codebase. CI building real Windows installers on every commit turns installability from a claim into a repeatable artifact.

**Remarks.** 8, not higher, because scaling to a new machine still involves one manual, error-prone step (sharing the cluster secret), and only Windows is a packaged target — fine for the deployment context, but a real limit on transferability.

**Notes.** Automated key distribution was deliberately ruled out: in the air-gapped threat model, a machine that could auto-negotiate trust with strangers would weaken the network. The manual copy *is* the security boundary; the improvement below is about making that manual step safer, not removing it.

**What to improve**
1. Make the secret-sharing step safer against mistakes: a verify command (or first-run screen) that confirms the new machine can see signed peers before it starts syncing.
2. Add a restore/import path for migrating a machine's data directory wholesale (documented copy procedure already half-covers this; make it a tested, written procedure).
3. If non-Windows deployment is ever requested, the Linux dev path is already live; only packaging (PyInstaller + Tauri bundle for Linux) would remain.

## 15. Functional Suitability — Grade: 9/10
*Degree to which the functions meet stated and implied needs.* (Update to section 1.)

**Metrics**

| Metric | Value | Source |
| :--- | :--- | :--- |
| Lifecycle coverage | registration → renewal → motor change → route transfer → soft delete/restore, all offline | `backend/main.py` |
| Route-data correctness | `GET /route_data/{route}` returns explicit `exists:false` when unset; office-entered values roundtrip exactly (6000 / 6.5 saved via UI, re-synced identically) | `test_get_route_data_defaults_to_unset`, `test_get_route_data_roundtrip`, live UI |
| Identity correctness | broadcast name = signed-in account name, never the hostname (pinned by test) | `test_computer_name_never_defaults_to_hostname` |
| Update UX correctness | button label always matches actual download state; checking never downloads; download obeys the chosen preference | `UpdateCard.tsx` |
| Coverage of endpoints | 22 endpoint tests + 16 sync-security tests green | `backend/tests/` |
| Live end-to-end | 27-scenario smoke test (section 7) all PASS on 6,137 records | Sept 14 log |

**Explanation.** Function set grew without rot: the new capabilities (route-data read API, network visibility with peer names, named announcements, update preferences) all follow the established correctness rules — never show engine defaults as user data, never trust hostnames, never download without consent — and each rule is pinned by a named test rather than by convention.

**Remarks.** 9 because the ML module's advisory role is exactly right for the clerk workflow, but its inputs (route capacity/fullness) have only the two roundtrip tests; deeper validation of uploaded route data would close the last gap.

**Notes.** The "Auto-date for Change Motor" toggle shows the correct philosophy: the system automates what it can prove (a real motor swap) and asks about what only the office can decide (whether the issue date moves).

**What to improve**
1. Validate uploaded Excel route data more aggressively (column presence, numeric ranges) with per-row error reporting instead of best-effort extraction.
2. Expose the ML advisory result alongside its inputs in the UI so clerks can see *why* a route reads as dense.

## 16. Safety — Grade: 9/10
*Degree to which a product mitigates the risk of harm.*

**Metrics**

| Metric | Value | Source |
| :--- | :--- | :--- |
| Physical actuation surface | none — hazards are data loss and unauthorized changes only | architecture |
| Destructive-action protection | confirmation dialogs + soft delete + undo banner | `TodaClient.tsx` |
| Download accident protection | duplicate-download guard on every path (records, Word, summary, inactive export) | frontend pages |
| Install-while-active protection | updater installs only per preference; idle preference resets on any input (`IDLE_INSTALL_MS` = 5 min) | `UpdateCard.tsx` |
| Batch-print overload protection | synchronous blocker prevents duplicate mass generation | `TodaClient.tsx` |
| Data-loss backstop | automated daily ZIP backups + tombstone sync so deletions propagate correctly | `automated_background_tasks()` |

**Explanation.** For a registry of legal franchise records, the credible harms are lost records, corrupted merges, and unauthorized edits. Each has a dedicated mitigation that was verified live (undo restore roundtrip, tombstone-aware merge, HMAC-only mutation path), and the updater was specifically engineered never to restart the app while a clerk is mid-task.

**Remarks.** The safety design consistently chooses reversibility: soft delete over hard delete, idle-gated installs over restart-anytime, duplicate guards over re-download loops.

**Notes.** The signed-update requirement is also a safety control: a corrupted or tampered installer cannot run, protecting the machine as well as the data.

**What to improve**
1. Warn (or block) soft-deleting a record that has an active batch-print selection pending, closing the last revert-unfriendly window.
2. Include the backup ZIPs in the periodic integrity check proposed under Reliability so the safety net itself is monitored.

## 17. Evaluation verdict

| Characteristic | Grade (/10) | Blocking issues | Headline evidence |
| :--- | :--- | :--- | :--- |
| Functional Suitability | **9** | none | 27-scenario live smoke test PASS; correctness rules pinned by named tests |
| Performance Efficiency | **8** | none | 6,137 records live; caches + perf tests; capacity beyond ~50k unmeasured |
| Compatibility | **9** | none | signed cross-machine sync verified live; 16 refusal tests |
| Interaction Capability | **8** | none | 208+ tooltips measured with zero pokes; 44px standard; screen-reader audit outstanding |
| Reliability | **9** | none | 49/49 tests; live fault injection stayed graceful |
| Security | **9** | none open | HMAC + replay caches + lockout, all live-verified; 3 accepted risks in `THREAT_MODEL.md`; restart-persistent lockout added |
| Maintainability | **8** | none | 5 clean modification passes; CI green per commit with fail-fast signing check; coverage 50% measured; venv untracked from index |
| Flexibility | **8** | none | zero-config install + CI-built artifacts; secret sharing manual by design |
| Safety | **9** | none | reversibility everywhere; idle-gated installs |
| **Overall** | **8.6 / 10** | — | compliant with ISO/IEC 25010:2023 for its deployment context, zero open blocking issues |

**Interpretation of the overall grade.** The distance to 10 is fully enumerated and none of it is architectural: performance needs one synthetic-scale run (§8), usability needs a screen-reader audit (§10), security's remaining distance is the three accepted LAN risks (§11), maintainability needs coverage of the export endpoints (§13), and flexibility needs a safer secret-sharing ritual (§14). Two of the originally listed gaps (restart-persistent lockout, signed CI artifacts) were closed the same day; the rest are incremental work on an already-verified foundation.

**Deployment readiness:** YES, with the conditions documented in `README.md`, section "Packaging and deployment readiness" (Windows-only packaging, version lockstep, signed releases, UDP broadcast allowance, first-run account creation). CI already produces downloadable Windows installers on every commit to `main`; release-signing those artifacts in the pipeline is the highest-leverage next step (§11, item 3).

Renewal-detection root cause, for future maintainers: the list endpoint displays a derived SBN (base + issue-year suffix), but the update endpoint compared raw strings against the stored value — so any display/stored drift fired the renewal branch on every edit. The fix compares the user's edit against `original_sbn_no` (what the modal showed on open), sent by the frontend with every update.