"""LIVE two-instance verification: B auto-pairs to A and syncs within a minute.

Runs ONE PC, two hermetic PASADA backends on separate loopback IPs
(127.0.0.2 = A, 127.0.0.3 = B), each with its own PASADA_DATA_DIR so no real
office data is touched. Everything is verified through the real endpoints:
signup/token/bootstrap, a real POST /franchise/ record, and the signed
/api/sync/pull path (B's adopted secret is read from B's own data dir —
the subprocess owns the DB; the driver never opens B's SQLite directly).

Usage: venv/bin/python tests/live_pairing_test.py [--keep]
Exit 0 = pairing + record sync + account sync + auth-reject all passed.
"""
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import hmac
import hashlib

HOME = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.abspath(os.path.join(HOME, ".."))
PY = os.path.join(BACKEND, "venv", "bin", "python")

IP_A, IP_B = "127.0.0.2", "127.0.0.3"
SYNC_PORT = 54321
API_PORT = 43888
ADMIN_USER = "ADMINLIVE"
ADMIN_PASS = "LivePair!2026x"
CLERK_USER = "CLERK_LIVE"
SBN = "SBN-LIVE-0001"

PROCS = []
DIRS = []


def http(instance_ip, port, path, method="GET", headers=None, body=None, timeout=10):
    """Return (status, parsed-body-or-text). IPv4 pinned so it reaches the
    right loopback alias."""
    url = f"http://{instance_ip}:{port}{path}"
    conn = socket.create_connection((instance_ip, port), timeout=timeout)
    try:
        hdrs = dict(headers or {})
        payload = b""
        if body is not None:
            payload = json.dumps(body).encode()
            hdrs.setdefault("Content-Type", "application/json")
        req = (
            f"{method} {path} HTTP/1.1\r\n"
            f"Host: {instance_ip}:{port}\r\n"
            f"Connection: close\r\n"
            + "".join(f"{k}: {v}\r\n" for k, v in hdrs.items())
            + f"Content-Length: {len(payload)}\r\n\r\n"
        ).encode()
        conn.sendall(req + payload)
        resp = b""
        conn.settimeout(timeout)
        while True:
            try:
                chunk = conn.recv(65536)
            except socket.timeout:
                break
            if not chunk:
                break
            resp += chunk
        head, _, rest = resp.partition(b"\r\n\r\n")
        status = int(head.split(b" ")[1])
        # close-delimited and chunked bodies both end here; try json parse
        text = rest.decode(errors="replace")
        if "Transfer-Encoding: chunked" in head.decode(errors="replace"):
            raw = b""
            chunks = rest.split(b"\r\n")
            i = 0
            while i + 1 < len(chunks):
                try:
                    n = int(chunks[i], 16)
                except ValueError:
                    break
                if n == 0:
                    break
                raw += chunks[i + 1][:n]
                i += 2
            text = raw.decode(errors="replace")
        try:
            return status, json.loads(text)
        except Exception:
            return status, text.strip()
    finally:
        conn.close()


