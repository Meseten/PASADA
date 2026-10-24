# PASADA LAN Sync Protocol (v1)

Wire format for machine-to-machine discovery and record pulls on the office
LAN. Everything below is verified by `backend/tests/test_sync_security.py`.

## Constants

| Value | Meaning |
| :--- | :--- |
| `54321/udp` | discovery broadcast port |
| `43888/tcp` | HTTP API + sync pull port |
| `300` s | maximum age of any signature (freshness window) |
| `1` | `DISCOVERY_PROTOCOL_VERSION` (first body field) |

The cluster secret lives in `cluster_secret.key` next to the database
(permissions: readable by the logged-in user only) and **never crosses the
network** in readable form.

## Discovery broadcast (UDP, every 10 s)

```
PASADA_NODE:<ver>:<sender_ip>:<unix_ts>:<nonce>:<display_name>:<hmac_hex>
```

- `<ver>` — protocol version, currently `1`. A receiver drops payloads whose
  version differs from its own (a different dialect, not an error).
- `<display_name>` — the signed-in account name; travels **inside** the signed
  body, so tampering breaks the signature. Display-only; grants nothing.
- `<hmac_hex>` — HMAC-SHA256 over the body before the trailing `:`, keyed with
  the cluster secret, compared in constant time.

Receiver acceptance rules, in order: magic prefix matches, field count is 7,
version matches, HMAC valid, `|now − ts| ≤ 300 s`, nonce unseen in the window,
name non-empty, IP differs from own. Sender IP shown to the user is the body
IP; a mismatch with the UDP source address is accepted only because the HMAC
already proves cluster membership.

## Pull request (HTTP GET, every 10 s per peer)

```
GET http://<peer>:43888/api/sync/pull?since=<iso_utc_without_tz>
X-Cluster-Timestamp: <unix_ts>
X-Cluster-Nonce: <hex>
X-Cluster-Signature: <hmac_hex("PULL:<peer_ip>:<ts>:<nonce>")>
```

- Signature covers the IP the request is **addressed to** — replaying it at a
  different peer fails.
- Freshness window `PULL_MAX_AGE_SECONDS`, nonce cache on the receiving side.
- Response: JSON `{ records: [...], users: [...] }` (see §Users).

## Users

Password roaming (current behavior): the full user row travels **including
`password_hash`**, because the pull request itself is HMAC-signed inside the
trusted cluster and the hash is already a one-way bcrypt digest — sharing it
lets one office account sign in on every computer. Machines that receive an
account they lack insert it with its real hash; a machine holding the legacy
`SYNCED_NO_PASSWORD` stub, or an older hash, adopts the incoming one (the copy
on the machine where the password was last set is the master). The three
security-**answer** hashes (`security_a1_hash` … `a3_hash`) are still stripped:
account recovery stays answerable only on the machine that set the questions.
Verified by `tests/test_user_management.py::test_password_hash_survives_sync_roundtrip`.

Legacy behavior (kept here so old release notes make sense): synced accounts
arrived with a `SYNCED_NO_PASSWORD` placeholder and could not log in anywhere
but their home computer until an admin reset them.

## Merge semantics

- Tombstone-aware: `is_deleted` rows sync like any other, so one machine's
  delete propagates instead of resurrecting.
- Last-write-wins on `updated_at` (naive ISO strings, office machines share
  one timezone; clock-skew tolerance is the 300 s freshness window).
- Unknown fields in an incoming record dict are dropped against the live
  `FranchiseRecord` column set.

## Manual pair by PIN (UDP, Admin-initiated)

When the automatic handshake cannot run (crypto wheel failed to load,
AP-isolated Wi-Fi, a firewall eating broadcasts), an Admin can join a machine
by hand. Only an Admin may arm a PIN (on the holder) or join (on the
joiner); every arm/join/clear is audit-logged through `log_action`, and the
digits are never stored on disk, echoed by `/system/pairing-pin/status`, or
written to any log. An armed PIN lives in RAM only (10-minute TTL).

Join datagram (UDP 54321, three replies per salvo, 1.5 s apart):

```
PASADA_PINJOIN:<ver>:<claimer_ip>:<salt32hex>:<aesgcm_ct_hex>:<name_b64>
```

- The joiner encrypts `PASADA_PINASK` with AES-GCM (nonce = the salt bytes)
  under `SHA-256(pin + salt)` using its own random 16-byte salt — the PIN
  itself never crosses the wire.
- The holder arms the PIN via `/system/pairing-pin/arm`; a listener that
  sees a `PASADA_PINJOIN` while a PIN is armed answers with
  `PASADA_PINREPLY:<aesgcm_ct_hex>`, which re-encrypts the CLUSTER SECRET
  under `SHA-256(armed_pin + salt)` so only a machine holding the matching
  PIN can open it (`sync_engine.respond_to_pin_join`).
- Refusals — no PIN armed, expired pin, malformed salt/envelope, or the
  envelope failing to open (a wrong guess) — release nothing and are
  consumed silently apart from the audit line: a wrong envelope records an
  attempt against the joiner's IP; six failures inside a 60 s window lock
  that IP out until attempts age off (`_pin_attempt_dead_locked`). One
  successful join resets the ledger for that joiner.
- The joiner adopts the key inside a 90-second window from the FIRST
  reply (`_PENDING_PIN_WINDOW_SECONDS`) so captured replays from earlier
  sessions never land, wakes one sync cycle immediately, and re-audits the
  adoption with the holder's fingerprint.

Endpoint surface (all `require_admin`, same as rotate/import):
`GET /system/pairing-pin/status` (never echoes digits),
`POST /system/pairing-pin/arm` (returns the digits exactly once),
`POST /system/pairing-pin/clear`, `POST /system/pairing-pin/join`
(optional `host_ip`, validated as an IPv4 literal before any send).

Residual risk, stated: anyone who records the join and reply datagrams can
brute-force the 10⁶ PIN space offline. PIN pairing is a rescue path for
trusted office LANs; the challenge/signature handshake stays the primary
pairing mechanism.

## Engine resilience

- Every datagram loop (`broadcast`, `listen`, sync tick) is exception-guarded
  per iteration: an unexpected failure logs `[PASADA-SYNC]` and continues on
  the next tick instead of silently killing the thread forever.
- The broadcast loop re-reads the local LAN address every pass. A machine
  whose DHCP lease changes after boot advertises its new address in the next
  (≤10 s) broadcast instead of being stranded on a stale signed payload and
  eventually dropped by its peers.
- The UDP listener records whether its port is actually bound; when the bind
  fails (something else holds the port), it logs the failure with
  remediation hints, retries every 5 s, and exposes the state through the
  sync diagnostics — so a port conflict is a visible fault, not a mystery.
- Age/timestamp refusals reject with an explicit
  `[PASADA-SYNC] rejected: ...` reason (age beyond the tolerance window,
  clock skew, unknown origin) rather than a silent drop.

## Versioning rule

Any change to the discovery body layout bumps `DISCOVERY_PROTOCOL_VERSION`.
Old machines simply never see new machines until both sides are updated —
no partial parses, no corrupted merges.
