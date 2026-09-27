# PASADA System Threat Model & Security Architecture

## 1. Executive Summary
The PASADA Franchise Registry System is architected specifically for a highly constrained deployment environment: a rural municipal government office. 

This document outlines the specific environmental assumptions, the identified threat vectors, and the justification for intentionally omitting standard web-security paradigms (such as strict CORS, complex RBAC, and internet-facing authentication).

## 2. Deployment Environment Assumptions
The security posture of this application relies on the following immutable realities of its deployment:
1.  **Air-Gapped / Isolated Local Area Network:** The application runs on Windows workstations connected to a secure, offline intranet or local Wi-Fi router lacking external internet egress.
2.  **Single Trust Tier:** There is no "User vs. Admin" hierarchy. All operators of the software are authorized municipal clerks tasked with the same registry duties.
3.  **Physical Security Over Logical Security:** Security against unauthorized data access is enforced by the physical security of the municipal office, locked workstations, and Windows OS-level user accounts, rather than complex application-layer access controls.

## 3. Threat Matrix & Mitigations

### Threat 1: Unauthorized Network Access & Data Exfiltration
*   **Vector:** A malicious actor attempts to hit the backend API from the LAN to scrape citizen franchise data.
*   **Mitigation Strategy (Addressed as of the September 2026 hardening pass):**
    *   The API binds to all interfaces so peer-to-peer (P2P) database synchronization works without a central IT administrator, but the only LAN-reachable data surface is the sync pull endpoint.
    *   Every pull request must carry an HMAC-SHA256 signature over the addressed host, a timestamp, and a one-time nonce, made with the shared cluster secret. The secret itself never crosses the network.
    *   Signatures older than 5 minutes are refused (stale-timestamp window), reused nonces are refused (replay caches on both pull and discovery), and signatures over addresses this machine does not answer for fail closed. Verified in `backend/tests/test_sync_security.py`.
    *   CORS is a strict allowlist (`tauri://localhost`, the localhost dev server), so a website open in a browser on a workstation cannot read records from the local API. (The earlier `allow_origins=["*"]` posture documented in the first revision of this file was a vulnerability and has been removed.)
    *   The pull response strips password hashes and security-answer hashes; synced accounts arrive without a usable password until an administrator resets it.

### Threat 2: Accidental Cluster Cross-Talk
*   **Vector:** Two separate municipalities or departments deploy PASADA on overlapping networks, causing their background sync engines to accidentally merge unrelated databases.
*   **Mitigation Strategy (Addressed):**
    *   The background sync engine utilizes a `CLUSTER_SECRET` (a randomly generated UUID upon first boot, shared among intended peers).
    *   Discovery broadcasts are HMAC-signed and pull requests are HMAC-authenticated; a machine without the exact secret neither joins a cluster nor reads from it, so accidental cross-talk and deliberate spoofing are both refused.
    *   Discovery payloads carry only the signed sender IP and a display label (the signed-in account's name); no secret material and no record data are broadcast.

### Threat 3: Formula Injection (CSV / Excel)
*   **Vector:** A malicious clerk enters a payload like `=cmd|' /C calc'!A0` into an operator's name field. When exported to the Masterlist and opened by a superior in Microsoft Excel, the payload executes arbitrary code.
*   **Mitigation Strategy (Addressed):** 
    *   The export pipeline enforces an `escape_excel()` sanitization function. Any string beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` is explicitly prepended with an apostrophe (`'`), forcing Excel to evaluate the data strictly as plaintext.

### Threat 4: Path Traversal via Document Generation
*   **Vector:** An operator name is entered as `../../../windows/system32/cmd.exe` in an attempt to force the PDF generator to overwrite or write to secure system directories.
*   **Mitigation Strategy (Addressed):** 
    *   The `doc_generator.py` utilizes a violent RegEx scrubber (`re.sub(r'[^A-Za-z0-9_\-]', '', ...)`) on operator names and inputs before appending them to the file path, neutralizing any path traversal syntax before it reaches the OS file system.

## 4. Features Explicitly Out of Scope

An auditor reviewing this codebase will note the absence of the following standard features. Their omission is documented and approved based on the single-tier, offline nature of the deployment:

*   **Role-Based Access Control (RBAC):** All generated JWT tokens grant "Clerk" access. There are no super-admin dashboards or restricted routes.
*   **Password Complexity/Rotation Enforcement:** Beyond a basic 8-character limit during signup, there are no cryptographic complexity enforcements (symbols, numbers, uppercase).
*   **HTTPS / TLS:** The application communicates over unencrypted `http://` internally and across the LAN, as there is no central Certificate Authority available in the offline environment to issue trusted certificates.