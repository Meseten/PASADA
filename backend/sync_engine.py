import socket
import threading
import time
import hmac
import hashlib
import secrets
import requests
import os
from database import SessionLocal, FranchiseRecord, get_pht_now, BASE_DIR
from datetime import datetime

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
    """PASADA_NODE:<ip>:<timestamp>:<nonce>:<name>:<hmac>, secret never on the wire.

    The friendly computer name travels INSIDE the signed body, so a tampered
    name breaks the signature like any other change."""
    if now is None:
        now = time.time()
    timestamp = str(int(now))
    nonce = secrets.token_hex(8)
    body = f"PASADA_NODE:{local_ip}:{timestamp}:{nonce}:{COMPUTER_NAME}".encode('utf-8')
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
        if len(parts) != 6 or parts[0] != "PASADA_NODE":
            return None
        peer_ip, timestamp, nonce, name, signature = parts[1], parts[2], parts[3], parts[4], parts[5]
        body = f"PASADA_NODE:{peer_ip}:{timestamp}:{nonce}:{name}".encode('utf-8')
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
            result = parse_discovery_payload(data, local_ip)
            if result:
                peer_ip, name = result
                if peer_ip not in PEERS:
                    PEERS.add(peer_ip)
                # Always refresh the name: the office may rename a machine.
                PEER_NAMES[peer_ip] = name
        except Exception:
            pass

def sync_with_peers():
    while True:
        time.sleep(10) 
        db = SessionLocal()
        try:
            latest_record = db.query(FranchiseRecord).order_by(FranchiseRecord.updated_at.desc()).first()
            last_sync_time = latest_record.updated_at.replace(tzinfo=None).isoformat() if (latest_record and latest_record.updated_at) else "2000-01-01T00:00:00"
            
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
                        
                        # SYNC ACCOUNTS: (Password hashes have been stripped from the wire by main.py)
                        from database import User
                        for u_item in incoming_data.get('users', []):
                            existing_user = db.query(User).filter(User.username == u_item['username']).first()
                            if not existing_user:
                                # We MUST NOT splat unverified payloads over users
                                new_user = User(
                                    first_name=u_item.get('first_name'),
                                    last_name=u_item.get('last_name'),
                                    username=u_item.get('username'),
                                    role=u_item.get('role'),
                                    password_hash="SYNCED_NO_PASSWORD" # Prevents local login until admin resets
                                )
                                db.add(new_user)
                        
                        # SYNC RECORDS WITH TOMBSTONES
                        valid_keys = {c.name for c in FranchiseRecord.__table__.columns}
                        for item in incoming_data.get('records', []):
                            clean_item = {k: v for k, v in item.items() if k in valid_keys}
                            existing = db.query(FranchiseRecord).filter(FranchiseRecord.id == clean_item['id']).first()
                            
                            if not existing:
                                new_rec = FranchiseRecord(**clean_item)
                                new_rec.issue_date = datetime.fromisoformat(clean_item['issue_date']).replace(tzinfo=None) if clean_item.get('issue_date') else None
                                new_rec.valid_until = datetime.fromisoformat(clean_item['valid_until']).replace(tzinfo=None) if clean_item.get('valid_until') else None
                                new_rec.updated_at = datetime.fromisoformat(clean_item['updated_at']).replace(tzinfo=None) if clean_item.get('updated_at') else get_pht_now().replace(tzinfo=None)
                                db.add(new_rec)
                            else:
                                incoming_time = datetime.fromisoformat(clean_item['updated_at']).replace(tzinfo=None)
                                existing_time = existing.updated_at.replace(tzinfo=None) if existing.updated_at else datetime.min
                                
                                if incoming_time > existing_time:
                                    for key, value in clean_item.items():
                                        if key in ['issue_date', 'valid_until', 'updated_at']:
                                            if value: setattr(existing, key, datetime.fromisoformat(value).replace(tzinfo=None))
                                        else:
                                            setattr(existing, key, value)
                        db.commit()
                except Exception:
                    continue
        except Exception:
            db.rollback()
        finally:
            db.close()

def start_lan_sync():
    threading.Thread(target=broadcast_presence, daemon=True).start()
    threading.Thread(target=listen_for_peers, daemon=True).start()
    threading.Thread(target=sync_with_peers, daemon=True).start()