import socket
import threading
import time
import requests
import os
from database import SessionLocal, FranchiseRecord, get_pht_now, BASE_DIR
from datetime import datetime

BROADCAST_PORT = 54321
API_PORT = 43888
PEERS = set()

# CLUSTER SECRET: Secures local endpoints from random unauthorized network callers
CLUSTER_SECRET_PATH = os.path.join(BASE_DIR, "cluster_secret.key")
if os.path.exists(CLUSTER_SECRET_PATH):
    with open(CLUSTER_SECRET_PATH, "r") as f:
        CLUSTER_SECRET = f.read().strip()
else:
    import uuid
    CLUSTER_SECRET = str(uuid.uuid4())
    with open(CLUSTER_SECRET_PATH, "w") as f:
        f.write(CLUSTER_SECRET)

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
            # AUTHENTICATED BROADCAST
            message = f"PASADA_NODE:{CLUSTER_SECRET}:{local_ip}".encode('utf-8')
            udp_socket.sendto(message, ('<broadcast>', BROADCAST_PORT))
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
            message = data.decode('utf-8')
            if message.startswith("PASADA_NODE:"):
                parts = message.split(":")
                # STRICT AUTH: Only add peers matching cluster secret
                if len(parts) == 3 and parts[1] == CLUSTER_SECRET:
                    peer_ip = parts[2]
                    if peer_ip != local_ip and peer_ip not in PEERS:
                        PEERS.add(peer_ip)
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
                    headers = {"X-Cluster-Secret": CLUSTER_SECRET}
                    response = requests.get(f"http://{peer}:{API_PORT}/api/sync/pull?since={last_sync_time}", headers=headers, timeout=5)
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