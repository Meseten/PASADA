import socket
import threading
import time
import requests
from database import SessionLocal, FranchiseRecord, get_pht_now
from datetime import datetime

BROADCAST_PORT = 54321
API_PORT = 43888
PEERS = set()

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
            message = f"PASADA_NODE:{local_ip}".encode('utf-8')
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
                peer_ip = message.split(":")[1]
                if peer_ip != local_ip and peer_ip not in PEERS:
                    PEERS.add(peer_ip)
        except Exception:
            pass

def sync_with_peers():
    while True:
        time.sleep(10) # Set to 10 seconds for faster updates
        db = SessionLocal()
        try:
            latest_record = db.query(FranchiseRecord).order_by(FranchiseRecord.updated_at.desc()).first()
            last_sync_time = latest_record.updated_at.isoformat() if latest_record else "2000-01-01T00:00:00"
            
            for peer in list(PEERS):
                try:
                    response = requests.get(f"http://{peer}:{API_PORT}/api/sync/pull?since={last_sync_time}", timeout=5)
                    if response.ok:
                        incoming_data = response.json()
                        
                        # 1. SYNC ACCOUNTS (Ensures offline login works)
                        from database import User # Ensure User is imported at the top of the file
                        for u_item in incoming_data.get('users', []):
                            existing_user = db.query(User).filter(User.username == u_item['username']).first()
                            if not existing_user:
                                new_user = User(**u_item)
                                db.add(new_user)
                        
                        # 2. SYNC TRICYCLE RECORDS
                        for item in incoming_data.get('records', []):
                            existing = db.query(FranchiseRecord).filter(FranchiseRecord.id == item['id']).first()
                            if not existing:
                                new_rec = FranchiseRecord(**item)
                                new_rec.issue_date = datetime.fromisoformat(item['issue_date'])
                                new_rec.valid_until = datetime.fromisoformat(item['valid_until'])
                                new_rec.updated_at = datetime.fromisoformat(item['updated_at'])
                                db.add(new_rec)
                            else:
                                incoming_time = datetime.fromisoformat(item['updated_at'])
                                if incoming_time > existing.updated_at:
                                    for key, value in item.items():
                                        if key in ['issue_date', 'valid_until', 'updated_at']:
                                            setattr(existing, key, datetime.fromisoformat(value))
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