def start_instance(name, ip):
    datadir = tempfile.mkdtemp(prefix=f"pasada_pairtest_{name}_")
    DIRS.append(datadir)
    env = dict(os.environ)
    env.update({
        "PASADA_DATA_DIR": datadir,
        "PASADA_API_HOST": ip,
        "PASADA_SYNC_BIND": f"{ip}:{SYNC_PORT}",
        "PASADA_SYNC_LOCAL_IP": ip,
        "PASADA_SYNC_TARGETS": (f"{IP_B}:{SYNC_PORT}" if name == "A" else f"{IP_A}:{SYNC_PORT}"),
        "PASADA_SKIP_ZOMBIE_KILL": "1",
    })
    proc = subprocess.Popen(
        [PY, "main.py"], cwd=BACKEND, env=env,
        stdout=open(f"/tmp/pasada_{name}_stdout.log", "w"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    PROCS.append(proc)
    return datadir


def wait_health(ip, label, deadline_s=120):
    deadline = time.time() + deadline_s
    while time.time() < deadline:
        try:
            status, body = http(ip, API_PORT, "/health")
            if status == 200:
                return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise AssertionError(f"{label} on {ip} never answered /health")


def signed_pull(target_ip, secret, expect_status):
    """Signed /api/sync/pull exactly like sync_with_peers does it (peer is
    the IP being ADDRESSED). Returns (status, body)."""
    ts = str(int(time.time()))
    nonce = time.strftime("%S") + str(time.time()).replace(".", "")[:12]  # unique per call: pull nonces are single-use
    matched = None
    for peer in (target_ip, "127.0.0.1", "localhost"):
        body = f"PULL:{peer}:{ts}:{nonce}".encode()
        matched = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        st, data = http(target_ip, API_PORT, f"/api/sync/pull?since=2000-01-01T00:00:00",
                        headers={"X-Cluster-Timestamp": ts, "X-Cluster-Nonce": nonce,
                                 "X-Cluster-Signature": matched})
        if st == 200:
            return st, data
    return st, data


def main():
    keep = "--keep" in sys.argv
    ok = True
    try:
        # --- boot A, make it an office with one admin, one clerk, one record
        start_instance("A", IP_A)
        wait_health(IP_A, "A")
        st, body = http(IP_A, API_PORT, "/signup", "POST", body={
            "first_name": "Scenario", "last_name": "One", "username": ADMIN_USER,
            "password": ADMIN_PASS, "password_confirm": ADMIN_PASS, "role": "Clerk"})
        assert st == 200, f"A signup failed: {st} {body}"
        st, body = http(IP_A, API_PORT, "/token", "POST", body={
            "username": ADMIN_USER, "password": ADMIN_PASS})
        assert st == 200, f"A token failed: {st} {body}"
        auth = {"Authorization": f"Bearer {body['access_token']}"}
        st, body = http(IP_A, API_PORT, "/admin/bootstrap", "POST", headers=auth,
                        body={"password": ADMIN_PASS})
        assert st == 200 and body["role"] == "Admin", f"A bootstrap failed: {body}"
        st, body = http(IP_A, API_PORT, "/users", "POST", headers=auth, body={
            "first_name": "Ana", "last_name": "Clerk", "username": CLERK_USER,
            "password": "ClerkLive!2026", "role": "Clerk"})
        assert st in (200, 201), f"A user create failed: {st} {body}"
        st, body = http(IP_A, API_PORT, "/franchise/", "POST", headers=auth, body={
            "sbn_no": SBN, "operator_name": "Live Operator", "address": "Test Brgy",
            "motor_no": "MT-0001", "plate_no": "PLT-0001", "route": "TEST-ROUTE",
            "make": "TMX", "chassis_no": "CS-0001"})
        assert st in (200, 201), f"A record create failed: {st} {body}"
        # The endpoint normalizes the submitted SBN (same as production); the
        # EXPECTED id on B is what A actually stores, not the raw input.
        record = body.get("record", body) if isinstance(body, dict) else {}
        sbn_stored = record.get("sbn_no") or body.get("sbn_no") or SBN
        print(f"[PASS] A seeded: admin bootstrap, clerk account, record {body}")

        # --- boot the empty B, expect it to auto-join A
        start_instance("B", IP_B)
        wait_health(IP_B, "B")
        print("[pass] B booted (no accounts, no cluster key of its own peers)")

        # PAIRING + SYNC ARE ONE OUTCOME: poll B through its real pull
        # endpoint until the record appears (or 90s expires). The cluster
        # secret file exists from boot, so the FILE is not the signal — the
        # DATA arriving through the signed pull is.
        deadline = time.time() + 90
        data = {}
        st = 0
        while time.time() < deadline:
            try:
                secret_b = open(os.path.join(DIRS[1], "cluster_secret.key")).read().strip()
            except FileNotFoundError:
                secret_b = ""
            if secret_b:
                st, data = signed_pull(IP_B, secret_b, 200)
                if st == 200 and sbn_stored in [r.get("sbn_no") for r in data.get("records", [])]:
                    break
            time.sleep(3)
        assert st == 200, f"Signed pull from B never succeeded: {st}"
        sbns = [r.get("sbn_no") for r in data.get("records", [])]
        assert sbn_stored in sbns, f"B does not have record {sbn_stored} within 90s; got {sbns}"
        users = {u.get("username") for u in data.get("users", [])}
        assert ADMIN_USER in users and CLERK_USER in users, f"accounts not synced: {users}"
        print(f"[PASS] record on B: {sbn_stored} present; accounts on B: {users}")

        # --- auth: a garbage signature must be refused on B
        st, _ = signed_pull(IP_B, "not-the-real-secret", 0)
        assert st == 403, f"B accepted a bad pull signature (status {st})"
        print("[PASS] B refused unsigned pull (403) for a non-member secret")

        # --- B's log shows the handshake markers from the engine
        crash = open(os.path.join(DIRS[1], "PASADA_CRASH_LOG.txt")).read()
        assert "AUTO-PAIR" in crash, "engine never logged an auto-pair event on B"
        print("[PASS] B's engine log carries AUTO-PAIR join markers")

        print("\nALL GREEN: two instances on one PC auto-paired and synced "
              "records + accounts through the real endpoints.")
    except AssertionError as e:
        ok = False
        print(f"\n[FAIL] {e}")
    finally:
        if not keep:
            for p in PROCS:
                try:
                    os.killpg(os.getpgid(p.pid), signal.SIGTERM)
                except (OSError, ProcessLookupError):
                    pass
            time.sleep(2)
        for d in DIRS:
            if not keep:
                shutil.rmtree(d, ignore_errors=True)
        print(("kept: " + ", ".join(DIRS)) if keep else "cleaned up instance data dirs")
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
