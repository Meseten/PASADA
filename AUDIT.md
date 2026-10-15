# PASADA Audit, September 26, 2026

Full audit of backend, frontend, security, and data security, performed with the antislop UI rules (knowledge.md), the security-review checklist, and the web quality audit checklist. Every finding below was either fixed in this pass or is listed as a known limitation with its reason. The Delivery Gate report is at the end.

## 1. Fixed in this pass

### Release integrity (HIGH)

| Finding | Fix |
|---------|-----|
| `frontend/src-tauri/tauri.conf.json` version was corrupted: the `version` field contained `"0.82.0." followed by a vendor/author string instead of a clean semver. Semver comparison and the updater's version logic would fail against it. | Restored to a clean `0.82.0`, matching `Cargo.toml` and `APP_VERSION` in the Settings page. |

### Backend security (HIGH)

| Finding | Fix |
|---------|-----|
| `allow_origins=["*"]` in the CORS middleware, plus a custom middleware that mirrored **any** incoming `Origin` header into `Access-Control-Allow-Origin`. Any website open in a browser on an office computer could read LGU records from `http://127.0.0.1:43888` (a textbook DNS-rebinding / drive-by local-read vector). | Explicit allowlist (`tauri://localhost`, `http://localhost:3000`, `http://127.0.0.1:3000`). The mirroring middleware now reflects only those origins; all other origins get no ACAO header and browsers block the response. |
| LAN discovery sent the cluster secret in plaintext inside every UDP broadcast, so anyone on the network could read it with a packet sniffer and then pull every LGU record. | Discovery broadcasts and sync pulls are now HMAC-SHA256 signed (`build_discovery_payload` / `_verify_pull_signature` in `sync_engine.py` and `main.py`): the secret never crosses the wire, signatures carry a timestamp and a one-time nonce, stale signatures are refused (5-minute window), and a replay cache rejects reused nonces. Covered by `backend/tests/test_sync_security.py` (12 tests). |
| API bound to `0.0.0.0`, exposing unauthenticated-surface endpoints (health, docs, login brute-force target) to the whole LAN even though the UI only needs localhost. | Binds loopback by default (`PASADA_API_HOST` overrides). The sync pull endpoint is the only LAN-data surface and it requires an HMAC signature; see the hardening pass below. |

### Frontend correctness (MEDIUM)

| Finding | Fix |
|---------|-----|
| Guided-tutorial popover CSS wrapped oklch tokens in `hsl()`, producing invalid colors, so the popover silently rendered as unstyled driver.js defaults in both themes. | Rewrote the popover styles against the raw design tokens with explicit dark-mode variants, plus styled nav buttons and a close button. |
| The `montserrat` font was declared with `!important` but never loaded anywhere, and the Tauri CSP (`font-src 'self'`) would have blocked a webfont anyway. Every font render silently fell back to system fonts. | Replaced with an explicit system font stack and a comment explaining why (air-gapped app, self-hosted assets only). |
| Login page theme toggle used raw `theme` classes instead of the dark: variant pattern; sidebar footer status was a bare `Status: Online/Offline` text line. | Unified with the sidebar control (see statuses below). |
| `tauri.conf.json` reports the version the updater compares against; the corruption above also meant every check ran against a nonsense string. | Covered by the version fix. |

### Repository hygiene (LOW)

| Finding | Fix |
|---------|-----|
| `backend/exports/` (generated ZIPs contain full LGU records) and `frontend/playwright-report/`, `frontend/test-results/` were not ignored. | Added to `pasada/.gitignore`. Secrets (jwt/cluster keys, `.db` files) were already ignored; verified. |

## 2. Hardening pass, September 27, 2026

Second review of the sync/update surfaces, with live end-to-end tests:

| Finding | Fix |
|---------|-----|
| The pull signature was verified against the caller's IP, but callers sign the IP they ADDRESS (the peer's LAN address). Verified live: two machines on one office network would every time get 403 and sync would silently never run. | The server now verifies the signature against the hosts it answers for (its own LAN IP plus loopback names). A signature over any other address fails closed even with the correct secret (`test_pull_signature_rejects_unaddressed_host`). |
| The backend bound loopback only by default, which made LAN discovery and pull unreachable between real machines: the office would see "Connected computers: 1" forever. | The API now binds the LAN by default again. This is safe now: every pull requires a fresh HMAC signature over the addressed host, timestamp, and one-time nonce, and the pull response strips password and answer hashes. `PASADA_API_HOST` still pins a specific interface where wanted. |
| Discovery broadcasts could be replayed: a captured (valid) payload re-sent later would re-add a peer. | Broadcast nonces are now remembered for the freshness window; repeats are dropped (`test_broadcast_replay_rejected`). Pull requests already had their own replay cache. |
| "Prepare in background" was a stored preference with no behavior behind it. | New `prepare_app_update` Tauri command downloads and signature-verifies the update without installing; `install_app_update` reuses the prepared bytes so Install finishes without a second download. The card shows live states (preparing, ready, fallback note on failure). (The preference itself was relabeled "Install immediately" in the follow-up pass below, because the old name described the mechanism instead of the outcome.) |
| The daily KPI trend was changed during the first pass to a rolling 7-day window. | Reverted to the office's original design: all-time records bucketed by weekday (Mon through Sun), with a comment in the code so it is not "fixed" again by mistake. |

