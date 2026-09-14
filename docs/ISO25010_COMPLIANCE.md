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
| **Integrity** | The `/token` login endpoint throttles brute-force attempts: after 5 consecutive failed passwords for the same username, the account is locked for 15 minutes and returns HTTP 429 even if the correct password is then supplied. A successful login clears the counter. The throttle lives in server memory only — no new database tables, no internet dependency — so it works unchanged on the air-gapped LGU LAN and resets cleanly on service restart. | `backend/main.py:login()`, `backend/tests/test_api_endpoints.py:test_login_rate_limit_and_lockout()` |

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
| 8 | Full backend regression suite (unit + endpoint + performance) after the lockout and label changes | All tests green | PASS |
| 7 | Export Excel (route page) | Masterlist `.xlsx` downloaded; `EXPORT_MASTERLIST` logged | PASS |
| 8 | Delete → Undo Delete | Soft delete then restore; both logged; row returns to the table | PASS |
| 9 | Record History modal | Correct per-record audit trail (CHANGE_MOTOR / RENEWAL / EDIT_RECORD) | PASS |
| 10 | Logs page + action filter | Rows render; filtering by CHANGE MOTOR shows only that action | PASS |
| 11 | Inactive / Global Search pages | Filters, pagination, and results render correctly | PASS |
| 12 | Settings signatory save | `PUT /settings` 200; value persisted | PASS |

Regression tests pinning scenarios 1–3 live in `backend/tests/test_api_endpoints.py` (`test_suffix_drift_edit_is_not_renewal`, `test_genuine_sbn_edit_still_triggers_renewal`, alongside the earlier change-motor tests). Full backend suite: **27 passed**. Frontend: `tsc --noEmit` clean, `next build` succeeds.

Renewal-detection root cause, for future maintainers: the list endpoint displays a derived SBN (base + issue-year suffix), but the update endpoint compared raw strings against the stored value — so any display/stored drift fired the renewal branch on every edit. The fix compares the user's edit against `original_sbn_no` (what the modal showed on open), sent by the frontend with every update.