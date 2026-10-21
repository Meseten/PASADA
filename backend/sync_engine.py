import socket
import threading
import time
import hmac
import hashlib
import secrets
import base64
import requests
import os
import uuid
import ipaddress
from database import SessionLocal, FranchiseRecord, get_pht_now, BASE_DIR
from datetime import datetime, timedelta

def force_log(msg):
    """Append to the same crash log main.py uses, without importing main
    (a circular import). Best-effort: sync never dies over logging."""
    try:
        with open(os.path.join(BASE_DIR, "PASADA_CRASH_LOG.txt"), "a", encoding="utf-8") as f:
            f.write(f"{msg}\n")
    except OSError:
        pass

# STALE-PACKET VISIBILITY: every signed datagram carries a timestamp and one
# older than BROADCAST_MAX_AGE_SECONDS is refused. A computer whose clock is
# MORE THAN FIVE MINUTES off from the rest of the office used to fail this
# check on every packet — indistinguishable on the log from total silence.
# One crash-log line per packet KIND per 60 seconds says so, with the age.
_stale_drop_throttle = {}


def _log_stale_packet(kind: str, peer_ip: str, age: float):
    """Throttled: once per minute per kind, never a flood."""
    now = time.time()
    last = _stale_drop_throttle.get(kind, 0)
    if now - last < 60 and last:
        return
    _stale_drop_throttle[kind] = now
    force_log(f"[SYNC-LISTEN] {kind} datagram from {peer_ip} refused as old: "
              f"timestamp is {int(age)}s off (limit {BROADCAST_MAX_AGE_SECONDS}s). "
              "A computer clock off by more than 5 minutes drops every packet — "
              "check this computer's date/time settings.")

BROADCAST_PORT = 54321
API_PORT = int(os.environ.get("PASADA_API_PORT", "43888"))

# TEST/LAB OVERRIDES: two PASADA instances can run side by side on ONE PC
# (Linux loopback aliases like 127.0.0.2/127.0.0.3 are separate NICs). The
# engine still has its production defaults unless these env vars are set:
#   PASADA_SYNC_PORT     override the discovery/offer UDP port
#   PASADA_SYNC_BIND     bind the listener to this "ip[:port]" instead of the
#                        wildcard, so two instances on one PC each own an NIC
#   PASADA_SYNC_TARGETS  comma-separated "ip[:port]" list; broadcasts
#                        (discovery, offer, nudge) are unicast to these
#                        instead of LAN <broadcast>
#   PASADA_SYNC_LOCAL_IP override get_local_ip(): the worked-out LAN address
#                        for this machine, since loopback aliases break the
#                        routing-table guesswork it does by default
SYNC_PORT = int(os.environ.get("PASADA_SYNC_PORT", str(BROADCAST_PORT)))
_SYNC_LOCAL_IP_ENV = os.environ.get("PASADA_SYNC_LOCAL_IP", "")


def _local_ipv4_addresses():
    """Every IPv4 address this machine holds, loopback excluded. A PC can sit
    on the office LAN on MORE THAN ONE interface (Ethernet + Wi-Fi on the
    same network is common in small offices); announcements used to go out
    the one default route only, so peers reached via the other NIC missed
    every announcement and never learned this machine existed."""
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
    except OSError:
        return []
    found, seen = [], set()
    for info in infos:
        ip = info[4][0]
        if ip.startswith("127.") or ip in seen:
            continue
        seen.add(ip)
        found.append(ip)
    return found


def _sync_destinations():
    """WHERE broadcasts go. With the lab override, unicast to every pinned
    PASADA_SYNC_TARGETS address. In production: the LAN <broadcast> address
    PLUS each NIC's own subnet broadcast — the OS routes <broadcast> through
    one default interface only, so the per-NIC copies are what make the
    announcement reach machines wired to the other NIC. Duplicate copies of
    the same signed datagram are harmless; peers dedupe via the nonce cache."""
    targets = []
    for item in os.environ.get("PASADA_SYNC_TARGETS", "").split(","):
        item = item.strip()
        if not item:
            continue
        ip, _, port = item.partition(":")
        targets.append((ip, int(port) if port else SYNC_PORT))
    if targets:
        return targets
    targets = [("<broadcast>", SYNC_PORT)]
    seen = set()
    for ip in _local_ipv4_addresses():
        try:
            broadcast = str(ipaddress.ip_network(f"{ip}/24", strict=False).broadcast_address)
        except ValueError:
            continue
        if broadcast not in seen:
            seen.add(broadcast)
            targets.append((broadcast, SYNC_PORT))
    return targets


def _send_announcement(payload: bytes, udp_socket=None):
    """One helper for every periodic announcement (discovery / offer / nudge):
    LAN broadcast normally, unicast to pinned targets under the lab override.
    Best effort: a failed send only costs seconds of latency, never data —
    the 10-second cycle re-reaches every peer by itself."""
    for dest in _sync_destinations():
        try:
            if udp_socket is not None:
                udp_socket.sendto(payload, dest)
            else:
                # Fallback one-off socket: a broadcast destination raises
                # EACCES to a socket created without SO_BROADCAST (on Linux
                # every subnet-broadcast destination does), and a swallowed
                # EACCES here used to make this whole path a silent no-op.
                sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
                try:
                    sock.sendto(payload, dest)
                finally:
                    sock.close()
        except OSError:
            pass

PEERS = set()

# FRIENDLY COMPUTER NAMES: each machine broadcasts the name of the ACCOUNT
# signed in on it (set automatically by the frontend after login, editable
# in Settings) so the Connections tab shows who is who. The name is DISPLAY
# ONLY: trust still comes exclusively from the HMAC signature, so a lying
# or duplicate name joins nothing and reads nothing. Before anyone signs
# in, the neutral placeholder "PASADA" is broadcast instead of a hostname.
COMPUTER_NAME_PATH = os.path.join(BASE_DIR, "computer_name.key")
if os.path.exists(COMPUTER_NAME_PATH):
    with open(COMPUTER_NAME_PATH, "r") as f:
        COMPUTER_NAME = f.read().strip()[:40]
else:
    # Neutral placeholder until someone signs in: the frontend then announces
    # the signed-in ACCOUNT's name automatically. Never the PC/hostname.
    COMPUTER_NAME = "PASADA"
PEER_NAMES = {}

def set_computer_name(name: str):
    """Store the office-given name for this computer and broadcast it from now on."""
    global COMPUTER_NAME
    COMPUTER_NAME = name.strip()[:40]
    with open(COMPUTER_NAME_PATH, "w") as f:
        f.write(COMPUTER_NAME)

# CLUSTER SECRET: shared by the office computers that sync records. It never
# crosses the network in readable form: discovery broadcasts carry an HMAC
# signature and the pull request carries an HMAC over the request itself.
CLUSTER_SECRET_PATH = os.path.join(BASE_DIR, "cluster_secret.key")
if os.path.exists(CLUSTER_SECRET_PATH):
    with open(CLUSTER_SECRET_PATH, "r") as f:
        CLUSTER_SECRET = f.read().strip()
