# PASADA

PASADA is a municipal tricycle franchise registry for Local Government Units (LGUs) in the Philippines. It is a centralized digital ledger for Motorized Tricycle Operator's Permits (MTOP): it tracks every franchise slot on every TODA line from initial application through renewal, flags non-renewal, generates certificates and summary documents, and keeps multiple office computers in sync without a server.

---

## Table of contents

1. [How it works](#how-it-works)
2. [The five subsystems](#the-five-subsystems)
3. [Every page, what it does](#every-page-what-it-does)
4. [Records and statuses](#records-and-statuses)
5. [Records page guide](#records-page-guide)
6. [Dashboard guide](#dashboard-guide)
7. [Import, search, and Activity History](#import-search-and-activity-history)
8. [Settings guide](#settings-guide)
9. [Connection status and computer names](#connection-status-and-computer-names)
10. [Keyboard shortcuts and right-click](#keyboard-shortcuts-and-right-click)
11. [Keeping PASADA up to date](#keeping-pasada-up-to-date)
12. [The guided tutorial](#the-guided-tutorial)
13. [Tooltips and accessibility](#tooltips-and-accessibility)
14. [Security model](#security-model)
15. [Getting started (development)](#getting-started-development)
16. [Packaging and deployment readiness](#packaging-and-deployment-readiness)
17. [Releasing](#releasing)
18. [Troubleshooting](#troubleshooting)
19. [Project layout and documentation index](#project-layout-and-documentation-index)
20. [Support](#support)

---

## How it works

PASADA uses a sidecar pattern: the interface is a Tauri 2 desktop app (Next.js frontend compiled to static assets) and the logic runs as a compiled FastAPI (Python) executable beside it. When you open PASADA, Tauri starts the backend automatically and the login screen waits until the backend answers its health check. Everything runs on the local machine, so the app works in offices with no internet at all.

## The five subsystems

| Subsystem | What it does | Where |
|-----------|--------------|-------|
| Hybrid desktop shell | Native window, backend lifecycle, signed auto-updates, safe right-click menu | `frontend/src-tauri/` |
| FastAPI backend | Records, JWT auth, statuses, exports, ML predictions, LAN pull endpoint | `backend/main.py` |
| Data persistence | SQLite + SQLAlchemy with a self-healing schema layer | `backend/database.py` |
| Document pipeline | `.docx` template injection, Word/PDF conversion for printing | `backend/doc_generator.py` |
| LAN sync engine | Signed UDP discovery, cluster secret, incremental peer pull | `backend/sync_engine.py` |

## Every page, what it does

| Page | Purpose |
|------|---------|
| **Sign in** (`/`) | Account login, first-run registration, and password recovery via three security questions |
| **Dashboard** | KPI cards, per-route charts, and the Route Info card feeding the ML fullness estimate |
| **Records** (`/toda/ROUTE`) | One page per TODA line: the operator registry with edit/renew, certificates, batch printing |
| **Search** | Global search across every route, with the same edit/history/certificate actions |
| **Import Records** | Bulk upload of Excel masterlists with deduplication and error logs |
| **Inactive Operators** | Archive of slots revoked after 2+ years of non-renewal, still printable |
| **Activity History** | Tamper-evident log of every change: who, what, when, on which route |
| **Settings** | Signatory name, saving behavior, PIN, recovery questions, backups, updates, connections |

## Records and statuses

Every franchise slot is always in exactly one of these states, and the same computation is used by the dashboard, the records tables, and the exports:

| Status | Meaning | Color |
|--------|---------|-------|
| **Active** | Renewed for the current year; certificate valid until December 31 | Green |
| **1-Year Non-Renewal (Flagged)** | Did not renew since last year; keeps the slot but must renew this year | Amber |
| **Revoked (2+ Years)** | No renewal for two or more years; franchise revoked, slot reassignable | Red |
| **Vacant** | No operator assigned to the slot | Blue |

Hovering a status badge anywhere in the app shows the same description in plain words. Route badges and the dashboard KPI cards also carry hover explanations, so no number or color is ever unexplained.

SBN rules the app enforces automatically:

- New operators get an auto-generated SBN; editing an SBN counts as a renewal and updates the dates.
- Record history is kept per operator: every change shows who made it and when.
- Renaming a TODA line can unify every SBN prefix on that line.
- The Refresh DB action repairs wrong dates, misspelled routes, and duplicates; it never deletes.

## Records page guide

- **Toolbar**: sort, status filter, Refresh DB, Export Excel, Batch Print, Add Operator (each with a tooltip; export and batch print have shortcuts).
- **Spotlight**: the row you open, edit, or save keeps a blue ring, so it is easy to find again among thousands.
- **Row actions**: certificate preview (print or download Word), edit/renew, record history, delete (asks first, undo banner afterwards).
- **Batch Print**: choose the TODAs and the date window; documents merge into one print job with a live progress card and a Print Ready panel.
- **Duplicate guard**: downloading the same file twice in a session asks first.

## Dashboard guide

- KPI cards with plain-word hover explanations; the daily trend is the office's original weekday design (Mon through Sun, all-time).
- The prediction card estimates how full each route is; its "What Affects This" bars show the factor weights.
- The **Route Info** card shows the population and road length already saved in the database for the selected route. Values prefill from `GET /route_data/{route}`; blank means never set. Saving writes through `POST /route_data/{route}` and the inputs re-sync to what the database holds.
- Statistical checks (Silhouette, Davies-Bouldin, Calinski-Harabasz) appear under the card with plain-word interpretations.

## Import, search, and Activity History

- **Import** maps Excel columns to registry fields, reports per-row errors, and deduplicates. Imports propagate to every connected computer through sync.
- **Search** covers all routes at once; results carry the same row actions and spotlight ring as the records page.
- **Activity History** filters by route and action, supports search, and exports everything matching the filters to Excel.

## Settings guide

- **General**: MTOP signatory name (printed on certificates and summaries), save-preview behavior, auto-date on Change Motor (off by default — clerks opt in; renewals always set the date).
- **Backups**: explicit DB backup action; backups live outside the app folder.
- **Security**: Quick PIN (hash-only on device), three recovery questions with custom slots.
- **Connections**: this computer's IP, sync port 43888, connected peers with their names, sharing status, key-share status (fingerprint), Sync now, Test computers now, and the manual **Pair a computer / Join by PIN** panel for offices where the automatic handshake cannot run.
- **App Updates and Guide**: version, update check, install preference, check schedule, signature guarantee, tutorial replay.

## Connection status and computer names

The sidebar footer shows the sync state at a glance:

- **Online (green):** records sync normally between PASADA computers on the network.
- **Offline Mode (amber):** no network right now. Nothing is lost; records stay on this computer and sync when the network returns. All features keep working locally.

The Connections tab shows this computer's IP, the sync port, how many peers are connected, and who they are. The name other computers see is the signed-in account's name: PASADA announces it automatically after sign-in, so the tab shows real people instead of bare IP addresses. The name is editable in the same tab, and it is a label only: joining the cluster and pulling records still require the secret key, so a wrong or lying name cannot do anything. Before anyone signs in, the machine shows the neutral label "PASADA".

**Pair a computer by PIN (manual join).** When automatic pairing cannot run — a firewall swallows the broadcasts, the router blocks computer-to-computer traffic, or one machine's crypto library failed to load — an Admin can join the machines by hand: on the holder computer, press **Generate PIN** in the Connections card (Settings > Computer Settings); a six-digit PIN arms for 10 minutes. On the joining computer, type that PIN in **Join by PIN** and press Join. The cluster key crosses the LAN inside an AES-GCM envelope the joining machine itself rolled — the PIN never travels on the wire — and after the join both cards show the same short key fingerprint. Repeated wrong guesses are refused, logged, and lock the offender out until the PIN is re-armed; the automatic pairing stays on for normal days.

**Test computers now checks this computer first.** The diagnostics run on every machine: before probing any peer, the engine verifies it can actually bind and receive on its own ports. A bind failure or a peer that answers nothing returns the result with the exact remediation lines — on Linux `sudo ufw allow 43888/tcp` and `sudo ufw allow 54321/udp` (or the equivalent `netsh advfirewall` rule on Windows) — so "why is nothing syncing" names the firewall instead of just failing silently. The engine also re-reads its LAN address before every broadcast, so a machine whose DHCP lease changes after boot advertises its new IP within one 10-second cycle instead of disappearing from the cluster.

## Keyboard shortcuts and right-click

Shortcuts work on every page after signing in, and never fire while typing in a field or when a dialog is open:

| Keys | What it does |
|------|--------------|
| `/` | Jump to the search box (the records page focuses its own search; other pages focus the sidebar search) |
| Alt+N | New operator (records page) |
| Alt+P | Batch print (records page) |
| Alt+E | Export Excel (records page) |
| Alt+1 | Dashboard |
| Alt+2 | Activity History |
| Alt+3 | Import Records |
| Alt+4 | Inactive Operators |
| Alt+5 | Settings |

Right-clicking inside the app opens a menu with Back, Forward, a safe Reload, Copy, Paste, Select all, and Print page. The desktop app replaces the browser's own menu because its Reload re-requests the app through the asset protocol and could freeze a packaged window; the in-app Reload re-renders through the client router instead.

## Keeping PASADA up to date

Updates are deliberate. Checking for one and installing one are two different actions, and nothing happens on its own unless the office explicitly turned that on:

- **Check for Updates** only asks the official PASADA releases page whether a newer version exists. It compares version numbers and nothing more; it does not download an installer. The result is a badge: "Up to date" or "New version found".
- **Install** is the action that downloads the official installer, verifies its digital signature, and restarts PASADA into the new version.

**When an update is found, install?** (the install preference):

| Option | What PASADA does |
|--------|------------------|
| **Ask first** (default) | Shows the new version here and waits. Nothing downloads until someone presses Install. |
| **Install immediately** | Downloads and verifies in the background, then installs and restarts on its own once the download is safe on disk. |
| **Install when idle** | Downloads and verifies in the background, then waits for a few minutes with no mouse movement, key press, or click before it installs and restarts. Any activity resets the wait, so it never interrupts someone working. |

**Check for updates** (the schedule) controls only how often PASADA asks the releases page if a newer version exists: never unless the button is pressed (default), once a day, or once a week. The automatic schedule never downloads or installs anything on its own.

Every installer is verified against the PASADA developer's release signature before anything runs, and records live outside the app folder, so an update never touches them.

## The guided tutorial

The first time someone signs in on a computer, PASADA plays a step-by-step walkthrough: the sidebar pages, global search, the dashboard cards and charts, the records table and its statuses, row actions, connection status, and the theme control. Popovers sit beside the highlighted element when the window is wide enough and reposition when the window is resized. Steps whose target is not on screen are skipped automatically, so the tour never dead-ends. Replay it anytime from **Settings > General > Step by step guide**.

## Tooltips and accessibility

- Every meaningful control carries a tooltip (`data-tip`), shown on hover and keyboard focus, with row-action bubbles right-aligned so they never poke past the window edge.
- Icon-only buttons always have `aria-label`s; the current page and TODA line are marked with `aria-current="page"`.
- The sidebar clips horizontally, so a stray bubble can never reintroduce a sideways scrollbar on the TODA Lines list.
- Status color is never the only signal: every badge and pill pairs color with an icon and text.

## Security model

PASADA is a desktop app for a government office, so its security assumptions are explicit:

- **The API listens on the LAN so PASADA computers can sync with each other.** The app window itself talks to `127.0.0.1:43888`; the sync pull endpoint is the only way another machine can read records, and it requires a fresh HMAC-SHA256 signature made with the shared cluster secret (the secret never crosses the network; replayed, stale, or wrongly addressed signatures are refused). Set `PASADA_API_HOST=127.0.0.1` to turn sync off on a machine that must stay standalone.
- **CORS is an allowlist**, not `*`: only the app's own origins (`tauri://localhost`, localhost dev server) receive CORS headers, so a website open in a browser on the same computer cannot read LGU records from the API.
- **Login is rate-limited:** 5 failed attempts locks the account for 15 minutes, and lockouts are written to the audit log.
- **Registration is first-run only:** the open signup endpoint closes forever once the first account exists; administrators create later accounts.
- **Passwords** are bcrypt-hashed and never logged; **tokens** are JWT (HS256) with a 30-day expiry and a per-installation random secret.
- **LAN sync is authenticated:** discovery broadcasts and pull requests are HMAC-signed; security-answer hashes never leave the machine that set them. Password hashes DO travel inside the signed cluster, so an account created on one computer signs in on every computer.
- **Account management:** after first-run registration closes, an Admin creates accounts and resets forgotten passwords in Settings > Security > Manage Office Accounts. A reset also clears any login lockout on that account. Changes sync to the other computers.
- **Two-key rule for big actions:** deleting a whole TODA line, renaming a line, and batch-restoring deleted records are Admin-approved. A clerk's click files an approval ticket (nothing changes); the Admin approves or rejects it in Admin Console > Approvals. Filing, approval, and rejection all land in the audit log. An Admin's own click on the same buttons executes directly — their click is the approval.
- **PIN pairing is Admin-only on both sides.** Only an Admin can arm a PIN, join by PIN, or read the armed status; arming, joining, and clearing are audit-logged (action, actor, expiry — never the digits, which are never stored, echoed, or logged anywhere). The envelope is AES-GCM under SHA-256(PIN+salt) with a fresh salt per attempt; the hops that could reveal it are a 10-minute TTL, an attempt lockout per joining machine, and a 90-second reply-adoption window. Residual risk, stated plainly: anyone who records both datagrams on the wire can brute-force the 10⁶ PIN space offline, so PIN pairing is a manual rescue for trusted-office LANs — automatic pairing (challenge/signature) remains the stronger primary path.
- **Promotion keeps every clerk power:** when a Clerk becomes the Admin through the one-time bootstrap, the same account keeps creating, editing, renewing, printing, and exporting exactly as before; the admin doors simply open on top. Verified by `test_admin_console.py`.
- **Database import and Full Restore are Admin only:** both the merge import and the Full Restore of a `.db` backup file refuse non-Admin accounts. (The full-restore gate was added after a full endpoint audit; previously any signed-in account could replace the registry.)
- **Wrong-password lockout:** 5 failed attempts lock the account for 15 minutes, and the lock survives a restart. If the office "tried everything," the lockout is usually what they are hitting — wait it out or have the Admin reset the password.
- **The Quick PIN** is stored only as a SHA-256 hash on the device, and the audit log records who changed what, when.
- **Updates are signed:** the Tauri updater verifies the release signature before installing anything.

See `docs/THREAT_MODEL.md` for the full analysis, `docs/ISO25010_COMPLIANCE.md` for the quality-characteristic mapping, and `AUDIT.md` for the audit history.

## Getting started (development)

### Prerequisites

- Node.js 20+ (the build fails on Node 18)
- Python 3.12+ with a virtual environment
- Windows for packaged builds (Word/PDF conversion uses Microsoft Word); Linux works for development and testing

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npm test           # vitest unit tests
npm run build      # production static build
```

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --port 43888      # development server
pytest                             # test suite
```

The login screen polls the backend health check and tells you when it is not reachable.

> **Never point a dev frontend at port 43888 on an office machine.** The packaged app uses that port. A dev session against the live database can write to real records. Use a scratch data directory instead (see `XDG_DATA_HOME` below).

### Desktop app

```bash
cd frontend
npm run tauri dev    # full desktop app with backend sidecar
npm run tauri build  # signed installers (msi + nsis)
```

### Isolated development data

The backend resolves its data directory through the OS convention (e.g. `XDG_DATA_HOME` on Linux, `%APPDATA%` on Windows). Redirect it to keep development data away from the office database:

```bash
XDG_DATA_HOME=/tmp/pasada-dev uvicorn main:app --port 43889   # scratch instance
```

A scratch database auto-migrates on first boot; the first account created on it closes signup on that instance only.

## Packaging and deployment readiness

**Status: ready for office deployment on the Windows packaged build, with the conditions below.**

Verified working, with evidence in `AUDIT.md`:

- Records, renewals, Change Motor, deletes with undo, edits, certificates, summaries, batch printing, exports: covered by 49 backend tests and live click-through.
- LAN sync: signed discovery and pulls verified end to end, including replay, stale, wrong-secret, and wrong-address refusals.
- Updates: check, background prepare, three install preferences, signature verification; the Rust side is `cargo check`-clean.
- Both themes fully styled, tooltips and popovers verified against every window edge, no page overflow.

Before handing a build to the office:

1. **Windows-only packaging.** The document pipeline uses Microsoft Word; the Linux environment used for development cannot produce print-ready PDFs. Build installers on Windows (`npm run tauri build`).
2. **Version lockstep.** `tauri.conf.json`, `Cargo.toml`, and `APP_VERSION` must match (see `RELEASE.md`).
3. **Updater endpoint.** Releases must be published to the official GitHub releases page with valid minisign signatures, or update checks fail by design. The tag push does this; verify the release page shows `latest.json` before telling the office to check for updates.
4. **Office network.** UDP broadcast must be allowed on the office router for discovery; machines find each other only on the same subnet.
5. **First-run account.** Create the real office account on first launch of the packaged build; signup closes permanently after that.

## Releasing

Releases are automatic. Push to `main` and `release.yml` bumps the version in `.github/version.txt`, stamps it into the app, tags the commit, builds the signed installer, and publishes the GitHub Release with the `latest.json` the updater consumes. No version editing, no tag commands. MINOR/MAJOR jumps are a one-line edit to `.github/version.txt`. Full details, the artifact list, and the troubleshooting table live in [RELEASE.md](RELEASE.md).

## Troubleshooting

| Symptom | Meaning and fix |
|---------|-----------------|
| Login screen says backend not reachable | The sidecar did not start. Check `PASADA_CRASH_LOG.txt` beside the backend. Restart the app. |
| "Connected computers" stays at 0 | The machines are not on the same subnet, or the router blocks UDP broadcast. Check both computers' Connections tabs show the same network. |
| Two machines synced once, then stopped | Restart both PASADA apps. Discovery repeats every 10 seconds while running. |
| Nothing syncs and Test computers now names a bind/firewall problem | Allow the sync ports on BOTH machines: Linux `sudo ufw allow 43888/tcp && sudo ufw allow 54321/udp` (Windows: `netsh advfirewall firewall add rule name="PASADA sync" dir=in action=allow protocol=TCP localport=43888` and the same for UDP 54321), then run Test computers again. |
| The computers refuse to pair automatically, so PC 2 stays empty | Join them by PIN: Settings > Computer Settings, PC 1 presses **Generate PIN** under Pair a computer, PC 2 types the digits under **Join by PIN** and presses Join, then compare the fingerprints on both cards. Both paths install the same security. |
| A save fails with a network/CORS error in dev | The dev frontend must point at a scratch backend, not the office one. See the dev-data note above. A backend 500 also surfaces as a browser CORS error; check the backend log first. |
| Export or certificate does not open | On Windows builds, confirm Microsoft Word is installed; the PDF path depends on it. |
| Update check says it cannot reach the page | Updates need internet only for the check and the download. Press Check again when connected, or install from the official GitHub page. |

## Project layout and documentation index

```
pasada/
├── AUDIT.md            Audit history: findings, fixes, verification evidence
├── RELEASE.md          Version numbering, signing keys, release checklist
├── README.md           This guide
├── backend/            FastAPI sidecar (records, auth, exports, sync, ML)
│   ├── main.py         API endpoints and security middleware
│   ├── database.py     SQLite models and self-healing migrations
│   ├── doc_generator.py  MTOP certificates and summary documents
│   ├── sync_engine.py  Signed LAN discovery and peer sync
│   ├── ml_engine.py    Route fullness prediction and validation
│   └── tests/          pytest suite (logic, endpoints, performance, sync security)
├── frontend/           Next.js + Tauri desktop interface
│   ├── src/app/        Pages: login, dashboard, records, search, import, logs, settings
│   ├── src/lib/        API client, guided tutorial
│   └── src-tauri/      Desktop shell, updater, signing config
└── docs/
    ├── THREAT_MODEL.md             Threats, mitigations, accepted risks
    ├── ISO25010_COMPLIANCE.md      Quality-characteristic compliance mapping
    ├── ALGORITHM_EVALUATION.md     ML clustering evaluation
    └── TESTING_ON_LINUX.md         Linux development and test notes
```

## Support

Deployment walkthroughs and office-facing guides live in the PASADA documentation set (see `PASADA-Documentation.md` in the repository root's parent folder).
