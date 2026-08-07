# ISO/IEC 25010 Software Quality Compliance Report
**System:** PASADA Franchise Registry System  
**Architecture:** Local-first, offline-capable desktop application (Tauri + React/Next.js) with a packaged FastAPI/SQLite sidecar.

This document serves as an audit artifact mapping the system's architectural decisions and codebase to the ISO/IEC 25010 software quality model.

## 1. Functional Suitability
*Degree to which the product provides functions that meet stated and implied needs when used under specified conditions.*

| Sub-characteristic | Implementation Justification | Evidence Reference |
| :--- | :--- | :--- |
| **Functional Completeness** | The system natively handles the full lifecycle of municipal tricycle franchise records: initial registration, renewals, motor changes, and route transfers without requiring external internet tools. | `backend/main.py:update_franchise()` |
| **Functional Correctness** | Database bulk imports use stable, deterministic identifiers (composite SBN parsing and UUIDs) to prevent silent data loss. Empty chassis or motor entries are explicitly treated as non-deduplicable entities to preserve vacant slot integrity. | `backend/main.py:upload_database_file()` |
| **Functional Appropriateness** | The machine learning module (K-Means Clustering) provides density analysis as an *advisory* metric rather than a hard permit-gate, aligning with the real-world administrative override capabilities required by municipal clerks. | `backend/ml_engine.py:run_kmeans_clustering()` |

## 2. Reliability
*Degree to which a system, product or component performs specified functions under specified conditions for a specified period of time.*

| Sub-characteristic | Implementation Justification | Evidence Reference |
| :--- | :--- | :--- |
| **Fault Tolerance** | The application utilizes an automated DB migration wrapper that detects legacy database schemas (e.g., pre-soft-delete tables) and dynamically injects missing columns (`is_deleted`) to prevent catastrophic query failures upon boot. | `backend/database.py:ensure_schema_upgrades()` |
| **Recoverability** | Automated, stateful background tasks generate daily ZIP backups of the SQLite database if active modifications occurred, ensuring point-in-time recovery independent of user action. | `backend/main.py:automated_background_tasks()` |
| **Availability** | Document generation failures (e.g., missing local LibreOffice/Word dependencies for PDF conversion) are caught via narrowed exception handlers, logged gracefully, and seamlessly fall back to generating raw `.docx` files to ensure operational continuity. | `backend/doc_generator.py` |

## 3. Maintainability
*Degree of effectiveness and efficiency with which a product or system can be modified.*

| Sub-characteristic | Implementation Justification | Evidence Reference |
| :--- | :--- | :--- |
| **Modularity** | Complex business logic—specifically the temporal derivation of record statuses (Active, Flagged, Revoked, Vacant)—is centralized as a single source of truth in the backend layer rather than duplicated across frontend UI components and export endpoints. | `backend/main.py:compute_record_status()` |
| **Testability** | Critical edge-cases, particularly Philippine-centric date parsing formats (DD-MM-YYYY) and duplicate evaluation logic, are isolated and covered by deterministic unit tests to ensure future code modifications do not introduce regressions. | `backend/tests/test_business_logic.py` |
| **Analyzability** | Fatal exceptions at the OS-level and application layer are intercepted and written to a dedicated physical crash log (`PASADA_CRASH_LOG.txt`), allowing auditors and maintainers to diagnose state failures in environments lacking cloud telemetry. | `backend/main.py:exception_hook()` |

## 4. Usability
*Degree to which a product or system can be used by specified users to achieve specified goals with effectiveness, efficiency and satisfaction.*

| Sub-characteristic | Implementation Justification | Evidence Reference |
| :--- | :--- | :--- |
| **User Error Protection** | User interfaces accurately reflect system capabilities. Controls representing background services (such as LAN Peer Sync) explicitly communicate their automated nature rather than providing deceptive "force sync" push-buttons. | `frontend/src/app/settings/page.tsx` |
| **Operability** | Batch printing parameters utilize explicit filtering controls (e.g., Specific Date, Date Ranges) with synchronous UI blockers to prevent accidental system overload from mass document generation. | `frontend/src/app/toda/[route]/TodaClient.tsx` |

## 5. Portability
*Degree of effectiveness and efficiency with which a system, product or component can be transferred from one hardware, software or other operational or usage environment to another.*

| Sub-characteristic | Implementation Justification | Evidence Reference |
| :--- | :--- | :--- |
| **Installability** | The backend relies exclusively on standard Python built-ins, SQLite, and PyInstaller, allowing it to be packaged as a single, self-contained sidecar executable embedded directly into the Tauri Windows `.msi` without requiring the end-user to install Python, configure databases, or manage environment variables. | `tauri.conf.json` |