else:
    CLUSTER_SECRET = str(uuid.uuid4())
    with open(CLUSTER_SECRET_PATH, "w") as f:
        f.write(CLUSTER_SECRET)

# =============================================================================
# AUTO-PAIRING: a fresh install joins the office cluster BY ITSELF.
# =============================================================================
# The office should not have to know a "shared key" exists. Every machine
# generates a long-term PAIRING KEY PAIR on first run (pasada_pairing.pem).
# Discovery now twinned with a signed OFFER datagram (PASADA_OFFER) that
# carries the machine's PUBLIC half. A machine that has never been paired
# answers with a CHALLENGE encrypted to that public key; the offerer
# decrypts with its private half and replies with the CLUSTER SECRET
# encrypted the same way. The secret itself therefore only ever travels
# encrypted to the one joining machine, never on the wire in readable form
# and never broadcast.
#
# Safety rails, deliberate:
#   - A machine that already HAS a key and peers ignores offers. Pairing is
#     only for machines that would otherwise never sync.
#   - The OFFERER answers a challenge from a machine it has not yet
#     registered as a peer (throttled once per minute per machine). Not
#     restricted to fresh clusters: the third, fourth, fifth computer must
#     join too, whenever it appears. Stricter sites turn pairing off with
#     the Admin opt-out flag (auto_pairing_off.flag); recovery for a
#     deliberately rotated machine then goes through the manual tools.
#   - Offers are signed by the OFFERER's pairing key (self-evident identity:
#     the challenge can only be answered by the holder of the private half),
#     and challenges/replies are single-use, time-boxed datagrams like the
#     discovery/nudge family. No replay of a captured reply can be used
#     twice, and a reply is useless to anyone except its named recipient
#     because its recipient must hold the private half of the challenge.
#
# The manual rotate/import tools remain for the recovery case (an Admin
# resetting a compromised machine), but no normal user action needs them.
PAIRING_KEY_PATH = os.path.join(BASE_DIR, "pasada_pairing.pem")

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa, padding as asym_padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    _CRYPTO_OK = True
except Exception:  # pragma: no cover - the wheel ships with the app
    _CRYPTO_OK = False

def _load_or_create_pairing_keys():
    """(private_pem, public_der) for this machine. Generated once, reused
    forever so a machine keeps its identity across restarts."""
    if not _CRYPTO_OK:
        return None, None
    if os.path.exists(PAIRING_KEY_PATH):
        try:
            with open(PAIRING_KEY_PATH, "rb") as f:
                priv = serialization.load_pem_private_key(f.read(), password=None)
            return priv, priv.public_key().public_bytes(
                serialization.Encoding.DER,
                serialization.PublicFormat.SubjectPublicKeyInfo)
        except Exception:
            pass  # corrupted file: fall through and regenerate
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = priv.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption())
    with open(PAIRING_KEY_PATH, "wb") as f:
        f.write(pem)
    return priv, priv.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo)

_PAIRING_PRIV, _PAIRING_PUB = _load_or_create_pairing_keys()

def _has_working_pairing() -> bool:
    return _CRYPTO_OK and _PAIRING_PRIV is not None

# These mirror the discovery/nudge freshness model. Offers repeat every
# broadcast tick; the nonce cache makes a captured one single-use.
def build_offer_payload(local_ip: str, now: float = None) -> bytes:
    """PASADA_OFFER:<ver>:<ip>:<timestamp>:<nonce>:<b64 pubkey>:<name>:<hmac(pvk)>.

    Signed BY the pairing private key. Anyone hearing it can verify identity
    with the enclosed public half — that is the point: the offer's receiver
    must know WHOSE key to encrypt its challenge to."""
    if not _has_working_pairing():
        return None
    if now is None:
        now = time.time()
    timestamp = str(int(now))
    nonce = secrets.token_hex(8)
    pub_b64 = base64.b64encode(_PAIRING_PUB).decode('ascii')
    body = f"PASADA_OFFER:{DISCOVERY_PROTOCOL_VERSION}:{local_ip}:{timestamp}:{nonce}:{pub_b64}:{COMPUTER_NAME}".encode('utf-8')
    sig = _PAIRING_PRIV.sign(body, asym_padding.PKCS1v15(), hashes.SHA256())
    return body + b":" + base64.b64encode(sig)


def parse_offer_payload(data: bytes, local_ip: str, now: float = None):
    """Return (sender_ip, sender_pub_der, sender_name) for a fresh valid offer,
    else None."""
    if not _has_working_pairing():
        return None
    if now is None:
        now = time.time()
    try:
        text = data.decode('utf-8')
        head, sig_b64 = text.rsplit(":", 1)
        parts = head.split(":")
        if len(parts) != 7 or parts[0] != "PASADA_OFFER":
            return None
        if parts[1] != str(DISCOVERY_PROTOCOL_VERSION):
            return None
        _, _, peer_ip, timestamp, nonce, pub_b64, name = parts
        pub = serialization.load_der_public_key(base64.b64decode(pub_b64))
        pub.verify(base64.b64decode(sig_b64), head.encode('utf-8'),
                   asym_padding.PKCS1v15(), hashes.SHA256())
        age = abs(now - float(timestamp))
        if age > BROADCAST_MAX_AGE_SECONDS:
            _log_stale_packet("pairing offer", peer_ip, age)
            return None
        if not _broadcast_nonce_seen(nonce, now):
            return None
        if peer_ip == local_ip or not name.strip():
            return None
        return peer_ip, pub.public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo), name
    except Exception:
        return None


def build_join_challenge(recipient_pub_der: bytes, local_ip: str, now: float = None):
    """(payload, nonce) — a challenge addressed to ONE offerer.

    Hybrid envelope: a fresh AES-256-GCM key encrypts the request body
    (which carries the JOINER'S OWN PUBLIC KEY, so the offerer's reply can
    be encrypted back to us alone), and RSA-OAEP wraps only the AES key.
    Nothing readable crosses the wire except to the holder of the private
    half of the offered key."""
    if not _has_working_pairing():
        return None, None
    if now is None:
        now = time.time()
    timestamp = str(int(now))
    nonce = secrets.token_hex(8)
    body = (f"PASADA_JOIN:{DISCOVERY_PROTOCOL_VERSION}:{local_ip}:{timestamp}:{nonce}:"
            f"SECRET-REQUEST:"
            f"{base64.b64encode(_PAIRING_PUB).decode('ascii')}").encode('utf-8')
    aes_key = AESGCM.generate_key(bit_length=256)
    aes_nonce = secrets.token_bytes(12)
    ct = AESGCM(aes_key).encrypt(aes_nonce, body, None)
    recipient = serialization.load_der_public_key(recipient_pub_der)
    wrapped = recipient.encrypt(
        aes_key, asym_padding.OAEP(
            mgf=asym_padding.MGF1(hashes.SHA256()),
            algorithm=hashes.SHA256(), label=None))
    envelope = f"{base64.b64encode(wrapped).decode('ascii')}." \
               f"{base64.b64encode(aes_nonce).decode('ascii')}." \
               f"{base64.b64encode(ct).decode('ascii')}"
    return f"PASADA_JOINBLOB:{timestamp}:{nonce}:{envelope}".encode('utf-8'), nonce


