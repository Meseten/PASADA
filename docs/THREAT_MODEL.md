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

## 5. Accepted Risks Register (reviewed Sept 28, 2026)

Three residual risks are **accepted by design**, not deferred work. Each entry records the risk, the compensating control that makes it safe in this deployment, the failure mode if the control fails, and the condition that would reopen the decision.

### Risk 1: No TLS on the LAN (transport confidentiality)
*   **Exposure:** A device on the office network can read sync traffic between the two PASADA machines.
*   **Compensating controls:** Every mutation request is individually HMAC-SHA256-signed and replay-cached, so integrity and authenticity never depend on transport encryption. Records are protected by authentication (bcrypt + JWT), not wire secrecy. There is no untrusted party on a closed municipal LAN behind the LGU firewall.
*   **Failure mode:** If the LAN is ever bridged to the public internet or shared with unmanaged devices (guest Wi-Fi, contractors' laptops), passive sniffing becomes possible. Authentication still blocks *writes*; reads of pull responses become the residual exposure.
*   **Reopen the decision when:** The office network gains internet egress, a shared Wi-Fi segment, or any non-LGU device.
*   **Mitigating action now:** None required. Do not add TLS certificates without a CA — self-signed certs on two machines recreate the trust-distribution problem this design avoids.

### Risk 2: Readable discovery broadcast (information disclosure)
*   **Exposure:** Anyone on the LAN segment can see that PASADA machines exist and read their display names (the signed-in account name).
*   **Compensating controls:** The broadcast carries an IP, timestamp, nonce, display name, and HMAC — no records, no tokens, no secret material. The name is display-only and excluded from every trust decision (`test_computer_name_never_defaults_to_hostname`); knowing a name grants nothing. Discovery payloads are versioned and unsigned/badly-signed ones are dropped.
*   **Failure mode:** Effectively none beyond reconnaissance. An attacker still needs the cluster secret to join or read anything.
*   **Reopen the decision when:** The network becomes shared with an organization that treats the machine inventory itself as sensitive.
*   **Mitigating action now:** None required.

### Risk 3: Manual cluster-secret copying (key distribution)
*   **Exposure:** Adding a machine to the sync cluster requires physically copying `cluster_secret.key` from an existing machine; a mistake (wrong file, wrong machine) means the new machine silently never syncs.
*   **Compensating controls:** Physical transfer is the *strongest* available trust anchor in an air-gapped office — automating distribution would require a network bootstrap an interloper could race. A wrong or missing secret fails loudly: the machine never joins the peer list (unsigned broadcasts are dropped) and pulls are refused; nothing ever half-syncs. The secret never crosses the network.
*   **Failure mode:** Human error during the copy — copying the wrong file, or emailing the key (which would defeat the whole design).
*   **Verified first-run ritual (do exactly this, in order):**
    1.  Install PASADA on the new machine. Sign in with the first-run account.
    2.  On the admin machine, locate the data directory (per-user app-data folder; see `backend/database.py` `BASE_DIR`) and copy **only** `cluster_secret.key` to a USB drive.
    3.  Paste the file into the new machine's data directory (same folder the app created).
    4.  Restart PASADA on the new machine.
    5.  Open Settings → Connections on the new machine: the admin machine must appear **by its account name** within ~30 seconds (two broadcast cycles).
    6.  Add a test record on one machine; confirm it appears on the other within ~30 seconds of the sync cycle.
    7.  If peers never appear: re-check the file landed in the right folder and both machines are on the same subnet. Do **not** disable the firewall beyond the two PASADA ports (54321/udp, 43888/tcp).
*   **Reopen the decision when:** The cluster grows past a handful of machines or machines are added more than a few times a year — then revisit a documented key-rotation procedure.

### Review cadence
Re-read this register during the quarterly verification pass (same session as the NVDA screen-reader check on the office machines). Confirm: LAN still air-gapped, no new shared segments, secret files still on exactly the intended machines (`dir` listing, not contents), and the backup retention sweep still running (crash log shows `Backup retention:` lines).