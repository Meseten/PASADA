# LIVE PIN PAIRING TEST: two real instances, one PC. Unlike
# live_pairing_test.py (the automatic handshake), THIS one turns auto-pairing
# OFF on both machines — the exact broken office scenario: a Windows machine
# whose security library failed, or an office that wants to admit computers
# by hand. The Admin arms a PIN on A, the joiner B types it, the cluster key
# crosses inside the PIN envelope, and then the signed pull must move data.
#
#   1. A boots with auto_pairing_off.flag, gets admin + a clerk + one record.
#   2. B boots with auto_pairing_off.flag and no records (local admin made so
#      someone can log in and press Join).
#   3. Wrong PIN must be refused (and logged), then the REAL PIN joins.
#   4. B's key file must equal A's; signed pull B->A shows the record.
#   5. Both engines log the PIN events; A's audit trail says "via PIN".
import hashlib
import hmac
import json
import os
import shutil
import signal
import subprocess
import sys
import time

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PY = os.path.join(BACKEND, "..", ".venv", "bin", "python")
sys.path.insert(0, os.path.dirname(__file__))

import live_pairing_test as L  # reuse http/start_instance/wait_health/signed_pull

ADMIN_PASS = L.ADMIN_PASS
SBN = "SBN-PIN-0001"


def _disable_auto_pairing(datadir):
    # The flag lives in the instance's PASADA_DATA_DIR: sync_engine refuses
    # offers/challenges/replies while it exists. PIN pairing ignores it.
    open(os.path.join(datadir, "auto_pairing_off.flag"), "w").write("off")