def parse_join_challenge(data: bytes, local_ip: str, now: float = None):
    """Offerer side. Opens the hybrid envelope with our private half; returns
    (joiner_ip, joiner_pub_der, plain_body) when addressed to us and fresh,
    else None."""
    if not _has_working_pairing():
        return None
    if now is None:
        now = time.time()
    try:
        text = data.decode('utf-8')
        parts = text.split(":", 3)
        if len(parts) != 4 or parts[0] != "PASADA_JOINBLOB":
            return None
        _, timestamp, nonce, envelope = parts
        outer_age = abs(now - float(timestamp))
        if outer_age > BROADCAST_MAX_AGE_SECONDS:
            _log_stale_packet("pairing challenge", "?", outer_age)
            return None
        wrapped_b64, aes_nonce_b64, ct_b64 = envelope.split(".")
        aes_key = _PAIRING_PRIV.decrypt(
            base64.b64decode(wrapped_b64), asym_padding.OAEP(
                mgf=asym_padding.MGF1(hashes.SHA256()),
                algorithm=hashes.SHA256(), label=None))
        body = AESGCM(aes_key).decrypt(
            base64.b64decode(aes_nonce_b64), base64.b64decode(ct_b64), None).decode('utf-8')
        jparts = body.split(":")
        if len(jparts) != 7 or jparts[0] != "PASADA_JOIN":
            return None
        if jparts[1] != str(DISCOVERY_PROTOCOL_VERSION):
            return None
        _, _, joiner_ip, jts, jnonce, marker, joiner_pub_b64 = jparts
        if marker != "SECRET-REQUEST":
            return None
        inner_age = abs(now - float(jts))
        if inner_age > BROADCAST_MAX_AGE_SECONDS:
            _log_stale_packet("pairing challenge", joiner_ip, inner_age)
            return None
        if joiner_ip == local_ip:
            return None
        joiner_pub = serialization.load_der_public_key(base64.b64decode(joiner_pub_b64))
        return joiner_ip, joiner_pub.public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo), body
    except Exception:
        return None


def build_join_reply(plaintext: bytes, recipient_pub_der: bytes):
    """Hybrid-encrypt the secret-bearing reply to the JOINER's public key.
    Same envelope shape as the challenge: RSA wraps the AES key, AES-GCM
    carries the secret."""
    if not _has_working_pairing():
        return None
    aes_key = AESGCM.generate_key(bit_length=256)
    aes_nonce = secrets.token_bytes(12)
    ct = AESGCM(aes_key).encrypt(aes_nonce, plaintext, None)
    recipient = serialization.load_der_public_key(recipient_pub_der)
    wrapped = recipient.encrypt(
        aes_key, asym_padding.OAEP(
            mgf=asym_padding.MGF1(hashes.SHA256()),
            algorithm=hashes.SHA256(), label=None))
    envelope = f"{base64.b64encode(wrapped).decode('ascii')}." \
               f"{base64.b64encode(aes_nonce).decode('ascii')}." \
               f"{base64.b64encode(ct).decode('ascii')}"
    return f"PASADA_REPLYBLOB:{envelope}".encode('utf-8')


def parse_join_reply(data: bytes):
    """Joiner side: open with OUR private half; return the plaintext secret
    bytes, else None."""
    if not _has_working_pairing():
        return None
    try:
        text = data.decode('utf-8')
        if not text.startswith("PASADA_REPLYBLOB:"):
            return None
        wrapped_b64, aes_nonce_b64, ct_b64 = text.split(":", 1)[1].split(".")
        aes_key = _PAIRING_PRIV.decrypt(
            base64.b64decode(wrapped_b64), asym_padding.OAEP(
                mgf=asym_padding.MGF1(hashes.SHA256()),
                algorithm=hashes.SHA256(), label=None))
        return AESGCM(aes_key).decrypt(
            base64.b64decode(aes_nonce_b64), base64.b64decode(ct_b64), None)
    except Exception:
        return None


# AUTO-PAIR SWITCH: ON by default (the office asked for computers that join
# by themselves). An Admin can turn it off from the Admin Console; while off
# this machine neither offers nor requests, and recovery goes back to the
# manual rotate/import tools.
PAIRING_OPTOUT_PATH = os.path.join(BASE_DIR, "auto_pairing_off.flag")

def auto_pairing_enabled() -> bool:
    return not os.path.exists(PAIRING_OPTOUT_PATH)


def _peers_all_failing() -> bool:
    """True when the peer registry is de facto DEAD: empty (nothing paired
    yet) or every registered peer at/over the consecutive-failure drop
    threshold (no pull has succeeded in a long while).

    The pairing gates use this instead of a bare `not PEERS`: a machine
    holding one stale/ghost peer entry used to refuse challenges and replies
    indefinitely, even though every pull to that peer was failing — the
    registry only really emptied PEER_MAX_CONSECUTIVE_FAILURES cycles (~200s)
    later. A formed cluster with at least one WORKING peer still stays
    protected from re-keying exactly as before."""
    if not PEERS:
        return True
    with _peer_failures_lock:
        return all(
            _peer_failures.get(ip, 0) >= PEER_MAX_CONSECUTIVE_FAILURES
            for ip in PEERS
        )

# Rate limit: at most one SECRET released to a given joiner per minute, and
# adopt at most one reply attempt per offerer per minute, so a hostile LAN
# cannot flush either side with datagrams.
_reply_throttle = {}
_challenge_throttle = {}
_throttle_lock = threading.Lock()

# Friendly record of machines that joined by themselves, shown in the
# Connections UI so the office can SEE pairing worked (newest first, max 5).
_auto_pair_events = []

def record_auto_pair_event(msg: str):
    stamp = get_pht_now().strftime('%Y-%m-%d %H:%M:%S')
    _auto_pair_events.insert(0, f"{stamp}  {msg}")
    del _auto_pair_events[5:]
    force_log(f"AUTO-PAIR: {msg}")

def get_auto_pair_events():
    return list(_auto_pair_events)

# Signatures older than this are refused, so a captured broadcast cannot be
# replayed to sneak a fake peer onto the list. Broadcasts repeat every 10s,
# and clocks across one office stay well within a few seconds, so 5 minutes
# leaves a wide margin for a machine whose clock drifted.
BROADCAST_MAX_AGE_SECONDS = 300

