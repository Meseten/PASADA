import socket
import threading
import time
import hmac
import hashlib
import secrets
import requests
import os
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

BROADCAST_PORT = 54321
API_PORT = 43888
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
    import uuid
    CLUSTER_SECRET = str(uuid.uuid4())
    with open(CLUSTER_SECRET_PATH, "w") as f:
        f.write(CLUSTER_SECRET)

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
    friendly name, when it was last heard, current pull-miss streak (0 after
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
    costs seconds, the next pull cycle catches up anyway."""
    udp_socket = None
    try:
        udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        udp_socket.sendto(build_nudge_payload(get_local_ip()), ('<broadcast>', BROADCAST_PORT))
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
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

def broadcast_presence():
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    local_ip = get_local_ip()
    
    while True:
        try:
            # SIGNED BROADCAST: proves membership without revealing the secret.
            udp_socket.sendto(build_discovery_payload(local_ip), ('<broadcast>', BROADCAST_PORT))
        except Exception:
            pass
        time.sleep(10)

def listen_for_peers():
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    udp_socket.bind(('', BROADCAST_PORT))
    local_ip = get_local_ip()

    while True:
        try:
            data, addr = udp_socket.recvfrom(1024)
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
        except Exception:
            pass

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


def sync_with_peers():
    while True:
        # HEARTBEAT-AWARE WAIT: sleep up to 10 seconds, but a signed nudge
        # from any peer wakes this loop at once for an immediate pull. Clear
        # BEFORE the cycle so a nudge that arrives while we are pulling still
        # wins one more quick pass after it.
        _wake_pull_loop.wait(timeout=10)
        _wake_pull_loop.clear()
        db = SessionLocal()
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
                    if response.ok:
                        incoming_data = response.json()
                        # A pull that reaches a working peer clears its miss
                        # streak, so a flaky network frame is not counted
                        # against it forever.
                        with _peer_failures_lock:
                            _peer_failures.pop(peer, None)
                        _mark_peer_seen(peer)
                        
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

def start_lan_sync():
    threading.Thread(target=broadcast_presence, daemon=True).start()
    threading.Thread(target=listen_for_peers, daemon=True).start()
    threading.Thread(target=sync_with_peers, daemon=True).start()