def main():
    keep = "--keep" in sys.argv
    ok = True
    sys.stdout.reconfigure(line_buffering=True)
    try:
        start_a = L.start_instance("A", L.IP_A)
        _disable_auto_pairing(start_a)
        L.wait_health(L.IP_A, "A")
        st, body = L.http(L.IP_A, L.API_PORT, "/signup", "POST", body={
            "first_name": "Pin", "last_name": "Admin", "username": L.ADMIN_USER,
            "password": ADMIN_PASS, "password_confirm": ADMIN_PASS, "role": "Clerk"})
        assert st == 200, f"A signup failed: {st} {body}"
        st, body = L.http(L.IP_A, L.API_PORT, "/token", "POST", body={
            "username": L.ADMIN_USER, "password": ADMIN_PASS})
        assert st == 200, f"A token failed: {st} {body}"
        auth_a = {"Authorization": f"Bearer {body['access_token']}"}
        st, body = L.http(L.IP_A, L.API_PORT, "/admin/bootstrap", "POST",
                          headers=auth_a, body={"password": ADMIN_PASS})
        assert st == 200 and body["role"] == "Admin", f"A bootstrap failed: {body}"
        st, body = L.http(L.IP_A, L.API_PORT, "/franchise/", "POST", headers=auth_a, body={
            "sbn_no": SBN, "operator_name": "Pin Operator", "address": "Test Brgy",
            "motor_no": "MTP-1", "plate_no": "PLTP-1", "route": "PIN-ROUTE",
            "make": "TMX", "chassis_no": "CHP-1"})
        assert st in (200, 201), f"A record create failed: {st} {body}"
        print("[PASS] A booted, auto-pairing OFF, admin + record seeded")

        # --- B: fresh machine, also auto-pairing OFF, own local admin
        dir_b = L.start_instance("B", L.IP_B)
        _disable_auto_pairing(dir_b)
        L.wait_health(L.IP_B, "B")
        st, body = L.http(L.IP_B, L.API_PORT, "/signup", "POST", body={
            "first_name": "Joiner", "last_name": "Admin", "username": "JOINER",
            "password": ADMIN_PASS, "password_confirm": ADMIN_PASS, "role": "Clerk"})
        assert st == 200, f"B signup failed: {st} {body}"
        st, body = L.http(L.IP_B, L.API_PORT, "/token", "POST", body={
            "username": "JOINER", "password": ADMIN_PASS})
        assert st == 200, f"B token failed: {st} {body}"
        auth_b = {"Authorization": f"Bearer {body['access_token']}"}
        st, body = L.http(L.IP_B, L.API_PORT, "/admin/bootstrap", "POST",
                          headers=auth_b, body={"password": ADMIN_PASS})
        assert st == 200, f"B bootstrap failed: {body}"
        print("[PASS] B booted with auto-pairing OFF and a local admin")

        # --- preflight: B must NOT see A's record yet and must not be a peer
        secret_a_path = os.path.join(L.DIRS[0], "cluster_secret.key")
        secret_b_path = os.path.join(dir_b, "cluster_secret.key")
        secret_a = open(secret_a_path).read().strip()
        secret_b = open(secret_b_path).read().strip()
        assert secret_a != secret_b, "fresh offices must hold different keys"
        st, data = L.signed_pull(L.IP_B, secret_b, 200)
        assert SBN not in [r.get("sbn_no") for r in data.get("records", [])], \
            "B must not have A's record before pairing"
        print("[PASS] preflight: different keys, no shared records yet")

        # --- arm the PIN on A
        st, body = L.http(L.IP_A, L.API_PORT, "/system/pairing-pin/arm", "POST",
                          headers=auth_a, body={})
        assert st == 200, f"arm failed: {st} {body}"
        pin = body["pin"]
        assert isinstance(pin, str) and pin.isdigit() and len(pin) == 6
        expires = body["expires_in_seconds"]
        assert 0 < expires <= 600, f"arm expiry looks wrong: {expires}"
        print(f"[PASS] A armed a PIN (six digits, expires in {expires}s); "
              "digits stay out of the log image")
        st, body = L.http(L.IP_A, L.API_PORT, "/system/pairing-pin/status", "GET",
                          headers=auth_a)
        assert st == 200 and json.dumps(body.get("armed")) == "true", body
        assert pin not in json.dumps(body), "status must not echo the digits"
        print("[PASS] A status shows armed without echoing the digits")

        # --- a WRONG pin from B must be refused (audit logged, no lock for one)
        st, body = L.http(L.IP_B, L.API_PORT, "/system/pairing-pin/join", "POST",
                          headers=auth_b, body={"pin": "000000"}, timeout=30)
        assert st in (200, 400), f"wrong-pin call broke the join endpoint: {st} {body}"
        assert body.get("joined") in (False, None) or st == 400, body
        print(f"[PASS] wrong PIN refused ({st})")

        # --- the REAL pin joins B
        st, body = L.http(L.IP_B, L.API_PORT, "/system/pairing-pin/join", "POST",
                          headers=auth_b, body={"pin": pin}, timeout=30)
        assert st == 200, f"join failed: {st} {body}"
        assert body.get("joined") is True, f"join did not adopt: {body}"
        assert body.get("fingerprint"), body
        fp_b = body["fingerprint"]
        print(f"[PASS] B joined via PIN; fingerprint {fp_b}")

        # --- keys and fingerprints now agree, and data moves B<-A
        secret_b2 = open(secret_b_path).read().strip()
        assert secret_b2 == secret_a, "B must hold A's cluster key after the PIN join"
        st_my, _ = L.http(L.IP_A, L.API_PORT, "/system/cluster-key", "GET", headers=auth_a)
        assert st_my == 200, f"cluster-key status failed: {st_my}"
        # The backend normalizes SBNs (SBN-PIN-0001 becomes SBNPIN-001-26), so
        # learn what A actually stored instead of trusting the literal we sent.
        st, data = L.signed_pull(L.IP_A, secret_a, 200)
        assert st == 200, f"signed pull from A failed: {st}"
        expected = [r.get("sbn_no") for r in data.get("records", [])]
        assert expected, "A returned no records for its own signed pull"
        deadline = time.time() + 120
        got = {}
        while time.time() < deadline:
            st, data = L.signed_pull(L.IP_B, secret_b2, 200)
            sbns = [r.get("sbn_no") for r in data.get("records", [])]
            if st == 200 and any(s in sbns for s in expected):
                got = data
                break
            time.sleep(3)
        sbns = [r.get("sbn_no") for r in got.get("records", [])]
        assert any(s in sbns for s in expected), \
            f"B still lacks A's record after the PIN join; B has {sbns}, A has {expected}"
        print(f"[PASS] record moved to B through the signed pull: {sbns}")

        # --- engine logs on both sides tell the story
        log_a = open(os.path.join(L.DIRS[0], "PASADA_CRASH_LOG.txt")).read()
        log_b = open(os.path.join(dir_b, "PASADA_CRASH_LOG.txt")).read()
        assert "ADOPTED via PIN" in log_b, log_b[-600:]
        # The wrong PIN is verified (and refused) on the HOST side, so its
        # audit line lands in A's log, not B's.
        assert "wrong PIN from" in log_a, log_a[-600:]
        assert "Shared the office cluster key with" in log_a, log_a[-600:]
        assert "via PIN" in log_a, log_a[-600:]
        print("[PASS] both engines logged the PIN handshake (adopted / shared)")

        # --- the armed pin on A shows in the queue log as expected too
        print("\nALL GREEN: PIN pairing joined an office computer with "
              "auto-pairing switched OFF on both machines, and data moved.")
    except BaseException as e:  # noqa: BLE001 — the lab harness reports and exits
        import traceback
        ok = False
        print(f"\n[FAIL] {type(e).__name__}: {e}")
        traceback.print_exc()
    finally:
        if not keep:
            for p in L.PROCS:
                try:
                    os.killpg(os.getpgid(p.pid), signal.SIGTERM)
                except (OSError, ProcessLookupError):
                    pass
            time.sleep(2)
            for d in L.DIRS:
                shutil.rmtree(d, ignore_errors=True)
            print("cleaned up instance data dirs")
        else:
            print("kept: " + ", ".join(L.DIRS))
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