# PROTOCOL VERSION (ISO 25010 Compatibility): first field of the discovery
# body after the magic prefix. A future schema change bumps this number and
# the receiving side silently drops payloads from a version it does not
# understand, instead of failing mysteriously on a half-parsed format.
DISCOVERY_PROTOCOL_VERSION = 1

# REPLAY PROTECTION: a valid broadcast captured on the wire must not be
# reusable. Each received payload's nonce is remembered for the freshness
# window; a repeat is dropped as a replay. (The pull endpoint keeps its own
# nonce cache for the same reason.)
_seen_broadcast_nonces = {}
_seen_broadcast_lock = threading.Lock()

def _broadcast_nonce_seen(nonce: str, now: float) -> bool:
    """True when this nonce was never used before (and records it)."""
    with _seen_broadcast_lock:
        current = now
        for k in [k for k, exp in _seen_broadcast_nonces.items() if exp <= current]:
            del _seen_broadcast_nonces[k]
        if nonce in _seen_broadcast_nonces:
            return False
        _seen_broadcast_nonces[nonce] = current + BROADCAST_MAX_AGE_SECONDS
        return True

def _hmac_hex(message: bytes) -> str:
    return hmac.new(CLUSTER_SECRET.encode('utf-8'), message, hashlib.sha256).hexdigest()

def build_discovery_payload(local_ip: str, now: float = None) -> bytes:
    """PASADA_NODE:<ver>:<ip>:<timestamp>:<nonce>:<name>:<hmac>, secret never on the wire.

    The friendly computer name travels INSIDE the signed body, so a tampered
    name breaks the signature like any other change."""
    if now is None:
        now = time.time()
    timestamp = str(int(now))
    nonce = secrets.token_hex(8)
    body = f"PASADA_NODE:{DISCOVERY_PROTOCOL_VERSION}:{local_ip}:{timestamp}:{nonce}:{COMPUTER_NAME}".encode('utf-8')
    return body + b":" + _hmac_hex(body).encode('ascii')

def parse_discovery_payload(data: bytes, local_ip: str, now: float = None):
    """Return (sender's IP, friendly name) when the signature is fresh and valid, else None.

    Verification compares HMACs in constant time, so an eavesdropper who
    records broadcasts cannot forge one without the secret. An empty name is
    rejected outright: a peer without a name is malformed, not trusted."""
    if now is None:
        now = time.time()
    try:
        parts = data.decode('utf-8').split(":")
        if len(parts) != 7 or parts[0] != "PASADA_NODE":
            return None
        # Protocol-version gate: an older/newer broadcaster is not an error,
        # it is a different dialect — drop quietly so mixed offices fail loud
        # nowhere and the Logs stay clean.
        if parts[1] != str(DISCOVERY_PROTOCOL_VERSION):
            return None
        peer_ip, timestamp, nonce, name, signature = parts[2], parts[3], parts[4], parts[5], parts[6]
        body = f"PASADA_NODE:{DISCOVERY_PROTOCOL_VERSION}:{peer_ip}:{timestamp}:{nonce}:{name}".encode('utf-8')
        if not hmac.compare_digest(_hmac_hex(body), signature):
            return None
        age = abs(now - float(timestamp))
        if age > BROADCAST_MAX_AGE_SECONDS:
            _log_stale_packet("discovery", peer_ip, age)
            return None
        if not _broadcast_nonce_seen(nonce, now):
            return None
        if not name.strip():
            return None
        if peer_ip != local_ip:
            return (peer_ip, name)
        return None
    except Exception:
        return None

# INSTANT SYNC HEARTBEAT: the pull loop alone would leave other office
# computers waiting up to one whole cycle before they see a deactivation or
# a password reset. Whenever a user-mutating action commits, the machine that
# made the change fires ONE signed datagram (PASADA_NUDGE) on the same
# discovery channel. Every listening computer verifies the HMAC, then wakes
# its pull loop for an immediate cycle. The 10-second tick stays as the
# safety net for anything the nudge misses (a packet dropped while a machine
# was busy, a peer discovered late). Like the discovery broadcast, the nudge
# carries no secret, is time-boxed, and never repeats a nonce.
_wake_pull_loop = threading.Event()

def request_sync_cycle():
    """Wake the pull loop NOW instead of at its next periodic tick."""
    _wake_pull_loop.set()

# FAILURE PATHS FOR A REAL OFFICE:
#  - CLOCK SKEW: the pull asks for "everything after my newest record". If a
#    peer's Windows clock runs even minutes behind ours, its fresh edits are
#    stamped in our past and a strict filter would drop them forever (the
#    watermark only ever moves forward). The pull therefore looks back one
#    extra margin: re-sent rows are idempotent under last-write-wins, so the
#    only cost is a few repeated rows per cycle on the LAN.
#  - STALE PEER: a machine powered off (or one whose DHCP address went to a
#    printer) used to stay in the peer registry forever, costing a failed
#    5-second pull every cycle and a crash-log line every cycle. Now a peer
#    is dropped after a bounded misses streak; its discovery broadcast
#    re-adds it the moment it comes back or moves address.
PULL_SKEW_GUARD_SECONDS = 5 * 60
PEER_MAX_CONSECUTIVE_FAILURES = 20
_peer_failures = {}
_peer_failures_lock = threading.Lock()

# PEER VISIBILITY: when each peer was last actually HEARD (discovery, nudge,
# or a successful pull). The office uses this to tell "the laptop is off or
# unplugged" from "the laptop answers but a pull keeps failing" — and to see
# a machine TS dropped (missed pulls) that later came back. Wall-clock ISO.
_peer_seen = {}
_peer_seen_lock = threading.Lock()

def _mark_peer_seen(peer_ip: str):
    with _peer_seen_lock:
        _peer_seen[peer_ip] = get_pht_now().replace(tzinfo=None).isoformat()

def get_peer_status():
    """One row per peer the sync engine knows about for the Connections UI:
    friendly name, when it was last HEARD, current pull-miss streak (0 after
    any success), and whether the registry currently lists it."""
    with _peer_seen_lock:
        seen = dict(_peer_seen)
    with _peer_failures_lock:
        misses = dict(_peer_failures)
    rows = {}
    ips = set(PEERS) | set(seen)
    for ip in ips:
        rows[ip] = {
            "name": PEER_NAMES.get(ip),
            "last_seen": seen.get(ip),
            "misses": int(misses.get(ip, 0)),
            "registered": ip in PEERS,
        }
    return rows


# CLUSTER KEY LIFECYCLE. Sync never puts the secret on the wire, but the
# office OWNS the key. When the live check reports "wrong cluster secret"
# (two computers holding two different keys), the Admin can:
#   ROTATE - mint a fresh key on this computer (written to cluster_secret.key,
#            fingerprint shown, the secret itself shown ONCE for hand-over), and
#   IMPORT - paste the exact key text into every other computer
#            (hand-delivered: printed, flash drive, or private message).
# The fingerprint is an HMAC keyed by the secret itself, so it cannot be
# reversed to the key — its only job is letting two computers confirm they
# hold the SAME key without ever displaying it. Any rotate/import clears the
# peer registry so the next broadcast is signed by the NEW key and no stale
# expectation from the old one lingers.
def cluster_secret_fingerprint() -> str:
    """Non-reversible fingerprint of the current key. Same key = same
    fingerprint; one differing character = a different fingerprint."""
    return hmac.new(
        CLUSTER_SECRET.encode('utf-8'), b"PASADA-FINGERPRINT", hashlib.sha256
    ).hexdigest()[:16].upper()


