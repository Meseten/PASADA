# PASADA System Threat Model & Security Architecture

## 1. Executive summary

PASADA is a municipal tricycle franchise registry built for a constrained
deployment: a rural municipal government office with two Windows workstations
on a closed LAN and no central IT. This document states the environmental
assumptions, the threat vectors considered, the defenses in place, and the
risks consciously accepted. It is the reference for anyone auditing the
security posture; `docs/ISO25010_COMPLIANCE.md` maps the same evidence to the
ISO/IEC 25010 quality model.

## 2. Deployment environment assumptions

The security posture relies on these realities:

1. **Closed LAN, no internet egress.** The workstations share a router that
   does not reach the internet. The only machines on the segment are LGU
   property.
2. **Two trust tiers inside the app.** Clerks do everyday record work; the
   Admin account owns accounts, templates, database import/restore, and the
   approval queue. Heavy actions (route delete/rename, batch restore) are
   two-key: a clerk files a ticket, the Admin approves before anything
   changes. Verified by `test_admin_console.py`.
3. **Physical security over logical security.** Locked office, locked
   workstations, Windows accounts. The app deliberately does not duplicate
   those controls.
4. **One updater source.** Installers come only from the official GitHub
   Releases page and only after a minisign signature check against the public
   key embedded in the app.

## 3. Defenses in place

| Layer | Control | Verified by |
|-------|---------|-------------|
| Transport | HMAC-SHA256 over every sync pull and discovery broadcast; secret never on the wire | `test_sync_security.py` |
| Replay | Nonce caches on pull and discovery; 5-minute freshness window | `test_sync_security.py` |
| Address binding | Signature covers the peer IP the request is addressed to; wrong-address fails closed | `test_sync_security.py` |
| Brute force | 5 failed logins lock the account 15 minutes; lock persists across backend restart via the `login_lockouts` table | `test_login_lockout_persists_across_restart` |
| Password storage | bcrypt everywhere; hashes are shared only inside the HMAC-signed cluster so accounts roam between office computers; security-answer hashes never leave the machine that set them | `test_user_management.py` |
| Browser attacks | CORS allowlist (`tauri://localhost`, localhost dev); no wildcard | middleware in `main.py` |
| Excel formula injection | `escape_excel()` prefixes `= + - @ \t \r` with `'` on every export | Threat 3 below |
| Path traversal | Regex scrubber on names before they reach file paths | Threat 4 below |
| Import abuse | Missing-header spreadsheets rejected with a named error; DB uploads capped at 500 MB streamed | `test_upload_validation.py` |
| Audit-table dumping | Log pagination capped (page_size ≤ 500) | `get_audit_logs` |
| Supply chain (updates) | minisign signature over every installer; updater refuses unsigned/mismatched bundles | `tauri.conf.json` pubkey |
| Audit trail | Every mutation, login, and lockout logged with actor and timestamp; exportable | Logs page |
| Insider misuse (big actions) | Route delete/rename and batch restore need Admin approval via the ticket queue; database import and Full Restore are Admin-only endpoints | `test_admin_console.py` |

## 4. Threat matrix and mitigations

### Threat 1: Unauthorized network access and data exfiltration

**Vector.** A malicious actor on the LAN hits the backend API to scrape
franchise data.

**Mitigation.** The API binds to all interfaces so peer sync works without a
central administrator, but the only LAN-reachable data surface is the sync
pull endpoint. Every pull must carry a fresh HMAC signature over the
addressed host, a timestamp, and a one-time nonce, made with the shared
cluster secret that never crosses the network. Stale signatures, reused
nonces, and signatures over wrong addresses all fail closed. CORS is a strict
allowlist, so a website open in a workstation browser cannot read the local
API. (The original `allow_origins=["*"]` posture was a vulnerability and was
removed in the September 2026 hardening pass.)

### Threat 2: Accidental cluster cross-talk

**Vector.** Two municipalities or departments run PASADA on overlapping
networks and their sync engines merge unrelated databases.

**Mitigation.** Each cluster generates a random `CLUSTER_SECRET` on first
boot. Discovery broadcasts and pulls are HMAC-signed with it, so a machine
without the exact secret neither joins nor reads. Discovery payloads carry
only the signed sender IP and a display label; a version field
(`DISCOVERY_PROTOCOL_VERSION`) makes a mixed-version office fail cleanly
instead of half-parsing. No record data is ever broadcast.

### Threat 3: Formula injection via CSV/Excel

**Vector.** A payload like `=cmd|' /C calc'!A0` entered in a name field
executes when a superior opens the exported masterlist in Excel.

**Mitigation.** The export pipeline runs every string through
`escape_excel()`, which prefixes `=`, `+`, `-`, `@`, tab, and CR with an
apostrophe so Excel evaluates the cell as plaintext.

### Threat 4: Path traversal via document generation

**Vector.** An operator name like `../../windows/system32/cmd.exe` is used to
steer file writes into system directories.

**Mitigation.** `doc_generator.py` scrubs every input with
`re.sub(r'[^A-Za-z0-9_\-]', '', ...)` before appending it to a path.
Uploads to import/restore endpoints get UUID names; user-supplied filenames
never touch the filesystem.

