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

## Versioning rule

Any change to the discovery body layout bumps `DISCOVERY_PROTOCOL_VERSION`.
Old machines simply never see new machines until both sides are updated —
no partial parses, no corrupted merges.