def _adopt_cluster_secret(key: str):
    """Make the new key live: persist to disk, sign with it immediately, and
    forget every peer learned under the old key (their next broadcast,
    signed with the matching copy, re-registers them)."""
    global CLUSTER_SECRET
    CLUSTER_SECRET = key
    with open(CLUSTER_SECRET_PATH, "w") as f:
        f.write(key)
    PEERS.clear()
    PEER_NAMES.clear()
    with _peer_failures_lock:
        _peer_failures.clear()
    with _peer_seen_lock:
        _peer_seen.clear()


def rotate_cluster_secret() -> str:
    """Mint and adopt a fresh cluster key, returning it ONCE so the Admin
    can hand-deliver it to the office's other computers."""
    _adopt_cluster_secret(str(uuid.uuid4()))
    return CLUSTER_SECRET


def import_cluster_secret(raw: str):
    """Adopt hand-delivered key text as the cluster key. Returns the adopted
    key, or None when the text does not look like a key. Format checking is
    deliberately loose: what makes it THE key is holding the exact same copy
    on the giving and the receiving computer, not a format."""
    key = "".join(raw.split())
    if not 32 <= len(key) <= 200:
        return None
    _adopt_cluster_secret(key)
    return key

# LAST SYNC CHECK: the office should be able to SEE that sharing is alive,
# not just trust a green light. Every finished pull cycle (nudge woken or
# the periodic 10-second tick) stamps this moment; Settings > Connections
# and the Admin's Technical tab display it. Stamped even when the cycle
# found nothing to pull: the stamp means "we checked", not "data moved".
_last_sync_check = None
_last_sync_check_lock = threading.Lock()

def get_last_sync_check():
    with _last_sync_check_lock:
        return _last_sync_check

def build_nudge_payload(local_ip: str, now: float = None) -> bytes:
    """PASADA_NUDGE:<ver>:<ip>:<timestamp>:<nonce>:<hmac>, no secret on the wire.

    Same trust model as the discovery broadcast: the signature proves cluster
    membership, the timestamp bounds replay, the nonce makes each datagram
    single-use."""
    if now is None:
        now = time.time()
    timestamp = str(int(now))
    nonce = secrets.token_hex(8)
    body = f"PASADA_NUDGE:{DISCOVERY_PROTOCOL_VERSION}:{local_ip}:{timestamp}:{nonce}".encode('utf-8')
    return body + b":" + _hmac_hex(body).encode('ascii')

def parse_nudge_payload(data: bytes, local_ip: str, now: float = None):
    """Return the sender's IP when the nudge signature is fresh and valid, else None.

    Any failure (garbage, wrong version, bad signature, stale timestamp,
    replayed nonce, own datagram) drops the packet quietly."""
    if now is None:
        now = time.time()
    try:
        parts = data.decode('utf-8').split(":")
        if len(parts) != 6 or parts[0] != "PASADA_NUDGE":
            return None
        if parts[1] != str(DISCOVERY_PROTOCOL_VERSION):
            return None
        peer_ip, timestamp, nonce, signature = parts[2], parts[3], parts[4], parts[5]
        body = f"PASADA_NUDGE:{DISCOVERY_PROTOCOL_VERSION}:{peer_ip}:{timestamp}:{nonce}".encode('utf-8')
        if not hmac.compare_digest(_hmac_hex(body), signature):
            return None
        age = abs(now - float(timestamp))
        if age > BROADCAST_MAX_AGE_SECONDS:
            _log_stale_packet("nudge", peer_ip, age)
            return None
        if not _broadcast_nonce_seen(nonce, now):
            return None
        if peer_ip == local_ip:
            return None
        return peer_ip
    except Exception:
        return None

def broadcast_nudge():
    """Send one signed wake-up datagram. Best effort: a failed broadcast only
    costs seconds, the next pull cycle catches up anyway. (udp_socket is
    preset to None so even a socket-construction failure cannot make the
    finally block raise a NameError back into the caller's API route.)"""
    udp_socket = None
    try:
        udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        _send_announcement(build_nudge_payload(get_local_ip()), udp_socket)
    except OSError:
        pass
    finally:
        if udp_socket is not None:
            udp_socket.close()

def notify_users_changed():
    """Called by main.py after any user-mutating action commits (create,
    password reset, deactivate, reactivate, bootstrap, recovery promote).
    Other machines pull within seconds instead of waiting for the cycle."""
    broadcast_nudge()

def get_local_ip():
    if _SYNC_LOCAL_IP_ENV:
        return _SYNC_LOCAL_IP_ENV
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        # No default route for the trick: fall back to any real LAN address
        # this machine holds before stranding itself on loopback, where it
        # would sign every datagram with an IP no office computer can reach.
        lan = _local_ipv4_addresses()
        IP = lan[0] if lan else '127.0.0.1'
    finally:
        s.close()
    return IP

def broadcast_presence():
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    local_ip = get_local_ip()

    while True:
        try:
            # SIGNED BROADCAST: proves membership without revealing the secret.
            _send_announcement(build_discovery_payload(local_ip), udp_socket)
            # PAIRING OFFER: advertised alongside discovery so a fresh install
            # can find this machine and ask for the cluster secret. Cheap
            # (one datagram), signed by our pairing key, and only meaningful
            # to machines that have no key of their own yet. Sent only while
            # this machine trusts itself to onboard strangers (pairing on)
            # and is still effectively solo or open — the listener refuses
            # challenges once the cluster is formed.
            if auto_pairing_enabled():
                offer = build_offer_payload(local_ip)
                if offer:
                    _send_announcement(offer, udp_socket)
        except Exception:
            pass
        time.sleep(10)