### Threat 5: Resource exhaustion via uploads or pagination

**Vector.** An authenticated user uploads a multi-gigabyte file to fill the
disk, or requests `page_size=1000000` to dump the audit table.

**Mitigation.** Database upload/restore endpoints stream in 1 MB chunks and
reject past 500 MB (HTTP 413, temp file deleted). Log endpoints cap
`page_size` at 500. Both added in the Sept 28, 2026 hardening pass.

### Threat 6: Malicious update

**Vector.** An attacker publishes a trojaned installer where clerks will find
it.

**Mitigation.** The Tauri updater verifies the minisign signature of every
bundle against the public key embedded in the app binary before installing.
Releases are published only by the tag-triggered GitHub Actions workflow from
this repository. A corrupted or tampered installer cannot run.

## 5. Features explicitly out of scope

These omissions are deliberate and approved for the single-tier, offline
deployment:

- **RBAC.** All tokens grant the same clerk-level access; Windows accounts
  and the locked office handle personnel boundaries. Admin-role gating exists
  on the user-management endpoints and Settings panel only.
- **Password complexity/rotation.** Signup enforces an 8-character minimum;
  nothing more. The recovery-question path resets passwords on a single
  machine.
- **HTTPS/TLS.** Traffic is plaintext HTTP on the LAN. There is no CA
  available offline to issue trusted certificates; self-signed pairs would
  recreate the key-distribution problem the cluster secret already solves
  more simply. HMAC gives integrity and authenticity on every mutation;
  confidentiality rides on authentication and the closed network.

## 6. Accepted risks register (reviewed Sept 28, 2026)

Three residual risks are **accepted by design**, not deferred work. Each
entry records the exposure, the compensating control, the failure mode, and
the condition that reopens the decision.

### Risk 1: No TLS on the LAN

- **Exposure.** A device on the office network can read sync traffic between
  the PASADA machines.
- **Compensating controls.** Every mutation is individually HMAC-signed and
  replay-cached; integrity never depends on transport encryption. Records
  are protected by authentication, not wire secrecy. The LAN is closed LGU
  property.
- **Failure mode.** If the LAN gains internet egress or shares a segment with
  unmanaged devices, passive reading of pull responses becomes possible.
  Writes stay protected by signature.
- **Reopen when.** Internet egress, guest Wi-Fi, or any non-LGU device joins
  the network.
- **Action now.** None. Do not add self-signed TLS: it recreates the
  trust-distribution problem without removing the threat.

### Risk 2: Readable discovery broadcast

- **Exposure.** Anyone on the segment learns that PASADA machines exist and
  sees their display names (the signed-in account name).
- **Compensating controls.** The broadcast carries IP, version, timestamp,
  nonce, name, HMAC; no records, tokens, or secrets. The name is display-only
  and excluded from every trust decision
  (`test_computer_name_never_defaults_to_hostname`). Knowing a name grants
  nothing without the cluster secret.
- **Failure mode.** Reconnaissance only.
- **Reopen when.** The network is shared with an organization that treats
  machine inventory as sensitive.
- **Action now.** None.

### Risk 3: Manual cluster-secret copying

- **Exposure.** Adding a machine requires physically copying
  `cluster_secret.key`; a mistake means the new machine silently never syncs.
- **Compensating controls.** Physical transfer is the strongest trust anchor
  available offline; automating distribution would need a network bootstrap
  an interloper could race. A wrong or missing secret fails loudly: the
  machine never joins the peer list and pulls are refused. Nothing
  half-syncs.
- **Failure mode.** Human error during the copy, or the key being emailed
  (which would defeat the design).
- **Verified first-run ritual.** Do exactly this, in order:
  1. Install PASADA on the new machine and sign in with the first-run
     account.
  2. On an existing machine, open its data directory (per-user app-data
     folder; see `BASE_DIR` in `backend/database.py`) and copy **only**
     `cluster_secret.key` to a USB drive.
  3. Paste the file into the new machine's data directory.
  4. Restart PASADA on the new machine.
  5. Open Settings → Connections: the other machine must appear **by its
     account name** within about 30 seconds (three broadcast cycles).
  6. Add a test record on one machine; confirm it appears on the other
     within about 30 seconds of the sync cycle.
  7. If peers never appear: check the file landed in the right folder and
     both machines are on the same subnet. Allow only the two PASADA ports
     (54321/udp, 43888/tcp) through any firewall; do not disable it.
- **Reopen when.** The cluster grows beyond a handful of machines or machines
  are added frequently; then document a key-rotation procedure first.

## 7. Review cadence

Re-read this register during the quarterly verification pass (the same
session as the NVDA screen-reader check on the office machines). Confirm:

- The LAN is still air-gapped; no new shared segments.
- Secret files exist on exactly the intended machines (a directory listing,
  never the contents).
- The daily DB `quick_check` and the backup retention sweep are logging to
  the crash log.
- The latest release on GitHub matches the version installed in the office.
