PASADA is a specialized municipal tricycle franchise registry system designed for Local Government Units (LGUs) in the Philippines. It serves as a centralized digital ledger for managing Motorized Tricycle Operator's Permits (MTOP), automating the lifecycle of franchise records from initial application to document generation and regulatory compliance monitoring.

The system is built as a hybrid desktop application, combining a high-performance FastAPI (Python) backend with a modern Next.js frontend, all encapsulated within a Tauri shell to provide a native Windows experience.

PASADA is a software designed and engineered by Mr. Ben James Jocson Duag of B&V Software Solutions, Inc.

Core Architecture
PASADA utilizes a "Sidecar Pattern" where the UI and the logic service run as separate processes on the local machine. This ensures that the application remains functional in air-gapped environments typical of local government offices while providing the responsiveness of a web application.

Major Subsystems
1. Hybrid Desktop Shell 

The application is wrapped in Tauri, which provides the native windowing and manages the lifecycle of the Python backend. The backend is compiled into a "sidecar" executable that starts automatically when the user opens the application.

- Key Detail: The frontend polls the /health endpoint of the backend to ensure the service is ready before allowing user interaction.

2. FastAPI Backend & API

The backend serves as the authoritative source for all business logic, including Franchise Record management, authentication via JWT, and system settings.

- Key Logic: Handles the generation of Sangguniang Bayan Number (SBN) and computes record statuses (ACTIVE, FLAGGED, REVOKED).

3. Data Persistence & Self-Healing

PASADA uses SQLite with SQLAlchemy ORM. The system includes a self-healing migration layer that automatically updates the database schema (e.g., adding missing columns like is_deleted) when a new version is installed.

- Key Files: backend/models.py, backend/database.py.

4. Document Processing Pipeline

A critical feature of PASADA is the automated generation of MTOP certificates. It uses a template-based approach to inject database records into .docx files and attempts to convert them to PDF for printing.

- Key Logic: doc_generator.py uses win32com to interface with Microsoft Word for high-fidelity rendering.

5. LAN Sync Engine

To support offices with multiple computers without a central server, PASADA includes a peer-to-peer sync engine. It uses UDP broadcasting to find other instances of PASADA on the local network and synchronizes records via an incremental pull mechanism.

- Key Logic: sync_engine.py manages background threads for discovery and data exchange.