Live verification of the signed pull against a running server: valid signature 200 with records; replayed nonce, missing signature, wrong secret, and a stale timestamp all 403; the pull response carried no password or security-answer hashes.

## 3. Follow-up pass, September 27, 2026 (UI precision and honesty)

Third review, driven by office feedback on the previous build. Every fix was verified against a live scratch deployment (login through page interactions on a real browser session pointed at a scratch backend, never the packaged one).

| Finding | Fix |
|---------|-----|
| The "TODA Lines" route list could scroll sideways, and the pin/delete tooltip bubbles opened to the right of the buttons, past the window edge. Root cause: the nav is the sidebar's own scroll container (`overflow-y-auto` computes `overflow-x` as auto), so an off-window bubble reappeared as a scrollbar on the list. | Pin and delete buttons keep plain `aria-label` + native `title` (no bubble); the nav also clips horizontally (`overflow-x-hidden`) so nothing inside it can ever reintroduce the scrollbar. Verified live: `scrollWidth - clientWidth = 0` on both aside and nav, zero `[data-tip]` bubbles inside the nav. |
| The install options read "Ask first / Prepare in background / Install when idle": the middle option named the mechanism (background preparation), not what actually happens (an install with no question asked), and the office asked what "prepare" even meant. | Options are now **Ask first / Install immediately / Install when idle**. "Install immediately" now really is immediate: after the background download and signature check finish, it installs and restarts without waiting (previously it downloaded and still waited for a click). Preference persistence accepts the new value and old stored values still resolve correctly. |
| The Check for Updates button made no promise about what it does and does not do; the office reasonably assumed it downloads. | The button tooltip now states it only asks the releases page whether a newer version exists and downloads nothing; the schedule dropdown's description says the same ("Checking never downloads anything"); the found badge reads "New version found" instead of "ready". |
| The Connections tab showed a count of connected computers but not which ones. | `/system/network` (already authenticated) supplies the peer IP list; the tab lists each connected computer's IP under the count, with an explanation of why addresses and not names: PASADA never collects names or machine details over the network, a peer is trusted by its cluster secret alone. |
| The Operator List card on the records page had lost its tooltip entirely after the sidebar tooltip cleanup. | Restored as a short centered bubble on the card title, clear of every window edge (verified by geometry: bubble right edge 541px in a 1440px window). |
| Activity History toolbar controls did not match the Inactive page's (Export button width, search box width). | Export button is `px-6` (158px wide) on both pages, search box `md:w-72` (288px) on both, filters and search all 44px tall on both. Verified by measuring the live DOM on both pages at 1440px. |
| Route Info inputs (dashboard) showed empty boxes with "e.g. 5000" / "e.g. 5.5" placeholders even when the database already had values, inviting the office to re-enter or lose track of what was saved. | New authenticated `GET /route_data/{route_name}` returns the saved population and road length (or explicit `exists: false` when never set, so the ML engine's internal 5000 / 5.0 defaults are never dressed up as office-entered data). The inputs prefill from it on route change and re-sync after a save, and a roundtrip test covers save-then-read (test suite now 47). |
| README described the update flow only in the security bullet and the Connections tab in one sentence. | New "Keeping PASADA up to date" section (check vs install, all three install options, schedule, signature verification) and an expanded Connections section (what is shown, why addresses and not names). |

Live verification of this pass (scratch stack on port 43889, browser session at 1440px and 390px): sidebar and page overflow zero on every visited page; tooltip poke-scan clean with 13-16 bubbles per page; Route Info prefill showed the DB values, a save through the UI persisted 6000 / 6.5 and the inputs re-synced to exactly those values; Connections tab rendered the machine IP, port, count, and empty-peer state; records page carried the restored Operator List tooltip; logs and inactive toolbars measured pixel-identical (44px controls throughout). Full battery: pytest 47/47, vitest 8/8, `tsc --noEmit` clean, `next build` clean, `cargo check` clean (11m 39s).

## 4. Fourth pass, September 27, 2026 (visibility, orientation, and computer names)

Fourth review, again from office feedback, verified live on the scratch deployment (signed in, page interactions, and a simulated second computer on the network; the packaged office instance was never touched).

| Finding | Fix |
|---------|-----|
| The earlier tooltip cleanup had also stripped the bubbles from the row actions (view, edit, history, delete) and toolbar buttons, leaving icon-only buttons unexplained. | Tooltips restored where they help: every row action and every toolbar button on the records page (and the search page's row actions, the Inactive page's actions and Export, the logs Export). Row-action bubbles open right-aligned into the table so they never poke past the window edge; verified 208 bubbles on the records page with zero pokes. Filter and sort dropdowns stay bubble-free on purpose: their selected option already states what they do. Sidebar pin/delete keep native tooltips instead of bubbles because the sidebar is a scroll container (a bubble inside would reintroduce the sideways scrollbar the previous pass removed). |
| The office could not tell at a glance which page or which TODA line was open; on the dev server the exact-path comparison even left the sidebar with no highlight at all (paths arrive as `/dashboard/` with a trailing slash). | Current page and current route now get a stronger highlight (solid blue bar, tinted pill, `aria-current="page"`), and the path comparison is trailing-slash-proof, which fixes the dev-mode regression as a side effect. |
| Nothing marked which registry record the clerk had opened, edited, or just saved. | The opened/edited/most-recently-saved row keeps a blue ring in the records and search tables (and in the Inactive archive where applicable), so after closing a dialog it is obvious which record was touched. Verified end to end: edit dialog save persisted to the database, the list reloaded, the saved row carried the ring, and the certificate preview opened by itself. |
| The Install button said "Install version X now" even when nothing had been downloaded yet, and the office asked whether install means download. | The button is honest about both states: "Download and install version X" before anything is fetched, "Install version X now" once the background download finished. The preference label now asks the office's own question: "When an update is found, install?" |
| The context menu only offered Back, Forward, Reload, and Copy. | Added Paste (with correct React-controlled-input handling and caret placement), Select all, and Print page, each shown only when it can work; the menu repositions for its larger height. Still Tauri-only: browsers keep their native menu. |
| The office wanted keyboard shortcuts. The records page already had `/` (search), Alt+N (new), Alt+P (batch print); Alt+E (export) was undocumented in help text, and no shortcuts existed on other pages. | Added global shortcuts on every signed-in page: `/` focuses the sidebar search, Alt+1 through Alt+5 jump to Dashboard, Activity History, Import, Inactive, and Settings. Both are skipped while typing or when a dialog is open. The global search box now advertises `/` in its placeholder. Verified live: Alt+2 navigated to the logs, `/` focused the search box. |
| The Connections tab showed a count and IPs but the office wanted to know WHO is connected, by name. | Each machine can now be given a friendly name in Settings > Connections; the name is stored on the machine and travels INSIDE the HMAC-signed discovery broadcast (`build_discovery_payload` now signs ip, timestamp, nonce, and name). The tab shows each peer's name beside its IP. The name is display only: trust still comes exclusively from the cluster-secret signature, a tampered name breaks the signature like any other field, empty names are rejected, and first-seen wins per IP so a machine cannot flap its name into another's row. Covered by `test_discovery_carries_and_verifies_name` (suite now 48) and verified live: a simulated second computer broadcasting as "FRONT DESK" from 192.168.1.30 appeared on the Connections tab as `192.168.1.30 FRONT DESK`. |
| Download notifications and the duplicate-download guard: the user asked to confirm they all work. | Audited every download path: the guard covers the records export, the per-record Word download, the batch Word flow, the dashboard summary, the inactive export, and the inactive Word download; success and failure toasts fire on every path; the batch print shows a live progress card and a "Print Ready" panel; per-record Word downloads flash a green check on the button. One gap closed: the TODA summary Word download now also goes through the duplicate guard. |
| During live testing, an edit-save appeared to fail with a browser CORS error. | Root cause was environmental, not code: the scratch database had been copied mid-write from the office data and was malformed (`database disk image is malformed` on the audit-log INSERT); FastAPI's 500 carried no CORS headers, which the browser reports as a blocked request. Rebuilt the scratch DB with `VACUUM INTO` (integrity check ok) and the same save then succeeded and persisted. Documented here so the "CORS error on POST/PUT" signature is not mistaken for a security regression. |

Live verification of this pass (scratch stack on port 43889): sidebar highlight correct on Dashboard, Logs, Inactive, Settings, and `/toda/BATODA` with `aria-current` set; keyboard shortcuts Alt+2 and `/` verified; records page edit flow (open dialog, save, DB persisted, ring on saved row, auto-opened preview); Inactive view dialog opened for the archived record with a working Print path; Connections tab showed the saved computer name and the simulated peer with its name; zero tooltip pokes across pages; the `.env`-free frontend was temporarily pointed at the scratch backend and reverted afterwards. Full battery: pytest 48/48, vitest 8/8, `tsc --noEmit` clean, `next build` clean; `cargo check` unchanged by this pass (no Rust code touched).

## 5. Fifth pass, September 27, 2026 (dropdown readability, aligned toolbars, account-name broadcasting)

Fifth review from office feedback on the previous build, verified live on the scratch deployment in both themes.

| Finding | Fix |
|---------|-----|
| Dropdown text was unreadable: the closed select is styled with theme tokens, but the OPEN list is drawn by the browser with its own defaults, which came out white-on-white in dark mode (and washed out on some Windows builds in light mode). | Global fix in `globals.css`: option colors are pinned to the popover tokens (`background-color: var(--popover); color: var(--popover-foreground)`) so they flip with the theme, and `color-scheme: light` / `dark` is declared per theme so every native part (option list, scrollbar, date picker) follows. Verified live in dark mode: options render light text on a dark list, readable; light mode renders dark text on white. |
| The Activity History top controls were crooked and not the same size as the Inactive page's: the logs page staggered its controls across two rows with fixed-width (`w-48`) dropdowns while Inactive lays everything out in one natural row. | The logs toolbar was rebuilt as a single `flex-wrap` row copied from the Inactive page: route filter, action filter, Export Excel, and search box in one line, all `h-11`, same borders and shadows, wrapping naturally on narrow windows. Verified by DOM measurement: both pages have identical control heights (44px), identical one-row layout, and the search box at the same width class. |
| Some tooltips were still out of frame: the Inactive page's row action button sits at the table's right edge, so its centered bubble poked past the window (the records page's row actions had already been switched to right-aligned bubbles, the Inactive one was missed). | The Inactive view button's bubble is now right-aligned like the records page's. Live poke-scan after the fix: dashboard 13/0, logs 3/0, records 208/0, search 2/0, inactive 53/0 bad bubbles. |
| The network broadcast name was described as a computer name with a hostname fallback; the user wanted the signed-in USER's account name instead. | The frontend now announces the signed-in account's name automatically right after login (and on account switch, cleared on logout); the Settings field label now reads "Name other computers see (follows the signed-in account)"; the pre-login fallback is the neutral string "PASADA", never the PC hostname (new test `test_computer_name_never_defaults_to_hostname`; suite now 49). The set-name endpoint remains authenticated. |

Live verification of this pass: scratch stack on 43889 signed in as the test account, which immediately broadcast that account name (verified on disk and in `/system/network`); dropdown option colors measured in both themes; logs and inactive toolbars measured control-by-control; tooltip poke-scan clean on dashboard, logs, records, search, settings, and inactive at 1440px. Full battery: pytest 49/49, vitest 8/8, `tsc --noEmit` clean, `next build` clean.

## 6. Statuses, tooltips, and the tutorial (the requested UX pass)

- **Theme status:** the sidebar button now always shows which mode is ON (sun = Light Mode ON, moon = Dark Mode ON) with a tooltip and `aria-label` that say exactly that. The login page toggle keeps its circular design with the same semantics.
- **Connection status:** the sidebar footer shows a labeled `Online` / `Offline Mode` pill with icon, dot, and tooltip explaining what offline means (nothing is lost, syncs later). Settings > Connections states `Automatic: ON` for sharing, with a tooltip describing the 10-second discovery/pull cycle.
- **Record statuses:** all four badges (Active, 1-Year Non-Renewal, Revoked, Vacant) carry hover descriptions; the dashboard KPI cards explain their numbers on hover; chart tooltips were already theme-safe. The status definitions are documented in the README so UI text, colors, and docs agree.
- **Tooltips:** the `[data-tip]` system now follows the active theme (dark bubble in light mode, light bubble in dark mode), caps the delay at 350ms, hides while pressing, and remains keyboard-reachable via `:focus-visible`.
- **Tutorial:** rewritten to 14 steps covering every page plus the theme, connection, and Guide-card steps; side-by-side popover placement on wide windows with reposition on window resize; per-page variants (`tour-add` on the records page, `tour-guide-card` inside Settings) so steps never point at missing targets; the records table, statuses, and summary export are explained in plain words. Replay stays in Settings > General.

## 7. Verified-good (no change needed)

- Passwords: bcrypt via passlib; no plaintext or hash in logs or responses.
- Login: 5-attempt lockout for 15 minutes, in-memory, lockout events audited; failed responses stay generic.
- Signup: closes permanently after first account; role forced to Clerk.
- LAN sync: per-installation cluster secret required on both broadcast and pull; `password_hash` stripped from synced users.
- JWT: HS256 with a per-installation random secret file (gitignored); 30-day expiry; 401 handling clears session client-side.
- Tauri CSP is strict (self + loopback + GitHub updater endpoints); updater verifies minisign signatures.
- Data security: SQLite lives outside the install directory; exports/backups are explicit user actions; the mass-export and DB-backup endpoints require auth.
- UI states: dashboards and tables have loading skeletons, empty states, and error toasts; destructive actions confirm first; downloads have a duplicate-download guard.
- Accessibility: keyboard-reachable tooltips/focus rings, 44px tap targets on primary controls, status color never the only signal (icon + text on every badge and pill).

## 8. Known limitations (accepted, documented)

1. **Windows-only document rendering:** `doc_generator.py` uses `win32com`; on non-Windows dev machines the PDF path falls back to Word download. Documented in the README.
2. **Discovery signatures authenticate, but the broadcast stays readable:** an eavesdropper still sees *that* a PASADA cluster exists and which IP is talking (the IP is in the signed payload). Replayed broadcasts are refused (nonce cache), and they learn nothing they could use to join or pull: the HMAC key never leaves each machine. Encrypting discovery end-to-end would add a key-distribution step with no office benefit, so it is deliberately not done.
3. **JWT secret in a file beside the app:** appropriate for a per-machine desktop install; rotation happens by deleting the file (a new one is generated). Not a server secret store, by design.
4. **In-memory login lockout** resets on backend restart. Accepted for air-gapped simplicity; the audit trail still records attempts.
5. **`settings/page.tsx` and `tauri.conf.json` version must be bumped in lockstep** (see RELEASE.md). The Settings card is the runtime reminder. (Snapshot note: the shipped version is `0.82.0`, deliberately matching the released installer line.)
## 9. Delivery Gate (antislop) results

All hard-gate items pass:

- **R-02:** no em dashes in app or doc text added by this pass. **PASS**
- **R-03:** no horizontal overflow introduced; tour popovers cap width and reposition. **PASS**
- **R-17/R-18/R-36/R-38:** no statistics, testimonials, or claims added; all copy describes real behavior. **PASS**
- **R-23:** no fabricated assets; only text labels and existing icons. **PASS**
- **R-24/R-26:** every tour step's target was verified against the DOM (`tour-add`, `tour-row-actions`, `records-tour`, `tour-guide-card` anchors added where missing; no fake variants kept). **PASS**
- **R-25/R-34:** tooltips, status pills, and popover styles checked in both themes using the token palette (dark bubble/light text, inverted in dark mode, both well above 4.5:1). **PASS**
- **R-27:** loading/empty/error states already present on every data view; unchanged. **PASS**
- **R-32:** tooltips appear on `:focus-visible`; theme toggle has `aria-label`. **PASS**
- **R-33:** no patch scripts; all changes are in source. **PASS**
- **R-21/R-34:** both themes fully styled, including the previously broken popover. **PASS**

Liveliness: dials ENERGY 1 / RHYTHM 1 / MOTION 1 are deliberate for a government office tool; the identity motif is the quiet office-card system (muted cards, left-accent status colors, pill statuses) applied consistently. **PASS**

## 10. Verification evidence

- `npm run build` (frontend): clean, no type errors.
- `npm test` (vitest): all unit tests pass.
- `pytest` (backend): all endpoint/business-logic/performance tests pass.
- Click-through (live server, recorded via accessibility tree): theme toggle -> dark to light, aria-label and tooltip update; Connection pill -> Online state with tooltip; records page -> records/row-actions/tour-add anchors present, 55 tooltips live, status badge shows its plain-words description; Settings -> Guide card and Connections tooltips verified; tutorial -> auto-starts with 9 page-appropriate steps, sidebar popovers open to the right, full-width sections open below, closes cleanly and does not reappear; backend host/CORS changes verified by code inspection and the passing pytest suite (the packaged sidecar was not relaunched, since the office's live instance was running).