def _send_unicast(payload: bytes, dest_ip: str):
    """One-off socket: replies go straight to the joining machine rather
    than broadcast, so the encrypted secret is readable by exactly the one
    NIC it was encrypted for."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # The PEER's discovery/offer port, not the hardcoded constant: in a
        # lab (PASADA_SYNC_PORT override) or any future port change the
        # reply must land where the other instance is actually listening.
        sock.sendto(payload, (dest_ip, SYNC_PORT))
    except OSError:
        pass
    finally:
        sock.close()

# PAIRING SALVO SIZES: UDP unicast frames are silently droppable (office
# Wi-Fi, AP isolation, driver rates), and one lost handshake datagram used to
# delay pairing by a whole throttle minute. The challenge fires a short
# salvo; the secret-bearing reply fires a longer one because it is the LAST
# chance — a lost reply leaves the joiner with no key at all.
_CHALLENGE_ATTEMPTS = 2
_CHALLENGE_GAP_SECONDS = 2.0
_REPLY_ATTEMPTS = 3
_REPLY_GAP_SECONDS = 2.0

# [PASADA-SYNC] EVENT LOG: pairing packets are invisible by design — nothing
# releases key material — so a stuck handshake must be diagnosable from the
# crash log text alone. Each event kind is logged at most once per 60 s per
# peer/host key, so a busy listener cannot flood the file.
_sync_log_throttle = {}


def _log_sync_throttled(key: str, msg: str):
    now = time.time()
    last = _sync_log_throttle.get(key, 0)
    if now - last < 60 and last:
        return
    _sync_log_throttle[key] = now
    force_log(f"[PASADA-SYNC] {msg}")

def _handle_offer(peer_ip: str, peer_pub_der: bytes, name: str, local_ip: str):
    """Joiner side of auto-pairing: this machine has no WORKING cluster
    peers, so a heard offer is our path in. Answer with ONE throttled salvo
    of encrypted challenges. (A registry of entirely failing peers no
    longer blinds us: see _peers_all_failing.)"""
    if not auto_pairing_enabled() or not _peers_all_failing():
        reason = ("auto-pairing is switched OFF on this computer"
                  if not auto_pairing_enabled() else
                  "this computer already has working peer(s); a formed cluster "
                  "never re-keys itself from a stranger's offer")
        _log_sync_throttled(f"offer-ignore:{peer_ip}",
                            f"offer from {name or peer_ip} IGNORED ({reason}).")
        return
    now = time.time()
    with _throttle_lock:
        last = _challenge_throttle.get(peer_ip, 0)
        if now - last < 60:
            return
        _challenge_throttle[peer_ip] = now
    payload, _nonce = build_join_challenge(peer_pub_der, local_ip)
    if payload:
        for attempt in range(_CHALLENGE_ATTEMPTS):
            _send_unicast(payload, peer_ip)
            if attempt + 1 < _CHALLENGE_ATTEMPTS:
                # Brief gap so the retransmits cover transient loss without
                # looking like a flood to any packet logger.
                time.sleep(_CHALLENGE_GAP_SECONDS)
        record_auto_pair_event(f"Asked {name or peer_ip} to share the office cluster key.")
        _log_sync_throttled(f"ask:{peer_ip}",
                            f"offer from {name or peer_ip} HEARD: pairing challenge sent "
                            f"({_CHALLENGE_ATTEMPTS} datagram(s)) to {peer_ip}. "
                            "We re-ask every minute until we hold the cluster key.")

def _maybe_send_secret(joiner_ip: str, joiner_pub_der: bytes, name: str, local_ip: str):
    """Offerer side: hand the cluster secret to a machine we have NOT yet
    registered as a peer, ONCE per minute per machine. The throttle is the
    spam guard; the reply itself only decrypts for the machine it was
    encrypted to. A joiner already in PEERS needs no secret — it has one."""
    if joiner_ip in PEERS or not auto_pairing_enabled():
        return
    reply_throttle_title = f"cluster key not handed to {joiner_ip}"  # pragma: no cover (naming only)
    now = time.time()
    with _throttle_lock:
        last = _reply_throttle.get(joiner_ip, 0)
        if now - last < 60:
            return
        _reply_throttle[joiner_ip] = now
    sent_any = False
    for attempt in range(_REPLY_ATTEMPTS):
        # A FRESH envelope each attempt: new AES key and nonce, so a replay
        # of one captured envelope is never useful and an attacker sees only
        # more ciphertext of the SAME secret to the SAME key.
        reply = build_join_reply(b"PASADA_SECRET:" + CLUSTER_SECRET.encode('utf-8'), joiner_pub_der)
        if reply:
            sent_any = True
            _send_unicast(reply, joiner_ip)
            if attempt + 1 < _REPLY_ATTEMPTS:
                time.sleep(_REPLY_GAP_SECONDS)
    if sent_any:
        record_auto_pair_event(f"Shared the office cluster key with {name or joiner_ip}.")
        _log_sync_throttled(f"share:{joiner_ip}",
                            f"cluster key shared with {name or joiner_ip}: {_REPLY_ATTEMPTS} encrypted "
                            "envelope(s) sent. UDP can drop one; the joiner adopts only when "
                            "an envelope opens with ITS private half.")

def listen_for_peers():
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    # LAB OVERRIDE: pin the listener to one loopback NIC so two instances on
    # one PC do not fight over one wildcard socket.
    bind_ip, _, bind_port = os.environ.get("PASADA_SYNC_BIND", "").partition(":")
    udp_socket.bind((bind_ip or '', int(bind_port or SYNC_PORT)))
    local_ip = get_local_ip()

    while True:
        try:
            data, addr = udp_socket.recvfrom(4096)
            # OFFERS/CHALLENGES/REPLIES share the port; dispatch on the
            # visible prefix first so legacy packets take the same path as
            # before and old builds ignore these new ones silently.
            if data.startswith(b"PASADA_OFFER:"):
                if auto_pairing_enabled():
                    offer = parse_offer_payload(data, local_ip)
                    if offer:
                        peer_ip, peer_pub, name = offer
                        _handle_offer(peer_ip, peer_pub, name, local_ip)
                continue
            if data.startswith(b"PASADA_JOINBLOB:"):
                if auto_pairing_enabled():
                    opened = parse_join_challenge(data, local_ip)
                    if opened:
                        joiner_ip, joiner_pub, body = opened
                        _log_sync_throttled(f"challenge:{joiner_ip}",
                                            f"pairing challenge received from {joiner_ip} "
                                            "(it wants the office cluster key).")
                        # Name lookup: the joiner also broadcast its discovery
                        # with its friendly name; fall back to the IP.
                        _maybe_send_secret(joiner_ip, joiner_pub,
                                           PEER_NAMES.get(joiner_ip), local_ip)
                continue
            if data.startswith(b"PASADA_REPLYBLOB:"):
                if auto_pairing_enabled() and _peers_all_failing():
                    # Only a machine with no WORKING key-family peers may
                    # adopt; a formed, healthy cluster ignores replies
                    # outright (see _peers_all_failing for the exact gate).
                    sender = addr[0] if addr else None
                    plaintext = parse_join_reply(data)
                    if plaintext and plaintext.startswith(b"PASADA_SECRET:"):
                        candidate = plaintext[len(b"PASADA_SECRET:"):]
                        if 16 <= len(candidate) <= 256:
                            _adopt_cluster_secret(candidate.decode('utf-8'))
                            record_auto_pair_event(
                                f"Joined the office cluster (key received from {PEER_NAMES.get(sender) or sender}).")
                            # SELF-DIAGNOSIS: the one moment every machine
                            # fingerprint LEAPS — say the new one loudly so
                            # two crash logs can be compared instantly.
                            force_log(
                                f"[PASADA-SYNC] cluster key ADOPTED from "
                                f"{PEER_NAMES.get(sender) or sender}; this machine now "
                                f"holds fingerprint {cluster_secret_fingerprint()}.")
                continue
            # NUDGE FIRST: it shares the port with discovery and a nudge from
            # a peer we have not heard from yet must still wake the pull loop
            # (and register the sender, exactly as a discovery would).
            nudge_ip = parse_nudge_payload(data, local_ip)
            if nudge_ip is not None:
                if nudge_ip not in PEERS:
                    PEERS.add(nudge_ip)
                _mark_peer_seen(nudge_ip)
                request_sync_cycle()
                continue
            result = parse_discovery_payload(data, local_ip)
            if result:
                peer_ip, name = result
                if peer_ip not in PEERS:
                    PEERS.add(peer_ip)
                # Always refresh the name: the office may rename a machine.
                PEER_NAMES[peer_ip] = name
                _mark_peer_seen(peer_ip)
        except Exception as e:
            _log_listener_drop_once(addr, e)

# LISTENER DROP VISIBILITY: a handler erroring on every datagram used to be
# invisible (bare `except: pass`), which once cost a full lab session to find.
# Log the FIRST drop per exception type per 60 seconds — one line per
# pathology, never a flood.
_listener_drop_throttle = {}

def _log_listener_drop_once(addr, e):
    kind = type(e).__name__
    now = time.time()
    last = _listener_drop_throttle.get(kind, 0)
    if now - last < 60 and last:
        return
    _listener_drop_throttle[kind] = now
    force_log(f"[SYNC-LISTEN] dropped datagram from {addr[0] if addr else '?'}: "
              f"{kind}: {e} (further drops of this kind stay quiet for 60s)")

def _merge_incoming_users(db, incoming_users):
    """Merge accounts pulled from a peer into this machine's database.

    The copy on the machine where the account was created is the master;
    other machines fill in what they lack (new accounts, the legacy
    SYNCED_NO_PASSWORD stub, later password changes) and follow role and
    deactivation changes so every computer agrees on who can sign in.
    Security-answer hashes are never part of the payload, so recovery stays
    on the machine that set the questions.
    """
    from database import User
    for u_item in incoming_users:
        existing_user = db.query(User).filter(User.username == u_item['username']).first()
        if not existing_user:
            new_user = User(
                first_name=u_item.get('first_name'),
                last_name=u_item.get('last_name'),
                username=u_item.get('username'),
                role=u_item.get('role'),
                password_hash=u_item.get('password_hash') or "SYNCED_NO_PASSWORD",
                is_deactivated=bool(u_item.get('is_deactivated'))
            )
            db.add(new_user)
        else:
            incoming_hash = u_item.get('password_hash') or ""
            stale_stub = existing_user.password_hash == "SYNCED_NO_PASSWORD"
            different_real_hash = (
                incoming_hash
                and incoming_hash != "SYNCED_NO_PASSWORD"
                and existing_user.password_hash != incoming_hash
            )
            if stale_stub or different_real_hash:
                # Fill the legacy stub, and follow a password change made on
                # the owning machine so the account stays usable everywhere.
                existing_user.password_hash = incoming_hash
            incoming_role = u_item.get('role')
            if incoming_role in ('Admin', 'Clerk') and existing_user.role != incoming_role:
                # Follow a role change made on the owning machine (admin
                # bootstrap or an admin promoting an account) so every
                # computer agrees on who the admins are.
                existing_user.role = incoming_role
            incoming_flag = bool(u_item.get('is_deactivated'))
            if bool(existing_user.is_deactivated) != incoming_flag:
                # Deactivation travels with the account so a deactivated
                # clerk cannot dodge it by signing in on another computer.
                existing_user.is_deactivated = incoming_flag


# POISONED-ROW VISIBILITY: a pull row whose timestamp cannot even be parsed
# is merged anyway (by-design tolerance) and stamped with the local now —
# that fallback used to be invisible, so an office sending degraded data
# looked "successful". Count such rows and log at most once per 15 minutes
# with the total seen since the last line. NOT a crash: data still flows.
_poison_rows = {"t": 0.0, "n": 0}

def _note_poison_row():
    _poison_rows["n"] += 1
    now = time.time()
    if _poison_rows["t"] == 0 or now - _poison_rows["t"] >= 900:
        force_log(f"[SYNC] {_poison_rows['n']} incoming row(s) had unreadable "
                  "timestamps; merged with this machine's local time.")
        _poison_rows["t"] = now
        _poison_rows["n"] = 0

def sync_with_peers():
    while True:
        # HEARTBEAT-AWARE WAIT: sleep up to 10 seconds, but a signed nudge
        # from any peer wakes this pull loop at once for an immediate pull. Clear
        # BEFORE the cycle so a nudge that arrives while we are pulling still
        # wins one more quick pass after it.
        _wake_pull_loop.wait(timeout=10)
        _wake_pull_loop.clear()
        try:
            db = SessionLocal()
        except Exception as e:
            # A dead session factory must not kill the loop silently: the
            # pull loop otherwise exists without ever attempting a pull and
            # without a single line explaining why.
            force_log(f"[SYNC] SessionLocal failed: {type(e).__name__}: {e}")
            time.sleep(5)
            continue
        try:
            latest_record = db.query(FranchiseRecord).order_by(FranchiseRecord.updated_at.desc()).first()
            # SKEW GUARD: look back a little further than the newest local
            # stamp, so a peer with a slightly slower office clock still
            # delivers records stamped "in our past". (First sync, or an
            # empty registry, still starts from 2000.)
            if latest_record and latest_record.updated_at:
                watermark = latest_record.updated_at.replace(tzinfo=None) - timedelta(seconds=PULL_SKEW_GUARD_SECONDS)
                last_sync_time = watermark.isoformat()
            else:
                last_sync_time = "2000-01-01T00:00:00"
            
            for peer in list(PEERS):
                try:
                    # PULL AUTH: sign the request instead of sending the secret.
                    # The signature covers the IP this machine is ADDRESSED to
                    # (the peer's LAN address), the timestamp, and a one-time
                    # nonce. The peer rebuilds the same HMAC from its own copy
                    # of the cluster secret.
                    ts = str(int(time.time()))
                    nonce = secrets.token_hex(8)
                    body = f"PULL:{peer}:{ts}:{nonce}".encode('utf-8')
                    signature = _hmac_hex(body)
                    response = requests.get(
                        f"http://{peer}:{API_PORT}/api/sync/pull?since={last_sync_time}",
                        headers={
                            "X-Cluster-Timestamp": ts,
                            "X-Cluster-Nonce": nonce,
                            "X-Cluster-Signature": signature,
                        },
                        timeout=5,
                    )
                    if not response.ok:
                        # A refused pull (bad signature, clock skew) is a
                        # REAL failure: count the miss and log the streak
                        # like any network error instead of silently
                        # pulling nothing forever.
                        raise RuntimeError(f"peer answered {response.status_code}")
                    if response.ok:
                        incoming_data = response.json()
                        # A pull that reaches a working peer clears its miss
                        # streak, so a flaky network frame is not counted
                        # against it forever.
                        with _peer_failures_lock:
                            _peer_failures.pop(peer, None)
                        _mark_peer_seen(peer)
                        # PER-PEER OUTCOME: the log should say when a pull
                        # WORKED, not only when it burned. Throttled to one
                        # line per peer per minute.
                        _log_sync_throttled(
                            f"pull-ok:{peer}",
                            f"pull from {peer} OK: "
                            f"{len(incoming_data.get('records', []))} record(s), "
                            f"{len(incoming_data.get('users', []))} account(s) received (merged below).")
                        
                        # SYNC ACCOUNTS: the bcrypt password hash now ROAMS with
                        # the account, so a login created on one office computer
                        # works on all of them. The pull endpoint only shares
                        # password hashes over HMAC-signed requests inside the
                        # trusted cluster. First writer wins on updates: the
                        # copy on the machine where the account was created is
                        # the master; other machines only fill in what they
                        # lack (new accounts, or accounts that still carry the
                        # legacy SYNCED_NO_PASSWORD stub). Security-answer
                        # hashes never leave the owning machine, so account
                        # recovery stays on the computer that set the questions.
                        _merge_incoming_users(db, incoming_data.get('users', []))

                        
                        # SYNC RECORDS WITH TOMBSTONES
                        valid_keys = {c.name for c in FranchiseRecord.__table__.columns}
                        for item in incoming_data.get('records', []):
                            clean_item = {k: v for k, v in item.items() if k in valid_keys}
                            existing = db.query(FranchiseRecord).filter(FranchiseRecord.id == clean_item['id']).first()
                            
                            if not existing:
                                new_rec = FranchiseRecord(**clean_item)
                                try:
                                    new_rec.issue_date = datetime.fromisoformat(clean_item['issue_date']).replace(tzinfo=None) if clean_item.get('issue_date') else None
                                    new_rec.valid_until = datetime.fromisoformat(clean_item['valid_until']).replace(tzinfo=None) if clean_item.get('valid_until') else None
                                    new_rec.updated_at = datetime.fromisoformat(clean_item['updated_at']).replace(tzinfo=None) if clean_item.get('updated_at') else get_pht_now().replace(tzinfo=None)
                                except (ValueError, TypeError):
                                    # Same poison tolerance as below: a row we
                                    # cannot even timestamp still arrives with
                                    # a local now instead of killing the pull.
                                    _note_poison_row()
                                    new_rec.updated_at = get_pht_now().replace(tzinfo=None)
                                db.add(new_rec)
                            else:
                                # One poisoned row (missing timestamp, from an
                                # old version) used to raise here, roll back
                                # the WHOLE peer pull and retry the same
                                # poison every cycle. Tolerate it: rows without
                                # a timestamp are older than anything local.
                                try:
                                    incoming_time = datetime.fromisoformat(clean_item['updated_at']).replace(tzinfo=None) if clean_item.get('updated_at') else datetime.min
                                except (ValueError, TypeError):
                                    incoming_time = datetime.min
                                existing_time = existing.updated_at.replace(tzinfo=None) if existing.updated_at else datetime.min
                                
                                if incoming_time > existing_time:
                                    for key, value in clean_item.items():
                                        if key in ['issue_date', 'valid_until', 'updated_at']:
                                            if value: setattr(existing, key, datetime.fromisoformat(value).replace(tzinfo=None))
                                        else:
                                            setattr(existing, key, value)
                        db.commit()
                except Exception as e:
                    # A bad record from one peer must not kill the loop or the
                    # whole cycle: log it and count the miss. The crash log is
                    # the only place this is visible, so make it count — but
                    # bound the spam: after a bounded fail streak the peer is
                    # dropped from the registry (its next discovery broadcast
                    # re-adds it, so a powered-off machine or a stale DHCP
                    # address costs nothing until it is really back).
                    with _peer_failures_lock:
                        misses = _peer_failures.get(peer, 0) + 1
                        _peer_failures[peer] = misses
                        if misses == 1:
                            force_log(f"[SYNC] Pull from {peer} failed: {e}")
                            drop = False
                        elif misses >= PEER_MAX_CONSECUTIVE_FAILURES:
                            drop = True
                        else:
                            drop = False
                    # EVERY failed pull is told to the log at most once per
                    # minute per peer (the miss==1 line above carries the
                    # first failure in full; this throttle covers the rest).
                    _log_sync_throttled(
                        f"pull-fail:{peer}",
                        f"pull from {peer} FAILED (streak {misses}/{PEER_MAX_CONSECUTIVE_FAILURES}): {e}")
                    if drop:
                        force_log(
                            f"[SYNC] {peer} unreachable after "
                            f"{PEER_MAX_CONSECUTIVE_FAILURES} misses; dropped "
                            "from the peer registry until it broadcasts again.")
                        PEERS.discard(peer)
                        with _peer_failures_lock:
                            _peer_failures.pop(peer, None)
                    db.rollback()
                    continue
        except Exception as e:
            force_log(f"[SYNC] Cycle failed: {e}")
            db.rollback()
        finally:
            # A finished pass counts as a check even when no peer answered:
            # the Connections card shows this stamp so the office can tell
            # "sharing is alive" from "stalled hours ago".
            _mark_sync_cycle_finished()
            db.close()

def _mark_sync_cycle_finished():
    global _last_sync_check
    with _last_sync_check_lock:
        _last_sync_check = get_pht_now().isoformat()

def _log_sync_startup():
    """STARTUP VISIBILITY: one crash-log line that names everything two
    logs need to be compared against each other — the chosen LAN IP, the
    auto-pairing switch, pairing-crypto readiness, the machine's key
    fingerprint, how many peers this copy already knows, and its ports."""
    try:
        crypto = ("available" if _has_working_pairing() else
                  "MISSING — reinstall PASADA on this computer (its cryptography wheel failed to load)")
        force_log(
            f"[SYNC] startup: local ip {get_local_ip()}. "
            f"auto-pairing {'ON' if auto_pairing_enabled() else 'OFF'}. "
            f"pairing crypto {crypto}. "
            f"cluster key fingerprint: {cluster_secret_fingerprint()}. "
            f"known peers: {len(PEERS)}. "
            f"sync port: {SYNC_PORT}, api port: {API_PORT}"
        )
    except Exception:
        pass

def start_lan_sync():
    _log_sync_startup()
    threading.Thread(target=broadcast_presence, daemon=True).start()
    threading.Thread(target=listen_for_peers, daemon=True).start()
    threading.Thread(target=sync_with_peers, daemon=True).start()